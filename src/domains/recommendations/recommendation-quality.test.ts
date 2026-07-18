import { describe, it, expect } from "vitest";
import { reviewRecommendation, passesDailyGate, isPausedForSourceContradiction, type RecommendationInput } from "./recommendation-quality";

function rec(over: Partial<RecommendationInput> & { lever: RecommendationInput["lever"] }): RecommendationInput {
  return {
    pagePath: "/p",
    pageLabel: "Persian Boy Names",
    targetQuery: "persian boy names",
    proposedText: "Persian boy names are traditional given names from Iran, chosen for meaning and heritage.",
    pageOwnsQuery: true,
    ...over,
  };
}
const codes = (r: ReturnType<typeof reviewRecommendation>) => r.checks.map((c) => c.code);

describe("Move 4 - adversarial regression corpus (the real failures)", () => {
  it("Doodool Tala → Persian jewelry internal link is REJECTED (destination irrelevant)", () => {
    const r = reviewRecommendation(rec({
      lever: "internal_link", pagePath: "/doodool-tala", pageLabel: "Doodool Tala", targetQuery: "doodool tala",
      proposedText: "see Persian jewelry", destinationPath: "/persian-jewelry", destinationLabel: "Persian Jewelry", anchorText: "Persian jewelry",
    }));
    expect(r.decision).toBe("rejected");
    expect(codes(r)).toContain("destination_irrelevant");
    expect(passesDailyGate(r)).toBe(false);
  });

  it("Chaharshanbe year-intent query with a yearless answer is caught (year_intent_incomplete)", () => {
    const r = reviewRecommendation(rec({
      lever: "answer_block", pagePath: "/chaharshanbe-suri", pageLabel: "Chaharshanbe Suri", targetQuery: "chaharshanbe suri 2026",
      proposedText: "Chaharshanbe Suri is the Persian Festival of Fire held before Nowruz.",
    }));
    expect(codes(r)).toContain("year_intent_incomplete");
    expect(["rejected", "needs_revision"]).toContain(r.decision);
  });

  it("a self-link is REJECTED", () => {
    const r = reviewRecommendation(rec({
      lever: "internal_link", pagePath: "/cities", pageLabel: "Cities of Iran", targetQuery: "cities of iran",
      destinationPath: "/cities", destinationLabel: "Cities of Iran", anchorText: "cities of iran",
    }));
    expect(codes(r)).toContain("self_link");
    expect(r.decision).toBe("rejected");
  });

  it("anchor that doesn't describe the destination is REJECTED", () => {
    const r = reviewRecommendation(rec({
      lever: "internal_link", pagePath: "/tehran", pageLabel: "Tehran", targetQuery: "tehran",
      destinationPath: "/shiraz", destinationLabel: "Shiraz", anchorText: "tehran",
    }));
    expect(codes(r)).toContain("anchor_destination_mismatch");
    expect(r.decision).toBe("rejected");
  });

  it("a sibling-owned query is REJECTED (sibling ownership conflict)", () => {
    const r = reviewRecommendation(rec({
      lever: "meta", pageLabel: "Persian Boy Names", targetQuery: "persian girl names",
      pageOwnsQuery: false, siblingOwnerLabel: "Persian Girl Names", proposedText: "Persian girl names and their meanings.",
    }));
    expect(codes(r)).toContain("sibling_ownership_conflict");
    expect(r.decision).toBe("rejected");
  });

  it("a proof-blocked lever cannot pass", () => {
    const r = reviewRecommendation(rec({ lever: "meta", proofBlockedLevers: ["meta"], proposedText: "A fresh, factual meta for Persian boy names." }));
    expect(codes(r)).toContain("proof_blocked_lever");
    expect(r.decision).toBe("rejected");
  });

  it("a protected control cannot pass", () => {
    const r = reviewRecommendation(rec({ lever: "meta", isProtectedControl: true, proposedText: "A fresh, factual meta for Persian boy names." }));
    expect(codes(r)).toContain("protected_control");
    expect(r.decision).toBe("rejected");
  });

  it("an active-measurement conflict cannot pass", () => {
    const r = reviewRecommendation(rec({ lever: "meta", pageMeasuringSameLever: true, proposedText: "A fresh, factual meta for Persian boy names." }));
    expect(codes(r)).toContain("active_measurement_conflict");
    expect(r.decision).toBe("rejected");
  });

  it("Clean strategy with too few controls is REJECTED; other strategies caution", () => {
    const clean = reviewRecommendation(rec({ lever: "meta", strategy: "clean", controlsAvailable: 1, proposedText: "A fresh, factual meta for Persian boy names." }));
    expect(codes(clean)).toContain("measurement_insufficient");
    expect(clean.decision).toBe("rejected");
    const growth = reviewRecommendation(rec({ lever: "meta", strategy: "growth", controlsAvailable: 1, proposedText: "A fresh, factual meta for Persian boy names." }));
    expect(growth.cautions.map((c) => c.code)).toContain("measurement_insufficient");
    expect(passesDailyGate(growth)).toBe(true);
  });

  it("a verification-unsupported change is REJECTED", () => {
    const r = reviewRecommendation(rec({ lever: "meta", verifiable: false, proposedText: "A fresh, factual meta for Persian boy names." }));
    expect(codes(r)).toContain("verification_unsupported");
    expect(r.decision).toBe("rejected");
  });

  it("a generic 'Complete Guide' title is gated, not high-confidence Ready", () => {
    const r = reviewRecommendation(rec({ lever: "title", proposedText: "The Complete Guide to Everything You Need to Know" }));
    expect(passesDailyGate(r)).toBe(false);
  });

  it("a definitive contested origin is an APPROVED-WITH-CAUTION, not a rejection", () => {
    const r = reviewRecommendation(rec({
      lever: "answer_block", pagePath: "/chaharshanbe-suri", pageLabel: "Chaharshanbe Suri", targetQuery: "chaharshanbe suri",
      proposedText: "Chaharshanbe Suri is a Persian festival of fire rooted in Zoroastrian tradition.",
    }));
    expect(r.cautions.map((c) => c.code)).toContain("definitive_origin_claim");
    expect(r.decision).toBe("approved_with_caution");
    expect(passesDailyGate(r)).toBe(true);
  });

  it("no-meaningful-change (proposed == current) → needs revision", () => {
    const r = reviewRecommendation(rec({ lever: "meta", currentText: "Persian boy names and their meanings.", proposedText: "Persian boy names and their meanings." }));
    expect(codes(r)).toContain("no_meaningful_change");
    expect(r.decision).toBe("needs_revision");
  });
});

