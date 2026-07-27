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
 * FOUR HONEST ENDINGS (`outcome`), so a surface never reads an empty queue as an
 * outage or a failed write as a quiet day:
 *   no_actionable_candidate       nothing earned an action. Success.
 *   actionable_but_no_trusted_draft  real gaps, no exact edit passed the evidence
 *                                 and safety checks. Success, and the surface says so.
 *   persistence_failed            every write failed. FAILURE: the caller must not
 *                                 publish, so the previous release stays byte-identical.
 *   proposals_persisted           at least one material proposal is durable.
 *
 * ONE EVIDENCE BASIS, ONE ROW. A refresh re-pays nothing: a candidate whose
 * current-generation proposal already exists is never redrafted, and a proposal
 * whose material content fingerprint is unchanged is never re-inserted. The store
 * used to take a plain insert per pass, so one unchanged proposal was written 27
 * times and every refresh moved its timestamp.
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
import { candidatesToEvidenceInputs, compileCandidates, type QualifiedCandidate } from "./opportunities";
import { produceBundleForSnapshot, produceNewPageBundleForSnapshot } from "./produce-bundle";
import { proposeChange, type ProposeOptions } from "./propose";
import { loadChangeProposals, proposalFingerprint, saveChangeProposal } from "./proposal-store";
import { rankProposals } from "./rank-proposals";
import { confidenceFor, proposalId, type ChangeProposal, type EvidenceReadiness } from "./contracts";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";

export type ProduceProposalsOptions = ProposeOptions & {
  /** Hard cap on how many opportunities we draft this pass (budget guard). */
  maxDrafts?: number;
  /** Persist each landed proposal (default true). Tests pass false to stay pure. */
  persist?: boolean;
};

/** How this pass ended. Only `persistence_failed` is a failure. `investigating`
 *  is the honest middle: proven gaps exist, and what to change about them is not
 *  known yet, so they must be VISIBLE rather than read as a quiet day. */
export type ProducerOutcome =
  | "no_actionable_candidate"
  | "investigating"
  | "actionable_but_no_trusted_draft"
  | "persistence_failed"
  | "proposals_persisted";

export type ProduceProposalsResult = {
  /** The ranked proposals this pass produced (may be empty and still a success). */
  proposals: ChangeProposal[];
  /** Every page and topic the diagnosis judged, act or not: the run receipt. */
  candidates: QualifiedCandidate[];
  /** Which of the four honest endings this pass reached. */
  outcome: ProducerOutcome;
  /** How many candidates earned an action (act_existing_page + act_new_page). */
  actionable: number;
  /** Proven gaps whose cause is not identified yet: real work, not silence. */
  investigating: number;
  /** How many drafts failed closed (off / budget / validation). */
  noDraft: number;
  /** Material rows actually written this pass. */
  persisted: number;
  /** Proposals carried forward unchanged: no draft, no write, no dollars. */
  reused: number;
};

/** Bounded drafting: the strongest few, never a queue. */
export const MAX_EXISTING_DRAFTS = 3;
export const MAX_NEW_PAGE_DRAFTS = 2;
export const DEFAULT_MAX_DRAFTS = MAX_EXISTING_DRAFTS + MAX_NEW_PAGE_DRAFTS;

