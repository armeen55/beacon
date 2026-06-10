/**
 * 2026-06-09 — "Why them, not you" forensics tests: equivalent-page
 * matching floor, gap engine (jealousy direction only), descriptor
 * contrast, prompt rows (losses first), report suppression floors.
 */

import { describe, it, expect } from "vitest";
import {
  matchEquivalentPage,
  computeStructureGaps,
  buildDescriptorContrast,
  buildPromptRows,
  buildWhyThemReport,
  MIN_THEIR_CITATIONS,
  type TheirPageInput,
  type OurPageInput,
  type ForensicsObservationInput,
} from "@/domains/competitor-intel/forensics";

function theirs(over: Partial<TheirPageInput> = {}): TheirPageInput {
  return {
    url: "https://supplehomesinc.com/adu-cost-guide",
    title: "ADU Cost Guide for the Bay Area",
    h1: "ADU Cost Guide",
    h2_list: ["ADU Cost Breakdown", "Permits and Timeline"],
    faq_questions: ["How much does an ADU cost?", "Do I need a permit?"],
    meta_description: "Real ADU costs.",
    ...over,
  };
}

function ours(over: Partial<OurPageInput> = {}): OurPageInput {
  return {
    url: "https://ritzbuilders.com/adu-construction",
    title: "ADU Construction",
    h1: "ADU Builders",
    h2_list: ["Our ADU Process"],
    faq_count: 0,
    meta_description: "We build ADUs.",
    ...over,
  };
}

describe("matchEquivalentPage", () => {
  it("matches our topically-closest page", () => {
    const match = matchEquivalentPage(theirs(), [
      ours(),
      ours({ url: "https://ritzbuilders.com/kitchen", title: "Kitchen Remodels", h1: "Kitchens" }),
    ]);
    expect(match).not.toBeNull();
    expect(match!.url).toBe("https://ritzbuilders.com/adu-construction");
  });

  it("returns null below the shared-token floor (no guessing)", () => {
    const match = matchEquivalentPage(
      theirs({ url: "https://supplehomesinc.com/zzz", title: "Qqq", h1: null }),
      [ours()],
    );
    expect(match).toBeNull();
  });

  it("uses extra_terms (service terms) to find matches path tokens miss", () => {
    const match = matchEquivalentPage(theirs(), [
      ours({
        url: "https://ritzbuilders.com/services",
        title: "Services",
        h1: "What we build",
        extra_terms: ["adu", "cost", "guide"],
      }),
    ]);
    expect(match).not.toBeNull();
  });
});

describe("computeStructureGaps", () => {
  it("no equivalent page → the single honest gap", () => {
    const gaps = computeStructureGaps(theirs(), null);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.dimension).toBe("no_equivalent_page");
  });

  it("names FAQ, pricing, section, and meta gaps in the jealousy direction only", () => {
    const gaps = computeStructureGaps(
      theirs(),
      ours({ meta_description: null }),
    );
    const dims = gaps.map((g) => g.dimension).sort();
    expect(dims).toEqual([
      "faq",
      "meta_description",
      "pricing_language",
      "section_coverage",
    ]);
    const faq = gaps.find((g) => g.dimension === "faq")!;
    expect(faq.sentence).toBe(
      "Their page answers 2 common questions right on the page; yours answers none.",
    );
    const sections = gaps.find((g) => g.dimension === "section_coverage")!;
    expect(sections.sentence).toContain("Permits and Timeline");
  });

  it("no gap when we cover the dimension too", () => {
    const gaps = computeStructureGaps(
      theirs(),
      ours({
        faq_count: 4,
        h2_list: ["ADU Cost Breakdown", "Permits and Timeline"],
        meta_description: "desc",
        title: "ADU Cost and Pricing",
      }),
    );
    expect(gaps).toEqual([]);
  });

  it("token-covered headings are not section gaps (cosmetic phrasing mercy)", () => {
    const gaps = computeStructureGaps(
      theirs({ h2_list: ["Permits and Timeline"], faq_questions: [], meta_description: null }),
      ours({ h2_list: ["Timeline and permits explained"], title: "ADU prices" }),
    );
    expect(gaps.find((g) => g.dimension === "section_coverage")).toBeUndefined();
  });
});

function fobs(over: Partial<ForensicsObservationInput> = {}): ForensicsObservationInput {
  return {
    prompt_id: "p1",
    platform: "chatgpt",
    observed_at: "2026-06-05T10:00:00Z",
    citation_domains: ["supplehomesinc.com", "ritzbuilders.com"],
    citation_rank: 2,
    descriptor_window: ["reliable", "local"],
    competitor_descriptor_windows: { "Supple Homes": ["luxury", "award-winning"] },
    ...over,
  };
}

