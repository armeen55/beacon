import { describe, it, expect, vi } from "vitest";
import { DANGEROUS_COMPONENT_KINDS as DECISION_DANGEROUS, PublicationUnitsSchema, type BundleComponent, type ChangeBundle, type ChangeProposal } from "@/domains/decision/contracts";
import { DANGEROUS_COMPONENT_KINDS as MEASUREMENT_DANGEROUS } from "@/domains/measurement/proof-gsc/measure-lifecycle";
import type { CauseFinding } from "@/domains/decision/diagnosis"; import { effortMinutesFor, fieldForComponent, type Produced, type ProducerCtx } from "@/domains/decision/producers/contract";
import { produceConsolidation, produceFullRewriteRecommendation, produceSourceExpansion } from "@/domains/decision/producers/extended"; import { CORE_PRODUCERS } from "@/domains/decision/producers/core";
import { draftFieldForPage } from "@/domains/decision/drafted-copy"; import { pageHashOf } from "@/domains/evidence/pages/fact-check-run";
import type { WinningPattern } from "@/domains/decision/winning-pattern";
import { validateProposal } from "@/domains/decision/validate-proposal";
import { claimTypeOf, deriveSupport } from "@/domains/evidence/pages/claim-support";
import type { OwnedPageBody } from "@/domains/evidence/pages/owned-context"; import { RECEIPT } from "@/domains/decision/diagnose"; import { COPY_RULES } from "@/domains/decision/copy-sanitize";
const TENANT = "fixture-tenant";
const QUERY = "rain barrel sizing";
const PAGE_URL = "https://fixture-content.example/rain-barrels";
const FACTS = ["That one search brings this page 6,000 views and 90 clicks.", "This page links to 3 of your own pages."];
const INVENTED = "Rain barrels cost $99 at every hardware store.";
const KEYS = ["links", "ai", "competing"];
const finding = (cause: CauseFinding["cause"], payload?: unknown): CauseFinding => ({ cause, action: null, evidenceKeys: KEYS, competingExplanations: [], notConsidered: [],
    falsifier: "If my next look shows something else, this is not the explanation.", explanation: "This is what I found.", ...(payload === undefined ? {} : { payload }) }) as CauseFinding;
const PATTERN: WinningPattern = { archetype: "informational_guide", disagreements: [], uniqueNotCommon: [], winners: 3, fingerprint: "fp",
  commonHeadings: [{ heading: "How much water a roof collects", seenOn: [0, 1] }, { heading: "Choosing a barrel size", seenOn: [0, 2] }],
  commonEntities: [{ entity: "Roof area", seenOn: [0] }, { entity: "Downspout diverter", seenOn: [0, 1] }],
  questionsAnswered: ["What size rain barrel do I need?"], openingPattern: "They answer the question in the first line.",
  ownedGaps: [{ gap: "None of this page covers overflow", seenOn: [0] }], publishers: ["a.example", "b.example", "c.example"] };
const COVERS = [...PATTERN.commonHeadings.map((h) => h.heading), ...PATTERN.questionsAnswered]
  .map((heading) => ({ key: RECEIPT.cover(heading), kind: "winning_page" as const, fact: `Every one of the pages that win "${QUERY}" covers ${heading}.`, observedAt: null }));
const LINKS = [["/roof-area-calculator", "roof area"], ["/barrel-sizes", "barrel sizes"], ["/rain-barrels", "this page"],
  ["https://other.example/partner", "our partner"], ["/contact", "read more"]].map(([href, anchorText]) => ({ href: href!, anchorText: anchorText! }));
const OWNED = [["rain-collection", "Rain collection basics", "Rain collection"], ["storm-drains", "Storm drains", "Storm drains"],
  ["barrel-sizes", "Barrel sizes", "Barrel sizes"], ["roof-area-calculator", "Roof area calculator", "Roof area"],
  ["contact", "Contact us", "Contact"], ["careers", "Careers", "Careers"]].map(([p, title, h1]) => ({ url: `https://fixture-content.example/${p}`, title: title!, h1: h1! }));
