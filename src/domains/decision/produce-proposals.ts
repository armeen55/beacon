/**
 * decision/produce-proposals (CORE 100K cutover, 2026-07-22) — the ONE server
 * path that turns a tenant's cached evidence into persisted ChangeProposals.
 * It is the replacement for the old prepare/move-router/action-pack producers:
 *
 *   loadEvidenceSnapshot (six cached sources, $0)
 *     → snapshotToEvidenceInputs (pure opportunities)
 *       → proposeChange (cold, gated, budgeted drafter + the ONE validator)
 *         → saveChangeProposal (durable, fail-soft)
 *
 * COLD by default: the drafter's `complete` fn is injectable, so tests run this
 * whole path with zero paid calls. In production the real gated/budgeted drafter
 * runs; a blocked or off harness simply yields fewer proposals (fail-closed),
 * never a fabricated one. Publishing stays MANUAL — this only proposes.
 *
 * server-only.
 */

import "server-only";

import { log } from "@/lib/logger";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import { loadBusinessProfile } from "@/domains/account";
import { snapshotToEvidenceInputs } from "./opportunities";
import { produceBundleForSnapshot, produceNewPageBundleForSnapshot } from "./produce-bundle";
import { proposeChange, type ProposeOptions } from "./propose";
import { saveChangeProposal } from "./proposal-store";
import { rankProposals } from "./rank-proposals";
import type { ChangeProposal } from "./contracts";

export type ProduceProposalsOptions = ProposeOptions & {
  /** Hard cap on how many opportunities we draft this pass (budget guard). */
  maxDrafts?: number;
  /** Persist each landed proposal (default true). Tests pass false to stay pure. */
  persist?: boolean;
};

export type ProduceProposalsResult = {
  proposals: ChangeProposal[];
  /** How many opportunities the snapshot produced. */
  opportunities: number;
  /** How many drafts failed closed (off / budget / validation). */
  noDraft: number;
};

/** A safe default cap: enough to fill the queue, bounded for budget/latency. */
export const DEFAULT_MAX_DRAFTS = 24;

/**
 * Produce (and by default persist) ranked ChangeProposals for one tenant from
 * cached evidence only. Never throws on a single-source outage — a failed source
 * simply narrows the snapshot. Returns the ranked proposals it produced this pass.
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

  const inputs = snapshotToEvidenceInputs(snapshot).slice(0, maxDrafts);

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
    proposals.push(outcome.proposal);
    if (persist) await saveChangeProposal(outcome.proposal);
  }

  // ONE bundle per archetype per pass (strongest page rewrite + strongest researched
  // topic). A bundle REPLACES its own shallow drafts (never the same change twice);
  // a refusal is honest and silent and the shallow drafts stand.
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
  const bundled = await produceBundleForSnapshot(snapshot, bundleOpts).catch(onThrow);
  if (bundled.status === "bundled") {
    const covered = bundled.proposal.pagePath;
    for (let i = proposals.length - 1; i >= 0; i--) {
      const p = proposals[i]!;
      if (p.kind === "existing_edit" && p.pagePath === covered) proposals.splice(i, 1);
    }
    proposals.push(bundled.proposal);
    if (persist) await saveChangeProposal(bundled.proposal);
  } else {
    log.info("[produce-proposals] no bundle this pass", { tenantId, reason: bundled.reason });
  }

  const newPageBundled = await produceNewPageBundleForSnapshot(snapshot, bundleOpts).catch(onThrow);
  if (newPageBundled.status === "bundled") {
    const topic = newPageBundled.proposal.primaryQuery.trim().toLowerCase();
    for (let i = proposals.length - 1; i >= 0; i--) {
      const p = proposals[i]!;
      if (p.kind === "new_page" && p.primaryQuery.trim().toLowerCase() === topic) proposals.splice(i, 1);
    }
    proposals.push(newPageBundled.proposal);
    if (persist) await saveChangeProposal(newPageBundled.proposal);
  } else {
    log.info("[produce-proposals] no new-page bundle this pass", { tenantId, reason: newPageBundled.reason });
  }

  return { proposals: rankProposals(proposals), opportunities: inputs.length, noDraft };
}
