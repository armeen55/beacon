/** decision/obligation: THE ONE TYPED NEXT STEP a stored change owes, derived from typed fields alone.
 *
 * Rows carried final copy and no typed next step, so the machine worked out what to do by reading English:
 * a lowercase first letter meant "a gate wrote this", a phrase list meant "this hold was withdrawn", and a
 * semantic review that was owed was filed as a factual_source acquisition, which sent the runtime to buy
 * facts instead of taking the reading nobody had taken. Every one of those is a rule about spelling, so
 * rewording a caveat silently changed what Beacon went and did next.
 *
 * WHAT THIS MAY READ: typed fields only (status, researchOnly, faults, previousCopy, obligation, the one
 * servability verdict's typed `need`/`safetyHold`, the reviewer's own answer, and `deliverableGaps` for the
 * two things only it knows: whether a deliverable is unwritten, and how many sections a new page still owes).
 * It never reads limitations, whyItMatters or research.next: those are display text for a person.
 *
 * PURE: no I/O, no clock, no model. Client-safe, so the same answer reaches a card and the producer.
 */

import { deliverableGaps, openHold } from "./completeness";
import { unreviewed, copyKey } from "./proof";
import { COPY_RULES } from "./copy-sanitize";
import type { ChangeProposal } from "./contracts";
import type { EvidenceRequirement } from "./producers/contract";

/** WHAT IS OWED NEXT, in the vocabulary each consumer can act on without asking a second question.
 *  `draft` a brief with no copy yet; `sections` a new page whose outline outruns its written sections;
 *  `redraft` final copy Beacon's own gates faulted, carrying the exact objection to write against;
 *  `evidence` a reading the runtime's acquisition already executes; `review` finished copy whose sources
 *  nobody has read together; `operator` the one hold that is genuinely a person's call; `terminal` work that
 *  is settled rather than retried, which is a fact about the work and never a queue position. */
export type Obligation =
  | { kind: "draft" }
  | { kind: "sections"; owed: number }
  | { kind: "redraft"; attempt: number; instruction: string }
  | { kind: "evidence"; need: EvidenceRequirement }
  | { kind: "review" }
  | { kind: "operator"; decision: "safety_confirmation" }
  | { kind: "terminal"; reason: string };

/** HOW MANY CORRECTIVE DRAFTS ONE ROW GETS before it rests: a fifth attempt on the same gates buys the same refusal, so it is settled instead, and the settlement itself decays below. */
const MAX_ATTEMPTS = 4, SETTLEMENT_DAYS = 7; /* NOTHING IS PERMANENT (operator HARD rule, 2026-09-10): a settlement is a rest, not a grave; after a week the row is ordinary work again with a fresh attempt count, re-judged by whatever rules stand then. Corrective attempts belong to the material work identity, never its age. */ const settlementExpired = (p: { previousCopy?: { at?: string } | null; createdAt?: string }): boolean => Date.now() - (Date.parse(p.previousCopy?.at ?? "") || Date.parse(p.createdAt ?? "") || Date.now()) > SETTLEMENT_DAYS * 86_400_000;
const SETTLED_AFTER_RETRIES = "two corrective drafts failed the same gates, so this is settled rather than retried";

/** The gap sentences that mean NOTHING EXACT IS WRITTEN YET, matched against `deliverableGaps`'s own output
 *  and nowhere else. This is the one place a sentence is read, and it is read from a function that composes
 *  it from typed structure on every call, never from a stored string a producer's voice can move. */
const UNWRITTEN = /no copy|describes the work instead|nothing has been written|carries no (?:title|description|opening)/i;
/** The sentence saying the RECORD behind finished words was lost, matched the same way: the store's own, written where a re-minted brief would have displaced real copy (completeness's `decideFinished`). */ const NO_RECORD = /no record of what it stands on/i;
/** THE TWO SENTENCES THIS LADDER USED TO RETIRE BY HAND ARE THE ADVISORY PARTITION'S NOW (owner's editorial policy, 2026-09-06). A line-count refusal of a restructuring and "it repeats the search instead of improving the page" were retired here, on exactly the three standards that cannot produce them; both are advisory kinds in `openHold` today, so they never reach `faults` at all and no rung has to remember them. The row's own record still retires a promise-word objection below, because that one is evidence about this page rather than a policy about the sentence. */
/** THE SETTLEMENT SENTENCE THE WALK COMPOSES WHEN NOTHING NAMED A GAP, matched here the way UNWRITTEN above is matched against live output: one place writes it, one place reads it, and no stored phrasing decides anything. */ const NO_GAP_NAMED = /^no substantive gap named$/i;
/** AND AN OBJECTION THE LIVE DOOR WOULD NO LONGER WRITE FOR THESE EXACT WORDS IS HISTORY TOO (measured, 2026-09-05). The promise rule refuses a line for calling the subject a word "this page's own copy never carries", and until this morning both doors asked that of the page's title, heading and outline alone, so ten stored rows carry the objection about a word their own page publishes in its body and each owes a paid corrective draft for a sentence no door would write again. The rule that retires it is the SAME question the live door asks, put to the record of the page the row itself carries: `copyStamp` (the title, heading, published description and outline as last read), the line this change replaces, and the passages the row banked as the page's own. The word is quoted in the objection, so nothing here reads a vocabulary and nothing is retired on shape: a row whose page really never carries the word keeps its fault and its redraft. Measured on the store: 10 rows carry it, 8 name a word their own record carries and are retired, 2 name "curated" on a page that never says it and stand. */ const PROMISED = /^it calls the subject "([^"]+)", a word this page's own copy never carries/;

