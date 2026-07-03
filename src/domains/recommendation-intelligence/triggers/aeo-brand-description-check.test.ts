import { describe, it, expect } from "vitest";
import { aeoBrandDescriptionCheck, type AeoBrandDescriptionCheckInput } from "./aeo-brand-description-check";
import type { BrandDescriptionMismatch } from "@/domains/aeo/defense-types";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

const SIGNAL_AT = "2026-07-03T12:00:00Z";

function mismatch(overrides: Partial<BrandDescriptionMismatch> = {}): BrandDescriptionMismatch {
  return {
    factKind: "industry",
    ownFact: "a Persian culture guide",
    aiDescriptor: "a hotel",
    evidenceExcerpt: "Iranopedia is a hotel operator in Tehran.",
    model: "ChatGPT",
    ...overrides,
  };
}

function baseInput(overrides: Partial<AeoBrandDescriptionCheckInput> = {}): AeoBrandDescriptionCheckInput {
  return {
    tenantId: "tenant-iranopedia",
    mismatches: [],
    siteRootUrl: "https://iranopedia.com/",
    signalAt: SIGNAL_AT,
    ...overrides,
  };
}

describe("aeoBrandDescriptionCheck", () => {
  it("abstains when there is no configured site-root URL (empty-safe)", () => {
    expect(aeoBrandDescriptionCheck(baseInput({ siteRootUrl: null, mismatches: [mismatch()] }))).toEqual([]);
  });

  it("abstains when there are no mismatches (self-hiding)", () => {
    expect(aeoBrandDescriptionCheck(baseInput({ mismatches: [] }))).toEqual([]);
  });

  it("emits one candidate per mismatch, anchored on the site root", () => {
    const rows = aeoBrandDescriptionCheck(baseInput({ mismatches: [mismatch()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].target_url).toBe("https://iranopedia.com/");
    expect(rows[0].action_type).toBe("add_answer_block");
    expect(rows[0].trigger_signal).toBe("aeo_brand_description_check");
    expect(rows[0].generator_kind).toBe("deterministic");
    expect(rows[0].safety_flags).toEqual([]);
  });

  it("customer copy owns the mismatch honestly: names X and Y, no dashes, no lab jargon", () => {
    const rows = aeoBrandDescriptionCheck(baseInput({ mismatches: [mismatch()] }));
    const copy = rows[0].customer_copy;
    expect(copy).toContain("a hotel");
    expect(copy).toContain("a Persian culture guide");
    expect(hasBannedDash(copy)).toBe(false);
    for (const banned of ["AEO", "SERP", "SoV", "visibility", "share of voice"]) {
      expect(copy.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("operator evidence carries the true fact, the wrong descriptor, and the model", () => {
    const rows = aeoBrandDescriptionCheck(baseInput({ mismatches: [mismatch()] }));
    const ev = rows[0].operator_evidence;
    expect(ev).toContain("a hotel");
    expect(ev).toContain("a Persian culture guide");
    expect(ev).toContain("ChatGPT");
  });

  it("dedupe_key is stable per (factKind, descriptor)", () => {
    const a = aeoBrandDescriptionCheck(baseInput({ mismatches: [mismatch()] }))[0];
    const b = aeoBrandDescriptionCheck(baseInput({ mismatches: [mismatch()] }))[0];
    expect(a.dedupe_key).toBe(b.dedupe_key);
    expect(a.topic_cluster_label).toBe("aeo_brand_desc:industry:a hotel");
  });
});
