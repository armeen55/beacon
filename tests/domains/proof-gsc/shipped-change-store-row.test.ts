import { describe, it, expect } from "vitest";

import {
  recordToRow,
  rowToRecord,
  type ShippedChangeRecord,
} from "@/domains/proof-gsc/shipped-change-store";

/**
 * audit-9 regression guard. The learn-loop "Exclude / Include again" control is
 * only reversible if `operator_verdict_override` ROUND-TRIPS its null. A prior
 * version emitted the column CONDITIONALLY (only when set); on re-include (null)
 * the column was omitted from the Supabase upsert payload, and an ON-CONFLICT
 * upsert leaves omitted columns at their existing value — so an excluded record
 * stuck at "inconclusive" forever once the migration was applied. recordToRow
 * must now emit the key UNCONDITIONALLY so null actually clears the exclusion.
 */

function makeRecord(over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "cities-2026-06-20",
    page: "https://iranopedia.com/cities",
    path: "/cities",
    actionType: "edit_title",
    before: "Cities",
    after: "List of cities in Iran",
    shippedAt: "2026-06-20T00:00:00.000Z",
    baseline: { clicks: 10, impressions: 1000, ctr: 0.01, position: 9, windowDays: 28 },
    targetQueries: ["cities in iran"],
    controlPages: ["https://iranopedia.com/provinces"],
    windows: [],
    verdict: "won",
    confidence: "medium",
    measuredAt: "2026-06-27T00:00:00.000Z",
    notes: null,
    verifiedLive: true,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null, calibrationVersion: null,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    ...over,
  };
}

describe("shipped-change-store row mapping — operator_verdict_override round-trip (audit-9)", () => {
  it("emits operator_verdict_override as a PRESENT key even when null (re-include must clear it)", () => {
    const row = recordToRow("tenant-iranopedia", makeRecord({ operatorVerdictOverride: null }));
    // The KEY must be present (not omitted) so a Supabase upsert SETs it to null
    // — omitting it would leave a previously-excluded row stuck at "inconclusive".
    expect("operator_verdict_override" in row).toBe(true);
    expect(row.operator_verdict_override).toBeNull();
  });

  it("emits the override when the operator has excluded the record", () => {
    const row = recordToRow(
      "tenant-iranopedia",
      makeRecord({ operatorVerdictOverride: "inconclusive" }),
    );
    expect(row.operator_verdict_override).toBe("inconclusive");
  });

  it("round-trips both the excluded and the re-included states", () => {
    const excluded = rowToRecord(
      recordToRow("t", makeRecord({ operatorVerdictOverride: "inconclusive" })),
    );
    expect(excluded.operatorVerdictOverride).toBe("inconclusive");

    const reincluded = rowToRecord(
      recordToRow("t", makeRecord({ operatorVerdictOverride: null })),
    );
    expect(reincluded.operatorVerdictOverride).toBeNull();
  });

  it("treats a missing/legacy column (pre-migration row) as no override", () => {
    const row = recordToRow("t", makeRecord({ operatorVerdictOverride: "inconclusive" }));
    // Simulate a pre-migration read where the column doesn't exist on the row.
    const legacy = { ...row };
    delete (legacy as { operator_verdict_override?: unknown }).operator_verdict_override;
    expect(rowToRecord(legacy).operatorVerdictOverride).toBeNull();
  });
});

