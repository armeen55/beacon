"use client";

import { ScanStatusBanner } from "@/components/today/scan-status-banner";

export type TodayScanStripProps = {
  /** When true, daily scan is due — `ScanStatusBanner` calls `triggerScan` on mount. */
  shouldTriggerScan: boolean;
  /** Number of pending content-type findings awaiting review. */
  pendingChangesCount?: number;
};

/** Thin Today mount for `ScanStatusBanner` (Phase 4-1). */
export function TodayScanStrip({ shouldTriggerScan, pendingChangesCount = 0 }: TodayScanStripProps) {
  return (
    <>
      {/* ── Scan status (non-blocking, client-driven) ── */}
      <ScanStatusBanner
        shouldTriggerScan={shouldTriggerScan}
        pendingChangesCount={pendingChangesCount}
      />
    </>
  );
}
