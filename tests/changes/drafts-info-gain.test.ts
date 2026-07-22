/**
 * Info-gain gate + first-mention check (Core 100K Phase 6 merge of
 * src/domains/drafts/info-gain-gate.test.ts + first-mention-check.test.ts,
 * trimmed to boundary cases).
 *
 * Pins: a create-page move that would mostly repeat the winning pages is
 * dropped (or reclassified to an edit when we already own a URL); a thin
 * addition demotes below every adds_something row; unchecked evidence is
 * honest, never faked; sentences never carry an em/en dash; and the J-70
 * first-mention rule is soft and fails OPEN on config mistakes.
 */
import { describe, it, expect } from "vitest";

import {
  scoreInfoGain,
  gateCreatePageInfoGain,
  buildCreatePageInfoGainInputs,
  parseBriefForInfoGain,
  type CompetitorExtract,
  type InfoGainDraft,
  type InfoGainMoveInput,
} from "@/domains/drafts/info-gain-gate";
import { checkFirstMention, type FirstMentionConfig } from "@/domains/drafts/first-mention-check";
import type { MoveCandidate } from "@/domains/demand-graph/build-graph";

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

const duplicateDraft: InfoGainDraft = {
  title: "Persian cat",
  outline: ["Breed history", "Coat and appearance", "Health problems", "Grooming"],
  answer: "The Persian cat is a long haired breed with a round face. Grooming the coat matters for health.",
  faqQuestions: [],
};

