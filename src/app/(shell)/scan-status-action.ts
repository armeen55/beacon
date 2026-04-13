"use server";

import {
  readScanState,
  isScanRunningAndFresh,
  type ScanStateFile,
} from "@/domains/scanning/scan-state";

/**
 * Fresh read of `.data/scan-state.json` for client polling (Phase 1 non-blocking scan).
 * Normalizes stale "running" to "failed" so the UI never shows "scanning" indefinitely.
 */
export async function getScanStatus(): Promise<ScanStateFile | null> {
  const state = readScanState();
  if (state?.phase === "running" && !isScanRunningAndFresh(state)) {
    return {
      ...state,
      phase: "failed",
      message: "Previous scan appears to have crashed — ready to retry",
    };
  }
  return state;
}
