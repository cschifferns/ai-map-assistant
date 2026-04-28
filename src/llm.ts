// src/llm.ts
import Anthropic from "@anthropic-ai/sdk";

export function getClient(): Anthropic {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Set VITE_ANTHROPIC_API_KEY in .env.local");
  }
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
}
