import { describe, it, expect } from "vitest";

import { proposeSafeAnswerBlock, proposeAnswerGap, buildWrittenAnswerProposal, checkAnswerFactualSafety, entityHead } from "./safe-answer-block";

describe("checkAnswerFactualSafety — the no-fabrication / no-volatile firewall", () => {
  it("passes a clean historical/definitional sentence", () => {
    const r = checkAnswerFactualSafety("The Achaemenid Empire Flag (550–330 BCE) is depicted with a red field and a golden Faravahar.", ["The Achaemenid Empire Flag (550–330 BCE) is depicted with a red field and a golden Faravahar."]);
    expect(r.passed).toBe(true);
  });
  it("rejects volatile population / current-status content (comma AND unformatted numbers)", () => {
    expect(checkAnswerFactualSafety("Ahvaz is home to around 1,184,788 residents today.", ["Ahvaz is home to around 1,184,788 residents today."]).passed).toBe(false);
    expect(checkAnswerFactualSafety("Tehran currently has a population of millions.", ["Tehran currently has a population of millions."]).passed).toBe(false);
    expect(checkAnswerFactualSafety("As of 2024 the festival is widely celebrated.", ["As of 2024 the festival is widely celebrated."]).passed).toBe(false);
    // unformatted population numbers (the adversarial-verify finding) — must also be rejected
    expect(checkAnswerFactualSafety("Iran is a country inhabited by 88 million people living across diverse regions.", ["x"]).passed).toBe(false);
    expect(checkAnswerFactualSafety("Shiraz is a city home to about 2 million people spread across its metro area.", ["x"]).passed).toBe(false);
    expect(checkAnswerFactualSafety("Mashhad is the second most populated city with 1.8 million inhabitants.", ["x"]).passed).toBe(false);
  });
  it("does NOT over-reject a non-population 'home to' sentence (landmarks)", () => {
    expect(checkAnswerFactualSafety("Shiraz is home to many iconic landmarks such as Persepolis and the Tomb of Hafez.", ["Shiraz is home to many iconic landmarks such as Persepolis and the Tomb of Hafez."]).passed).toBe(true);
  });
  it("rejects unsupported superlatives / status claims", () => {
    expect(checkAnswerFactualSafety("The Caspian seal is the only mammal in the Caspian Sea.", ["x"]).passed).toBe(false);
    expect(checkAnswerFactualSafety("It is the oldest dynasty in the region.", ["x"]).passed).toBe(false);
    expect(checkAnswerFactualSafety("This is Iran's national animal.", ["x"]).passed).toBe(false);
    expect(checkAnswerFactualSafety("The species is critically endangered.", ["x"]).passed).toBe(false);
  });
  it("rejects an answer atom (number/name) not present in the source (compression firewall)", () => {
    const r = checkAnswerFactualSafety("The Safavid flag dates to 1502 and honored Ismail.", ["The Safavid flag is a green banner."]);
    expect(r.passed).toBe(false);
    expect(r.unsupportedNumbers).toContain("1502");
    expect(r.unsupportedNames.map((n) => n.toLowerCase())).toContain("ismail");
  });
});

describe("entityHead", () => {
  it("picks the distinctive token from a slug label", () => {
    expect(entityHead("kerman rug")).toBe("kerman");
    expect(entityHead("achaemenid empire flag")).toBe("achaemenid");
    expect(entityHead("finglish")).toBe("finglish");
  });
});

