import "server-only";

/**
 * verify-shipped-change (J-73/C-25, 2026-07-09) - the AUTO-VERIFY orchestrator.
 *
 * "AUTO-VERIFY manual changes: crawl the page and match the shipped text (no
 * honor system)" (C-25) + "Capture his final edit as a structured diff
 * automatically (crawl + diff against the proposed text); never require
 * manual paste-back" (J-73).
 *
 * Composition (PURE reuse, no new scoring logic invented):
 *   fetchPageHtml (competitor-intel/polite-fetch, the SAME polite/robots-
 *   respecting fetch in-process-scan.ts uses) -> extractPageSnapshot
 *   (pages/extractor, the SAME extractor in-process-scan.ts uses) ->
 *   candidatesForActionType (this file's own small mapping from action_type
 *   to the PageSnapshot field(s) it edits) -> similarity + normalizeTextBoth
 *   (match-engine/similarity.ts + normalize-text.ts, READ-ONLY - shared with
 *   the nightly match-runner, never edited here) -> splitIntoPassages
 *   (pages/passage-answerability.ts, READ-ONLY) for answer-block-shaped edits
 *   that can land anywhere in the body.
 *
 * Deterministic only - NO LLM anywhere in this file (architect decision: a
 * crawl-verify pass has to be trustworthy on its own, not another model's
 * opinion of a model's opinion).
 *
 * Six reachable states (see `VerifyState` in shipped-change-store.ts for the
 * full contract) - `classify` below is the ONLY place that produces one:
 *   1. exact match                                  -> verified_live/exact
 *   2. similarity >= "modified" AND claims preserved AND the live text is
 *      strictly closer to the proposal than to the pre-ship value (C-25
 *      real-move check, P1-1)                        -> verified_live/modified
 *   3. similarity >= "modified" BUT claims drifted    -> verified_live_modified
 *   4. medium <= similarity < "modified", OR a modified-tier match whose live
 *      text still matches the OLD value (the change was not really made)
 *                                                    -> needs_review
 *   5. top-2 candidates BOTH clear "modified"         -> needs_review (ambiguous)
 *   6. similarity < medium, the crawl/fetch failed, the URL is not this
 *      tenant's own domain, OR a redirect landed on a foreign host
 *                                                    -> not_found / crawl_failed
 *
 * TENANT SAFETY: `tenantId` is explicit end-to-end. This module never calls
 * the ambient `currentTenantId()` - the caller (auto-record-on-ship.ts /
 * execution-actions.ts) already resolved the tenant for the ship it is
 * verifying, and persistence goes through `markVerifyResultById`, an
 * explicit-tenant, single-row update (never an ambient load-all/upsert-all).
 * Before ever fetching, the crawl URL's host is checked against THIS
 * tenant's own configured domain - a foreign URL is never crawled, and never
 * silently "verified" for the wrong tenant.
 *
 * Fail-soft: this function NEVER throws to its caller. Any unexpected
 * failure (bad URL, config read error, crawl exception) resolves to
 * `crawl_failed` - the record is left honestly un-verified, never a silent
 * "verified_live".
 */

import { log } from "@/lib/logger";
import { getBusinessConfig } from "@/lib/business-config";
import { fetchPageHtml } from "@/domains/competitor-intel/polite-fetch";
import { originFromDomain, stripWww } from "@/domains/scanning/in-process-scan";
import { extractPageSnapshot } from "@/domains/pages/extractor";
import type { PageSnapshot } from "@/domains/pages/types";
import { similarity, tokenize } from "@/domains/recommendations/match-engine/similarity";
import { normalizeTextBoth, extractFirstNonEmptyLine } from "@/domains/recommendations/match-engine/normalize-text";
import { ACTION_THRESHOLDS, type ActionThresholds } from "@/domains/recommendations/match-engine/types";
import { splitIntoPassages } from "@/domains/pages/passage-answerability";
import {
  markVerifyResultById,
  type ShippedChangeRecord,
  type VerifyState,
  type EditDiffRecord,
} from "./shipped-change-store";

/** Fallback thresholds for an action_type that isn't in ACTION_THRESHOLDS
 *  (e.g. the generic "change" headline Beacon falls back to when nothing more
 *  specific is known) - matches the most common row in that table (edit_title
 *  / edit_meta / change_h1 / add_internal_link / create_page all use 0.85/0.5). */