const OTHER_URL = "https://fixture-content.example/barrel-sizes";
const CMP = [{ url: PAGE_URL, clicks: 90, impressions: 6000, position: 3 }, { url: OTHER_URL, clicks: 20, impressions: 900, position: 9 }];
const ctxOf = (over: Partial<ProducerCtx> = {}): ProducerCtx => ({ finding: finding("internal_link_weakness", { cause: "internal_link_weakness", medianWinnerLinks: 12, ownedLinks: 3 }),
  primary: QUERY, tenantId: TENANT, ownedPages: OWNED,
  page: { url: PAGE_URL, title: "Rain Barrels", h1: "Rain Barrels", outline: ["How much rain a roof collects", "Barrel sizes"], internalLinkCount: 3 },
  body: { url: PAGE_URL, title: "Rain Barrels", h1: "Rain Barrels", headings: ["Rain Barrels", "How much rain a roof collects", "Barrel sizes"],
    passages: ["Rain barrels catch what runs off a roof."], openingSample: "Rain barrels catch what runs off a roof.", vocabulary: "Rain barrels catch what runs off a roof.",
    cardTexts: [], faqs: [], entityNames: ["Roof area", "Storm"], internalLinks: LINKS, metaDescription: null,
    fetchedAt: "2026-07-30T00:00:00.000Z", completeness: "sample_only", contentHash: null, heldNote: "I hold a sample of this page, not the whole page." },
  pattern: PATTERN, receiptFacts: FACTS, readiness: { gsc: true, ownedCopy: true, serp: true, winners: 3, body: true }, draft: { section: async () => null }, ...over, });
const OTHER_KEY = "fixture-content.example/barrel-sizes";
const HUB = "https://fixture-content.example/rain-barrels", KID = "https://fixture-content.example/rain-barrels/steel-barrels";
const nestedBodies = (): Map<string, OwnedPageBody> => { const b = (over: Partial<OwnedPageBody>): OwnedPageBody => ({ ...ctxOf().body!, completeness: "complete" as const, version: "current", sourceCapture: { version: 1, complete: true, mainHtml: "<main><p>Rain barrels catch what runs off a roof.</p></main>", jsonLd: [] }, ...over } as OwnedPageBody);
  return new Map([["fixture-content.example/rain-barrels", b({ url: HUB, title: "Rain Barrels", h1: "Rain Barrels", headings: ["Rain Barrels", "Steel Rain Barrels", "Wooden Rain Barrels"] })], ["fixture-content.example/rain-barrels/steel-barrels", b({ url: KID, title: "Steel Rain Barrels", h1: "Steel Rain Barrels (Galvanized, 2 Finishes)", headings: ["Steel Rain Barrels (Galvanized, 2 Finishes)"] })]]); };
const nestedSplit = () => finding("cannibalization", { cause: "cannibalization", competingPaths: [HUB, KID], comparison: [{ url: KID, clicks: 90, impressions: 6000, position: 3 }, { url: HUB, clicks: 20, impressions: 900, position: 9 }], survivor: KID });
const duplicate = "Rain barrels catch what runs off a roof.", capture = { version: 1 as const, complete: true, mainHtml: `<main><h2>Barrel sizes</h2><p>${duplicate}</p></main>`, jsonLd: [] };
const BODIES = new Map([["fixture-content.example/rain-barrels", { ...ctxOf().body!, title: "Rain barrel sizing guide", h1: "Rain barrel sizing guide", completeness: "complete" as const, version: "current" as const, passages: [duplicate], answerPassages: [duplicate], internalLinks: [], sourceCapture: capture }],
  [OTHER_KEY, { ...ctxOf().body!, url: OTHER_URL, title: "Barrel sizes guide", h1: "Barrel sizes guide", headings: ["Barrel sizes"], completeness: "complete" as const, version: "current" as const, passages: [duplicate], answerPassages: [duplicate], internalLinks: [], sourceCapture: capture }]]);
const OPENING = "Rain barrel sizing comes down to roof area and how much rain one storm brings.";
const wholeCtx = (over: Partial<ProducerCtx> = {}): ProducerCtx => ctxOf({ body: { ...ctxOf().body!, completeness: "complete", version: "current" }, ...over });
it("binds each full-rewrite task to exact current page material before a paid writer", async () => {
  const ctx = wholeCtx(), assigned: NonNullable<ChangeProposal["assignment"]>[] = []; await produceFullRewriteRecommendation({ ...ctx, draft: { ...whole(), section: async input => { assigned.push(input.assignment!); return null; } } }, ["weak_opening", "incomplete_coverage"]);
  expect(assigned).toHaveLength(1); expect(assigned[0]?.atomBindings?.[0]?.evidenceId).toBe("page-title"); expect(assigned[0]?.pageHash).toBe(pageHashOf([ctx.body!.title, ctx.body!.h1, ...ctx.body!.headings, ...ctx.body!.passages].filter(Boolean).join("\n")));
  const tryBody = async (passages: string[]) => { let calls = 0; await draftFieldForPage({ field: "answer_block", body: { ...ctx.body!, passages }, query: QUERY, brief: "answer", evidenceHints: [], ownedPaths: [], minutes: 1, assignment: assigned[0] }, { tenantId: TENANT, now: NOW, complete: (async () => { calls++; return { error: "test stop", retryable: false }; }) as never }); return calls; };
  expect(await tryBody(ctx.body!.passages)).toBeGreaterThan(0); expect(await tryBody(["A different page now discusses only parking lots."])).toBe(0);
});
const whole = (refuseAt = -1): ProducerCtx["draft"] => { let n = 0; return { restore: async piece => piece, compose: (pieces) => { const units: NonNullable<BundleComponent["units"]> = pieces.flatMap((p) => [...(p.heading ? [{ kind: "heading" as const, level: 2, text: p.heading }] : []), { kind: "paragraph" as const, text: p.body }]); return { units, after: COPY_RULES.bodyCopy(units), pieces: pieces.map(p => ({ slot: p.slot, assignment: p.assignment, heading: p.heading, after: p.body, units: [{ kind: "paragraph" as const, text: p.body }], claims: [], supportFacts: [], review: [] })) }; }, openingAnswer: async () => OPENING,
  section: async (i) => (n++ === refuseAt ? null : { heading: i.heading ?? "Rain barrel sizing", sources: [], containsNumber: false,
    body: `Rain barrel sizing comes down to roof area and how much rain one storm brings, and that is what this part of the page has to say about ${(i.heading ?? "sizing").toLowerCase()}.` }) }; };
