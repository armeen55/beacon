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
import { log } from "@/lib/logger";

const TABLE = "shipped_change_proof";
/** Bounded per run: a tenant with a huge backlog measures across several nightly runs. */
const MAX_PER_RUN = 16;

export type AutoMeasureResult = {
  tenantId: string;
  measuring: number;
  remeasured: number;
  settled: number;
  errors: number;
};

export async function measureDueForTenant(tenantId: string, now: Date = new Date()): Promise<AutoMeasureResult> {
  const out: AutoMeasureResult = { tenantId, measuring: 0, remeasured: 0, settled: 0, errors: 0 };
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

  const lastFinal = await readLastFinalizedDate(tenantId).catch(() => null);
  const activeTreatments = activeTreatmentPaths(records, now);

  // Oldest ship first: the rows closest to a window boundary settle soonest.
  const batch = [...due].sort((a, b) => Date.parse(a.shippedAt) - Date.parse(b.shippedAt)).slice(0, MAX_PER_RUN);
  for (const r of batch) {
    try {
      const measured: ShippedChangeRecord = await measureRecord(tenantId, r, now, lastFinal, activeTreatments);
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
