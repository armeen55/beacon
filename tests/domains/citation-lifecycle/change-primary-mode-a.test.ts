/**
 * Section 6 C6a — Mode A pure compute tests.
 *
 * Covers:
 *   • Eligibility silence — every ineligible implementation_status
 *     plus live_match_kind="wrong_page" plus missing_target_url plus
 *     needs_new_page.
 *   • Still_learning / pass / silent threshold transitions.
 *   • Raw-ratio enforcement (99/199 rounds to 50% but raw < 0.5 → silent).
 *   • observed_at INSTANT boundary (same UTC day pre-live_at excluded).
 *   • Canonicalizer edge cases delegated to the existing canonicalizer
 *     (trailing slash / www / query string normalize to the same
 *     canonical → cited_here).
 *   • Null citation_urls / null primary_recommendation handling.
 */

import { describe, it, expect } from "vitest";
import { computeChangePrimaryModeA } from "@/domains/citation-lifecycle/change-primary-mode-a";
import type { RecommendedEditRow, ImplementationStatus } from "@/domains/recommendations/recommended-edits-persistence";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

const NOW = "2026-05-15T12:00:00Z";
const LIVE_AT = "2026-04-15T14:30:00Z"; // 30 UTC days before NOW
const TARGET_URL = "https://ritzbuilders.com/services/whole-home-remodel";

function edit(
  over: Partial<RecommendedEditRow> = {},
): Pick<
  RecommendedEditRow,
  "implementation_status" | "live_at" | "live_match_kind" | "target_url"
> {
  return {
    implementation_status: "verified_live",
    live_at: LIVE_AT,
    live_match_kind: "exact",
    target_url: TARGET_URL,
    ...over,
  };
}

function obs(
  over: Partial<PromptAnswerObservation> = {},
): Pick<
  PromptAnswerObservation,
  "observed_at" | "citation_urls" | "primary_recommendation"
> {
  return {
    observed_at: "2026-04-20T10:00:00Z",
    citation_urls: [TARGET_URL],
    primary_recommendation: true,
    ...over,
  };
}

/** Build N cited-here observations; first `primaryCount` are primary. */
function citedHereObs(
  citedCount: number,
  primaryCount: number,
): Array<ReturnType<typeof obs>> {
  const out: Array<ReturnType<typeof obs>> = [];
  for (let i = 0; i < citedCount; i++) {
    out.push(
      obs({
        observed_at: `2026-04-${String(20 + (i % 10)).padStart(2, "0")}T10:00:00Z`,
        citation_urls: [TARGET_URL],
        primary_recommendation: i < primaryCount,
      }),
    );
  }
  return out;
}

describe("Section 6 C6a — Mode A eligibility silence", () => {
  const ineligibleStatuses: ImplementationStatus[] = [
    "recommended",
    "accepted",
    "needs_review",
    "not_found_after_7d",
    "dismissed",
    "wrong_page",
  ];

  for (const s of ineligibleStatuses) {
    it(`silences when implementation_status === "${s}"`, () => {
      const r = computeChangePrimaryModeA({
        recommendedEdit: edit({ implementation_status: s }),
        promptAnswerObservations: citedHereObs(20, 20),
        now: NOW,
      });
      expect(r.status).toBe("silent");
      expect(r.cited_here_count).toBe(0);
    });
  }

  it("silences when live_at is null", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit({ live_at: null }),
      promptAnswerObservations: citedHereObs(20, 20),
      now: NOW,
    });
    expect(r.status).toBe("silent");
  });

  it("silences when target_url is needs_new_page", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit({ target_url: "needs_new_page" }),
      promptAnswerObservations: citedHereObs(20, 20),
      now: NOW,
    });
    expect(r.status).toBe("silent");
  });

  it("silences when live_match_kind === 'wrong_page' even with eligible status", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit({
        implementation_status: "verified_live",
        live_match_kind: "wrong_page",
      }),
      promptAnswerObservations: citedHereObs(20, 20),
      now: NOW,
    });
    expect(r.status).toBe("silent");
  });
});

