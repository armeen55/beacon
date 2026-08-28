/** THE PROOF BURDEN MATCHES THE PROMISE (operator, 2026-08-28). One composed walk through the canonical door:
 *  a typo repair owes nothing beyond its own diff, a factual correction may narrow and must say so, demand
 *  never chooses words, a missing field survives on banked claims, a pattern claim rides a stored shape,
 *  assistant recurrence authorizes investigation and never copy, and a replacement may not silently drop what
 *  the passage carries. The door is completeness's openHold, the same verdict the queue, Today, the detail
 *  page, Mark done, the promotion chain and the producer sweep all read, so one refusal refuses everywhere. */
import { describe, expect, it, vi } from "vitest";
vi.mock("@/domains/decision/proposal-store", () => ({ loadChangeProposals: async () => store.rows }));
vi.mock("@/domains/measurement/proof-gsc/load-ledger", () => ({ loadProofLedgerCached: async () => null }));
import { unsettledCause } from "@/domains/decision/authorization";
import { openHold } from "@/domains/decision/completeness";
import { loadProposalQueue } from "@/domains/decision/load-proposals";
import { evidenceShortfall, mechanicalRepair, proofOf } from "@/domains/decision/proof";
import { unauthorizedReason } from "@/domains/evidence/pages/fact-checks";
import type { ChangeProposal } from "@/domains/decision/contracts";

const store = vi.hoisted(() => ({ rows: new Map<string, ChangeProposal>() }));
const T = "t";
const row = (id: string, over: Record<string, unknown>): ChangeProposal => ({
  id: `${T}::/p::existing_edit::${id}`, tenantId: T, kind: "existing_edit", pagePath: "/p",
  pageUrl: "https://x.example/p", pageLabel: "P", primaryQuery: "onager", opportunityType: "o",
  changeFamily: "meta", status: "ready", whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low",
  confidence: "medium", limitations: [], evidence: { query: "onager", hints: [], evidenceRefCount: 1 },
  impactScore: 10, upsidePerMonth: null, basis: "b", createdAt: "2026-08-01T00:00:00.000Z", ...over,
} as unknown as ChangeProposal);
const edit = (field: string, before: string | null, after: string, more: Record<string, unknown> = {}) =>
  ({ recommendedChange: { kind: "existing_edit", field, before, after }, ...more });

