import { describe, it, expect } from "vitest";
import { cleanTopicLabel, isJunkTopic, isUnparseableLabel } from "./clean-topic-label";

describe("isJunkTopic", () => {
  it("drops news/security headline fragments", () => {
    expect(isJunkTopic("Chinese Iranian Hackers Keep Using Boost")).toBe(true);
    expect(isJunkTopic("Company X arrested in lawsuit")).toBe(true);
  });
  it("drops slug / url garbage", () => {
    expect(isJunkTopic("buy/persian-rugs?ref=x")).toBe(true);
    expect(isJunkTopic("a-b-c-d-e")).toBe(true);
  });
  it("drops too-generic single words", () => {
    expect(isJunkTopic("Gifts")).toBe(true);
    expect(isJunkTopic("Tips")).toBe(true);
  });
  it("suppresses topics that LEAD with a generic filler word", () => {
    expect(isJunkTopic("Things Iran Highlights")).toBe(true);
    expect(isJunkTopic("List Iranians")).toBe(true);
    expect(isJunkTopic("Gifts for Nowruz")).toBe(true);
    expect(isJunkTopic("Persian Wedding Traditions")).toBe(false);
    expect(isJunkTopic("Famous Iranians")).toBe(false);
  });
  it("keeps real multi-word topics", () => {
    expect(isJunkTopic("Persian Wedding Traditions")).toBe(false);
    expect(isJunkTopic("Culture Iran")).toBe(false);
    expect(isJunkTopic("Nowruz Activities USA")).toBe(false);
  });
  it("operator ground-truth: drops a broken title trailing off on an orphan verb ('...Hear Cross')", () => {
    expect(isJunkTopic("Deadly Misconceptions About Iran Hear Cross")).toBe(true);
  });
});

describe("isUnparseableLabel", () => {
  it("flags a title-assembly fragment ending in a bare verb", () => {
    expect(isUnparseableLabel("Deadly Misconceptions About Iran Hear Cross")).toBe(true);
    expect(isUnparseableLabel("What You Should Know Before You Go")).toBe(true);
  });
  it("does not flag real noun-phrase topics", () => {
    expect(isUnparseableLabel("Persian Wedding Traditions")).toBe(false);
    expect(isUnparseableLabel("Nowruz Activities USA")).toBe(false);
    expect(isUnparseableLabel("Culture of Iran")).toBe(false);
    expect(isUnparseableLabel("Persian Literature")).toBe(false);
  });
  it("does not judge single-word labels (too short for grammar rules)", () => {
    expect(isUnparseableLabel("Gifts")).toBe(false);
  });
});

describe("cleanTopicLabel", () => {
  it("collapses duplicated words", () => {
    expect(cleanTopicLabel("Iranian Culture Iranian Culture Etiquette")).toBe(
      "Iranian Culture Etiquette",
    );
  });
  it("fixes casing + acronyms", () => {
    expect(cleanTopicLabel("nowruz activities usa")).toBe("Nowruz Activities USA");
    expect(cleanTopicLabel("things iran highlights")).toBe("Things Iran Highlights");
  });
  it("keeps small connectors lowercase mid-phrase", () => {
    expect(cleanTopicLabel("culture of iran")).toBe("Culture of Iran");
  });
  it("is idempotent on clean input", () => {
    const v = cleanTopicLabel("Persian Wedding Traditions");
    expect(cleanTopicLabel(v)).toBe(v);
  });
});
