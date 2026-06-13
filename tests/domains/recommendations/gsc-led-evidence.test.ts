/**
 * 2026-06-13 — product pivot: recommendation cards lead with first-party
 * Google Search demand (GSC) when present, not AEO citations ("0 AI answers").
 * Pins composeRowEvidenceSummary's GSC-led branch + the AEO fallback.
 */

import { describe, it, expect } from "vitest";

import {
  composeRowEvidenceSummary,
  priorityForRow,
} from "@/domains/recommendations/recommendation-action-rows";
import type { LiveRecQueueItem } from "@/domains/recommendations/load-queue";
import type { GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";

function recWith(gsc: GscPageSignal | null): LiveRecQueueItem {
  return {
    gscSignal: gsc,
    evidence: {
      observationCount: 40,
      promptCount: 6,
      brandPrimaryPromptCount: 0,
      primaryCompetitors: [],
      dominantCompetitors: ["Tehran Bureau"],
    },
  } as unknown as LiveRecQueueItem;
}

const baseArgs = {
  action: "edit_meta" as never,
  hasResolvedTarget: true,
  resolvedUrl: "https://www.iranopedia.com/persian-kabobs/koobideh-kabob",
  targetLabel: "Koobideh Kabob page",
  topicTag: null,
  geoTag: null,
};

describe("composeRowEvidenceSummary — GSC-led pivot", () => {
  it("leads with GSC demand (clicks/impressions/CTR/position) when a signal is present", () => {
    const gsc: GscPageSignal = {
      page: "https://www.iranopedia.com/persian-kabobs/koobideh-kabob",
      clicks28d: 27,
      impressions28d: 3842,
      ctr28d: 0.007,
      position28d: 8.94,
      topQueries: [],
    };
    const out = composeRowEvidenceSummary({ rec: recWith(gsc), ...baseArgs });
    expect(out).toContain("27 clicks");
    expect(out).toContain("impressions");
    expect(out).toContain("0.7% CTR");
    expect(out).toContain("avg position 8.9");
    expect(out).toContain("Google Search");
    expect(out).not.toContain("AI answer"); // AEO is NOT the lead anymore
  });

  it("falls back to the AEO summary when the page has no GSC data", () => {
    const out = composeRowEvidenceSummary({ rec: recWith(null), ...baseArgs });
    expect(out).toMatch(/AI answer/);
    expect(out).not.toContain("impressions");
  });

  it("ignores a zero-impression GSC signal (no demand → AEO lead)", () => {
    const gsc: GscPageSignal = {
      page: "x",
      clicks28d: 0,
      impressions28d: 0,
      ctr28d: 0,
      position28d: 0,
      topQueries: [],
    };
    const out = composeRowEvidenceSummary({ rec: recWith(gsc), ...baseArgs });
    expect(out).toMatch(/AI answer/);
  });
});

describe("priorityForRow — GSC demand floors (pivot)", () => {
  // A base row that the AEO rubric would rank Low (thin everything).
  const thin = {
    engineConfidence: "low" as const,
    severity: "low" as const,
    affectedPromptCount: 1,
    observationCount: 2,
    brandPrimaryShare: 0,
    needsHumanReview: false,
    hasExactEdit: false,
  };

  it("heavy impressions → High, even on otherwise-thin AEO", () => {
    expect(priorityForRow({ ...thin, gscImpressions: 1500 })).toBe("high");
  });

  it("striking-distance (pos 5–20) + meaningful impressions → High", () => {
    expect(priorityForRow({ ...thin, gscImpressions: 500, gscPosition: 8 })).toBe("high");
    // outside striking distance (already page 1) → not auto-High on that rule
    expect(priorityForRow({ ...thin, gscImpressions: 500, gscPosition: 2 })).not.toBe("high");
  });

  it("moderate impressions floor the row to Medium (never thin/Low)", () => {
    expect(priorityForRow({ ...thin, gscImpressions: 250 })).toBe("medium");
  });

  it("no GSC signal → unchanged AEO-based priority (thin → Low)", () => {
    expect(priorityForRow(thin)).toBe("low");
  });
});
