/** The four causes that used to reach the operator as a sentence and a shrug: links to somewhere real, sources and
 *  subjects assembled ONLY from evidence held, a merge that arrives as a question, a rebuild only when the causes
 *  agree. Each runs on a fixture context and then the REAL validator, plus the pinned dangerous-kind list. */
import { describe, it, expect } from "vitest";
import type { BundleComponent, ChangeBundle, ChangeProposal } from "@/domains/decision/contracts";
import { DANGEROUS_COMPONENT_KINDS as DECISION_DANGEROUS } from "@/domains/decision/contracts";
import { DANGEROUS_COMPONENT_KINDS as MEASUREMENT_DANGEROUS } from "@/domains/measurement/proof-gsc/measure-lifecycle";
import type { CauseFinding } from "@/domains/decision/diagnosis";
import { effortMinutesFor, fieldForComponent, type ProducerCtx } from "@/domains/decision/producers/contract";
import { produceConsolidation, produceFullRewriteRecommendation, produceInternalLinks, produceSourceExpansion } from "@/domains/decision/producers/extended"; import { CORE_PRODUCERS } from "@/domains/decision/producers/core";
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
const PATTERN: WinningPattern = { archetype: "informational_guide", disagreements: [], uniqueNotCommon: [], winners: 3, fingerprint: "fp",
  commonHeadings: [{ heading: "How much water a roof collects", seenOn: [0, 1] }, { heading: "Choosing a barrel size", seenOn: [0, 2] }],
  commonEntities: [{ entity: "Roof area", seenOn: [0] }, { entity: "Downspout diverter", seenOn: [0, 1] }],
  questionsAnswered: ["What size rain barrel do I need?"], openingPattern: "They answer the question in the first line.",
  ownedGaps: [{ gap: "None of this page covers overflow", seenOn: [0] }], publishers: ["a.example", "b.example", "c.example"] };
const LINKS = [["/roof-area-calculator", "roof area"], ["/barrel-sizes", "barrel sizes"], ["/rain-barrels", "this page"],
  ["https://other.example/partner", "our partner"], ["/contact", "read more"]].map(([href, anchorText]) => ({ href: href!, anchorText: anchorText! }));
// The account's own inventory: rain-collection and storm-drains are on topic and UNLINKED (the wins); barrel-sizes
// and roof-area-calculator are already linked; contact is linked and off topic; careers is unlinked and off topic.
const OWNED = [["rain-collection", "Rain collection basics", "Rain collection"], ["storm-drains", "Storm drains", "Storm drains"],
  ["barrel-sizes", "Barrel sizes", "Barrel sizes"], ["roof-area-calculator", "Roof area calculator", "Roof area"],
  ["contact", "Contact us", "Contact"], ["careers", "Careers", "Careers"]].map(([p, title, h1]) => ({ url: `https://fixture-content.example/${p}`, title: title!, h1: h1! }));
const ctxOf = (over: Partial<ProducerCtx> = {}): ProducerCtx => ({
  finding: finding("internal_link_weakness", { cause: "internal_link_weakness", medianWinnerLinks: 12, ownedLinks: 3 }),
  primary: QUERY, tenantId: TENANT, ownedPages: OWNED,
  page: { url: PAGE_URL, title: "Rain Barrels", h1: "Rain Barrels", outline: ["How much rain a roof collects", "Barrel sizes"], internalLinkCount: 3 },
  body: { url: PAGE_URL, title: "Rain Barrels", h1: "Rain Barrels", headings: ["Rain Barrels", "How much rain a roof collects", "Barrel sizes"],
    passages: ["Rain barrels catch what runs off a roof."], openingSample: "Rain barrels catch what runs off a roof.",
    cardTexts: [], faqs: [], entityNames: ["Roof area", "Storm"], internalLinks: LINKS, metaDescription: null,
    fetchedAt: "2026-07-30T00:00:00.000Z", completeness: "sample_only", heldNote: "I hold a sample of this page, not the whole page." },
  pattern: PATTERN, receiptFacts: FACTS, readiness: { gsc: true, ownedCopy: true, serp: true, winners: 3, body: true },
  draft: { section: async () => null,
    internalLink: async (i) => ({ anchorText: `${i.topic} guide`, linkSentence: `If you are working out ${i.topic}, that page walks through it`, reason: "same subject" }) },
  ...over,
});
/** A drafter that writes every section AND the page's own opening: the only shape a rebuild may ever ship on. */
const OPENING = "Rain barrel sizing comes down to roof area and how much rain one storm brings.";
const whole = (refuseAt = -1): ProducerCtx["draft"] => { let n = 0; return { internalLink: async () => null,
  openingAnswer: async () => OPENING,
  section: async (i) => (n++ === refuseAt ? null : { heading: i.heading ?? "Rain barrel sizing", sources: [], containsNumber: false,
    body: `Rain barrel sizing comes down to roof area and how much rain one storm brings, and that is what this part of the page has to say about ${(i.heading ?? "sizing").toLowerCase()}.` }) }; };