const FALLBACK_THRESHOLDS: ActionThresholds = { modified: 0.85, medium: 0.5 };

/** A word/number carries "claim" content (a fact the page asserts) when it's
 *  a number or long enough to plausibly be a name/entity rather than
 *  ordinary phrasing filler. Digits always count regardless of length. */
const CLAIM_TOKEN_MIN_LEN = 4;

export type VerifyShippedChangeDeps = {
  fetchImpl?: typeof fetch;
  /** Injectable clock for `editDiff.capturedAt`. Defaults to real time. */
  now?: () => string;
  /** Per-request crawl timeout, forwarded to fetchPageHtml. */
  timeoutMs?: number;
  /** Explicit-tenant business config read, injectable for tests. Defaults to
   *  the real `getBusinessConfig(tenantId)`. */
  getBusinessConfigImpl?: (tenantId: string) => { domain: string };
  /** Explicit-tenant persistence, injectable for tests. Defaults to the real
   *  `markVerifyResultById`. */
  markVerifyResultImpl?: typeof markVerifyResultById;
};

export type VerifyShippedChangeResult = {
  verifyState: VerifyState;
  editDiff: EditDiffRecord | null;
};

/** Tokens that carry claim/entity content (see CLAIM_TOKEN_MIN_LEN). */
function claimTokens(folded: string): Set<string> {
  return new Set(tokenize(folded).filter((t) => /\d/.test(t) || t.length >= CLAIM_TOKEN_MIN_LEN));
}

/**
 * True when every claim token in the proposal is still present in the live
 * text - the edit changed PHRASING but not FACTS. Order-independent (set
 * containment), since a paraphrase reorders clauses. A proposal with no
 * claim tokens at all (nothing to drift on) is vacuously preserved.
 */
export function claimTokensPreserved(proposalFolded: string, liveFolded: string): boolean {
  const proposalClaims = claimTokens(proposalFolded);
  if (proposalClaims.size === 0) return true;
  const liveClaims = claimTokens(liveFolded);
  for (const t of proposalClaims) {
    if (!liveClaims.has(t)) return false;
  }
  return true;
}

function thresholdsFor(actionType: string): ActionThresholds {
  return ACTION_THRESHOLDS[actionType] ?? FALLBACK_THRESHOLDS;
}

export type VerifyCandidate = { field: string; text: string };

/**
 * Candidate live texts for one action_type, paired with the field label the
 * editDiff records. Singleton fields (title/meta/h1) return at most one
 * candidate; positional fields (h2/faq/body passages) return every instance
 * on the page so `classify` can pick the best match AND detect ambiguity.
 */
export function candidatesForActionType(snapshot: PageSnapshot, actionType: string): VerifyCandidate[] {
  switch (actionType) {
    case "edit_title":
    case "create_page":
      return snapshot.title ? [{ field: "title", text: snapshot.title }] : [];
    case "edit_meta":
      return snapshot.meta_description
        ? [{ field: "meta_description", text: snapshot.meta_description }]
        : [];
    case "change_h1":
      return snapshot.h1 ? [{ field: "h1", text: snapshot.h1 }] : [];
    case "add_h2_section":
    case "rewrite_h2":
      return (snapshot.h2_list ?? []).map((h, i) => ({ field: `h2[${i}]`, text: h }));
    case "add_faq":
    case "rewrite_faq":
      return (snapshot.faqs ?? []).flatMap((f, i) => [
        { field: `faq[${i}].question`, text: f.question },
        { field: `faq[${i}].answer`, text: f.answer_excerpt },
      ]);
    default: {
      // add_answer_block / add_internal_link / the generic "change" fallback:
      // the edit could land anywhere in the body, so score every passage -
      // same splitting passage-answerability.ts's own scorer uses.
      const passages = splitIntoPassages(snapshot.body_paragraph_sample ?? []);
      return passages.map((p, i) => ({ field: `passage[${i}]`, text: p }));
    }
  }
}

/** Proposal text to compare, adjusted per action_type. H2 generators
 *  sometimes concatenate "Heading\nBody paragraph" (normalize-text.ts's
 *  extractFirstNonEmptyLine's own documented reason for existing) - only the
 *  heading is the h2_list candidate, so strip it for those two types only. */
function proposalTextFor(actionType: string, after: string): string {
  if (actionType === "add_h2_section" || actionType === "rewrite_h2") {
    return extractFirstNonEmptyLine(after);
  }
  return after;
}

