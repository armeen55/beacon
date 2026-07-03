import { describe, it, expect } from "vitest";

import {
  scoreInfoGain,
  gateCreatePageInfoGain,
  buildCreatePageInfoGainInputs,
  parseBriefForInfoGain,
  extractsForTopic,
  toInfoGainSummary,
  type CompetitorExtract,
  type InfoGainDraft,
  type InfoGainMoveInput,
} from "./info-gain-gate";
import type { MoveCandidate } from "@/domains/demand-graph/build-graph";

// ── fixtures ──────────────────────────────────────────────────────────────────

/** A wikipedia-style winner about Persian cats. */
const wikiExtract: CompetitorExtract = {
  url: "https://en.wikipedia.org/wiki/Persian_cat",
  domain: "en.wikipedia.org",
  title: "Persian cat",
  metaDescription: "The Persian cat is a long-haired breed of cat characterized by a round face.",
  h1: "Persian cat",
  outline: ["History of the breed", "Appearance and coat", "Health problems", "Grooming needs"],
  faqQuestions: ["Are Persian cats friendly?"],
  topTerms: ["breed", "coat", "grooming", "health", "kitten"],
  hasToolOrCalculator: false,
};

const rivalExtract: CompetitorExtract = {
  url: "https://catlovers.example.com/persian-cat-guide",
  domain: "catlovers.example.com",
  title: "Persian Cat Guide",
  outline: ["Breed history", "Coat colors", "Health issues", "Diet basics"],
  topTerms: ["breed", "coat", "diet", "health"],
  hasToolOrCalculator: false,
};

/** A draft that clearly adds new ground: care-cost table + adoption process. */
const addingDraft: InfoGainDraft = {
  title: "Persian Cat Ownership",
  outline: [
    "Breed history",
    "Monthly care cost table",
    "Adoption paperwork checklist",
    "Health problems",
  ],
  answer:
    "A Persian cat costs between 800 and 1500 in upfront adoption fees from certified rescues. " +
    "Monthly ownership runs about 120 including insurance premiums and litter subscription deliveries. " +
    "Tehran municipal shelters report waiting periods averaging eleven weeks for pedigree surrender adoptions.",
  faqQuestions: ["How much does a Persian cat cost per month?"],
};

/** A draft that only restates the winners. */
const duplicateDraft: InfoGainDraft = {
  title: "Persian cat",
  outline: ["Breed history", "Coat and appearance", "Health problems", "Grooming"],
  answer: "The Persian cat is a long haired breed with a round face. Grooming the coat matters for health.",
  faqQuestions: [],
};

// ── scoreInfoGain ─────────────────────────────────────────────────────────────

describe("scoreInfoGain", () => {
  it("returns adds_something with >= 2 novel sections and names the strongest contribution", () => {
    const r = scoreInfoGain(addingDraft, [wikiExtract, rivalExtract], { topicLabel: "Persian cats" });
    expect(r.verdict).toBe("adds_something");
    expect(r.novelSections.length).toBeGreaterThanOrEqual(2);
    expect(r.novelSections).toContain("Monthly care cost table");
    expect(r.novelSections).toContain("Adoption paperwork checklist");
    expect(r.sentence).toContain("the strongest new contribution is");
    expect(r.sourceCount).toBe(2);
  });

  it("returns adds_something on >= 3 novel fact sentences even with < 2 novel sections", () => {
    const draft: InfoGainDraft = {
      title: "Persian cat",
      outline: ["Breed history", "Health problems"], // both covered
      answer:
        "Certified rescues charge adoption fees near 900 with mandatory microchip registration included. " +
        "Insurance premiums average 38 monthly for pedigree registrations under veterinary underwriting programs. " +
        "Shelter surrender queues in Ontario stretched eleven weeks during 2025 according to provincial intake ledgers.",
    };
    const r = scoreInfoGain(draft, [wikiExtract, rivalExtract]);
    expect(r.novelSections.length).toBeLessThan(2);
    expect(r.novelFactSentences.length).toBeGreaterThanOrEqual(3);
    expect(r.verdict).toBe("adds_something");
  });

  it("returns duplicate_of_serp when nothing is novel, naming the strongest overlap", () => {
    const r = scoreInfoGain(duplicateDraft, [wikiExtract, rivalExtract], { topicLabel: "Persian cats" });
    expect(r.verdict).toBe("duplicate_of_serp");
    expect(r.novelSections).toEqual([]);
    expect(r.novelFactSentences).toEqual([]);
    expect(r.sentence).toContain("would mostly repeat what en.wikipedia.org already says about Persian cats");
    expect(r.sentence).toContain("nothing it adds");
  });

  it("returns thin_addition with exactly one new angle, named in the sentence", () => {
    const draft: InfoGainDraft = {
      title: "Persian cat",
      outline: ["Breed history", "Health problems", "Monthly care cost table"],
      answer: "The Persian cat is a long haired breed. Grooming the coat matters for health.",
    };
    const r = scoreInfoGain(draft, [wikiExtract, rivalExtract], { topicLabel: "Persian cats" });
    expect(r.verdict).toBe("thin_addition");
    expect(r.novelSections).toEqual(["Monthly care cost table"]);
    expect(r.sentence).toContain("the one new angle is");
    expect(r.sentence).toContain("Monthly care cost table");
  });

  it("counts a planned calculator as an original asset only when no winner has a tool", () => {
    const draft: InfoGainDraft = {
      title: "Persian cat",
      outline: ["Breed history", "Care cost calculator"],
      answer: "The Persian cat is a long haired breed.",
    };
    const withoutTool = scoreInfoGain(draft, [wikiExtract]);
    expect(withoutTool.originalAssets).toContain("Care cost calculator");
    const withTool = scoreInfoGain(draft, [{ ...wikiExtract, hasToolOrCalculator: true }]);
    expect(withTool.originalAssets).not.toContain("Care cost calculator");
  });

  it("is unchecked with no teardown evidence, and with no draft", () => {
    const noEvidence = scoreInfoGain(addingDraft, []);
    expect(noEvidence.verdict).toBe("unchecked");
    expect(noEvidence.sentence).toContain("I have not read the winning pages");
    const noDraft = scoreInfoGain(null, [wikiExtract]);
    expect(noDraft.verdict).toBe("unchecked");
    expect(noDraft.sentence).toContain("no draft");
  });

  it("never emits an em or en dash in any sentence", () => {
    for (const r of [
      scoreInfoGain(addingDraft, [wikiExtract, rivalExtract]),
      scoreInfoGain(duplicateDraft, [wikiExtract]),
      scoreInfoGain(addingDraft, []),
      scoreInfoGain(null, [wikiExtract]),
    ]) {
      expect(r.sentence).not.toMatch(/[–—]/);
    }
  });
});

