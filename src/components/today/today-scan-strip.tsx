"use client";

import { ScanStatusBanner } from "@/components/today/scan-status-banner";

export type TodayScanStripProps = {
  /** When true, daily scan is due — `ScanStatusBanner` calls `triggerScan` on mount. */
  shouldTriggerScan: boolean;
};

/** Thin Today mount for `ScanStatusBanner` (Phase 4-1). */
export function TodayScanStrip({ shouldTriggerScan }: TodayScanStripProps) {
  return (
    <>
      {/* ── Scan status (non-blocking, client-driven) ── */}
      <ScanStatusBanner shouldTriggerScan={shouldTriggerScan} />
    </>
  );
}
