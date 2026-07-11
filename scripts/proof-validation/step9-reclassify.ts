/**
 * Step 9: COMPUTED-ONLY ledger reclassification. Runs the LOCKED C4 on all
 * ledger rows (decided, measuring, overridden, unverified) and produces the
 * old-to-new transition matrix with exactly one primary reason code per
 * changed row. NOTHING IS PERSISTED to any store; output files only. The
 * operator reviews before any verdict changes anywhere.
 */

import { normalizePathKey } from "@/domains/proof-gsc/validation/series";
import { reclassifyLedgerRow, type LedgerRowLite } from "@/domains/proof-gsc/validation/ledger-reclassify";
import type { ProofWindowResult } from "@/domains/proof-gsc/measure";
import {
  RUN_ID,
  evaluationTouchGuard,
  loadFrozenConfig,
  loadLedgerRows,
  loadManifest,
  loadSnapshotIndex,
  loadUnits,
  stepOutputPath,
  writeJson,
  type RawLedgerRow,
} from "./lib";

function verifyBits(vs: unknown): { canonical: string | null; lastAttempt: string | null } {
  if (vs == null || typeof vs !== "object") return { canonical: null, lastAttempt: null };
  const o = vs as Record<string, unknown>;
  if ("canonical" in o) {
    const canonical = (o.canonical as { outcome?: string } | null)?.outcome ?? null;
    const lastAttempt = (o.lastAttempt as { state?: string } | null)?.state ?? null;
    return { canonical, lastAttempt };
  }
  const flat = o as { outcome?: string };
  if (flat.outcome === "verified_live" || flat.outcome === "verified_live_modified") {
    return { canonical: flat.outcome, lastAttempt: null };
  }
  return { canonical: null, lastAttempt: flat.outcome ?? null };
}

export function toLite(r: RawLedgerRow): LedgerRowLite {
  const { canonical, lastAttempt } = verifyBits(r.verify_state);
  return {
    id: r.id,
    path: normalizePathKey(r.path || r.page),
    page: r.page,
    actionType: r.action_type,
    shippedAt: r.shipped_at,
    verdict: r.verdict,
    confidence: r.confidence,
    controlPages: (r.control_pages ?? []).map(normalizePathKey),
    donorPoolKept: (r.control_donor_pool ?? [])
      .filter((d) => d.verdict === "kept")
      .map((d) => normalizePathKey(d.url)),
    baseline: { clicks: r.baseline?.clicks ?? 0, impressions: r.baseline?.impressions ?? 0 },
    windows: (r.windows ?? []) as ProofWindowResult[],
    verifiedLive: r.verified_live === true,
    canonicalVerifyOutcome: canonical,
    lastVerifyAttemptState: lastAttempt,
    operatorVerdictOverride: r.operator_verdict_override,
  };
}

async function main(): Promise<void> {
  evaluationTouchGuard("step9");
  const { index } = loadSnapshotIndex();
  const { config, sha256 } = loadFrozenConfig();
  const manifest = loadManifest();
  const ledger = loadLedgerRows();
  const step3 = loadUnits();
  const rows = ledger.map(toLite);
  const treatedPaths = new Set(rows.map((r) => r.path));
  const nullPool = [...step3.poolPaths.calibration, ...step3.poolPaths.evaluation];

  const results = rows.map((row) =>
    reclassifyLedgerRow({
      index,
      row,
      config,
      lastFinalizedDate: manifest.maxDate,
      treatedPaths,
      nullPoolPaths: nullPool,
    }),
  );

  const matrix: Record<string, Record<string, number>> = {};
  for (const r of results) {
    matrix[r.storedVerdict] = matrix[r.storedVerdict] ?? {};
    matrix[r.storedVerdict]![r.bindingVerdict] = (matrix[r.storedVerdict]![r.bindingVerdict] ?? 0) + 1;
  }
  const reasons: Record<string, number> = {};
  for (const r of results) {
    if (r.primaryReason) reasons[r.primaryReason] = (reasons[r.primaryReason] ?? 0) + 1;
  }

  const out = {
    runId: RUN_ID,
    lockedConfigSha256: sha256,
    label: "COMPUTED ONLY: no verdict was persisted anywhere; operator review gates any change",
    finalizedWatermark: manifest.maxDate,
    transitionMatrix: matrix,
    primaryReasonCounts: reasons,
    verificationCounts: results.reduce<Record<string, number>>((acc, r) => {
      acc[r.verification] = (acc[r.verification] ?? 0) + 1;
      return acc;
    }, {}),
    rows: results,
  };
  writeJson(stepOutputPath("step9-reclassification"), out);
  console.log(`[step9] reclassified ${results.length} ledger rows (computed only)`);
  console.log(`  transitions ${JSON.stringify(matrix)}`);
  console.log(`  reasons     ${JSON.stringify(reasons)}`);
}

// Only run as an entrypoint: step10 imports toLite from this module and a
// bare main() call would re-execute the whole step on import.
if (process.argv[1]?.includes("step9-reclassify")) {
  main().catch((e) => {
    console.error("[step9] FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
