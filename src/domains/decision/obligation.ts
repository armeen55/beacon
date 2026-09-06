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
import { editorialStandard, unreviewed } from "./proof";
import { unsettledCause } from "./authorization";
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

/** HOW MANY CORRECTIVE DRAFTS ONE ROW GETS. A third attempt on the same gates buys the same refusal: five
 *  answer-gap cards reached proposal_version 800 and up doing exactly that, so the third is settled instead. */
const MAX_ATTEMPTS = 2;
const SETTLED_AFTER_RETRIES = "two corrective drafts failed the same gates, so this is settled rather than retried";

/** The gap sentences that mean NOTHING EXACT IS WRITTEN YET, matched against `deliverableGaps`'s own output
 *  and nowhere else. This is the one place a sentence is read, and it is read from a function that composes
 *  it from typed structure on every call, never from a stored string a producer's voice can move. */
const UNWRITTEN = /no copy|describes the work instead|nothing has been written|carries no (?:title|description|opening)/i;
/** The sentence saying the RECORD behind finished words was lost, matched the same way: the store's own, written where a re-minted brief would have displaced real copy (completeness's `decideFinished`). */ const NO_RECORD = /no record of what it stands on/i;
/** AN OBJECTION NO LIVE DOOR CAN WRITE FOR THIS ROW IS HISTORY, NOT A DEBT (operator, 2026-09-05). Two of the editor's sentences were composed under the universal rule that every edit owes information the page does not carry: the line-count refusal of a restructuring, which is deleted outright, and "it repeats the search instead of improving the page", which the editor now writes only where the standard genuinely owes information (a missing answer or a correction). A summary, a restructuring and a link are judged on their own standard and can never be handed either sentence again, so a stored row carrying one owes no paid rewrite for it. NARROW BY CONSTRUCTION: it retires these two sentences on exactly the three standards that cannot produce them, touches no other fault, and re-reads no stored reading at all (the review contract is unmoved, so nothing banked is re-bought). */
const RETIRED = /^this rearranges the page into one more paragraph|^it repeats the search instead of improving the page/i; /** THE SETTLEMENT SENTENCE THE WALK COMPOSES WHEN NOTHING NAMED A GAP, matched here the way UNWRITTEN above is matched against live output: one place writes it, one place reads it, and no stored phrasing decides anything. */ const NO_GAP_NAMED = /^no substantive gap named$/i;
/** AND AN OBJECTION THE LIVE DOOR WOULD NO LONGER WRITE FOR THESE EXACT WORDS IS HISTORY TOO (measured, 2026-09-05). The promise rule refuses a line for calling the subject a word "this page's own copy never carries", and until this morning both doors asked that of the page's title, heading and outline alone, so ten stored rows carry the objection about a word their own page publishes in its body and each owes a paid corrective draft for a sentence no door would write again. The rule that retires it is the SAME question the live door asks, put to the record of the page the row itself carries: `copyStamp` (the title, heading, published description and outline as last read), the line this change replaces, and the passages the row banked as the page's own. The word is quoted in the objection, so nothing here reads a vocabulary and nothing is retired on shape: a row whose page really never carries the word keeps its fault and its redraft. Measured on the store: 10 rows carry it, 8 name a word their own record carries and are retired, 2 name "curated" on a page that never says it and stand. */ const PROMISED = /^it calls the subject "([^"]+)", a word this page's own copy never carries/;

/** How many sections a new page still owes, off the one gap only `deliverableGaps` can compute. */
const owedSections = (gaps: readonly string[]): number => {
  const said = gaps.find((g) => g.includes("sections have no copy written")); return said ? Number(/^(\d+)/.exec(said)?.[1] ?? 0) : 0; };

/** THE NEXT TYPED STEP, or null when nothing is owed. Null is a real answer and the one the $0 release loop
 *  acts on: a held row whose obligation recomputes to null has nothing typed against it, so it may replay.
 *
 *  PRECEDENCE, high to low: terminal, operator, draft, sections, evidence, review, then redraft, which is the
 *  last rung and answers for BOTH the row's typed faults and any hold the one servability verdict still has on
 *  these exact words; a cause the treatment cannot touch settles instead, because no redraft of it can ever fit.
 *  It is an order of BLOCKING, not of cost: a page whose brief is unwritten cannot owe a review of copy that
 *  does not exist, and a safety confirmation outranks every defect because no work of Beacon's answers it.
 *
 *  TERMINAL IS STICKY. It is settled work, so it survives every later pass that reaches this row under the
 *  same work identity; a pass that genuinely moves the identity arrives with no obligation on the row at all
 *  (a producer never mints one) and the ladder below decides again from nothing. */
