import { describe, it, expect } from "vitest";

import {
  extractMentionPosition,
  extractCitationRank,
  rankEntitiesByFirstAppearance,
  extractPrimaryRecommendation,
  extractDescriptorWindow,
  extractCompetitorCoMentions,
  extractCompetitorDescriptorWindows,
  classifyCitationDomains,
  extractAnswerStructure,
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

// ---------------------------------------------------------------------------
// Schema v2.1 Commit 6 (2026-04-24) — high-value-soon extractors
// ---------------------------------------------------------------------------

describe("extractDescriptorWindow", () => {
  it("returns [] when brand position is null", () => {
    expect(
      extractDescriptorWindow("any text", null, ["Ritz Builders"]),
    ).toEqual([]);
  });

  it("returns [] when text is empty", () => {
    expect(extractDescriptorWindow("", 0, ["Ritz Builders"])).toEqual([]);
  });

  it("returns adjectives/nouns near the brand mention", () => {
    const text =
      "The luxury custom home builder Ritz Builders handles award-winning modern bespoke designs.";
    const pos = text.indexOf("Ritz Builders");
    const out = extractDescriptorWindow(text, pos, ["Ritz Builders"]);
    expect(out).toContain("luxury");
    // Task 2 (2026-05-04): "custom", "home", "builder" are now domain
    // stopwords. Operator-specified bad set from /today screenshot.
    expect(out).not.toContain("custom");
    expect(out).not.toContain("home");
    expect(out).not.toContain("builder");
    expect(out).toContain("award-winning");
    expect(out).toContain("modern");
    expect(out).toContain("bespoke");
  });

  it("drops the brand's own words from the window", () => {
    const text = "Ritz Builders is a trusted Bay Area custom home builder.";
    const pos = 0;
    const out = extractDescriptorWindow(text, pos, ["Ritz Builders", "Ritz"]);
    expect(out).not.toContain("ritz");
    expect(out).not.toContain("builders");
    expect(out).toContain("trusted");
  });

  it("drops stopwords and short words", () => {
    const text = "it is the and or in Ritz Builders of to for at on";
    const pos = text.indexOf("Ritz Builders");
    const out = extractDescriptorWindow(text, pos, ["Ritz Builders"]);
    expect(out).not.toContain("it");
    expect(out).not.toContain("is");
    expect(out).not.toContain("the");
    expect(out).not.toContain("or");
    expect(out).not.toContain("of");
  });

  it("caps at `max` descriptors in order of appearance", () => {
    // Task 2 (2026-05-04): "custom" replaced by "bespoke" — both are
    // valid descriptors but "custom" is now a domain stopword.
    const text =
      "modern luxury bespoke affordable sustainable trusted prestigious elite premium traditional contemporary craftsmanship Ritz Builders";
    const pos = text.indexOf("Ritz Builders");
    const out = extractDescriptorWindow(text, pos, ["Ritz Builders"], {
      windowWords: 20,
      max: 10,
    });
    expect(out.length).toBeLessThanOrEqual(10);
    // Should include at least some of the preceding descriptors.
    expect(out).toContain("modern");
    expect(out).toContain("luxury");
    expect(out).toContain("bespoke");
  });

  it("dedupes repeated tokens within the window", () => {
    // Task 2 (2026-05-04): swapped "custom" for "bespoke" since "custom"
    // is now a domain stopword. Test still pins dedupe behavior on real
    // descriptors.
    const text =
      "luxury luxury bespoke bespoke Ritz Builders builds luxury bespoke homes.";
    const pos = text.indexOf("Ritz Builders");
    const out = extractDescriptorWindow(text, pos, ["Ritz Builders"]);
    const luxuryCount = out.filter((w) => w === "luxury").length;
    const bespokeCount = out.filter((w) => w === "bespoke").length;
    expect(luxuryCount).toBe(1);
    expect(bespokeCount).toBe(1);
  });

  it("skips pure-numeric tokens", () => {
    // Task 2 (2026-05-04): "projects" is now a domain stopword. Use
    // a non-stopword noun ("renovations") to assert the numeric-skip
    // behavior independent of stopword filtering.
    const text =
      "With 20 years and 300 renovations, Ritz Builders leads the market.";
    const pos = text.indexOf("Ritz Builders");
    const out = extractDescriptorWindow(text, pos, ["Ritz Builders"]);
    expect(out).not.toContain("20");
    expect(out).not.toContain("300");
    expect(out).toContain("years");
    expect(out).toContain("renovations");
  });

  it("filters URL-ish noise tokens from the window", () => {
    // Matches a real 2026-04-24 live-data pattern: brand citation
    // followed by inline URL splits into junk tokens.
    const text =
      "Visit trusted builder Ritz Builders https://ritzbuilders.com?utm_source=chatgpt for modern, sustainable designs.";
    const pos = text.indexOf("Ritz Builders");
    const out = extractDescriptorWindow(text, pos, ["Ritz Builders"]);
    expect(out).not.toContain("https");
    expect(out).not.toContain("com");
    expect(out).not.toContain("utm_source");
    expect(out).toContain("trusted");
    // "builder" is now a domain stopword (Task 2, 2026-05-04) since it's
    // a generic noun that doesn't tell the operator anything about how
    // AI positions Ritz. "trusted" / "modern" / "sustainable" come through.
    expect(out).not.toContain("builder");
    expect(out).toContain("modern");
    expect(out).toContain("sustainable");
    expect(out).toContain("designs");
  });

  // ── Task 2 (2026-05-04) — domain stopwords ─────────────────────────
  //
  // Operator-reported bad set (verbatim from /today screenshot):
  //   custom · home · builder · closed
  //
  // These are generic single-word nouns that pollute "How AI thinks you
  // are" without telling the operator anything about how AI positions
  // Ritz. They're suppressed from descriptor windows. Meaningful
  // adjectives (luxury, award-winning, trusted, modern) still pass.

  it("Task 2: operator's exact bad set is suppressed (custom / home / builder / closed)", () => {
    const text =
      "Ritz Builders is a custom home builder; their offices are closed for tours.";
    const pos = text.indexOf("Ritz Builders");
    const out = extractDescriptorWindow(text, pos, ["Ritz Builders"]);
    // Each of these would have polluted the screenshot. Pin them all.
    expect(out).not.toContain("custom");
    expect(out).not.toContain("home");
    expect(out).not.toContain("homes");
    expect(out).not.toContain("builder");
    expect(out).not.toContain("builders");
    expect(out).not.toContain("closed");
  });

  it("Task 2: meaningful adjectives still pass (luxury / award-winning / trusted)", () => {
    const text =
      "Highly trusted luxury award-winning Ritz Builders specializes in modern bespoke residences.";
    const pos = text.indexOf("Ritz Builders");
    const out = extractDescriptorWindow(text, pos, ["Ritz Builders"]);
    expect(out).toContain("trusted");
    expect(out).toContain("luxury");
    // "award-winning" is hyphenated → may pass through as one token;
    // we don't strictly assert which form survives — just that some
    // award/winning hint is preserved.
    expect(
      out.includes("award-winning") ||
        out.includes("award") ||
        out.includes("winning"),
    ).toBe(true);
    expect(out).toContain("modern");
    expect(out).toContain("bespoke");
  });

  it("Task 2: industry-noun stopwords cover the common pollution surface", () => {
    const text =
      "professional contractors at general company services with team for project work near house.";
    // Use brand at pos 0 (no brand actually in text — the function
    // operates on token windows around the position passed in).
    const pos = 0;
    const out = extractDescriptorWindow(text, pos, ["Brand"]);
    // None of these generic nouns should pass.
    for (const generic of [
      "professional",
      "contractors",
      "general",
      "company",
      "services",
      "team",
      "project",
      "work",
      "house",
    ]) {
      expect(out).not.toContain(generic);
    }
  });

  it("Task 2: temporal / state stopwords (closed / open / now / today) are suppressed", () => {
    const text =
      "Ritz Builders is currently open today and now accepting new clients; offices were closed yesterday.";
    const pos = text.indexOf("Ritz Builders");
    const out = extractDescriptorWindow(text, pos, ["Ritz Builders"]);
    for (const stateNoise of ["closed", "open", "now", "today", "currently"]) {
      expect(out).not.toContain(stateNoise);
    }
  });
});

describe("extractCompetitorCoMentions", () => {
  it("returns [] when no competitors are in the order list", () => {
    expect(
      extractCompetitorCoMentions(["Ritz Builders"], new Set(["Ritz Builders"])),
    ).toEqual([]);
  });

  it("returns [] on empty input", () => {
    expect(extractCompetitorCoMentions([], new Set(["Ritz Builders"]))).toEqual([]);
  });

  it("returns competitor names in order, dropping owned", () => {
    const entitiesInOrder = [
      "Homestead",
      "Ritz Builders",
      "Flegel's",
      "PAB",
    ];
    const owned = new Set(["Ritz Builders"]);
    expect(extractCompetitorCoMentions(entitiesInOrder, owned)).toEqual([
      "Homestead",
      "Flegel's",
      "PAB",
    ]);
  });
});

describe("classifyCitationDomains", () => {
  const owned = new Set(["ritzbuilders.com"]);
  const competitors = new Set(["homestead.com", "flegels.com"]);

  it("classifies owned, competitor, directory, news, review, social, other", () => {
    const domains = [
      "ritzbuilders.com",
      "homestead.com",
      "houzz.com",
      "nytimes.com",
      "trustpilot.com",
      "linkedin.com",
      "somepersonalblog.net",
    ];
    const out = classifyCitationDomains(domains, owned, competitors);
    expect(out).toEqual([
      "owned",
      "competitor",
      "directory",
      "news",
      "review",
      "social",
      "other",
    ]);
  });

  it("strips www. and protocol prefixes before matching", () => {
    const domains = ["www.ritzbuilders.com", "https://www.houzz.com"];
    const out = classifyCitationDomains(domains, owned, competitors);
    expect(out).toEqual(["owned", "directory"]);
  });

  it("returns 'other' for empty string and unknown domains", () => {
    const out = classifyCitationDomains(
      ["", "somerandom.com"],
      owned,
      competitors,
    );
    expect(out).toEqual(["other", "other"]);
  });

  it("preserves input array length and order", () => {
    const domains = Array.from({ length: 5 }, (_, i) => `unknown${i}.com`);
    const out = classifyCitationDomains(domains, owned, competitors);
    expect(out).toHaveLength(5);
    expect(out.every((c) => c === "other")).toBe(true);
  });
});

describe("extractAnswerStructure", () => {
  it("returns null on empty text", () => {
    expect(extractAnswerStructure("")).toBeNull();
  });

  it("detects ranked_list with 3+ numbered markers", () => {
    const text = `Here are three options:
1. Ritz Builders
2. Homestead
3. Flegel's`;
    expect(extractAnswerStructure(text)).toBe("ranked_list");
  });

  it("detects bullet_list with 3+ bullet markers", () => {
    const text = `Consider these builders:
- Ritz Builders
- Homestead
- Flegel's
- PAB`;
    expect(extractAnswerStructure(text)).toBe("bullet_list");
  });

  it("detects comparison when language flags fire 3+ times", () => {
    const text =
      "Ritz Builders vs Homestead: Ritz is better than Homestead while Flegel's is compared to traditional builders, whereas PAB is more specialized. It performs better than many alternatives.";
    expect(extractAnswerStructure(text)).toBe("comparison");
  });

  it("returns narrative for straight prose with no structural markers", () => {
    const text =
      "Ritz Builders is a custom home builder in the Bay Area known for luxury construction and design-build process. They work closely with architects on each project.";
    expect(extractAnswerStructure(text)).toBe("narrative");
  });

  it("returns mixed when two strong signals fire", () => {
    const text = `Compared to Homestead and versus Flegel's, these builders stand out:
1. Ritz Builders — better than PAB
2. Homestead — compared to generic options
3. Flegel's — versus large firms`;
    expect(extractAnswerStructure(text)).toBe("mixed");
  });

  it("does not false-trigger ranked_list on 1-2 numbered markers", () => {
    const text =
      "Ritz Builders has 1 thing that stands out: their track record. Also 2 key traits: quality and timeliness.";
    // Only "1" once at weird position — shouldn't count as 3+ start-of-line.
    // The regex wants "(^|\n)\s*\d+[.)]\s" which requires a period/paren after.
    // "1 thing" has no period, so 0 matches.
    const out = extractAnswerStructure(text);
    expect(out).not.toBe("ranked_list");
    expect(out).not.toBe("mixed");
  });
});

describe("extractCompetitorDescriptorWindows — W2 Step 2.1", () => {
  const RITZ = {
    name: "Ritz Builders",
    aliases: ["Ritz"],
  };
  const DEMATTEI = { name: "De Mattei Construction", aliases: ["De Mattei"] };
  const KASTEN = { name: "Kasten Builders", aliases: ["Kasten"] };
  const ENTITIES = [RITZ, DEMATTEI, KASTEN];
  const OWNED_VARIANTS = ["Ritz Builders", "Ritz"];

  it("returns {} when answer text is empty", () => {
    expect(
      extractCompetitorDescriptorWindows("", ENTITIES, OWNED_VARIANTS),
    ).toEqual({});
  });

  it("returns {} when no entities are supplied", () => {
    expect(
      extractCompetitorDescriptorWindows(
        "De Mattei is the luxury choice.",
        [],
        OWNED_VARIANTS,
      ),
    ).toEqual({});
  });

  it("skips owned brand variants — never returns descriptors for the operator's brand", () => {
    const text = "Ritz Builders is an award-winning luxury custom home firm.";
    const out = extractCompetitorDescriptorWindows(
      text,
      ENTITIES,
      OWNED_VARIANTS,
    );
    expect(out).not.toHaveProperty("Ritz Builders");
    // Neither competitor is in this text either.
    expect(out).toEqual({});
  });

  it("captures descriptors near a single competitor mention", () => {
    // Descriptors before + after — within the ±5 word default window
    // around the competitor's first token (index of "De").
    // Task 2 (2026-05-04): swapped "custom builder" for "bespoke
    // residential" since "custom" + "builder" are now domain stopwords.
    const text =
      "Top luxury award-winning bespoke residential De Mattei Construction works in Atherton.";
    const out = extractCompetitorDescriptorWindows(
      text,
      ENTITIES,
      OWNED_VARIANTS,
    );
    expect(Object.keys(out)).toEqual(["De Mattei Construction"]);
    expect(out["De Mattei Construction"]).toContain("luxury");
    expect(out["De Mattei Construction"]).toContain("award-winning");
    expect(out["De Mattei Construction"]).toContain("bespoke");
    expect(out["De Mattei Construction"]).toContain("residential");
    expect(out["De Mattei Construction"]).not.toContain("mattei");
    expect(out["De Mattei Construction"]).not.toContain("construction");
  });

  it("returns separate windows for multiple competitors", () => {
    const text =
      "De Mattei specializes in luxury homes. Kasten Builders focuses on contemporary architect-led projects.";
    const out = extractCompetitorDescriptorWindows(
      text,
      ENTITIES,
      OWNED_VARIANTS,
    );
    expect(Object.keys(out).sort()).toEqual([
      "De Mattei Construction",
      "Kasten Builders",
    ]);
    expect(out["De Mattei Construction"]).toContain("luxury");
    expect(out["Kasten Builders"]).toContain("contemporary");
    expect(out["Kasten Builders"]).toContain("architect-led");
  });

  it("matches via aliases (canonical name keyed)", () => {
    // "De Mattei" alias appears, not the full canonical name. Descriptors
    // sit before + after the alias mention, within the default ±5 word window.
    const text =
      "Top architect-led luxury boutique builder De Mattei serves Atherton clients.";
    const out = extractCompetitorDescriptorWindows(
      text,
      ENTITIES,
      OWNED_VARIANTS,
    );
    expect(Object.keys(out)).toContain("De Mattei Construction");
    expect(out["De Mattei Construction"]).toContain("architect-led");
  });

  it("excludes operator brand tokens from competitor windows", () => {
    // Brand and competitor close enough that the operator brand sits
    // INSIDE the competitor's ±5-word window — we explicitly drop those
    // so the right column in the comparison view never echoes the
    // operator's brand tokens back as competitor descriptors.
    const text =
      "Ritz Builders rivals luxury custom-home firm De Mattei Construction in Atherton's high-end market.";
    const out = extractCompetitorDescriptorWindows(
      text,
      ENTITIES,
      OWNED_VARIANTS,
    );
    const dematteiWindow = out["De Mattei Construction"] ?? [];
    // Brand tokens should never appear in a competitor's descriptor window.
    expect(dematteiWindow).not.toContain("ritz");
    expect(dematteiWindow).not.toContain("builders");
    // Substantive descriptors should land (within ±5 word window).
    expect(dematteiWindow).toContain("luxury");
    expect(dematteiWindow).toContain("custom-home");
  });

  it("silently skips competitors with no occurrence in the text", () => {
    const text = "De Mattei is well-regarded for luxury work.";
    const out = extractCompetitorDescriptorWindows(
      text,
      ENTITIES,
      OWNED_VARIANTS,
    );
    expect(out).toHaveProperty("De Mattei Construction");
    expect(out).not.toHaveProperty("Kasten Builders");
  });

  it("uses earliest-position mention when a competitor appears multiple times", () => {
    const text =
      "Kasten Builders is contemporary and modernist. " +
      "Later, Kasten is also used in boutique projects.";
    const out = extractCompetitorDescriptorWindows(
      text,
      ENTITIES,
      OWNED_VARIANTS,
    );
    // Window centers on first mention — should include "contemporary".
    expect(out["Kasten Builders"]).toContain("contemporary");
  });

  it("respects custom windowWords + max options", () => {
    // Descriptors before the mention so a small windowWords still has
    // material left after stopword + alias filtering.
    const text =
      "Top luxury award-winning De Mattei Construction firm trusted by clients.";
    const out = extractCompetitorDescriptorWindows(
      text,
      ENTITIES,
      OWNED_VARIANTS,
      { windowWords: 3, max: 4 },
    );
    expect(out["De Mattei Construction"]).toBeDefined();
    expect(out["De Mattei Construction"]!.length).toBeLessThanOrEqual(4);
  });

  it("never returns the same descriptor token twice in a single window", () => {
    const text =
      "De Mattei is luxury, and yes really very luxury, the absolute luxury choice.";
    const out = extractCompetitorDescriptorWindows(
      text,
      ENTITIES,
      OWNED_VARIANTS,
    );
    const window = out["De Mattei Construction"] ?? [];
    const dedup = new Set(window);
    expect(window.length).toBe(dedup.size);
  });
});