const FOUR = ["How much water a roof collects", "Choosing a barrel size", "Storm overflow", "Roof area by pitch"];
const bundleOf = (components: BundleComponent[]): ChangeBundle => ({ objective: "Close the gap on the one search this page is losing.",
  metric: "Clicks over 28 days.", scope: { queries: [QUERY], prompts: [] }, components, alternatives: [], risks: [], confidenceReasons: [],
  receipt: { items: KEYS.map((key) => ({ key, kind: "gsc_demand" as const, fact: FACTS[0]!, observedAt: null })), missing: [], freshestObservedAt: null },
  measurementPlan: "I will read clicks, views and average position at 7, 14 and 28 days." });
/** THE PAGE'S OWN WORDS AND THE EVIDENCE, exactly as produce-bundle hands them to a component: receipt lines, the
 *  outline, the winners' whole reading and this page's own subjects and link words. A thing I read is not invented. */
const NOW = new Date("2026-07-25T00:00:00.000Z");
const OUTLINE = ["How much rain a roof collects", "Barrel sizes"];
const RECEIPT_ONLY = [...FACTS, ...OUTLINE, "Rain Barrels"].join(" ");
const GATE_OPTS = { pageBodyText: "Rain barrels catch what runs off a roof.", now: NOW,
  evidenceText: [RECEIPT_ONLY, ...PATTERN.commonHeadings.map((h) => h.heading), ...PATTERN.commonEntities.map((e) => e.entity),
    ...PATTERN.questionsAnswered, "Roof area", "Storm", ...LINKS.map((l) => `${l.anchorText} ${l.href}`)].join(" "),
  contextTokens: [...new Set(`${QUERY} Rain Barrels Rain Barrels`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))].sort(),
  heldHeadings: ["Rain Barrels", "How much rain a roof collects", "Barrel sizes"] };
/** THE CHANGE A BUNDLE PERSISTS: its FIRST component's before and after, in the one field vocabulary a row carries. */
const envelope = (primary: BundleComponent) =>
  ({ kind: "existing_edit" as const, field: fieldForComponent(primary.kind), before: primary.before, after: primary.after });
/** THE PROPOSAL PRODUCTION ACTUALLY GATES: that envelope, priced by the kind of change it is, page words alongside. */
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
/** THE COMPONENT GATE'S OWN ANSWER: every component refusal ends in the operator's words, never the validator's. */
const componentRefusals = (v: ReturnType<typeof validateProposal>): string[] =>
  v.reasons.filter((r) => r.endsWith("so I am not putting it in front of you."));
