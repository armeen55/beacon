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

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";

/** Trailing window for Clarity friction aggregation. Clarity itself
 *  only exposes ~1-3 days live (we accumulate nightly), so 28d gives
 *  a stable per-URL rate without over-weighting one noisy day. */
const WINDOW_DAYS = 28;
const MAX_ROWS = 5000;

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
};

function rate(n: number, sessions: number): number {
  return sessions > 0 ? n / sessions : 0;
}

export async function loadClarityPageSignalsForTenant(
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
  let rows: Row[] | null = null;
  try {
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("clarity_daily_url_metrics")
      .select(
        "url, sessions, rage_clicks, dead_clicks, quickbacks, excessive_scroll, script_errors",
      )
      .eq("tenant_id", tenantId)
      .gte("date", since)
      .limit(MAX_ROWS);
    if (error) {
      log.warn("[clarity-page-signals] read failed", {
        tenantId,
        error: error.message,
      });
      return out;
    }
    rows = (data ?? []) as unknown as Row[];
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
      { sessions: 0, rage: 0, dead: 0, quickbacks: 0, scroll: 0, errors: 0 };
    a.sessions += r.sessions ?? 0;
    a.rage += r.rage_clicks ?? 0;
    a.dead += r.dead_clicks ?? 0;
    a.quickbacks += r.quickbacks ?? 0;
    a.scroll += r.excessive_scroll ?? 0;
    a.errors += r.script_errors ?? 0;
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
    });
  }
  return out;
}