// ── gateCreatePageInfoGain ────────────────────────────────────────────────────

function move(over: Partial<MoveCandidate> = {}): MoveCandidate {
  return {
    demandKey: "gap:persian-cat",
    label: "Persian Cats",
    gap: "create_page",
    score: 100,
    components: { demand: 10, winnability: 0.5, dollarValue: 0, visibilityGap: 0.5, friction: 0 },
    confidence: "low",
    signals: ["ai"],
    ownedUrl: null,
    competitorUrls: ["https://en.wikipedia.org/wiki/Persian_cat"],
    fanoutSeeds: [],
    rationale: "Competitors own this topic.",
    ...over,
  };
}

describe("gateCreatePageInfoGain", () => {
  it("is a byte-identical no-op (same array reference) when nothing has evidence", () => {
    const moves = [move(), move({ demandKey: "gap:other", label: "Other Topic" })];
    const inputs = new Map<string, InfoGainMoveInput>([
      ["gap:persian-cat", { draft: null, extracts: [] }],
    ]);
    const gated = gateCreatePageInfoGain(moves, inputs);
    expect(gated.moves).toBe(moves); // same reference, not a copy
    expect(gated.changes).toEqual([]);
  });

  it("drops a duplicate_of_serp move with the honest reason and keeps the rest", () => {
    const dup = move({ demandKey: "gap:dup", label: "Persian Cats" });
    const other = move({ demandKey: "gap:other", label: "Nowruz Sweets", competitorUrls: [] });
    const inputs = new Map<string, InfoGainMoveInput>([
      ["gap:dup", { draft: duplicateDraft, extracts: [wikiExtract, rivalExtract] }],
    ]);
    const gated = gateCreatePageInfoGain([dup, other], inputs);
    expect(gated.moves.map((m) => m.demandKey)).toEqual(["gap:other"]);
    expect(gated.changes).toHaveLength(1);
    expect(gated.changes[0]).toMatchObject({ demandKey: "gap:dup", action: "dropped", verdict: "duplicate_of_serp" });
    expect(gated.changes[0]!.reason).toContain("would mostly repeat what en.wikipedia.org already says");
  });

  it("reclassifies a duplicate to edit_page when an owned URL is known", () => {
    const dup = move({ demandKey: "gap:dup", ownedUrl: "https://iranopedia.com/persian-cats" });
    const inputs = new Map<string, InfoGainMoveInput>([
      ["gap:dup", { draft: duplicateDraft, extracts: [wikiExtract] }],
    ]);
    const gated = gateCreatePageInfoGain([dup], inputs);
    expect(gated.moves).toHaveLength(1);
    expect(gated.moves[0]!.gap).toBe("edit_page");
    expect(gated.moves[0]!.rationale).toContain("Strengthen the existing page instead of creating a new one.");
    expect(gated.changes[0]!.action).toBe("reclassified");
  });

  it("demotes thin_addition below every adds_something row and attaches verdicts", () => {
    const thinDraft: InfoGainDraft = {
      title: "Persian cat",
      outline: ["Breed history", "Health problems", "Monthly care cost table"],
      answer: "The Persian cat is a long haired breed. Grooming the coat matters for health.",
    };
    const thin = move({ demandKey: "gap:thin", label: "Persian Cats Thin", score: 200 });
    const adds = move({ demandKey: "gap:adds", label: "Persian Cat Ownership", score: 100 });
    const inputs = new Map<string, InfoGainMoveInput>([
      ["gap:thin", { draft: thinDraft, extracts: [wikiExtract, rivalExtract] }],
      ["gap:adds", { draft: addingDraft, extracts: [wikiExtract, rivalExtract] }],
    ]);
    const gated = gateCreatePageInfoGain([thin, adds], inputs);
    const thinOut = gated.moves.find((m) => m.demandKey === "gap:thin")!;
    const addsOut = gated.moves.find((m) => m.demandKey === "gap:adds")!;
    expect(thinOut.infoGain?.verdict).toBe("thin_addition");
    expect(addsOut.infoGain?.verdict).toBe("adds_something");
    expect(thinOut.score).toBeLessThan(addsOut.score);
    // demoted rows come after adds_something rows in the returned order
    expect(gated.moves.indexOf(addsOut)).toBeLessThan(gated.moves.indexOf(thinOut));
    expect(gated.changes.some((c) => c.action === "demoted" && c.demandKey === "gap:thin")).toBe(true);
  });

  it("never touches non-create_page moves", () => {
    const edit = move({ demandKey: "edit:x", gap: "edit_page", ownedUrl: "https://x.com/a" });
    const inputs = new Map<string, InfoGainMoveInput>([
      ["edit:x", { draft: duplicateDraft, extracts: [wikiExtract] }],
    ]);
    const gated = gateCreatePageInfoGain([edit], inputs);
    expect(gated.moves[0]).toBe(edit);
    expect(gated.changes).toEqual([]);
  });
});

