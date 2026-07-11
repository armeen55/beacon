/**
 * Step 2: freeze the C4 candidate. Writes c4-frozen-<runId>.json holding
 * every rule, band, transform, gate order and window plan, and records its
 * SHA-256 in the freeze log BEFORE any placebo read happens (protocol L1).
 * Floors are uncalibrated placeholders at this point; step 5 fills them and
 * step 7 locks the final artifact.
 */

import { buildFrozenConfig } from "@/domains/proof-gsc/validation/frozen-config";
import { RUN_ID, appendFreezeLog, frozenConfigPath, sha256OfFile, writeJson } from "./lib";

const VERSION = `c4-iranopedia-${RUN_ID}`;

async function main(): Promise<void> {
  const config = buildFrozenConfig({ runId: RUN_ID, version: VERSION });
  const path = frozenConfigPath();
  writeJson(path, config);
  const hash = sha256OfFile(path);
  appendFreezeLog({
    step: "step2",
    at: new Date().toISOString(),
    file: path,
    sha256: hash,
    note: "candidate rules frozen BEFORE any placebo read; floors are uncalibrated placeholders pending step 5",
  });
  console.log(`[step2] frozen ${VERSION}`);
  console.log(`  file   ${path}`);
  console.log(`  sha256 ${hash}`);
}

main().catch((e) => {
  console.error("[step2] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
