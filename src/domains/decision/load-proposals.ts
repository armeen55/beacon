/**
 * decision/load-proposals (CORE 100K cutover, 2026-07-22): the ONE read path
 * the live surfaces (Changes + Today) consume. It loads the persisted, re-
 * validated ChangeProposals for a tenant, ranks them by honest value, and
 * partitions them into the operator-facing lifecycle:
 *
 *   ready     validated safe, owes no source: act now.
 *   toDo      still live under the same basis: held for review or waiting on a source.
 *   (rejected proposals are never surfaced; applied ones have moved to measuring.)
 *
 * Every lane above holds CURRENT-BASIS work only. A proposal drafted under an
 * older basis, one carrying no basis, and every proposal at all when the current
 * basis cannot be read are withheld from the queue and counted, never shown as
 * work to do.
 *
 * The "measuring / decided" side of the lifecycle lives in the proof-gsc ledger
 * (a shipped change under measurement), NOT here: a proposal the operator
 * applied is recorded as a shipped change and measured there. This module owns
 * only the pre-ship queue. PURE partition over a fail-soft load.
 *
 * server-only (reads the proposal store).
 */

import "server-only";

import { basisTag, getTenant, loadBusinessProfile, type BusinessProfile } from "@/domains/account";
import { loadChangeProposals } from "./proposal-store";
import { rankProposals } from "./rank-proposals";
import { validateProposal } from "./validate-proposal";
import type { ChangeProposal } from "./contracts";

/**
 * The DECISION generation this kernel proposes under. It rides on the basis
 * stamp, so every proposal manufactured under an earlier generation's rules is
 * unsupported history the moment those rules change: it can never render Ready,
 * it is demoted in presentation only, and no row is rewritten or deleted.
 * Bump ONLY when the rules that decide WHAT earns a proposal change.
 *   1 = every owned page over 20 impressions got a title and a description.
 *   2 = a proposal exists only where exact query rows proved a recoverable gap.
 *   3 = a proven gap is an INVESTIGATION until the live results page for that exact
 *       search is held; confidence follows evidence completeness, not the draft.
 *   4 = holding that results page is not reading it. A change exists only where the
 *       page was DIAGNOSED off what those results actually say, so every proposal
 *       picked by whether the search words appeared in the stored title is history.
 *   5 = no new page is proposed at all. Turning a competitor's example prompt into a
 *       page shipped duplicates of pages the account already owned, so generation is
 *       deleted until the evidence can prove a distinct page should exist.
 *   6 = a new page is proposed again, and ONLY where the page by page comparison proved
 *       the winning pages share searches no page of this account reaches. Every page
 *       brief drafted under any earlier rule is history.
 */
const DECISION_GENERATION = 6;

/**
 * The account's CURRENT research basis, or null when it cannot be read. Composes
 * exactly what Runtime and the Evidence funnel compose, so one basis serves every
 * kernel, plus the decision generation above. Null on purpose when the account
 * cannot be read: I cannot prove a single stored proposal is current, and the
 * queue below treats that as nothing to show rather than everything to show.
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
    return `${basisTag(account.id, domain, p, account.growth_goal ?? null)}::d${DECISION_GENERATION}`;
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
  /** Every live CURRENT-BASIS proposal, ranked most-valuable first. */
  ranked: ChangeProposal[];
  /** Validated-safe, exact-copy-ready proposals (status "proposed"). */
  ready: ChangeProposal[];
  /** Generated but held for a human look (status "needs_review"). */
  toDo: ChangeProposal[];
  /** How many live rows I set aside instead of queueing, because I cannot show
   *  they were drafted under the basis I hold now (surfaces say this out loud). */
  demotedStaleBasis: number;
  /** TRUE when the account's current basis could not be read at all. The queue is
   *  empty because I cannot tell what is current, NOT because I raised the bar. */
  basisUnreadable: boolean;
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
  // Your queue is CURRENT WORK ONLY. A proposal enters it only when I can show it was
  // drafted under the basis this account holds right now. An older basis, no basis at
  // all, and a current basis I could not read all SET THE ROW ASIDE. Unreadable fails
  // closed: being unable to read the basis is not proof anything is current, it is
  // proof I cannot tell, so I show you nothing rather than guess. A set-aside row keeps
  // its words, its status and its history: no stored row is rewritten or deleted, it
  // just stops presenting as work waiting on you, and it is counted below so I can say so.
  // A NEW PAGE PASSES THE SAME BAR TWICE. Under generation 6 a page brief may be work
  // again, but only one built to today's evidence contract: the earned verdict it came
  // from, an outline, and every piece tracing to a receipt item. A brief carrying none of
  // that is an older idea however current its basis looks, and reviving the ones that
  // turned a rival's example question into an article is the worst thing this queue could
  // do, so it is refused here and still COUNTED below.
  const current = currentBasis == null ? []
    : all.filter((p) => p.basis === currentBasis && (p.kind !== "new_page" || validateProposal(p).verdict !== "rejected"));
  const demotedStaleBasis = all.length - current.length;
  // WHY the queue is empty decides what I may say. "I raised the bar" is true of an
  // older or missing basis and a lie when I simply could not read the account, so the
  // surfaces get the reason, not just the number.
  const basisUnreadable = currentBasis == null;
  // A page whose change the operator already applied is a page under measurement. Ranking
  // a second change onto it would make the first one unreadable, so the ranker discounts
  // it hard and says so on the card. The applied rows are already in hand here, so this
  // costs no read and reaches past no kernel boundary.
  const measuringPagePaths = [...byId.values()].filter((p) => p.status === "applied").map((p) => p.pagePath);
  const ranked = rankProposals(current, { measuringPagePaths });
  // READY has to mean ready: the validator passed it (status "proposed") and it owes
  // nobody a source. Every other current-basis row is a to-do.
  const ready: ChangeProposal[] = [];
  const toDo: ChangeProposal[] = [];
  for (const p of ranked) {
    if (p.status === "proposed" && !holdsForUnresolvedSource(p)) ready.push(p);
    else toDo.push(p);
  }
  return {
    ranked,
    ready,
    toDo,
    demotedStaleBasis,
    basisUnreadable,
  };
}
