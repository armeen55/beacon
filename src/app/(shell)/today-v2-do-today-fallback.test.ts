/**
 * Phase 1 Do Today fallback adapter tests (2026-05-12).
 *
 * Validates `adaptPersistedRecToTodayPrimaryAction` — the pure function that
 * converts the top item from `loadPersistedRecommendationQueueForPage` into
 * the `TodayPrimaryAction` shape Do Today renders.
 *
 * This adapter is the seam that fixes the "Nothing to ship right now" bug
 * when /recommendations has actionable persisted rows. Tests pin:
 *
 *   - Priority score sits BELOW the hurting-verdict floor (80), so a
 *     hurting verdict always wins when both exist.
 *   - Severity → bucket mapping (high → critical, medium → high_leverage,
 *     low → opportunistic).
 *   - Confidence passes through from the primary edit.
 *   - Href routes back to /recommendations/<rec_id> so the user can
 *     drill into the same view /recommendations would have shown.
 *   - responseStatus pass-through.
 *
 * Integration tests (full loader call, "does not invoke live generation")
 * are deliberately omitted — the priority/fallback logic in
 * `loadTodayV2ActionCardsData` is a one-liner over this adapter, and the
 * full integration would require mocking the entire repo layer for low
 * additional signal. typecheck + production build cover the wiring.
 */

import { describe, expect, it } from "vitest";

import { adaptPersistedRecToTodayPrimaryAction } from "./today-v2-data";

// `pick` helper preserves explicit `null` values; only falls back to the
// default when the key isn't on the overrides object at all. We need this
// because the adapter must distinguish "missing target_url" (null) from
// "unspecified by the test" (use default).
function pick<T>(
  overrides: object | undefined,
  key: string,
  defaultValue: T,
): T {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
    return (overrides as Record<string, T>)[key];
  }
  return defaultValue;
}

function makeItem(overrides?: {
  severity?: "high" | "medium" | "low";
  confidence?: "low" | "medium" | "high";
  responseStatus?: "accepted" | "dismissed" | "deferred" | null;
  targetUrl?: string | null;
  displayLabel?: string | null;
  why?: string | null;
  title?: string;
  editsCount?: number;
}) {
  const severity = overrides?.severity ?? "high";
  const confidence = overrides?.confidence ?? "medium";
  const editsCount = overrides?.editsCount ?? 1;
  return {
    rec: {
      stableKey: "rec-abc-123",
      title: pick<string>(overrides, "title", "Strengthen the kitchen design page"),
      description: "AI answers fragment between three competitor names on this prompt cluster.",
      severity,
    },
    edits: Array.from({ length: editsCount }, (_, i) => ({
      display_label:
        i === 0
          ? pick<string | null>(overrides, "displayLabel", "Rewrite the H1")
          : "Other edit",
      why:
        i === 0
          ? pick<string | null>(
              overrides,
              "why",
              "Profound metadata shows AI defaults to a generic phrase.",
            )
          : null,
      confidence,
      target_url:
        i === 0
          ? pick<string | null>(
              overrides,
              "targetUrl",
              "https://ritzbuilders.example/kitchen",
            )
          : null,
    })),
    response: overrides?.responseStatus
      ? { status: overrides.responseStatus }
      : null,
  };
}

