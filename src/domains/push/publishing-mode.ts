/**
 * Armed publishing mode (2026-06-16) — the per-site policy that decides whether
 * one click on a recommendation publishes LIVE, or stages it for a second
 * approval click.
 *
 * Operator directive (Option 1 "per-site arming, then 1-click"):
 *   "After a site is safely connected, mapped, and explicitly armed by the
 *    operator, clicking Accept on a safe pushable recommendation should publish
 *    the approved field edit live in one click. This preserves informed consent
 *    without forcing a second approval click forever."
 *
 * DEFAULT IS REVIEW-GATED. A tenant is `staged` (two-click: Accept → Approve &
 * Push) until the operator explicitly ARMS it, and arming requires real
 * preconditions (Wix connected + collection mappings + a passing dry-run +
 * confirmed safety rails). Losing the arming state (lambda recycle, missing
 * table) fails SAFE — back to `staged` — never to an unexpected live write.
 *
 * This module is PURE: the deterministic gate over already-computed inputs. It
 * adds NO new safety to the write itself — `executePush` remains the structural
 * authority (Ritz hard-refuse, daily cap, snapshot-before-write, field-merge
 * only, non-destructive patch, no URL/slug/link/delete, mapping required). This
 * gate decides ONLY whether a click routes to that write path or to staging,
 * and it can only ever be MORE conservative than the click the operator made.
 *
 * No hardcoded vertical/keyword/brand/tenant rules.
 *
 * Pinned by tests/domains/push/publishing-mode.test.ts.
 */

import type { PublishTargetKind } from "@/domains/tenants/types";
import type { RecPushReadiness, RecQaVerdict } from "@/domains/recommendations/recommendation-qa";

/** Per-site publishing mode. Absent → `staged` (the safe default). */
export type PublishingMode = "staged" | "armed";

/**
 * What clicking the primary CTA on a recommendation should do, given the site's
 * mode + the rec's deterministic QA verdict.
 *   • publish_live  — armed + safe + mapped → Accept publishes the field edit live.
 *   • stage         — review-gated (default) OR armed-but-not-one-click-eligible:
 *                     Accept records intent; the existing Approve & Push (the
 *                     per-edit approval) still publishes from the brief.
 *   • paste_ready   — a manual edit (e.g. a new page) — copy the change by hand.
 *   • review_only   — the QA gate did not approve (rejected / low / needs more
 *                     evidence) — never publishable; open the brief first.
 */
export type AcceptDisposition =
  | "publish_live"
  | "stage"
  | "paste_ready"
  | "review_only";

export type AcceptDispositionInput = {
  /** The site's publishing mode (absent → staged). */
  mode: PublishingMode | null | undefined;
  /** Whether the current user may publish for this tenant (server-computed). */
  canPublish: boolean;
  /** The tenant's publish target (only wix_cms supports a live one-click write). */
  publishTarget: PublishTargetKind | null | undefined;
  /** The deterministic QA verdict for this rec (the list-enforcement authority). */
  qaVerdict: Pick<RecQaVerdict, "approve" | "pushReadiness"> | null | undefined;
  /**
   * True when the row is a fresh suggestion (new/needs_review bucket). An
   * already-actioned row never re-publishes on Accept.
   */
  isSuggestion: boolean;
};

/**
 * The deterministic disposition. ORDER MATTERS — the most conservative gate
 * that applies wins, so a rec can never be MORE publishable than every check
 * allows.
 *
 * `qaVerdict.approve === true` is, by construction, equivalent to "confidence is
 * high or medium" — `enforceExpertConfidence` sets `approve=false` for low /
 * needs_more_evidence / rejected. So gating on `approve` alone satisfies the
 * directive's "no rejected / no low / no needs-more-evidence" rails. Push
 * readiness then separates a live-writable field edit (`paste_ready`) from a
 * manual build (`manual` → new page) and a non-publishable directive
 * (`review_only` → technical fix / review decision).
 */
