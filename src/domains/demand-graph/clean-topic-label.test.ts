import { describe, it, expect } from "vitest";
import { cleanTopicLabel, isJunkTopic } from "./clean-topic-label";

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
  it("keeps real multi-word topics", () => {
    expect(isJunkTopic("Persian Wedding Traditions")).toBe(false);
    expect(isJunkTopic("Culture Iran")).toBe(false);
    expect(isJunkTopic("Nowruz Activities USA")).toBe(false);
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
