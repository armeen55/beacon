"use server";

import { readScanState, type ScanStateFile } from "@/domains/scanning/scan-state";

/**
 * Fresh read of `.data/scan-state.json` for client polling (Phase 1 non-blocking scan).
 */
export async function getScanStatus(): Promise<ScanStateFile | null> {
  return readScanState();
}
