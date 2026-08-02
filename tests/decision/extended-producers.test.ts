/** The four causes that used to reach the operator as a sentence and a shrug: links to somewhere real, sources
 *  and subjects assembled ONLY from evidence already held, a merge that always arrives as a question, and a
 *  rebuild only when the causes agree. Each producer runs on a fixture context and then through the REAL
 *  validator, because copy that cannot survive validate-proposal is not a recommendation. Plus the pin keeping
 *  measurement's private dangerous-kind list equal to decision's, since the guard forbids that import. */
import { describe, it, expect } from "vitest";
import type { BundleComponent, ChangeBundle, ChangeProposal } from "@/domains/decision/contracts";
import { DANGEROUS_COMPONENT_KINDS as DECISION_DANGEROUS } from "@/domains/decision/contracts";
import { DANGEROUS_COMPONENT_KINDS as MEASUREMENT_DANGEROUS } from "@/domains/measurement/proof-gsc/measure-lifecycle";
import type { CauseFinding } from "@/domains/decision/diagnosis";
import { effortMinutesFor, fieldForComponent, type ProducerCtx } from "@/domains/decision/producers/contract";
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
  // The account's own inventory: rain-collection and storm-drains are on topic and UNLINKED (the wins);
  // barrel-sizes and roof-area-calculator are on topic but this page already points at them (excluded);
  // contact is linked and off topic; careers is unlinked and off topic (no shared token, excluded).
  ownedPages: [
    { url: "https://fixture-content.example/rain-collection", title: "Rain collection basics", h1: "Rain collection" },
    { url: "https://fixture-content.example/storm-drains", title: "Storm drains", h1: "Storm drains" },
    { url: "https://fixture-content.example/barrel-sizes", title: "Barrel sizes", h1: "Barrel sizes" },
    { url: "https://fixture-content.example/roof-area-calculator", title: "Roof area calculator", h1: "Roof area" },
    { url: "https://fixture-content.example/contact", title: "Contact us", h1: "Contact" },
    { url: "https://fixture-content.example/careers", title: "Careers", h1: "Careers" },
  ],
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

/** THE PAGE'S OWN WORDS AND THE EVIDENCE, exactly as produce-bundle hands them to a producer component: the
 *  receipt lines and the outline PLUS the whole reading of the winners and this page's own subjects and link
 *  words, since a thing I read is not a thing I invented. Relevance stays this page's topic, never theirs. */
const NOW = new Date("2026-07-25T00:00:00.000Z");
const OUTLINE = ["How much rain a roof collects", "Barrel sizes"];
const RECEIPT_ONLY = [...FACTS, ...OUTLINE, "Rain Barrels"].join(" ");
const GATE_OPTS = {
  pageBodyText: "Rain barrels catch what runs off a roof.",
  evidenceText: [RECEIPT_ONLY, ...PATTERN.commonHeadings.map((h) => h.heading), ...PATTERN.commonEntities.map((e) => e.entity),
    ...PATTERN.questionsAnswered, "Roof area", "Storm", ...LINKS.map((l) => `${l.anchorText} ${l.href}`)].join(" "),
  contextTokens: [...new Set(`${QUERY} Rain Barrels Rain Barrels`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))].sort(),
  now: NOW,
};

/** THE CHANGE A BUNDLE PERSISTS: its FIRST component's own before and after, said back in the one field
 *  vocabulary a stored row carries. Exactly what produce-bundle writes onto the proposal and hands the gate. */
const envelope = (primary: BundleComponent) =>
  ({ kind: "existing_edit" as const, field: fieldForComponent(primary.kind), before: primary.before, after: primary.after });

/** THE PROPOSAL PRODUCTION ACTUALLY GATES, component by component: that envelope, priced by the kind of change
 *  it is, with the page's words alongside. A hardcoded title rewrite gated a proposal this kernel never builds. */