describe("proposeSafeAnswerBlock — extractive, surfaces a BURIED exact answer", () => {
  const finglishBody = [
    "Persian speakers around the world use many writing systems online and on their phones every day.",
    "Finglish is Persian written using the English alphabet, common in texting and social media.",
  ];

  it("surfaces a buried direct-answer sentence (move below H1)", () => {
    const r = proposeSafeAnswerBlock({ label: "finglish", h1: "Finglish", topQuery: "finglish", bodyParagraphs: finglishBody });
    expect(r).toBeTruthy();
    expect(r!.answerText).toBe("Finglish is Persian written using the English alphabet, common in texting and social media.");
    expect(r!.paragraphIndex).toBe(1);
    expect(r!.operation).toBe("move_existing_text");
    expect(r!.proposedLocation).toBe("below_h1");
    expect(r!.factualSafety.passed).toBe(true);
    expect(r!.exactInstruction).toContain("MOVE it directly below the H1");
  });

  it("returns null when the answer is already prominent (lead sentence)", () => {
    const r = proposeSafeAnswerBlock({ label: "finglish", h1: "Finglish", topQuery: "finglish", bodyParagraphs: [
      "Finglish is Persian written using the English alphabet, common in texting and social media.",
      "It is widely used by the diaspora.",
    ] });
    expect(r).toBeNull();
  });

  it("returns null when the buried answer is volatile (population) — no surfacing of stale facts", () => {
    const r = proposeSafeAnswerBlock({ label: "ahvaz", h1: "Ahvaz", topQuery: "ahvaz", bodyParagraphs: [
      "Ahvaz sits in the southwest, on the banks of the Karun river.",
      "Ahvaz is home to around 1,184,788 residents today, a major industrial hub.",
    ] });
    expect(r).toBeNull();
  });

  it("returns null when the only definitional sentence starts with a dangling pronoun", () => {
    const r = proposeSafeAnswerBlock({ label: "kerman rug", h1: "Kerman Rug", topQuery: "kerman rug", bodyParagraphs: [
      "Persian carpets come in many regional styles, each with its own motifs and palette.",
      "It is a hand-knotted carpet prized for floral medallions.", // dangling "It"
    ] });
    expect(r).toBeNull();
  });

  it("returns null when no sentence directly answers (no fabrication)", () => {
    const r = proposeSafeAnswerBlock({ label: "kerman rug", h1: "Kerman Rug", topQuery: "kerman rug", bodyParagraphs: [
      "Our shop carries a wide range of beautiful handmade pieces from across the region.",
      "Browse the collection and find something you love for your home today.",
    ] });
    expect(r).toBeNull();
  });

  it("REJECTS a 'is home to …' enumeration lead and prefers the real definition (Shiraz geography)", () => {
    const r = proposeSafeAnswerBlock({ label: "shiraz", h1: "Shiraz", topQuery: "shiraz iran", bodyParagraphs: [
      "Travelers are drawn to the city's poetry, gardens, and historic bazaars throughout the year.",
      "Shiraz is home to Persepolis, the Tomb of Hafez, and the Vakil Complex among its sights.", // proximity/geography hazard — must be skipped
      "Shiraz is a city in the Fars province of south-central Iran, known for poetry and gardens.",
    ] });
    expect(r).toBeTruthy();
    expect(r!.answerText).toBe("Shiraz is a city in the Fars province of south-central Iran, known for poetry and gardens.");
  });

  it("returns null when the ONLY buried answer is a proximity/enumeration lead (no false geography)", () => {
    const r = proposeSafeAnswerBlock({ label: "shiraz", h1: "Shiraz", topQuery: "shiraz iran", bodyParagraphs: [
      "Visitors love the gardens, the bazaars, and the relaxed pace of the city.",
      "Shiraz is home to Persepolis and the Tomb of Hafez, two of Iran's most famous sites.",
    ] });
    expect(r).toBeNull();
  });

  it("prefers a definitional sentence for a WHAT-intent query (bare entity)", () => {
    const r = proposeSafeAnswerBlock({ label: "chaharshanbe suri", h1: "Chaharshanbe Suri", topQuery: "chaharshanbe suri", bodyParagraphs: [
      "Families across Iran prepare for the evening with snacks, music, and gatherings.",
      "Chaharshanbe Suri is enjoyed by people of all ages across the country each spring.", // qualifies, but not a definition
      "Chaharshanbe Suri is a traditional Persian festival of fire rooted in ancient custom.", // the definition
    ] });
    expect(r).toBeTruthy();
    expect(r!.answerText).toContain("traditional Persian festival of fire");
  });

  // REASONING (2026-06-30) — the operator's flagged bug: a WHEN/date query must NOT be answered with a
  // definition. When the top query is date-intent ("chaharshanbe suri 2026") and the page has no date
  // sentence, emit an honest GAP (null) instead of promoting the definition. See answer-intent.ts.
  it("returns null (honest gap) for a WHEN-intent query when the page only has a definition", () => {
    const r = proposeSafeAnswerBlock({ label: "chaharshanbe suri", h1: "Chaharshanbe Suri", topQuery: "chaharshanbe suri 2026", bodyParagraphs: [
      "Families across Iran prepare for the evening with snacks, music, and gatherings.",
      "Chaharshanbe Suri is enjoyed by people of all ages across the country each spring.", // not a date
      "Chaharshanbe Suri is a traditional Persian festival of fire rooted in ancient custom.", // a definition, not a date
    ] });
    expect(r).toBeNull();
  });

  it("surfaces the DATE sentence (not the definition) for a WHEN-intent query when the page has one", () => {
    const r = proposeSafeAnswerBlock({ label: "chaharshanbe suri", h1: "Chaharshanbe Suri", topQuery: "chaharshanbe suri 2026", bodyParagraphs: [
      "Families across Iran prepare for the evening with snacks, music, and gatherings.",
      "Chaharshanbe Suri is celebrated on the evening of Tuesday, March 17, 2026.", // the date — answers WHEN
      "Chaharshanbe Suri is a traditional Persian festival of fire rooted in ancient custom.", // a definition — wrong intent
    ] });
    expect(r).toBeTruthy();
    expect(r!.answerText).toContain("March 17, 2026");
    expect(r!.answerText).not.toContain("festival of fire");
  });

  it("copies (not moves) when the buried answer is mid-paragraph", () => {
    const r = proposeSafeAnswerBlock({ label: "kerman rug", h1: "Kerman Rug", topQuery: "kerman rug", bodyParagraphs: [
      "Welcome to our guide on Persian weaving traditions and regional carpet styles.",
      "Weavers use fine wool and silk. A Kerman rug is a hand-knotted Persian carpet from Kerman province.",
    ] });
    expect(r).toBeTruthy();
    expect(r!.sentenceIndex).toBeGreaterThan(0);
    expect(r!.operation).toBe("copy_existing_text");
  });
});

