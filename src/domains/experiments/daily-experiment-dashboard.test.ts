import { describe, it, expect } from "vitest";

import { buildDailyExperimentDashboard, protectedControlWarning } from "./daily-experiment-dashboard";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

const NOW = new Date("2026-07-01T00:00:00Z");
const rec = (slug: string, controls: string[]): ShippedChangeRecord => ({
  id: `/iran-animals/${slug}::2026-06-30`, page: `https://iranopedia.com/iran-animals/${slug}`, path: `/iran-animals/${slug}`,
  actionType: "edit_title", before: null, after: null, shippedAt: "2026-06-30T00:00:00.000Z",
  baseline: { clicks: 0, impressions: 100, ctr: 0, position: 5, windowDays: 28 }, targetQueries: ["q"],
  controlPages: controls, windows: [], verdict: "measuring", confidence: "low", measuredAt: null,
  notes: null, verifiedLive: true, liveSourceUrl: null, recrawlRequestedAt: null, operatorVerdictOverride: null,
  createdAt: "2026-06-30T00:00:00.000Z", updatedAt: "2026-06-30T00:00:00.000Z",
});

describe("buildDailyExperimentDashboard — active batch protection", () => {
  it("surfaces the active animal batch + protected controls + checkpoint", () => {
    const ledger = [
      rec("persian-wolf", ["https://iranopedia.com/iran-animals/persian-cat", "https://iranopedia.com/iran-animals/caracal"]),
      rec("persian-leopard", ["https://iranopedia.com/iran-animals/persian-cat", "https://iranopedia.com/iran-animals/asiatic-cheetah"]),
    ];
    const dash = buildDailyExperimentDashboard({ ledger, now: NOW, availableCandidates: 52 });
    expect(dash.activeProofBatch?.experimentCount).toBe(2);
    expect(dash.activeProofBatch?.controlCount).toBe(3); // persian-cat dedup'd across the two
    expect(dash.activeProofBatch?.label).toContain("iran animals");
    expect(dash.activeProofBatch?.nextCheckpoint).toBe("2026-07-07"); // shipped 06-30 + 7d
    expect(dash.activeProofBatch?.reliableDataDate).toBe("2026-07-10"); // + 3d GSC lag
    expect(dash.protectedCounts.treatments).toBe(2);
    expect(dash.protectedCounts.controls).toBe(3);
    expect(dash.availableCandidates).toBe(52);
    expect(protectedControlWarning(dash)).toContain("3 similar pages are being used as before/after comparisons");
  });

  it("no active batch → no warning", () => {
    const dash = buildDailyExperimentDashboard({ ledger: [], now: NOW });
    expect(dash.activeProofBatch).toBeUndefined();
    expect(protectedControlWarning(dash)).toBeNull();
    expect(dash.protectedCounts.controls).toBe(0);
  });

  it("counts active reservations in protectedCounts", () => {
    const dash = buildDailyExperimentDashboard({ ledger: [], now: NOW, reservations: [
      { id: "r1", status: "reserved" } as never, { id: "r2", status: "released" } as never, { id: "r3", status: "active" } as never,
    ] });
    expect(dash.protectedCounts.reservations).toBe(2); // reserved + active, not released
  });
});
