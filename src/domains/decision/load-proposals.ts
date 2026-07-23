/**
 * decision/load-proposals (CORE 100K cutover, 2026-07-22) — the ONE read path
 * the live surfaces (Changes + Today) consume. It loads the persisted, re-
 * validated ChangeProposals for a tenant, ranks them by honest value, and
 * partitions them into the operator-facing lifecycle:
 *
 *   ready     — status "proposed": validated safe, exact copy prepared, act now.
 *   toDo      — status "needs_review": generated but wants a human look first.
 *   (rejected proposals are never surfaced; applied ones have moved to measuring.)
 *
 * The "measuring / decided" side of the lifecycle lives in the proof-gsc ledger
 * (a shipped change under measurement), NOT here — a proposal the operator
 * applied is recorded as a shipped change and measured there. This module owns
 * only the pre-ship queue. PURE partition over a fail-soft load.
 *
 * server-only (reads the proposal store).
 */

import "server-only";

import { loadChangeProposals } from "./proposal-store";
import { rankProposals } from "./rank-proposals";
import type { ChangeProposal } from "./contracts";

export type RankedProposalQueue = {
  /** Every non-rejected, non-applied proposal, ranked most-valuable first. */
  ranked: ChangeProposal[];
  /** Validated-safe, exact-copy-ready proposals (status "proposed"). */
  ready: ChangeProposal[];
  /** Generated but held for a human look (status "needs_review"). */
  toDo: ChangeProposal[];
  /** New-page briefs among the ready+to-do set (kept distinct from edits). */
  newPageBriefs: ChangeProposal[];
};

/** Load + rank + partition a tenant's proposal queue. Fail-soft → empty queue. */
export async function loadProposalQueue(tenantId: string): Promise<RankedProposalQueue> {
  const byId = await loadChangeProposals(tenantId).catch(() => new Map<string, ChangeProposal>());
  const all = [...byId.values()].filter((p) => p.status !== "rejected" && p.status !== "applied");
  const ranked = rankProposals(all);
  return {
    ranked,
    ready: ranked.filter((p) => p.status === "proposed"),
    toDo: ranked.filter((p) => p.status === "needs_review"),
    newPageBriefs: ranked.filter((p) => p.kind === "new_page"),
  };
}
