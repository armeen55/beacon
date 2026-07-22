import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

/**
 * Shared ShippedChangeRecord builder for the run-measurement cluster
 * (run-measurement, run-measurement-predeclaration, run-measurement-dollar-value).
 * All three re-declared a byte-identical "singers" measuring record; this is the
 * single source. Pass overrides to shape any individual case. Files that want a
 * different default (e.g. empty targetQueries) wrap this with their own default.
 */
export function singersRecord(over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "singers::2026-05-01",
    page: "https://iranopedia.com/singers",
    path: "/singers",
    actionType: "edit_title",
    before: "old title",
    after: "new title",
    shippedAt: "2026-05-01",
    baseline: { clicks: 50, impressions: 800, ctr: 0.06, position: 12, windowDays: 28 },
    targetQueries: ["persian singers"],
    controlPages: [],
    windows: [],
    verdict: "measuring",
    confidence: "low",
    measuredAt: null,
    notes: null,
    verifiedLive: false,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null,
    calibrationVersion: null,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...over,
  };
}
