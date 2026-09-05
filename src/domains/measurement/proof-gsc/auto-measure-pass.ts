import "server-only";

/**
 * auto-measure-pass (2026-06-25, Sprint 3 / P11) - THE auto-measure engine. It re-reads applied Moves over time with nobody in the app,
 * through the very orchestrator an operator press uses (measureRecord: the Search 7/14/28 day diff in diff). NO paid calls (Search Console
 * and Analytics are already synced), cache-first, bounded per pass, fail-soft per record, and no publish path is touched. `isDueForMeasure`
 * is the PURE testable core: it lifts measureRecord's own finalized-watermark gate to a pre-check, so a pass spends a read only where a
 * verdict could actually change (a window can turn ran:false into ran:true since the last measure).
 *
 * AND BEFORE THE READING, TWO FREE REPAIRS (live pass 23, 2026-09-03), because the two things holding whole cohorts out of measurement were
 * invisible from inside the reading itself: a live check that stopped with no next date, and a page nobody had asked Google about. The
 * ordinary pass clears both, forward only, never by hand.
 */

import { log } from "@/lib/logger";
import { reportingDay } from "@/lib/reporting-day";
import { gscLastCrawlTimes } from "@/lib/connectors/gsc/url-inspection";
import { measureRecord, openChangePaths } from "./measure-pass";
import { contaminationFor } from "./contamination";
import { readLastFinalizedDate } from "./gsc-window";
import { invalidateResultsSurfaceSafe, loadShippedChangesForTenant, recordVerification, upsertShippedChange, type ShippedChangeRecord } from "./shipped-change-store";
import { crawlClock, isDueForMeasure, outcomeStateOf, type OutcomeState } from "./measure-lifecycle";

type AutoMeasureOutcome = { id: string; path: string; actionType: string; verdictBefore: string; verdictAfter: string; state: OutcomeState; changed: boolean };
/** What one pass did, in the facts its receipt is written from: how many rows were read, how many of those came back off a dead comparison
 *  state (`revived`), and how many stuck rows the two repairs cleared. */
type AutoMeasurePassResult = { considered: number; due: number; measured: number; changed: number; settled: number; revived: number;
  reopened: number; crawlStamped: number; failed: number; outcomes: AutoMeasureOutcome[] };

/** HOW MANY PAGES ONE PASS ASKS GOOGLE ABOUT. Free, and Google's own quota is 2000 inspections a day per property, so this is a politeness
 *  bound and never a money one. Oldest stamp first, so a backlog drains in order and the oldest row is never the starved one. */
const CRAWL_INSPECTIONS_PER_PASS = 50;
/** The most live reads one shipment ever gets, READ from verify-shipment's own bound rather than mirrored beside it. This file may put a
 *  stopped check back on that schedule; it may never widen it, so a row at the limit is left alone and stays honestly unverified. */
import { MAX_CHECKS as VERIFIER_MAX_CHECKS } from "../verify-shipment";
/** WHAT THE REPAIR DID, on the row, in one sentence and never twice. */
const REOPEN_NOTE = "The live check on this page had stopped with no next date, so it is scheduled again from today, inside the same three read limit.";
const noteOnce = (held: string | null, note: string): string => ((held ?? "").includes(note) ? (held ?? "") : [held, note].filter(Boolean).join(" "));
/** A row with no crawl confirmed at or after its stamp: either nobody has asked, or Google's last read of the page predates the change. */
const crawlUnconfirmed = (r: ShippedChangeRecord): boolean => r.lastCrawlAt == null || crawlClock(r).awaiting;

/**
 * THE TWO FREE REPAIRS, before a single reading is taken. (1) A live check that came back blocked and stopped with no next date, still under
 * the verifier's own read limit, is put back on that schedule: the due gate refuses a blocked row, so 18 of them were measured by nothing and
 * nothing was ever going to look at them again. (2) Every row with no confirmed crawl at or after its stamp is inspected, so its windows can
 * count from the day Google actually read the change rather than the day it was pressed. FORWARD ONLY and bounded: a check already scheduled
 * is not rescheduled, a stamp already on file is not restamped, and a repair that could not be saved leaves the row exactly as it was.
 */
