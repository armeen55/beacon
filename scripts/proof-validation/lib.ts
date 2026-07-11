/**
 * Shared plumbing for the proof-validation harness scripts (Lane P3).
 *
 * Artifacts live OUTSIDE the repo, under the directory named by the
 * PROOFVAL_DIR environment variable (the operator scratchpad). Nothing here
 * writes to Supabase or to any repo path; the harness is read-only against
 * production and file-only for outputs.
 *
 * Run with: npx tsx scripts/proof-validation/stepN-*.ts
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSeriesIndex, type SeriesIndex } from "@/domains/proof-gsc/validation/series";
import type { SnapshotDailyRow } from "@/domains/proof-gsc/validation/types";
import type { C4FrozenConfig } from "@/domains/proof-gsc/validation/types";

export const TENANT_ID = "tenant-iranopedia";
export const RUN_ID = process.env.PROOFVAL_RUN_ID ?? "pv-2026-07-11-a";

export function proofvalDir(): string {
  const dir = process.env.PROOFVAL_DIR;
  if (!dir) {
    throw new Error(
      "PROOFVAL_DIR is not set. Point it at the scratchpad proofval directory before running any harness step.",
    );
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function snapshotDir(): string {
  const dir = join(proofvalDir(), `snapshot-${RUN_ID}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 1));
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export type SnapshotManifest = {
  runId: string;
  tenantId: string;
  createdAt: string;
  minDate: string;
  maxDate: string;
  pageDailyRowCount: number;
  totalsRowCount: number;
  ledgerRowCount: number;
  files: Record<string, { sha256: string }>;
};

export type TotalsRow = { date: string; clicks: number; impressions: number };

/** Raw ledger row as snapshotted (subset of shipped_change_proof columns). */
export type RawLedgerRow = {
  id: string;
  page: string;
  path: string;
  action_type: string;
  shipped_at: string;
  verdict: string;
  confidence: string;
  baseline: { clicks: number; impressions: number; windowDays?: number };
  control_pages: string[];
  windows: unknown[];
  verified_live: boolean;
  live_source_url: string | null;
  operator_verdict_override: string | null;
  control_donor_pool: Array<{ url: string; verdict: string }> | null;
  verify_state: unknown;
  measured_at: string | null;
  calibration_version: string | null;
};

export function loadManifest(): SnapshotManifest {
  return readJson<SnapshotManifest>(join(snapshotDir(), "manifest.json"));
}

export function loadSnapshotIndex(): { index: SeriesIndex; manifest: SnapshotManifest } {
  const manifest = loadManifest();
  const rows = readJson<SnapshotDailyRow[]>(join(snapshotDir(), "pages-daily.json"));
  const index = buildSeriesIndex(rows, manifest.minDate, manifest.maxDate);
  return { index, manifest };
}

export function loadTotals(): TotalsRow[] {
  return readJson<TotalsRow[]>(join(snapshotDir(), "totals-daily.json"));
}

export function loadLedgerRows(): RawLedgerRow[] {
  return readJson<RawLedgerRow[]>(join(snapshotDir(), "ledger.json"));
}

export function frozenConfigPath(): string {
  return join(proofvalDir(), `c4-frozen-${RUN_ID}.json`);
}

export function loadFrozenConfig(): { config: C4FrozenConfig; sha256: string } {
  const path = frozenConfigPath();
  return { config: readJson<C4FrozenConfig>(path), sha256: sha256OfFile(path) };
}

export type FreezeLogEntry = { step: string; at: string; file: string; sha256: string; note: string };

/** Append-only freeze log: records every artifact hash the moment it is
 *  produced, so the "hash recorded BEFORE any placebo read" ordering is
 *  auditable (runbook steps 2 and 7). */
export function appendFreezeLog(entry: FreezeLogEntry): void {
  const path = join(proofvalDir(), `freeze-log-${RUN_ID}.json`);
  const log = existsSync(path) ? readJson<FreezeLogEntry[]>(path) : [];
  log.push(entry);
  writeJson(path, log);
}

export function stepOutputPath(step: string): string {
  return join(proofvalDir(), `${step}-${RUN_ID}.json`);
}

export type Step3Output = {
  runId: string;
  configSha256: string;
  shipDates: { calibration: string[]; evaluation: string[] };
  shocks: Array<{ id: string; start: string; end: string; kind: string; label: string }>;
  meta: Record<string, unknown>;
  poolPaths: { calibration: string[]; evaluation: string[] };
  units: import("@/domains/proof-gsc/validation/types").PlaceboUnit[];
};

export function loadUnits(): Step3Output {
  return readJson<Step3Output>(stepOutputPath("step3-units"));
}

/** Guard used by steps 8 to 10: the evaluation set may be touched exactly
 *  once (protocol 2.3 rule 5). The lock file is created when step 8 starts;
 *  a second run of step 8 refuses. */
export function evaluationTouchGuard(step: string): void {
  const path = join(proofvalDir(), `evaluation-touched-${RUN_ID}.json`);
  if (step === "step8") {
    if (existsSync(path)) {
      throw new Error(
        "EVALUATION ALREADY TOUCHED: step 8 ran before. Per protocol step 12 the evaluation set is spent; a rerun requires a NEW evaluation set and a new run id.",
      );
    }
    writeJson(path, { touchedAt: new Date().toISOString(), by: step });
    return;
  }
  if (!existsSync(path)) {
    throw new Error(`${step} requires step 8 to have run (single evaluation pass, steps 8 to 10 together).`);
  }
}
