/** The four causes that used to reach the operator as a sentence and a shrug: links to somewhere real, sources
 *  and subjects assembled ONLY from evidence already held, a merge that always arrives as a question, and a
 *  rebuild only when the causes agree. Every producer is run directly on a fixture context and then, where it
 *  produced anything, through the REAL validator, because a component that cannot survive validate-proposal is
 *  not a recommendation. Plus the one pin that keeps measurement's private copy of the dangerous-kind list
 *  equal to decision's, since the guard forbids that import in production code. */
import { describe, it, expect } from "vitest";
import type { BundleComponent, ChangeBundle, ChangeProposal } from "@/domains/decision/contracts";
import { DANGEROUS_COMPONENT_KINDS as DECISION_DANGEROUS } from "@/domains/decision/contracts";
import { DANGEROUS_COMPONENT_KINDS as MEASUREMENT_DANGEROUS } from "@/domains/measurement/proof-gsc/measure-lifecycle";
import type { CauseFinding } from "@/domains/decision/diagnosis";
import type { ProducerCtx } from "@/domains/decision/producers/contract";
import { produceConsolidation, produceFullRewriteRecommendation, produceInternalLinks, produceSourceExpansion } from "@/domains/decision/producers/extended";
import type { WinningPattern } from "@/domains/decision/winning-pattern";
import { validateProposal } from "@/domains/decision/validate-proposal";

const TENANT = "fixture-tenant";
const QUERY = "rain barrel sizing";
const PAGE_URL = "https://fixture-content.example/rain-barrels";
const FACTS = ["That one search brings this page 6,000 views and 90 clicks.", "This page links to 3 of your own pages."];
const INVENTED = "Rain barrels cost $99 at every hardware store.";

const KEYS = ["links", "ai", "competing"];
const finding = (cause: CauseFinding["cause"], payload?: unknown): CauseFinding =>
  ({ cause, action: null, evidenceKeys: KEYS, competingExplanations: [], notConsidered: [],
    falsifier: "If my next look shows something else, this is not the explanation.",
    explanation: "This is what I found.", ...(payload === undefined ? {} : { payload }) }) as CauseFinding;

const PATTERN: WinningPattern = {
  archetype: "informational_guide",
  commonHeadings: [{ heading: "How much water a roof collects", seenOn: [0, 1] }, { heading: "Choosing a barrel size", seenOn: [0, 2] }],
  commonEntities: [{ entity: "Roof area", seenOn: [0] }, { entity: "Downspout diverter", seenOn: [0, 1] }],
  questionsAnswered: ["What size rain barrel do I need?"], openingPattern: "They answer the question in the first line.",
  disagreements: [], ownedGaps: [{ gap: "None of this page covers overflow", seenOn: [0] }], uniqueNotCommon: [],
  winners: 3, publishers: ["a.example", "b.example", "c.example"], fingerprint: "fp",
};

const LINKS = [
  { href: "/roof-area-calculator", anchorText: "roof area" },
  { href: "/barrel-sizes", anchorText: "barrel sizes" },
  { href: "/rain-barrels", anchorText: "this page" },
  { href: "https://other.example/partner", anchorText: "our partner" },
  { href: "/contact", anchorText: "read more" },
];

const ctxOf = (over: Partial<ProducerCtx> = {}): ProducerCtx => ({
  finding: finding("internal_link_weakness", { cause: "internal_link_weakness", medianWinnerLinks: 12, ownedLinks: 3 }),
  primary: QUERY, tenantId: TENANT,
  page: { url: PAGE_URL, title: "Rain Barrels", h1: "Rain Barrels", outline: ["How much rain a roof collects", "Barrel sizes"], internalLinkCount: 3 },
  body: { openingSample: "Rain barrels catch what runs off a roof.", cardTexts: [], entityNames: ["Roof area", "Storm"], internalLinks: LINKS, metaDescription: null },
  pattern: PATTERN, receiptFacts: FACTS, readiness: { gsc: true, ownedCopy: true, serp: true, winners: 3, body: true },
  draft: {
    section: async () => null,
    internalLink: async (i) => ({ anchorText: `${i.topic} guide`, linkSentence: `If you are working out ${i.topic}, that page walks through it`, reason: "same subject" }),
  },
  ...over,
});

const bundleOf = (components: BundleComponent[]): ChangeBundle => ({
  objective: "Close the gap on the one search this page is losing.", metric: "Clicks over 28 days.",
  scope: { queries: [QUERY], prompts: [] }, components,
  receipt: { items: KEYS.map((key) => ({ key, kind: "gsc_demand" as const, fact: FACTS[0]!, observedAt: null })), missing: [], freshestObservedAt: null },
  alternatives: [], risks: [], confidenceReasons: [], measurementPlan: "I will read clicks, views and average position at 7, 14 and 28 days.",
});

