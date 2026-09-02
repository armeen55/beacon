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
import { unreviewed } from "./proof";
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

/** How many sections a new page still owes, off the one gap only `deliverableGaps` can compute. */
const owedSections = (gaps: readonly string[]): number => {
  const said = gaps.find((g) => g.includes("sections have no copy written"));
  return said ? Number(/^(\d+)/.exec(said)?.[1] ?? 0) : 0;
};

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
  if (p.obligation?.kind === "terminal") return p.obligation;
  const hold = openHold(p);
  if (hold.safetyHold) return { kind: "operator", decision: "safety_confirmation" };
  const gaps = deliverableGaps(p), unwritten = gaps.some((g) => UNWRITTEN.test(g)), owed = owedSections(gaps);
  if (p.recommendedChange.kind === "new_page") {
    if (unwritten || owed > 0) return { kind: "sections", owed: Math.max(owed, 1) };
  } else if (p.researchOnly === true || unwritten) return { kind: "draft" };
  if (hold.need) return { kind: "evidence", need: hold.need };
  if (unreviewed(p) != null) return { kind: "review" };
  const faults = p.faults ?? [];
  // A ROW BANKED BEFORE THE COUNT EXISTED IS ON ATTEMPT ONE, never on its cap: absent is zero attempts consumed, so the two-attempt settlement can only ever bite on drafts this contract actually counted.
  const attempt = (p.previousCopy?.attempts ?? 0) + 1;
  const redraft = (instruction: string): Obligation => attempt > MAX_ATTEMPTS ? { kind: "terminal", reason: SETTLED_AFTER_RETRIES } : { kind: "redraft", attempt, instruction };
  if (faults.length > 0) return redraft(faults[0]!);
  // A LEVER THAT CANNOT TREAT THE CAUSE ITS OWN EVIDENCE NAMED IS SETTLED, NOT RETRIED: no redraft of the same treatment ever fits a cause that treatment does not touch, so buying another one buys the same refusal.
  const unfit = unsettledCause(p); if (unfit) return { kind: "terminal", reason: unfit };
  // AND FINAL COPY MAY NOT SIT BEHIND A BLOCKER NOBODY OWNS (falsifier, 2026-09-02). A section held on "nothing on file says what a reader gains from it" owed nothing typed, so the $0 replay skipped it for ever while the one servability verdict went on refusing it. Whatever still blocks these exact words is the instruction the next draft writes against; the safety confirmation is the operator's and already returned above.
  return hold.blocking ? redraft(hold.blocking) : null;
}
