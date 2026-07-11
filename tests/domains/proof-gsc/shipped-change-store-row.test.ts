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
