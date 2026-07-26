/**
 * decision/load-proposals (CORE 100K cutover, 2026-07-22) — the ONE read path
 * the live surfaces (Changes + Today) consume. It loads the persisted, re-
 * validated ChangeProposals for a tenant, ranks them by honest value, and
 * partitions them into the operator-facing lifecycle:
 *
 *   ready     validated safe, current basis, owes no source: act now.
 *   toDo      everything else still live: held for review, generated under an
 *             older basis, or still waiting on a source.
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

import { basisTag, getTenant, loadBusinessProfile, type BusinessProfile } from "@/domains/account";
import { loadChangeProposals } from "./proposal-store";
import { rankProposals } from "./rank-proposals";
import type { ChangeProposal } from "./contracts";

/**
 * The account's CURRENT research basis, or null when it cannot be read. Composes
 * exactly what Runtime and the Evidence funnel compose, so one basis serves every
 * kernel. Fail-soft to null on purpose: an unreadable account must never demote a
 * whole queue, it just means we cannot prove anything is stale this pass.
 */
export async function resolveCurrentBasis(
  tenantId: string,
  profile?: BusinessProfile | null,
): Promise<string | null> {
  try {
    const account = await getTenant(tenantId);
    const domain = account?.domain?.trim();
    if (!account || !domain) return null;
    const p = profile ?? (await loadBusinessProfile(tenantId));
    return basisTag(account.id, domain, p, account.growth_goal ?? null);
  } catch {
    return null;
  }
}

/**
 * A limitation that still ASKS for a source or a fact check is an UNRESOLVED
 * requirement: whatever the stored status says, the copy is not paste-ready, so
 * it presents as to-do instead of ready. Deliberately narrow (the phrasings the
 * quality gate and the validator actually emit) so an honest "what I could not
 * check yet" receipt line never demotes a finished change.
 */
const UNRESOLVED_SOURCE =
  /paste-ready|cited authoritative source|carries no source|add (?:a |an |one |1-2 )?(?:cited |authoritative )?sources?|verify (?:this|the) (?:claim|fact)/i;

/** PURE: does this proposal still owe a source before anyone can paste it? */
export function holdsForUnresolvedSource(p: ChangeProposal): boolean {
  return p.limitations.some((l) => UNRESOLVED_SOURCE.test(l));
}

export type RankedProposalQueue = {
  /** Every non-rejected, non-applied proposal, ranked most-valuable first. */
  ranked: ChangeProposal[];
  /** Validated-safe, exact-copy-ready proposals (status "proposed"). */
  ready: ChangeProposal[];
  /** Generated but held for a human look (status "needs_review"). */
  toDo: ChangeProposal[];
  /** How many validator-passed rows sit in toDo ONLY because your business info
   *  changed since they were drafted (surfaces explain this honestly). */
  demotedStaleBasis: number;
  /** New-page briefs among the ready+to-do set (kept distinct from edits). */
  newPageBriefs: ChangeProposal[];
};

/** Load + rank + partition a tenant's proposal queue. Fail-soft → empty queue.
 *  `deps.currentBasis` is injectable for tests; production resolves the account's
 *  live basis. */
export async function loadProposalQueue(
  tenantId: string,
  deps: { currentBasis?: string | null } = {},
): Promise<RankedProposalQueue> {
  const currentBasis =
    deps.currentBasis !== undefined ? deps.currentBasis : await resolveCurrentBasis(tenantId);
  const byId = await loadChangeProposals(tenantId).catch(() => new Map<string, ChangeProposal>());
  const live = [...byId.values()].filter((p) => p.status !== "rejected" && p.status !== "applied");
  // A bundle REPLACES its own shallow rows, historical included: an existing-page
  // bundle covers that PAGE, a new-page bundle covers that TOPIC.
  const bundledPages = new Set(live.filter((p) => p.bundle && p.kind === "existing_edit").map((p) => p.pagePath));
  const topicOf = (p: ChangeProposal): string => p.primaryQuery.trim().toLowerCase();
  const bundledTopics = new Set(live.filter((p) => p.bundle && p.kind === "new_page").map(topicOf));
  const all = live.filter((p) => p.bundle
    || (p.kind === "existing_edit" ? !bundledPages.has(p.pagePath) : !bundledTopics.has(topicOf(p))));
  const ranked = rankProposals(all);
  // READY has to mean ready. A proposal earns it only when the validator passed it
  // (status "proposed"), it was generated under the account's CURRENT basis, and it
  // owes nobody a source. Everything else is DEMOTED IN PRESENTATION to to-do: the
  // stored row is never rewritten and never deleted, it just stops claiming to be
  // finished work. A basis we could not read demotes nothing (currentBasis null).
  const isCurrent = (p: ChangeProposal) => currentBasis == null || p.basis === currentBasis;
  const ready: ChangeProposal[] = [];
  const toDo: ChangeProposal[] = [];
  let demotedStaleBasis = 0;
  for (const p of ranked) {
    if (p.status === "proposed" && isCurrent(p) && !holdsForUnresolvedSource(p)) ready.push(p);
    else {
      if (p.status === "proposed" && !isCurrent(p)) demotedStaleBasis += 1;
      toDo.push(p);
    }
  }
  return {
    ranked,
    ready,
    toDo,
    demotedStaleBasis,
    // The new-page slice of the SAME partitioned rows (both lanes, edits excluded).
    // Readiness is never read from here: a stale-basis or source-owing brief sits in
    // toDo above, which is the only place readiness is decided.
    newPageBriefs: ranked.filter((p) => p.kind === "new_page"),
  };
}
