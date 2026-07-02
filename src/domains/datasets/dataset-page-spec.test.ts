import { describe, it, expect } from "vitest";
import { buildDatasetPageBrief, buildCiteThisPageLine, datasetCandidateToPageCandidate } from "./dataset-page-spec";
import type { DatasetCandidate } from "./dataset-candidates";

function candidate(over: Partial<DatasetCandidate> = {}): DatasetCandidate {
  return {
    slug: "history-data-5",
    title: "History Data: 5 Pages Compared",
    description: "A sortable table compiling the History data already published across 5 of your pages.",
    kind: "page_family",
    columns: [
      { key: "entity", label: "Entity", source: "The page title of each page in the family." },
      { key: "history", label: "History", source: 'Extracted from the "History" section of each page.' },
    ],
    rowCountEstimate: 5,
    sourceFamilies: ["https://example.com/a", "https://example.com/b"],
    methodologyLine: "I compiled this from 5 pages already live on your site. Updated 2026-07-02.",
    whyItWins: "These 5 pages together get 1,200 search impressions.",
    demandScore: 1200,
    datasetTag: "dataset_page",
    ...over,
  };
}

describe("buildCiteThisPageLine", () => {
  it("produces the exact honest, dated attribution sentence", () => {
    const line = buildCiteThisPageLine({ title: "History Data: 5 Pages Compared", siteName: "Iranopedia", dateModified: "2026-07-02" });
    expect(line).toBe("Cite this page: History Data: 5 Pages Compared, Iranopedia, updated 2026-07-02.");
  });

  it("never contains an em or en dash", () => {
    const line = buildCiteThisPageLine({ title: "X", siteName: "Y", dateModified: "2026-07-02" });
    expect(line).not.toMatch(/[–—]/);
  });
});

describe("buildDatasetPageBrief", () => {
  it("builds a full brief with table spec, methodology, cite line, and JSON-LD", () => {
    const brief = buildDatasetPageBrief({
      candidate: candidate(),
      creator: { name: "Iranopedia", domain: "iranopedia.com" },
      dateModified: "2026-07-02",
      pagePath: "/data/history-facts",
    });
    expect(brief.slug).toBe("history-data-5");
    expect(brief.table.sortable).toBe(true);
    expect(brief.table.columns).toHaveLength(2);
    expect(brief.table.rowCountEstimate).toBe(5);
    expect(brief.citeThisPageLine).toBe("Cite this page: History Data: 5 Pages Compared, Iranopedia, updated 2026-07-02.");
    expect(brief.jsonLd).not.toBeNull();
    expect(brief.jsonLd!["@type"]).toBe("Dataset");
    expect(brief.jsonLd!.url).toBe("https://iranopedia.com/data/history-facts");
    expect(brief.datasetTag).toBe("dataset_page");
  });

  it("still returns a usable brief with jsonLd null when the domain is unusable", () => {
    const brief = buildDatasetPageBrief({
      candidate: candidate(),
      creator: { name: "Nobody", domain: "" },
      dateModified: "2026-07-02",
    });
    expect(brief.jsonLd).toBeNull();
    expect(brief.title).toBe("History Data: 5 Pages Compared");
  });
});

describe("datasetCandidateToPageCandidate", () => {
  it("adapts a DatasetCandidate into the page-factory PageCandidate shape", () => {
    const pc = datasetCandidateToPageCandidate(candidate());
    expect(pc.slug).toBe("history-data-5");
    expect(pc.attribute).toBe("dataset");
    expect(pc.needsDemandValidation).toBe(true);
    expect(pc.why).toBe("These 5 pages together get 1,200 search impressions.");
  });
});
