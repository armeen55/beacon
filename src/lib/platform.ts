import type { Platform } from "./constants";

const PLATFORM_MAP: Record<string, Platform> = {
  "chatgpt": "chatgpt",
  "google ai overviews": "google_aio",
  "google aio": "google_aio",
  "perplexity": "perplexity",
  "gemini": "gemini",
  "claude": "claude",
};

/**
 * Normalize a platform display name to the legacy Platform slug.
 * "ChatGPT" → "chatgpt", "Google AI Overviews" → "google_aio", etc.
 * Falls back to lowercase slug if unrecognized.
 */
export function normalizePlatform(raw: string): Platform {
  const key = raw.trim().toLowerCase();
  return PLATFORM_MAP[key] ?? (key.replace(/[^a-z0-9]+/g, "_") as Platform);
}
