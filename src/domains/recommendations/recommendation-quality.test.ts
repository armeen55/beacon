import { describe, it, expect } from "vitest";
import { reviewRecommendation, passesDailyGate, type RecommendationInput } from "./recommendation-quality";

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

describe("Move 4 — adversarial regression corpus (the real failures)", () => {
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

describe("approvals — valid recommendations pass", () => {
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