// ── input builders ────────────────────────────────────────────────────────────

describe("buildCreatePageInfoGainInputs / parseBriefForInfoGain", () => {
  it("joins audits by competitor URL and parses the persisted brief", () => {
    const m = move();
    const audits = new Map([
      [
        "https://en.wikipedia.org/wiki/Persian_cat",
        {
          url: "https://en.wikipedia.org/wiki/Persian_cat",
          domain: "en.wikipedia.org",
          fetchStatus: "ok",
          facts: { title: "Persian cat", outline: ["History"], topTerms: ["breed"] },
        },
      ],
    ]);
    const drafts = new Map([
      [
        "gap:persian-cat::create_page_brief",
        { content: JSON.stringify({ proposedTitle: "Persian Cat Ownership", openingAnswer: "A Persian cat costs money.", outline: ["Costs"], faqQuestions: [] }) },
      ],
    ]);
    const inputs = buildCreatePageInfoGainInputs({ moves: [m], auditsByUrl: audits, drafts });
    const input = inputs.get("gap:persian-cat")!;
    expect(input.extracts).toHaveLength(1);
    expect(input.draft?.title).toBe("Persian Cat Ownership");
  });

  it("skips failed audits and malformed briefs (unchecked, never faked)", () => {
    const m = move();
    const audits = new Map([
      ["https://en.wikipedia.org/wiki/Persian_cat", { url: "https://en.wikipedia.org/wiki/Persian_cat", fetchStatus: "blocked_robots", facts: null }],
    ]);
    const drafts = new Map([["gap:persian-cat::create_page_brief", { content: "not json {" }]]);
    const inputs = buildCreatePageInfoGainInputs({ moves: [m], auditsByUrl: audits, drafts });
    const input = inputs.get("gap:persian-cat")!;
    expect(input.extracts).toEqual([]);
    expect(input.draft).toBeNull();
    expect(parseBriefForInfoGain(undefined)).toBeNull();
  });
});

describe("extractsForTopic", () => {
  const entries = [
    { topics: ["persian cat care cost"], extract: wikiExtract },
    { topics: ["nowruz haft seen table"], extract: rivalExtract },
  ];

  it("matches by strict distinguishing-token subset, never by one generic word", () => {
    expect(extractsForTopic("Persian Cat Care Cost Guide", entries)).toEqual([wikiExtract]);
    // "persian" alone is a stripped generic token on this tenant vocabulary
    expect(extractsForTopic("Persian Carpets", entries)).toEqual([]);
  });

  it("dedupes by URL and caps at 5", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      topics: ["cat cost"],
      extract: { ...wikiExtract, url: `https://site${i}.com/cat-cost` },
    }));
    const out = extractsForTopic("cat cost", [...many, { topics: ["cat cost"], extract: many[0]!.extract }]);
    expect(out).toHaveLength(5);
  });
});

describe("toInfoGainSummary", () => {
  it("keeps the verdict, sentence and counts", () => {
    const r = scoreInfoGain(addingDraft, [wikiExtract, rivalExtract]);
    const s = toInfoGainSummary(r);
    expect(s.verdict).toBe(r.verdict);
    expect(s.sentence).toBe(r.sentence);
    expect(s.novelFactCount).toBe(r.novelFactSentences.length);
  });
});
