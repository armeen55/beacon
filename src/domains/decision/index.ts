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
  loadChangeProposal,
  loadChangeProposals,
  transitionProposalToImplemented,
  dismissChangeProposal,
  readQueuePage,
  stampQueueRanking,
} from "./proposal-store";
export { reconcileImplementedWithoutShipment } from "./implemented-repair";

// Cold drafting entry point (produce ranked proposals for a tenant)
export type {
  ProduceProposalsOptions,
  ProduceProposalsResult,
  ProducerOutcome,
} from "./produce-proposals";
export { produceProposalsForTenant, DEFAULT_MAX_DRAFTS } from "./produce-proposals";
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
export { deliverableGaps } from "./completeness";
export type { ProposalVerdict, ProposalValidation, ValidateProposalOptions } from "./validate-proposal";
export { validateProposal, actionableProposalFailures } from "./validate-proposal";

// --- App/component surface re-exports (curated) ---

// Recommendation-intelligence surfaces
export { loadDailyTotalsForTenant } from "./recommendation-intelligence/gsc-page-queries";
export { loadOwnCitationsByDay } from "./recommendation-intelligence/citations-daily";
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

// Changes: proof-timeline surfaces
export { resolveProofPill, kernelProofSummary, type ProofPill } from "./changes/proof-timeline/result-pill";
export { computeProofCounters, type ProofCounters } from "./changes/proof-timeline/counters";
export { buildWaitingRail, type WaitingRailInput } from "./changes/proof-timeline/waiting-rail";
export { projectChangeTitle, clampShortTitle } from "./changes/proof-timeline/title-projection";

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
