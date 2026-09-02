/** DECISION - one page is not one opportunity. The queue used to drop every non-bundle row on a page as soon as  ANY row there carried a bundle, which hid eight standing rows behind one table-row bundle, three of them  already shown to the operator as Ready. Two changes collide only where what they WRITE collides, and this  pins that boundary from both sides: unrelated mutations on one page all survive, and work that really would  be overwritten still hands over. Pure over the shared kernel definition, so no mock can absorb the answer. */
import { describe, it, expect } from "vitest";
import { mutationFootprint, footprintsOverlap, footprintCovers, footprintKey, mutationKeyOf } from "@/domains/decision/mutation-footprint";
import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import type { BundleComponent, BundleComponentKind, ChangeProposal } from "@/domains/decision/contracts";
const T = "tenant-fixture";
const P = "/farsi-numbers";
const piece = (kind: BundleComponentKind, over: Partial<BundleComponent> = {}): BundleComponent =>
  ({ kind, label: kind, before: null, after: "x", evidenceKeys: ["k1"], risk: "safe", ...over });
const card = (id: string, over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: `${T}::${P}::existing_edit::${id}`, tenantId: T, kind: "existing_edit", pagePath: P,
  pageUrl: `https://www.example.test${P}`, pageLabel: "Persian numbers", primaryQuery: "persian numbers 0 to 9",
  opportunityType: id, changeFamily: "section", status: "ready", whyItMatters: "w", estimatedEffortMinutes: 1,
  recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "a" },
  riskLevel: "low", confidence: "medium", limitations: [], evidence: { query: "q", hints: [], evidenceRefCount: 1 },
  impactScore: 10, upsidePerMonth: null, basis: "b::d8", publish: "manual", createdAt: "2026-08-26T00:00:00.000Z", ...over,
} as ChangeProposal);
const withPieces = (id: string, cs: BundleComponent[], over: Partial<ChangeProposal> = {}) => card(id, {
  bundle: { objective: "o", metric: "clicks", scope: { queries: ["q"], prompts: [] }, components: cs,
    receipt: { items: [], missing: [], freshestObservedAt: null }, alternatives: [], risks: [],
    confidenceReasons: [], measurementPlan: "m" }, ...over } as Partial<ChangeProposal>);
const field = (id: string, f: string, over: Partial<ChangeProposal> = {}) =>
  card(id, { recommendedChange: { kind: "existing_edit", field: f, before: null, after: "a" }, ...over } as Partial<ChangeProposal>);