type Classified = { state: VerifyState; best: (VerifyCandidate & { sim: number }) | null };

/**
 * C-25 REAL-MOVE CHECK (P1-1, 2026-07-09): a would-be "shipped" verdict must
 * show the live text is STRICTLY closer to the proposal (`after`) than to the
 * pre-ship value (`before`). If the live page still matches the old text, the
 * operator did not actually make the change - a small-delta proposal (after =
 * a light edit of before) would otherwise clear the "modified" bar against the
 * UNCHANGED page and be falsely marked live. Only checked when `before` is
 * non-empty AND differs from the proposal (otherwise there is nothing to
 * distinguish, and the check is a vacuous pass).
 */
function liveIsRealMove(
  beforeFolded: string | undefined,
  proposalFolded: string,
  liveText: string,
): boolean {
  const before = (beforeFolded ?? "").trim();
  if (!before || before === proposalFolded) return true; // nothing to distinguish
  const liveFolded = normalizeTextBoth(liveText).folded;
  const simToAfter = similarity(proposalFolded, liveFolded);
  const simToBefore = similarity(before, liveFolded);
  return simToAfter > simToBefore; // strictly closer to the proposal than the old text
}

/** The one place all six verify states are produced. Pure - no I/O. */
export function classify(
  proposalFolded: string,
  candidates: ReadonlyArray<VerifyCandidate>,
  thresholds: ActionThresholds,
  beforeFolded?: string,
): Classified {
  if (candidates.length === 0) {
    return { state: { outcome: "not_found", kind: null }, best: null };
  }

  const scored = candidates
    .map((c) => ({ ...c, sim: similarity(proposalFolded, normalizeTextBoth(c.text).folded) }))
    .sort((a, b) => b.sim - a.sim);
  const top = scored[0]!;
  const second = scored[1];

  // An exact normalized match is never ambiguous, and (when `before` differs
  // from the proposal) is always a real move - live text identical to the
  // proposal cannot also match the old text more closely.
  if (top.sim >= 1) {
    return { state: { outcome: "verified_live", kind: "exact" }, best: top };
  }

  // Ambiguous: two different spots on the page both clear "modified" - hold
  // for operator review rather than guessing which one is right.
  if (second != null && second.sim >= thresholds.modified && top.sim >= thresholds.modified) {
    return { state: { outcome: "needs_review", kind: null }, best: top };
  }

  if (top.sim >= thresholds.modified) {
    // C-25 real-move check (P1-1): a modified-tier match must be STRICTLY
    // closer to the proposal than to the pre-ship value. A small-delta
    // proposal (after = a light edit of before) would otherwise clear the
    // "modified" bar against the UNCHANGED page and be falsely marked live;
    // hold for review instead when the page still matches the old text.
    if (!liveIsRealMove(beforeFolded, proposalFolded, top.text)) {
      return { state: { outcome: "needs_review", kind: null }, best: top };
    }
    const preserved = claimTokensPreserved(proposalFolded, normalizeTextBoth(top.text).folded);
    return {
      state: preserved
        ? { outcome: "verified_live", kind: "modified" }
        : { outcome: "verified_live_modified", kind: null },
      best: top,
    };
  }

  if (top.sim >= thresholds.medium) {
    return { state: { outcome: "needs_review", kind: null }, best: top };
  }

  return { state: { outcome: "not_found", kind: null }, best: top };
}

/**
 * Crawl the shipped change's page and compare the proposal (`record.after`)
 * against whatever is actually live. Persists the result via the
 * explicit-tenant `markVerifyResultById` (never ambient tenant) and returns
 * it. NEVER throws - any failure resolves to `crawl_failed`.
 */
