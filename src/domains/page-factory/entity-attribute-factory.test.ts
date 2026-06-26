import { describe, it, expect } from "vitest";
import { generatePageCandidates } from "./entity-attribute-factory";

describe("generatePageCandidates", () => {
  const base = {
    ownedUrls: [
      "https://iranopedia.com/persian-food",
      "https://iranopedia.com/persian-wedding",
      "https://iranopedia.com/persian-music",
      "https://iranopedia.com/nowruz-traditions",
    ],
    demandLabels: ["persian names", "persian rugs", "nowruz gifts"],
    tenantTopics: ["persian culture", "nowruz", "iran"],
  };

  it("mines recurring entities (persian appears 4×, nowruz 2×) and generates candidates", () => {
    const out = generatePageCandidates(base);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.entity === "persian" || c.entity === "nowruz")).toBe(true);
    // every candidate needs demand validation (no fabricated demand)
    expect(out.every((c) => c.needsDemandValidation)).toBe(true);
    // titles + slugs are well-formed
    expect(out[0].slug).toMatch(/^[a-z0-9-]+$/);
    expect(out[0].title.length).toBeGreaterThan(0);
  });

  it("relevance-gates: an off-topic recurring token is dropped when not in tenant topics", () => {
    const out = generatePageCandidates({
      ownedUrls: ["https://x.com/widget-blue", "https://x.com/widget-red"],
      demandLabels: ["widget guide"],
      tenantTopics: ["persian culture"], // "widget" not in topics → dropped
    });
    expect(out).toEqual([]);
  });

  it("dedups: skips a candidate an owned page already fully covers", () => {
    const out = generatePageCandidates({
      ownedUrls: ["https://x.com/persian-meaning", "https://x.com/persian-food"],
      demandLabels: ["persian names"],
      tenantTopics: ["persian"],
    });
    // "persian meaning" is fully covered by /persian-meaning → not regenerated
    expect(out.find((c) => c.slug === "persian-meaning")).toBeUndefined();
  });

  it("respects minEntityFreq (single-occurrence token is not an entity)", () => {
    const out = generatePageCandidates({
      ownedUrls: ["https://x.com/oneoff-topic"],
      demandLabels: [],
      tenantTopics: [],
      minEntityFreq: 2,
    });
    expect(out).toEqual([]);
  });

  it("caps output", () => {
    const out = generatePageCandidates({ ...base, maxCandidates: 3, tenantTopics: [] });
    expect(out.length).toBeLessThanOrEqual(3);
  });
});