describe("proposeAnswerGap (D-2) — detect a page that needs a WRITTEN answer", () => {
  it("flags a WHEN gap when the page has only a definition (no date), with the right question + intent", () => {
    const gap = proposeAnswerGap({ label: "chaharshanbe suri", h1: "Chaharshanbe Suri", topQuery: "chaharshanbe suri 2026", bodyParagraphs: [
      "Families across Iran prepare for the evening with snacks, music, and gatherings.",
      "Chaharshanbe Suri is a traditional Persian festival of fire rooted in ancient custom.", // definition, not a date
    ] });
    expect(gap).not.toBeNull();
    expect(gap!.intent).toBe("when");
    expect(gap!.question).toBe("When is Chaharshanbe Suri?");
  });

  it("returns null when an extractive answer already exists (the extractive lever handles it)", () => {
    const gap = proposeAnswerGap({ label: "finglish", h1: "Finglish", topQuery: "finglish", bodyParagraphs: [
      "Persian speakers around the world use many writing systems online.",
      "Finglish is Persian written using the English alphabet, common in texting.", // a buried definition (extractive)
    ] });
    expect(gap).toBeNull();
  });

  it("returns null when the page already LEADS with an intent-matching answer", () => {
    const gap = proposeAnswerGap({ label: "chaharshanbe suri", h1: "Chaharshanbe Suri", topQuery: "chaharshanbe suri 2026", bodyParagraphs: [
      "Chaharshanbe Suri is celebrated on the evening of Tuesday, March 17, 2026.", // already answers WHEN at the top
      "Families gather for the fire festival.",
    ] });
    expect(gap).toBeNull();
  });
});

describe("buildWrittenAnswerProposal (D-2) — an LLM-written answer to ADD (not move)", () => {
  it("uses the add_new_text operation with an ADD instruction and passes factual safety", () => {
    const wa = buildWrittenAnswerProposal({ question: "When is Chaharshanbe Suri?", writtenText: "Chaharshanbe Suri 2026 falls on Tuesday, March 17." });
    expect(wa.operation).toBe("add_new_text");
    expect(wa.supportMode).toBe("written_answer");
    expect(wa.proposedLocation).toBe("below_h1");
    expect(wa.answerText).toContain("March 17");
    expect(wa.exactInstruction).toContain("ADD");
    expect(wa.factualSafety.passed).toBe(true);
  });
});