export async function verifyShippedChange(
  args: { tenantId: string; record: ShippedChangeRecord },
  deps: VerifyShippedChangeDeps = {},
): Promise<VerifyShippedChangeResult> {
  const { tenantId, record } = args;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowIso = deps.now ?? (() => new Date().toISOString());
  const getConfig = deps.getBusinessConfigImpl ?? getBusinessConfig;
  const markResult = deps.markVerifyResultImpl ?? markVerifyResultById;
  const capturedAt = nowIso();

  const persistAndReturn = async (
    verifyState: VerifyState,
    editDiff: EditDiffRecord | null,
  ): Promise<VerifyShippedChangeResult> => {
    try {
      await markResult(tenantId, record.id, { verifyState, editDiff });
    } catch (e) {
      log.warn("[verify-shipped-change] persist failed (fail-soft, record stays un-verified)", {
        tenantId,
        id: record.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return { verifyState, editDiff };
  };

  const proposal = (record.after ?? "").trim();
  if (!tenantId || !record.page || proposal === "") {
    // Nothing to verify against - honest crawl_failed, never a silent
    // verified. (No target URL, or Beacon never captured what it proposed.)
    return persistAndReturn({ outcome: "crawl_failed", kind: null }, null);
  }

  let recordHost: string;
  try {
    recordHost = stripWww(new URL(record.page).hostname.toLowerCase());
  } catch {
    return persistAndReturn({ outcome: "crawl_failed", kind: null }, null);
  }

  // Tenant-domain safety: never crawl a URL that isn't THIS tenant's own
  // connected site, no matter what page a caller hands in.
  let ownHost: string | null = null;
  try {
    const cfg = getConfig(tenantId);
    ownHost = originFromDomain(cfg?.domain ?? "")?.host ?? null;
  } catch (e) {
    log.warn("[verify-shipped-change] business-config read failed (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  if (!ownHost || ownHost !== recordHost) {
    return persistAndReturn({ outcome: "crawl_failed", kind: null }, null);
  }

  let fetched;
  try {
    const robotsCache = new Map<string, string[]>();
    fetched = await fetchPageHtml(record.page, robotsCache, { fetchImpl, timeoutMs: deps.timeoutMs });
  } catch (e) {
    log.warn("[verify-shipped-change] crawl threw (fail-soft)", {
      tenantId,
      page: record.page,
      error: e instanceof Error ? e.message : String(e),
    });
    return persistAndReturn({ outcome: "crawl_failed", kind: null }, null);
  }
  if (!fetched.ok) {
    return persistAndReturn({ outcome: "crawl_failed", kind: null }, null);
  }

  // P2 (2026-07-09): a redirect can land the crawl on a DIFFERENT host than the
  // tenant's own domain (the pre-fetch host check only guards the requested
  // URL). When polite-fetch surfaces the final URL, re-check its host; a
  // cross-host redirect is a crawl_failed, never a silent verify against a
  // foreign page. When finalUrl is absent (a fetch layer that doesn't expose
  // it, e.g. a test stub), skip - the pre-fetch check already gated the
  // requested URL.
  if (fetched.finalUrl) {
    let finalHost: string | null = null;
    try {
      finalHost = stripWww(new URL(fetched.finalUrl).hostname.toLowerCase());
    } catch {
      finalHost = null;
    }
    if (finalHost && finalHost !== ownHost) {
      log.warn("[verify-shipped-change] crawl redirected off the tenant domain (fail-soft)", {
        tenantId,
        page: record.page,
        finalUrl: fetched.finalUrl,
      });
      return persistAndReturn({ outcome: "crawl_failed", kind: null }, null);
    }
  }

  let snapshot: PageSnapshot;
  try {
    snapshot = extractPageSnapshot(fetched.html, record.page, record.id, tenantId, fetched.status);
  } catch (e) {
    log.warn("[verify-shipped-change] snapshot extraction threw (fail-soft)", {
      tenantId,
      page: record.page,
      error: e instanceof Error ? e.message : String(e),
    });
    return persistAndReturn({ outcome: "crawl_failed", kind: null }, null);
  }

  const thresholds = thresholdsFor(record.actionType);
  const candidates = candidatesForActionType(snapshot, record.actionType);
  const proposalText = proposalTextFor(record.actionType, proposal);
  const proposalFolded = normalizeTextBoth(proposalText).folded;
  // C-25 real-move check input (P1-1): the pre-ship value, normalized the SAME
  // way as the proposal + candidates, so classify can require the live page to
  // be closer to the proposal than to this old text before marking it live.
  const beforeRaw = (record.before ?? "").trim();
  const beforeFolded = beforeRaw ? normalizeTextBoth(proposalTextFor(record.actionType, beforeRaw)).folded : "";

  const { state, best } = classify(proposalFolded, candidates, thresholds, beforeFolded);

  const editDiff: EditDiffRecord | null =
    best == null
      ? null
      : {
          field: best.field,
          proposedAfter: proposalText,
          liveText: best.text,
          similarity: best.sim,
          verdict: state.outcome,
          capturedAt,
        };

  return persistAndReturn(state, editDiff);
}
