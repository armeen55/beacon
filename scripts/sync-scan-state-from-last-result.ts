/**
 * One-off: align `.data/scan-state.json` with `.data/last-scan-result.json`
 * (e.g. after a CLI-only `data:scan` before orchestrator existed or state drifted).
 *
 * Run: npx tsx --require ./scripts/mock-server-only.cjs scripts/sync-scan-state-from-last-result.ts
 */
import { readLastScanResult } from "@/domains/scanning/last-scan-result";
import { writeIdleScanStateFromLastResult } from "@/domains/scanning/scan-state";

async function main() {
  const p = await readLastScanResult();
  if (!p) {
    console.error("No .data/last-scan-result.json");
    process.exit(1);
  }
  writeIdleScanStateFromLastResult("today", p);
  console.log("OK", p.exit, "pagesScanned=", p.pagesScanned);
}

main();
