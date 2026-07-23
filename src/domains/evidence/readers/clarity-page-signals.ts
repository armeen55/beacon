/**
 * Clarity fuse slice (2026-06-13 midnight shift) — per-URL behavioral
 * signals from the synced `clarity_daily_url_metrics` table, summed
 * over a trailing window. Mirrors gsc-page-signals: pure aggregation,
 * fail-soft empty (no token / no rows / table missing → empty Map, so
 * the trigger abstains).
 *
 * The newest connectors (Profound, Clarity) previously synced into
 * dead-end tables that nothing consumed — this loader is the first
 * Clarity CONSUMER, closing the END-STATE "evidence fuses" loop: the
 * moment a Clarity token lands, friction signals reach the queue.
 */

import "server-only";

import { cache } from "react";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { canonicalizeCitationUrl } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";

// Request-memoized (see ga4-page-values): the hero post-pass + the money-leak
// scan both read full-tenant Clarity friction on one render — dedupe to one query.
export const loadClarityPageSignalsForTenant = cache(loadClarityPageSignalsForTenantUncached);

/** Trailing window for Clarity friction aggregation. Clarity itself
 *  only exposes ~1-3 days live (we accumulate nightly), so 28d gives
 *  a stable per-URL rate without over-weighting one noisy day. */
const WINDOW_DAYS = 28;
// 28d of url×day friction rows can exceed 5k on a big site, silently truncating
// the per-URL dead/rage-click SUM (under-counting friction). Raised to match the
// other per-URL readers (cannibalization/profound/ga4 use ~50k); still well under
// the GSC reader's 80k bound.
const MAX_ROWS = 50_000;

export type ClarityPageSignal = {
  /** Page URL (the table's `url` column, repeated for convenience). */
  url: string;
  sessions: number;
  rageClicks: number;
  deadClicks: number;
  quickbacks: number;
  excessiveScroll: number;
  scriptErrors: number;
  /** Rage clicks per session over the window (0–1+). */
  rageRate: number;
  /** Dead clicks per session over the window. */
  deadRate: number;
  /** Quickbacks per session over the window. */
  quickbackRate: number;
  /** Session-weighted average scroll depth (0–1), or null when not recorded.
   *  Previously synced but DROPPED — now read (Sprint 6) for the Clarity router.
   *  Optional so existing constructors/tests don't need to set it. */
  scrollDepthPct?: number | null;
  /** Session-weighted average engagement time (seconds), or null. */
  engagementSeconds?: number | null;
};

function rate(n: number, sessions: number): number {
  return sessions > 0 ? n / sessions : 0;
}

async function loadClarityPageSignalsForTenantUncached(
  tenantId: string,
  now: Date = new Date(),
): Promise<Map<string, ClarityPageSignal>> {
  const out = new Map<string, ClarityPageSignal>();
  type Row = {
    url: string;
    sessions: number;
    rage_clicks: number;
    dead_clicks: number;
    quickbacks: number;
    excessive_scroll: number;
    script_errors: number;
  };
  const rows: Row[] = [];
  try {
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const sb = getSupabaseAdmin();
    // audit wave-2 #4 (2026-06-14): PostgREST caps a response at ~1000 rows
    // regardless of .limit(), so the old `.limit(5000)` read silently
    // truncated to an arbitrary 1000 url×day rows — then the per-URL SUM
    // below understated friction metrics (a high-friction page could fall
    // past the cut and never earn a clarity_friction card). Page through in
    // 1000-row chunks, stably ordered, under the safety bound.
    const PAGE = 1000;
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await sb
        .from("clarity_daily_url_metrics")
        .select(
          "url, sessions, rage_clicks, dead_clicks, quickbacks, excessive_scroll, script_errors, avg_scroll_depth, engagement_time_seconds",
        )
        .eq("tenant_id", tenantId)
        .gte("date", since)
        .order("date")
        .order("url")
        .range(from, from + PAGE - 1);
      if (error) {
        log.warn("[clarity-page-signals] read failed", {
          tenantId,
          error: error.message,
        });
        break;
      }
      const batch = (data ?? []) as unknown as Row[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
  } catch {
    return out;
  }
  if (rows == null || rows.length === 0) return out;

  // Sum each metric per URL across the window's daily rows.
  type Acc = {
    sessions: number;
    rage: number;
    dead: number;
    quickbacks: number;
    scroll: number;
    errors: number;
    /** Session-weighted running sums (÷ sessions at the end). */
    scrollDepthW: number;
    engageW: number;
    scrollDepthSessions: number;
    engageSessions: number;
  };
  // Key by the CANONICAL url (www/scheme/trailing-slash/query folded), exactly
  // like the GSC + SEMrush fuses — Clarity's exported URL format often differs
  // from the crawler's snapshot URL, so a raw-keyed map silently missed every
  // lookup whenever the two disagreed (review finding 2026-06-13). Canonical
  // keys also correctly MERGE per-URL daily rows that differ only by format.
  const byUrl = new Map<string, Acc>();
  for (const r of rows) {
    if (typeof r.url !== "string" || r.url.length === 0) continue;
    const key = canonicalizeCitationUrl(r.url) ?? r.url;
    const a =
      byUrl.get(key) ??
      { sessions: 0, rage: 0, dead: 0, quickbacks: 0, scroll: 0, errors: 0, scrollDepthW: 0, engageW: 0, scrollDepthSessions: 0, engageSessions: 0 };
    const sess = r.sessions ?? 0;
    a.sessions += sess;
    a.rage += r.rage_clicks ?? 0;
    a.dead += r.dead_clicks ?? 0;
    a.quickbacks += r.quickbacks ?? 0;
    a.scroll += r.excessive_scroll ?? 0;
    a.errors += r.script_errors ?? 0;
    const sd = (r as { avg_scroll_depth?: number | null }).avg_scroll_depth;
    const et = (r as { engagement_time_seconds?: number | null }).engagement_time_seconds;
    if (sd != null && sess > 0) {
      a.scrollDepthW += sd * sess;
      a.scrollDepthSessions += sess;
    }
    if (et != null && sess > 0) {
      a.engageW += et * sess;
      a.engageSessions += sess;
    }
    byUrl.set(key, a);
  }

  for (const [url, a] of byUrl) {
    out.set(url, {
      url,
      sessions: a.sessions,
      rageClicks: a.rage,
      deadClicks: a.dead,
      quickbacks: a.quickbacks,
      excessiveScroll: a.scroll,
      scriptErrors: a.errors,
      rageRate: rate(a.rage, a.sessions),
      deadRate: rate(a.dead, a.sessions),
      quickbackRate: rate(a.quickbacks, a.sessions),
      scrollDepthPct: a.scrollDepthSessions > 0 ? a.scrollDepthW / a.scrollDepthSessions : null,
      engagementSeconds: a.engageSessions > 0 ? a.engageW / a.engageSessions : null,
    });
  }
  return out;
}