async function repairStuckRows(
  tenantId: string, records: ShippedChangeRecord[], now: Date,
): Promise<{ records: ShippedChangeRecord[]; reopened: number; crawlStamped: number }> {
  const today = reportingDay(now), dirty = new Set<string>(), out = records.map((r) => ({ ...r }));
  let reopened = 0, crawlStamped = 0;
  for (const r of out) {
    const v = r.verification;
    if (v == null || v.status !== "blocked" || (v.checks ?? 1) >= VERIFIER_MAX_CHECKS || v.recheckAfter != null || v.reason === "applied_wording_missing") continue; // AND A RECORD RECONCILED FROM ITSELF IS NOT A STUCK ROW (found beside the re-derivation rule, 2026-09-05): a record that names nothing to look for closes with no next date and under the limit, so this repair put it back on the schedule, the reading closed it from the record again at zero cost, and the two wrote each other a row on every pass for ever. When such a record comes back is the due door's own question and it is asked there, from the one rule that decides what a record names.
    const verification = { ...v, recheckAfter: today }; // the verifier's own column, through the verifier's own seam
    if (!(await recordVerification(tenantId, r.id, verification).catch(() => false))) continue;
    r.verification = verification; r.notes = noteOnce(r.notes, REOPEN_NOTE); dirty.add(r.id); reopened += 1;
  }
  const owed = out.filter(crawlUnconfirmed)
    .sort((a, b) => (a.implementedAt ?? a.shippedAt).localeCompare(b.implementedAt ?? b.shippedAt))
    .slice(0, CRAWL_INSPECTIONS_PER_PASS);
  const crawls = owed.length === 0 ? new Map<string, string>()
    : await gscLastCrawlTimes(tenantId, owed.map((r) => r.page)).catch(() => new Map<string, string>());
  for (const r of out) {
    const at = crawls.get(r.page);
    if (at == null || at === r.lastCrawlAt) continue;
    r.lastCrawlAt = at; dirty.add(r.id); crawlStamped += 1;
  }
  for (const r of out) {
    if (!dirty.has(r.id)) continue;
    r.updatedAt = now.toISOString();
    await upsertShippedChange(r, tenantId, { invalidate: false }).catch(() => undefined); // the pass invalidates once, at the end
  }
  return { records: out, reopened, crawlStamped };
}

/**
 * THE shared measure loop (2026-07-20 consolidation): both due-row passes used to carry byte-identical copies of it. It walks a PRE-FILTERED,
 * pre-ordered due batch, measures each record with the same engine, and persists through the injected writer. The callers still differ only
 * in what they legitimately must (data source, due gate, control exclusion, result shape), so those stay in the callers and arrive as `ctx`.
 * `persist` returns { ok:false } to count a record failed WITHOUT throwing; a throw from persist or measureRecord counts it failed too.
 * `onMeasured` fires once per persisted record and `onError` once per failed one, so each caller keeps its own accounting. Never rethrows.
 */
type MeasureDueContext = {
  now: Date;
  lastFinal: string | null;
  /** THE ONE POLICY. Given the record being measured, the pages that cannot stand behind it over ITS window. This pass used to hand
   *  measureRecord nothing at all, so a scheduled reading was taken against pages the operator was in the middle of changing. */
  excludeControls: (record: ShippedChangeRecord) => ReadonlySet<string>;
  persist: (measured: ShippedChangeRecord) => Promise<{ ok: boolean }>;
  onMeasured?: (before: ShippedChangeRecord, after: ShippedChangeRecord) => void;
  onError?: (record: ShippedChangeRecord, error: unknown) => void;
};

