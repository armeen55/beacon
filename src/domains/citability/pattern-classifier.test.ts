/**
 * pattern-classifier tests (2026-07-02, master plan item 26) - pins the
 * classification buckets against real-shaped fixture sentences and the
 * cited-sentence locator's honest skip-on-miss behavior.
 */
import { describe, it, expect } from "vitest";
import { classifySentence, splitIntoSentences, findCitedSentences, ALL_PATTERN_BUCKETS } from "./pattern-classifier";

describe("classifySentence", () => {
  it("classifies a stat-first sentence", () => {
    expect(classifySentence("Over 60 percent of Iranians celebrate Nowruz with a Haft-Sin table.")).toBe("stat_first");
    expect(classifySentence("3 million people visit Persepolis every year.")).toBe("stat_first");
    expect(classifySentence("$4.99 a month covers the subscription.")).toBe("stat_first");
    expect(classifySentence("1 in 4 households keep a pet cheetah myth alive.")).toBe("stat_first");
  });

  it("classifies a named-definition sentence", () => {
    expect(classifySentence("Chaharshanbe Suri is a fire-jumping festival held before Nowruz.")).toBe("definition");
    expect(classifySentence("Haft-Sin refers to the seven symbolic items on a Nowruz table.")).toBe("definition");
  });

  it("classifies an attributed-claim sentence", () => {
    expect(classifySentence("According to UNESCO, Nowruz is celebrated by over 300 million people.")).toBe("attributed_claim");
    expect(classifySentence("Per the Iranian Ministry of Culture, the festival dates back 3000 years.")).toBe("attributed_claim");
    expect(classifySentence("The National Geographic Society reports that the tradition spans several countries.")).toBe("attributed_claim");
  });

  it("classifies a list-lead sentence", () => {
    expect(classifySentence("1. Sabzeh (sprouts) symbolizes rebirth.")).toBe("list_lead");
    expect(classifySentence("Here are the top 7 items on a Haft-Sin table.")).toBe("list_lead");
    expect(classifySentence("- Serkeh represents patience and age.")).toBe("list_lead");
  });

  it("classifies a date-anchored sentence", () => {
    expect(classifySentence("In 2024, Nowruz fell on March 19.")).toBe("date_anchored");
    expect(classifySentence("As of March 2026, the holiday spans 13 days.")).toBe("date_anchored");
    expect(classifySentence("Since 1996, the United Nations has recognized the holiday.")).toBe("date_anchored");
  });

  it("classifies ambiguous prose as other (never forced into a bucket)", () => {
    expect(classifySentence("Families gather together and share a festive meal.")).toBe("other");
    expect(classifySentence("The colors and smells fill the room with joy.")).toBe("other");
  });

  it("returns other for empty or whitespace-only input", () => {
    expect(classifySentence("")).toBe("other");
    expect(classifySentence("   ")).toBe("other");
  });

  it("prioritizes stat_first over a coincidental date match", () => {
    // Opens with a stat AND contains a year - stat_first wins because leading-token
    // position is what an AI answer actually lifts.
    expect(classifySentence("Over 60 percent of visitors came in 2024 alone.")).toBe("stat_first");
  });

  it("ALL_PATTERN_BUCKETS lists exactly the 6 buckets classifySentence can return", () => {
    expect(ALL_PATTERN_BUCKETS).toEqual(["stat_first", "definition", "attributed_claim", "list_lead", "date_anchored", "other"]);
  });
});

describe("splitIntoSentences", () => {
  it("splits on sentence boundaries followed by a capital/number/quote", () => {
    const out = splitIntoSentences("Nowruz is the Persian new year. It begins on the spring equinox. Over 300 million people celebrate it.");
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("Nowruz is the Persian new year.");
  });

  it("drops fragments shorter than 8 characters", () => {
    const out = splitIntoSentences("Ok. This is a real sentence with enough length.");
    expect(out).toHaveLength(1);
  });

  it("returns an empty array for empty input", () => {
    expect(splitIntoSentences("")).toEqual([]);
    expect(splitIntoSentences("   ")).toEqual([]);
  });
});

describe("findCitedSentences", () => {
  const text =
    "Nowruz is the Persian new year celebrated by millions. Over 60 percent of Iranians prepare a Haft-Sin table (iranopedia.com). Families gather to share a festive meal.";

  it("finds the sentence that mentions the cited domain", () => {
    const out = findCitedSentences(text, [{ url: "https://iranopedia.com/nowruz", domain: "iranopedia.com" }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sentence).toContain("Haft-Sin");
    expect(out[0]!.bucket).toBe("stat_first");
  });

  it("falls back to a bracketed citation marker when the domain is not mentioned inline", () => {
    const bracketed = "Nowruz dates back thousands of years [1]. It is celebrated across Central Asia.";
    const out = findCitedSentences(bracketed, [{ url: "https://example.com/x", domain: "example.com" }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sentence).toContain("[1]");
  });

  it("skips a citation with no locatable sentence rather than guessing", () => {
    const plain = "Nowruz is a widely celebrated holiday with deep cultural roots.";
    const out = findCitedSentences(plain, [{ url: "https://nowhere.com/x", domain: "nowhere.com" }]);
    expect(out).toEqual([]);
  });

  it("returns one classified entry per citation, in order", () => {
    const multi =
      "Over 60 percent of families set a Haft-Sin table (source-a.com). According to source-b.com, the tradition is pre-Islamic.";
    const out = findCitedSentences(multi, [
      { url: "https://source-a.com/x", domain: "source-a.com" },
      { url: "https://source-b.com/y", domain: "source-b.com" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.bucket).toBe("stat_first");
    expect(out[1]!.bucket).toBe("attributed_claim");
  });

  it("returns an empty array for empty text or empty citations", () => {
    expect(findCitedSentences("", [{ url: "a", domain: "a.com" }])).toEqual([]);
    expect(findCitedSentences(text, [])).toEqual([]);
  });
});