describe("shipped-change-store row mapping - predeclaration contract round-trip (Lane P2, protocol 4.1)", () => {
  const predeclared: Partial<ShippedChangeRecord> = {
    judgedMetric: "ctr",
    expectedDirection: 1,
    primaryWindowDays: 28,
    windowPlan: [
      { day: 7, role: "context" },
      { day: 14, role: "context" },
      { day: 28, role: "primary" },
      { day: 56, role: "demote_only" },
      { day: 84, role: "context" },
    ],
    controlSetIds: { urls: ["https://iranopedia.com/a", "https://iranopedia.com/b"], hash: "abc123" },
    controlAlternates: ["https://iranopedia.com/c", "https://iranopedia.com/d"],
    classifierVersionPredeclared: "c4-frozen@deadbeef",
    baselineSnapshot: {
      clicks: 10,
      impressions: 1000,
      ctr: 0.01,
      position: 9,
      windowDays: 28,
      trafficTier: "medium",
    },
    predeclaredAt: "2026-06-20T00:00:00.000Z",
  };

  it("round-trips every predeclaration field losslessly", () => {
    const back = rowToRecord(recordToRow("t", makeRecord(predeclared)));
    expect(back.judgedMetric).toBe("ctr");
    expect(back.expectedDirection).toBe(1);
    expect(back.primaryWindowDays).toBe(28);
    expect(back.windowPlan).toEqual(predeclared.windowPlan);
    expect(back.controlSetIds).toEqual(predeclared.controlSetIds);
    expect(back.controlAlternates).toEqual(predeclared.controlAlternates);
    expect(back.classifierVersionPredeclared).toBe("c4-frozen@deadbeef");
    expect(back.baselineSnapshot).toEqual({
      ...predeclared.baselineSnapshot,
      dailyVariance: null,
      trendSlope: null,
      pageFamily: null,
    });
    expect(back.predeclaredAt).toBe("2026-06-20T00:00:00.000Z");
  });

  it("round-trips a -1 expected direction (a consolidation donor page)", () => {
    const back = rowToRecord(recordToRow("t", makeRecord({ expectedDirection: -1 })));
    expect(back.expectedDirection).toBe(-1);
  });

  it("emits every predeclaration column UNCONDITIONALLY, even when unset (null)", () => {
    const row = recordToRow("t", makeRecord()); // no predeclaration overrides
    for (const key of [
      "judged_metric",
      "expected_direction",
      "primary_window_days",
      "window_plan",
      "control_set_ids",
      "control_alternates",
      "classifier_version_predeclared",
      "baseline_snapshot",
      "predeclared_at",
    ] as const) {
      expect(key in row).toBe(true);
      expect((row as Record<string, unknown>)[key]).toBeNull();
    }
  });

  it("a legacy row (pre-migration, columns absent) reads back as un-predeclared", () => {
    const row = recordToRow("t", makeRecord(predeclared));
    const legacy: Record<string, unknown> = { ...row };
    for (const key of [
      "judged_metric",
      "expected_direction",
      "primary_window_days",
      "window_plan",
      "control_set_ids",
      "control_alternates",
      "classifier_version_predeclared",
      "baseline_snapshot",
      "predeclared_at",
    ]) {
      delete legacy[key];
    }
    const back = rowToRecord(legacy as unknown as Parameters<typeof rowToRecord>[0]);
    // No predeclaredAt = judged by legacy rules; every predeclaration field null.
    expect(back.predeclaredAt).toBeNull();
    expect(back.judgedMetric).toBeNull();
    expect(back.expectedDirection).toBeNull();
    expect(back.windowPlan).toBeNull();
    expect(back.controlSetIds).toBeNull();
    expect(back.baselineSnapshot).toBeNull();
  });

  it("coerces malformed persisted values to null (never a fabricated metric/direction)", () => {
    const row = recordToRow("t", makeRecord(predeclared)) as Record<string, unknown>;
    row.judged_metric = "impressions"; // not a valid ProofMetric
    row.expected_direction = 0; // not +1/-1
    row.window_plan = [{ day: 28, role: "not_a_role" }]; // bad role
    row.control_set_ids = { urls: "nope" }; // urls not an array, no hash
    row.baseline_snapshot = { clicks: 10 }; // missing required fields
    const back = rowToRecord(row as unknown as Parameters<typeof rowToRecord>[0]);
    expect(back.judgedMetric).toBeNull();
    expect(back.expectedDirection).toBeNull();
    expect(back.windowPlan).toBeNull();
    expect(back.controlSetIds).toBeNull();
    expect(back.baselineSnapshot).toBeNull();
  });
});
