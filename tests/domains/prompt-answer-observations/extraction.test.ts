import { describe, it, expect } from "vitest";

import {
  extractMentionPosition,
  extractCitationRank,
  rankEntitiesByFirstAppearance,
  extractPrimaryRecommendation,
} from "@/domains/prompt-answer-observations/extraction";

describe("extractMentionPosition", () => {
  it("returns null when the answer text is empty", () => {
    expect(extractMentionPosition("", ["Ritz Builders"])).toBeNull();
  });

  it("returns null when no brand variant is in the text", () => {
    expect(
      extractMentionPosition(
        "Top Bay Area custom home builders include Homestead and Flegel's.",
        ["Ritz Builders", "Ritz"],
      ),
    ).toBeNull();
  });

  it("returns the char offset of the first brand variant match", () => {
    const text = "For Bay Area custom homes, Ritz Builders is a top choice.";
    const pos = extractMentionPosition(text, ["Ritz Builders"]);
    expect(pos).toBe(text.indexOf("Ritz Builders"));
  });

  it("is case-insensitive", () => {
    const text = "RITZ BUILDERS leads the Bay Area.";
    const pos = extractMentionPosition(text, ["Ritz Builders"]);
    expect(pos).toBe(0);
  });

  it("takes the earliest match across multiple variants", () => {
    const text = "Ritz is a Bay Area name; Ritz Builders has 20 years.";
    const pos = extractMentionPosition(text, ["Ritz Builders", "Ritz"]);
    // "Ritz" appears at index 0, before "Ritz Builders" at 24
    expect(pos).toBe(0);
  });

  it("skips empty variants without crashing", () => {
    const text = "Ritz Builders is here.";
    const pos = extractMentionPosition(text, ["", "Ritz Builders", ""]);
    expect(pos).toBe(0);
  });
});

describe("extractCitationRank", () => {
  const owned = new Set(["ritzbuilders.com"]);

  it("returns null when citations list is empty", () => {
    expect(extractCitationRank([], owned)).toBeNull();
  });

  it("returns null when no owned domain is cited", () => {
    expect(
      extractCitationRank(
        ["houzz.com", "yelp.com", "homestead.com"],
        owned,
      ),
    ).toBeNull();
  });

  it("returns 1 when owned is first citation", () => {
    expect(
      extractCitationRank(
        ["ritzbuilders.com", "houzz.com", "yelp.com"],
        owned,
      ),
    ).toBe(1);
  });

  it("returns 3 when owned is third citation", () => {
    expect(
      extractCitationRank(
        ["houzz.com", "yelp.com", "ritzbuilders.com", "bbb.org"],
        owned,
      ),
    ).toBe(3);
  });

  it("is case-insensitive", () => {
    expect(
      extractCitationRank(
        ["HOUZZ.COM", "RITZBUILDERS.COM"],
        new Set(["ritzbuilders.com"]),
      ),
    ).toBe(2);
  });

  it("returns null when ownedDomains is empty", () => {
    expect(
      extractCitationRank(["ritzbuilders.com"], new Set()),
    ).toBeNull();
  });
});

describe("rankEntitiesByFirstAppearance", () => {
  it("returns empty array when text or entities are empty", () => {
    expect(rankEntitiesByFirstAppearance("", [{ name: "Ritz" }])).toEqual([]);
    expect(rankEntitiesByFirstAppearance("some text", [])).toEqual([]);
  });

  it("returns entity canonical names sorted by first appearance", () => {
    const text =
      "Homestead is a well-known builder. Ritz Builders is also strong. Flegel's does interiors.";
    const out = rankEntitiesByFirstAppearance(text, [
      { name: "Ritz Builders" },
      { name: "Homestead" },
      { name: "Flegel's" },
    ]);
    expect(out).toEqual(["Homestead", "Ritz Builders", "Flegel's"]);
  });

  it("omits entities that don't appear in the text", () => {
    const text = "Homestead and Ritz Builders are options.";
    const out = rankEntitiesByFirstAppearance(text, [
      { name: "Ritz Builders" },
      { name: "Homestead" },
      { name: "NotMentioned" },
    ]);
    expect(out).toEqual(["Homestead", "Ritz Builders"]);
  });

  it("uses the earliest alias match for each entity", () => {
    const text = "Ritz has been around for decades.";
    const out = rankEntitiesByFirstAppearance(text, [
      { name: "Ritz Builders", aliases: ["Ritz"] },
    ]);
    expect(out).toEqual(["Ritz Builders"]);
  });

  it("truncates to maxN", () => {
    const text = "A B C D E F";
    const entities = ["A", "B", "C", "D", "E", "F"].map((n) => ({ name: n }));
    const out = rankEntitiesByFirstAppearance(text, entities, 3);
    expect(out).toEqual(["A", "B", "C"]);
  });
});