const PLANNED = ["How much water a roof collects", "Choosing a barrel size", "Storm overflow", "Roof area by pitch", "Rainfall measurement", "Overflow placement", "Winter maintenance", "Choosing a diverter"];
const bundleOf = (components: BundleComponent[]): ChangeBundle => ({ objective: "Close the gap on the one search this page is losing.",
  metric: "Clicks over 28 days.", scope: { queries: [QUERY], prompts: [] }, components, alternatives: [], risks: [], confidenceReasons: [],
  receipt: { items: [...KEYS.map((key) => ({ key, kind: "gsc_demand" as const, fact: FACTS[0]!, observedAt: null })), ...COVERS], missing: [], freshestObservedAt: null },
  measurementPlan: "I will read clicks, views and average position at 7, 14 and 28 days." });
const NOW = new Date("2026-07-25T00:00:00.000Z");
const OUTLINE = ["How much rain a roof collects", "Barrel sizes"];
const RECEIPT_ONLY = [...FACTS, ...OUTLINE, "Rain Barrels"].join(" ");
const GATE_OPTS = { pageBodyText: "Rain barrels catch what runs off a roof.", now: NOW,
  evidenceText: [RECEIPT_ONLY, ...PATTERN.commonHeadings.map((h) => h.heading), ...PATTERN.commonEntities.map((e) => e.entity),
    ...PATTERN.questionsAnswered, "Roof area", "Storm", ...LINKS.map((l) => `${l.anchorText} ${l.href}`)].join(" "),
  contextTokens: [...new Set(`${QUERY} Rain Barrels Rain Barrels`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))].sort(),
  heldHeadings: ["How much rain a roof collects", "Barrel sizes"] };
const envelope = (primary: BundleComponent) =>
  ({ kind: "existing_edit" as const, field: fieldForComponent(primary.kind), before: primary.before, after: primary.after });
const validate = (components: BundleComponent[], evidenceText?: string, over: Partial<ChangeProposal> = {}): ReturnType<typeof validateProposal> => {
  const primary = components[0]!;
  return validateProposal({
    id: "p", tenantId: TENANT, kind: "existing_edit", pagePath: "/rain-barrels", pageUrl: PAGE_URL, pageLabel: "Rain Barrels",
    primaryQuery: QUERY, opportunityType: "Capture clicks", changeFamily: "single", status: "ready",
    recommendedChange: envelope(primary),
    whyItMatters: "The title misses the word people search.", estimatedEffortMinutes: effortMinutesFor(primary.kind), riskLevel: "low", confidence: "medium",
    limitations: [], evidence: { query: QUERY, hints: [], evidenceRefCount: 1 }, impactScore: 100, upsidePerMonth: null,
    publish: "manual", createdAt: "2026-07-25T00:00:00.000Z", bundle: bundleOf(components), ...over,
  } as ChangeProposal, { ...GATE_OPTS, ...(evidenceText === undefined ? {} : { evidenceText }) });};
const componentRefusals = (v: ReturnType<typeof validateProposal>): string[] =>
  v.reasons.filter((r) => r.endsWith("so it stays held rather than offered."));
