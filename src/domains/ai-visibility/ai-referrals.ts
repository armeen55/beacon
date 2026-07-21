import "server-only";

/**
 * AI-referral row mapping (2026-07-01, BEACON_500 item 6, slimmed 2026-07-21).
 *
 * The one live slice of the former ai-referrals reader: mapping a raw
 * `ga4_ai_referral_daily` row (written by
 * src/lib/connectors/ga4/sync-ai-referrals.ts) into a typed fact. Consumed by
 * load-crawl-citation-funnel.ts for its per-page AI-referred sessions read.
 * The summary/Today-line reader half was deleted (repository diet) once no
 * surface rendered it.
 *
 * Pinned by tests/domains/ai-visibility/ai-referrals.test.ts.
 */

export type AiReferralFact = {
  pagePath: string;
  /** YYYY-MM-DD. */
  day: string;
  /** Canonical assistant domain (e.g. "chatgpt.com"). */
  sourceDomain: string;
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
};

/** Map a raw table row into a fact; null when malformed. Pure; exported for tests. */
export function mapAiReferralRow(raw: Record<string, unknown>): AiReferralFact | null {
  const pagePath = typeof raw.page_path === "string" ? raw.page_path : null;
  const day = typeof raw.day === "string" ? raw.day.slice(0, 10) : null;
  const sourceDomain = typeof raw.source_domain === "string" ? raw.source_domain : null;
  if (pagePath == null || day == null || sourceDomain == null) return null;
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : 0;
  };
  return {
    pagePath,
    day,
    sourceDomain,
    sessions: num(raw.sessions),
    engagedSessions: num(raw.engaged_sessions),
    keyEvents: num(raw.key_events),
  };
}
