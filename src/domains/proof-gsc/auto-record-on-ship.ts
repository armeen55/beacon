import "server-only";

import { log } from "@/lib/logger";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import {
  loadPageSurgeonContext,
  topPagesByDemand,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import {
  recordShippedChange,
  captureChangeMeta,
  defaultPacificShipDate,
} from "./run-measurement";
import { loadShippedChanges, upsertShippedChange } from "./shipped-change-store";
import type { ShippedChangeRecord } from "./shipped-change-store";
import {
  rankControlCandidates,
  MIN_SURVIVORS,
  type ControlCandidateStats,
  type TreatedPageStats,
  type RankedControl,
} from "./control-matching";

/**
 * auto-record-on-ship (2026-06-25) — the Ship→Proof BRIDGE.
 *
 * The connectedness audit found the #1 broken link: the cockpit "Ship it" only
 * wrote a recommendation_responses row + revalidated — it created NO measurable
 * proof record, so nothing was ever measured, held, or learned from. This closes
 * that: when a Move with a target URL is accepted from ANY surface, we also create
 * the same shipped_changes ledger record the manual /proof form creates (GSC
 * baseline + diff-in-diff controls), so measurement starts automatically.
 *
 * Contract: FAIL-SOFT (never throws — a ship must succeed even if measurement
 * can't start) and IDEMPOTENT (deduped on page-path + Pacific ship-date, so a
 * re-accept or the manual form recording the same change won't double-write).
 * Deps are injectable for tests (no prod write, no GSC read).
 *
 * BEACON_500 items 33 + 36 (2026-07-02): comparison-page (control) selection now
 * runs every raw candidate through control-matching.ts's rankControlCandidates
 * before it's allowed onto a new ledger row — matched on baseline scale + pre-ship
 * trend (item 33) and excluded above ~20% query overlap with the treated page
 * (item 36, the SUTVA guard). This ONLY changes selection for NEW ships; existing
 * ledger rows are never mutated. The matcher's reasoning is preserved on the record
 * as `controlMatchNotes` so the receipt can say why a candidate was left out.
 */

const MIN_CONTROLS = 2;
const dateOnly = (iso: string): string => (iso || "").slice(0, 10);
/** Pre-ship window read for baseline-scale + trend-slope matching (item 33).
 *  Matches recordShippedChange's own 28-day baseline window so the "before the
 *  ship" comparison is apples to apples. */
const MATCH_WINDOW_DAYS = 28;
/** PostgREST response cap per page (this project caps every response at 1000
 *  rows) — the query-overlap and daily-slope reads below page through this. */
const PAGE_SIZE = 1000;
/** Hard ceiling on total rows read per matching pass, across all pages, so a
 *  huge site can never turn one ship into an unbounded scan. */
const MAX_MATCH_ROWS = 20_000;

function addDaysIso(iso: string, days: number): string {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Ordinary-least-squares slope for a sequence indexed by position 0..N-1.
 *  Mirrors natural-controls.ts's linearSlope (kept local so this file has no
 *  cross-domain dependency for one small pure helper). */
function linearSlope(nums: number[]): number {
  const n = nums.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += nums[i];
    sumXY += i * nums[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Both the tenant's real GSC property host AND its "www." variant, so a
 * canonicalized (www.-stripped) page URL still matches whichever raw form
 * gsc_daily_page_totals / gsc_daily_rows actually stored (2026-07-02 ground-
 * truth run found Iranopedia's tables key on `www.iranopedia.com`, while
 * every matcher input arrives already canonicalized to the bare host).
 */
function withWwwVariant(url: string): string[] {
  try {
    const u = new URL(url);
    if (u.hostname.startsWith("www.")) {
      const bare = new URL(url);
      bare.hostname = u.hostname.slice(4);
      return [url, bare.toString()];
    }
    const withWww = new URL(url);
    withWww.hostname = `www.${u.hostname}`;
    return [url, withWww.toString()];
  } catch {
    return [url];
  }
}

/**
 * Daily clicks per page over [start, end) from the per-page-per-day
 * `gsc_daily_page_totals` table (accurate page totals — NOT the per-query
 * `gsc_daily_rows`, which GSC truncates via anonymized-query withholding).
 * Bounded to the explicit page set, paged in PAGE_SIZE chunks. Fail-soft → {}.
 * Rows are canonicalized back to the caller's page form on read (see
 * withWwwVariant) so a canonicalized input still matches the raw GSC host.
 */
export async function loadBaselineDailySeries(
  tenantId: string,
  pages: ReadonlyArray<string>,
  start: string,
  end: string,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (!tenantId || pages.length === 0) return out;
  // Map every raw-host variant back to the canonical page the caller asked for.
  const canonByVariant = new Map<string, string>();
  const queryPages: string[] = [];
  for (const p of pages) {
    for (const v of withWwwVariant(p)) {
      canonByVariant.set(v, p);
      queryPages.push(v);
    }
  }
  try {
    const sb = getSupabaseAdmin();
    for (let offset = 0; offset < MAX_MATCH_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("gsc_daily_page_totals")
        .select("page, date, clicks")
        .eq("tenant_id", tenantId)
        .in("page", queryPages)
        .gte("date", start)
        .lt("date", end)
        .order("date", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.warn("[control-matching] daily-series read failed (fail-soft)", { tenantId, error: error.message });
        break;
      }
      const rows = (data ?? []) as Array<{ page: string; date: string; clicks: number | string | null }>;
      for (const r of rows) {
        if (!r.page || !r.date) continue;
        const canon = canonByVariant.get(r.page) ?? r.page;
        let byDate = out.get(canon);
        if (!byDate) out.set(canon, (byDate = new Map()));
        const d = r.date.slice(0, 10);
        byDate.set(d, (byDate.get(d) ?? 0) + (Number(r.clicks) || 0));
      }
      if (rows.length < PAGE_SIZE) break;
    }
  } catch (e) {
    log.warn("[control-matching] daily-series threw (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return out;
}

/** Dense (gap-filled) ascending daily clicks array for one page over the window. */
function denseDailyClicks(byDate: Map<string, number> | undefined, start: string, end: string): number[] {
  const out: number[] = [];
  let cur = start;
  while (cur < end) {
    out.push(byDate?.get(cur) ?? 0);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

/**
 * Impression-weighted query overlap between the treated page and each
 * candidate over the baseline window, from `gsc_daily_rows` (the page+query
 * grain — the only table that names which QUERIES a page ranks for). Bounded
 * `page IN (...)` read, paged in PAGE_SIZE chunks, capped at MAX_MATCH_ROWS
 * total. Cached per call (one read serves every candidate in one ship).
 *
 * overlap(candidate) = impressions on queries {treated ∩ candidate}
 *                       ---------------------------------------------
 *                       candidate's total impressions
 *
 * i.e. "how much of the CANDIDATE's own demand is demand it shares with the
 * treated page" — the SUTVA question (would a treated-page title win visibly
 * steal from this candidate's clicks?). Fail-soft → empty map (every
 * candidate then reads queryOverlap=null, which control-matching.ts treats as
 * a pass, never an exclusion). Rows are canonicalized back to the caller's
 * page form on read (see withWwwVariant) so a canonicalized input still
 * matches the raw GSC host these tables store.
 */
export async function loadQueryOverlap(
  tenantId: string,
  treatedPage: string,
  candidates: ReadonlyArray<string>,
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!tenantId || candidates.length === 0) return out;
  const canonPages = [...new Set([treatedPage, ...candidates])];
  const canonByVariant = new Map<string, string>();
  const queryPages: string[] = [];
  for (const p of canonPages) {
    for (const v of withWwwVariant(p)) {
      canonByVariant.set(v, p);
      queryPages.push(v);
    }
  }
  try {
    const sb = getSupabaseAdmin();
    const byPageQuery = new Map<string, Map<string, number>>(); // canonical page -> query -> impressions
    for (let offset = 0; offset < MAX_MATCH_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("gsc_daily_rows")
        .select("page, query, impressions")
        .eq("tenant_id", tenantId)
        .in("page", queryPages)
        .gte("date", start)
        .lt("date", end)
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.warn("[control-matching] query-overlap read failed (fail-soft)", { tenantId, error: error.message });
        break;
      }
      const rows = (data ?? []) as Array<{ page: string; query: string; impressions: number | string | null }>;
      for (const r of rows) {
        const canon = canonByVariant.get(r.page) ?? r.page;
        const query = (r.query ?? "").trim();
        if (!canon || !query) continue;
        let byQuery = byPageQuery.get(canon);
        if (!byQuery) byPageQuery.set(canon, (byQuery = new Map()));
        byQuery.set(query, (byQuery.get(query) ?? 0) + (Number(r.impressions) || 0));
      }
      if (rows.length < PAGE_SIZE) break;
    }

    const treatedQueries = byPageQuery.get(treatedPage) ?? new Map<string, number>();
    const treatedQuerySet = new Set(treatedQueries.keys());
    for (const candidate of candidates) {
      const candidateQueries = byPageQuery.get(candidate);
      if (!candidateQueries || candidateQueries.size === 0) continue; // no data -> leave null (fail-soft)
      let candidateTotal = 0;
      let sharedTotal = 0;
      for (const [query, impr] of candidateQueries) {
        candidateTotal += impr;
        if (treatedQuerySet.has(query)) sharedTotal += impr;
      }
      if (candidateTotal > 0) out.set(candidate, sharedTotal / candidateTotal);
    }
  } catch (e) {
    log.warn("[control-matching] query-overlap threw (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return out;
}

/**
 * Run the full matcher (baseline-scale + trend-slope + query-overlap) for one
 * treated page against its raw candidate pool. Reads the pre-ship daily-clicks
 * series and the query-overlap map ONCE (per ship), then hands pure numbers to
 * control-matching.ts. Fail-soft: any read failure degrades that candidate's
 * inputs to nulls/zeros rather than throwing (control-matching.ts's fail-soft
 * contract turns a null input into a PASS, never an exclusion).
 */
export async function matchControlsForShip(args: {
  tenantId: string;
  treatedPage: string;
  candidates: ReadonlyArray<string>;
  shipDate: string; // YYYY-MM-DD
  minSurvivors?: number;
  maxKept?: number;
}): Promise<{ kept: string[]; matched: RankedControl[]; usedFallback: boolean }> {
  const start = addDaysIso(args.shipDate, -MATCH_WINDOW_DAYS);
  const end = args.shipDate;
  const allPages = [args.treatedPage, ...args.candidates];

  const [dailySeries, overlapByCandidate] = await Promise.all([
    loadBaselineDailySeries(args.tenantId, allPages, start, end),
    loadQueryOverlap(args.tenantId, args.treatedPage, args.candidates, start, end),
  ]);

  const treatedDaily = denseDailyClicks(dailySeries.get(args.treatedPage), start, end);
  const treated: TreatedPageStats = {
    url: args.treatedPage,
    baselineClicksPerDay: mean(treatedDaily),
    preSlope: linearSlope(treatedDaily),
  };

  const candidateStats: ControlCandidateStats[] = args.candidates.map((url) => {
    const daily = denseDailyClicks(dailySeries.get(url), start, end);
    return {
      url,
      baselineClicksPerDay: mean(daily),
      preSlope: linearSlope(daily),
      queryOverlap: overlapByCandidate.get(url) ?? null,
    };
  });

  const result = rankControlCandidates({
    treated,
    candidates: candidateStats,
    minSurvivors: args.minSurvivors ?? MIN_SURVIVORS,
    maxKept: args.maxKept ?? 3,
  });

  return { kept: result.kept.map((k) => k.url), matched: result.all, usedFallback: result.usedFallback };
}

/** Plain-language receipt lines for excluded candidates — no "control" on any
 *  operator surface (per the proof jargon guard), first person, no dashes. */
export function buildControlMatchNotes(matched: ReadonlyArray<RankedControl>): string[] {
  return matched
    .filter((m) => m.verdict === "excluded")
    .map((m) => `Left out ${m.url} as a comparison page: ${m.reason}.`);
}

export type AutoRecordDeps = {
  captureChangeMeta: typeof captureChangeMeta;
  recordShippedChange: typeof recordShippedChange;
  loadShippedChanges: typeof loadShippedChanges;
  upsertShippedChange: typeof upsertShippedChange;
  /** Returns up to `n` candidate control URLs (top same-site pages by demand). */
  loadControlCandidates: (tenantId: string, n: number) => Promise<string[]>;
  /** Items 33 + 36: ranks the raw candidate pool on baseline scale, pre-ship
   *  trend, and query overlap with the treated page. Injectable so tests never
   *  hit GSC; defaults to the real matcher. */
  matchControls: typeof matchControlsForShip;
  shipDate: () => string; // Pacific ship date (date-only)
};

const defaultDeps: AutoRecordDeps = {
  captureChangeMeta,
  recordShippedChange,
  loadShippedChanges,
  upsertShippedChange,
  loadControlCandidates: async (tenantId, n) => {
    const ctx = await loadPageSurgeonContext(tenantId);
    return topPagesByDemand(ctx, n);
  },
  matchControls: matchControlsForShip,
  shipDate: () => dateOnly(defaultPacificShipDate()),
};

export type AutoRecordResult = {
  recorded: boolean;
  /** machine-readable outcome: recorded | no-url | unresolved-url | already-recorded | insufficient-controls | error */
  reason: string;
};

/**
 * Create the proof record for a just-accepted Move. Returns the outcome; NEVER
 * throws. `actionType` is the rec's action_type (e.g. add_answer_block,
 * edit_title); `targetQuery` is the demand cluster / top query when known.
 */
export async function autoRecordShippedChangeForRec(
  args: {
    tenantId: string;
    pageUrl: string | null | undefined;
    actionType?: string | null;
    targetQuery?: string | null;
    /** Operator confirmed they applied it live (the "Mark as applied" path). */
    verifiedLive?: boolean;
    /** Override the ledger note (default: "Auto-recorded from cockpit Ship"). */
    notes?: string;
  },
  depsOverride: Partial<AutoRecordDeps> = {},
): Promise<AutoRecordResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const pageUrl = (args.pageUrl ?? "").trim();
  if (!pageUrl) return { recorded: false, reason: "no-url" };

  try {
    const meta = await deps.captureChangeMeta(args.tenantId, pageUrl);
    // GSC windows are keyed by canonical absolute URLs — a bare/unresolved path
    // reads zero clicks and produces a misleading verdict. Skip rather than lie.
    if (!/^https?:\/\//i.test(meta.canonPage)) return { recorded: false, reason: "unresolved-url" };

    const shipDate = deps.shipDate();
    const existing = await deps.loadShippedChanges();

    // Idempotent: the ledger PK is (page-path, ship-date). If this page already has
    // a record for today, do nothing (the manual form or a prior accept got here).
    if (existing.some((r) => r.path === meta.path && dateOnly(r.shippedAt) === shipDate)) {
      return { recorded: false, reason: "already-recorded" };
    }

    // Controls = top same-site pages by demand, excluding the treated page and any
    // page already mid-experiment (a treated control contaminates the diff-in-diff).
    const origin = new URL(meta.canonPage).origin;
    const normPath = (p: string): string => p.replace(/\/+$/, "") || "/";
    const treated = new Set(existing.map((r) => normPath(r.path)));
    const isUntreated = (u: string): boolean => {
      try {
        return !treated.has(normPath(new URL(u).pathname));
      } catch {
        return true;
      }
    };
    // Pull a wider raw pool than before (12 candidates, same as before) so the
    // matcher below has room to reject mismatched-scale / diverging-trend /
    // same-query candidates and still land on MIN_CONTROLS good ones.
    const rawCandidates = (await deps.loadControlCandidates(args.tenantId, 12))
      .map((u) => canonicalizeCitationUrl(u) ?? u)
      .filter((u) => u && u !== meta.canonPage && isUntreated(u));

    // Items 33 + 36: rank the raw pool on baseline scale + pre-ship trend +
    // query overlap with the treated page. Fail-soft by construction (every
    // read inside matchControlsForShip degrades to null/0 rather than
    // throwing) — a matcher failure here still returns SOME ranking (nulls
    // read as passes), never zero candidates when raw candidates exist.
    let controlPages: string[] = [];
    let controlMatchNotes: string[] = [];
    let controlMatchWeak = false;
    try {
      const matched = await deps.matchControls({
        tenantId: args.tenantId,
        treatedPage: meta.canonPage,
        candidates: rawCandidates,
        shipDate,
      });
      controlPages = matched.kept;
      controlMatchNotes = buildControlMatchNotes(matched.matched);
      controlMatchWeak = matched.usedFallback && controlPages.length > 0;
      if (controlMatchWeak) {
        controlMatchNotes.push(
          "I could not find enough closely matched comparison pages, so I used the closest available ones. I will read this result cautiously.",
        );
      }
    } catch (e) {
      // Fail-soft to the pre-matcher behavior: current selection (top-3 raw
      // candidates), never zero controls because the matcher itself broke.
      log.warn("[ship->proof] control matching failed, falling back to raw top-3 (non-blocking)", {
        tenantId: args.tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      controlPages = rawCandidates.slice(0, 3);
      controlMatchNotes = ["Comparison-page matching could not run, so I used the top pages by demand as a fallback."];
    }

    // No honest diff-in-diff without ≥2 comparable untreated pages — skip (the
    // operator can still record manually once GSC has more pages). Never block ship.
    if (controlPages.length < MIN_CONTROLS) return { recorded: false, reason: "insufficient-controls" };

    const actionType = (args.actionType ?? "").trim() || meta.headlineAction || "change";
    const record: ShippedChangeRecord = await deps.recordShippedChange({
      tenantId: args.tenantId,
      page: meta.canonPage,
      path: meta.path,
      actionType,
      before: (meta.before || "").trim() || null,
      after: (meta.after || "").trim() || null,
      targetQueries: args.targetQuery?.trim() ? [args.targetQuery.trim()] : meta.targetQueries,
      controlPages,
      notes: args.notes ?? "Auto-recorded from cockpit Ship",
      verifiedLive: args.verifiedLive ?? false,
    });
    // Flag the page for a fresh crawl: the snapshot/EvidencePacket must re-read the
    // changed content so the SAME Move stops being re-recommended. The persisted
    // re-crawl rides the scan path (orchestrate-scan → Supabase); this stamps the
    // intent on the record so the scan/measurement layer knows the page changed.
    // controlMatchNotes (items 33 + 36, additive): the receipt trail for why any
    // raw candidate was left out of controlPages above.
    const stamped: ShippedChangeRecord = {
      ...record,
      recrawlRequestedAt: new Date().toISOString(),
      controlMatchNotes: controlMatchNotes.length > 0 ? controlMatchNotes : null,
      controlMatchWeak,
    };
    await deps.upsertShippedChange(stamped);
    log.info("[ship->proof] auto-recorded shipped change", {
      tenantId: args.tenantId,
      path: meta.path,
      actionType,
      controls: controlPages.length,
      excludedCandidates: controlMatchNotes.length,
    });
    return { recorded: true, reason: "recorded" };
  } catch (e) {
    log.warn("[ship->proof] auto-record failed (non-blocking)", {
      tenantId: args.tenantId,
      pageUrl,
      error: e instanceof Error ? e.message : String(e),
    });
    return { recorded: false, reason: "error" };
  }
}