describe("scoreInfoGain", () => {
  it("returns adds_something with >= 2 novel sections and names the strongest contribution", () => {
    const r = scoreInfoGain(addingDraft, [wikiExtract, rivalExtract], { topicLabel: "Persian cats" });
    expect(r.verdict).toBe("adds_something");
    expect(r.novelSections).toContain("Monthly care cost table");
    expect(r.sentence).toContain("the strongest new contribution is");
    expect(r.sourceCount).toBe(2);
  });

  it("returns duplicate_of_serp when nothing is novel, naming the strongest overlap", () => {
    const r = scoreInfoGain(duplicateDraft, [wikiExtract, rivalExtract], { topicLabel: "Persian cats" });
    expect(r.verdict).toBe("duplicate_of_serp");
    expect(r.novelSections).toEqual([]);
    expect(r.sentence).toContain("would mostly repeat what en.wikipedia.org already says about Persian cats");
  });

  it("returns thin_addition with exactly one new angle, named in the sentence", () => {
    const draft: InfoGainDraft = {
      title: "Persian cat",
      outline: ["Breed history", "Health problems", "Monthly care cost table"],
      answer: "The Persian cat is a long haired breed. Grooming the coat matters for health.",
    };
    const r = scoreInfoGain(draft, [wikiExtract, rivalExtract], { topicLabel: "Persian cats" });
    expect(r.verdict).toBe("thin_addition");
    expect(r.sentence).toContain("the one new angle is");
  });

  it("is unchecked with no teardown evidence, and with no draft (honest, never faked)", () => {
    const noEvidence = scoreInfoGain(addingDraft, []);
    expect(noEvidence.verdict).toBe("unchecked");
    expect(noEvidence.sentence).toContain("I have not read the winning pages");
    const noDraft = scoreInfoGain(null, [wikiExtract]);
    expect(noDraft.verdict).toBe("unchecked");
  });

  it("never emits an em or en dash in any sentence", () => {
    for (const r of [
      scoreInfoGain(addingDraft, [wikiExtract, rivalExtract]),
      scoreInfoGain(duplicateDraft, [wikiExtract]),
      scoreInfoGain(addingDraft, []),
      scoreInfoGain(null, [wikiExtract]),
    ]) {
      expect(r.sentence).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

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
    expect(gated.changes[0]).toMatchObject({ demandKey: "gap:dup", action: "dropped", verdict: "duplicate_of_serp" });
  });

  it("reclassifies a duplicate to edit_page when an owned URL is known", () => {
    const dup = move({ demandKey: "gap:dup", ownedUrl: "https://iranopedia.com/persian-cats" });
    const inputs = new Map<string, InfoGainMoveInput>([
      ["gap:dup", { draft: duplicateDraft, extracts: [wikiExtract] }],
    ]);
    const gated = gateCreatePageInfoGain([dup], inputs);
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
    expect(thinOut.score).toBeLessThan(addsOut.score);
    expect(gated.moves.indexOf(addsOut)).toBeLessThan(gated.moves.indexOf(thinOut));
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

describe("buildCreatePageInfoGainInputs / parseBriefForInfoGain", () => {
  it("joins audits by competitor URL and parses the persisted brief; skips failed audits and malformed briefs", () => {
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
    expect(inputs.get("gap:persian-cat")!.extracts).toHaveLength(1);
    expect(inputs.get("gap:persian-cat")!.draft?.title).toBe("Persian Cat Ownership");

    const failedAudits = new Map([
      ["https://en.wikipedia.org/wiki/Persian_cat", { url: "https://en.wikipedia.org/wiki/Persian_cat", fetchStatus: "blocked_robots", facts: null }],
    ]);
    const badDrafts = new Map([["gap:persian-cat::create_page_brief", { content: "not json {" }]]);
    const skipped = buildCreatePageInfoGainInputs({ moves: [move()], auditsByUrl: failedAudits, drafts: badDrafts });
    expect(skipped.get("gap:persian-cat")!.extracts).toEqual([]);
    expect(skipped.get("gap:persian-cat")!.draft).toBeNull();
    expect(parseBriefForInfoGain(undefined)).toBeNull();
  });
});

describe("checkFirstMention (W5, J-70)", () => {
  const PERSIAN: FirstMentionConfig = { native: "؀-ۿ", transliteration: false, englishContext: false };

  it("no config or empty text = always ok; a malformed native range never blocks (fails open)", () => {
    expect(checkFirstMention("Nowruz is the Persian new year.", null)).toEqual({ ok: true });
    expect(checkFirstMention("", PERSIAN)).toEqual({ ok: true });
    const bad: FirstMentionConfig = { native: "\\", transliteration: false, englishContext: false };
    expect(checkFirstMention("Some text with no script at all.", bad)).toEqual({ ok: true });
  });

  it("misses when the FIRST sentence has no native-script spelling; passes when it carries it", () => {
    const miss = checkFirstMention("Nowruz is the Persian new year, celebrated every spring.", PERSIAN);
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.reason).toContain("native-script");
    expect(checkFirstMention("نوروز is the Persian new year.", PERSIAN)).toEqual({ ok: true });
    // Only the FIRST sentence counts.
    expect(checkFirstMention("This page covers Persian holidays broadly. نوروز is one of them.", PERSIAN).ok).toBe(false);
  });

  it("transliteration and english-context requirements hold at their boundaries", () => {
    const withTranslit: FirstMentionConfig = { native: "؀-ۿ", transliteration: true, englishContext: false };
    expect(checkFirstMention("نوروز (Nowruz) is the Persian new year.", withTranslit)).toEqual({ ok: true });
    const bare = checkFirstMention("نوروز.", withTranslit);
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.reason).toContain("transliteration");

    const withGloss: FirstMentionConfig = { native: "؀-ۿ", transliteration: false, englishContext: true };
    expect(checkFirstMention("نوروز (the Persian new year) begins each spring.", withGloss)).toEqual({ ok: true });
    const noGloss = checkFirstMention("نوروز begins each spring across Iran.", withGloss);
    expect(noGloss.ok).toBe(false);
    if (!noGloss.ok) expect(noGloss.reason).toContain("English context");
  });

  it("a miss is ALWAYS soft: only ever ok:true/false with a reason, never a hard-block shape", () => {
    const r = checkFirstMention("Nowruz is the Persian new year.", PERSIAN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(typeof r.reason).toBe("string");
  });
});
