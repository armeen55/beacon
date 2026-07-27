/**
 * decision/produce-proposals (decision truth replacement, 2026-07-27): the ONE
 * server path that turns a tenant's cached evidence into persisted
 * ChangeProposals:
 *
 *   loadEvidenceSnapshot (six cached sources, $0)
 *     → compileCandidates (the honest diagnosis: act / watch / do nothing)
 *       → candidatesToEvidenceInputs (only what EARNED an action)
 *         → proposeChange (cold, gated, budgeted drafter + the ONE validator)
 *           → saveChangeProposal (durable, fail-soft)
 *
 * BOUNDED. The pass drafts at most the strongest MAX_EXISTING_DRAFTS pages and
 * MAX_NEW_PAGE_DRAFTS topics, ranked by recoverable clicks. The old serial walk
 * over up to 55 manufactured opportunities is gone: a page with no proven gap
 * costs nothing here.
 *
 * ZERO IS A REAL ANSWER. When no candidate earned an action the pass SUCCEEDS
 * with no proposals and says so (`noActionableCandidate`), so a caller can tell
 * "I checked and there is nothing worth your morning" apart from "the pass
 * failed". A bundle is kept only for a page or topic a candidate proved.
 *
 * COLD by default: the drafter's `complete` fn is injectable, so tests run this
 * whole path with zero paid calls. Publishing stays MANUAL: this only proposes.
 *
 * server-only.
 */

import "server-only";

import { log } from "@/lib/logger";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import { loadBusinessProfile } from "@/domains/account";
import { resolveCurrentBasis } from "./load-proposals";
import { candidatesToEvidenceInputs, compileCandidates } from "./opportunities";
import { produceBundleForSnapshot, produceNewPageBundleForSnapshot } from "./produce-bundle";
import { proposeChange, type ProposeOptions } from "./propose";
import { saveChangeProposal } from "./proposal-store";
import { rankProposals } from "./rank-proposals";
import type { ChangeProposal, DecisionCandidate } from "./contracts";

export type ProduceProposalsOptions = ProposeOptions & {
  /** Hard cap on how many opportunities we draft this pass (budget guard). */
  maxDrafts?: number;
  /** Persist each landed proposal (default true). Tests pass false to stay pure. */
  persist?: boolean;
};

export type ProduceProposalsResult = {
  /** The ranked proposals this pass produced (may be empty and still a success). */
  proposals: ChangeProposal[];
  /** Every page and topic the diagnosis judged, act or not: the run receipt. */
  candidates: DecisionCandidate[];
  /** TRUE when the evidence proved there is nothing worth doing. Not a failure. */
  noActionableCandidate: boolean;
  /** How many candidates earned an action (act_existing_page + act_new_page). */
  actionable: number;
  /** How many drafts failed closed (off / budget / validation). */
  noDraft: number;
};

/** Bounded drafting: the strongest few, never a queue. */
export const MAX_EXISTING_DRAFTS = 3;
export const MAX_NEW_PAGE_DRAFTS = 2;
export const DEFAULT_MAX_DRAFTS = MAX_EXISTING_DRAFTS + MAX_NEW_PAGE_DRAFTS;

/** Normalized keys a candidate and a proposal can be matched on. */
const pageKeys = (c: DecisionCandidate): string[] => {
  const url = (c.pageUrl ?? "").trim().toLowerCase();
  if (!url) return [];
  try {
    return [url, new URL(url.startsWith("http") ? url : `https://${url}`).pathname || "/"];
  } catch {
    return [url];
  }
};

/**
 * Produce (and by default persist) ranked ChangeProposals for one tenant from
 * cached evidence only. Never throws on a single-source outage: a failed source
 * simply narrows the snapshot.
 */
