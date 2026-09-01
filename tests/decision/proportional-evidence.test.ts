/** THE PROOF BURDEN MATCHES THE PROMISE (operator, 2026-08-28). One composed walk through the canonical door:  a typo repair owes nothing beyond its own diff, a factual correction may narrow and must say so, demand  never chooses words, a missing field survives on banked claims, a pattern claim rides a stored shape,  assistant recurrence authorizes investigation and never copy, and a replacement may not silently drop what  the passage carries. The door is completeness's openHold, the same verdict the queue, Today, the detail  page, Mark done, the promotion chain and the producer sweep all read, so one refusal refuses everywhere. */
import { describe, expect, it, vi } from "vitest";
vi.mock("@/domains/decision/proposal-store", () => ({ loadChangeProposals: async () => store.rows }));
vi.mock("@/domains/measurement/proof-gsc/load-ledger", () => ({ loadProofLedgerCached: async () => null }));
import { unsettledCause } from "@/domains/decision/authorization";
import { deliverableGaps, openHold, preferFinished } from "@/domains/decision/completeness";
import { loadProposalQueue } from "@/domains/decision/load-proposals";
import { REVIEW_CONTRACT, copyKey, evidenceShortfall, mechanicalRepair, proofOf } from "@/domains/decision/proof";
import { unauthorizedReason } from "@/domains/evidence/pages/fact-checks";
import { componentIdOf } from "@/domains/decision/contracts"; import type { ChangeProposal } from "@/domains/decision/contracts";

const store = vi.hoisted(() => ({ rows: new Map<string, ChangeProposal>() })); const T = "t"; const row = (id: string, over: Record<string, unknown>): ChangeProposal => ({
  id: `${T}::/p::existing_edit::${id}`, tenantId: T, kind: "existing_edit", pagePath: "/p",
  pageUrl: "https://x.example/p", pageLabel: "P", primaryQuery: "onager", opportunityType: "o",
  changeFamily: "meta", status: "ready", whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low",
  confidence: "medium", limitations: [], evidence: { query: "onager", hints: [], evidenceRefCount: 1 },
  impactScore: 10, upsidePerMonth: null, basis: "b", createdAt: "2026-08-01T00:00:00.000Z", ...over,
} as unknown as ChangeProposal);
const edit = (field: string, before: string | null, after: string, more: Record<string, unknown> = {}) =>
  ({ recommendedChange: { kind: "existing_edit", field, before, after }, ...more });
/** A RECEIPT IS ABOUT EXACT WORDS: every fixture receipt is bound to the copy it rides, as a producer stamps it. */
const bind = (p: ChangeProposal): ChangeProposal => ({ ...p, semanticReview: { of: copyKey(p), version: REVIEW_CONTRACT, claims: (p.claims ?? []).map((x, i) => ({ i, by: [...x.supportedBy], entailed: true })) } });

