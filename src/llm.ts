// src/llm.ts
import Anthropic from "@anthropic-ai/sdk";

export function getClient(): Anthropic {
  const proxyUrl = import.meta.env.VITE_PROXY_URL;

  if (proxyUrl) {
    // Production: all requests go through the Cloudflare Worker proxy.
    // The real Anthropic API key lives in the worker as a secret and is
    // never sent to or stored in the browser bundle.
    return new Anthropic({
      apiKey: "proxy",   // placeholder — the worker replaces this with the real key
      baseURL: proxyUrl,
      dangerouslyAllowBrowser: true,
    });
  }

  // Local development: call Anthropic directly using a key from .env.local.
  // NEVER set VITE_ANTHROPIC_API_KEY in the GitHub Actions environment —
  // use VITE_PROXY_URL there instead.
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Set VITE_PROXY_URL (production) or VITE_ANTHROPIC_API_KEY (local dev) in your environment."
    );
  }
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}