const validate = (components: BundleComponent[], evidenceText?: string): ReturnType<typeof validateProposal> => {
  const primary = components[0]!;
  return validateProposal({
    id: "p", tenantId: TENANT, kind: "existing_edit", pagePath: "/rain-barrels", pageUrl: PAGE_URL, pageLabel: "Rain Barrels",
    primaryQuery: QUERY, opportunityType: "Capture clicks", changeFamily: "single", status: "proposed",
    recommendedChange: envelope(primary),
    whyItMatters: "The title misses the word people search.", estimatedEffortMinutes: effortMinutesFor(primary.kind), riskLevel: "low", confidence: "medium",
    limitations: [], evidence: { query: QUERY, hints: [], evidenceRefCount: 1 }, impactScore: 100, upsidePerMonth: null,
    publish: "manual", createdAt: "2026-07-25T00:00:00.000Z", bundle: bundleOf(components),
  } as ChangeProposal, { ...GATE_OPTS, ...(evidenceText === undefined ? {} : { evidenceText }) });
};

/** THE COMPONENT GATE'S OWN ANSWER, out of the one verdict that also judges the top-level rewrite: every
 *  component refusal ends the same way, in the operator's own words rather than in validator vocabulary. */
const componentRefusals = (v: ReturnType<typeof validateProposal>): string[] =>
  v.reasons.filter((r) => r.endsWith("so I am not putting it in front of you."));

const answered = (c: BundleComponent): boolean => !!c.where && !!c.objective && !!c.mechanism && !!c.measurementPlan;