describe("the proof burden matches the promise, at the one door every surface reads", () => {
  it("scales the evidence each treatment owes, and refuses the promise the evidence never made", async () => {
    const typo = row("typo", edit("meta", "Learn all about the Kerman Rug , where it's from.", "Learn all about the Kerman Rug, where it's from.")); // 1. A MARK-ONLY REPAIR IS ITS OWN EVIDENCE: no diagnosis, no results page, and the receipt certifies the marks alone, never the sentence around them.
    expect(evidenceShortfall(typo)).toBeNull(); expect(openHold(typo).blocking).toBeNull(); expect(proofOf(typo).limits.join(" ")).toContain("not certified as the best copy");
    for (const [b, a] of [["form", "from"], ["angel", "glean"], ["trial", "trail"], ["there", "three"], ["teh", "the"], ["founded 1979", "founded 1980"], // ONLY RENDERING A READER CANNOT SEE MAY PROVE ITSELF. Same-letter anagrams self-authorized, and then so did anything whose letters matched once spaces and marks were stripped: word boundaries and marks ARE meaning.
      ["nowhere", "now here"], ["resign", "re-sign"], ["well", "we'll"], ["therapist", "the rapist"], ["learn more", "learnmore"], ["lets eat grandma", "let's eat, Grandma"], ["its history", "it's history"],
      ["Polish culture", "polish culture"], ["US policy", "us policy"], ["March 5", "march 5"], ["Alice defeated Bob", "Bob defeated Alice"],
      ["The man\u2014eating shark", "The man-eating shark"], ["a \u2013 b", "a - b"]])
      expect(mechanicalRepair(b!, a!), `${b} to ${a} is not a self-proving repair`).toBe(false);
    for (const [b, a] of [["Rug , where", "Rug, where"], ["a  b", "a b"], [" hi ", "hi"], ['say \u201chi\u201d', 'say "hi"']])
      expect(mechanicalRepair(b!, a!), `${b} to ${a} is rendering only`).toBe(true);
    const noor = bind(row("fact", { ...edit("section", "Meaning:Bright, radiant, or glowing.", "Meaning:Light."), changeFamily: "factual_correction", // 2. A FACTUAL CORRECTION MAY NARROW, AND SAYS SO: shorter survives when only the source-carried meaning does, and the receipt discloses the narrowing instead of posing as traffic copy.
      preservation: [{ text: "Meaning:Bright, radiant, or glowing.", disposition: "corrected", by: ["fact-1"], why: "the source of record says Noor means light" }], claims: [{ text: "Noor means light", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: 'encyclopedia says: "The name Noor means light"' }] }));
    expect(evidenceShortfall(noor)).toBeNull(); expect(proofOf(noor).limits.join(" ")).toContain("the unsupported wording was narrowed");
    expect(unauthorizedReason({ subject: "Noor", current: "Meaning:Light.", proposed: "radiant and glowing", // 3. RICHER FACTUAL CONTEXT WITHOUT EVIDENCE STAYS REFUSED, by the quote-bound authority chain itself.
      sources: [{ kind: "encyclopedia", says: 'The name Noor means "light"' }] } as never)).toContain("do not carry every word");
    const creative = row("title", { ...edit("title", "Persian Onager (Asiatic Wild Ass): Facts & Habitat", "Onager (Persian Wild Ass): What It Is and Where It Lives"), // 4. DEMAND NEVER CHOOSES WORDS: replacing a title that exists, on impressions and a page claim alone, is held until a diagnosis names the defect or a stored results page backs the shape.
      changeFamily: "title-family", demandImpressions90d: 8112, claims: [{ text: "about the onager", supportedBy: ["page-copy-1"] }] });
    expect(evidenceShortfall(creative)).toContain("demand evidence alone");
    const fill = row("meta", { ...edit("meta", null, "Iran adopted a new flag in 1979 and redesigned it in 1980."), // 5. A MISSING FIELD FILLED WITH BANKED CLAIMS SURVIVES WITHOUT A RESULTS PAGE; with no claims it does not.
      claims: [{ text: "covers both versions", supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: "the page covers both" }] });
    expect(evidenceShortfall(fill)).toBeNull();
    expect(evidenceShortfall(row("meta2", edit("meta", null, "Everything you need to know.")))).toContain("none of its own sources carry");
    expect(evidenceShortfall({ ...creative, modeledOn: "the stored results page for onager, whose top titles share this shape" } as ChangeProposal)).toBeNull(); // 6. A PATTERN CLAIM RIDES A STORED SHAPE: the same creative replacement passes once a stored results page backs it, and the shape is named on the receipt rather than implied.
    const aeo = (over: Record<string, unknown>) => bind(row("ans", { recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, // 7. GAIN IS NOT SOURCING. Citing an outside id proved only that a source exists: it can perfectly well confirm what the page already says, and that copy adds nothing. Body copy answers to a re-readable receipt the evaluator wrote, so recurrence across any number of days still authorizes no copy.
      after: "The four phrases are salam, khodahafez, merci and bale.", where: "Add as a single new paragraph at the top of the body on /p." },
      aiImpact: { answers: 3, mentionRate: 0, citedRivals: 1, audienceWeight: null, days: 3, stage: "owned_retrieved_not_cited" },
      claims: [{ text: "salam is the standard greeting", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: "dictionary: salam" }], ...over }));
    const GAIN = { adds: "names khodahafez as the standard farewell, which the page never states", by: ["fact-1"], pageWhole: true };
    expect(evidenceShortfall(aeo({})), "an outside source is not a gain receipt").toContain("what a reader gains");
    expect(evidenceShortfall(aeo({ claims: [] })), "recurrence alone authorizes nothing").toContain("what a reader gains");
    expect(evidenceShortfall(aeo({ informationGain: GAIN })), "a named, cited, whole-page gain passes").toBeNull();
    expect(evidenceShortfall(aeo({ informationGain: { ...GAIN, pageWhole: false } })), "judged against part of the page").toContain("only part of this page");
    expect(evidenceShortfall(aeo({ informationGain: { ...GAIN, by: ["fact-9"] } })), "an id no claim cites").toContain("belongs to a different reading");
    expect(evidenceShortfall(aeo({ informationGain: { ...GAIN, by: [] }, claims: [{ text: "what rivals cover", supportedBy: ["rival-2"] }] })), "briefing is not a source").toContain("a page that competes with this one");
    const body = (before: string, after: string, over: Record<string, unknown> = {}) => bind(row("sec", { recommendedChange: { kind: "existing_edit", field: "section", before, after, where: 'Replaces the existing passage under "Greetings"' }, // 8. A REPLACEMENT ACCOUNTS FOR EVERY UNIT OF THE PASSAGE IT REPLACES, not only the links, figures and Capitalized Phrases a lexical detector sees: a lowercase call to action, a qualifier, one list member and a dropped example all vanished in silence.
      informationGain: { adds: "gives the literal meaning of salam, which the page never states", by: ["fact-1"], pageWhole: true },
      claims: [{ text: "salam means peace", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: "dictionary: salam" }], ...over }));
    const KEEP = "Salam means peace and is the standard Persian greeting used everywhere.";
    for (const [label, lost] of [["a lowercase call to action", "start your free lesson today with no sign up"],
      ["a qualifier", "it is among the oldest greetings still in daily use"], ["one list member", "khodahafez means goodbye in everyday speech"],
      ["a worked example", "for example a shopkeeper greets a customer with salam first"]] as const)
      expect(evidenceShortfall(body(`${KEEP} ${lost}`, KEEP)), `${label} may not vanish in silence`).toContain("neither says it nor accounts for it");
    for (const [b, a] of [["This treatment is safe for children.", "This treatment is unsafe for children."], ["Smoking causes lung damage in adults.", "Smoking prevents lung damage in adults."], // A REVERSAL IS NOT A PRESERVATION: one token IS the claim, and four neighbours outvoted it at 60 percent.
      ["The rule is permitted for all residents.", "The rule is prohibited for all residents."], ["This method increases the yield reliably.", "This method decreases the yield reliably."], ["Topoli means chubby in playful speech.", "Topoli means skinny in playful speech."]])
      expect(evidenceShortfall(body(b!, a!)), `${a} does not preserve ${b}`).toContain("neither says it nor accounts for it");
    expect(evidenceShortfall(body("This treatment is safe for children.", "Children can safely take this treatment.")), "even a paraphrase owes a typed disposition").toContain("neither says it nor accounts for it"); // AND LEXICAL LOGIC MAY NOT AUTHORIZE EITHER: a faithful paraphrase is held too, until a banked semantic verdict bound to these exact words can say it survived. Refusing is the only thing words alone may do.
    const CTA = "start your free lesson today with no sign up";
    for (const [u, why] of [[{ text: CTA, disposition: "removed", why: "because reasons" }, "without a basis this door can check"], [{ text: CTA, disposition: "removed", basis: "obsolete", why: "because reasons" }, "without a basis this door can check"], [{ text: CTA, disposition: "removed", basis: "duplicate_of", why: "dup" }, "without a basis this door can check"], [{ text: CTA, disposition: "moved", to: "the moon" }, "a destination that does not carry it"], [{ text: CTA, disposition: "kept" }, "keeps material the new copy no longer carries"], [{ text: CTA, disposition: "corrected", why: "x" }, "without naming the banked facts"]] as const) // A DISPOSITION IS A CHECKED CLAIM, NOT A LABEL: nothing read the disposition at all, so these three passed.
      expect(evidenceShortfall(body(`${KEEP} ${CTA}`, KEEP, { preservation: [u] })), `${u.disposition} ${why}`).toContain(why);
    const footer = { kind: "section_add" as const, label: "Footer", page: "/p", where: "Footer", before: null, after: `Footer: ${CTA}`, evidenceKeys: [], risk: "safe" as const };
    const owns = (c: { kind: string; after?: string | null }) => ({ claims: [{ text: "salam means peace", supportedBy: ["fact-1"], of: componentIdOf(c, 0) }] }); // A PIECE THAT PUTS WORDS ON A PAGE ANSWERS FOR ITS OWN CLAIM, named by the piece it belongs to, so these rows carry what a real bundle carries and the ledger rules below are reached rather than pre-empted.
    expect(evidenceShortfall(body(`${KEEP} ${CTA}`, KEEP, { ...owns(footer), preservation: [{ text: CTA, disposition: "moved", to: "Footer", why: "one call to action per page" }], bundle: { objective: "o", components: [footer], receipt: { items: [], missing: [], freshestObservedAt: null } } })), "a move whose destination carries it").toBeNull();
    expect(evidenceShortfall(body(`${KEEP} ${CTA}`, KEEP, { preservation: [{ text: "a sentence this passage never carried", disposition: "removed", basis: "obsolete", by: ["fact-1"], why: "invented" }] })), "a ledger is checked against the passage").toContain("neither says it nor accounts for it");
    expect(evidenceShortfall(body(`${KEEP} See https://x.example/lessons for the course.`, KEEP,
      { preservation: [{ text: "See https://x.example/lessons for the course.", disposition: "removed", basis: "obsolete", by: ["fact-1"], why: "the course closed" }] })), "a named link removal, reasoned").toBeNull();
    const summary = { kind: "section_rewrite" as const, label: "s", before: CTA, after: KEEP, evidenceKeys: [], risk: "safe" as const, preserves: { keeps: [], losses: [{ what: CTA, why: "moved" }] } }; // ONE AUTHORIZATION VOCABULARY: a bundle's plan and a component's preserves are the customer-facing SUMMARY of a change, so prose there authorizes nothing.
    expect(evidenceShortfall(body(`${KEEP} ${CTA}`, KEEP, { ...owns(summary), bundle: { plan: { keeps: [], removes: [{ what: CTA, why: "moved to the footer" }], entries: [] }, components: [summary], receipt: { items: [], missing: [], freshestObservedAt: null } } })), "a summary is not a verdict").toContain("neither says it nor accounts for it");
    expect(evidenceShortfall(body(`${KEEP} ${CTA}`, KEEP, { ...owns(footer), preservation: [{ text: CTA, disposition: "removed", basis: "duplicate_of", to: "Footer", why: "the footer carries it" }], bundle: { objective: "o", components: [footer], receipt: { items: [], missing: [], freshestObservedAt: null } } })), "the one ledger answers for a bundle too").toBeNull();
    expect(evidenceShortfall(body(KEEP, `${KEEP} It is also the usual telephone greeting.`, { recommendedChange: { kind: "existing_edit", field: "section", before: KEEP, after: `${KEEP} It is also the usual telephone greeting.`, where: 'Replaces the existing passage under "Greetings" and absorbs the duplicated entries below it' } })), "an absorption names what it absorbs").toContain("without naming one of them");
    expect(evidenceShortfall(bind(row("f2", { ...edit("section", "Meaning:Bright, radiant, or glowing. Start your free lesson today.", "Meaning:Light."), changeFamily: "factual_correction", // 9. A FACTUAL CORRECTION MAY DROP THE WORDS IT IS CORRECTING: the removal IS the change, and the narrowing disclosure above already says so, so the unit rule never fires on one. AND "FACTUAL CORRECTION" IS NOT A LICENCE TO DELETE THE PAGE AROUND THE MISTAKE: it accounts for the line it corrects, and a call to action beside that line is still a loss to answer for.
      preservation: [{ text: "Meaning:Bright, radiant, or glowing.", disposition: "corrected", by: ["fact-1"], why: "the source says light" }], supportFacts: [{ id: "fact-1", fact: "encyclopedia: light" }],
      claims: [{ text: "c", supportedBy: ["fact-1"] }] })))).toContain("Start your free lesson");
    const gained = aeo({ informationGain: GAIN });
    const authorized = body(`${KEEP} ${CTA}`, KEEP, { workKey: "W", copyStamp: "S", preservation: [{ text: CTA, disposition: "removed", basis: "obsolete", by: ["fact-1"], why: "the course closed" }] }); // 10. ONE CANONICAL DECISION: the queue lanes by the very same verdict, so the held title reaches the operator as a draft to review and never as Ready, while the diagnosed fill stays Ready. 9b. A RECEIPT IS ABOUT EXACT WORDS. `copyIdentity` excludes the copy and `workKey` names the job, so a reading written for one draft rode another's words and Beacon served "Light" under a receipt for "Radiant".
    const edited = { ...authorized, recommendedChange: { ...authorized.recommendedChange, after: `${KEEP} Extra.` } } as ChangeProposal;
    expect(evidenceShortfall(edited), "one material word after authorization voids the reading").toContain("reviewer has read them together");
    const elsewhere = (p: ChangeProposal) => ({ ...p, semanticReview: { ...p.semanticReview!, of: `${p.semanticReview!.of}x` } }) as ChangeProposal;
    expect(evidenceShortfall(elsewhere(authorized)), "a reading written for other words").toContain("reviewer has read them together");
    expect(evidenceShortfall(aeo({ informationGain: { adds: "improves clarity", by: [], pageWhole: true } })), "an addition naming no evidence").toContain("naming no evidence");
    const bankedA = { ...authorized, informationGain: undefined, preservation: undefined } as ChangeProposal; // THE IMPOSSIBLE RECORD: banked copy A, and a redraft of B whose receipts were written for B. Preservation keeps A, so B's receipts may not ride it; identity cannot answer this because it excludes the copy.
    const draftB = { ...edited, informationGain: { adds: "written for B", by: ["fact-1"], pageWhole: true } } as ChangeProposal;
    const carried = preferFinished(draftB, bankedA);
    expect([(carried.recommendedChange as { after: string }).after === KEEP, carried.informationGain?.adds ?? null], "a redraft's receipt may not ride the words that were banked").toEqual([true, null]);
    const banked2 = { ...authorized, informationGain: undefined, preservation: undefined, operatorSteps: ["OLD step"] } as ChangeProposal; // THE STEPS FOLLOW THE WORDS, AND THE PAID READING SURVIVES THEM. A settled card kept its instructions for ever, so the correction family could learn to say "Find the Noor entry" instead of naming the section it is already in and no card already on file would ever say it. Only the steps refresh: claims and support facts are hashed into the copy key, so refreshing either would retire the reading attached to it.
    const withRead = { ...banked2, semanticReview: { of: copyKey(banked2), version: REVIEW_CONTRACT, claims: [{ i: 0, by: ["fact-1"], entailed: true }] } } as ChangeProposal;
    const merged = preferFinished({ ...banked2, operatorSteps: ["NEW step"], semanticReview: undefined } as ChangeProposal, withRead);
    expect([(merged.operatorSteps ?? [])[0], merged.semanticReview?.of === copyKey(merged), (merged.claims ?? [])[0]?.text === (withRead.claims ?? [])[0]?.text], "today's steps, the banked reading still valid on the row it lands on, and the claims untouched").toEqual(["NEW step", true, true]);
    const draftHeld = { ...bind(authorized), status: "needs_review", preservation: undefined } as ChangeProposal; // a paid adversarial read bound to these exact words, still holding for its next gate
    const templateMint = { ...draftHeld, semanticReview: undefined, informationGain: undefined, recommendedChange: { ...draftHeld.recommendedChange, after: "Names are grouped and meanings are provided." }, claims: [{ text: "Names are grouped and meanings are provided.", supportedBy: ["fact-1"] }] } as ChangeProposal;
    expect(deliverableGaps(templateMint), "the template looks complete, which is exactly how it overwrote paid work").toEqual([]);
    const survived = preferFinished(templateMint, draftHeld); expect([(survived.recommendedChange as { after: string }).after, survived.semanticReview?.of === copyKey(survived)], "an unreviewed re-mint never replaces the draft whose paid reading binds to its exact words").toEqual([(draftHeld.recommendedChange as { after: string }).after, true]);
    const readAt = bind(authorized), reworded = { ...readAt, claims: [{ text: "the same fact, said a better way", supportedBy: [...(readAt.claims ?? [])[0]!.supportedBy] }] } as ChangeProposal; // A CLAIM IS PART OF THE COPY, so rewording one retires the reading taken over it: a pass that refreshed the sentences on a settled card left its paid receipt attached to words the reviewer never saw, and only `copyKey` hashing the claims kept that out of the queue.
    const refactedEvidence = { ...readAt, supportFacts: [...(readAt.supportFacts ?? []), { id: "fact-9", fact: "a source nobody read when this was judged" }] } as ChangeProposal;
    expect([evidenceShortfall(readAt), copyKey(reworded) === copyKey(readAt), copyKey(refactedEvidence) === copyKey(readAt)], "the reading stands on its own words").toEqual([null, false, false]);
    for (const moved of [reworded, refactedEvidence]) expect(evidenceShortfall(moved), "a moved claim or moved evidence retires it").toContain("actually support what it claims");
    const glue = (after: string) => ({ ...authorized, informationGain: undefined, preservation: undefined, recommendedChange: { ...authorized.recommendedChange, field: "section", where: 'The "Noor" entry', before: "Meaning:Bright, radiant, or glowing.", after } }) as ChangeProposal; // PRESERVATION KEEPS FINISHED WORK, AND A LINE THAT WOULD PASTE AS ONE GLUED PHRASE IS NOT FINISHED WORK (operator, 2026-08-28): three corrections sat Ready reading "Meaning:Light." because the page's own missing space had been copied into them, and preservation kept handing that banked line back, so the repair that puts the one space there could never reach the rows it was written for.
    const banked = glue("Meaning:Light."), repaired = glue("Meaning: Light.");
    expect([deliverableGaps(banked)[0], deliverableGaps(repaired), (preferFinished(repaired, banked).recommendedChange as { after: string }).after], "a glued label is unfinished, the spaced line is finished, and the repair replaces the banked typo").toEqual([expect.stringContaining("one glued phrase"), [], "Meaning: Light."]);
    const placed = (stamp: string) => ({ ...authorized, informationGain: undefined, preservation: undefined, limitations: [], claims: [{ text: "t", supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: "a body passage the claims cite" }], copyStamp: stamp, recommendedChange: { ...authorized.recommendedChange, field: "section", before: null, after: "A finished section that answers the question for a reader.", where: 'A new section headed "H", placed after "Nowruz - Persian New Year"' } }) as ChangeProposal; // AND A PLACEMENT BEACON ITSELF CHOSE IS PROVEN BY THE CARD'S OWN RECORD OF THE PAGE (live, 2026-08-28): the anchor is picked mechanically from the page's H1, title and headings, while `supportFacts` carries only the body passages the claims cite, and a heading is never one of those.
    expect(openHold(placed("T|Nowruz - Persian New Year|D|O")).blocking ?? "", "the card's own page record proves the placement it names").not.toContain("Where this copy goes");
    expect(openHold(placed("T|A different heading|D|O")).blocking ?? "", "and an anchor on neither surface is still held").toContain("Where this copy goes");
    expect(evidenceShortfall(body(KEEP, `${KEEP} Extra.`, { informationGain: { adds: "improves clarity", by: [], pageWhole: true } })), "no shape earns an empty evidence list").toContain("naming no evidence");
    expect(evidenceShortfall(row("bundle2", { demandImpressions90d: 9000, ...edit("title", "A", "Anything at all"), diagnosisCause: "cannibalization", // a treatable cause is not wording evidence either
      bundle: { objective: "o", components: [{ kind: "title", label: "t", before: "x", after: "y", evidenceKeys: [], risk: "safe", page: "/a" }, { kind: "title", label: "t", before: "x", after: "y", evidenceKeys: [], risk: "safe", page: "/b" }], receipt: { items: [], missing: [], freshestObservedAt: null } } })), "a split proves the treatment, never the words").toContain("demand evidence alone");
    const draft = (after: string) => row("coll", { workKey: "W", copyStamp: "S", status: "ready", // 9c. A HASH NAMES A BUCKET; THE IDENTITY NAMES THE THING. componentIdOf is a 32-bit fingerprint for naming a bundle piece in a browser, and two real drafts collided on it and transferred a receipt through this merge.
      recommendedChange: { kind: "existing_edit", field: "section", before: "before", after, where: 'Replaces the existing passage under "H"' },
      claims: [{ text: "c", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: "Tehran is in Iran." }] });
    const A = draft("draft-4b7h-1t8gqzx"), B = draft("draft-54d6-1l5sdoa");
    expect(copyKey(A), "the supplied collision pair").not.toBe(copyKey(B));
    expect(preferFinished({ ...B, semanticReview: { of: copyKey(B), version: REVIEW_CONTRACT, claims: (B.claims ?? []).map((x, n) => ({ i: n, by: [...x.supportedBy], entailed: true })) }, preservation: [{ text: "before", disposition: "removed", basis: "obsolete", by: ["fact-1"], why: "for B" }] } as ChangeProposal, A).preservation ?? null, "B's receipt may not ride A").toBeNull();
    const move = (o: Record<string, unknown>) => copyKey({ ...A, ...o } as ChangeProposal);
    expect([move({ pagePath: "/other" }) === copyKey(A), move({ supportFacts: [{ id: "fact-1", fact: "changed" }] }) === copyKey(A),
      move({ recommendedChange: { ...A.recommendedChange, field: "meta" } }) === copyKey(A)],
      "another page, another field, or the same fact rewritten under its id, is another decision").toEqual([false, false, false]);
    expect(evidenceShortfall(body(`${KEEP} ${CTA}`, `${KEEP} Footer`, { preservation: [{ text: CTA, disposition: "moved", to: "Footer" }] })), "a destination that exists but does not carry it").toContain("does not carry it");
    expect(evidenceShortfall(row("np", { kind: "new_page", pagePath: null, changeFamily: "new_page", // 9d. THREE MORE WAYS A RECEIPT LOOKED COMPLETE AND WAS NOT: a whole new page faced no evidence question at all, and a move named a destination one bundle piece carries while the material sat in another piece.
      recommendedChange: { kind: "new_page", proposedTitle: "Anything At All", metaDescription: "Whatever we like.", openingAnswer: "Unsourced.", outline: ["a", "b", "c"], faqQuestions: [], schemaTypes: [] } })), "a whole page with nothing behind it").toContain("nothing on file says what any of it stands on");
    const two = [{ kind: "section_add" as const, label: "A", page: "/p", where: "Footer", before: null, after: "Footer: nothing here", evidenceKeys: [], risk: "safe" as const },
      { kind: "section_add" as const, label: "B", page: "/p", where: "Elsewhere", before: null, after: `Elsewhere: ${CTA}`, evidenceKeys: [], risk: "safe" as const }];
    const split = body(`${KEEP} ${CTA}`, KEEP, { preservation: [{ text: CTA, disposition: "moved", to: "Footer" }],
      claims: two.map((c, i) => ({ text: "salam means peace", supportedBy: ["fact-1"], of: componentIdOf(c, i) })),
      bundle: { objective: "o", receipt: { items: [], missing: [], freshestObservedAt: null }, components: two } });
    expect(evidenceShortfall(split), "the destination piece must be the piece that carries it").toContain("does not carry it");
    const claimed = (over: Record<string, unknown> = {}) => row("nr", { ...edit("section", "Meaning:Wisdom.", "Meaning:Light.", { where: 'Replaces the existing passage under "Meanings"' }), changeFamily: "factual_correction", // 9e. AN UNRELATED FACT AUTHORIZES NOTHING. The identity is exact, so a receipt cannot ride other words; it said nothing about whether the cited passage SUPPORTS the claim, and the reviewer's claim-level reasoning was thrown away after every paid call. "Noor means light" could stand on "Tehran is the capital of Iran".
      claims: [{ text: "Noor means light", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: "Tehran is the capital of Iran." }],
      preservation: [{ text: "Meaning:Wisdom.", disposition: "corrected", by: ["fact-1"] }], ...over });
    const reviewed = (p: ChangeProposal, rulings: { i: number; by: string[]; entailed: boolean }[]) =>
      ({ ...p, semanticReview: { of: copyKey(p), version: REVIEW_CONTRACT, claims: rulings } }) as ChangeProposal;
    expect(evidenceShortfall(claimed()), "no reading at all").toContain("actually support what it claims");
    expect(evidenceShortfall(reviewed(claimed(), [{ i: 0, by: ["fact-1"], entailed: false }])), "the reviewer said it does not follow").toContain("not shown to follow");
    expect(evidenceShortfall(reviewed(claimed(), [])), "silence about a claim is not a pass").toContain("did not rule on every claim");
    expect(evidenceShortfall(reviewed(claimed(), [{ i: 0, by: ["fact-9"], entailed: true }])), "ruled on other evidence than the claim names").toContain("not shown to follow");
    expect(evidenceShortfall(reviewed(claimed(), [{ i: 0, by: ["fact-1"], entailed: true }, { i: 1, by: ["fact-1"], entailed: true }])), "a ruling for a claim it never made").toContain("did not rule on every claim");
    const stale = reviewed(claimed(), [{ i: 0, by: ["fact-1"], entailed: true }]);
    expect(evidenceShortfall(stale), "a whole, matching reading passes").toBeNull();
    expect(evidenceShortfall({ ...stale, semanticReview: { ...stale.semanticReview!, version: REVIEW_CONTRACT - 1 } } as ChangeProposal), "an older review contract").toContain("older review contract");
    for (const [what, mutated] of [["the fact's own words", { supportFacts: [{ id: "fact-1", fact: "Tehran is a city." }] }],
      ["the claim's text", { claims: [{ text: "Noor means brightness", supportedBy: ["fact-1"] }] }],
      ["which fact the claim names", { claims: [{ text: "Noor means light", supportedBy: ["fact-2"] }] }]] as const)
      expect(evidenceShortfall({ ...stale, ...mutated } as ChangeProposal), `changing ${what} voids the reading`).toContain("actually support what it claims");
    const substantive = row("kp", { ...edit("section", KEEP, `${KEEP} Kerman rugs use 300 KPSI.`, { where: 'Replaces the existing passage under "Rugs"' }), // A substantive claim answers the same way: perfect identity and a gain receipt are not support.
      informationGain: { adds: "names the knot density the page never states", by: ["fact-1"], pageWhole: true },
      claims: [{ text: "Kerman rugs use 300 KPSI", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: "Tehran is the capital of Iran." }] });
    expect(evidenceShortfall(substantive), "a substantive claim owes the same reading").toContain("actually support what it claims");
    expect(evidenceShortfall(reviewed(substantive, [{ i: 0, by: ["fact-1"], entailed: false }])), "and an unrelated fact fails it there too").toContain("not shown to follow");
    const served = (x: ChangeProposal): string | null => { const h = openHold(x); return (h.safetyHold ? null : h.blocking) ?? unsettledCause(x); }; // 10. ONE VERDICT, EVERY CONSUMER. openHold is NOT the whole Ready verdict: the list, the release builder Today reads, the detail page, Mark done and the promotion door each compose it with unsettledCause, and the sweep persists that pair as a typed fault. The evidence check rides INSIDE openHold, so all of them refuse together.
    for (const held of [creative, aeo({}), body(`${KEEP} ${CTA}`, KEEP)])
      expect(served(held), "every consumer of the shared verdict refuses it").toBe(evidenceShortfall(held));
    expect(served(gained)).toBeNull(); expect(served(typo)).toBeNull();
    store.rows = new Map([[creative.id, creative], [fill.id, fill]]);
    const q = await loadProposalQueue(T, { currentBasis: "b", now: new Date("2026-08-02T00:00:00.000Z") });
    expect(q.ready.map((p) => p.id)).toEqual([fill.id]);
    expect(q.toDo.map((p) => p.id)).toContain(creative.id); }); });