async function measureDueRecords(tenantId: string, due: ReadonlyArray<ShippedChangeRecord>, ctx: MeasureDueContext): Promise<{ measured: number; failed: number }> {
  let measured = 0, failed = 0;
  for (const record of due) {
    try {
      const next = await measureRecord(tenantId, record, ctx.now, ctx.lastFinal, ctx.excludeControls(record));
      if (!(await ctx.persist(next)).ok) { failed += 1; continue; }
      measured += 1; ctx.onMeasured?.(record, next);
    } catch (e) { failed += 1; ctx.onError?.(record, e); }
  }
  return { measured, failed };
}

/** Re-measure all applied Moves due for a fresh reading. Bounded, fail-soft, cache-first. Returns a full report. NEVER throws. */
export async function autoMeasureDuePass(
  tenantId: string, opts: { maxRecords?: number; now?: Date; allowPaidRankRecheck?: boolean } = {},
): Promise<AutoMeasurePassResult> {
  const now = opts.now ?? new Date(), max = opts.maxRecords ?? 15;
  const result: AutoMeasurePassResult = { considered: 0, due: 0, measured: 0, changed: 0, settled: 0, revived: 0,
    reopened: 0, crawlStamped: 0, failed: 0, outcomes: [] };
  let records: ShippedChangeRecord[] = [], lastFinal: string | null = null;
  try {
    [records, lastFinal] = await Promise.all([loadShippedChangesForTenant(tenantId), readLastFinalizedDate(tenantId)]);
  } catch (e) {
    log.warn("[auto-measure] load failed (non-blocking)", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return result;
  }
  result.considered = records.length;
  // THE REPAIRS RUN FIRST, AND THE DUE GATE IS ASKED ON THE REPAIRED ROWS, so a check re-opened or a crawl confirmed by this pass is acted on
  // by this pass instead of waiting for the next one. A repair that threw never stops the reading behind it.
  const repaired = await repairStuckRows(tenantId, records, now).catch(() => ({ records, reopened: 0, crawlStamped: 0 }));
  records = repaired.records;
  result.reopened = repaired.reopened;
  result.crawlStamped = repaired.crawlStamped;

  const due = records.filter((r) => isDueForMeasure(r, lastFinal, now)).slice(0, max);
  result.due = due.length;

  // The comparison policy is read ONCE for the whole pass and applied per record; the rich
  // per-record accounting (changed / settled / outcomes) rides onMeasured.
  const open = await openChangePaths(tenantId);
  const { measured, failed } = await measureDueRecords(tenantId, due, {
    now,
    lastFinal,
    excludeControls: (record) => new Set(contaminationFor(records, open, now, record).keys()),
    persist: async (next) => { await upsertShippedChange(next, tenantId, { invalidate: false }); return { ok: true }; }, // the loop invalidates once, below
    onMeasured: (record, next) => {
      const changed = next.verdict !== record.verdict;
      if (changed) result.changed += 1;
      if (next.verdict === "won" || next.verdict === "lost") result.settled += 1;
      // A ROW THAT CAME BACK: it was parked with nothing to compare it against, and this reading found a basis for it. The only way into
      // "measuring" from another state is that promotion, so the move itself is the count.
      if (next.measurementState === "measuring" && record.measurementState !== "measuring") result.revived += 1;
      result.outcomes.push({ id: next.id, path: next.path, actionType: next.actionType, verdictBefore: record.verdict,
        verdictAfter: next.verdict, state: outcomeStateOf(next, now), changed });
    },
    onError: (record, e) => log.warn("[auto-measure] record failed (non-blocking)", { tenantId, id: record.id, error: e instanceof Error ? e.message : String(e) }),
  });
  result.measured = measured; result.failed = failed;
  if (measured + result.reopened + result.crawlStamped > 0) await invalidateResultsSurfaceSafe(); // once for the whole pass, never once per record
  return result;
}
