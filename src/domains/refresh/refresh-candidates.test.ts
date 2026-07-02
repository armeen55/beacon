import { describe, expect, it } from "vitest";
import { findRefreshCandidates, MAX_REFRESH_CANDIDATES_PER_NIGHT } from "./refresh-candidates";
import type { RefreshBrief } from "./refresh-brief";
import type { ExperimentEligibility } from "@/domains/experiments/experiment-eligibility";

const CLEAN: ExperimentEligibility = { eligible: true, reason: "clean" };
const BLOCKED: ExperimentEligibility = { eligible: false, reason: "same_family_measuring" };

function brief(page: string, opts: {
  clicksLostQuarter?: number;
  winnerSection?: RefreshBrief["winnerSection"];
  newQueryGaps?: RefreshBrief["newQueryGaps"];
  losingQueries?: RefreshBrief["losingQueries"];
} = {}): RefreshBrief {
  const lost = opts.clicksLostQuarter ?? 180;
  return {
    page,
    rank: {
      page,
      clicksLostPerMonth: Number((lost / 3).toFixed(1)),
      clicksLostQuarter: lost,
      positionDrift: 1.5,
      priorClicks: 480,
      currentClicks: 480 - lost,
      priorPosition: 4.2,
      currentPosition: 5.7,
      currentImpressions: 7000,
      sentence: "This page earned 160 clicks a month last quarter and is fading, down about 60 clicks a month since. A refresh usually brings these back.",
    },
    newQueryGaps: opts.newQueryGaps ?? [{ query: "persian cat price", impressions: 400 }],
    losingQueries: opts.losingQueries ?? [],
    winnerSection: opts.winnerSection ?? null,
    hasEvidence: true,
  };
}

function eligAll(pages: string[], verdict: ExperimentEligibility = CLEAN): Map<string, ExperimentEligibility> {
  return new Map(pages.map((p) => [p.replace(/^https?:\/\/[^/]+/, "") || "/", verdict]));
}

describe("findRefreshCandidates", () => {
  it("emits a candidate for an eligible fading page with a concrete section target", () => {
    const q = [brief("/persian-cats")];
    const out = findRefreshCandidates({ queue: q, eligibility: eligAll(["/persian-cats"]) });
    expect(out).toHaveLength(1);
    expect(out[0]!.page).toBe("/persian-cats");
    expect(out[0]!.proposedHeading).toBe("Persian Cat Price");
    expect(out[0]!.targetQuery).toBe("persian cat price");
    expect(out[0]!.whyNow).toContain("fading");
    expect(out[0]!.whyNow).toContain("persian cat price");
  });

  it("caps at MAX_REFRESH_CANDIDATES_PER_NIGHT, decayed-winners-first (queue order preserved)", () => {
    const q = [brief("/worst"), brief("/second"), brief("/third")];
    const out = findRefreshCandidates({ queue: q, eligibility: eligAll(["/worst", "/second", "/third"]) });
    expect(MAX_REFRESH_CANDIDATES_PER_NIGHT).toBe(2);
    expect(out.map((c) => c.page)).toEqual(["/worst", "/second"]);
  });

  it("skips an ineligible page (mid-measurement) and takes the next in queue order", () => {
    const q = [brief("/blocked"), brief("/clean")];
    const eligibility = new Map<string, ExperimentEligibility>([
      ["/blocked", BLOCKED],
      ["/clean", CLEAN],
    ]);
    const out = findRefreshCandidates({ queue: q, eligibility });
    expect(out.map((c) => c.page)).toEqual(["/clean"]);
  });

  it("skips a page with NO eligibility entry at all (never assumes clean)", () => {
    const out = findRefreshCandidates({ queue: [brief("/unknown")], eligibility: new Map() });
    expect(out).toEqual([]);
  });

  it("skips a page that already has a candidate tonight (one card per page)", () => {
    const out = findRefreshCandidates({
      queue: [brief("/already")],
      eligibility: eligAll(["/already"]),
      alreadyProposedPaths: new Set(["/already"]),
    });
    expect(out).toEqual([]);
  });

  it("honest skip: a fading page with no concrete section target emits nothing", () => {
    const q = [brief("/vague", { newQueryGaps: [], losingQueries: [{ query: "old query", priorClicks: 50, recentClicks: 10, dropPct: 80 }] })];
    const out = findRefreshCandidates({ queue: q, eligibility: eligAll(["/vague"]) });
    expect(out).toEqual([]);
  });

  it("prefers the winner's missing section over a raw query gap as the heading", () => {
    const q = [brief("/steal", {
      winnerSection: { domain: "rival.com", sectionTitle: "2026 Pricing Guide", freshnessDate: "2026-02-01" },
      newQueryGaps: [{ query: "persian cat price", impressions: 400 }],
    })];
    const out = findRefreshCandidates({ queue: q, eligibility: eligAll(["/steal"]) });
    expect(out[0]!.proposedHeading).toBe("2026 Pricing Guide");
    expect(out[0]!.whyNow).toContain("rival.com");
    // The target query stays the searched term (what the section is FOR), not the heading.
    expect(out[0]!.targetQuery).toBe("persian cat price");
  });

  it("carries the full brief sentences and the clicks-lost forecast", () => {
    const q = [brief("/full", {
      winnerSection: { domain: "rival.com", sectionTitle: "Pricing", freshnessDate: null },
      losingQueries: [{ query: "persian cat breeders", priorClicks: 200, recentClicks: 80, dropPct: 60 }],
    })];
    const out = findRefreshCandidates({ queue: q, eligibility: eligAll(["/full"]) });
    expect(out[0]!.briefSentences.length).toBe(3);
    expect(out[0]!.clicksLostPerMonth).toBeCloseTo(60, 1);
  });

  it("never emits an em or en dash in whyNow or brief sentences", () => {
    const q = [brief("/dash", { winnerSection: { domain: "rival.com", sectionTitle: "Pricing", freshnessDate: "2026-01-01" } })];
    const out = findRefreshCandidates({ queue: q, eligibility: eligAll(["/dash"]) });
    expect(out[0]!.whyNow).not.toMatch(/[–—]/);
    for (const s of out[0]!.briefSentences) expect(s).not.toMatch(/[–—]/);
  });
});
