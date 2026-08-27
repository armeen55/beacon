/** DECISION - one page is not one opportunity. The queue used to drop every non-bundle row on a page as soon as
 *  ANY row there carried a bundle, which hid eight standing rows behind one table-row bundle, three of them
 *  already shown to the operator as Ready. Two changes collide only where what they WRITE collides, and this
 *  pins that boundary from both sides: unrelated mutations on one page all survive, and work that really would
 *  be overwritten still hands over. Pure over the shared kernel definition, so no mock can absorb the answer. */
import { describe, it, expect } from "vitest";
import { mutationFootprint, footprintsOverlap, footprintCovers, footprintKey } from "@/domains/decision/mutation-footprint";
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
  it("a table row, a heading, an explainer, a schema block and a title on ONE page are five changes", () => {
    // The live shape of /farsi-numbers, and the exact set the old page-wide rule collapsed to one.
    const row = withPieces("zero-row", [piece("table_or_list_add", { where: "above the row beginning 1" })]);
    const heading = withPieces("counting_heading", [piece("h1")]);
    const explainer = field("zero_explainer", "section", { primaryQuery: "what is zero in persian" });
    const schema = field("faq_schema", "section", { primaryQuery: "what are persian numerals" });
    const title = field("title_zero_nine", "title");
    const all = [row, heading, explainer, schema, title];
    const clashes = all.flatMap((a, i) => all.slice(i + 1).filter((b) => footprintsOverlap(a, b)).map((b) => [a.id, b.id]));
    expect(clashes, "nothing on this page overwrites anything else on it").toEqual([]);
    expect(new Set(all.map(footprintKey)).size, "and each one is stored under its own key").toBe(5);});

  it("a title bundle and a plain title rewrite still collide", () => {
    // The one thing the page-wide rule got right, and the reason overlap is asked of the footprint and never of the stored text: these two hold DIFFERENT keys and still overwrite the same line.
    const deep = withPieces("title-family", [piece("title"), piece("meta")]);
    const plain = field("title", "title");
    expect(footprintsOverlap(deep, plain)).toBe(true);
    expect(footprintKey(deep)).not.toBe(footprintKey(plain));
    expect(footprintsOverlap(deep, field("h1", "h1")), "a heading is not a title").toBe(false);});

  it("one animal's anchor label does not hide another animal's", () => {
    const anchor = (n: string) => withPieces(`anchor-${n}`, [piece("anchor_text", { where: `the ${n} card on /iran-animals`, after: `${n} facts` })]);
    const [cat, fox] = [anchor("Persian Cat"), anchor("Red Fox")];
    expect(footprintsOverlap(cat, fox)).toBe(false);
    expect(footprintsOverlap(cat, anchor("Persian Cat")), "the same card twice is one change").toBe(true);
    // A whole page of them is a whole page of changes, not one.
    expect(new Set(["Caracal", "Red Fox", "Pallas's Cat", "Caspian Seal"].map((n) => footprintKey(anchor(n)))).size).toBe(4);});

  it("a bundle and a plain card that write different things both stand", () => {
    const linked = withPieces("link-to-hub", [piece("internal_link_add", { where: "after the closing paragraph" }), piece("anchor_text", { where: "the words full Iran flag timeline" })]);
    expect(footprintsOverlap(linked, field("title_lion_sun", "title"))).toBe(false);
    expect(footprintsOverlap(linked, field("image_schema", "section", { primaryQuery: "lion and sun" }))).toBe(false);
    expect(mutationFootprint(linked).size, "a bundle writes one mutation per piece").toBe(2);});

  it("two answers to one question collide, two answers to different questions do not", () => {
    const ask = (q: string) => field(`ans-${q}`, "answer_block", { primaryQuery: q });
    expect(footprintsOverlap(ask("what is zero in persian"), ask("persian in zero is what")), "word order is not a new question").toBe(true);
    expect(footprintsOverlap(ask("what is zero in persian"), ask("how do you count in persian"))).toBe(false);});

  it("a new page collides only with another page for the same demand, never with edits to a page it shares words with", () => {
    // A REAL BRIEF CARRIES A BUNDLE: a title and a meta for a page that does not exist yet. Asking the components
    const brief = (q: string) => withPieces(`brief-${q}`, [piece("title", { after: q }), piece("meta")],
      { kind: "new_page", pagePath: null, pageUrl: null, primaryQuery: q,
        recommendedChange: { kind: "new_page", proposedTitle: q, metaDescription: "m", openingAnswer: "o", outline: [], faqQuestions: [], schemaTypes: [] } });
    expect(footprintsOverlap(brief("hardest language to learn"), brief("learn hardest to language"))).toBe(true);
    expect(footprintsOverlap(brief("hardest language to learn"), brief("easiest language to learn"))).toBe(false);
    expect(footprintsOverlap(brief("persian numbers 0 to 9"), field("title", "title")), "a brief never overwrites an existing page's title").toBe(false);});

  it("what takes the whole page takes everything on it", () => {
    // The deleted page-wide rule covered this pair by accident. Without it the queue would tell the operator to
    // retitle a page it also says to forward away for good.
    const gone = withPieces("redirect", [piece("redirect", { after: "/elsewhere" })]);
    for (const other of [field("t", "title"), field("h", "h1"), withPieces("row", [piece("table_or_list_add", { where: "row 1" })])])
      expect(footprintsOverlap(gone, other), `a redirect must cover ${other.id}`).toBe(true);
    expect(footprintCovers(gone, field("t", "title")), "and it covers it, so it may replace it").toBe(true);
    expect(footprintCovers(field("t", "title"), gone), "while a title rewrite may never replace the redirect").toBe(false);
    expect(footprintsOverlap(gone, field("t", "title", { pagePath: "/somewhere-else" })), "but only on its own page").toBe(false);});

  it("covering is what lets one change replace another, and a bare intersection is not covering", () => {
    // A title-only rewrite intersects a bundle that ALSO moves the canonical and adds a link. Letting it supersede
    // that bundle would throw the rest of the bundle's work away with no receipt saying so.
    const rich = withPieces("rich", [piece("title"), piece("internal_link_add", { where: "footer" })]);
    const thin = field("title", "title");
    expect(footprintsOverlap(rich, thin)).toBe(true);
    expect(footprintCovers(rich, thin), "the bundle writes everything the plain rewrite writes").toBe(true);
    expect(footprintCovers(thin, rich), "the plain rewrite does not write the link").toBe(false);});

  it("one page spelled two ways is one page", () => {
    // The old rule read raw pagePath while everything around it normalized differently, so two spellings of one page silently stopped colliding.
    const a = field("t1", "title", { pagePath: "/Farsi-Numbers/" });
    expect(footprintsOverlap(a, field("t2", "title", { pagePath: "/farsi-numbers" }))).toBe(true);
    expect(footprintsOverlap(a, field("t3", "title", { pagePath: "/other-page" }))).toBe(false);});});
