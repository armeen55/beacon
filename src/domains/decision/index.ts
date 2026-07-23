/**
 * Decision kernel — public facade.
 *
 * The Decision kernel turns an EvidenceSnapshot into ranked, validated,
 * persisted ChangeProposals. This index is the ONLY surface `src/app` and the
 * other kernels may import. Internal files (propose, rank-proposals,
 * validate-proposal, opportunities, and the internalized safety/drafting
 * helpers under ./internal) are private to the kernel.
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
} from "./contracts";
export {
  ChangeProposalSchema,
  serializeChangeProposal,
  deserializeChangeProposal,
  proposalFamily,
  proposalId,
  effortForFamily,
} from "./contracts";

// Ranked queue load (surface data)
export type { RankedProposalQueue } from "./load-proposals";
export { loadProposalQueue } from "./load-proposals";

// Proposal persistence
export {
  saveChangeProposal,
  loadChangeProposal,
  loadChangeProposals,
  markProposalApplied,
} from "./proposal-store";

// Cold drafting entry point (produce ranked proposals for a tenant)
export type {
  ProduceProposalsOptions,
  ProduceProposalsResult,
} from "./produce-proposals";
export { produceProposalsForTenant, DEFAULT_MAX_DRAFTS } from "./produce-proposals";

// Proposing + ranking + validation entry points
export type { ProposalOutcome, ProposeOptions } from "./propose";
export { proposeChange, proposeExistingPageChange, proposeNewPageChange } from "./propose";
export { rankProposals, proposalValueScore } from "./rank-proposals";
export type { ProposalVerdict, ProposalValidation, ValidateProposalOptions } from "./validate-proposal";
export { validateProposal } from "./validate-proposal";