describe("extractPrimaryRecommendation", () => {
  it("returns false when brand not mentioned (position null)", () => {
    expect(
      extractPrimaryRecommendation(
        "Homestead and Flegel's are options.",
        null,
        ["Homestead", "Flegel's"],
        "Ritz Builders",
      ),
    ).toBe(false);
  });

  it("returns false when answer text is empty", () => {
    expect(
      extractPrimaryRecommendation("", 0, ["Ritz Builders"], "Ritz Builders"),
    ).toBe(false);
  });

  it("returns true when brand is early and in top-2 entities", () => {
    // "Ritz Builders is a top choice..." — position 0, first in order.
    const text =
      "Ritz Builders is the top custom home builder in the Bay Area, followed by Homestead.";
    const position = text.indexOf("Ritz Builders");
    const entitiesInOrder = ["Ritz Builders", "Homestead"];
    expect(
      extractPrimaryRecommendation(
        text,
        position,
        entitiesInOrder,
        "Ritz Builders",
      ),
    ).toBe(true);
  });

  it("returns false when brand is early but NOT in top-2 entities", () => {
    // Brand is mentioned after 3 other entities even if mention position is early-ish.
    const text =
      "Homestead. Flegel's. PAB. Ritz Builders ranks after them in this list.";
    const position = text.indexOf("Ritz Builders");
    const entitiesInOrder = [
      "Homestead",
      "Flegel's",
      "PAB",
      "Ritz Builders",
    ];
    expect(
      extractPrimaryRecommendation(
        text,
        position,
        entitiesInOrder,
        "Ritz Builders",
      ),
    ).toBe(false);
  });

  it("returns false when brand is in top-2 but NOT early enough", () => {
    // Long preamble before brand — mention position > 20% of text.
    const text =
      "Choosing a custom home builder is a serious decision that requires careful research, comparing portfolios, checking references, and understanding pricing. Only then can you consider Ritz Builders, one of the top options.";
    const position = text.indexOf("Ritz Builders");
    const entitiesInOrder = ["Ritz Builders"];
    expect(
      extractPrimaryRecommendation(
        text,
        position,
        entitiesInOrder,
        "Ritz Builders",
      ),
    ).toBe(false);
  });

  it("threshold 20% — brand at character 19/100 counts as early", () => {
    const text = "x".repeat(19) + "Ritz Builders" + "y".repeat(68);
    // text length = 19 + 13 + 68 = 100; threshold = 20; position 19 < 20 ✓
    const position = text.indexOf("Ritz Builders");
    expect(
      extractPrimaryRecommendation(
        text,
        position,
        ["Ritz Builders"],
        "Ritz Builders",
      ),
    ).toBe(true);
  });

  it("threshold 20% — brand at character 20/100 counts as late", () => {
    const text = "x".repeat(20) + "Ritz Builders" + "y".repeat(67);
    // text length = 100; threshold = 20; position 20 >= 20 → false
    const position = text.indexOf("Ritz Builders");
    expect(
      extractPrimaryRecommendation(
        text,
        position,
        ["Ritz Builders"],
        "Ritz Builders",
      ),
    ).toBe(false);
  });

  it("returns false when brandName is empty string", () => {
    expect(
      extractPrimaryRecommendation("Ritz Builders is good.", 0, ["Ritz Builders"], ""),
    ).toBe(false);
  });
});
