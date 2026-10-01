/** One client-safe next action for a saved change, derived from its typed record and
 * current acceptance checks. Display prose never decides what work to buy. */

import { deliverableGaps, openHold } from "./completeness";
import { unreviewed, copyKey } from "./proof";
import { COPY_RULES } from "./copy-sanitize";
import { fieldForComponent } from "./producers/contract";
import { canonicalUrlKey } from "@/domains/evidence/relevance-gate";
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
  | { kind: "terminal"; reason: string; holdCode?: "bank_reconciliation" | "settled_invalid_output"; materialKey?: string; sourceMaterialHash?: string };

/** Four attempts on the same material and gate settle the refusal; a changed material identity may reopen it. */
const MAX_ATTEMPTS = 4;
const SETTLED_AFTER_RETRIES = "two corrective drafts failed the same gates, so this is settled rather than retried";
const captureFinding = (why: string): boolean => [COPY_RULES.pageState.capture, COPY_RULES.pageState.linkCapture].some(source => why === source || why.endsWith(`: ${source}`));
const inputDebt = (why: string): boolean => COPY_RULES.reviewHold(why) || captureFinding(why);

/** The gap sentences that mean NOTHING EXACT IS WRITTEN YET, matched against `deliverableGaps`'s own output
 *  and nowhere else. This is the one place a sentence is read, and it is read from a function that composes
 *  it from typed structure on every call, never from a stored string a producer's voice can move. */
const UNWRITTEN = /no copy|describes the work instead|nothing has been written|carries no (?:title|description|opening)/i;
/** The sentence saying the RECORD behind finished words was lost, matched the same way: the store's own, written where a re-minted brief would have displaced real copy (completeness's `decideFinished`). */ const NO_RECORD = /no record of what it stands on/i;
/** THE SETTLEMENT SENTENCE THE WALK COMPOSES WHEN NOTHING NAMED A GAP, matched here the way UNWRITTEN above is matched against live output: one place writes it, one place reads it, and no stored phrasing decides anything. */ const NO_GAP_NAMED = /^no substantive gap named$/i;
/** AND AN OBJECTION THE LIVE DOOR WOULD NO LONGER WRITE FOR THESE EXACT WORDS IS HISTORY TOO (measured, 2026-09-05). The promise rule refuses a line for calling the subject a word "this page's own copy never carries", and until this morning both doors asked that of the page's title, heading and outline alone, so ten stored rows carry the objection about a word their own page publishes in its body and each owes a paid corrective draft for a sentence no door would write again. The rule that retires it is the SAME question the live door asks, put to the record of the page the row itself carries: `copyStamp` (the title, heading, published description and outline as last read), the line this change replaces, and the passages the row banked as the page's own. The word is quoted in the objection, so nothing here reads a vocabulary and nothing is retired on shape: a row whose page really never carries the word keeps its fault and its redraft. Measured on the store: 10 rows carry it, 8 name a word their own record carries and are retired, 2 name "curated" on a page that never says it and stand. */ const PROMISED = /^it calls the subject "([^"]+)", a word this page's own copy never carries/;

/** THE SENTENCE SAYING A QUOTATION'S SUPPORT IS OWED, composed by `deliverableGaps` and the stale-copy reader and read here by meaning: it names missing evidence, not bad words. */ const SUPPORT_OWED = /source support is still owed/i;
/** How many sections a new page still owes, off the one gap only `deliverableGaps` can compute. */
const owedSections = (gaps: readonly string[]): number => {
  const said = gaps.find((g) => g.includes("sections have no copy written")); return said ? Number(/^(\d+)/.exec(said)?.[1] ?? 0) : 0; };

