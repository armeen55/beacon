/**
 * auto-measure (2026-07-01, FINAL PREMIUM PLAN item 79) - the measurement loop stops waiting for
 * clicks. A scheduled pass re-measures every MEASURING shipped change against fresh GSC and
 * PERSISTS the result, so verdicts land (and the learning loop compounds) even when nobody opens
 * the app. Tenant-EXPLICIT end to end (no ambient context - safe to fan out from a cron), bounded
 * per run, fail-soft per record. Reuses the exact measurement engine the operator's manual
 * recompute uses (measureRecord), so a cron verdict and a click verdict are byte-identical.
 */
import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { measureRecord } from "./run-measurement";
import { readLastFinalizedDate } from "./gsc-window";
import { activeTreatmentPaths } from "@/domains/experiments/experiment-eligibility";
import { recordToRow, rowToRecord, type ShippedChangeRecord } from "./shipped-change-store";
import { MAX_RANK_RECHECKS_PER_PASS } from "./rank-recheck";
import { attachRecrawlClockForLedger } from "./attach-recrawl-clock";
import { gscUrlInspect } from "@/lib/connectors/gsc/client";
import { log } from "@/lib/logger";

const TABLE = "shipped_change_proof";
/** Bounded per run: a tenant with a huge backlog measures across several nightly runs. */
const MAX_PER_RUN = 16;
/** Master plan N11: bounded budget for URL-Inspection calls this pass spends
 *  confirming recrawl on rows still awaiting one, next to the existing
 *  MAX_RANK_RECHECKS_PER_PASS budget above - same "documented constant next to
 *  the logic it bounds" posture as rank-recheck.ts. gscUrlInspect itself is
 *  additionally protected by its own 24h Supabase cache TTL, so this only
 *  ever spends quota on a genuinely stale/missing inspection row. */
export const MAX_RECRAWL_INSPECTIONS_PER_PASS = 8;

export type AutoMeasureResult = {
  tenantId: string;
  measuring: number;
  remeasured: number;
  settled: number;
  errors: number;
  /** Master plan N11: how many URL-Inspection calls this pass spent trying to
   *  confirm recrawl on rows still awaiting one. 0 when BEACON_GSC_SITE_URL is
   *  unset (operator-substrate posture, same gate load-gsc-signal.ts uses) or
   *  every due row already had a confirmed recrawl / a fresh cache entry. */
  recrawlInspections: number;
};

/**
 * Master plan N11 (2026-07-02): prioritize URL-Inspection calls at the pages
 * that actually need one - a shipped change still in "measuring" whose recrawl
 * clock has not been confirmed yet. Reuses the SAME gscUrlInspect client (and
 * its own 24h Supabase cache) the render-time indexability budget already
 * calls; this just decides WHICH urls are worth spending the nightly pass's
 * bounded budget on, mirroring runRankRecheck's role next to it. Fail-soft:
 * BEACON_GSC_SITE_URL unset (operator-substrate gate, same as
 * load-gsc-signal.ts) or any inspection error means 0 spent, never a thrown
 * error into the measure pass.
 */
