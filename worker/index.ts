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
  // Optional shared secret checked against the X-Proxy-Token request header.
  // Raises the bar for non-browser abuse without requiring user authentication.
  // Generate with: openssl rand -hex 32
  // Store as: npx wrangler secret put PROXY_TOKEN
  // Also add as a GitHub Actions secret named VITE_PROXY_TOKEN.
  PROXY_TOKEN?: string;
}

const ANTHROPIC_BASE = "https://api.anthropic.com";

// Allowlist of Anthropic paths this proxy may forward.
// Prevents the worker from being used as a relay to other API surfaces.
const ALLOWED_PATHS = new Set(["/v1/messages"]);

// Max request body size (bytes) to prevent abuse / runaway costs.
// 64 KB was too small — long conversations with large system prompts exceed it.
const MAX_BODY_BYTES = 512 * 1024; // 512 KB

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

    // ── Proxy token check (if configured) ────────────────────────────────
    // Validates a shared secret sent in X-Proxy-Token. This doesn't prevent
    // token extraction from the JS bundle, but it blocks untargeted abuse.
    if (env.PROXY_TOKEN) {
      const clientToken = request.headers.get("X-Proxy-Token");
      if (clientToken !== env.PROXY_TOKEN) {
        return new Response("Forbidden", { status: 403 });
      }
    }

    // ── Path allowlist — only proxy known Anthropic endpoints ─────────────
    const url = new URL(request.url);
    if (!ALLOWED_PATHS.has(url.pathname)) {
      return new Response("Not found", { status: 404 });
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
    // Build a clean headers object — only pass headers Anthropic needs.
    // Forwarding all browser headers would leak client metadata to a third party.
    const forwardHeaders = new Headers();
    forwardHeaders.set("x-api-key", env.ANTHROPIC_API_KEY);
    const contentType = request.headers.get("content-type");
    if (contentType) forwardHeaders.set("content-type", contentType);
    const anthropicVersion = request.headers.get("anthropic-version");
    if (anthropicVersion) forwardHeaders.set("anthropic-version", anthropicVersion);
    // anthropic-beta carries optional feature flags (e.g. extended thinking)
    const anthropicBeta = request.headers.get("anthropic-beta");
    if (anthropicBeta) forwardHeaders.set("anthropic-beta", anthropicBeta);

    const anthropicUrl = `${ANTHROPIC_BASE}${url.pathname}`;

    const upstream = await fetch(anthropicUrl, {
      method: "POST",
      headers: forwardHeaders,
      body,
    });

    // ── Return Anthropic's response with CORS headers added ───────────────
    // On error, return a sanitized response — never forward Anthropic error
    // bodies which may reveal key status, quota details, or account info.
    if (!upstream.ok) {
      return new Response(
        JSON.stringify({ error: "API request failed", status: upstream.status }),
        {
          status: upstream.status,
          headers: { ...corsHeaders(origin), "content-type": "application/json" },
        },
      );
    }

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
