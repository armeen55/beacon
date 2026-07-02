import { describe, it, expect } from "vitest";
import { composeDatasetSchema, composeDatasetSchemaScript } from "./dataset-schema";
import type { DatasetCandidate } from "./dataset-candidates";

function candidate(over: Partial<DatasetCandidate> = {}): Pick<DatasetCandidate, "title" | "description" | "columns" | "slug" | "methodologyLine"> {
  return {
    slug: "history-data-5",
    title: "History Data: 5 Pages Compared",
    description: "A sortable table compiling the History data already published across 5 of your pages.",
    columns: [
      { key: "entity", label: "Entity", source: "The page title of each page in the family." },
      { key: "history", label: "History", source: 'Extracted from the "History" section of each page.' },
    ],
    methodologyLine: "I compiled this from 5 pages already live on your site. Updated 2026-07-02.",
    ...over,
  };
}

describe("composeDatasetSchema", () => {
  it("emits a valid schema.org Dataset with name, description, dateModified, creator, variableMeasured", () => {
    const schema = composeDatasetSchema({
      candidate: candidate(),
      creator: { name: "Iranopedia", domain: "iranopedia.com" },
      dateModified: "2026-07-02",
    });
    expect(schema).not.toBeNull();
    expect(schema!["@context"]).toBe("https://schema.org");
    expect(schema!["@type"]).toBe("Dataset");
    expect(schema!.name).toBe("History Data: 5 Pages Compared");
    expect(schema!.dateModified).toBe("2026-07-02");
    expect(schema!.creator).toEqual({ "@type": "Organization", name: "Iranopedia", url: "https://iranopedia.com" });
    expect(Array.isArray(schema!.variableMeasured)).toBe(true);
    expect((schema!.variableMeasured as unknown[]).length).toBe(2);
    expect(schema!.license).toBeTruthy();
    expect(schema!.isAccessibleForFree).toBe(true);
  });

  it("includes the honest dated methodology line as measurementTechnique", () => {
    const schema = composeDatasetSchema({
      candidate: candidate(),
      creator: { name: "Iranopedia", domain: "iranopedia.com" },
      dateModified: "2026-07-02",
    });
    expect(schema!.measurementTechnique).toContain("2026-07-02");
  });

  it("adds url/@id when a pagePath is given", () => {
    const schema = composeDatasetSchema({
      candidate: candidate(),
      creator: { name: "Iranopedia", domain: "iranopedia.com" },
      dateModified: "2026-07-02",
      pagePath: "/data/history-facts",
    });
    expect(schema!.url).toBe("https://iranopedia.com/data/history-facts");
    expect(schema!["@id"]).toBe("https://iranopedia.com/data/history-facts#dataset");
  });

  it("omits url/@id when no pagePath is given", () => {
    const schema = composeDatasetSchema({
      candidate: candidate(),
      creator: { name: "Iranopedia", domain: "iranopedia.com" },
      dateModified: "2026-07-02",
    });
    expect(schema!.url).toBeUndefined();
  });

  it("returns null when the creator's domain cannot be resolved to an origin", () => {
    const schema = composeDatasetSchema({
      candidate: candidate(),
      creator: { name: "Nobody", domain: "" },
      dateModified: "2026-07-02",
    });
    expect(schema).toBeNull();
  });

  it("falls back to the domain host as creator name when name is blank", () => {
    const schema = composeDatasetSchema({
      candidate: candidate(),
      creator: { name: "", domain: "iranopedia.com" },
      dateModified: "2026-07-02",
    });
    expect((schema!.creator as { name: string }).name).toBe("iranopedia.com");
  });
});

describe("composeDatasetSchemaScript", () => {
  it("wraps the schema in a ld+json script tag", () => {
    const script = composeDatasetSchemaScript({
      candidate: candidate(),
      creator: { name: "Iranopedia", domain: "iranopedia.com" },
      dateModified: "2026-07-02",
    });
    expect(script).toContain('<script type="application/ld+json">');
    expect(script).toContain('"@type": "Dataset"');
  });

  it("returns null when composeDatasetSchema returns null", () => {
    const script = composeDatasetSchemaScript({
      candidate: candidate(),
      creator: { name: "Nobody", domain: "" },
      dateModified: "2026-07-02",
    });
    expect(script).toBeNull();
  });
});
