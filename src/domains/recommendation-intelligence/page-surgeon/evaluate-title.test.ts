import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { evaluateTitle } from "./evaluate-title";
import type { EvidencePacket, GscEvidence } from "./contract";

const BRAND = { separator: " | ", suffix: "Iranopedia" };

function gsc(query: string, over: Partial<GscEvidence> = {}): GscEvidence {
  const impressions = over.impressions ?? 2000;
  return {
    windowStart: "2026-05-01",
    windowEnd: "2026-06-15",
    impressions,
    clicks: over.clicks ?? 20,
    ctr: over.ctr ?? 0.01,
    avgPosition: over.avgPosition ?? 8,
    topQueries: [
      { query, impressions, clicks: over.clicks ?? 20, ctr: over.ctr ?? 0.01, position: over.avgPosition ?? 8 },
    ],
    expectedCtrForPosition: 0.05,
    ctrGap: over.ctrGap ?? 0.04,
  };
}

function packet(over: {
  currentText?: string | null;
  gsc?: GscEvidence;
  boilerplateTerms?: string[];
  cmsFieldMapped?: boolean;
}): EvidencePacket {
  return {
    current: {
      tenantId: "t",
      pageUrl: "https://x.com/p",
      changeType: "title",
      elementKey: null,
      sectionLabel: null,
      currentText: over.currentText ?? null,
      cmsFieldMapped: over.cmsFieldMapped ?? true,
      publishChannel: "wix_cms",
    },
    gsc: over.gsc,
    boilerplateTerms: over.boilerplateTerms,
    sourcesPresent: over.gsc ? ["gsc"] : [],
    sourcesConnectedButEmpty: over.gsc ? [] : ["gsc"],
  };
}

describe("Page Surgeon — title Evidence Evaluator (candidate comparison, no fixed rules)", () => {
  it("1. KEEPS the brand suffix when it adds trust and fits length", () => {
    const dec = evaluateTitle({
      packet: packet({ currentText: null, gsc: gsc("iran flag") }),
      brand: BRAND,
    });
    expect(dec.titleStrategy!.brand_suffix_decision).toBe("include");
    expect(dec.titleStrategy!.recommended_strategy).toBe("with_brand_suffix");
    expect(dec.recommendedText).toBe("Iran Flag | Iranopedia");
  });

  it("2. OMITS the brand suffix when it would crowd out higher-value terms", () => {
    // Long query → base + brand suffix overflows the snippet; brand loses.
    const longQuery = "persian restaurants washington seattle kirkland bellevue area";
    const dec = evaluateTitle({
      packet: packet({ currentText: null, gsc: gsc(longQuery) }),
      brand: BRAND,
    });
    expect(dec.titleStrategy!.brand_suffix_decision).toBe("omit");
    expect(dec.recommendedText).not.toContain("Iranopedia");
  });

  it("3. PRESERVES a descriptive tail when it carries intent", () => {
    const dec = evaluateTitle({
      packet: packet({
        currentText: "Best Persian Rugs Buying Guide",
        gsc: gsc("persian rugs prices"),
        // "buying" is NOT boilerplate here → it's a real intent term to keep.
      }),
      brand: null,
    });
    expect(dec.titleStrategy!.recommended_strategy).toBe("preserve_descriptive_tail");
    expect(dec.titleStrategy!.preserved_terms.map((t) => t.toLowerCase())).toContain("buying");
  });

  it("4. REMOVES a descriptive tail when it is boilerplate (evidence-derived, not hardcoded)", () => {
    const dec = evaluateTitle({
      packet: packet({
        currentText: "Best Persian Rugs Buying Guide",
        gsc: gsc("persian rugs prices"),
        boilerplateTerms: ["buying"], // the tenant's own pages repeat this tail
      }),
      brand: null,
    });
    // Outcome (not label): the boilerplate tail is dropped from the chosen
    // title, and "buying" is reported as removed. (The winning candidate's text
    // is the query-only title; it may be labelled query_first or
    // replace_descriptive_tail since they produce identical text — what matters
    // is the tail is gone, vs test 3 where it was preserved.)
    expect(dec.titleStrategy!.recommended_strategy).not.toBe("preserve_descriptive_tail");
    expect(dec.recommendedText?.toLowerCase()).not.toContain("buying");
    expect(dec.titleStrategy!.removed_terms.map((t) => t.toLowerCase())).toContain("buying");
  });

  it("5. KEEPS the current title when it already satisfies the query", () => {
    const dec = evaluateTitle({
      packet: packet({
        currentText: "Persian Boy Names With Meanings",
        gsc: gsc("persian boy names"),
      }),
      brand: null,
    });
    expect(dec.keepCurrent).toBe(true);
    expect(dec.titleStrategy!.keep_current_title).toBe(true);
    expect(dec.recommendedText).toBeNull();
  });

  it("6a. query-first WINS only when the evidence supports it (current is off-query)", () => {
    const dec = evaluateTitle({
      packet: packet({
        currentText: "Some Unrelated Old Heading",
        gsc: gsc("persian boy names", { impressions: 4000, ctrGap: 0.05 }),
      }),
      brand: null,
    });
    expect(dec.keepCurrent).toBe(false);
    expect(dec.recommendedText?.toLowerCase()).toContain("persian boy names");
  });

  it("6b. does NOT recommend a change without demand evidence (needs_more_evidence)", () => {
    const dec = evaluateTitle({
      packet: packet({ currentText: "Some Title", gsc: undefined }),
      brand: null,
    });
    expect(dec.keepCurrent).toBe(true);
    expect(dec.confidence).toBe("needs_more_evidence");
  });

  it("7. contains NO tenant-specific (Iranopedia) hardcoding in the evaluator source", () => {
    const dir = __dirname;
    for (const f of ["contract.ts", "title-candidates.ts", "title-scorers.ts", "evaluate-title.ts"]) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src.toLowerCase()).not.toContain("iranopedia");
    }
  });
});