describe("the proof burden matches the promise, at the one door every surface reads", () => {
  it("scales the evidence each treatment owes, and refuses the promise the evidence never made", async () => {
    // 1. A MARK-ONLY REPAIR IS ITS OWN EVIDENCE: no diagnosis, no results page, and the receipt certifies the
    // marks alone, never the sentence around them.
    const typo = row("typo", edit("meta", "Learn all about the Kerman Rug , where its from.", "Learn all about the Kerman Rug, where it's from."));
    expect(evidenceShortfall(typo)).toBeNull();
    expect(openHold(typo).blocking).toBeNull();
    expect(proofOf(typo).limits.join(" ")).toContain("not certified as the best copy");
    // THE LETTER SEQUENCE MAY NOT MOVE. Any same-letter anagram used to self-authorize, so a meaning change
    // wearing a typo's size bypassed evidence entirely; a real letter repair owes what its treatment owes.
    for (const [b, a] of [["form", "from"], ["angel", "glean"], ["trial", "trail"], ["there", "three"], ["teh", "the"], ["founded 1979", "founded 1980"]])
      expect(mechanicalRepair(b!, a!), `${b} to ${a} is not a self-proving repair`).toBe(false);
    for (const [b, a] of [["Rug , where its from", "Rug, where it's from"], ["a  b", "a b"], ["Hello World", "hello world"]])
      expect(mechanicalRepair(b!, a!), `${b} to ${a} changes no letter`).toBe(true);
    // 2. A FACTUAL CORRECTION MAY NARROW, AND SAYS SO: shorter survives when only the source-carried meaning
    // does, and the receipt discloses the narrowing instead of posing as traffic copy.
    const noor = row("fact", { ...edit("section", "Meaning:Bright, radiant, or glowing.", "Meaning:Light."), changeFamily: "factual_correction",
      claims: [{ text: "Noor means light", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: 'encyclopedia says: "The name Noor means light"' }] });
    expect(evidenceShortfall(noor)).toBeNull();
    expect(proofOf(noor).limits.join(" ")).toContain("the unsupported wording was narrowed");
    // 3. RICHER FACTUAL CONTEXT WITHOUT EVIDENCE STAYS REFUSED, by the quote-bound authority chain itself.
    expect(unauthorizedReason({ subject: "Noor", current: "Meaning:Light.", proposed: "radiant and glowing",
      sources: [{ kind: "encyclopedia", says: 'The name Noor means "light"' }] } as never)).toContain("do not carry every word");
    // 4. DEMAND NEVER CHOOSES WORDS: replacing a title that exists, on impressions and a page claim alone, is
    // held until a diagnosis names the defect or a stored results page backs the shape.
    const creative = row("title", { ...edit("title", "Persian Onager (Asiatic Wild Ass): Facts & Habitat", "Onager (Persian Wild Ass): What It Is and Where It Lives"),
      changeFamily: "title-family", demandImpressions90d: 8112, claims: [{ text: "about the onager", supportedBy: ["page-copy-1"] }] });
    expect(evidenceShortfall(creative)).toContain("demand evidence alone");
    // 5. A MISSING FIELD FILLED WITH BANKED CLAIMS SURVIVES WITHOUT A RESULTS PAGE; with no claims it does not.
    const fill = row("meta", { ...edit("meta", null, "Iran adopted a new flag in 1979 and redesigned it in 1980."),
      claims: [{ text: "covers both versions", supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: "the page covers both" }] });
    expect(evidenceShortfall(fill)).toBeNull();
    expect(evidenceShortfall(row("meta2", edit("meta", null, "Everything you need to know.")))).toContain("no banked claim");
    // 6. A PATTERN CLAIM RIDES A STORED SHAPE: the same creative replacement passes once a stored results page
    // backs it, and the shape is named on the receipt rather than implied.
    expect(evidenceShortfall({ ...creative, modeledOn: "the stored results page for onager, whose top titles share this shape" } as ChangeProposal)).toBeNull();
    // 7. GAIN IS NOT SOURCING. Citing an outside id proved only that a source exists: it can perfectly well
    // confirm what the page already says, and that copy adds nothing. Body copy answers to a re-readable
    // receipt the evaluator wrote, so recurrence across any number of days still authorizes no copy.
    const aeo = (over: Record<string, unknown>) => row("ans", { recommendedChange: { kind: "existing_edit", field: "answer_block", before: null,
      after: "The four phrases are salam, khodahafez, merci and bale.", where: "Add as a single new paragraph at the top of the body on /p." },
      aiImpact: { answers: 3, mentionRate: 0, citedRivals: 1, audienceWeight: null, days: 3, stage: "owned_retrieved_not_cited" },
      claims: [{ text: "salam is the standard greeting", supportedBy: ["fact-1"] }], ...over });
    const GAIN = { adds: "names khodahafez as the standard farewell, which the page never states", by: ["fact-1"], pageWhole: true };
    expect(evidenceShortfall(aeo({})), "an outside source is not a gain receipt").toContain("what a reader gains");
    expect(evidenceShortfall(aeo({ claims: [] })), "recurrence alone authorizes nothing").toContain("what a reader gains");
    expect(evidenceShortfall(aeo({ informationGain: GAIN })), "a named, cited, whole-page gain passes").toBeNull();
    expect(evidenceShortfall(aeo({ informationGain: { ...GAIN, pageWhole: false } })), "judged against part of the page").toContain("only part of this page");
    expect(evidenceShortfall(aeo({ informationGain: { ...GAIN, by: ["fact-9"] } })), "an id no claim cites").toContain("belongs to a different reading");
    expect(evidenceShortfall(aeo({ informationGain: { ...GAIN, by: [] }, claims: [{ text: "what rivals cover", supportedBy: ["rival-2"] }] })), "briefing is not a source").toContain("competing page's briefing");
    // 8. A REPLACEMENT ACCOUNTS FOR EVERY UNIT OF THE PASSAGE IT REPLACES, not only the links, figures and
    // Capitalized Phrases a lexical detector happens to see: a lowercase call to action, a qualifier, one list
    // member and a dropped example all used to vanish in silence.
    const body = (before: string, after: string, over: Record<string, unknown> = {}) => row("sec", { recommendedChange: { kind: "existing_edit", field: "section", before, after, where: 'Replaces the existing passage under "Greetings"' },
      informationGain: { adds: "gives the literal meaning of salam, which the page never states", by: ["fact-1"], pageWhole: true },
      claims: [{ text: "salam means peace", supportedBy: ["fact-1"] }], ...over });
    const KEEP = "Salam means peace and is the standard Persian greeting used everywhere.";
    for (const [label, lost] of [["a lowercase call to action", "start your free lesson today with no sign up"],
      ["a qualifier", "it is among the oldest greetings still in daily use"], ["one list member", "khodahafez means goodbye in everyday speech"],
      ["a worked example", "for example a shopkeeper greets a customer with salam first"]] as const)
      expect(evidenceShortfall(body(`${KEEP} ${lost}`, KEEP)), `${label} may not vanish in silence`).toContain("neither keeps that nor says where it went");
    const CTA = "start your free lesson today with no sign up";
    expect(evidenceShortfall(body(`${KEEP} ${CTA}`, KEEP, { preservation: [{ text: CTA, disposition: "moved", to: "the page footer, directly under the last section", why: "kept as one call to action per page" }] })), "a move that records its destination").toBeNull();
    expect(evidenceShortfall(body(`${KEEP} ${CTA}`, KEEP, { preservation: [{ text: "a sentence this passage never carried", disposition: "removed", why: "invented" }] })), "a ledger is checked against the passage").toContain("neither keeps that nor says where it went");
    expect(evidenceShortfall(body(`${KEEP} See https://x.example/lessons for the course.`, KEEP,
      { preservation: [{ text: "See https://x.example/lessons for the course.", disposition: "removed", why: "the course moved" }] })), "a named link removal, reasoned").toBeNull();
    // The same contract for a bundle, through its own plan, and a consolidation that names nothing it absorbs.
    expect(evidenceShortfall(body(`${KEEP} ${CTA}`, KEEP, { bundle: { plan: { keeps: [], removes: [{ what: CTA, why: "moved to the footer" }], entries: [] }, components: [], receipt: { items: [], missing: [], freshestObservedAt: null } } })), "a bundle answers on its plan").toBeNull();
    expect(evidenceShortfall(body(KEEP, `${KEEP} It is also the usual telephone greeting.`, { recommendedChange: { kind: "existing_edit", field: "section", before: KEEP, after: `${KEEP} It is also the usual telephone greeting.`, where: 'Replaces the existing passage under "Greetings" and absorbs the duplicated entries below it' } })), "an absorption names what it absorbs").toContain("without naming one of them");
    // 9. A FACTUAL CORRECTION MAY DROP THE WORDS IT IS CORRECTING: the removal IS the change, and the narrowing
    // disclosure above already says so, so the unit rule never fires on one.
    expect(evidenceShortfall(row("f2", { ...edit("section", "Meaning:Bright, radiant, or glowing.", "Meaning:Light."), changeFamily: "factual_correction" }))).toBeNull();
    const gained = aeo({ informationGain: GAIN });
    // 10. ONE CANONICAL DECISION: the queue lanes by the very same verdict, so the held title reaches the
    // operator as a draft to review and never as Ready, while the diagnosed fill stays Ready.
    // 10. ONE VERDICT, EVERY CONSUMER. openHold is NOT the whole Ready verdict on its own: the list, the
    // release builder Today reads, the detail page, Mark done and the promotion door each compose it with
    // unsettledCause, and the producer sweep persists that same pair as a typed fault. The evidence check
    // rides INSIDE openHold, so every one of those compositions refuses together and none can out-offer
    // another. This asserts the composed expression they share, on both a held and a passing row.
    const served = (x: ChangeProposal): string | null => { const h = openHold(x); return (h.safetyHold ? null : h.blocking) ?? unsettledCause(x); };
    for (const held of [creative, aeo({}), body(`${KEEP} ${CTA}`, KEEP)])
      expect(served(held), "every consumer of the shared verdict refuses it").toBe(evidenceShortfall(held));
    expect(served(gained)).toBeNull(); expect(served(typo)).toBeNull();
    store.rows = new Map([[creative.id, creative], [fill.id, fill]]);
    const q = await loadProposalQueue(T, { currentBasis: "b", now: new Date("2026-08-02T00:00:00.000Z") });
    expect(q.ready.map((p) => p.id)).toEqual([fill.id]);
    expect(q.toDo.map((p) => p.id)).toContain(creative.id);
  });
});
