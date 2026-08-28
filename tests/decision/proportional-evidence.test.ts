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
import { openHold, preferFinished } from "@/domains/decision/completeness";
import { loadProposalQueue } from "@/domains/decision/load-proposals";
import { copyKey, evidenceShortfall, mechanicalRepair, proofOf } from "@/domains/decision/proof";
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
/** A RECEIPT IS ABOUT EXACT WORDS: every fixture receipt is bound to the copy it rides, as a producer stamps it. */
const bind = (p: ChangeProposal): ChangeProposal => ({ ...p, ...(p.informationGain ? { informationGain: { ...p.informationGain, of: copyKey(p) } } : {}),
  ...(p.preservation ? { preservation: p.preservation.map((u) => ({ ...u, of: u.of ?? copyKey(p) })) } : {}) });

describe("the proof burden matches the promise, at the one door every surface reads", () => {
  it("scales the evidence each treatment owes, and refuses the promise the evidence never made", async () => {
    // 1. A MARK-ONLY REPAIR IS ITS OWN EVIDENCE: no diagnosis, no results page, and the receipt certifies the
    // marks alone, never the sentence around them.
    const typo = row("typo", edit("meta", "Learn all about the Kerman Rug , where it's from.", "Learn all about the Kerman Rug, where it's from."));
    expect(evidenceShortfall(typo)).toBeNull();
    expect(openHold(typo).blocking).toBeNull();
    expect(proofOf(typo).limits.join(" ")).toContain("not certified as the best copy");
    // ONLY RENDERING A READER CANNOT SEE MAY PROVE ITSELF. Same-letter anagrams self-authorized, and then so did
    // anything whose letters matched once spaces and marks were stripped: word boundaries and marks ARE meaning.
    for (const [b, a] of [["form", "from"], ["angel", "glean"], ["trial", "trail"], ["there", "three"], ["teh", "the"], ["founded 1979", "founded 1980"],
      ["nowhere", "now here"], ["resign", "re-sign"], ["well", "we'll"], ["therapist", "the rapist"], ["learn more", "learnmore"], ["lets eat grandma", "let's eat, Grandma"], ["its history", "it's history"],
      ["Polish culture", "polish culture"], ["US policy", "us policy"], ["March 5", "march 5"], ["Alice defeated Bob", "Bob defeated Alice"]])
      expect(mechanicalRepair(b!, a!), `${b} to ${a} is not a self-proving repair`).toBe(false);
    for (const [b, a] of [["Rug , where", "Rug, where"], ["a  b", "a b"], [" hi ", "hi"], ['say \u201chi\u201d', 'say "hi"'], ["a \u2013 b", "a - b"]])
      expect(mechanicalRepair(b!, a!), `${b} to ${a} is rendering only`).toBe(true);
    // 2. A FACTUAL CORRECTION MAY NARROW, AND SAYS SO: shorter survives when only the source-carried meaning
    // does, and the receipt discloses the narrowing instead of posing as traffic copy.
    const noor = bind(row("fact", { ...edit("section", "Meaning:Bright, radiant, or glowing.", "Meaning:Light."), changeFamily: "factual_correction",
      preservation: [{ text: "Meaning:Bright, radiant, or glowing.", disposition: "corrected", by: ["fact-1"], why: "the source of record says Noor means light" }], claims: [{ text: "Noor means light", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: 'encyclopedia says: "The name Noor means light"' }] }));
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
    const aeo = (over: Record<string, unknown>) => bind(row("ans", { recommendedChange: { kind: "existing_edit", field: "answer_block", before: null,
      after: "The four phrases are salam, khodahafez, merci and bale.", where: "Add as a single new paragraph at the top of the body on /p." },
      aiImpact: { answers: 3, mentionRate: 0, citedRivals: 1, audienceWeight: null, days: 3, stage: "owned_retrieved_not_cited" },
      claims: [{ text: "salam is the standard greeting", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: "dictionary: salam" }], ...over }));
    const GAIN = { adds: "names khodahafez as the standard farewell, which the page never states", by: ["fact-1"], pageWhole: true };
    expect(evidenceShortfall(aeo({})), "an outside source is not a gain receipt").toContain("what a reader gains");
    expect(evidenceShortfall(aeo({ claims: [] })), "recurrence alone authorizes nothing").toContain("what a reader gains");
    expect(evidenceShortfall(aeo({ informationGain: GAIN })), "a named, cited, whole-page gain passes").toBeNull();
    expect(evidenceShortfall(aeo({ informationGain: { ...GAIN, pageWhole: false } })), "judged against part of the page").toContain("only part of this page");
    expect(evidenceShortfall(aeo({ informationGain: { ...GAIN, by: ["fact-9"] } })), "an id no claim cites").toContain("belongs to a different reading");
    expect(evidenceShortfall(aeo({ informationGain: { ...GAIN, by: [] }, claims: [{ text: "what rivals cover", supportedBy: ["rival-2"] }] })), "briefing is not a source").toContain("competing page's briefing");
    // 8. A REPLACEMENT ACCOUNTS FOR EVERY UNIT OF THE PASSAGE IT REPLACES, not only the links, figures and Capitalized Phrases a lexical detector sees: a lowercase call to action, a qualifier, one list member and a dropped example all vanished in silence.
    const body = (before: string, after: string, over: Record<string, unknown> = {}) => bind(row("sec", { recommendedChange: { kind: "existing_edit", field: "section", before, after, where: 'Replaces the existing passage under "Greetings"' },
      informationGain: { adds: "gives the literal meaning of salam, which the page never states", by: ["fact-1"], pageWhole: true },
      claims: [{ text: "salam means peace", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: "dictionary: salam" }], ...over }));
    const KEEP = "Salam means peace and is the standard Persian greeting used everywhere.";
    for (const [label, lost] of [["a lowercase call to action", "start your free lesson today with no sign up"],
      ["a qualifier", "it is among the oldest greetings still in daily use"], ["one list member", "khodahafez means goodbye in everyday speech"],
      ["a worked example", "for example a shopkeeper greets a customer with salam first"]] as const)
      expect(evidenceShortfall(body(`${KEEP} ${lost}`, KEEP)), `${label} may not vanish in silence`).toContain("neither says it nor accounts for it");
    // A REVERSAL IS NOT A PRESERVATION: one token IS the claim, and four neighbours outvoted it at 60 percent.
    for (const [b, a] of [["This treatment is safe for children.", "This treatment is unsafe for children."], ["Smoking causes lung damage in adults.", "Smoking prevents lung damage in adults."],
      ["The rule is permitted for all residents.", "The rule is prohibited for all residents."], ["This method increases the yield reliably.", "This method decreases the yield reliably."], ["Topoli means chubby in playful speech.", "Topoli means skinny in playful speech."]])
      expect(evidenceShortfall(body(b!, a!)), `${a} does not preserve ${b}`).toContain("neither says it nor accounts for it");
    // AND LEXICAL LOGIC MAY NOT AUTHORIZE EITHER: a faithful paraphrase is held too, until a banked semantic
    // verdict bound to these exact words can say it survived. Refusing is the only thing words alone may do.
    expect(evidenceShortfall(body("This treatment is safe for children.", "Children can safely take this treatment.")), "even a paraphrase owes a typed disposition").toContain("neither says it nor accounts for it");
    const CTA = "start your free lesson today with no sign up";
    // A DISPOSITION IS A CHECKED CLAIM, NOT A LABEL: nothing read the disposition at all, so these three passed.
    for (const [u, why] of [[{ text: CTA, disposition: "removed", why: "because reasons" }, "without a typed basis"], [{ text: CTA, disposition: "moved", to: "the moon" }, "somewhere this change does not write"], [{ text: CTA, disposition: "kept" }, "keeps material the new copy no longer carries"], [{ text: CTA, disposition: "corrected", why: "x" }, "without naming the banked facts"]] as const)
      expect(evidenceShortfall(body(`${KEEP} ${CTA}`, KEEP, { preservation: [u] })), `${u.disposition} ${why}`).toContain(why);
    expect(evidenceShortfall(body(`${KEEP} ${CTA}`, KEEP, { preservation: [{ text: CTA, disposition: "moved", to: KEEP, why: "kept as one call to action per page" }] })), "a move that records its destination").toBeNull();
    expect(evidenceShortfall(body(`${KEEP} ${CTA}`, KEEP, { preservation: [{ text: "a sentence this passage never carried", disposition: "removed", basis: "obsolete", why: "invented" }] })), "a ledger is checked against the passage").toContain("neither says it nor accounts for it");
    expect(evidenceShortfall(body(`${KEEP} See https://x.example/lessons for the course.`, KEEP,
      { preservation: [{ text: "See https://x.example/lessons for the course.", disposition: "removed", basis: "obsolete", why: "the course moved" }] })), "a named link removal, reasoned").toBeNull();
    // ONE AUTHORIZATION VOCABULARY: a bundle's plan and a component's preserves are the customer-facing SUMMARY of a change, so prose there authorizes nothing.
    expect(evidenceShortfall(body(`${KEEP} ${CTA}`, KEEP, { bundle: { plan: { keeps: [], removes: [{ what: CTA, why: "moved to the footer" }], entries: [] },
      components: [{ kind: "section_rewrite", label: "s", before: CTA, after: KEEP, evidenceKeys: [], risk: "safe", preserves: { keeps: [], losses: [{ what: CTA, why: "moved" }] } }], receipt: { items: [], missing: [], freshestObservedAt: null } } })), "a summary is not a verdict").toContain("neither says it nor accounts for it");
    expect(evidenceShortfall(body(`${KEEP} ${CTA}`, KEEP, { preservation: [{ text: CTA, disposition: "removed", basis: "duplicate_of", why: "duplicated by the footer button" }] })), "the one ledger answers for a bundle too").toBeNull();
    expect(evidenceShortfall(body(KEEP, `${KEEP} It is also the usual telephone greeting.`, { recommendedChange: { kind: "existing_edit", field: "section", before: KEEP, after: `${KEEP} It is also the usual telephone greeting.`, where: 'Replaces the existing passage under "Greetings" and absorbs the duplicated entries below it' } })), "an absorption names what it absorbs").toContain("without naming one of them");
    // 9. A FACTUAL CORRECTION MAY DROP THE WORDS IT IS CORRECTING: the removal IS the change, and the narrowing
    // disclosure above already says so, so the unit rule never fires on one.
    // AND "FACTUAL CORRECTION" IS NOT A LICENCE TO DELETE THE PAGE AROUND THE MISTAKE: it accounts for the line it corrects, and a call to action beside that line is still a loss to answer for.
    expect(evidenceShortfall(bind(row("f2", { ...edit("section", "Meaning:Bright, radiant, or glowing. Start your free lesson today.", "Meaning:Light."), changeFamily: "factual_correction",
      preservation: [{ text: "Meaning:Bright, radiant, or glowing.", disposition: "corrected", by: ["fact-1"], why: "the source says light" }], supportFacts: [{ id: "fact-1", fact: "encyclopedia: light" }],
      claims: [{ text: "c", supportedBy: ["fact-1"] }] })))).toContain("Start your free lesson");
    const gained = aeo({ informationGain: GAIN });
    // 10. ONE CANONICAL DECISION: the queue lanes by the very same verdict, so the held title reaches the
    // operator as a draft to review and never as Ready, while the diagnosed fill stays Ready.
    // 9b. A RECEIPT IS ABOUT EXACT WORDS. `copyIdentity` excludes the copy and `workKey` names the job, so a
    // reading written for one draft rode another's words and Beacon served "Light" under a receipt for "Radiant".
    const authorized = body(`${KEEP} ${CTA}`, KEEP, { workKey: "W", copyStamp: "S", preservation: [{ text: CTA, disposition: "removed", basis: "duplicate_of", why: "the footer carries it" }] });
    const edited = { ...authorized, recommendedChange: { ...authorized.recommendedChange, after: `${KEEP} Extra.` } } as ChangeProposal;
    expect(evidenceShortfall(edited), "one material word after authorization voids the receipt").toContain("written for different words");
    expect(evidenceShortfall({ ...authorized, informationGain: { ...authorized.informationGain!, of: "0:copy:zzz" } } as ChangeProposal), "a gain receipt for other words").toContain("written for different words");
    expect(evidenceShortfall({ ...authorized, preservation: [{ ...authorized.preservation![0]!, of: "0:copy:zzz" }] } as ChangeProposal), "a ledger written for other words").toContain("written for different words");
    expect(evidenceShortfall(aeo({ informationGain: { adds: "improves clarity", by: [], pageWhole: true, of: copyKey(aeo({})) } })), "an addition naming no evidence").toContain("naming no evidence");
    // THE IMPOSSIBLE RECORD: banked copy A, and a redraft of B whose receipts were written for B. Preservation
    // keeps A, so B's receipts may not ride it; identity cannot answer this because it excludes the copy.
    const bankedA = { ...authorized, informationGain: undefined, preservation: undefined } as ChangeProposal;
    const draftB = { ...edited, informationGain: { adds: "written for B", by: ["fact-1"], pageWhole: true, of: copyKey(edited) } } as ChangeProposal;
    const carried = preferFinished(draftB, bankedA);
    expect([(carried.recommendedChange as { after: string }).after === KEEP, carried.informationGain?.adds ?? null],
      "a redraft's receipt may not ride the words that were banked").toEqual([true, null]);
    expect(evidenceShortfall(body(KEEP, `${KEEP} Extra.`, { informationGain: { adds: "improves clarity", by: [], pageWhole: true } })), "no shape earns an empty evidence list").toContain("naming no evidence");
    expect(evidenceShortfall(row("bundle2", { demandImpressions90d: 9000, ...edit("title", "A", "Anything at all"),
      bundle: { objective: "o", components: [{ kind: "title", label: "t", before: "x", after: "y", evidenceKeys: [], risk: "safe", page: "/a" }, { kind: "title", label: "t", before: "x", after: "y", evidenceKeys: [], risk: "safe", page: "/b" }], receipt: { items: [], missing: [], freshestObservedAt: null } } })), "a split proves the treatment, never the words").toContain("demand evidence alone");
    // 10. ONE VERDICT, EVERY CONSUMER. openHold is NOT the whole Ready verdict: the list, the release builder Today reads, the detail page, Mark done and the promotion door each compose it with unsettledCause, and the sweep persists that pair as a typed fault. The evidence check rides INSIDE openHold, so all of them refuse together.
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