describe("approvals - valid recommendations pass", () => {
  it("a valid, factual meta is APPROVED", () => {
    const r = reviewRecommendation(rec({ lever: "meta", proposedText: "Persian boy names: traditional Iranian given names with their meanings and origins." }));
    expect(r.decision === "approved" || r.decision === "approved_with_caution").toBe(true);
    expect(passesDailyGate(r)).toBe(true);
  });
  it("a valid sibling cross-link (boy names → girl names) is allowed", () => {
    const r = reviewRecommendation(rec({
      lever: "internal_link", pagePath: "/persian-boy-names", pageLabel: "Persian Boy Names", targetQuery: "persian names",
      destinationPath: "/persian-girl-names", destinationLabel: "Persian Girl Names", anchorText: "Persian girl names", sourceSentence: "See also Persian girl names for the feminine equivalents.",
    }));
    expect(r.checks.map((c) => c.code)).not.toContain("destination_irrelevant");
    expect(r.checks.map((c) => c.code)).not.toContain("self_link");
  });
  it("directional-only measurement is a caution but still passes", () => {
    const r = reviewRecommendation(rec({ lever: "new_page", pageLabel: "Persian Wedding Traditions", targetQuery: "persian wedding traditions", directionalOnly: true, proposedText: "A new page covering Persian wedding traditions." }));
    expect(r.cautions.map((c) => c.code)).toContain("directional_measurement");
    expect(passesDailyGate(r)).toBe(true);
  });
});

describe("determinism + tenant-agnostic", () => {
  it("same input → same decision (repeatable)", () => {
    const input = rec({ lever: "meta", proposedText: "Persian boy names: traditional Iranian given names and meanings." });
    expect(reviewRecommendation(input)).toEqual(reviewRecommendation(input));
  });
  it("operatorReason never contains a raw reason code", () => {
    const r = reviewRecommendation(rec({ lever: "internal_link", pageLabel: "Doodool Tala", targetQuery: "doodool tala", destinationLabel: "Persian Jewelry", anchorText: "Persian jewelry", destinationPath: "/persian-jewelry", pagePath: "/doodool-tala" }));
    expect(r.operatorReason).not.toMatch(/_/);
  });
});