describe("the causes that had no copy now write one, or refuse in words", () => {
  it("sends the reader to a page this account actually has, and survives the component gate", async () => {
    const out = await produceInternalLinks(ctxOf());
    expect(out.refusal).toBeNull();
    expect(out.components.map((c) => c.kind)).toEqual(["internal_link_add", "internal_link_add"]);
    // deterministic, and FROM THE INVENTORY: destinations this page ALREADY links to
    // (/barrel-sizes, /roof-area-calculator) are never recommended again, the site's own
    // page and somebody else's site never appear, and ties break on the page's own name.
    expect(out.components.map((c) => c.label)).toEqual(["Link to /rain-collection", "Link to /storm-drains"]);
    expect(out.components.every((c) => answered(c) && c.risk === "safe" && c.before === null)).toBe(true);
    expect(out.components[0]!.mechanism).toContain("about 12 of their own pages and this one points to 3");
    // THE COPY ITSELF SURVIVES, not only the component gate: it names this page's own search and opens no
    // sentence on a word the factual firewall cannot place, so the whole change reads as ready.
    const c = out.components[0]!;
    expect(c.after).toBe('I would add this line to the section headed "How much rain a roof collects": if you are working out Rain collection basics, that page walks through it. The words "Rain collection basics guide" then point at /rain-collection, so a reader who came for "rain barrel sizing" has somewhere to go next.');
    expect(componentRefusals(validate(out.components))).toEqual([]);
    expect(validate(out.components).verdict).toBe("ready");
    // and the gate is live: the instruction tail this used to carry is still refused, twice over
    const old = validate([{ ...c, after: 'If you are working out Roof area, that page walks through it. Point the words "Roof area guide" at /roof-area-calculator.' }]);
    expect(old.verdict).toBe("rejected");
    expect(old.reasons.join(" ")).toContain("Rewrite drops the words this page is actually about");
    expect(old.factViolations.join(" ")).toContain('names "Point"');
  });

  it("refuses honestly when no page of this account is named by the evidence", async () => {
    // No inventory on file at all: nothing to send a reader to, and nothing is invented.
    const nowhere = await produceInternalLinks(ctxOf({ ownedPages: [] }));
    expect(nowhere.components).toHaveLength(0);
    expect(nowhere.refusal).toContain("I am not inventing one");
    // An inventory whose pages share no word with this page's subject is the same honest answer.
    const offTopic = await produceInternalLinks(ctxOf({ ownedPages: [{ url: "https://fixture-content.example/careers", title: "Careers", h1: "Careers" }] }));
    expect([offTopic.components.length, offTopic.refusal ?? ""]).toEqual([0, expect.stringContaining("I am not inventing one")]);
    // No body means I cannot see what this page already links to, so a link is a coin flip: none.
    const blind = await produceInternalLinks(ctxOf({ body: null }));
    expect([blind.components.length, blind.refusal!.includes("Tell me the page it should lead to")]).toEqual([0, true]);
  });

  it("assembles a source pack out of claims that belong on the page, never my own numbers", async () => {
    const section = async (i: { heading: string | null }) => ({
      heading: i.heading ?? "Where these claims come from",
      body: "A downspout diverter splits roof water between the drain and the barrel, and the pages being cited explain when one is needed.",
      sources: [{ kind: "manufacturer", detail: "diverter fitting guide" }], containsNumber: false,
    });
    const gap = await produceSourceExpansion(ctxOf({
      finding: finding("ai_citation_gap", { cause: "ai_citation_gap", engine: "ChatGPT", promptText: "what size rain barrel do I need" }),
      draft: { section, internalLink: async () => null },
    }));
    const c = gap.components[0]!;
    // the page already talks about a roof, so only the subject it genuinely lacks is asked for
    expect([gap.components.length, c.kind, c.risk, answered(c)]).toEqual([1, "entity_expansion", "review", true]);
    // THE INVERSION THIS REPAIR EXISTS FOR: fact requirements are claims that belong ON the page,
    // and Beacon's own measurements never appear anywhere in the change.
    expect(c.sourcePack!.factRequirements).toEqual(["Downspout diverter."]);
    expect(c.sourcePack!.sourceRequirements).toEqual(['A source a reader can check for Downspout diverter, of the kind the 3 pages being cited for "rain barrel sizing" point at: a.example, b.example, c.example.']);
    for (const beaconFact of FACTS) expect(JSON.stringify(c)).not.toContain(beaconFact);
    expect(JSON.stringify(c)).not.toContain("6,000");
    expect(JSON.stringify(c)).not.toContain(INVENTED);
    expect(c.after).toBe("Downspout diverter\n\nA downspout diverter splits roof water between the drain and the barrel, and the pages being cited explain when one is needed.");
    expect(componentRefusals(validate(gap.components))).toEqual([]);
    expect(validate(gap.components).verdict).toBe("ready");
    // an engine that READ the page and named somebody else is a credibility problem, so it sources
    // what the page ALREADY claims, and the claim comes from the page's own stored words
    const read = await produceSourceExpansion(ctxOf({
      finding: finding("retrieved_not_cited", { cause: "retrieved_not_cited", engine: "Perplexity", promptText: "best rain barrel size" }),
      draft: { section, internalLink: async () => null },
    }));
    expect([read.components[0]!.kind, read.components[0]!.mechanism!.includes("seen and passed over")]).toEqual(["source_update", true]);
    expect(read.components[0]!.sourcePack!.factRequirements).toEqual(["Rain barrels catch what runs off a roof."]);
    for (const beaconFact of FACTS) expect(JSON.stringify(read.components[0])).not.toContain(beaconFact);
    // a refused draft is a refusal, never filler
    const dry = await produceSourceExpansion(ctxOf({ finding: finding("ai_citation_gap", { cause: "ai_citation_gap", engine: "ChatGPT", promptText: "what size rain barrel do I need" }) }));
    expect([dry.components.length, dry.refusal ?? ""]).toEqual([0, expect.stringContaining("nothing rather than filler")]);
    expect(validate(read.components).verdict).toBe("ready");
    // no reading of the cited pages = no way to say what kind of source stands up: a refusal, never invention
    const unread = await produceSourceExpansion(ctxOf({ pattern: null,
      finding: finding("retrieved_not_cited", { cause: "retrieved_not_cited", engine: "Perplexity", promptText: "best rain barrel size" }) }));
    expect([unread.components.length, unread.refusal!.includes("I have not read the pages being cited")]).toEqual([0, true]);
    // and no page words plus no missing subject = nothing a source could back
    const empty = await produceSourceExpansion(ctxOf({ body: null,
      pattern: { ...PATTERN, commonEntities: [] },
      finding: finding("retrieved_not_cited", { cause: "retrieved_not_cited", engine: "Perplexity", promptText: "best rain barrel size" }) }));
    expect([empty.components.length, empty.refusal!.includes("I hold nothing this page could say")]).toEqual([0, true]);
  });

  it("hands a merge over as a question the operator answers, never as a paste", async () => {
    const both = await produceConsolidation(ctxOf({ finding: finding("cannibalization", { cause: "cannibalization", competingPaths: [PAGE_URL, "https://fixture-content.example/barrel-sizes"] }) }));
    const c = both.components[0]!;
    expect([c.kind, c.risk, c.before, answered(c)]).toEqual(["consolidation", "dangerous", null, true]);
    // the operator reads their own pages as paths, and the ladder's whole addresses never leak into the copy
    expect(c.after).toContain('2 of your own pages come up for "rain barrel sizing": /rain-barrels, /barrel-sizes');
    expect(c.after).not.toContain("https://");
    expect(c.after).toContain("I am not choosing for you");
    // The change the row would carry IS this component: a merge filed as a section change, never a title rewrite.
    expect(envelope(c)).toEqual({ kind: "existing_edit", field: "section", before: null, after: c.after });
    const held = validate(both.components);
    expect(held.verdict).toBe("needs_review");
    expect(held.reasons.join(" ")).toContain("confirm it before you make the change");
    // when the evidence does say which page holds the stronger position, it says which absorbs which
    const picked = await produceConsolidation(ctxOf({ finding: finding("cannibalization", { cause: "cannibalization", competingPaths: [PAGE_URL, "https://fixture-content.example/barrel-sizes"], strongerPath: PAGE_URL }) }));
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
    expect(componentRefusals(validate(many.components))).toEqual([]);
    expect(validate(many.components).verdict).toBe("ready");
    // and the reading of the winners is what grounds the sections it quotes: hand the gate the receipt lines
    // alone, as production used to, and the second section every winning page covers reads as an invention.
    const narrow = validate(many.components, RECEIPT_ONLY);
    expect(narrow.verdict).toBe("rejected");
    expect(narrow.factViolations.join(" ")).toContain('names "Choosing"');
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
    const unbacked = await produceConsolidation(ctxOf({ finding: { ...finding("cannibalization", { cause: "cannibalization", competingPaths: ["/a", "/b"] }), evidenceKeys: [] } }));
    expect([unbacked.components.length, unbacked.refusal!.includes("cannot show you anything behind this")]).toEqual([0, true]);
  });
});

