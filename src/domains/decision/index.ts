/**
 * decision (CORE 100K decision kernel) — the ONE recommendation path.
 *
 * EvidenceInput → (propose) → ChangeProposal → (validate) → (rank) → (persist).
 * Publishing is MANUAL: the kernel proposes; it never writes a live page.
 */

export * from "./contracts";
export * from "./validate-proposal";
export * from "./rank-proposals";
// propose.ts + proposal-store.ts are server-only; import them directly where
// a server context is guaranteed (they are intentionally NOT re-exported here
// so this barrel stays importable from pure/isomorphic code).