const answered = (c: BundleComponent): boolean => !!c.where && !!c.objective && !!c.mechanism && !!c.measurementPlan;
const patternSource = (sourceId: string, publisher: string, shape: { list?: boolean; table?: boolean; scope?: "complete" | "partial" | "unknown" } = {}) => ({ sourceId, url: `https://${publisher}/guide`, publisher, passage: "A bounded source passage.", title: null, meta: null, h1: null, opening: null, sections: [], entities: [], list: shape.list ?? false, table: shape.table ?? false, schema: [], links: { internal: null, external: null }, citations: [], freshness: null, scope: shape.scope ?? "complete" });
describe("the causes that had no copy now write one, or refuse in words", () => {
  it("turns a settled distinct-publisher list consensus into structured list work", async () => { const sources = [patternSource("s1", "a.example", { list: true }), patternSource("s2", "b.example", { list: true }), patternSource("s3", "c.example")], brief = { query: QUERY, sources, owned: patternSource("mine", "fixture-content.example"), deltas: [{ dimension: "list", need: "Present the answer as a scannable list", action: "add_structured_list", sources: ["s1", "s2"], confidence: "validated_observation" }], owed: [] } as NonNullable<WinningPattern["brief"]>, units: NonNullable<BundleComponent["units"]> = [{ kind: "unordered_list", items: ["Use roof area to estimate collection.", "Leave a safe route for storm overflow."] }], producer = CORE_PRODUCERS.competitor_content_gap as (c: ProducerCtx) => Promise<{ components: BundleComponent[]; refusal: string | null }>, out = await producer(ctxOf({ body: { ...ctxOf().body!, completeness: "complete", version: "current" }, pattern: { ...PATTERN, archetype: "list", brief }, finding: finding("competitor_content_gap", { cause: "competitor_content_gap", gaps: [{ gap: "show the sizing decisions in order", seenOn: [0, 1], publishers: ["a.example", "b.example"] }] }), draft: { section: async () => ({ heading: "Choose a rain barrel size", body: COPY_RULES.bodyCopy(units), units }) } })), part = out.components[0]!;
    expect([out.components.length, part.kind, part.risk, part.sourcePack, part.after, answered(part)]).toEqual([1, "table_or_list_add", "review", undefined, `Choose a rain barrel size\n\n${COPY_RULES.bodyCopy(units)}`, true]); });
  it("carries an exact table only when three of five complete distinct comparison winners agree and the owned page lacks it", async () => { const sources = [patternSource("s1", "a.example", { table: true }), patternSource("s2", "b.example", { table: true }), patternSource("s3", "c.example", { table: true }), patternSource("s4", "d.example"), patternSource("s5", "e.example")], brief = { query: QUERY, sources, owned: patternSource("mine", "fixture-content.example"), deltas: [], owed: [] } as NonNullable<WinningPattern["brief"]>, units: NonNullable<BundleComponent["units"]> = [{ kind: "table", columns: ["Roof area", "Suggested capacity"], rows: [["Small roof", "One barrel"], ["Large roof", "Linked barrels"]] }], producer = CORE_PRODUCERS.competitor_content_gap as (c: ProducerCtx) => Promise<{ components: BundleComponent[]; refusal: string | null }>, run = (over: Partial<WinningPattern> = {}, sourceRows = sources) => producer(wholeCtx({ pattern: { ...PATTERN, archetype: "comparison", brief: { ...brief, sources: sourceRows }, ...over }, finding: finding("competitor_content_gap", { cause: "competitor_content_gap", gaps: [{ gap: "compare roof area with storage capacity", seenOn: [0, 1, 2], publishers: ["a.example", "b.example", "c.example"] }] }), draft: { section: async () => ({ heading: "Capacity by roof area", body: COPY_RULES.bodyCopy(units), units }) } })), good = await run(), part = good.components[0]!; expect([part.kind, part.units, part.sourcePack]).toEqual(["table_or_list_add", units, undefined]);
    expect(PublicationUnitsSchema.safeParse([{ kind: "table", columns: ["A", "B"], rows: [["one"]] }]).success).toBe(false); for (const bad of [await run({}, [...sources.slice(0, 2), patternSource("s3", "www.b.example", { table: true }), ...sources.slice(3)]), await run({}, [patternSource("s1", "a.example", { table: true }), patternSource("s2", "b.example", { table: true }), patternSource("s3", "c.example", { table: true, scope: "partial" })]), await run({ archetype: "informational_guide" })]) expect(bad.components.some((c) => c.kind === "table_or_list_add")).toBe(false); });
  it("emits only exact evidenced removal, restructure, anchor and navigation actions", async () => { const para: NonNullable<BundleComponent["units"]> = [{ kind: "paragraph", text: "Choose capacity from roof area and overflow needs." }], shape = await (CORE_PRODUCERS.serp_shape_shift as (c: ProducerCtx) => Promise<{ components: BundleComponent[] }>)(wholeCtx({ page: { ...ctxOf().page, outline: ["Sizing", "Overflow", "Overflow"] }, body: { ...wholeCtx().body!, headings: ["Sizing", "Overflow", "Overflow"] }, finding: finding("serp_shape_shift", { cause: "serp_shape_shift", ownShape: "guide", settledShape: "comparison" }), draft: { section: async () => ({ heading: "Sizing", body: COPY_RULES.bodyCopy(para), units: para }) } })), linkProducer = CORE_PRODUCERS.internal_link_weakness as (c: ProducerCtx) => Promise<Produced>, anchor = await linkProducer(wholeCtx({ body: { ...wholeCtx().body!, internalLinks: [{ href: "/barrel-sizes", anchorText: "Read more" }] } })), navigation = await linkProducer(wholeCtx({ primary: "rain barrel sizing", templateHeadings: new Set(["Related guides"]), body: { ...wholeCtx().body!, headings: ["Sizing", "Related guides"], internalLinks: [] }, ownedPages: [{ url: "https://fixture-content.example/sizing", title: "Rain barrel sizing", h1: "Rain barrel sizing" }] })); expect(shape.components.map((c) => [c.kind, c.before])).toEqual([["restructure", "Sizing"], ["section_remove", "Overflow"]]); expect([anchor.components[0]!.kind, anchor.components[0]!.before, anchor.components[0]!.anchorAfter]).toEqual(["anchor_text", "Read more", "Barrel sizes"]); expect([navigation.components[0]!.kind, navigation.components[0]!.where, navigation.operatorSteps?.length]).toEqual(["navigation", 'inside the existing navigation block "Related guides"', 1]);
    expect((await linkProducer(ctxOf())).components).toHaveLength(0); expect((await (CORE_PRODUCERS.serp_shape_shift as (c: ProducerCtx) => Promise<{ components: BundleComponent[] }>)(ctxOf())).components).toHaveLength(0); });
  it("says the page already carries them when the held page disproved every absence", async () => {
    const out = await (CORE_PRODUCERS.incomplete_coverage as (c: ProducerCtx) => Promise<{ refusal: string | null }>)(
      ctxOf({ finding: finding("incomplete_coverage", { cause: "incomplete_coverage", absentHeadings: ["Roof area"], absentEntities: [] }) }));
    expect(out.refusal).toBe("The page itself already carries what the winning pages cover, so there is nothing to add here."); });
  it("never buys or ships source-expansion copy before the claim-level source is resolved", async () => { let drafted = 0; const out = await produceSourceExpansion(ctxOf({ finding: finding("ai_citation_gap", { cause: "ai_citation_gap", engine: "ChatGPT", promptText: "what size rain barrel do I need" }), draft: { section: async () => (drafted += 1, { heading: "Downspout diverter", body: "Unresolved copy must never ship." }) } })); expect([out.components.length, drafted, out.refusal]).toEqual([0, 0, expect.stringContaining("owes a verified source")]); });
  it("never broadens a child onto its own hub's search", async () => {
    const broad = async (i: { body: OwnedPageBody }) => ({ before: i.body.title, after: "Rain Barrels: Sizes, Materials & Full Buying Guide", anchor: "top", heading: null, minutes: 5 });
    const out = await produceConsolidation(ctxOf({ heldBodies: nestedBodies(), draft: { ...ctxOf().draft, pageField: broad }, finding: nestedSplit() }));
    const onKid = (out.components ?? []).filter((c) => c.page === "/rain-barrels/steel-barrels");
    expect(onKid.map((c) => c.after)).not.toContain("Rain Barrels: Sizes, Materials & Full Buying Guide");
    expect(new Set((out.dispositions ?? []).map((d) => d.page))).toEqual(new Set(["/rain-barrels", "/rain-barrels/steel-barrels"]));
    const narrow = async (i: { body: OwnedPageBody }) => ({ before: i.body.title, after: "Steel Rain Barrels: Galvanized Finishes, Sizes & Care", anchor: "top", heading: null, minutes: 5 });
    const kept = await produceConsolidation(ctxOf({ heldBodies: nestedBodies(), draft: { ...ctxOf().draft, pageField: narrow }, finding: nestedSplit() }));
    expect((kept.components ?? []).some((c) => c.page === "/rain-barrels/steel-barrels" && c.after === "Steel Rain Barrels: Galvanized Finishes, Sizes & Care")).toBe(true); });
  /** A CARD IS ABOUT ONE PAGE AND ITS CHANGE IS A CHANGE TO THAT PAGE. The row persists ONE recommendedChange taken from the first component while the headline and address come from the page the card is filed on, so a bundle whose only piece was on /iran-flags got STORED under /iran-flags/iran-islamic-republic-flag-history and would have read "Update the title on [the child]" above the hub's broad wording. Live proof of the harm: that exact row sat in production reading "Iran Flag History: Meaning, Colors & Full Timeline" under the child's address. */
  it("hands over nothing when the only wording that came back is for another page", async () => {
    const elsewhere = async (i: { body: OwnedPageBody }) => (i.body.url === KID ? { before: i.body.title, after: "Steel Rain Barrels: Galvanized Sizes & Care", anchor: "top", heading: null, minutes: 5 } : null);
    const out = await produceConsolidation(ctxOf({ heldBodies: nestedBodies(), draft: { ...ctxOf().draft, pageField: elsewhere }, finding: nestedSplit() })); expect(out.components).toHaveLength(0);
    expect(out.refusal).toContain("The only wording that came back is for /rain-barrels/steel-barrels, not for this page");
    expect(new Set((out.dispositions ?? []).map((d) => d.page))).toEqual(new Set(["/rain-barrels", "/rain-barrels/steel-barrels"])); }); // the other page's decision is still on the record, never silently dropped
  it("assembles a source pack only from resolved claim-level sources, never my own measurements", async () => {
    const fact = (subject: string, proposed: string, url: string) => { const page = "/rain-barrels", statementKey = subject.toLowerCase(), kind = "encyclopedia" as const, support = deriveSupport({ tenantId: TENANT, page, statementKey, pageLocator: "missing", subject, claimKind: claimTypeOf(subject, proposed, "missing"), current: "", proposed, url, kind, quote: proposed, titleContext: null }); expect(support, "the fixture must carry a valid current artifact for its exact claim").not.toBeNull(); return { page, statementKey, subject, current: "", proposed, literal: null, usage: null, sources: [{ url, kind, says: proposed, support: support! }], agreement: "single_source" as const, confidence: "likely" as const, verdict: "page_correct" as const, alsoAt: [], note: "", pageContentHash: null, pageLocator: "missing", sourceReadAt: "2026-09-01T00:00:00.000Z", state: "checked" as const, rulesVersion: 4, evidenceBasis: null, checkedAt: "2026-09-01T00:00:00.000Z" }; };
    const good = fact("Downspout diverter", "A downspout diverter directs roof water between a drain and a barrel.", "https://reference.example/diverters");
    const stale = { ...good, statementKey: "downspout diverter earlier reading", sources: [{ ...good.sources[0]!, support: undefined }] };
    const { authorizedCorrections } = await import("@/domains/evidence/pages/fact-checks");
    expect(authorizedCorrections([stale, good], undefined, TENANT)).toHaveLength(2);
    vi.resetModules(); vi.doMock("@/domains/evidence/pages/fact-checks", async (a) => ({ ...(await a<Record<string, unknown>>()), readFactChecks: async () => [stale, good, fact("Rain barrels", "Rain barrels catch what runs off a roof.", "https://reference.example/barrels")] })); const sourceExpansion = (await import("@/domains/decision/producers/extended")).produceSourceExpansion;
    const hints: string[][] = [], section = async (i: { heading: string | null; evidenceHints: string[] }) => (hints.push(i.evidenceHints), { heading: i.heading ?? "Where these claims come from", body: "A downspout diverter splits roof water between the drain and the barrel, and the pages being cited explain when one is needed." }), gap = await sourceExpansion(ctxOf({ finding: finding("ai_citation_gap", { cause: "ai_citation_gap", engine: "ChatGPT", promptText: "what size rain barrel do I need" }), draft: { section } })), read = await sourceExpansion(ctxOf({ finding: finding("retrieved_not_cited", { cause: "retrieved_not_cited", engine: "Perplexity", promptText: "best rain barrel size" }), draft: { section } })), c = gap.components[0]!;
    expect([c.kind, c.sourcePack?.resolved, c.sourcePack?.factRequirements, c.sourcePack?.sourceRequirements[0], componentRefusals(validate(gap.components)), validate(read.components).verdict]).toEqual(["entity_expansion", true, ["A downspout diverter directs roof water between a drain and a barrel."], expect.stringContaining("https://reference.example/diverters"), [], "ready"]); for (const beaconFact of FACTS) expect(JSON.stringify([c, read.components[0]])).not.toContain(beaconFact); expect(JSON.stringify(c)).not.toContain(INVENTED);
    expect(hints[0]?.[0]).toBe(c.sourcePack?.sourceRequirements[0]);
    vi.doUnmock("@/domains/evidence/pages/fact-checks"); vi.resetModules(); });
  it("refuses to buy copy when a current source supports a different predicate about the same subject", async () => {
    const subject = "Rain barrels", proposed = "Rain barrels discharge roof runoff into storm drains.", url = "https://reference.example/runoff", page = "/rain-barrels", statementKey = "rain barrels";
    const support = deriveSupport({ tenantId: TENANT, page, statementKey, pageLocator: "missing", subject, claimKind: claimTypeOf(subject, proposed, "missing"), current: "", proposed, url, kind: "encyclopedia", quote: proposed, titleContext: null });
    expect(support).not.toBeNull();
    const fact = { page, statementKey, subject, current: "", proposed, literal: null, usage: null, sources: [{ url, kind: "encyclopedia" as const, says: proposed, support: support! }], agreement: "single_source" as const, confidence: "likely" as const, verdict: "page_correct" as const, alsoAt: [], note: "", pageContentHash: null, pageLocator: "missing", sourceReadAt: "2026-09-01T00:00:00.000Z", state: "checked" as const, rulesVersion: 4, evidenceBasis: null, checkedAt: "2026-09-01T00:00:00.000Z" };
    const { authorizedCorrections } = await import("@/domains/evidence/pages/fact-checks");
    expect(authorizedCorrections([fact], undefined, TENANT)).toHaveLength(1);
    vi.resetModules(); vi.doMock("@/domains/evidence/pages/fact-checks", async (actual) => ({ ...(await actual<Record<string, unknown>>()), readFactChecks: async () => [fact] }));
    let drafted = 0;
    const sourceExpansion = (await import("@/domains/decision/producers/extended")).produceSourceExpansion;
    const out = await sourceExpansion(ctxOf({ finding: finding("retrieved_not_cited", { cause: "retrieved_not_cited", engine: "Perplexity", promptText: "how do rain barrels retain water" }), draft: { section: async () => (drafted += 1, { heading: "Rain barrels", body: "Copy that cannot be sourced." }) } }));
    expect([out.components.length, drafted, out.refusal]).toEqual([0, 0, expect.stringContaining("owes a verified source")]);
    vi.doUnmock("@/domains/evidence/pages/fact-checks"); vi.resetModules();
  });
  /** TWO PAGES ON ONE SEARCH IS A SIGNAL TO INVESTIGATE, never proof the clicks are splitting, and never a decision handed back to the operator: the survivor is proven off inspectable evidence or nothing ships. */
  it("settles a split only when the survivor is proven, and then hands over the exact merge", async () => {
    const split = (over: Record<string, unknown> = {}) => finding("cannibalization", { cause: "cannibalization", competingPaths: [PAGE_URL, OTHER_URL], comparison: [], survivor: null, ...over });
    const merge = (over: Record<string, unknown> = {}, bodies?: typeof BODIES) => produceConsolidation(ctxOf({ finding: split(over), ...(bodies ? { heldBodies: bodies } : {}) }));
    const unproven = await merge(); // no comparison and no survivor: an investigation, not a change, and never a question handed back
    expect([unproven.components.length, unproven.refusal!.includes("nothing here says combine anything")]).toEqual([0, true]); expect(unproven.refusal).not.toMatch(/you pick|choosing for you|stronger position/i);
    expect((await merge({ comparison: CMP })).components).toHaveLength(0); // both pages' numbers, still no proven survivor
    expect((await merge({ comparison: CMP, survivor: PAGE_URL })).components).toHaveLength(0); // a survivor whose losing page I never read claims nothing about what moves
    const proven = await merge({ comparison: CMP, survivor: PAGE_URL }, BODIES); const c = proven.components[0]!; const steps = proven.operatorSteps ?? []; // PROVEN: both pages' numbers, both pages' words, one ahead on both
    expect([c.kind, c.risk, c.before, c.redirectTo, answered(c)]).toEqual(["consolidation", "dangerous", null, "/rain-barrels", true]);
    expect(c.after).toContain('2 of your own pages come up for "rain barrel sizing": /rain-barrels, /barrel-sizes'); expect(c.after).toContain("/rain-barrels earns 90 clicks from that search against 20 on /barrel-sizes");
    expect([steps[0]!.startsWith("Check /rain-barrels already says everything"), c.after.includes("https://"), c.after.endsWith("The risk is high, because a web address changes.")]).toEqual([true, false, true]);
    const hub = await merge({ comparison: CMP, survivor: PAGE_URL }, new Map([...BODIES, [OTHER_KEY, { ...BODIES.get(OTHER_KEY)!, headings: ["Barrel sizes", "Gallons per storm"] }]]));
    expect([hub.components.length, hub.refusal!.includes('carries material /rain-barrels does not: "Gallons per storm"'), /titles and opening lines/.test(hub.refusal!)]).toEqual([0, true, true]);
    expect(c.after).not.toMatch(/I am not choosing for you|you pick|stronger position/i);
    expect(envelope(c)).toEqual({ kind: "existing_edit", field: "section", before: null, after: c.after });
    const held = validate([c], [GATE_OPTS.evidenceText, ...[...BODIES.values()].flatMap((b) => b.headings),
      ...CMP.map((r) => `${r.url} takes ${r.clicks} clicks at about position ${r.position}`)].join(" "), { riskLevel: "high", status: "needs_review" });
    expect([held.verdict, held.reasons.join(" ").includes("confirm it before you make the change")]).toEqual(["needs_review", true]);
    const renamed = await produceConsolidation(ctxOf({ heldBodies: BODIES, finding: { ...finding("cannibalization"), detail: { competingPaths: [PAGE_URL, OTHER_URL], comparison: CMP, survivor: PAGE_URL } } as CauseFinding }));
    expect(renamed.components).toHaveLength(1); });
  /** THE RECEIPT IS THE PROOF. A claim that does not resolve to a line the operator can read is not a claim, one change may not say two things about one page, danger may not ride under a soft label, and a reading I took in June is not what the page says today. Every one of these shipped on one live change. */
  it("refuses a change whose evidence does not resolve, contradicts itself, understates danger, or dates a stale reading as today", () => {
    const link: BundleComponent = { kind: "internal_link_add", label: "Link to your own page", before: null, after: "I would point readers from here on to your page on Barrel sizes.",
      evidenceKeys: ["links"], risk: "safe", where: "the section on sizes", objective: "Give the reader somewhere to go next.",
      mechanism: "The pages that win link on and this one does not.", measurementPlan: "I will read clicks at 7, 14 and 28 days." };
    const bundle = bundleOf([link]); const merge: BundleComponent = { ...link, kind: "consolidation", label: "Settle which page owns this search", risk: "dangerous" };
    expect(validate([{ ...link, evidenceKeys: ["nowhere"] }]).verdict).toBe("rejected"); // a component citing a line that is not there
    const causeMissing = validate([link], undefined, { causeFinding: { ...finding("cannibalization"), evidenceKeys: ["demand-competing"] } });
    expect([causeMissing.verdict, causeMissing.reasons.some((r) => r.includes("evidence that is not on the receipt"))]).toEqual(["rejected", true]);
    expect(validate([link], undefined, { causeFinding: finding("cannibalization") }).verdict).not.toBe("rejected"); // the same cause, citing lines that resolve
    expect(validate([link], undefined, { limitations: ["I do not hold this page's own opening words."], // two stories about one page's words
      bundle: { ...bundle, risks: ["I read this page's stored words, not today's live page, so read each line once."] } }).verdict).toBe("rejected");
    expect([validate([merge]).verdict, validate([merge], undefined, { riskLevel: "high", status: "needs_review" }).verdict]).toEqual(["rejected", "needs_review"]); // danger is priced on the row or refused
    const dated = (observedAt: string | null) => validate([link], undefined, { bundle: { ...bundle, receipt: { ...bundle.receipt, items: [...bundle.receipt.items,
      { key: "copy-current", kind: "page_extract" as const, fact: 'Today the page is titled "Rain Barrels".', observedAt }] } } });
    const stale = dated("2026-06-11T00:00:00.000Z"); // REPLACES the dated-reading rejection: a reading offered as what the page says today no longer takes the whole change out of sight
    expect([stale.verdict, stale.reasons.some((r) => r.includes("2026-06-11")), dated(null).verdict], "the date a reading carries is a caveat the card names, and a stale FACT that contradicts a checked source is still refused by the canon's own entailment").toEqual(["ready", false, "ready"]);
    expect(validate([{ ...link, after: "I read this page's stored words and would point readers on to Barrel sizes." }], undefined, // a contradiction in the copy itself, not only in the notes around it
      { limitations: ["I do not hold this page's full body text, so I checked every draft against its title."] }).verdict).toBe("rejected"); });
  it("refuses on every producer when the finding carries no structured payload", async () => { const sources = await produceSourceExpansion(ctxOf({ finding: finding("ai_citation_gap") })); const merge = await produceConsolidation(ctxOf({ finding: finding("cannibalization") }));
    expect([sources, merge].map(out => [out.components.length, !!out.refusal])).toEqual([[0, true], [0, true]]);
    const unbacked = await produceConsolidation(ctxOf({ finding: { ...finding("cannibalization", { cause: "cannibalization", competingPaths: ["/a", "/b"] }), evidenceKeys: [] } })); expect([unbacked.components.length, unbacked.refusal!.includes("Nothing on file stands behind this")]).toEqual([0, true]); }); });
describe("what a change actually costs the operator", () => {
  it("pins measurement's private dangerous-kind list against the decision contract", () => { // Measurement may not import Decision (guard), so its private dangerous-kind list is pinned here instead.
    expect([...MEASUREMENT_DANGEROUS].sort()).toEqual([...DECISION_DANGEROUS].sort()); }); });