describe("buildDescriptorContrast", () => {
  it("splits their words vs ours, frequency-ranked", () => {
    const c = buildDescriptorContrast(
      [
        fobs(),
        fobs({
          competitor_descriptor_windows: { "Supple Homes": ["luxury", "custom"] },
          descriptor_window: ["reliable"],
        }),
      ],
      "Supple Homes",
    );
    expect(c.theirs[0]).toBe("luxury"); // appears twice
    expect(c.theirs).toContain("award-winning");
    expect(c.ours[0]).toBe("reliable");
  });

  it("matches competitor name case-insensitively; empty when absent", () => {
    const c = buildDescriptorContrast([fobs()], "supple homes");
    expect(c.theirs.length).toBeGreaterThan(0);
    const none = buildDescriptorContrast([fobs()], "Other Builder");
    expect(none.theirs).toEqual([]);
  });
});

describe("buildPromptRows", () => {
  const prompts = new Map([
    ["p1", "Who builds the best ADUs in Palo Alto?"],
    ["p2", "How much does a kitchen remodel cost?"],
  ]);

  it("rows only for answers citing their domain; losses (we absent) sort first", () => {
    const rows = buildPromptRows(
      [
        fobs(), // p1: both cited, our rank 2
        fobs({
          prompt_id: "p2",
          citation_domains: ["www.supplehomesinc.com"],
          citation_rank: null, // we weren't cited — the loss
          observed_at: "2026-06-01T00:00:00Z",
        }),
        fobs({ prompt_id: "p3", citation_domains: ["other.com"] }), // not them
      ],
      prompts,
      "supplehomesinc.com",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.promptText).toBe("How much does a kitchen remodel cost?");
    expect(rows[0]!.ourRank).toBeNull();
    expect(rows[0]!.theirRank).toBe(1);
    expect(rows[0]!.theyWereFirst).toBe(true);
    expect(rows[1]!.ourRank).toBe(2);
  });

  it("keeps the latest observation per prompt", () => {
    const rows = buildPromptRows(
      [
        fobs({ observed_at: "2026-06-01T00:00:00Z", citation_rank: null }),
        fobs({ observed_at: "2026-06-07T00:00:00Z", citation_rank: 3 }),
      ],
      prompts,
      "supplehomesinc.com",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ourRank).toBe(3);
    expect(rows[0]!.lastSeen).toBe("2026-06-07T00:00:00Z");
  });

  it("skips observations whose prompt text is unknown", () => {
    const rows = buildPromptRows([fobs({ prompt_id: "unknown" })], prompts, "supplehomesinc.com");
    expect(rows).toEqual([]);
  });
});

describe("buildWhyThemReport — assembly + floors", () => {
  const baseArgs = {
    domain: "supplehomesinc.com",
    displayName: "Supple Homes",
    theirUrl: "https://supplehomesinc.com/adu-cost-guide",
    theirCitationTotal: 5,
    theirSnapshot: theirs(),
    ourPages: [ours()],
    observations: [fobs()],
    promptTextById: new Map([["p1", "Who builds the best ADUs in Palo Alto?"]]),
  };

  it("assembles a full report", () => {
    const r = buildWhyThemReport(baseArgs);
    expect(r).not.toBeNull();
    expect(r!.equivalentPageUrl).toBe("https://ritzbuilders.com/adu-construction");
    expect(r!.gaps.length).toBeGreaterThan(0);
    expect(r!.prompts).toHaveLength(1);
    expect(r!.descriptors.theirs).toContain("luxury");
  });

  it("suppresses below the citation floor", () => {
    expect(
      buildWhyThemReport({ ...baseArgs, theirCitationTotal: MIN_THEIR_CITATIONS - 1 }),
    ).toBeNull();
  });

  it("suppresses when no concrete prompt rows exist", () => {
    expect(
      buildWhyThemReport({
        ...baseArgs,
        observations: [fobs({ citation_domains: ["other.com"] })],
      }),
    ).toBeNull();
  });

  it("works without their snapshot (prompts + descriptors only, no gaps)", () => {
    const r = buildWhyThemReport({ ...baseArgs, theirSnapshot: null });
    expect(r).not.toBeNull();
    expect(r!.gaps).toEqual([]);
    expect(r!.equivalentPageUrl).toBeNull();
  });
});