/** Private banks resume review or missing pieces; finished work uses the common acceptance ladder. */
export function nextObligation(p: ChangeProposal): Obligation | null {
  if (p.status === "implemented_pending_verification") return null;
  if (p.obligation?.kind === "terminal" && p.obligation.holdCode === "settled_invalid_output" && p.workKey && p.obligation.materialKey === COPY_RULES.invalidMaterial(p, p.workKey, p.obligation.sourceMaterialHash)) return p.obligation;
  const attempt = (p.previousCopy?.attempts ?? 0) + 1, redraft = (instruction: string): Obligation => attempt > MAX_ATTEMPTS ? { kind: "terminal", reason: SETTLED_AFTER_RETRIES } : { kind: "redraft", attempt, instruction }, refused = p.previousCopy && (p.faults ?? []).includes(p.previousCopy.retiredBecause) ? p.previousCopy.retiredBecause : null;
  if ((p.faults ?? []).some((w) => /category, tag or media index page/.test(w)) && (p.primaryQuery ?? "").trim()) return { kind: "evidence", need: { kind: "serp", query: p.primaryQuery!.trim(), reasonCode: "no_winner_to_read" } }; // never a paid redraft on navigation copied from a rival: the winners are read again, and the index page is no longer among them (reviewer, 2026-09-15)
  if (p.kind === "new_page" && p.obligation?.kind === "terminal" && p.obligation.holdCode === "bank_reconciliation") return p.obligation; if (p.kind === "new_page" && p.newPageDraft && (!COPY_RULES.newPagePieces(p.newPageDraft) || !COPY_RULES.newPageSourceBound(p.newPageDraft))) return { kind: "terminal", reason: "The banked new page has no source-bound plan; preserve its copy and reconcile ownership before any paid work.", holdCode: "bank_reconciliation" }; const rewrite = COPY_RULES.pieceDebt(p); if (rewrite === null) return { kind: "terminal", reason: "The banked rewrite has an invalid record; preserve its copy and reconstruct the plan before any further paid work." }; if (p.newPageDraft?.brief.kind === "body_meta" && p.obligation?.kind === "terminal" && p.obligation.holdCode !== "settled_invalid_output") return p.obligation; if (rewrite !== undefined && p.newPageDraft?.pieces.some(piece => !COPY_RULES.accepted(piece.editor))) return { kind: "review" }; if (p.newPageDraft?.brief.kind === "body_meta" && refused && rewrite) return redraft(refused); if (rewrite) return { kind: "sections", owed: rewrite }; const hold = openHold(p), owedReview = unreviewed(p);
  // Missing current evidence is a prerequisite, not rejected copy; genuine word/invalid-output settlements still stand.
  const sourceNeed = p.obligation?.kind === "evidence" ? p.obligation.need : null;
  if (sourceNeed?.kind === "page_source" && sourceNeed.reasonCode === "acquire_page_source" && sourceNeed.proposalId === p.id && !hold.safetyHold
    && COPY_RULES.captureUrls(p).some(url => COPY_RULES.captureAddress(url) != null && COPY_RULES.captureAddress(url) === COPY_RULES.captureAddress(sourceNeed.url) && COPY_RULES.captureAddress(p.pageUrl) != null && new URL(COPY_RULES.captureAddress(url)!).origin === new URL(COPY_RULES.captureAddress(p.pageUrl)!).origin)
    && hold.defects.some(captureFinding)
    && (attempt <= MAX_ATTEMPTS || hold.defects.every(inputDebt))) return { kind: "evidence", need: sourceNeed };
  const settlement = p.obligation?.kind === "terminal" && p.obligation.holdCode !== "settled_invalid_output" && (NO_GAP_NAMED.test(p.obligation.reason) || hold.defects.some((why) => !inputDebt(why))) ? p.obligation : null, /* a settlement whose only remaining defect is a reading owed is dropped and the reading filed (restored, audit 2026-09-14) */ /* the walk's own "no gap named" settlement is a statement about research, not about these words: it keeps carrying the reading the row owes */ owedRead = p.obligation?.kind === "evidence" && p.obligation.need.reasonCode === "no_winner_to_read" ? p.obligation : null, onFile = p.winnersOnFile ?? null, asked = (p.primaryQuery ?? "").trim();
  if (settlement || owedRead) return (settlement == null || NO_GAP_NAMED.test(settlement.reason)) && onFile != null && onFile !== "read" && asked !== ""
    ? { kind: "evidence", need: { kind: onFile === "unread" ? "competitor_page" : "serp", query: asked, reasonCode: "no_winner_to_read" } }
    : settlement ?? (onFile === "read" ? nextObligation({ ...p, obligation: undefined }) : owedRead!); // A current reading debt still advances; unchanged failed copy never becomes paid work through elapsed time.
  if (hold.safetyHold) return { kind: "operator", decision: "safety_confirmation" };
  if (p.obligation?.kind === "evidence" && (p.researchOnly === true || p.obligation.need.reasonCode === "source_support_unconfirmed" || p.obligation.need.reasonCode === "causal_answer_source_unconfirmed" || (p.recommendedChange.kind === "existing_edit" && p.recommendedChange.field === "schema" && p.obligation.need.reasonCode === "schema_visible_pair_unconfirmed"))) return p.obligation;
  const gaps = deliverableGaps(p), unwritten = gaps.some((g) => UNWRITTEN.test(g)), owed = owedSections(gaps);
  // A ROW BANKED BEFORE THE COUNT EXISTED IS ON ATTEMPT ONE, never on its cap: absent is zero attempts consumed, so the two-attempt settlement can only ever bite on drafts this contract actually counted. AND A DRAFT NOBODY EVER WROTE IS NOT A DRAFT THAT WAS REFUSED TWICE (live 12:00Z, 2026-09-05): the walk spent two provider calls on the account's largest card, both drafts were refused, and the row went on owing a first draft with no fault, no words and no count, so nothing on it could ever settle and the same money was owed again every pass. A row still carrying no copy owes another draft while it has attempts left, and settles on the same two-attempt rule finished copy answers to once it has spent them. The receipt read here is the pass's own and typed: the words it retired, and the refusing sentence standing on the row as a fault. A retirement whose reason is NOT one of the row's faults is an identity move or a stale-rules re-read, which owe a first draft exactly as before.
  if (p.recommendedChange.kind === "new_page") {
    if (p.status === "needs_review" && p.researchOnly === true && !p.newPageDraft && !p.bundle && [p.recommendedChange.proposedTitle, p.recommendedChange.metaDescription, p.recommendedChange.openingAnswer].every(t => t === "")) return p.obligation?.kind === "evidence" ? p.obligation : { kind: "draft" };
    if (unwritten || owed > 0) return { kind: "sections", owed: Math.max(owed, 1) };
    const repair = p.newPageDraft?.repair;
    if (repair?.of === copyKey(p)) return repair.resolution === "no_valid_treatment" ? { kind: "terminal", reason: repair.targets[0]?.instruction ?? p.faults?.[0] ?? "The page has no defensible treatment on its current evidence." } : repair.resolution === "acquire_factual_source" ? { kind: "evidence", need: { kind: "factual_source", query: p.primaryQuery, topic: { key: `topic:${p.id.split("::")[1] ?? ""}`, label: p.primaryQuery }, missingTopic: repair.targets[0]?.instruction ?? p.primaryQuery, reasonCode: "new_page_review_source_owed", delivery: "new_page" } } : /^(structural_synthesis|use_stored_verified_evidence)$/.test(repair.resolution) && repair.targets.length > 0 ? redraft(repair.targets.map((t) => t.instruction).join("; ")) : { kind: "review" };
  } else if ((p.researchOnly === true && rewrite === undefined) || unwritten) return refused ? redraft(refused) : { kind: "draft" }; // An incomplete rewrite resumes its bank; a complete held rewrite owes acceptance, not wholesale redrafting.
  // The current hold partitions word defects, missing claim records, external evidence and review debt.
  const markup = p.recommendedChange.kind === "existing_edit" && p.recommendedChange.field === "schema";
  const records = !markup && (p.claims ?? []).length === 0 && gaps.length === 0
    && [...(p.faults ?? []), ...p.limitations].some((f) => NO_RECORD.test(f)); // the STORE's own finding that this row's record was lost, never a fresh guess: a row that never carried claims is not a row that lost them
  const ownRecord = [p.copyStamp ?? "", p.recommendedChange.kind === "existing_edit" ? p.recommendedChange.before ?? "" : "", ...(p.supportFacts ?? []).filter((x) => /^page-/.test(x.id)).map((x) => x.fact)].join(" ").toLowerCase(); // the row's OWN record of the page, typed: what the page said when it was last read, the line this change replaces, and the passages the row banked as the page's // AND AN OBJECTION THE OWNER JUDGES FOR THEMSELVES IS NOT A DEBT AT ALL (owner's editorial policy, 2026-09-06): the one readiness verdict partitions this row's own faults, so a sentence it files as an advisory buys no corrective draft and can never spend an attempt or settle a row; only a defect Beacon owes reaches the rungs below.
  const supportOwed = hold.defects.some((f) => SUPPORT_OWED.test(f)), faults = (p.faults ?? []).filter((f) => hold.defects.includes(f) && !COPY_RULES.externalAuthorityFinding(f) && !inputDebt(f) && f !== owedReview && !(owedReview != null && (f.endsWith(`: ${owedReview}`) || COPY_RULES.supersededEditorFinding(f))) /* raw or composed by the sweep, a review-hold sentence is a reading, never a paid rewrite, whatever sentence the live verdict composes today (audit, 2026-09-14): a stale composed fault survived while owedReview was null or a different sentence and minted a paid redraft */
    && (!markup || /^this structured data/i.test(f)) && !NO_RECORD.test(f) && !SUPPORT_OWED.test(f) && !(supportOwed && /cites a source that is not attached to it/.test(f)) /* the unattached-source sentence composed beside an unobserved quotation is that same missing reading, not a second fault */
    && !((w) => w != null && ownRecord.includes(w.toLowerCase()))(PROMISED.exec(f)?.[1])); // the record sentence is never a statement about the words: it is answered by the reading below while the record is missing, and by the record itself once that reading has rebuilt it
  const copyFault = faults.find(f => !COPY_RULES.preservationFinding(f)); if (copyFault) return redraft(copyFault);
  if (supportOwed) return { kind: "evidence", need: { kind: "page_source", query: p.primaryQuery, url: p.pageUrl ?? p.pagePath ?? "", proposalId: p.id, reasonCode: "source_support_unconfirmed" } }; /* SUPPORT STILL OWED IS A READING TO TAKE, NEVER A REDRAFT (production, 2026-09-15): three Ready link rows whose page quotations the new heading-scoped read no longer matched were sent to a paid rewrite of words no gate faulted; the words stand, the page is read again, and the review re-qualifies the quotation */
  const unsupportedMetric = p.researchOnly === true ? null : COPY_RULES.newMetaQuantityGap(p); if (unsupportedMetric) return redraft(unsupportedMetric); // A stale semantic review cannot repair the source gap that blocks release.
  const external = p.researchOnly === true ? null : COPY_RULES.newExternalAuthorityGap(p); if (external && p.recommendedChange.kind === "existing_edit") { const pieces = (p.bundle?.components ?? []).filter(part => part.after.toLowerCase().includes(external.phrase.toLowerCase())), root = pieces.length === 1 && fieldForComponent(pieces[0]!.kind) === p.recommendedChange.field && pieces[0]!.after === p.recommendedChange.after && (!pieces[0]!.page || pieces[0]!.page === p.pagePath || !!p.pageUrl && canonicalUrlKey(pieces[0]!.page) === canonicalUrlKey(p.pageUrl)); if (pieces.length > 1 || pieces.length === 1 && !root || !(p.claims ?? []).some(c => c.text.toLowerCase().includes(external.phrase.toLowerCase()))) return redraft(`${external.reason}; revise the unsupported wording or bind the exact source to its publication component`); return { kind: "evidence", need: { kind: "factual_source", query: p.primaryQuery, url: p.pageUrl ?? p.pagePath ?? "", proposalId: p.id, missingTopic: external.proposition, reasonCode: "external_claim_unconfirmed", delivery: "existing_page_edit" } }; }
  if (faults.length > 0) return redraft(faults[0]!);
  if (owedReview != null || records || hold.defects.some(inputDebt)) return { kind: "review" }; // a reading outranks a blocker nobody faulted: a row held for a look owes the look, never a paid rewrite (restored, audit 2026-09-14); a stale review-hold sentence still holding the row is cleared by the reading it names
  // AND FINAL COPY MAY NOT SIT BEHIND A BLOCKER NOBODY OWNS (falsifier, 2026-09-02). A section held on "nothing on file says what a reader gains from it" owed nothing typed, so the $0 replay skipped it for ever while the one servability verdict went on refusing it. Whatever still blocks these exact words is the instruction the next draft writes against; the safety confirmation is the operator's and already returned above.
  return hold.blocking ? redraft(hold.blocking) : null;
}