export async function produceProposalsForTenant(
  tenantId: string,
  opts: ProduceProposalsOptions = {},
): Promise<ProduceProposalsResult> {
  const maxDrafts = opts.maxDrafts ?? DEFAULT_MAX_DRAFTS;
  const persist = opts.persist ?? true;

  const snapshot = await loadEvidenceSnapshot(tenantId, { now: opts.now });
  // The account-curated trusted-source domains are BusinessProfile DATA
  // (the account's own row), never code. Unset = only the universal
  // source-authority set applies.
  const profile = await loadBusinessProfile(tenantId).catch(() => null);
  const allowlist =
    opts.authoritativeSourceDomains ?? profile?.trustedSourceDomains.value ?? [];

  // The basis this pass generates under: the SAME fingerprint Runtime and the
  // Evidence funnel scope their derived work with, plus this kernel's decision
  // generation. Every proposal is stamped with it, so a proposal manufactured
  // under rules the evidence no longer has to satisfy stops reading as ready and
  // becomes history instead of silently current. Fail-soft to null: an
  // unreadable account stamps nothing rather than stamping a wrong basis.
  const basis = await resolveCurrentBasis(tenantId, profile);

  // THE DIAGNOSIS FIRST. Doing nothing is the default; only a proven gap is work.
  const candidates = compileCandidates(snapshot);
  const acted = candidates.filter((c) => c.action === "act_existing_page" || c.action === "act_new_page");
  const recoverableByKey = new Map<string, number>();
  for (const c of acted) {
    if (c.action === "act_existing_page") for (const k of pageKeys(c)) recoverableByKey.set(k, c.recoverableClicks);
    else recoverableByKey.set(`topic:${(c.query ?? "").trim().toLowerCase()}`, c.recoverableClicks);
  }
  /** Stamp the basis and the ONE ranking scalar (recoverable clicks) onto a
   *  proposal, whichever producer built it. Never invents a figure. */
  const stamp = (p: ChangeProposal): ChangeProposal => {
    const key = p.kind === "new_page"
      ? `topic:${p.primaryQuery.trim().toLowerCase()}`
      : (p.pageUrl ?? "").trim().toLowerCase();
    const recoverable = recoverableByKey.get(key)
      ?? recoverableByKey.get((p.pagePath ?? "").trim().toLowerCase());
    return {
      ...p,
      ...(basis ? { basis } : {}),
      impactScore: recoverable ?? p.impactScore,
    };
  };

  const all = candidatesToEvidenceInputs(snapshot, acted);
  const inputs = [
    ...all.filter((i) => i.opportunity.kind === "existing_edit").slice(0, MAX_EXISTING_DRAFTS),
    ...all.filter((i) => i.opportunity.kind === "new_page").slice(0, MAX_NEW_PAGE_DRAFTS),
  ].slice(0, maxDrafts);

  if (acted.length === 0) {
    log.info("[produce-proposals] nothing earned an action this pass", {
      tenantId,
      judged: candidates.length,
      watching: candidates.filter((c) => c.action === "watch").length,
    });
    return { proposals: [], candidates, noActionableCandidate: true, actionable: 0, noDraft: 0 };
  }

  const proposals: ChangeProposal[] = [];
  let noDraft = 0;
  for (const input of inputs) {
    const outcome = await proposeChange(input, {
      complete: opts.complete,
      now: opts.now,
      bypassCache: opts.bypassCache,
      authoritativeSourceDomains: allowlist,
    }).catch((e) => {
      log.warn("[produce-proposals] propose threw (fail-soft)", {
        tenantId,
        id: input.opportunity.query,
        error: e instanceof Error ? e.message : String(e),
      });
      return { status: "no_draft" as const, reason: "threw", drafterStatus: "error" };
    });
    if (outcome.status !== "proposed") {
      noDraft += 1;
      continue;
    }
    const proposal = stamp(outcome.proposal);
    proposals.push(proposal);
    if (persist) await saveChangeProposal(proposal);
  }

  // ONE bundle per archetype per pass (strongest proven page + strongest proven
  // topic). A bundle REPLACES its own shallow drafts (never the same change
  // twice); a refusal is honest and silent and the shallow drafts stand. A bundle
  // for a page or topic NO candidate proved is dropped: the deep form of a change
  // nobody needs is still a change nobody needs.
  const bundleOpts = {
    complete: opts.complete,
    now: opts.now,
    bypassCache: opts.bypassCache,
    authoritativeSourceDomains: allowlist,
  };
  const onThrow = (e: unknown) => {
    log.warn("[produce-proposals] bundle threw (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { status: "none" as const, reason: "threw" };
  };

  const provenPage = acted.find((c) => c.action === "act_existing_page")?.pageUrl ?? null;
  if (provenPage) {
    const bundled = await produceBundleForSnapshot(snapshot, { ...bundleOpts, onlyPageUrl: provenPage }).catch(onThrow);
    const covered = bundled.status === "bundled" ? (bundled.proposal.pageUrl ?? "").trim().toLowerCase() : "";
    const proven = bundled.status === "bundled"
      && (recoverableByKey.has(covered) || recoverableByKey.has((bundled.proposal.pagePath ?? "").trim().toLowerCase()));
    if (bundled.status === "bundled" && proven) {
      const page = bundled.proposal.pagePath;
      for (let i = proposals.length - 1; i >= 0; i--) {
        const p = proposals[i]!;
        if (p.kind === "existing_edit" && p.pagePath === page) proposals.splice(i, 1);
      }
      const proposal = stamp(bundled.proposal);
      proposals.push(proposal);
      if (persist) await saveChangeProposal(proposal);
    } else {
      log.info("[produce-proposals] no bundle this pass", {
        tenantId,
        reason: bundled.status === "bundled" ? "page has no proven gap" : bundled.reason,
      });
    }
  }

  if (acted.some((c) => c.action === "act_new_page")) {
    const newPageBundled = await produceNewPageBundleForSnapshot(snapshot, bundleOpts).catch(onThrow);
    const topic = newPageBundled.status === "bundled" ? newPageBundled.proposal.primaryQuery.trim().toLowerCase() : "";
    if (newPageBundled.status === "bundled" && recoverableByKey.has(`topic:${topic}`)) {
      for (let i = proposals.length - 1; i >= 0; i--) {
        const p = proposals[i]!;
        if (p.kind === "new_page" && p.primaryQuery.trim().toLowerCase() === topic) proposals.splice(i, 1);
      }
      const proposal = stamp(newPageBundled.proposal);
      proposals.push(proposal);
      if (persist) await saveChangeProposal(proposal);
    } else {
      log.info("[produce-proposals] no new-page bundle this pass", {
        tenantId,
        reason: newPageBundled.status === "bundled" ? "topic has no proven gap" : newPageBundled.reason,
      });
    }
  }

  return {
    proposals: rankProposals(proposals),
    candidates,
    noActionableCandidate: false,
    actionable: acted.length,
    noDraft,
  };
}