describe("N9 - pause when sources contradict (Quality Constitution law 1)", () => {
  it("a GSC-vs-GA4 traffic contradiction PAUSES the rec, ahead of every other gate", () => {
    // This candidate would otherwise be a clean APPROVE (valid meta, on-topic) - proving the
    // pause supersedes ordinary quality judgment rather than merely adding another caution.
    const r = reviewRecommendation(rec({
      lever: "meta",
      proposedText: "Persian boy names: traditional Iranian given names with their meanings and origins.",
      sourceEvidence: {
        gscTraffic: { clicks: 1200, impressions: 40000, windowDays: 90 },
        ga4Traffic: { sessions: 3, windowDays: 90 },
      },
    }));
    expect(r.decision).toBe("paused_source_contradiction");
    expect(isPausedForSourceContradiction(r)).toBe(true);
    expect(passesDailyGate(r)).toBe(false);
    expect(r.sourceContradictions).toHaveLength(1);
    expect(r.sourceContradictions[0].kind).toBe("traffic_mismatch");
  });

  it("the pause line is the honest, numbers-first sentence the operator sees", () => {
    const r = reviewRecommendation(rec({
      lever: "meta",
      pageLabel: "Persian Boy Names",
      sourceEvidence: {
        gscTraffic: { clicks: 1200, impressions: 40000, windowDays: 90 },
        ga4Traffic: { sessions: 3, windowDays: 90 },
      },
    }));
    expect(r.operatorReason).toContain("Search Console and Analytics disagree");
    expect(r.operatorReason).toContain("1,200");
    expect(r.operatorReason).toContain("3");
    expect(r.operatorReason).toContain("I am not recommending changes to it until I trust the data");
    expect(r.operatorReason).toContain("I will check again during background upkeep");
  });

  it("a rank-visibility contradiction (GSC top-5 vs SERP snapshot absent from top 10) also pauses", () => {
    const r = reviewRecommendation(rec({
      lever: "meta",
      targetQuery: "nowruz 2026",
      sourceEvidence: {
        gscQueryPosition: { query: "nowruz 2026", position: 3, impressions: 500 },
        serpSnapshot: { query: "nowruz 2026", capturedAt: "2026-07-01", ownDomainInTop10: false },
      },
    }));
    expect(r.decision).toBe("paused_source_contradiction");
  });

  it("a gone-page-but-clicked contradiction also pauses", () => {
    const r = reviewRecommendation(rec({
      lever: "meta",
      sourceEvidence: {
        pageStatus: { httpStatus: 404, fetchedAt: new Date().toISOString() },
        gscRecentClicks: { clicks: 50, recencyDays: 90 },
      },
    }));
    expect(r.decision).toBe("paused_source_contradiction");
  });

  it("NEVER fires on missing/absent data - no sourceEvidence at all behaves exactly as before N9", () => {
    const r = reviewRecommendation(rec({ lever: "meta" }));
    expect(r.decision).not.toBe("paused_source_contradiction");
    expect(r.sourceContradictions).toEqual([]);
  });

  it("NEVER fires when sourceEvidence is supplied but every field inside it is absent", () => {
    const r = reviewRecommendation(rec({ lever: "meta", sourceEvidence: {} }));
    expect(r.decision).not.toBe("paused_source_contradiction");
    expect(r.sourceContradictions).toEqual([]);
  });

  it("NEVER fires when only ONE side of a rule is present (e.g. GSC clicks with no GA4 read at all)", () => {
    const r = reviewRecommendation(rec({
      lever: "meta",
      sourceEvidence: { gscTraffic: { clicks: 5000, impressions: 90000, windowDays: 90 } },
    }));
    expect(r.decision).not.toBe("paused_source_contradiction");
  });

  it("stays a normal decision when sources are present but AGREE (no false pause on real evidence)", () => {
    const r = reviewRecommendation(rec({
      lever: "meta",
      proposedText: "Persian boy names: traditional Iranian given names with their meanings and origins.",
      sourceEvidence: {
        gscTraffic: { clicks: 500, impressions: 10000, windowDays: 90 },
        ga4Traffic: { sessions: 420, windowDays: 90 },
      },
    }));
    expect(r.decision === "approved" || r.decision === "approved_with_caution").toBe(true);
    expect(r.sourceContradictions).toEqual([]);
  });

  it("UNPAUSES automatically once the contradiction clears - it is computed, never persisted", () => {
    const paused = reviewRecommendation(rec({
      lever: "meta",
      sourceEvidence: {
        gscTraffic: { clicks: 1200, impressions: 40000, windowDays: 90 },
        ga4Traffic: { sessions: 3, windowDays: 90 },
      },
    }));
    expect(paused.decision).toBe("paused_source_contradiction");

    // Same page, next nightly read: GA4 now agrees with GSC. Nothing was written anywhere -
    // this is just calling the pure function again with fresh evidence.
    const resolved = reviewRecommendation(rec({
      lever: "meta",
      proposedText: "Persian boy names: traditional Iranian given names with their meanings and origins.",
      sourceEvidence: {
        gscTraffic: { clicks: 1200, impressions: 40000, windowDays: 90 },
        ga4Traffic: { sessions: 1100, windowDays: 90 },
      },
    }));
    expect(resolved.decision).not.toBe("paused_source_contradiction");
    expect(passesDailyGate(resolved)).toBe(true);
  });
});
