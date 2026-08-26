/**
 * Decision kernel, public facade.
 *
 * The Decision kernel turns an EvidenceSnapshot into ranked, validated, persisted ChangeProposals. This index is the ONLY surface `src/app` and the
 * other kernels may import. Internal files (propose, rank-proposals, validate-proposal, opportunities, and the internalized safety/drafting helpers under ./internal) are private to the kernel.
 */

// Contracts (types + (de)serialization + identity helpers)
export type {
  EvidenceInput,
  ProposalKind,
  ProposalStatus,
  ProposalRisk,
  ProposalConfidence,
  RecommendedChange,
  ProposalEvidence,
  ChangeProposal,
  ChangeBundle,
  BundleComponent,
  BundleComponentKind,
  BundleEvidenceItem,
} from "./contracts";
export {
  ChangeProposalSchema,
  serializeChangeProposal,
  deserializeChangeProposal,
  proposalFamily,
  proposalId,
  effortForFamily,
  DANGEROUS_COMPONENT_KINDS,
  dangerousComponents,
  componentIdOf,
  sameComponentId,
} from "./contracts";

// Ranked queue load (surface data)
export type { RankedProposalQueue } from "./load-proposals";
export { loadProposalQueue } from "./load-proposals";

// Proposal persistence. THERE IS NO BARE STATUS FLIP ON THIS FACADE: `transitionProposalToImplemented` demands
// the id of the Shipment already measuring the change, so "done" can only ever be reached through the
// orchestrated mark-implemented transaction, and `reconcileImplementedWithoutShipment` reverts any row that
// somehow reads done with no record behind it.
export {
  saveChangeProposal,
  answerReviewedProposal,
  loadChangeProposal,
  loadChangeProposals,
  transitionProposalToImplemented,
  dismissChangeProposal,
  queueLaneCounts,
  readQueuePage,
  publishCustomerRelease,
} from "./proposal-store";
export { reconcileImplementedWithoutShipment } from "./implemented-repair";

// Cold drafting entry point (produce ranked proposals for a tenant)
export type {
  ProduceProposalsOptions,
  ProduceProposalsResult,
  ProducerOutcome,
} from "./produce-proposals";
export { produceProposalsForTenant, DEFAULT_MAX_DRAFTS } from "./produce-proposals";
/** THE ONE PURE RESOLVER for where a search the assistants ran ends up. Decision persists its outcome and
 *  Visibility renders the same one, so the queue and the screen can never disagree about a search. */
export { resolveFanoutCase } from "./producers/ai-cases";
/** THE FILED VERDICT on every search the assistants ran, one row per case identity. Decision is the only
 *  writer; Visibility and Changes read it rather than each deriving their own answer from partial evidence. */
export { dispositionOf, readAiCaseDispositions, type AiCaseDisposition, type AiCaseFile, type AiCaseState } from "./ai-case-store";
export { receiptComposition } from "./contracts";
// What the research is stuck on, from the ONE canonical coverage pass, so Runtime buys only what an open investigation cannot close without and acts on the SAME topic it paid for.
export { researchNeeds, type ResearchNeed } from "./coverage-pass";
// Does this account already have the right page? The deterministic candidates the adjudicator reasons over.
export { ownedCandidatesFor, topicOutOfScope } from "./owned-coverage";
export type { OwnedCandidate, OwnedSignal, OwnedSignalKind, OwnedSignalStrength } from "./owned-coverage";
// The honest diagnosis itself, so Runtime can ask what an open investigation needs without reaching past this boundary into the kernel's files.
export { compileCandidates, type QualifiedCandidate } from "./opportunities";
// The one operator-facing phrase for a diagnosed cause, so no surface ever prints a raw slug.
export { causeLabel, type CauseFinding } from "./diagnosis";
// The account's CURRENT evidence basis. Surfaces need it to refuse serving a stored release that was built under an older bar; they may not deep-import the kernel.
export { resolveCurrentBasis } from "./load-proposals";

// Proposing + ranking + validation entry points
export type { ProposalOutcome, ProposeOptions } from "./propose";
export { proposeExistingPageChange } from "./propose";
export { rankProposals, proposalValueScore } from "./rank-proposals";
// THE ONE COMPLETENESS BOUNDARY every surface asks: has Beacon finished this deliverable, or is it still an
// opportunity being developed? Empty means it is a Change; anything else keeps it out of the queue, out of
// Today, out of measurement, and out of Mark done.
// THE EXACT VERSION AN OPERATOR CONFIRMS. A change that moves or hides a page reaches `ready` on one yes to one version; the detail page prints the version it is showing and the mutation recomputes it off the row it re-reads.
export { deliverableGaps, confirmedVersion, openHold } from "./completeness";
// THE ONE PERMISSION QUESTION a surface may ask about a stored change: does its lever settle the cause its own evidence named. The queue holds a change that does not; the detail page and the mutation keep that promise.
export { unsettledCause } from "./authorization";
export type { ProposalVerdict, ProposalValidation, ValidateProposalOptions } from "./validate-proposal";
export { validateProposal, actionableProposalFailures } from "./validate-proposal";

// --- App/component surface re-exports (curated) ---

// Recommendation-intelligence surfaces
export { loadDailyTotalsForTenant } from "./recommendation-intelligence/gsc-page-queries";
export {
  loadPageSurgeonContext,
  topPagesByDemand,
} from "./recommendation-intelligence/page-surgeon/assemble-packet";

// Changes: lifecycle counts
export {
  countLedgerLifecycle,
  ledgerProofLine,
  splitLedgerLifecycle,
} from "./changes/lifecycle-counts";

// Changes: recommended-edits persistence
export {
  editLifecycleStatus,
  markRecommendedEditsAsShipped,
} from "./changes/recommended-edits-persistence";

// Changes: action-types
export {
  isIndexingDirectiveActionType,
  INDEXING_DIRECTIVE_CAVEAT,
  changeSentence,
  type ActionType,
} from "./changes/action-types";
