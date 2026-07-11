/**
 * Step 7: LOCK. Writes the final c4-frozen-<runId>.json with the calibrated
 * floors from step 5 and records the final SHA-256 in the freeze log. From
 * this moment no rule, floor, or set membership may change; any change
 * returns the runbook to step 2 with a NEW evaluation set.
 */

import type { C4Floors } from "@/domains/proof-gsc/validation/types";
import {
  RUN_ID,
  appendFreezeLog,
  frozenConfigPath,
  loadFrozenConfig,
  readJson,
  sha256OfFile,
  stepOutputPath,
  writeJson,
} from "./lib";

async function main(): Promise<void> {
  const { config } = loadFrozenConfig();
  const step5 = readJson<{ floors: C4Floors }>(stepOutputPath("step5-floors"));
  const locked = { ...config, floors: step5.floors };
  const path = frozenConfigPath();
  writeJson(path, locked);
  const hash = sha256OfFile(path);
  appendFreezeLog({
    step: "step7",
    at: new Date().toISOString(),
    file: path,
    sha256: hash,
    note: "FINAL LOCK: calibrated floors written; no rule, floor, or set membership may change after this hash",
  });
  console.log(`[step7] LOCKED ${locked.version}`);
  console.log(`  sha256 ${hash}`);
}

main().catch((e) => {
  console.error("[step7] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
