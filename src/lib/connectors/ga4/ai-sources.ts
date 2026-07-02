import "server-only";

/**
 * AI-referral source classification (2026-07-01, BEACON_500 item 6).
 *
 * GA4's `sessionSource` dimension carries the referrer host for referral
 * sessions (e.g. "chatgpt.com", "perplexity.ai"). This module is the ONE
 * place that decides which sources count as "an AI assistant sent this
 * visitor" and which canonical bucket each variant belongs to, so ChatGPT
 * traffic arriving as "chatgpt.com" and "chat.openai.com" lands in a single
 * row instead of two.
 *
 * Posture (locked, mirrors normalize-page-path.ts):
 *   - Pure synchronous functions. No I/O, no logger, no clock, no tenant.
 *   - Never throws on any input shape. Unknown source -> null.
 *   - Deterministic on input.
 *
 * Two-tier match:
 *   1. EXACT host match (after lowercase + trim + strip "www.") against
 *      AI_SOURCE_EXACT. This is the precise tier; short hosts that would be
 *      dangerous as substrings ("you.com" is inside "thankyou.com") live
 *      ONLY here.
 *   2. CONTAINS fallback against AI_SOURCE_CONTAINS for subdomain/variant
 *      shapes GA4 emits in the wild ("m.chatgpt.com", "chatgpt.com / referral"
 *      style composites, regional Gemini hosts). Tokens are chosen to be
 *      distinctive enough that false positives are implausible.
 *
 * The GA4 request-side filter (buildAiReferralReportBody) deliberately
 * over-fetches with broad CONTAINS terms; classifyAiSource is the precise
 * gate applied to every returned row before anything is persisted.
 *
 * Pinned by tests/lib/connectors/ga4/ai-sources.test.ts.
 */

/** One canonical AI source bucket. `domain` is what we persist in
 *  ga4_ai_referral_daily.source_domain; `label` is the operator-facing name. */
export type AiSource = {
  domain: string;
  label: string;
};

const CHATGPT: AiSource = { domain: "chatgpt.com", label: "ChatGPT" };
const PERPLEXITY: AiSource = { domain: "perplexity.ai", label: "Perplexity" };
const GEMINI: AiSource = { domain: "gemini.google.com", label: "Gemini" };
const COPILOT: AiSource = { domain: "copilot.microsoft.com", label: "Copilot" };
const CLAUDE: AiSource = { domain: "claude.ai", label: "Claude" };
const YOU: AiSource = { domain: "you.com", label: "You.com" };
const META: AiSource = { domain: "meta.ai", label: "Meta AI" };

/** Exact-host matches (post-normalization). The authoritative tier. */
export const AI_SOURCE_EXACT: ReadonlyMap<string, AiSource> = new Map([
  ["chatgpt.com", CHATGPT],
  ["chat.openai.com", CHATGPT],
  ["openai.com", CHATGPT],
  ["perplexity.ai", PERPLEXITY],
  ["gemini.google.com", GEMINI],
  ["bard.google.com", GEMINI],
  ["copilot.microsoft.com", COPILOT],
  ["claude.ai", CLAUDE],
  ["you.com", YOU],
  ["meta.ai", META],
]);

/** Contains-based fallback for variant hosts. Order matters: first hit wins.
 *  Short/ambiguous hosts (you.com, meta.ai) are intentionally NOT here. */
export const AI_SOURCE_CONTAINS: ReadonlyArray<{ token: string; source: AiSource }> = [
  { token: "chatgpt", source: CHATGPT },
  { token: "chat.openai", source: CHATGPT },
  { token: "perplexity", source: PERPLEXITY },
  { token: "gemini.google", source: GEMINI },
  { token: "bard.google", source: GEMINI },
  { token: "copilot.microsoft", source: COPILOT },
  { token: "claude.ai", source: CLAUDE },
];

/**
 * Broad request-side filter terms for the GA4 `sessionSource` dimension.
 * Used to build an orGroup of case-insensitive CONTAINS filters so the API
 * returns a small candidate set; classifyAiSource then applies the precise
 * gate. Over-fetching here is safe and cheap; under-fetching loses data.
 */
export const AI_SOURCE_FILTER_TERMS: ReadonlyArray<string> = [
  "chatgpt",
  "openai",
  "perplexity",
  "gemini",
  "bard.google",
  "copilot",
  "claude",
  "you.com",
  "meta.ai",
];

/**
 * Classify a GA4 sessionSource value into a canonical AI source, or null when
 * the source is not an AI assistant. Never throws.
 */
export function classifyAiSource(raw: string | null | undefined): AiSource | null {
  if (raw == null) return null;
  const s = raw.trim().toLowerCase().replace(/^www\./, "");
  if (s === "") return null;
  const exact = AI_SOURCE_EXACT.get(s);
  if (exact != null) return exact;
  for (const { token, source } of AI_SOURCE_CONTAINS) {
    if (s.includes(token)) return source;
  }
  return null;
}

/** Operator label for a persisted canonical source_domain; falls back to the
 *  raw domain so an unknown value still renders something honest. */
export function aiSourceLabel(domain: string | null | undefined): string {
  if (domain == null || domain.trim() === "") return "an AI assistant";
  const hit = classifyAiSource(domain);
  return hit != null ? hit.label : domain.trim();
}
