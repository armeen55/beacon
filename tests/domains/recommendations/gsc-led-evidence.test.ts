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
      clicks90d: 27,
      impressions90d: 3842,
      ctr90d: 0.007,
      position90d: 8.94,
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
      clicks90d: 0,
      impressions90d: 0,
      ctr90d: 0,
      position90d: 0,
      topQueries: [],
    };
    const out = composeRowEvidenceSummary({ rec: recWith(gsc), ...baseArgs });
    expect(out).toMatch(/AI answer/);
  });

  // The LEAD floor is GSC_EVIDENCE_MIN_IMPRESSIONS_90D = 200, deliberately
  // aligned with GSC_MODERATE_IMPRESSIONS (commit #62) so a card never leads
  // with a confident four-figure Google-demand strip on a 100-199-impression
  // page that priority/confidence treat as no-demand (a confident headline
  // above a "Needs review" pill). Below 200 → fall through to the AEO/
  // structural "why".
  it("does NOT lead with the GSC stat below the 90-day impression floor (false precision)", () => {
    // 40 impressions over 90 days has no demand worth quoting to 4 sig figs;
    // the lead must fall through to the AEO/structural summary (floor = 200).
    const gsc: GscPageSignal = {
      page: "x",
      clicks90d: 1,
      impressions90d: 40,
      ctr90d: 0.025,
      position90d: 42.1,
      topQueries: [],
    };
    const out = composeRowEvidenceSummary({ rec: recWith(gsc), ...baseArgs });
    expect(out).not.toContain("Google Search");
    expect(out).not.toContain("impressions");
    expect(out).toMatch(/AI answer/);
  });

  it("does NOT lead with the GSC stat just below the floor (199 impressions)", () => {
    const gsc: GscPageSignal = {
      page: "x",
      clicks90d: 3,
      impressions90d: 199,
      ctr90d: 0.015,
      position90d: 11.0,
      topQueries: [],
    };
    const out = composeRowEvidenceSummary({ rec: recWith(gsc), ...baseArgs });
    expect(out).not.toContain("Google Search");
    expect(out).not.toContain("impressions");
  });

  it("leads with the GSC stat exactly at the 90-day impression floor (200)", () => {
    const gsc: GscPageSignal = {
      page: "x",
      clicks90d: 4,
      impressions90d: 200,
      ctr90d: 0.02,
      position90d: 12.0,
      topQueries: [],
    };
    const out = composeRowEvidenceSummary({ rec: recWith(gsc), ...baseArgs });
    expect(out).toContain("200 impressions");
    expect(out).toContain("Google Search");
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