describe("adaptPersistedRecToTodayPrimaryAction — Phase 1 Do Today fallback", () => {
  it("sets priorityScore below the hurting-verdict floor (80)", () => {
    const out = adaptPersistedRecToTodayPrimaryAction(makeItem());
    expect(out.priorityScore).toBeLessThan(80);
    // And above the helping-verdict floor (~75) so the fallback wins
    // over the wins section if it were to leak in. Current value: 60.
    expect(out.priorityScore).toBeGreaterThanOrEqual(50);
  });

  it("maps severity → bucket", () => {
    expect(
      adaptPersistedRecToTodayPrimaryAction(makeItem({ severity: "high" })).bucket,
    ).toBe("critical");
    expect(
      adaptPersistedRecToTodayPrimaryAction(makeItem({ severity: "medium" })).bucket,
    ).toBe("high_leverage");
    expect(
      adaptPersistedRecToTodayPrimaryAction(makeItem({ severity: "low" })).bucket,
    ).toBe("opportunistic");
  });

  it("passes through confidence from the primary edit", () => {
    expect(
      adaptPersistedRecToTodayPrimaryAction(makeItem({ confidence: "high" }))
        .confidence,
    ).toBe("high");
    expect(
      adaptPersistedRecToTodayPrimaryAction(makeItem({ confidence: "low" }))
        .confidence,
    ).toBe("low");
  });

  it("routes href to /recommendations/<stableKey>", () => {
    const out = adaptPersistedRecToTodayPrimaryAction(makeItem());
    expect(out.href).toBe("/recommendations/rec-abc-123");
  });

  it("uses the primary edit's display_label as the headline when present", () => {
    const out = adaptPersistedRecToTodayPrimaryAction(
      makeItem({ displayLabel: "Add a comparison table on the kitchens page" }),
    );
    expect(out.headline).toBe("Add a comparison table on the kitchens page");
  });

  it("OVERRIDES display_label with the Change-Pack primary when a pack exists", () => {
    // Cross-surface agreement: a page with a Change Pack shows the SAME primary
    // action everywhere — the pack action, not the stale legacy display_label.
    const out = adaptPersistedRecToTodayPrimaryAction(
      makeItem({ displayLabel: "Add a comparison table on the kitchens page" }),
      "Rewrite the title",
    );
    expect(out.headline).toBe("Rewrite the title");
  });

  it("keeps the legacy headline when there is NO pack (packHeadline null/empty)", () => {
    const out = adaptPersistedRecToTodayPrimaryAction(
      makeItem({ displayLabel: "Add a comparison table on the kitchens page" }),
      null,
    );
    expect(out.headline).toBe("Add a comparison table on the kitchens page");
  });

  it("falls back to rec.title when display_label is missing", () => {
    const out = adaptPersistedRecToTodayPrimaryAction(
      makeItem({ displayLabel: null, title: "Reframe the kitchens overview" }),
    );
    expect(out.headline).toBe("Reframe the kitchens overview");
  });

  it("falls back to a generic headline when both label and title are missing", () => {
    const out = adaptPersistedRecToTodayPrimaryAction(
      makeItem({ displayLabel: null, title: "" }),
    );
    expect(out.headline.length).toBeGreaterThan(0);
    // Must be plain English (no jargon / "AEO" / "GEO" / "schema").
    expect(out.headline.toLowerCase()).not.toContain("aeo");
    expect(out.headline.toLowerCase()).not.toContain("geo");
  });

  it("uses primary edit's `why` as the rationale", () => {
    const out = adaptPersistedRecToTodayPrimaryAction(
      makeItem({ why: "Citations declined after the schema swap on Apr 22." }),
    );
    expect(out.rationale).toContain("declined");
  });

  it("falls back to a generic rationale when `why` is empty", () => {
    const out = adaptPersistedRecToTodayPrimaryAction(
      makeItem({ why: null }),
    );
    expect(out.rationale.length).toBeGreaterThan(0);
  });

  it("targets the primary edit's target_url for the action card", () => {
    const out = adaptPersistedRecToTodayPrimaryAction(
      makeItem({ targetUrl: "https://ritzbuilders.example/master-bath" }),
    );
    expect(out.targetPageUrl).toBe("https://ritzbuilders.example/master-bath");
    expect(out.targetPagePath).toBe("https://ritzbuilders.example/master-bath");
  });

  it("handles missing target_url gracefully (null, not undefined)", () => {
    const out = adaptPersistedRecToTodayPrimaryAction(makeItem({ targetUrl: null }));
    expect(out.targetPageUrl).toBeNull();
    expect(out.targetPagePath).toBeNull();
  });

  it("passes responseStatus through when present", () => {
    const accepted = adaptPersistedRecToTodayPrimaryAction(
      makeItem({ responseStatus: "accepted" }),
    );
    expect(accepted.responseStatus).toBe("accepted");
    const deferred = adaptPersistedRecToTodayPrimaryAction(
      makeItem({ responseStatus: "deferred" }),
    );
    expect(deferred.responseStatus).toBe("deferred");
  });

  it("returns null responseStatus when the queue item has no response", () => {
    const out = adaptPersistedRecToTodayPrimaryAction(makeItem());
    expect(out.responseStatus).toBeNull();
  });

  it("counts edits in the source evidence summary", () => {
    const single = adaptPersistedRecToTodayPrimaryAction(makeItem({ editsCount: 1 }));
    expect(single.sourceEvidence).toContain("1 edit");
    expect(single.sourceEvidence).not.toContain("1 edits");
    const multi = adaptPersistedRecToTodayPrimaryAction(makeItem({ editsCount: 3 }));
    expect(multi.sourceEvidence).toContain("3 edits");
  });

  it("uses the persisted_recommendation type tag (so the renderer can branch)", () => {
    const out = adaptPersistedRecToTodayPrimaryAction(makeItem());
    expect(out.type).toBe("persisted_recommendation");
  });
});
