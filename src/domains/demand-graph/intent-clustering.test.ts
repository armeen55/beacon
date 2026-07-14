/**
 * intent-clustering.test.ts (operator spec 2026-07-09, D-27..D-33) - pins the New
 * Pages board's deterministic clustering / floor / ranking / label layer that killed
 * the real operator failures: separate pages for director/directors + kashan rug/rugs,
 * an alphabetical board, and the meaningless Hot/Warm/Emerging labels.
 */
import { describe, it, expect } from "vitest";
import {
  clusterNewPageCandidates,
  applyNewPageFloor,
  rankNewPageClusters,
  deriveWinnability,
  deriveNewPageSignal,
  detectTrendSpike,
  detectSeasonalWindow,
  singularizeToken,
  labelTokens,
  type NewPageClusterCandidate,
} from "./intent-clustering";

const cand = (over: Partial<NewPageClusterCandidate> & { id: string; label: string }): NewPageClusterCandidate => ({
  volume: null,
  ...over,
});

describe("D-27 singularization + clustering", () => {
  it("singularizes with the operator's simple rules (rug/director/company; keeps ss + short)", () => {
    expect(singularizeToken("rugs")).toBe("rug");
    expect(singularizeToken("directors")).toBe("director");
    expect(singularizeToken("companies")).toBe("company");
    expect(singularizeToken("glass")).toBe("glass"); // trailing ss preserved
    expect(singularizeToken("bus")).toBe("bus"); // len 3, not stripped
  });

  it("merges director / directors into ONE cluster (singularization)", () => {
    const out = clusterNewPageCandidates([
      cand({ id: "a", label: "Iranian director", volume: 200 }),
      cand({ id: "b", label: "Iranian directors", volume: 800 }),
    ]);
    expect(out).toHaveLength(1);
    // Canonical is the higher-volume variant's label.
    expect(out[0].label).toBe("Iranian directors");
    expect(out[0].variants.map((v) => v.id).sort()).toEqual(["a", "b"]);
  });

  it("merges kashan rug / kashan rugs (the reported cannibalization pair)", () => {
    const out = clusterNewPageCandidates([
      cand({ id: "r1", label: "Kashan rug", volume: 300 }),
      cand({ id: "r2", label: "Kashan rugs", volume: 500 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].variants).toHaveLength(2);
  });

  it("subset merge collapses a bare head noun into the specific higher-volume page", () => {
    const out = clusterNewPageCandidates([
      cand({ id: "bare", label: "Rugs", volume: 100 }),
      cand({ id: "spec", label: "Kashan rug", volume: 900 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("Kashan rug"); // larger volume wins
  });

  it("does NOT merge unrelated topics (tehran vs isfahan)", () => {
    const out = clusterNewPageCandidates([
      cand({ id: "t", label: "Tehran", volume: 5000 }),
      cand({ id: "i", label: "Isfahan", volume: 4000 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("does NOT merge different head nouns even when a token is shared (director vs filmmaker)", () => {
    // The spec forbids hardcoding director=filmmaker; these stay separate.
    const out = clusterNewPageCandidates([
      cand({ id: "d", label: "Iranian director", volume: 200 }),
      cand({ id: "f", label: "Iranian filmmaker", volume: 200 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("merges obvious hub siblings that would cannibalize each other", () => {
    const wedding = clusterNewPageCandidates([
      cand({ id: "w1", label: "Lifestyle Culture Wedding Traditions Iran", volume: 500 }),
      cand({ id: "w2", label: "Persian Wedding", volume: 900 }),
    ]);
    expect(wedding).toHaveLength(1);

    const nowruz = clusterNewPageCandidates([
      cand({ id: "n1", label: "Nowruz Activities USA", volume: 300 }),
      cand({ id: "n2", label: "Nowruz Activities for Kids", volume: 500 }),
    ]);
    expect(nowruz).toHaveLength(1);
  });

  it("normalizes natural wonders and attractions into one destination intent", () => {
    const out = clusterNewPageCandidates([
      cand({ id: "a", label: "Travel Iran Beautiful Natural Wonders", volume: 400 }),
      cand({ id: "b", label: "Iran Natural Attractions", volume: 700 }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("computes DEDUPLICATED demand = MAX + 30% of the sum of the others, never a blind sum", () => {
    const out = clusterNewPageCandidates([
      cand({ id: "a", label: "Iranian director", volume: 200 }),
      cand({ id: "b", label: "Iranian directors", volume: 800 }),
    ]);
    // MAX(800) + 0.3 * (200) = 860  (a blind sum would be 1000)
    expect(out[0].clusterVolume).toBe(860);
  });
});

describe("D-28 floor + strategic exception", () => {
  const stableCluster = (over: Partial<NewPageClusterCandidate> & { id: string; label: string; volume: number }) =>
    clusterNewPageCandidates([cand(over)])[0];

  it("drops a cluster under 50/mo with no strategic signal", () => {
    const c = stableCluster({ id: "x", label: "Rare topic", volume: 20 });
    const { kept, dropped } = applyNewPageFloor([c]);
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toContain("under 50/mo");
  });

  it("keeps a cluster above 50/mo with no reason attached", () => {
    const c = stableCluster({ id: "y", label: "Popular topic", volume: 5000 });
    const { kept } = applyNewPageFloor([c]);
    expect(kept).toHaveLength(1);
    expect(kept[0].keptUnderFloorReason).toBeNull();
  });

  it("keeps a low-volume cluster on the AI-validated + competitor-cited exception WITH a stated reason", () => {
    const c = stableCluster({ id: "z", label: "Niche but cited", volume: 10, aiValidated: true, competitorCited: true });
    const { kept } = applyNewPageFloor([c]);
    expect(kept).toHaveLength(1);
    expect(kept[0].keptUnderFloorReason).toBe(
      "kept despite low volume: AI already answers this and cites competitors",
    );
  });

  it("states a competitor-only reason when only competitors cite it", () => {
    const c = stableCluster({ id: "w", label: "Competitor turf", volume: 10, competitorCited: true });
    const { kept } = applyNewPageFloor([c]);
    expect(kept[0].keptUnderFloorReason).toBe(
      "kept despite low volume: competitor pages already get cited for this",
    );
  });
});

describe("D-29 ranking (never alphabetical)", () => {
  it("a 27,100/mo cluster outranks a 50/mo one regardless of alphabetical order", () => {
    // "4 in farsi" sorts alphabetically BEFORE "capital of iran"; ranking must ignore that.
    const low = clusterNewPageCandidates([cand({ id: "low", label: "4 in farsi", volume: 50 })])[0];
    const high = clusterNewPageCandidates([cand({ id: "high", label: "capital of iran", volume: 27100 })])[0];
    const ranked = rankNewPageClusters([low, high]);
    expect(ranked[0].label).toBe("capital of iran");
    expect(ranked[1].label).toBe("4 in farsi");
  });

  it("orders zero-volume strategic clusters by strategic weight, not by label", () => {
    const aiCited = clusterNewPageCandidates([
      cand({ id: "ai", label: "zeta topic", volume: 0, aiValidated: true, competitorCited: true }),
    ])[0];
    const compOnly = clusterNewPageCandidates([
      cand({ id: "co", label: "alpha topic", volume: 0, competitorCited: true }),
    ])[0];
    const ranked = rankNewPageClusters([compOnly, aiCited]);
    expect(ranked[0].label).toBe("zeta topic"); // stronger strategic weight wins over alphabetical
  });
});

describe("deriveWinnability (reuses the prepared verdict)", () => {
  it("rates BUILD/high above WAIT above no-verdict-neutral above REJECT", () => {
    const build = deriveWinnability({ verdict: "build", confidence: "high", contentDomainCount: 8 });
    const wait = deriveWinnability({ verdict: "wait", confidence: "medium", contentDomainCount: 5 });
    const neutral = deriveWinnability(null);
    const reject = deriveWinnability({ verdict: "reject", confidence: "high", contentDomainCount: 2 });
    expect(build).toBeGreaterThan(wait);
    expect(wait).toBeGreaterThan(reject);
    expect(neutral).toBe(0.5);
    expect(build).toBeLessThanOrEqual(1);
    expect(reject).toBeGreaterThanOrEqual(0.1);
  });
});

describe("D-33 Rising / Seasonal / Stable", () => {
  it("detects a query spike and labels it Rising with evidence", () => {
    const monthly = [
      { month: 1, volume: 100 }, { month: 2, volume: 100 }, { month: 3, volume: 100 },
      { month: 4, volume: 370 },
    ];
    const spike = detectTrendSpike(monthly);
    expect(spike).not.toBeNull();
    const signal = deriveNewPageSignal({ trend: spike });
    expect(signal.kind).toBe("rising");
    expect(signal.label).toBe("Rising");
    expect(signal.evidence).toBe("searches 3.7x usual this month");
  });

  it("detects a seasonal window in the prep window and labels it Seasonal", () => {
    // Peak in month 4 (April), strong relative to the median; now = February (window open).
    const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, volume: i === 3 ? 4000 : 200 }));
    const seasonal = detectSeasonalWindow(monthly, 2);
    expect(seasonal).toEqual({ peakMonthLabel: "April" });
    const signal = deriveNewPageSignal({ seasonal });
    expect(signal.kind).toBe("seasonal");
    expect(signal.evidence).toContain("April");
  });

  it("labels a flat series Stable with no evidence line", () => {
    const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, volume: 500 }));
    const signal = deriveNewPageSignal({
      trend: detectTrendSpike(monthly),
      seasonal: detectSeasonalWindow(monthly, 6),
    });
    expect(signal.kind).toBe("stable");
    expect(signal.evidence).toBeNull();
  });

  it("prefers Seasonal over a generic spike when both are present", () => {
    const signal = deriveNewPageSignal({ trend: { multiplier: 3 }, seasonal: { peakMonthLabel: "March" } });
    expect(signal.kind).toBe("seasonal");
  });
});

describe("labelTokens", () => {
  it("lowercases, strips punctuation, and singularizes", () => {
    expect(labelTokens("Kashan Rugs!")).toEqual(["kashan", "rug"]);
  });
});
