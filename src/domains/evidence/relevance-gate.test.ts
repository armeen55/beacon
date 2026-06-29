import { describe, it, expect } from "vitest";
import {
  topicTokens,
  scoreTopicMatch,
  isNoiseDomain,
  competitorRelevance,
  internalLinkRelevance,
  promptRelevance,
} from "./relevance-gate";

describe("topicTokens — strips generic brand terms + singularizes", () => {
  it("drops iran/persian and singularizes", () => {
    expect(topicTokens("Iranian Snacks")).toEqual(["snack"]);
    expect(topicTokens("Persian Numbers")).toEqual(["number"]);
    expect(topicTokens("Persian girl names")).toEqual(["girl", "name"]);
    expect(topicTokens("Tehran")).toEqual(["tehran"]);
  });
});

describe("BAD joins from the operator's live UI — must be SUPPRESSED", () => {
  it("Tehran does NOT link to Iranian Snacks (capital of Iran)", () => {
    const v = internalLinkRelevance("Tehran", "Iranian Snacks");
    expect(v.relevant).toBe(false);
    expect(v.reason).toBe("bad_internal_link_target");
  });

  it("Cities of Iran does NOT join 'iran city name' to an unrelated snack page", () => {
    expect(internalLinkRelevance("Cities of Iran", "Iranian Snacks").relevant).toBe(false);
  });

  it("Persian Holidays does NOT point to Iranian Snacks", () => {
    expect(internalLinkRelevance("Persian Holidays", "Iranian Snacks").relevant).toBe(false);
  });

  it("Safavid Flag 'what wins' is NOT a TasteAtlas eggplant URL", () => {
    const v = competitorRelevance("Safavid Flag", { url: "https://www.tasteatlas.com/persian-eggplant-stew" });
    expect(v.relevant).toBe(false);
    expect(v.reason).toBe("social_noise"); // tasteatlas is a noise domain
  });

  it("Safavid Flag eggplant is also a topic mismatch even off a normal domain", () => {
    const v = competitorRelevance("Safavid Flag", { url: "https://example.com/persian-eggplant-stew-recipe" });
    expect(v.relevant).toBe(false);
    expect(v.reason).toBe("competitor_topic_mismatch");
  });

  it("Central Asian Cobra is NOT a Persian-leopard ResearchGate URL", () => {
    expect(competitorRelevance("Central Asian Cobra", { url: "https://www.researchgate.net/persian-leopard-range" }).relevant).toBe(false);
  });

  it("Persian Numbers does NOT show baby-name competitor evidence", () => {
    const v = competitorRelevance("Persian Numbers 0-9", { url: "https://familyeducation.com/baby-names/persian-girl-names", title: "Persian Baby Girl Names" });
    expect(v.relevant).toBe(false);
  });

  it("Persian food competitor does NOT map to a Persian Insults move", () => {
    const v = competitorRelevance("Persian Farsi Insults", { url: "https://example.com/best-persian-food-dishes", title: "Top Persian Food Dishes" });
    expect(v.relevant).toBe(false);
  });
});

describe("VALID joins — must still PASS", () => {
  it("Persian wedding ↔ The Knot persian-wedding", () => {
    expect(competitorRelevance("Persian wedding traditions", { url: "https://www.theknot.com/content/persian-wedding-traditions" }).relevant).toBe(true);
  });

  it("Persian girl names ↔ familyeducation baby names (shared 'name')", () => {
    expect(competitorRelevance("Persian girl names", { url: "https://familyeducation.com/baby-names/persian-girl-names", title: "Persian Girl Names" }).relevant).toBe(true);
  });

  it("Nowruz activities ↔ a Nowruz activities page", () => {
    expect(competitorRelevance("Nowruz Activities USA", { url: "https://www.twinkl.com/resource/nowruz-activities", title: "Nowruz Activities" }).relevant).toBe(true);
  });

  it("Iran flag ↔ a flag history page", () => {
    expect(competitorRelevance("Iran Flag History", { url: "https://example.com/iran-flag-history-timeline", title: "Flag of Iran History" }).relevant).toBe(true);
  });

  it("Tehran ↔ a Tehran travel page", () => {
    expect(competitorRelevance("Tehran", { url: "https://example.com/things-to-do-in-tehran" }).relevant).toBe(true);
  });
});

describe("noise-domain detection", () => {
  it("flags social/forum/recipe/marketplace", () => {
    expect(isNoiseDomain("https://facebook.com/x")).toBe(true);
    expect(isNoiseDomain("https://www.tasteatlas.com/x")).toBe(true);
    expect(isNoiseDomain("https://researchgate.net/x")).toBe(true);
    expect(isNoiseDomain("https://www.theknot.com/x")).toBe(false);
  });
});

describe("scoreTopicMatch basics", () => {
  it("generic-only overlap is not relevant", () => {
    // both mention 'persian' only → no distinguishing overlap
    expect(scoreTopicMatch("Persian food", "Persian insults").relevant).toBe(false);
  });
  it("prompt relevance flags generic-only as generic_only_overlap", () => {
    expect(promptRelevance("Persian Numbers", "best persian gifts").reason).toBe("generic_only_overlap");
  });
});
