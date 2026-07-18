import "server-only";

/**
 * canary (BEACON_500 R22a / N50, 2026-07-03) - the pre-flight canary gate: a
 * deterministic set of cheap invariant checks over a batch of prepared moves,
 * run BEFORE the batch is armed / staged / pushed. If ANY canary fails, the
 * WHOLE batch is HELD with one plain reason and NOTHING is published.
 *
 * WHY a whole-batch hold and not a per-move skip. The nightly batch ships one
 * lever across many sibling pages in one accepted plan. If two drafts came out
 * of the drafter with an empty title, or one carries a banned dash, or one URL
 * belongs to a different tenant, that is a signal the batch itself is suspect,
 * not just those rows. Holding the whole batch (rather than quietly dropping the
 * bad rows and shipping the rest) means a bad night surfaces LOUDLY to the
 * operator instead of half-publishing silently. This is the last gate before the
 * existing arm/stage path, MORE conservative than every rail below it, never a
 * replacement for them.
 *
 * The five canaries (all deterministic, all cheap):
 *   1. No banned dashes in any draft (the em/en dash HARD rule).
 *   2. No empty required field (a draft with no target URL or no proposed text).
 *   3. No off-tenant URL (a move whose URL domain is not the tenant's own).
 *   4. Spend under the global cost breaker (N43) - a batch that would cross the
 *      global monthly ceiling is held before it can spend.
 *   5. Every move has at least one evidence ref (no ungrounded change ships).
 *
 * PURE core (`runCanaries`) so tests pin each invariant with no I/O; the spend
 * canary takes the breaker verdict as an input, not a live read, so the whole
 * gate stays deterministic. The plain-English hold reason is Beacon voice: first
 * person, a concrete count, no lab words, no dashes.
 */

import { hasBannedDash } from "@/lib/copy/strip-dashes";
import { rootDomain } from "@/domains/serp/serp-provider";

/** The minimal shape the canary needs from a prepared move (decoupled from the
 *  full RecommendedEditRow so any prepared-move producer can be gated). */
export type CanaryMove = {
  /** Stable id for the hold message (falls back to the URL when absent). */
  id?: string | null;
  targetUrl: string | null | undefined;
  proposedText: string | null | undefined;
  /** How many evidence refs back this move. 0 or missing = ungrounded. */
  evidenceCount: number;
};

/** Which canary a hold is attributed to (stable machine tag + plain reason). */
export type CanaryFailure = {
  canary: "banned_dash" | "empty_field" | "off_tenant_url" | "over_global_spend" | "no_evidence";
  reason: string;
};

export type CanaryVerdict =
  | { held: false; checked: number }
  | { held: true; checked: number; failures: CanaryFailure[]; holdReason: string };

/** True when a move's URL belongs to the tenant's own domain (or a subdomain).
 *  Pure; mirrors the own-domain matching in dataforseo-serp.resolveOwnRank so
 *  the two never disagree. An unparseable/empty URL is handled by the
 *  empty-field canary, so here it simply counts as off-tenant. */
export function isOwnTenantUrl(url: string | null | undefined, tenantDomain: string | null | undefined): boolean {
  const own = rootDomain((tenantDomain ?? "").trim());
  if (!own) return false; // no tenant domain to compare against -> cannot confirm ownership
  const d = rootDomain((url ?? "").trim());
  if (!d) return false;
  return d === own || d.endsWith(`.${own}`);
}

export type CanaryContext = {
  /** The tenant's own domain, for the off-tenant URL canary. */
  tenantDomain: string | null;
  /** The N43 breaker verdict for this batch's projected spend. When tripped,
   *  the spend canary fails. Passed in (not read live) so the gate is pure. */
  spendTripped: boolean;
  /** The plain reason from the breaker when tripped (surfaced in the hold). */
  spendReason?: string;
};

/**
 * PURE: run every canary over a batch. Returns held:false for a clean batch
 * (byte-identical downstream behavior) or held:true with the failures + one
 * plain hold reason. An EMPTY batch is never held (nothing to check).
 */
export function runCanaries(moves: readonly CanaryMove[], ctx: CanaryContext): CanaryVerdict {
  const failures: CanaryFailure[] = [];
  const label = (m: CanaryMove) => (m.id && m.id.trim() ? m.id : (m.targetUrl ?? "a move"));

  // 4. Global spend (batch-level; checked once, first so a capped batch reads
  //    as a spend hold rather than being masked by a per-move issue).
  if (ctx.spendTripped) {
    failures.push({
      canary: "over_global_spend",
      reason: ctx.spendReason ?? "this batch would cross my monthly spending ceiling, so I held it.",
    });
  }

  let emptyCount = 0;
  let dashCount = 0;
  let offTenantCount = 0;
  let noEvidenceCount = 0;

  for (const m of moves) {
    const url = (m.targetUrl ?? "").trim();
    const text = (m.proposedText ?? "").trim();

    // 2. Empty required field.
    if (url === "" || text === "") {
      emptyCount += 1;
      continue; // an empty draft can't be meaningfully checked for the rest
    }
    // 1. Banned dash in the draft.
    if (hasBannedDash(text)) dashCount += 1;
    // 3. Off-tenant URL.
    if (!isOwnTenantUrl(url, ctx.tenantDomain)) offTenantCount += 1;
    // 5. Ungrounded (no evidence).
    if (!(m.evidenceCount > 0)) noEvidenceCount += 1;
  }

  if (emptyCount > 0) {
    failures.push({
      canary: "empty_field",
      reason: `${emptyCount} ${emptyCount === 1 ? "draft was" : "drafts were"} missing a title or a target page.`,
    });
  }
  if (dashCount > 0) {
    failures.push({
      canary: "banned_dash",
      reason: `${dashCount} ${dashCount === 1 ? "draft had" : "drafts had"} a dash I do not write, so I did not publish ${dashCount === 1 ? "it" : "them"}.`,
    });
  }
  if (offTenantCount > 0) {
    failures.push({
      canary: "off_tenant_url",
      reason: `${offTenantCount} ${offTenantCount === 1 ? "move pointed" : "moves pointed"} at a page that is not on your site.`,
    });
  }
  if (noEvidenceCount > 0) {
    failures.push({
      canary: "no_evidence",
      reason: `${noEvidenceCount} ${noEvidenceCount === 1 ? "move had" : "moves had"} no evidence behind ${noEvidenceCount === 1 ? "it" : "them"}.`,
    });
  }

  if (failures.length === 0) return { held: false, checked: moves.length };
  void label; // reserved for a future per-move breakdown; batch reason is enough today

  return {
    held: true,
    checked: moves.length,
    failures,
    holdReason: buildHoldReason(failures),
  };
}

/**
 * PURE: the single plain hold line the operator sees. Beacon voice: first
 * person, concrete counts, owns the miss plainly, ends with the reassurance
 * that nothing shipped. No lab words, no dashes.
 */
export function buildHoldReason(failures: readonly CanaryFailure[]): string {
  if (failures.length === 0) return "";
  const detail = failures.map((f) => f.reason).join(" ");
  return `I held today's batch: ${detail} Nothing was published.`;
}
