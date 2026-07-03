import { describe, it, expect } from "vitest";
import { aeoZeroSourceOpening, type AeoZeroSourceOpeningInput } from "./aeo-zero-source-opening";
import type { ZeroSourceOpening } from "@/domains/aeo/defense-types";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

const SIGNAL_AT = "2026-07-03T12:00:00Z";

function opening(overrides: Partial<ZeroSourceOpening> = {}): ZeroSourceOpening {
  return {
    categoryId: "cat-1",
    topicLabel: "best time to visit Iran",
    observedAnswers: 42,
    modelCount: 3,
    topSourceShare: 0.1,
    topSourceDomain: "weakincumbent.com",
    ...overrides,
  };
}

function baseInput(overrides: Partial<AeoZeroSourceOpeningInput> = {}): AeoZeroSourceOpeningInput {
  return {
    tenantId: "tenant-iranopedia",
    openings: [],
    siteRootUrl: "https://iranopedia.com/",
    signalAt: SIGNAL_AT,
    ...overrides,
  };
}

describe("aeoZeroSourceOpening", () => {
  it("abstains when there is no configured site-root URL (empty-safe)", () => {
    expect(aeoZeroSourceOpening(baseInput({ siteRootUrl: null, openings: [opening()] }))).toEqual([]);
  });

  it("abstains when there are no openings (self-hiding)", () => {
    expect(aeoZeroSourceOpening(baseInput({ openings: [] }))).toEqual([]);
  });

  it("emits one candidate per opening, anchored on the site root", () => {
    const rows = aeoZeroSourceOpening(baseInput({ openings: [opening()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].target_url).toBe("https://iranopedia.com/");
    expect(rows[0].action_type).toBe("add_answer_block");
    expect(rows[0].trigger_signal).toBe("aeo_zero_source_opening");
    expect(rows[0].generator_kind).toBe("deterministic");
    expect(rows[0].safety_flags).toEqual([]);
  });

  it("customer copy is Beacon voice: names the topic + number, no dashes, no lab jargon", () => {
    const rows = aeoZeroSourceOpening(baseInput({ openings: [opening()] }));
    const copy = rows[0].customer_copy;
    expect(copy).toContain("best time to visit Iran");
    expect(copy).toContain("42");
    expect(hasBannedDash(copy)).toBe(false);
    for (const banned of ["AEO", "SERP", "SoV", "visibility", "share of voice"]) {
      expect(copy.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("never leaks the top-source domain into customer copy (would confuse the no-owner story)", () => {
    const rows = aeoZeroSourceOpening(baseInput({ openings: [opening()] }));
    expect(rows[0].customer_copy).not.toContain("weakincumbent.com");
  });

  it("dedupe_key and topic_cluster_label are stable per category", () => {
    const a = aeoZeroSourceOpening(baseInput({ openings: [opening({ categoryId: "cat-x" })] }))[0];
    const b = aeoZeroSourceOpening(baseInput({ openings: [opening({ categoryId: "cat-x" })] }))[0];
    expect(a.dedupe_key).toBe(b.dedupe_key);
    expect(a.topic_cluster_label).toBe("aeo_zero_source:cat-x");
  });
});