describe("Section 6 C6a — Mode A pass / still_learning / silent transitions", () => {
  it("cited_here_count=0 with days_since_live=30 → silent", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit(),
      promptAnswerObservations: [],
      now: NOW,
    });
    expect(r.status).toBe("silent");
    expect(r.cited_here_count).toBe(0);
    expect(r.primary_count).toBe(0);
    expect(r.primary_share_pct).toBeNull();
  });

  it("cited_here_count=3 with days_since_live=13 → silent (under 14d age)", () => {
    // live_at = NOW - 13 UTC days
    const liveAt13d = "2026-05-02T12:00:00Z";
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit({ live_at: liveAt13d }),
      promptAnswerObservations: [
        obs({ observed_at: "2026-05-03T10:00:00Z" }),
        obs({ observed_at: "2026-05-04T10:00:00Z" }),
        obs({ observed_at: "2026-05-05T10:00:00Z" }),
      ],
      now: NOW,
    });
    expect(r.cited_here_count).toBe(3);
    expect(r.status).toBe("silent");
  });

  it("cited_here_count=3 with days_since_live=14 → still_learning", () => {
    const liveAt14d = "2026-05-01T12:00:00Z";
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit({ live_at: liveAt14d }),
      promptAnswerObservations: [
        obs({ observed_at: "2026-05-02T10:00:00Z" }),
        obs({ observed_at: "2026-05-03T10:00:00Z" }),
        obs({ observed_at: "2026-05-04T10:00:00Z" }),
      ],
      now: NOW,
    });
    expect(r.cited_here_count).toBe(3);
    expect(r.status).toBe("still_learning");
  });

  it("cited_here_count=6 with days_since_live=14 → still_learning", () => {
    const liveAt14d = "2026-05-01T12:00:00Z";
    // Observations dated AFTER live_at (instant filter requires this).
    const obs6Post: Array<ReturnType<typeof obs>> = [];
    for (let i = 0; i < 6; i++) {
      obs6Post.push(
        obs({
          observed_at: `2026-05-${String(2 + i).padStart(2, "0")}T10:00:00Z`,
          citation_urls: [TARGET_URL],
          primary_recommendation: true,
        }),
      );
    }
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit({ live_at: liveAt14d }),
      promptAnswerObservations: obs6Post,
      now: NOW,
    });
    expect(r.cited_here_count).toBe(6);
    expect(r.status).toBe("still_learning");
  });

  it("cited_here_count=7, primary_count=4 (raw 57%) → pass", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit(),
      promptAnswerObservations: citedHereObs(7, 4),
      now: NOW,
    });
    expect(r.cited_here_count).toBe(7);
    expect(r.primary_count).toBe(4);
    expect(r.status).toBe("pass");
    expect(r.primary_share_pct).toBe(57);
  });

  it("cited_here_count=7, primary_count=3 (raw 43%) → silent (count >=7 but share <50)", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit(),
      promptAnswerObservations: citedHereObs(7, 3),
      now: NOW,
    });
    expect(r.cited_here_count).toBe(7);
    expect(r.primary_count).toBe(3);
    expect(r.status).toBe("silent");
    expect(r.primary_share_pct).toBe(43);
  });

  it("RAW-RATIO TRAP: cited=199, primary=99 → raw 49.75%, rounded pct 50, status SILENT", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit(),
      promptAnswerObservations: citedHereObs(199, 99),
      now: NOW,
    });
    expect(r.cited_here_count).toBe(199);
    expect(r.primary_count).toBe(99);
    // Display rounds to 50 — but status MUST remain silent because raw < 0.5.
    expect(r.primary_share_pct).toBe(50);
    expect(r.status).toBe("silent");
  });

  it("raw 50.0% boundary: cited=200, primary=100 → pass", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit(),
      promptAnswerObservations: citedHereObs(200, 100),
      now: NOW,
    });
    expect(r.cited_here_count).toBe(200);
    expect(r.primary_count).toBe(100);
    expect(r.primary_share_pct).toBe(50);
    expect(r.status).toBe("pass");
  });
});

describe("Section 6 C6a — Mode A observed_at INSTANT boundary", () => {
  // live_at at mid-day; same UTC date contains observations both
  // before and after.
  const liveAt = "2026-04-15T14:30:00Z";
  const ed = edit({ live_at: liveAt });

  it("excludes observation on same UTC date but BEFORE live_at instant", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: ed,
      promptAnswerObservations: [
        // 6.5 hours before live_at, same UTC date
        obs({ observed_at: "2026-04-15T08:00:00Z" }),
      ],
      now: NOW,
    });
    expect(r.cited_here_count).toBe(0);
  });

  it("includes observation exactly AT live_at instant (>= boundary)", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: ed,
      promptAnswerObservations: [
        obs({ observed_at: liveAt }),
      ],
      now: NOW,
    });
    expect(r.cited_here_count).toBe(1);
  });

  it("includes observation after live_at instant on same UTC date", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: ed,
      promptAnswerObservations: [
        // 30 minutes after live_at, same UTC date
        obs({ observed_at: "2026-04-15T15:00:00Z" }),
      ],
      now: NOW,
    });
    expect(r.cited_here_count).toBe(1);
  });
});

describe("Section 6 C6a — Mode A canonicalizer + null-data edges", () => {
  it("canonicalizes both sides: target with trailing slash, obs with www + query → cited_here", () => {
    const ed = edit({
      target_url: "https://ritzbuilders.com/services/whole-home-remodel/",
    });
    const r = computeChangePrimaryModeA({
      recommendedEdit: ed,
      promptAnswerObservations: citedHereObs(7, 4).map((o) => ({
        ...o,
        citation_urls: [
          "http://www.ritzbuilders.com/services/whole-home-remodel?utm_source=ai",
        ],
      })),
      now: NOW,
    });
    expect(r.cited_here_count).toBe(7);
    expect(r.status).toBe("pass");
  });

  it("obs.citation_urls === null → not cited_here", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit(),
      promptAnswerObservations: [
        obs({ citation_urls: null }),
        obs({ citation_urls: null }),
      ],
      now: NOW,
    });
    expect(r.cited_here_count).toBe(0);
  });

  it("obs.primary_recommendation === null → counted as not-primary in primary_count", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit(),
      promptAnswerObservations: citedHereObs(7, 0).map((o) => ({
        ...o,
        primary_recommendation: null,
      })),
      now: NOW,
    });
    expect(r.cited_here_count).toBe(7);
    expect(r.primary_count).toBe(0);
    expect(r.status).toBe("silent"); // raw 0 < 0.5
  });

  it("partially_implemented eligible row → status decided like verified_live", () => {
    const r = computeChangePrimaryModeA({
      recommendedEdit: edit({
        implementation_status: "partially_implemented",
      }),
      promptAnswerObservations: citedHereObs(7, 5),
      now: NOW,
    });
    expect(r.status).toBe("pass");
    expect(r.primary_count).toBe(5);
  });

  it("does not fuzzy-match parent URL — child target URL ≠ parent cited URL", () => {
    const ed = edit({
      target_url: "https://ritzbuilders.com/services/whole-home-remodel",
    });
    const r = computeChangePrimaryModeA({
      recommendedEdit: ed,
      promptAnswerObservations: [
        obs({ citation_urls: ["https://ritzbuilders.com/services"] }),
      ],
      now: NOW,
    });
    expect(r.cited_here_count).toBe(0);
  });
});
