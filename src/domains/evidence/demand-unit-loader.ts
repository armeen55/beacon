import "server-only";

/** evidence/demand-unit-loader - THE TWO BOUNDED READS behind the canonical demand units, and the one
 *  adapter from an EvidenceSnapshot to the pure builder's inputs. History comes off the gsc_unit_history
 *  aggregate (per-query two-window sums computed in Postgres, capped rows, never sixteen months of raw
 *  rows in memory), windowed against the days the account ACTUALLY holds so a half-finished backfill
 *  reads as a shorter early window instead of a diluted one. Fail-soft: no history is an account whose
 *  units carry `history: null`, never a thrown pass. */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { citesOwnSite } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { domainOf } from "@/domains/evidence/relevance-gate";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { canonicalDemandUnits, type CanonicalDemandUnit, type UnitHistoryRow } from "./demand-units";
import { defaultExpectedCtrAt, type TenantCtrCurve } from "@/domains/evidence/forecast/tenant-ctr-curve";

/** The recent window every current metric already uses. */
const RECENT_DAYS = 90;
/** How far back the early window may reach: what Google serves at most. */
const MAX_HISTORY_DAYS = 480;

const day = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number): string => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return day(t); };
const spanDays = (from: string, to: string): number => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));

/** Per-query two-window history plus the exact window lengths it was computed over. */
export async function loadUnitHistory(tenantId: string, now: Date = new Date()): Promise<{ rows: UnitHistoryRow[]; earlyDays: number; recentDays: number; earlyFrom: string | null; earlyTo: string | null }> {
  const none = { rows: [] as UnitHistoryRow[], earlyDays: 0, recentDays: RECENT_DAYS, earlyFrom: null, earlyTo: null };
  try {
    const sb = getSupabaseAdmin();
    const { data: oldestRow, error: oldestError } = await sb.from("gsc_daily_rows").select("date").eq("tenant_id", tenantId)
      .order("date", { ascending: true }).limit(1);
    // A FAILED READ IS SAID OUT LOUD, never returned as "this account holds no days": this exact read timed
    // out unindexed for weeks and the silent none blinded every producer downstream of the units.
    if (oldestError != null) { log.warn("[demand-units] the oldest-day read failed; units carry none", { tenantId, error: oldestError.message }); return none; }
    const oldest = (oldestRow?.[0] as { date?: string } | undefined)?.date;
    if (!oldest) return none;
    const today = day(now);
    const recentFrom = addDays(today, -RECENT_DAYS);
    // The early window is everything BEFORE the recent one, clamped to what is actually stored, so a
    // backfill still walking backward yields an honest shorter window rather than a per-day dilution.
    const earlyFrom = oldest > addDays(today, -MAX_HISTORY_DAYS) ? oldest : addDays(today, -MAX_HISTORY_DAYS);
    const earlyTo = recentFrom;
    const earlyDays = spanDays(earlyFrom, earlyTo);
    if (earlyDays < 30) return { ...none, earlyFrom, earlyTo }; // under a month of pre-window history proves nothing about a collapse
    const { data, error } = await sb.rpc("gsc_unit_history", {
      p_tenant_id: tenantId, p_early_from: earlyFrom, p_early_to: earlyTo, p_recent_from: recentFrom, p_limit: 2000 });
    if (error != null) { log.warn("[demand-units] history read failed; units carry none", { tenantId, error: error.message }); return { ...none, earlyFrom, earlyTo }; }
    const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      query: String(r.query ?? ""), earlyClicks: Number(r.early_clicks ?? 0), earlyImpressions: Number(r.early_impressions ?? 0),
      earlyPosition: r.early_position == null ? null : Number(r.early_position),
      recentClicks: Number(r.recent_clicks ?? 0), recentImpressions: Number(r.recent_impressions ?? 0),
      recentPosition: r.recent_position == null ? null : Number(r.recent_position),
      earlyTopPage: (r.early_top_page as string | null) ?? null, recentTopPage: (r.recent_top_page as string | null) ?? null,
      earlyPagePosition: r.early_page_position == null ? null : Number(r.early_page_position),
      recentPagePosition: r.recent_page_position == null ? null : Number(r.recent_page_position),
      earlyPageShare: r.early_page_share == null ? null : Number(r.early_page_share),
      recentPageShare: r.recent_page_share == null ? null : Number(r.recent_page_share),
    })).filter((r) => r.query.length > 0);
    return { rows, earlyDays, recentDays: RECENT_DAYS, earlyFrom, earlyTo };
  } catch (e) {
    log.warn("[demand-units] history read threw; units carry none", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return none;
  }
}

/** The canonical units for one account, assembled from the snapshot the pass already holds plus the one
 *  bounded history read. Every join is the pure builder's; nothing here re-decides membership. */
export async function loadCanonicalDemandUnits(tenantId: string, snapshot: EvidenceSnapshot,
  curve?: Pick<TenantCtrCurve, "expectedCtrAt">, now: Date = new Date(),
): Promise<{ units: CanonicalDemandUnit[]; historyWindow: { earlyDays: number; earlyFrom: string | null; earlyTo: string | null } }> {
  const history = await loadUnitHistory(tenantId, now);
  const site = (snapshot.scope.site ?? "").replace(/^www\./, "").toLowerCase();
  const research = snapshot.research;
  const units = canonicalDemandUnits({
    pageQueries: snapshot.ownedPages.map((p) => ({ page: p.url, rows: p.search?.topQueries ?? [] })),
    history: history.rows,
    windows: { earlyDays: history.earlyDays, recentDays: history.recentDays },
    keywords: (research.retainedKeywords ?? []).map((k) => ({ query: k.query, searchVolume: k.searchVolume, intent: k.intent, difficulty: k.difficulty })),
    serps: (research.serpEvidence ?? []).map((s) => ({ query: s.query, observedAt: s.observedAt,
      organic: s.organic.map((o) => ({ rank: o.rank, domain: o.domain, url: o.url })),
      paa: s.paa.map((p) => p.question), related: s.related })),
    observations: (research.aiObservations ?? []).map((o) => ({ promptId: o.promptId, promptText: o.promptText,
      creditedOwn: site.length > 0 && citesOwnSite(o.citations ?? [], site), engine: o.engine, day: o.reportingDay,
      citations: (o.citations ?? []).map((c) => ({ domain: c.domain, url: c.url })), fanOutQueries: o.fanOutQueries })),
    winning: (research.winningPages ?? []).map((w) => ({ url: w.url, domain: w.domain || domainOf(w.url),
      queries: w.appearances.map((a) => a.query).filter((q): q is string => !!q),
      promptIds: w.appearances.map((a) => a.promptId).filter((id): id is string => !!id) })),
    expectedCtrAt: curve?.expectedCtrAt ?? defaultExpectedCtrAt,
  });
  return { units, historyWindow: { earlyDays: history.earlyDays, earlyFrom: history.earlyFrom, earlyTo: history.earlyTo } };
}