const validate = (components: BundleComponent[]): ReturnType<typeof validateProposal> => validateProposal({
  id: "p", tenantId: TENANT, kind: "existing_edit", pagePath: "/rain-barrels", pageUrl: PAGE_URL, pageLabel: "Rain Barrels",
  primaryQuery: QUERY, opportunityType: "Capture clicks", changeFamily: "single", status: "proposed",
  recommendedChange: { kind: "existing_edit", field: "title", before: "Rain Barrels", after: "Rain barrel sizing: gallons per storm by roof area" },
  whyItMatters: "The title misses the word people search.", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "medium",
  limitations: [], evidence: { query: QUERY, hints: [], evidenceRefCount: 1 }, impactScore: 100, upsidePerMonth: null,
  publish: "manual", createdAt: "2026-07-25T00:00:00.000Z", bundle: bundleOf(components),
} as ChangeProposal);

const answered = (c: BundleComponent): boolean => !!c.where && !!c.objective && !!c.mechanism && !!c.measurementPlan;

describe("the causes that had no copy now write one, or refuse in words", () => {
  it("sends the reader to a page this account actually has, and survives the validator", async () => {
    const out = await produceInternalLinks(ctxOf());
    expect(out.refusal).toBeNull();
    expect(out.components.map((c) => c.kind)).toEqual(["internal_link_add", "internal_link_add"]);
    // deterministic: the strongest topical match first, never the site's own page and never somebody else's site
    expect(out.components.map((c) => c.label)).toEqual(["Link to /roof-area-calculator", "Link to /barrel-sizes"]);
    expect(out.components.every((c) => answered(c) && c.risk === "safe" && c.before === null)).toBe(true);
    expect(out.components[0]!.mechanism).toContain("about 12 of their own pages and this one points to 3");
    expect(out.components[0]!.after).toContain("Point the words");
    expect(validate(out.components).verdict).not.toBe("rejected");
  });

  it("refuses honestly when no page of this account is named by the evidence", async () => {
    const nowhere = await produceInternalLinks(ctxOf({
      body: { openingSample: null, cardTexts: [], entityNames: [], internalLinks: [{ href: "https://other.example/partner", anchorText: "our partner" }], metaDescription: null },
    }));
    expect(nowhere.components).toHaveLength(0);
    expect(nowhere.refusal).toContain("I am not inventing one");
    const blind = await produceInternalLinks(ctxOf({ body: null }));
    expect([blind.components.length, blind.refusal!.includes("Tell me the page it should lead to")]).toEqual([0, true]);
  });

  it("assembles a source pack out of the supplied evidence and nothing else", async () => {
    const gap = await produceSourceExpansion(ctxOf({
      finding: finding("ai_citation_gap", { cause: "ai_citation_gap", engine: "ChatGPT", promptText: "what size rain barrel do I need" }),
    }));
    const c = gap.components[0]!;
    // the page already talks about a roof, so only the subject it genuinely lacks is asked for
    expect([gap.components.length, c.kind, c.risk, answered(c)]).toEqual([1, "entity_expansion", "review", true]);
    expect(c.sourcePack!.factRequirements.every((f) => FACTS.includes(f))).toBe(true);
    expect(c.sourcePack!.sourceRequirements).toEqual(["A source a reader can check for Downspout diverter."]);
    expect(JSON.stringify(c)).not.toContain(INVENTED);
    expect(JSON.stringify(c)).not.toContain("Roof area");
    expect(validate(gap.components).verdict).not.toBe("rejected");
    // an engine that READ the page and named somebody else is a credibility problem, so it asks for sources
    const read = await produceSourceExpansion(ctxOf({
      finding: finding("retrieved_not_cited", { cause: "retrieved_not_cited", engine: "Perplexity", promptText: "best rain barrel size" }),
    }));
    expect([read.components[0]!.kind, read.components[0]!.mechanism!.includes("seen and passed over")]).toEqual(["source_update", true]);
    expect(read.components[0]!.sourcePack!.factRequirements).toEqual(FACTS);
    // nothing supplied to build a pack out of is a refusal, never an invented source
    const empty = await produceSourceExpansion(ctxOf({
      finding: finding("retrieved_not_cited", { cause: "retrieved_not_cited", engine: "Perplexity", promptText: "best rain barrel size" }),
      receiptFacts: [], pattern: null,
    }));
    expect([empty.components.length, empty.refusal!.includes("I hold nothing checkable to add")]).toEqual([0, true]);
  });

  it("hands a merge over as a question the operator answers, never as a paste", async () => {
    const both = await produceConsolidation(ctxOf({
      finding: finding("cannibalization", { cause: "cannibalization", competingPaths: [PAGE_URL, "https://fixture-content.example/barrel-sizes"] }),
    }));
    const c = both.components[0]!;
    expect([c.kind, c.risk, c.before, answered(c)]).toEqual(["consolidation", "dangerous", null, true]);
    // the operator reads their own pages as paths, and the ladder's whole addresses never leak into the copy
    expect(c.after).toContain('2 of your own pages come up for "rain barrel sizing": /rain-barrels, /barrel-sizes');
    expect(c.after).not.toContain("https://");
    expect(c.after).toContain("I am not choosing for you");
    const held = validate(both.components);
    expect(held.verdict).toBe("needs_review");
    expect(held.reasons.join(" ")).toContain("confirm it before you make the change");
    // when the evidence does say which page holds the stronger position, it says which absorbs which
    const picked = await produceConsolidation(ctxOf({
      finding: finding("cannibalization", { cause: "cannibalization", competingPaths: [PAGE_URL, "https://fixture-content.example/barrel-sizes"], strongerPath: PAGE_URL }),
    }));
    expect(picked.components[0]!.after).toContain("/rain-barrels holds the stronger position");
    // the payload is read by SHAPE, so the ladder may carry it under any field name and a producer still reads it
    const renamed = await produceConsolidation(ctxOf({ finding: { ...finding("cannibalization"), detail: { competingPaths: ["/a", "/b"] } } as CauseFinding }));
    expect(renamed.components).toHaveLength(1);
  });

  it("rebuilds a page only when the causes agree, and writes the brief off the winners", async () => {
    const one = await produceFullRewriteRecommendation(ctxOf(), ["weak_opening"]);
    expect([one.components.length, one.refusal!.includes("bigger swing than my evidence pays for")]).toEqual([0, true]);
    const many = await produceFullRewriteRecommendation(ctxOf(), ["weak_opening", "incomplete_coverage", "weak_opening"]);
    const c = many.components[0]!;
    expect([c.kind, c.risk, answered(c)]).toEqual(["full_rewrite", "review", true]);
    expect(c.after).toContain("a guide that answers the question from end to end");
    expect(c.after).toContain("How much water a roof collects");
    expect(c.after).toContain("2 separate things are wrong");
    expect(validate(many.components).verdict).not.toBe("rejected");
    // no reading of the pages that win means no brief, however many causes fired
    const blind = await produceFullRewriteRecommendation(ctxOf({ pattern: null }), ["weak_opening", "incomplete_coverage"]);
    expect([blind.components.length, blind.refusal!.includes("side by side")]).toEqual([0, true]);
  });

  it("refuses on every producer when the finding carries no structured payload", async () => {
    const bare = { finding: finding("internal_link_weakness") };
    const links = await produceInternalLinks(ctxOf(bare));
    const sources = await produceSourceExpansion(ctxOf({ finding: finding("ai_citation_gap") }));
    const merge = await produceConsolidation(ctxOf({ finding: finding("cannibalization") }));
    for (const out of [links, sources, merge]) {
      expect(out.components).toHaveLength(0);
      expect(out.refusal!.length).toBeGreaterThan(20);
      expect(out.refusal!).not.toMatch(/[–—]|payload|null|undefined|experiment|control|baseline|SERP/);
    }
    // a finding with nothing on file behind it never becomes a component, whatever the payload says
    const unbacked = await produceConsolidation(ctxOf({
      finding: { ...finding("cannibalization", { cause: "cannibalization", competingPaths: ["/a", "/b"] }), evidenceKeys: [] },
    }));
    expect([unbacked.components.length, unbacked.refusal!.includes("cannot show you anything behind this")]).toEqual([0, true]);
  });
});

describe("the two copies of the dangerous-kind list stay equal", () => {
  it("pins measurement's private list against the decision contract", () => {
    // Measurement may not import Decision (foundation guard, kernelForbiddenEdges), and this file may import
    // both. If Decision ever adds a kind that moves or hides a page, this fails instead of that change
    // quietly losing its follow-up checkpoint.
    expect([...MEASUREMENT_DANGEROUS].sort()).toEqual([...DECISION_DANGEROUS].sort());
  });
});
