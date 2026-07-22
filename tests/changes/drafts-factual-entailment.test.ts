import { describe, it, expect } from "vitest";
import { checkFactualEntailment } from "@/domains/drafts/factual-entailment";

describe("checkFactualEntailment, numbers/dates", () => {
  it("PASSES a draft whose numbers all appear in the page body", () => {
    const r = checkFactualEntailment({
      draftText: "Nowruz has been celebrated for over 3000 years across Iran and neighboring countries.",
      pageBodyText: "Nowruz is a 3000 year old Persian tradition celebrated in Iran, marking the arrival of spring.",
    });
    expect(r.entailed).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("REJECTS a number that appears nowhere in the page, evidence, or query", () => {
    const r = checkFactualEntailment({
      draftText: "Nowruz has been celebrated for over 3000 years across Iran.",
      pageBodyText: "Nowruz marks the arrival of spring and the Persian new year.",
    });
    expect(r.entailed).toBe(false);
    expect(r.violations[0]).toContain("3000");
    expect(r.violations[0]).toContain("could not find that number");
  });

  it("allows a thousands-separator match against a plain grounded number (16,444 vs 16444)", () => {
    const r = checkFactualEntailment({
      draftText: "The festival drew 16,444 attendees last year.",
      pageBodyText: "Organizers reported 16444 attendees at the festival.",
    });
    expect(r.entailed).toBe(true);
  });

  it("allows the current/adjacent year and proof-window constants without grounding", () => {
    const nowYear = 2026;
    const r = checkFactualEntailment({
      draftText: "We measure results over 7, 14, and 28 day windows in 2026.",
      pageBodyText: "This page has no numbers on it at all.",
      nowYear,
    });
    expect(r.entailed).toBe(true);
  });

  it("grounds a number found only in the evidence text, not the page body", () => {
    const r = checkFactualEntailment({
      draftText: "The population of Asiatic cheetahs is estimated at fewer than 50 individuals.",
      pageBodyText: "The Asiatic cheetah is a critically endangered subspecies.",
      evidenceText: "Conservation reports estimate fewer than 50 individuals remain in the wild.",
    });
    expect(r.entailed).toBe(true);
  });

  it("grounds a number found only in the query", () => {
    const r = checkFactualEntailment({
      draftText: "Iran's 2026 World Cup jersey has not been officially announced yet.",
      pageBodyText: "Iran's national team competes internationally.",
      query: "Iran 2026 World Cup jersey",
    });
    expect(r.entailed).toBe(true);
  });
});

describe("checkFactualEntailment, named entities", () => {
  it("PASSES when every named entity appears in the page body", () => {
    const r = checkFactualEntailment({
      draftText: "The Sofreh Aghd is a ceremonial spread used in Persian weddings across Iran.",
      pageBodyText: "A Persian wedding features the Sofreh Aghd, a ceremonial spread, as its centerpiece in Iran.",
    });
    expect(r.entailed).toBe(true);
  });

  it("REJECTS a named entity that appears nowhere in the page, query, or evidence", () => {
    const r = checkFactualEntailment({
      draftText: "The Sofreh Aghd ceremony was popularized by Queen Farah Pahlavi in the 1960s.",
      pageBodyText: "A Persian wedding features the Sofreh Aghd, a ceremonial spread, as its centerpiece.",
    });
    expect(r.entailed).toBe(false);
    expect(r.violations.some((v) => v.includes("Queen Farah Pahlavi") || v.includes("Farah Pahlavi"))).toBe(true);
  });

  it("does NOT flag entities when there is no grounding text at all (handled elsewhere)", () => {
    const r = checkFactualEntailment({
      draftText: "Shah Abbas built the Safavid capital at Isfahan in the 17th century.",
    });
    // No page body / evidence / query supplied, the entity check is skipped
    // entirely (an evidence-floor problem, not an entailment failure); only the
    // superlative/number checks (neither of which fire here) could still apply.
    expect(r.entailed).toBe(true);
  });

  it("loosely grounds a multi-word entity whose words appear separately in the body", () => {
    const r = checkFactualEntailment({
      draftText: "The Asiatic Cheetah is Iran's national animal.",
      pageBodyText: "Iran's national animal is a critically endangered Asiatic subspecies of cheetah found on the central plateau.",
    });
    expect(r.entailed).toBe(true);
  });
});

describe("checkFactualEntailment, superlatives", () => {
  it("REJECTS an unsourced superlative", () => {
    const r = checkFactualEntailment({
      draftText: "Persepolis is the largest ancient Persian archaeological site in the world.",
      pageBodyText: "Persepolis was a ceremonial capital of the Achaemenid Empire.",
    });
    expect(r.entailed).toBe(false);
    expect(r.violations.some((v) => v.toLowerCase().includes("largest"))).toBe(true);
  });

  it("PASSES a superlative that is directly sourced on the page", () => {
    const r = checkFactualEntailment({
      draftText: "Persepolis is the largest ancient Persian archaeological site, according to UNESCO records.",
      pageBodyText: "UNESCO records describe Persepolis as the largest ancient Persian archaeological site known today.",
    });
    expect(r.entailed).toBe(true);
  });
});

describe("checkFactualEntailment, general behavior", () => {
  it("treats an empty draft as trivially entailed (nothing to check)", () => {
    expect(checkFactualEntailment({ draftText: "" }).entailed).toBe(true);
    expect(checkFactualEntailment({ draftText: "   " }).entailed).toBe(true);
  });

  it("caps violations at 5 even when many claims are unsupported", () => {
    const r = checkFactualEntailment({
      draftText:
        "Alpha Betaville was founded in 111 by King Gammaton, who built 222 palaces, 333 temples, 444 gardens, and 555 fountains, making it the largest city of its time.",
      pageBodyText: "This page has none of those facts on it.",
    });
    expect(r.entailed).toBe(false);
    expect(r.violations.length).toBeLessThanOrEqual(5);
  });

  it("PINS a real Iranopedia-style passing draft (cheetah fixture, extended with a grounded body)", () => {
    const r = checkFactualEntailment({
      draftText:
        "Iran's national animal is the Asiatic cheetah, a critically endangered subspecies native to the country's central plateau. Conservation programs work to protect the small remaining population across protected reserves and national parks in Iran.",
      pageBodyText:
        "The Asiatic cheetah is Iran's national animal, a critically endangered subspecies found on the central plateau. Iran runs conservation programs and protected reserves and national parks to protect the remaining population.",
    });
    expect(r.entailed).toBe(true);
    expect(r.violations).toEqual([]);
  });
});

// ── Operator correction: the page may be stale/wrong; a claim that CONTRADICTS
// the page but is backed by a dated, sourced authoritative fact is an ALLOWED
// CORRECTION (does not block, reported separately with source + date), never
// a violation. A claim that contradicts the page with NO backing fact stays a
// violation exactly as before. ──────────────────────────────────────────────

describe("checkFactualEntailment, corrections (page is stale, dated evidence backs the draft)", () => {
  it("a number that CONTRADICTS the page but is backed by a dated authoritative fact is a CORRECTION, not a violation", () => {
    const r = checkFactualEntailment({
      draftText: "Iranopedia now has 4500 recipes in its collection.",
      pageBodyText: "Iranopedia has 3000 recipes in its growing collection.",
      authoritativeFacts: [
        { source: "your site's recipe count (Wix connector)", date: "2026-07-01", detail: "4500 recipes are currently published" },
      ],
    });
    expect(r.entailed).toBe(true); // corrections never block
    expect(r.violations).toEqual([]);
    expect(r.corrections.length).toBe(1);
    expect(r.corrections[0]).toContain("4500");
    expect(r.corrections[0]).toContain("your site's recipe count (Wix connector)");
    expect(r.corrections[0]).toContain("2026-07-01");
  });

  it("the SAME contradicting number with NO authoritative fact stays a VIOLATION", () => {
    const r = checkFactualEntailment({
      draftText: "Iranopedia now has 4500 recipes in its collection.",
      pageBodyText: "Iranopedia has 3000 recipes in its growing collection.",
    });
    expect(r.entailed).toBe(false);
    expect(r.corrections).toEqual([]);
    expect(r.violations.length).toBe(1);
    expect(r.violations[0]).toContain("4500");
  });

  it("a named entity that contradicts the page but is backed by a dated fact is a CORRECTION", () => {
    const r = checkFactualEntailment({
      draftText: "The current mayor of the capital is Alireza Zakani.",
      pageBodyText: "Tehran is the capital of Iran and its largest city.",
      authoritativeFacts: [
        { source: "a stored Reuters article", date: "2026-03-15", detail: "Alireza Zakani serves as the mayor of Tehran" },
      ],
    });
    expect(r.entailed).toBe(true);
    expect(r.corrections.some((c) => c.includes("Alireza Zakani"))).toBe(true);
    expect(r.corrections.some((c) => c.includes("a stored Reuters article") && c.includes("2026-03-15"))).toBe(true);
  });

  it("a sourced, dated superlative is a CORRECTION, not a violation", () => {
    const r = checkFactualEntailment({
      draftText: "Persepolis is now the largest UNESCO World Heritage site in the region.",
      pageBodyText: "Persepolis was a ceremonial capital of the Achaemenid Empire.",
      authoritativeFacts: [
        { source: "UNESCO's own published register", date: "2026-01-10", detail: "Persepolis is the largest UNESCO World Heritage site in the region" },
      ],
    });
    expect(r.entailed).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.corrections.length).toBeGreaterThan(0);
  });

  it("the same unsourced superlative with no dated fact stays a violation", () => {
    const r = checkFactualEntailment({
      draftText: "Persepolis is now the largest UNESCO World Heritage site in the region.",
      pageBodyText: "Persepolis was a ceremonial capital of the Achaemenid Empire.",
    });
    expect(r.entailed).toBe(false);
    expect(r.corrections).toEqual([]);
  });

  it("a claim already grounded on the page is neither a correction nor a violation (just entailed)", () => {
    const r = checkFactualEntailment({
      draftText: "Nowruz has been celebrated for over 3000 years.",
      pageBodyText: "Nowruz is a 3000 year old Persian tradition.",
      authoritativeFacts: [{ source: "a stored source", date: "2026-01-01", detail: "9999 unrelated fact" }],
    });
    expect(r.entailed).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.corrections).toEqual([]);
  });

  it("findings[] carries the full structured detail (kind, message, source, date) for a correction", () => {
    const r = checkFactualEntailment({
      draftText: "The festival now draws 20000 visitors each year.",
      pageBodyText: "The festival draws thousands of visitors each year.",
      authoritativeFacts: [
        { source: "GA4 attendance tracking", date: "2026-06-30", detail: "20000 visitors attended this year" },
      ],
    });
    const finding = r.findings.find((f) => f.kind === "correction");
    expect(finding).toBeDefined();
    expect(finding!.source).toBe("GA4 attendance tracking");
    expect(finding!.date).toBe("2026-06-30");
    expect(finding!.message).toContain("20000");
  });

  it("findings[] carries kind:violation with no source/date for an unsupported invention", () => {
    const r = checkFactualEntailment({
      draftText: "The festival now draws 20000 visitors each year.",
      pageBodyText: "The festival draws thousands of visitors each year.",
    });
    const finding = r.findings.find((f) => f.kind === "violation");
    expect(finding).toBeDefined();
    expect(finding!.source).toBeUndefined();
    expect(finding!.date).toBeUndefined();
  });

  it("undated evidenceText grounds a claim but never produces a correction (grounding, not a correction claim)", () => {
    const r = checkFactualEntailment({
      draftText: "The population is estimated at 4500 individuals.",
      pageBodyText: "The population is a small, protected group.",
      evidenceText: "Recent surveys estimate 4500 individuals remain.",
    });
    // evidenceText is undated grounding, not an authoritative correction source -
    // the claim is simply entailed (grounded), not reported as a "correction".
    expect(r.entailed).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.corrections).toEqual([]);
  });

  it("a correction and a violation can coexist in the same draft (mixed findings)", () => {
    const r = checkFactualEntailment({
      draftText: "Iranopedia now has 4500 recipes, curated by chef Bahram Nemati since 1999.",
      pageBodyText: "Iranopedia has 3000 recipes in its growing collection.",
      authoritativeFacts: [
        { source: "your site's recipe count (Wix connector)", date: "2026-07-01", detail: "4500 recipes are currently published" },
      ],
    });
    expect(r.entailed).toBe(false); // the unsourced "Bahram Nemati" / "1999" still blocks
    expect(r.corrections.length).toBeGreaterThan(0);
    expect(r.violations.length).toBeGreaterThan(0);
  });
});
