// worker/index.ts
// ---------------------------------------------------------------
// Cloudflare Worker — Anthropic API proxy
//
// This worker sits between the browser app and the Anthropic API.
// The real API key is stored as a Cloudflare Worker secret and
// never sent to or stored in the browser.
//
// Setup (one-time):
//   1. Install wrangler:  npm install -g wrangler
//   2. Login:             npx wrangler login
//   3. Set the key:       npx wrangler secret put ANTHROPIC_API_KEY
//   4. Deploy:            npx wrangler deploy
//
// After deploying, copy the worker URL (e.g.
//   https://ai-map-assistant-proxy.<your-account>.workers.dev)
// and add it as a GitHub Actions secret named VITE_PROXY_URL.
// ---------------------------------------------------------------

interface Env {
  ANTHROPIC_API_KEY: string;
  // Comma-separated list of allowed origins, e.g.:
  //   https://cschifferns.github.io
  // Set in wrangler.toml [vars] or as a secret.
  ALLOWED_ORIGINS: string;
}

const ANTHROPIC_BASE = "https://api.anthropic.com";

// Max request body size (bytes) to prevent abuse / runaway costs.
const MAX_BODY_BYTES = 64 * 1024; // 64 KB

function getAllowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  return getAllowedOrigins(env).includes(origin);
}

function corsHeaders(origin: string, allowHeaders?: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // Reflect whatever headers the browser requests so SDK-injected headers
    // (x-stainless-os, x-stainless-lang, etc.) are never blocked by preflight.
    "Access-Control-Allow-Headers": allowHeaders ?? "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";

    // ── CORS preflight ────────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin(origin, env)) {
        return new Response("Forbidden", { status: 403 });
      }
      const requestedHeaders = request.headers.get("Access-Control-Request-Headers");
      return new Response(null, { status: 204, headers: corsHeaders(origin, requestedHeaders) });
    }

    // ── Only POST is accepted ─────────────────────────────────────────────
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // ── Origin check — reject requests from unlisted origins ──────────────
    if (!isAllowedOrigin(origin, env)) {
      return new Response("Forbidden", { status: 403 });
    }

    // ── Body size guard — prevent giant payloads that inflate costs ───────
    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      return new Response("Request body too large", { status: 413 });
    }

    // Read and re-check actual body size (Content-Length can be omitted)
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return new Response("Request body too large", { status: 413 });
    }

    // ── Build forwarded request ───────────────────────────────────────────
    // Forward the same path (e.g. /v1/messages) to Anthropic.
    // Replace the browser's placeholder x-api-key with the real secret.
    const url = new URL(request.url);
    const anthropicUrl = `${ANTHROPIC_BASE}${url.pathname}${url.search}`;

    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set("x-api-key", env.ANTHROPIC_API_KEY);
    // Strip browser-identifying headers before forwarding
    forwardHeaders.delete("origin");
    forwardHeaders.delete("referer");
    forwardHeaders.delete("cookie");

    const upstream = await fetch(anthropicUrl, {
      method: "POST",
      headers: forwardHeaders,
      body,
    });

    // ── Return Anthropic's response with CORS headers added ───────────────
    const responseHeaders = new Headers(upstream.headers);
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      responseHeaders.set(key, value);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  },
};