/** Normalized keys a candidate and a proposal can be matched on. */
const pageKeys = (pageUrl: string | null | undefined): string[] => {
  const url = (pageUrl ?? "").trim().toLowerCase();
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
  const readinessByKey = new Map<string, EvidenceReadiness>();
  for (const c of acted) {
    if (c.action === "act_existing_page") {
      for (const k of pageKeys(c.pageUrl)) {
        recoverableByKey.set(k, c.recoverableClicks);
        // Readiness is a fact about ONE page and ONE EXACT SEARCH. Keyed by page
        // alone, a page whose strongest gap had a results page handed its
        // confidence to a draft written for a DIFFERENT search on the same page,
        // so a card read "high" directly above its own receipt saying I never
        // looked at that search. The query is part of the key now.
        if (c.readiness && c.query) readinessByKey.set(`${k}::${canonicalQueryKey(c.query)}`, c.readiness);
      }
    } else recoverableByKey.set(`topic:${(c.query ?? "").trim().toLowerCase()}`, c.recoverableClicks);
  }
  /** Stamp the basis, the ONE ranking scalar (recoverable clicks), and CONFIDENCE
   *  BY EVIDENCE COMPLETENESS onto a proposal, whichever producer built it. A
   *  drafter used to hand itself "high" on a change whose receipt was empty; now
   *  the readiness the diagnosis measured decides it. Never invents a figure. */
  const stamp = (p: ChangeProposal): ChangeProposal => {
    const key = p.kind === "new_page"
      ? `topic:${p.primaryQuery.trim().toLowerCase()}`
      : (p.pageUrl ?? "").trim().toLowerCase();
    const pathKey = (p.pagePath ?? "").trim().toLowerCase();
    const recoverable = recoverableByKey.get(key) ?? recoverableByKey.get(pathKey);
    // Only the readiness measured for THIS proposal's own search may set its
    // confidence. No match means the diagnosis judged a different search here, so
    // the producer's own honest value stands rather than a neighbour's.
    const qk = canonicalQueryKey(p.primaryQuery);
    const readiness = p.kind === "existing_edit"
      ? (readinessByKey.get(`${key}::${qk}`) ?? readinessByKey.get(`${pathKey}::${qk}`))
      : undefined;
    return {
      ...p,
      ...(basis ? { basis } : {}),
      impactScore: recoverable ?? p.impactScore,
      confidence: readiness ? confidenceFor(readiness) : p.confidence,
    };
  };

  // ONE read of what is already durable. It answers both idempotence questions:
  // may I skip the DRAFT (a current-generation proposal already covers this
  // candidate), and may I skip the WRITE (the material content is unchanged).
  const existing = persist
    ? await loadChangeProposals(tenantId).catch(() => new Map<string, ChangeProposal>())
    : new Map<string, ChangeProposal>();
  const live = [...existing.values()].filter((p) => p.status !== "rejected" && p.status !== "applied");
  /** A stored row generated under THIS basis. Null basis proves nothing, so it
   *  reuses nothing: an account I cannot read must never freeze its own queue. */
  const current = (p: ChangeProposal): boolean => basis != null && p.basis === basis;
  const currentById = (id: string): ChangeProposal | null => {
    const p = existing.get(id);
    return p && p.status !== "rejected" && p.status !== "applied" && current(p) ? p : null;
  };
  const currentBundleFor = (match: (p: ChangeProposal) => boolean): ChangeProposal | null =>
    live.find((p) => !!p.bundle && current(p) && match(p)) ?? null;

  let persisted = 0;
  let writeFailures = 0;
  let reused = 0;
  /** Persist ONE material row, or nothing at all when the stored row already says
   *  exactly this. An unchanged proposal must not get a new timestamp: a refreshed
   *  surface would read yesterday's thinking as today's work. */
  const persistIfChanged = async (p: ChangeProposal): Promise<void> => {
    if (!persist) return;
    const prior = existing.get(p.id);
    if (prior && proposalFingerprint(prior) === proposalFingerprint(p)) return;
    const result = await saveChangeProposal(p);
    if (result === "failed") writeFailures += 1;
    else if (result === "saved") persisted += 1; // "unchanged" wrote nothing, so it counts as nothing
    existing.set(p.id, p);
  };

  const all = candidatesToEvidenceInputs(snapshot, acted);
  const inputs = [
    ...all.filter((i) => i.opportunity.kind === "existing_edit").slice(0, MAX_EXISTING_DRAFTS),
    ...all.filter((i) => i.opportunity.kind === "new_page").slice(0, MAX_NEW_PAGE_DRAFTS),
  ].slice(0, maxDrafts);

  const investigating = candidates.filter((c) => c.action === "research_needed").length;
  if (acted.length === 0) {
    log.info("[produce-proposals] nothing earned an action this pass", {
      tenantId,
      judged: candidates.length,
      watching: candidates.filter((c) => c.action === "watch").length,
      researching: investigating,
    });
    // A proven gap I cannot yet explain is NOT a quiet day. Saying so here is what
    // keeps "Nothing needs a decision today" off a screen with real losses behind it.
    return { proposals: [], candidates, outcome: investigating > 0 ? "investigating" : "no_actionable_candidate",
      actionable: 0, investigating, noDraft: 0, persisted: 0, reused: 0 };
  }

  // THE STRONGEST PROVEN PAGE, never the first one the snapshot happened to list.
  // `find` handed the deep bundle to whichever actionable page came back first, so
  // a 58-click page got the deep work while an 824-click gap sat untouched.
  // Deterministic: most recoverable clicks, then page address.
  const provenPage = acted
    .filter((c) => c.action === "act_existing_page")
    .sort((a, b) => b.recoverableClicks - a.recoverableClicks || (a.pageUrl ?? "").localeCompare(b.pageUrl ?? ""))[0]?.pageUrl ?? null;
  const provenKeys = pageKeys(provenPage);
  /** The deep bundle this page already has under the current basis, if any. */
  const heldBundle = currentBundleFor((p) => p.kind === "existing_edit" && provenKeys.includes((p.pagePath ?? "").trim().toLowerCase()));

  const proposals: ChangeProposal[] = [];
  let noDraft = 0;
  for (const input of inputs) {
    // A refresh re-pays nothing. A current-generation row already covering this
    // candidate (its own row, or the deep bundle that replaced it) is carried
    // forward as-is: no drafter call, no write, no new timestamp.
    // THE OPERATOR'S NO IS FINAL. A rejected or already-applied row for this exact
    // change must never be redrafted: the newest row wins on read, so a redraft
    // silently resurrected a change the operator turned down (and re-paid the
    // drafter to do it). Basis-independent on purpose: a rejection is about the
    // change itself, not about the rules that were current when it was made.
    const settled = existing.get(proposalId(input));
    if (settled && (settled.status === "rejected" || settled.status === "applied")) continue;
    const held = currentById(proposalId(input))
      ?? (heldBundle && input.opportunity.kind === "existing_edit" && heldBundle.pagePath === input.page.path ? heldBundle : null);
    if (held) {
      if (!proposals.some((p) => p.id === held.id)) {
        // Reuse skips the DRAFTER, never the judgment. A stored row keeps its words
        // and its history, and is re-stamped against today's evidence, so a change
        // whose search I still have not looked at stops claiming confidence it lost.
        const restamped = stamp(held);
        proposals.push(restamped);
        reused += 1;
        await persistIfChanged(restamped);
      }
      continue;
    }
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
    await persistIfChanged(proposal);
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

  if (provenPage && !heldBundle) {
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
      await persistIfChanged(proposal);
    } else {
      log.info("[produce-proposals] no bundle this pass", {
        tenantId,
        reason: bundled.status === "bundled" ? "page has no proven gap" : bundled.reason,
      });
    }
  } else if (heldBundle && !proposals.some((p) => p.id === heldBundle.id)) {
    // The held bundle used to reach the queue only through the atomic-input loop,
    // and that loop is empty whenever the proven page needs no atomic edit. The
    // pass then reported "no trusted draft" while a judged, current bundle sat in
    // the store. It is carried here, re-stamped, whether or not the loop ran.
    const proposal = stamp(heldBundle);
    proposals.push(proposal);
    reused += 1;
    await persistIfChanged(proposal);
  }

  const heldTopicBundle = currentBundleFor((p) => p.kind === "new_page"
    && recoverableByKey.has(`topic:${p.primaryQuery.trim().toLowerCase()}`));
  if (heldTopicBundle) {
    for (let i = proposals.length - 1; i >= 0; i--) {
      if (proposals[i]!.kind === "new_page" && proposals[i]!.primaryQuery === heldTopicBundle.primaryQuery) proposals.splice(i, 1);
    }
    const proposal = stamp(heldTopicBundle);
    proposals.push(proposal);
    reused += 1;
    await persistIfChanged(proposal);
  } else if (acted.some((c) => c.action === "act_new_page")) {
    const newPageBundled = await produceNewPageBundleForSnapshot(snapshot, bundleOpts).catch(onThrow);
    const topic = newPageBundled.status === "bundled" ? newPageBundled.proposal.primaryQuery.trim().toLowerCase() : "";
    if (newPageBundled.status === "bundled" && recoverableByKey.has(`topic:${topic}`)) {
      for (let i = proposals.length - 1; i >= 0; i--) {
        const p = proposals[i]!;
        if (p.kind === "new_page" && p.primaryQuery.trim().toLowerCase() === topic) proposals.splice(i, 1);
      }
      const proposal = stamp(newPageBundled.proposal);
      proposals.push(proposal);
      await persistIfChanged(proposal);
    } else {
      log.info("[produce-proposals] no new-page bundle this pass", {
        tenantId,
        reason: newPageBundled.status === "bundled" ? "topic has no proven gap" : newPageBundled.reason,
      });
    }
  }

  // The honest ending. A write that failed on EVERY attempt is a failure, not a
  // quiet day: the caller must keep the previous release rather than stamp a fresh
  // timestamp on work nobody can load back.
  const outcome: ProducerOutcome =
    writeFailures > 0 && persisted === 0 ? "persistence_failed"
      : proposals.length === 0 ? "actionable_but_no_trusted_draft"
        : "proposals_persisted";
  if (outcome !== "proposals_persisted") {
    log.warn("[produce-proposals] pass produced no durable work", { tenantId, outcome, actionable: acted.length, noDraft, writeFailures });
  }
  return {
    proposals: rankProposals(proposals),
    candidates,
    outcome,
    actionable: acted.length,
    investigating,
    noDraft,
    persisted,
    reused,
  };
}