export function decideAcceptDisposition(
  input: AcceptDispositionInput,
): AcceptDisposition {
  const v = input.qaVerdict ?? null;

  // An already-actioned row (accepted/shipped/…) is never re-published here.
  if (!input.isSuggestion) return "stage";

  // QA did not approve → never publishable, never a one-tap accept.
  if (v == null || v.approve !== true) return "review_only";

  // Approved but not a paste-ready field edit:
  //   • manual      → a new page to build by hand.
  //   • review_only → a directive (technical fix / review decision) — no write.
  if (v.pushReadiness !== "paste_ready") {
    return v.pushReadiness === "manual" ? "paste_ready" : "review_only";
  }

  // Approved + paste-ready. One-click LIVE only when the site is armed, the
  // user may publish, and the target supports a live write. Otherwise STAGE —
  // Accept records intent; the operator publishes via the brief's Approve &
  // Push (the unchanged review-gated default).
  const armed = (input.mode ?? "staged") === "armed";
  if (armed && input.canPublish && input.publishTarget === "wix_cms") {
    return "publish_live";
  }
  return "stage";
}

/** Convenience: does a click on this rec publish live in one tap? */
export function isOneClickPublish(input: AcceptDispositionInput): boolean {
  return decideAcceptDisposition(input) === "publish_live";
}

// ─────────────────────────────────────────────────────────────────────
// Arming preconditions — what must be true before a site can be armed.
// ─────────────────────────────────────────────────────────────────────

export type ArmingPreconditionKey =
  | "connector_connected"
  | "collection_mapped"
  | "dry_run_passed"
  | "safety_rails_confirmed";

export type ArmingPrecondition = {
  key: ArmingPreconditionKey;
  /** Customer-readable label. */
  label: string;
  met: boolean;
};

export type ArmingPreconditionInput = {
  /** A live Wix write target is configured for this tenant. */
  publishTarget: PublishTargetKind | null | undefined;
  /** The Wix connector is connected (a usable token exists). */
  connectorConnected: boolean;
  /** At least one collection field-role mapping (or url-map entry) exists. */
  mappingCount: number;
  /**
   * A dry-run of the real push path passed (every guard + resolution ran and
   * stopped before any write). True also when there is nothing pushable to
   * dry-run yet — arming is allowed; the per-edit gate + executePush still
   * protect the first real push.
   */
  dryRunPassed: boolean;
  /** The operator explicitly confirmed the safety rails in the UI. */
  safetyRailsConfirmed: boolean;
};

export type ArmingEvaluation = {
  /** All preconditions met → the site MAY be armed. */
  canArm: boolean;
  items: ArmingPrecondition[];
  /** Keys of the unmet preconditions (empty when canArm). */
  blockers: ArmingPreconditionKey[];
};

/**
 * Evaluate whether a site may be armed. PURE — the caller gathers the inputs
 * (connector status, mapping count, dry-run result) and renders/acts on the
 * result. Arming is refused unless EVERY precondition is met; a live target
 * (wix_cms) is itself required (git_pr / dev_note tenants can't one-click-push).
 */
export function evaluateArmingPreconditions(
  input: ArmingPreconditionInput,
): ArmingEvaluation {
  const liveTarget = input.publishTarget === "wix_cms";
  const items: ArmingPrecondition[] = [
    {
      key: "connector_connected",
      label: "Your site is connected for publishing",
      met: liveTarget && input.connectorConnected,
    },
    {
      key: "collection_mapped",
      label: "Your pages are mapped to the right content fields",
      met: input.mappingCount > 0,
    },
    {
      key: "dry_run_passed",
      label: "A safe test run of the publish path passed",
      met: input.dryRunPassed,
    },
    {
      key: "safety_rails_confirmed",
      label: "You confirmed what one-click publishing will do",
      met: input.safetyRailsConfirmed,
    },
  ];
  const blockers = items.filter((i) => !i.met).map((i) => i.key);
  return { canArm: blockers.length === 0, items, blockers };
}

/** Re-export for callers that only need the readiness union. */
export type { RecPushReadiness };
