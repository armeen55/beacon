import { describe, it, expect } from "vitest";

import { proposeSafeAnswerBlock, checkAnswerFactualSafety, entityHead } from "./safe-answer-block";

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