describe("what a change actually costs the operator", () => {
  it("files and prices a change by the kind of component it is, the ONE map the bundle producer reads", () => {
    // Both maps live beside the contract they speak, so the envelope a test builds and the row production persists
    // are the same envelope. A wrapper that hardcoded a title edit validated something else entirely.
    const kinds: BundleComponent["kind"][] = ["internal_link_add", "full_rewrite", "consolidation", "title", "meta", "h1", "opening_answer", "section_rewrite"];
    expect(kinds.map(fieldForComponent)).toEqual(["section", "section", "section", "title", "meta", "h1", "answer_block", "section"]);
  });

  it("prices the big changes in hours, not the quarter hour every non-wording change used to claim", async () => {
    // Fifteen minutes was the price of every change that was not a reworded line, so merging two pages and
    // rebuilding one read the same on the screen an operator plans from. The number follows what the change IS.
    const merge = await produceConsolidation(ctxOf({ finding: finding("cannibalization", { cause: "cannibalization", competingPaths: [PAGE_URL, "https://fixture-content.example/barrel-sizes"] }) }));
    expect(effortMinutesFor(merge.components[0]!.kind)).toBe(90);
    const rebuild = await produceFullRewriteRecommendation(ctxOf(), ["weak_opening", "incomplete_coverage"]);
    expect(effortMinutesFor(rebuild.components[0]!.kind)).toBe(120);
    // The middle of the range and the floor, so the whole map is inspectable in one place.
    expect([effortMinutesFor("section_rewrite"), effortMinutesFor("section_add"), effortMinutesFor("title")]).toEqual([30, 15, 1]);
  });
});

describe("the two copies of the dangerous-kind list stay equal", () => {
  it("pins measurement's private list against the decision contract", () => {
    // Measurement may not import Decision (foundation guard, kernelForbiddenEdges) and this file may import both.
    // If Decision adds a kind that moves or hides a page, this fails instead of it losing its follow-up checkpoint.
    expect([...MEASUREMENT_DANGEROUS].sort()).toEqual([...DECISION_DANGEROUS].sort());
  });
});