async function prioritizeRecrawlInspections(
  tenantId: string,
  due: ShippedChangeRecord[],
  now: Date,
): Promise<number> {
  const siteUrl = process.env.BEACON_GSC_SITE_URL?.trim();
  if (!siteUrl) return 0;

  const rows = due.map((r) => ({
    id: r.id,
    page: r.page,
    shippedAt: r.shippedAt,
    actionType: r.actionType,
    after: r.after,
  }));
  let clockById: Map<string, { recrawlConfirmedAt: string | null }>;
  try {
    clockById = await attachRecrawlClockForLedger(tenantId, rows, now);
  } catch {
    // A genuine read failure is NOT the same as "checked, still pending" - an
    // empty map here would make clockById.get(r.id) undefined for every row,
    // and `undefined?.recrawlConfirmedAt == null` reads as true, silently
    // treating every row as pending and burning the whole budget on a read
    // that never happened. Skip this pass's inspections entirely instead.
    return 0;
  }

  // Oldest-shipped-first, same ordering the measure batch below uses, so the
  // rows closest to needing a real verdict get the inspection budget first.
  // Only a row the attach call actually returned AND marked unconfirmed
  // qualifies - a row missing from the map (e.g. its own page lookup failed)
  // is treated as unknown, never as pending.
  const pending = due
    .filter((r) => clockById.has(r.id) && clockById.get(r.id)!.recrawlConfirmedAt == null)
    .sort((a, b) => Date.parse(a.shippedAt) - Date.parse(b.shippedAt))
    .slice(0, MAX_RECRAWL_INSPECTIONS_PER_PASS);

  let spent = 0;
  for (const r of pending) {
    try {
      const result = await gscUrlInspect({ tenantId, siteUrl, inspectionUrl: r.page, now });
      if (result != null) spent += 1;
    } catch {
      // fail-soft: an inspection hiccup never blocks the measure pass below.
    }
  }
  return spent;
}

export async function measureDueForTenant(tenantId: string, now: Date = new Date()): Promise<AutoMeasureResult> {
  const out: AutoMeasureResult = { tenantId, measuring: 0, remeasured: 0, settled: 0, errors: 0, recrawlInspections: 0 };
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from(TABLE).select("*").eq("tenant_id", tenantId);
  if (error != null || !data) {
    if (error) log.warn("[auto-measure] read failed", { tenantId, error: error.message });
    return out;
  }
  const records = (data as Parameters<typeof rowToRecord>[0][]).map(rowToRecord);
  const due = records.filter((r) => r.verdict === "measuring");
  out.measuring = due.length;
  if (due.length === 0) return out;

  // Master plan N11: spend the bounded inspection budget BEFORE measuring, so
  // any recrawl confirmed just now is reflected the next time a read path
  // calls attachRecrawlClockForLedger (this pass itself never reads its own
  // clock output back - the GSC verdict math below is unrelated and untouched).
  out.recrawlInspections = await prioritizeRecrawlInspections(tenantId, due, now).catch(() => 0);

  const lastFinal = await readLastFinalizedDate(tenantId).catch(() => null);
  const activeTreatments = activeTreatmentPaths(records, now);

  // Oldest ship first: the rows closest to a window boundary settle soonest.
  const batch = [...due].sort((a, b) => Date.parse(a.shippedAt) - Date.parse(b.shippedAt)).slice(0, MAX_PER_RUN);
  // Item 19: bounded live-SERP rank re-checks for this WHOLE pass (not per
  // record) - a tenant with 16 due records still spends at most
  // MAX_RANK_RECHECKS_PER_PASS x ~$0.003 here, never 16x.
  let rankRechecksUsed = 0;
  for (const r of batch) {
    try {
      const allowRankRecheck = rankRechecksUsed < MAX_RANK_RECHECKS_PER_PASS;
      const measured: ShippedChangeRecord = await measureRecord(
        tenantId,
        r,
        now,
        lastFinal,
        activeTreatments,
        allowRankRecheck,
      );
      if (allowRankRecheck && measured.rankOutcome != null) rankRechecksUsed += 1;
      const up = await admin.from(TABLE).upsert(recordToRow(tenantId, measured), { onConflict: "tenant_id,id" });
      if (up.error != null) {
        out.errors += 1;
        continue;
      }
      out.remeasured += 1;
      if (measured.verdict !== "measuring") out.settled += 1;
    } catch {
      out.errors += 1;
    }
  }
  if (out.settled > 0) {
    log.info("[auto-measure] verdicts settled", { tenantId, settled: out.settled, remeasured: out.remeasured });
  }
  return out;
}

/** Test-only export, mirrors the __testing convention used elsewhere in this
 *  domain (e.g. gsc/client.ts) - lets the N11 prioritization logic be pinned
 *  in isolation without spinning up the full measure pass. */
export const __testing = { prioritizeRecrawlInspections };
