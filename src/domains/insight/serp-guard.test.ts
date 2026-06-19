import { describe, expect, it } from "vitest";
import { deriveSerpGuard, serpStatusChip } from "./serp-guard";

describe("deriveSerpGuard", () => {
  it("downgrades a top-5 page with UNKNOWN SERP (the dangerous over-claim case)", () => {
    const g = deriveSerpGuard({ position: 3.8 });
    expect(g.status).toBe("unknown");
    expect(g.downgrade).toBe(true);
    expect(g.featureLikelyOwnsAnswer).toBe(false);
    expect(g.label).toBe("Needs SERP check before title rewrite");
    expect(g.rationale.toLowerCase()).toContain("verify");
  });

  it("does NOT downgrade a pos 6–10 page with unknown SERP", () => {
    const g = deriveSerpGuard({ position: 9 });
    expect(g.status).toBe("unknown");
    expect(g.downgrade).toBe(false);
    expect(g.label).toBe("SERP unknown");
  });

  it("treats OBSERVED + feature-owns as a SERP-owned loss (block title fix)", () => {
    const g = deriveSerpGuard({ position: 2, serpStatus: "observed", featureOwns: true });
    expect(g.featureLikelyOwnsAnswer).toBe(true);
    expect(g.downgrade).toBe(true);
    expect(g.label).toBe("Likely SERP-owned click loss");
  });

  it("treats OBSERVED + clear as actionable (no downgrade)", () => {
    const g = deriveSerpGuard({ position: 2, serpStatus: "observed", featureOwns: false });
    expect(g.downgrade).toBe(false);
    expect(g.label).toBe("SERP clear");
  });

  it("SUSPECTED always downgrades but never claims ownership alone", () => {
    const g = deriveSerpGuard({ position: 9, serpStatus: "suspected" });
    expect(g.downgrade).toBe(true);
    expect(g.featureLikelyOwnsAnswer).toBe(false);
    expect(g.label).toBe("SERP feature suspected");
  });
});

describe("serpStatusChip", () => {
  it("maps each status to its chip text", () => {
    expect(serpStatusChip("observed")).toBe("SERP observed");
    expect(serpStatusChip("suspected")).toBe("SERP suspected");
    expect(serpStatusChip("unknown")).toBe("SERP unknown");
  });
});