describe("what a change actually writes", () => {
  const anchor = (n: string) => withPieces(`anchor-${n}`, [piece("anchor_text", { where: `the ${n} card on /iran-animals`, after: `${n} facts` })]);
  const ask = (q: string) => field(`ans-${q}`, "answer_block", { primaryQuery: q });
  it("keeps every unrelated mutation on one page its own change: five of them, one animal's anchor beside another's, two answers to different questions, and one page spelled two ways", () => {
    const all = [withPieces("zero-row", [piece("table_or_list_add", { where: "above the row beginning 1" })]), withPieces("counting_heading", [piece("h1")]), // the live shape of /farsi-numbers, and the exact set the old page-wide rule collapsed to one
      field("zero_explainer", "section", { primaryQuery: "what is zero in persian" }), field("faq_schema", "section", { primaryQuery: "what are persian numerals" }), field("title_zero_nine", "title")];
    expect([all.flatMap((a, i) => all.slice(i + 1).filter((b) => footprintsOverlap(a, b)).map((b) => [a.id, b.id])), new Set(all.map(footprintKey)).size], "nothing on this page overwrites anything else on it, and each one is stored under its own key").toEqual([[], 5]);
    expect([footprintsOverlap(anchor("Persian Cat"), anchor("Red Fox")), footprintsOverlap(anchor("Persian Cat"), anchor("Persian Cat")), new Set(["Caracal", "Red Fox", "Pallas's Cat", "Caspian Seal"].map((n) => footprintKey(anchor(n)))).size], "one animal's label does not hide another's, the same card twice is one change, and a whole page of them is a whole page of changes").toEqual([false, true, 4]);
    expect([footprintsOverlap(ask("what is zero in persian"), ask("persian in zero is what")), footprintsOverlap(ask("what is zero in persian"), ask("how do you count in persian"))], "word order is not a new question, and a different question is not the same answer").toEqual([true, false]);
    const spelled = field("t1", "title", { pagePath: "/Farsi-Numbers/" }); // the old rule read raw pagePath while everything around it normalized differently, so two spellings of one page silently stopped colliding
    expect([footprintsOverlap(spelled, field("t2", "title", { pagePath: "/farsi-numbers" })), footprintsOverlap(spelled, field("t3", "title", { pagePath: "/other-page" }))], "one page spelled two ways is one page, and another page is another page").toEqual([true, false]); });
  /** THREE SPELLINGS OF ONE KEY LIVED IN THREE FILES (operator, 2026-09-02): this one, the paid plan's own, and the queue's, and they disagreed about how a body topic is written, so money committed to `/p::body::farsi-insults` could never be drawn by the row stored as `farsi insults`. One rule now answers for the money, the coverage, the store and the supersession, and a change that names no page is a defect rather than a key. */
  it("gives the money, the queue and the store ONE name for one mutation, and refuses to name a change that carries no page", () => {
    const rows = [field("t", "title"), field("d", "meta"), field("z", "section", { primaryQuery: "what is zero in persian" }), card("corr", { changeFamily: "factual_correction", recommendedChange: { kind: "existing_edit", field: "section", before: "Darya means beauty", after: "Darya means sea", where: "the Darya entry" } })]; for (const r of rows) expect(DRAFT_BUDGET.keyOf(r), `${r.id} is keyed once`).toBe(r.changeFamily === "factual_correction" ? `${P}::corrections` : mutationKeyOf(r));
    const [a, b] = [card("e1", { recommendedChange: { kind: "existing_edit", field: "section", before: "Darya means beauty", after: "x", where: "the Darya entry" } }), card("e2", { recommendedChange: { kind: "existing_edit", field: "section", before: "Nazanin means hope", after: "y", where: "the Nazanin entry" } })]; expect([footprintsOverlap(a!, b!), new Set([a, b].map((r) => [...mutationFootprint(r!)][0])).size], "two corrections on one page are two mutations, priced as one reading and applied one by one").toEqual([false, 2]);
    expect(() => mutationKeyOf({ pagePath: null, pageUrl: null, recommendedChange: { kind: "existing_edit", field: "title" } }), "a page-less key is a defect in whatever minted the row, never a name two pages can share").toThrow(/carries the page it lands on/);
    const link = field("l", "section", { id: `${T}::${P}::existing_edit::internal_link`, recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Link.", linkTo: "/directors" } }); expect([mutationKeyOf(field("t", "title", { pagePath: "/Farsi-Numbers/" })), DRAFT_BUDGET.keyOf({ pagePath: "/farsi-numbers" }), DRAFT_BUDGET.keyOf(link)], "one page spelled two ways is one page at both doors, a bare object keys the page alone, and a link keys the page it lands on").toEqual([`${P}::title`, P, `${P}::link::/directors`]); });
  it("hands over exactly where what two changes WRITE collides, and only where one of them writes everything the other does", () => {
    const deep = withPieces("title-family", [piece("title"), piece("meta")]), plain = field("title", "title"); // these two hold DIFFERENT keys and still overwrite the same line, which is why overlap is asked of the footprint and never of the stored text
    expect([footprintsOverlap(deep, plain), footprintKey(deep) === footprintKey(plain), footprintsOverlap(deep, field("h1", "h1"))], "a title bundle and a plain title rewrite collide under different keys, and a heading is not a title").toEqual([true, false, false]);
    const linked = withPieces("link-to-hub", [piece("internal_link_add", { where: "after the closing paragraph" }), piece("anchor_text", { where: "the words full Iran flag timeline" })]);
    expect([footprintsOverlap(linked, field("title_lion_sun", "title")), footprintsOverlap(linked, field("image_schema", "section", { primaryQuery: "lion and sun" })), mutationFootprint(linked).size], "a bundle and a plain card that write different things both stand, and a bundle writes one mutation per piece").toEqual([false, false, 2]);
    const rich = withPieces("rich", [piece("title"), piece("internal_link_add", { where: "footer" })]); // a title-only rewrite intersects a bundle that ALSO adds a link; letting it supersede would throw the rest of that bundle away with no receipt
    expect([footprintsOverlap(rich, plain), footprintCovers(rich, plain), footprintCovers(plain, rich)], "covering is what lets one change replace another, and a bare intersection is not covering").toEqual([true, true, false]);
    const gone = withPieces("redirect", [piece("redirect", { after: "/elsewhere" })]); // without this the queue would tell the operator to rewrite a title on a page it is also telling them to redirect
    expect([[field("t", "title"), field("h", "h1"), withPieces("row", [piece("table_or_list_add", { where: "row 1" })])].map((other) => footprintsOverlap(gone, other)), footprintCovers(gone, field("t", "title")), footprintCovers(field("t", "title"), gone), footprintsOverlap(gone, field("t", "title", { pagePath: "/somewhere-else" }))], "what takes the whole page takes everything on it and may replace it, a title rewrite may never replace the redirect, and none of it reaches another page").toEqual([[true, true, true], true, false, false]); });
  it("a new page collides only with another page for the same demand, never with edits to a page it shares words with", () => {
    const brief = (q: string) => withPieces(`brief-${q}`, [piece("title", { after: q }), piece("meta")], // A REAL BRIEF CARRIES A BUNDLE: a title and a meta for a page that does not exist yet
      { kind: "new_page", pagePath: null, pageUrl: null, primaryQuery: q, recommendedChange: { kind: "new_page", proposedTitle: q, metaDescription: "m", openingAnswer: "o", outline: [], faqQuestions: [], schemaTypes: [] } });
    expect([footprintsOverlap(brief("hardest language to learn"), brief("learn hardest to language")), footprintsOverlap(brief("hardest language to learn"), brief("easiest language to learn")), footprintsOverlap(brief("persian numbers 0 to 9"), field("title", "title"))], "one demand is one page however its words are ordered, a different demand is a different page, and a brief never overwrites an existing page's title").toEqual([true, false, false]); });});