const answered = (c: BundleComponent): boolean => !!c.where && !!c.objective && !!c.mechanism && !!c.measurementPlan;
describe("the causes that had no copy now write one, or refuse in words", () => {
  it("says the page already carries them when the held page disproved every absence", async () => {
    const out = await (CORE_PRODUCERS.incomplete_coverage as (c: ProducerCtx) => Promise<{ refusal: string | null }>)(
      ctxOf({ finding: finding("incomplete_coverage", { cause: "incomplete_coverage", absentHeadings: ["Roof area"], absentEntities: [] }) }));
    expect(out.refusal).toBe("I checked the page itself and it already carries what the winning pages cover, so there is nothing to add here."); });
  // MY FIGURES GROUND THE DIAGNOSIS, THEY ARE NEVER PAGE COPY: the link drafter's sentence is published on the
  // operator's page, so a click count was one model call away from being live copy. The hints are the page's own words.
  it("never feeds one of my own numbers to the drafter that writes page copy", async () => {
    const heard: string[] = [];
    const out = await produceInternalLinks(ctxOf({
      // The drafter echoes its hints straight back, so anything handed in lands in the copy and shows here.
      draft: { section: async () => null, internalLink: async (i) => {
        heard.push(...i.evidenceHints ?? []);
        return { anchorText: `${i.topic} guide`, linkSentence: `Working out ${i.topic} means reading ${(i.evidenceHints ?? []).join(" ")}`, reason: "same subject" }; } },
    }));
    expect(heard.length).toBeGreaterThan(0);                       // it is grounded, not starved
    for (const fact of FACTS) expect(heard).not.toContain(fact);
    const copy = out.components.map((c) => c.after).join(" ");
    expect(copy).not.toContain("6,000");                           // the number in the receipt never reaches the page
    expect(copy).not.toContain("90 clicks");
    expect(heard).toContain("Rain Barrels");                       // the page's own words, and the winners' headings
    expect(heard).toContain("How much rain a roof collects");
  });
  // A DOUBLE GAP IS A TYPO ON SOMEBODY'S PAGE: a dash beside a space shipped two. Paragraph breaks survive untouched.
  it("never ships drafted body copy with a run of spaces in it, and never touches a line break", async () => {
    const out = await produceSourceExpansion(ctxOf({
      finding: finding("ai_citation_gap", { cause: "ai_citation_gap", engine: "ChatGPT", promptText: "what size rain barrel do I need" }),
      draft: { internalLink: async () => null, section: async () => ({ heading: "Downspout diverter",
        body: "A diverter splits roof water \u2014 between the drain and the barrel.\n\nThe cited pages  say when one is needed.",
        sources: [], containsNumber: false }) },
    }));
    const after = out.components[0]!.after;
    expect(after).not.toMatch(/ {2}/);              // "a  b" never ships
    expect(after).toContain("barrel.\n\nThe cited");  // and the paragraph break is left exactly where it was
  });
  it("sends the reader to a page this account actually has, and survives the component gate", async () => {
    const out = await produceInternalLinks(ctxOf());
    expect(out.refusal).toBeNull();
    expect(out.components.map((c) => c.kind)).toEqual(["internal_link_add", "internal_link_add"]);
    // deterministic, and FROM THE INVENTORY: pages already linked never return, this page and other sites
    // never appear, and ties break on the page's own name.
    expect(out.components.map((c) => c.label)).toEqual(["Link to /rain-collection", "Link to /storm-drains"]);
    expect(out.components.every((c) => answered(c) && c.risk === "safe" && c.before === null)).toBe(true);
    expect(out.components[0]!.mechanism).toContain("about 12 of their own pages and this one points to 3");
    // THE COPY ITSELF SURVIVES, not only the gate: it names this page's search and opens on no word the firewall cannot place.
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
    // THE INVERSION THIS REPAIR EXISTS FOR: fact requirements are claims that belong ON the page, and my own numbers never do.
    expect(c.sourcePack!.factRequirements).toEqual(["Downspout diverter."]);
    // THE KIND OF SOURCE IS ALL I HOLD HERE: the copy hands the choice over, and the component stays held for review.
    expect(c.sourcePack!.sourceRequirements).toEqual(['Downspout diverter needs a source a reader can check, of the kind the pages being cited for "rain barrel sizing" point at: a.example, b.example, c.example. You pick the exact page: I hold the kind of source this needs and not the source itself.']);
    for (const beaconFact of FACTS) expect(JSON.stringify(c)).not.toContain(beaconFact);
    expect(JSON.stringify(c)).not.toContain("6,000");
    expect(JSON.stringify(c)).not.toContain(INVENTED);
    expect(c.after).toBe("Downspout diverter\n\nA downspout diverter splits roof water between the drain and the barrel, and the pages being cited explain when one is needed.");
    expect(componentRefusals(validate(gap.components))).toEqual([]);
    expect(validate(gap.components).verdict).toBe("ready");
    // an engine that READ the page and named somebody else is a credibility problem, so it sources what the page already claims
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
  /** READY MEANS WHOLE: a rebuild shipping planning sentences under half its copy promised what it did not hold. */
  it("rebuilds a page only when the causes agree, and only when the WHOLE page is written", async () => {
    const one = await produceFullRewriteRecommendation(ctxOf(), ["weak_opening"]);
    expect([one.components.length, one.refusal!.includes("bigger swing than my evidence pays for")]).toEqual([0, true]);
    const causes = ["weak_opening", "incomplete_coverage", "weak_opening"] as const;
    const many = await produceFullRewriteRecommendation(ctxOf({ draft: whole() }), causes);
    const c = many.components[0]!;
    expect([c.kind, c.risk, answered(c)]).toEqual(["full_rewrite", "review", true]);
    // THE COPY IS THE CHANGE: the opening first, then every section the winners agree on, and not one planning sentence.
    expect(c.after.startsWith(OPENING)).toBe(true);
    expect(c.after).toContain("How much water a roof collects");
    expect(c.after).toContain("Choosing a barrel size");
    expect(c.after).not.toContain("still owed");
    expect(c.objective).toContain("a guide that answers the question from end to end");
    expect(c.mechanism).toContain("2 things are wrong at once");
    expect(componentRefusals(validate(many.components))).toEqual([]);
    expect(validate(many.components).verdict).toBe("ready");
    // THE PRESERVATION MAP: what survives the rebuild in its own words, and every held thing it drops named with the reason
    expect(c.preserves!.keeps).toEqual(["Roof area", "Storm"]);
    expect(c.preserves!.losses.map((l) => l.what)).toEqual(["Rain Barrels", "How much rain a roof collects", "Barrel sizes"]);
    expect(c.preserves!.losses.every((l) => l.why.includes(`Not one of the 3 pages that win "${QUERY}" carries it`))).toBe(true);
    // A SECTION IS NEVER DROPPED IN SILENCE: unnamed is refused, and naming it is what makes the same copy shippable
    const silent = validate([{ ...c, preserves: { keeps: [], losses: [] } }]);
    expect([silent.verdict, silent.reasons.some((r) => r === 'The rebuild drops "Barrel sizes" and never says why, so I am not putting it in front of you.')]).toEqual(["rejected", true]);
    // the winners' reading grounds the sections it quotes: on receipt lines alone, a true second section reads as invention
    const narrow = validate(many.components, RECEIPT_ONLY);
    expect(narrow.verdict).toBe("rejected");
    expect(narrow.factViolations.join(" ")).toContain('names "Choosing"');
    // ONE SECTION SHORT IS NO REBUILD: nothing is emitted, the refusal counts what is owed, and resuming costs nothing.
    const four = { pattern: { ...PATTERN, commonHeadings: FOUR.map((heading, i) => ({ heading, seenOn: [i] })) } };
    const partial = await produceFullRewriteRecommendation(ctxOf({ ...four, draft: whole(2) }), causes);
    expect(partial.components).toHaveLength(0);
    expect(partial.refusal).toBe("I could write 3 of the 4 sections this rebuild needs and 1 is still owed, so I am not handing you half a page. Ask me again and I will pick up where I stopped: the sections I already wrote cost nothing to ask for a second time.");
    // and a page whose sections all landed with no opening to lead them is still not a page
    const mute = await produceFullRewriteRecommendation(ctxOf({ draft: { ...whole(), openingAnswer: async () => null } }), causes);
    expect([mute.components.length, mute.refusal!.includes("no way in")]).toEqual([0, true]);
    // no reading of the pages that win means no rebuild, however many causes fired
    const blind = await produceFullRewriteRecommendation(ctxOf({ pattern: null, draft: whole() }), causes);
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
  // ONE map for the field a kind writes into, ONE for what it costs: the envelope a test builds is the one production
  // persists, and a merge and a whole rebuild are not one price.
  it("files and prices a change by the kind of component it actually is", async () => {
    const kinds: BundleComponent["kind"][] = ["internal_link_add", "full_rewrite", "consolidation", "title", "meta", "h1", "opening_answer", "section_rewrite"];
    expect(kinds.map(fieldForComponent)).toEqual(["section", "section", "section", "title", "meta", "h1", "answer_block", "section"]);
    const merge = await produceConsolidation(ctxOf({ finding: finding("cannibalization", { cause: "cannibalization", competingPaths: [PAGE_URL, "https://fixture-content.example/barrel-sizes"] }) }));
    const rebuild = await produceFullRewriteRecommendation(ctxOf({ draft: whole() }), ["weak_opening", "incomplete_coverage"]);
    expect([merge.components[0]!.kind, rebuild.components[0]!.kind].map(effortMinutesFor)).toEqual([90, 120]);
    expect([effortMinutesFor("section_rewrite"), effortMinutesFor("section_add"), effortMinutesFor("title")]).toEqual([30, 15, 1]);
  });
  // Measurement may not import Decision (guard), so its private dangerous-kind list is pinned here instead.
  it("pins measurement's private dangerous-kind list against the decision contract", () => {
    expect([...MEASUREMENT_DANGEROUS].sort()).toEqual([...DECISION_DANGEROUS].sort());
  });
});