export function nextObligation(p: ChangeProposal): Obligation | null {
  if (p.status === "implemented_pending_verification") return null;
  const settlement = p.obligation?.kind === "terminal" ? p.obligation : null, owedRead = p.obligation?.kind === "evidence" && p.obligation.need.reasonCode === "no_winner_to_read" ? p.obligation : null, onFile = p.winnersOnFile ?? null, asked = (p.primaryQuery ?? "").trim();
  if (settlement || owedRead) return (settlement == null || NO_GAP_NAMED.test(settlement.reason)) && onFile != null && onFile !== "read" && asked !== "" ? { kind: "evidence", need: { kind: onFile === "unread" ? "competitor_page" : "serp", query: asked, reasonCode: "no_winner_to_read" } } : settlement ?? (onFile === "read" ? nextObligation({ ...p, obligation: undefined }) : owedRead!); /* AND A SETTLEMENT NOBODY READ THE WINNERS FOR IS NOT A SETTLEMENT, WHEREVER IT IS ASKED (production 09:03:46Z, 2026-09-06). The walk owed that reading only where a funded job had just been drafted, and a terminal row is never funded, so the four hub name rows could not reach that door at all: the release sweep recomputed their obligation from the stored state through this ladder and wrote `terminal: no substantive gap named` again on every pass, on searches no results page had ever been bought for. The question belongs where the obligation is DECIDED for a stored row, so it is asked here, off the row's own typed `winnersOnFile`, and the walk asks this same function rather than keeping a second copy of the rule. NO WINNER IS NOT "THE WINNERS CARRY NOTHING": it is one unbought reading, and the terminal stands exactly where the group's winners WERE read and carry nothing, which is the truthful refusal. A row no producer stamped is unchanged. AND THE PURCHASE IS NAMED BY WHAT IS ALREADY ON FILE (reviewer two, 2026-09-06): `unread` means the results page was bought and nothing off it was read, so asking for that same results page again buys a page already on file (and re-marks it pending inside its own one day window), while the reading actually owed goes unbought; only the winner read moves `unread` to `read`, so the need names the winning pages of this exact search. `none` has no results page for any phrasing, so it names that first and the winner read follows it. AND THE ANSWER IS DERIVED FROM WHAT IS ON FILE ON EVERY PASS, NEVER READ BACK OFF THE ROW (reviewer two, 2026-09-06): the reading is stamped onto the row so the runtime's buy loops can see it, which replaces the settlement that was its own input, so a second pass over unmoved evidence found no settlement to read, decided from nothing and owed a first paid draft for a search whose winners nobody has read. This rung answers for its own output too: while the stamp still says nobody read them the same need comes back unchanged, a stamp that has moved to `unread` names the winner read instead of the results page already on file, and a stamp that reaches `read` discharges the reading and hands the row back to the ladder below. */
  const hold = openHold(p);
  if (hold.safetyHold) return { kind: "operator", decision: "safety_confirmation" };
  if (p.researchOnly === true && p.obligation?.kind === "evidence") return p.obligation; // A TYPED READING ON A RESEARCH ROW SURVIVES THE SAVE (reviewer, 2026-09-02): every research row answered `draft` here, so the capture, the source and the split reading a pass had just worked out were overwritten at the store door, the runtime bought none of them, and the row was refused again at $0 on the next pass for ever. Only the row's own last pass writes this field, so honouring it is honouring that pass, not guessing; when the reading lands, the same pass recomputes it and either clears it or hires the writer.
  const gaps = deliverableGaps(p), unwritten = gaps.some((g) => UNWRITTEN.test(g)), owed = owedSections(gaps);
  // A ROW BANKED BEFORE THE COUNT EXISTED IS ON ATTEMPT ONE, never on its cap: absent is zero attempts consumed, so the two-attempt settlement can only ever bite on drafts this contract actually counted. AND A DRAFT NOBODY EVER WROTE IS NOT A DRAFT THAT WAS REFUSED TWICE (live 12:00Z, 2026-09-05): the walk spent two provider calls on the account's largest card, both drafts were refused, and the row went on owing a first draft with no fault, no words and no count, so nothing on it could ever settle and the same money was owed again every pass. A row still carrying no copy owes another draft while it has attempts left, and settles on the same two-attempt rule finished copy answers to once it has spent them. The receipt read here is the pass's own and typed: the words it retired, and the refusing sentence standing on the row as a fault. A retirement whose reason is NOT one of the row's faults is an identity move or a stale-rules re-read, which owe a first draft exactly as before.
  const attempt = (p.previousCopy?.attempts ?? 0) + 1, redraft = (instruction: string): Obligation => attempt > MAX_ATTEMPTS ? { kind: "terminal", reason: SETTLED_AFTER_RETRIES } : { kind: "redraft", attempt, instruction }, refused = p.previousCopy && (p.faults ?? []).includes(p.previousCopy.retiredBecause) ? p.previousCopy.retiredBecause : null;
  if (p.recommendedChange.kind === "new_page") {
    if (unwritten || owed > 0) return { kind: "sections", owed: Math.max(owed, 1) };
  } else if (p.researchOnly === true || unwritten) return refused ? redraft(refused) : { kind: "draft" }; // A REFUSED FUNDED DRAFT OWES A CORRECTIVE ONE, NOT A FIRST ONE (R9 and D2i, 2026-09-05): the objection rides as the instruction, the owed step moves from draft to redraft so the work identity moves and the day's memory hands the writer the second attempt today, and `redraft` still settles the third on the two-attempt rule.
  if (hold.need) return { kind: "evidence", need: hold.need };
  // A REVIEW THAT IS OWED IS NOT A REDRAFT WEARING A FAULT (live, 2026-09-04). The sweep writes whatever blocks a
  // ready row into `faults`, so "the reading on file was made under an older review contract" sat as a typed fault
  // on sixteen live rows and, redraft outranking review, each owed a PAID rewrite of words no gate faulted while the
  // cheap re-read went untaken. Matched against the sentence THIS row's own verdict composes now, as UNWRITTEN above is matched against live output: no stored phrasing decides anything, and a real fault is never dropped.
  // AN OBJECTION A LIVE DOOR NO LONGER WRITES IS HISTORY, NOT AN OBLIGATION (live rows, 2026-09-04): /farsi-numbers, a valid FAQPage block, carries "its copy is 150 long, outside the 15 to 400 this field takes, or carries something nobody can paste", a body word band in a sentence no rule composes any more, on markup the prose editor never judges at all (proof's `unreviewed` exempts structured data because its truth is the canon's visible-content proof). An objection from a door this row does not pass through cannot be redrafted away, so it stays on the row as history and the schema gate's own findings are what is owed. A real fault is never dropped.
  // AND THE THREE THINGS FINISHED WORDS CAN OWE ARE NOT ONE STEP (incident, 2026-09-04): the words are bad, so redraft them; the words may be good and the RECORD of what they stand on was lost, so read them again and rebuild it; or the evidence itself is missing, so go and get it. Twenty five recovered descriptions held real copy, no claims and the store's own record sentence, and the only rung that answered was a paid rewrite of words no gate had faulted.
  const markup = p.recommendedChange.kind === "existing_edit" && p.recommendedChange.field === "schema";
  const records = !markup && (p.claims ?? []).length === 0 && gaps.length === 0
    && [...(p.faults ?? []), ...p.limitations].some((f) => NO_RECORD.test(f)); // the STORE's own finding that this row's record was lost, never a fresh guess: a row that never carried claims is not a row that lost them
  const standard = editorialStandard({ field: p.recommendedChange.kind === "existing_edit" ? p.recommendedChange.field : null, link: p.recommendedChange.kind === "existing_edit" && !!p.recommendedChange.linkTo, assignment: p.assignment, changeFamily: p.changeFamily });
  const ownsInformation = standard === "missing_answer" || standard === "correction"; // the two standards whose copy really does owe information the page does not carry; the other three answer to form, a route or the line they replace
  const ownRecord = [p.copyStamp ?? "", p.recommendedChange.kind === "existing_edit" ? p.recommendedChange.before ?? "" : "", ...(p.supportFacts ?? []).filter((x) => /^page-/.test(x.id)).map((x) => x.fact)].join(" ").toLowerCase(); // the row's OWN record of the page, typed: what the page said when it was last read, the line this change replaces, and the passages the row banked as the page's
  const owedReview = unreviewed(p), faults = (p.faults ?? []).filter((f) => f !== owedReview
    && (!markup || /^this structured data/i.test(f)) && !NO_RECORD.test(f) && (ownsInformation || !RETIRED.test(f))
    && !((w) => w != null && ownRecord.includes(w.toLowerCase()))(PROMISED.exec(f)?.[1])); // the record sentence is never a statement about the words: it is answered by the reading below while the record is missing, and by the record itself once that reading has rebuilt it
  // A REFUSED REVIEW IS NOT BOUGHT AGAIN THE SAME DAY (falsifier, 2026-09-02). Review outranked redraft, so /farsi-numbers, whose paid reviewer refused it at 02:56Z and again at 03:08Z with the same objection sitting on the row as a typed fault, still answered `review` and the runtime paid the evaluator every drive. A reading is for copy with no KNOWN defect; a row that carries one owes the corrective draft first, and the reading is owed again only once the words have moved.
  if (faults.length > 0) return redraft(faults[0]!);
  if (owedReview != null || records) return { kind: "review" };
  // A LEVER THAT CANNOT TREAT THE CAUSE ITS OWN EVIDENCE NAMED IS SETTLED, NOT RETRIED: no redraft of the same treatment ever fits a cause that treatment does not touch, so buying another one buys the same refusal.
  const unfit = unsettledCause(p); if (unfit) return { kind: "terminal", reason: unfit };
  // AND FINAL COPY MAY NOT SIT BEHIND A BLOCKER NOBODY OWNS (falsifier, 2026-09-02). A section held on "nothing on file says what a reader gains from it" owed nothing typed, so the $0 replay skipped it for ever while the one servability verdict went on refusing it. Whatever still blocks these exact words is the instruction the next draft writes against; the safety confirmation is the operator's and already returned above.
  return hold.blocking ? redraft(hold.blocking) : null;
}