/** THE ROW AS ORDINARY WORK AGAIN: no settlement, attempts reset, so the ladder decides from nothing. */ const decayed = (p: ChangeProposal): ChangeProposal => ({ ...p, obligation: undefined, previousCopy: p.previousCopy ? { ...p.previousCopy, attempts: 0 } : p.previousCopy });
/** THE SENTENCE SAYING A QUOTATION'S SUPPORT IS OWED, composed by `deliverableGaps` and the stale-copy reader and read here by meaning: it names missing evidence, not bad words. */ const SUPPORT_OWED = /source support is still owed/i;
/** How many sections a new page still owes, off the one gap only `deliverableGaps` can compute. */
const owedSections = (gaps: readonly string[]): number => {
  const said = gaps.find((g) => g.includes("sections have no copy written")); return said ? Number(/^(\d+)/.exec(said)?.[1] ?? 0) : 0; };

/** Private banks resume review or missing pieces; finished work uses the common acceptance ladder. */
export function nextObligation(p: ChangeProposal): Obligation | null {
  if (p.status === "implemented_pending_verification") return null;
  const attempt = (p.previousCopy?.attempts ?? 0) + 1, redraft = (instruction: string): Obligation => attempt > MAX_ATTEMPTS ? { kind: "terminal", reason: SETTLED_AFTER_RETRIES } : { kind: "redraft", attempt, instruction }, refused = p.previousCopy && (p.faults ?? []).includes(p.previousCopy.retiredBecause) ? p.previousCopy.retiredBecause : null;
  if ((p.faults ?? []).some((w) => /category, tag or media index page/.test(w)) && (p.primaryQuery ?? "").trim()) return { kind: "evidence", need: { kind: "serp", query: p.primaryQuery!.trim(), reasonCode: "no_winner_to_read" } }; // never a paid redraft on navigation copied from a rival: the winners are read again, and the index page is no longer among them (reviewer, 2026-09-15)
  if (p.kind === "new_page" && p.newPageDraft && !COPY_RULES.newPagePieces(p.newPageDraft)) return { kind: "terminal", reason: "The banked new page has an ambiguous record; preserve its copy and reconcile ownership before any paid work." }; const rewrite = COPY_RULES.pieceDebt(p); if (rewrite === null) return { kind: "terminal", reason: "The banked rewrite has an invalid record; preserve its copy and reconstruct the plan before any further paid work." }; if (p.newPageDraft?.brief.kind === "body_meta" && p.obligation?.kind === "terminal") return settlementExpired(p) ? nextObligation(decayed(p)) : p.obligation; if (rewrite !== undefined && p.newPageDraft?.pieces.some(piece => !COPY_RULES.accepted(piece.editor))) return { kind: "review" }; if (p.newPageDraft?.brief.kind === "body_meta" && refused && rewrite) return redraft(refused); if (rewrite) return { kind: "sections", owed: rewrite }; const hold = openHold(p), owedReview = unreviewed(p);
  // A SETTLEMENT STANDS WHILE THE ONE VERDICT STILL HOLDS A DEFECT ON THESE WORDS, and not a day longer (journey review, 2026-09-06). Terminal means "buy no more corrective drafts for this", which is only ever a statement about words a gate still refuses: fourteen finished drafts sat settled by the two-corrective-drafts rule on conditions the owner's policy now calls advisories, and a settlement written by the deleted lever rule kept a clean row waiting for a manual approve. Words the verdict finds no defect in owe nothing, whatever an earlier rule settled about them.
  const settlement = p.obligation?.kind === "terminal" && (NO_GAP_NAMED.test(p.obligation.reason) || hold.defects.some((why) => !COPY_RULES.reviewHold(why))) ? p.obligation : null, /* a settlement whose only remaining defect is a reading owed is dropped and the reading filed (restored, audit 2026-09-14) */ /* the walk's own "no gap named" settlement is a statement about research, not about these words: it keeps carrying the reading the row owes */ owedRead = p.obligation?.kind === "evidence" && p.obligation.need.reasonCode === "no_winner_to_read" ? p.obligation : null, onFile = p.winnersOnFile ?? null, asked = (p.primaryQuery ?? "").trim();
  if (settlement || owedRead) return (settlement == null || NO_GAP_NAMED.test(settlement.reason)) && onFile != null && onFile !== "read" && asked !== ""
    ? { kind: "evidence", need: { kind: onFile === "unread" ? "competitor_page" : "serp", query: asked, reasonCode: "no_winner_to_read" } }
    : settlement ? (settlementExpired(p) ? nextObligation(decayed(p)) : settlement) : (onFile === "read" ? nextObligation({ ...p, obligation: undefined }) : owedRead!); // THE DECAY BITES ONLY WHERE THE SETTLEMENT WOULD STAND: converting a terminal row into the winner reading it owes is productive at any age; a refusal that would merely stand again after a week is trash taken out. Material changes reopen through preferFinished; missing winner research still advances from SERP to page reading.
  if (hold.safetyHold) return { kind: "operator", decision: "safety_confirmation" };
  if (p.obligation?.kind === "evidence" && (p.researchOnly === true || p.obligation.need.reasonCode === "source_support_unconfirmed" || (p.recommendedChange.kind === "existing_edit" && p.recommendedChange.field === "schema" && p.obligation.need.reasonCode === "schema_visible_pair_unconfirmed"))) return p.obligation;
  const gaps = deliverableGaps(p), unwritten = gaps.some((g) => UNWRITTEN.test(g)), owed = owedSections(gaps);
  // A ROW BANKED BEFORE THE COUNT EXISTED IS ON ATTEMPT ONE, never on its cap: absent is zero attempts consumed, so the two-attempt settlement can only ever bite on drafts this contract actually counted. AND A DRAFT NOBODY EVER WROTE IS NOT A DRAFT THAT WAS REFUSED TWICE (live 12:00Z, 2026-09-05): the walk spent two provider calls on the account's largest card, both drafts were refused, and the row went on owing a first draft with no fault, no words and no count, so nothing on it could ever settle and the same money was owed again every pass. A row still carrying no copy owes another draft while it has attempts left, and settles on the same two-attempt rule finished copy answers to once it has spent them. The receipt read here is the pass's own and typed: the words it retired, and the refusing sentence standing on the row as a fault. A retirement whose reason is NOT one of the row's faults is an identity move or a stale-rules re-read, which owe a first draft exactly as before.
  if (p.recommendedChange.kind === "new_page") {
    if (p.newPageDraft?.pieces.some((piece) => !COPY_RULES.accepted(piece.editor))) return { kind: "review" };
    if (unwritten || owed > 0) return { kind: "sections", owed: Math.max(owed, 1) };
    const repair = p.newPageDraft?.repair;
    if (repair?.of === copyKey(p)) return repair.resolution === "no_valid_treatment" ? { kind: "terminal", reason: repair.targets[0]?.instruction ?? p.faults?.[0] ?? "The page has no defensible treatment on its current evidence." } : /^(structural_synthesis|use_stored_verified_evidence)$/.test(repair.resolution) && repair.targets.length > 0 ? redraft(repair.targets.map((t) => t.instruction).join("; ")) : { kind: "review" };
  } else if ((p.researchOnly === true && rewrite === undefined) || unwritten) return refused ? redraft(refused) : { kind: "draft" }; // An incomplete rewrite resumes its bank; a complete held rewrite owes acceptance, not wholesale redrafting.
  // A REVIEW THAT IS OWED IS NOT A REDRAFT WEARING A FAULT (live, 2026-09-04). The sweep writes whatever blocks a
  // ready row into `faults`, so "the reading on file was made under an older review contract" sat as a typed fault
  // on sixteen live rows and, redraft outranking review, each owed a PAID rewrite of words no gate faulted while the
  // cheap re-read went untaken. Matched against the sentence THIS row's own verdict composes now, as UNWRITTEN above is matched against live output: no stored phrasing decides anything, and a real fault is never dropped.
  // AN OBJECTION A LIVE DOOR NO LONGER WRITES IS HISTORY, NOT AN OBLIGATION (live rows, 2026-09-04): /farsi-numbers, a valid FAQPage block, carries "its copy is 150 long, outside the 15 to 400 this field takes, or carries something nobody can paste", a body word band in a sentence no rule composes any more, on markup the prose editor never judges at all (proof's `unreviewed` exempts structured data because its truth is the canon's visible-content proof). An objection from a door this row does not pass through cannot be redrafted away, so it stays on the row as history and the schema gate's own findings are what is owed. A real fault is never dropped.
  // AND THE THREE THINGS FINISHED WORDS CAN OWE ARE NOT ONE STEP (incident, 2026-09-04): the words are bad, so redraft them; the words may be good and the RECORD of what they stand on was lost, so read them again and rebuild it; or the evidence itself is missing, so go and get it. Twenty five recovered descriptions held real copy, no claims and the store's own record sentence, and the only rung that answered was a paid rewrite of words no gate had faulted.
  const markup = p.recommendedChange.kind === "existing_edit" && p.recommendedChange.field === "schema";
  const records = !markup && (p.claims ?? []).length === 0 && gaps.length === 0
    && [...(p.faults ?? []), ...p.limitations].some((f) => NO_RECORD.test(f)); // the STORE's own finding that this row's record was lost, never a fresh guess: a row that never carried claims is not a row that lost them
  const ownRecord = [p.copyStamp ?? "", p.recommendedChange.kind === "existing_edit" ? p.recommendedChange.before ?? "" : "", ...(p.supportFacts ?? []).filter((x) => /^page-/.test(x.id)).map((x) => x.fact)].join(" ").toLowerCase(); // the row's OWN record of the page, typed: what the page said when it was last read, the line this change replaces, and the passages the row banked as the page's // AND AN OBJECTION THE OWNER JUDGES FOR THEMSELVES IS NOT A DEBT AT ALL (owner's editorial policy, 2026-09-06): the one readiness verdict partitions this row's own faults, so a sentence it files as an advisory buys no corrective draft and can never spend an attempt or settle a row; only a defect Beacon owes reaches the rungs below.
  const supportOwed = hold.defects.some((f) => SUPPORT_OWED.test(f)), faults = (p.faults ?? []).filter((f) => hold.defects.includes(f) && !COPY_RULES.reviewHold(f) && f !== owedReview && !(owedReview != null && (f.endsWith(`: ${owedReview}`) || COPY_RULES.supersededEditorFinding(f))) /* raw or composed by the sweep, a review-hold sentence is a reading, never a paid rewrite, whatever sentence the live verdict composes today (audit, 2026-09-14): a stale composed fault survived while owedReview was null or a different sentence and minted a paid redraft */
    && (!markup || /^this structured data/i.test(f)) && !NO_RECORD.test(f) && !SUPPORT_OWED.test(f) && !(supportOwed && /cites a source that is not attached to it/.test(f)) /* the unattached-source sentence composed beside an unobserved quotation is that same missing reading, not a second fault */
    && !((w) => w != null && ownRecord.includes(w.toLowerCase()))(PROMISED.exec(f)?.[1])); // the record sentence is never a statement about the words: it is answered by the reading below while the record is missing, and by the record itself once that reading has rebuilt it
  // A REFUSED REVIEW IS NOT BOUGHT AGAIN THE SAME DAY (falsifier, 2026-09-02). Review outranked redraft, so /farsi-numbers, whose paid reviewer refused it at 02:56Z and again at 03:08Z with the same objection sitting on the row as a typed fault, still answered `review` and the runtime paid the evaluator every drive. A reading is for copy with no KNOWN defect; a row that carries one owes the corrective draft first, and the reading is owed again only once the words have moved.
  if (faults.length > 0) return redraft(faults[0]!);
  if (supportOwed) return { kind: "evidence", need: { kind: "page_source", query: p.primaryQuery, url: p.pageUrl ?? p.pagePath ?? "", proposalId: p.id, reasonCode: "source_support_unconfirmed" } }; /* SUPPORT STILL OWED IS A READING TO TAKE, NEVER A REDRAFT (production, 2026-09-15): three Ready link rows whose page quotations the new heading-scoped read no longer matched were sent to a paid rewrite of words no gate faulted; the words stand, the page is read again, and the review re-qualifies the quotation */
  if (owedReview != null || records || hold.defects.some(COPY_RULES.reviewHold)) return { kind: "review" }; // a reading outranks a blocker nobody faulted: a row held for a look owes the look, never a paid rewrite (restored, audit 2026-09-14); a stale review-hold sentence still holding the row is cleared by the reading it names
  // AND FINAL COPY MAY NOT SIT BEHIND A BLOCKER NOBODY OWNS (falsifier, 2026-09-02). A section held on "nothing on file says what a reader gains from it" owed nothing typed, so the $0 replay skipped it for ever while the one servability verdict went on refusing it. Whatever still blocks these exact words is the instruction the next draft writes against; the safety confirmation is the operator's and already returned above.
  return hold.blocking ? redraft(hold.blocking) : null;
}
