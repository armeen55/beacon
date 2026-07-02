import { describe, it, expect } from "vitest";
import { isJunkTopicLabel, cleanTopicLabel } from "./load-graph";

/** Pure-function unit tests for the load-graph-local competitor-label gates (kept
 *  separate from the fuller I/O `loadDemandGraphForTenant` — this file only touches
 *  the two exported pure helpers). */
describe("isJunkTopicLabel", () => {
  it("drops a bare CMS path", () => {
    expect(isJunkTopicLabel("shop product")).toBe(true);
    expect(isJunkTopicLabel("category")).toBe(true);
  });
  it("drops a geo/id slug but keeps a real year", () => {
    expect(isJunkTopicLabel("g293998")).toBe(true);
    expect(isJunkTopicLabel("nowruz 2026")).toBe(false);
  });
  it("keeps a real multi-word topic sitting under a CMS prefix", () => {
    expect(isJunkTopicLabel("news persian new year")).toBe(false);
  });
  it("operator ground-truth: drops a label trailing off on an orphan verb ('...hear cross')", () => {
    expect(isJunkTopicLabel("deadly misconceptions about iran hear cross")).toBe(true);
  });
});

describe("cleanTopicLabel (load-graph local)", () => {
  it("strips leaked CMS-section prefixes", () => {
    expect(cleanTopicLabel("news persian new year")).toBe("persian new year");
  });
  it("leaves a clean topic untouched", () => {
    expect(cleanTopicLabel("persian wedding")).toBe("persian wedding");
  });
});
