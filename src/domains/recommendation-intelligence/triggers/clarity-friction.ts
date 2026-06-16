/**
 * Clarity fuse slice (2026-06-13 midnight shift) — trigger predicate:
 * `clarity_friction`. The first CONSUMER of the synced Clarity data
 * (`clarity_daily_url_metrics`), closing the END-STATE "evidence
 * fuses" loop: the moment a Clarity token lands, per-URL friction
 * surfaces as a review card.
 *
 * Two sub-signals (sourced; commit carries the ≥4-source digest from
 * Microsoft Learn + CRO/UX references):
 *   • script_errors (HIGH) — JS errors are a CONFIRMED defect, not a
 *     statistical anomaly. Dual rationale: they break interactivity
 *     for users AND most AI crawlers (GPTBot/OAI-SearchBot/Perplexity)
 *     DON'T execute JS — so a script error that blocks rendering hides
 *     the page's content from AI answer engines entirely (directly the
 *     AEO wedge). Fire when scriptErrors/sessions ≥ 0.05.
 *   • rage_clicks (MEDIUM) — rapid repeated clicks = frustration with a
 *     non-responsive element. Sourced band: >7% of sessions = "needs
 *     attention". Fire when rageRate ≥ 0.07.
 *   • dead_clicks (MEDIUM, 2026-06-16) — clicks on a non-interactive
 *     element (a thing that LOOKS tappable but isn't: a broken link, a
 *     dead button, an image people expect to open). Clarity treats dead
 *     clicks as a primary friction metric, but there's no PUBLISHED
 *     threshold and content sites have a high baseline (people click
 *     words/images) — v1 excluded them to avoid false positives. We now
 *     fire only at a DELIBERATELY CONSERVATIVE `DEAD_CLICK_RATE ≥ 0.50`:
 *     when the MAJORITY of sessions hit a dead element, that's an
 *     anomaly far above any normal content-browsing baseline (e.g.
 *     Iranopedia's site-wide dead rate is ~22%; the gate sits >2× that),
 *     so it signals a genuinely broken affordance, not browsing noise.
 *     Lower with data once we have a real per-vertical baseline.
 *     (quickbacks / excessive-scroll remain excluded — no defensible band.)
 *
 * SESSION FLOOR: ≥ 50 sessions over the window before any rate fires —
 * Clarity exports COUNTS (we divide by sessions), so a tiny
 * denominator must never trip a false alarm.
 *
 * Emits `fix_page_experience` at OPERATOR-REVIEW with a DIRECTIVE draft
 * (names the specific Clarity signal + what to investigate; never
 * fabricates the fix — the actual JS bug / element is the owner's to
 * locate). Dormant until a Clarity token lands (no signal → abstain).
 *
 * PURE FUNCTION — pinned by `recommendation-trigger-predicates-purity`
 * + `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { clarityFrictionCopy } from "../customer-copy-templates";
import { isNonHtmlAsset } from "../page-classifier";
import type { ClarityPageSignal } from "../clarity-page-signals";

export type ClarityFrictionInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  /** Pre-loaded Clarity signal for this page, or undefined when
   *  Clarity isn't connected / has no rows for this URL. */
  signal: ClarityPageSignal | undefined;
};

export const MIN_CLARITY_SESSIONS = 50;
export const SCRIPT_ERROR_RATE = 0.05;
export const RAGE_RATE = 0.07;
/** Conservative dead-click gate — fires only when the MAJORITY of sessions
 *  hit a dead element (far above any normal content-browsing baseline). */
export const DEAD_CLICK_RATE = 0.5;

type FrictionKind = {
  kind: "script_errors" | "rage_clicks" | "dead_clicks";
  confidence: "high" | "medium";
};

/** The binding friction reason for a page, worst-first (confirmed defects
 *  first: script errors > rage > dead), or null when none clears its
 *  threshold. */
export function frictionReason(signal: ClarityPageSignal): FrictionKind | null {
  if (signal.sessions < MIN_CLARITY_SESSIONS) return null;
  if (signal.scriptErrors > 0 && signal.scriptErrors / signal.sessions >= SCRIPT_ERROR_RATE) {
    return { kind: "script_errors", confidence: "high" };
  }
  if (signal.rageRate >= RAGE_RATE) {
    return { kind: "rage_clicks", confidence: "medium" };
  }
  if (signal.deadRate >= DEAD_CLICK_RATE) {
    return { kind: "dead_clicks", confidence: "medium" };
  }
  return null;
}

export function clarityFriction(
  input: ClarityFrictionInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, signal } = input;
  if (isNonHtmlAsset(snapshot.url)) return [];
  if (snapshot.http_status >= 400) return [];
  if (signal == null) return [];

  const reason = frictionReason(signal);
  if (reason == null) return [];

  const actionType = "fix_page_experience" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel =
    reason.kind === "script_errors" ? "Page errors" : "Page friction";

  const pct = (n: number, d: number) =>
    d > 0 ? (100 * n / d).toFixed(1) + "%" : "0%";
  const detail =
    reason.kind === "script_errors"
      ? "clarity_28d script_errors=" +
        signal.scriptErrors +
        "; sessions=" +
        signal.sessions +
        "; affected≈" +
        pct(signal.scriptErrors, signal.sessions) +
        " of sessions"
      : reason.kind === "dead_clicks"
        ? "clarity_28d dead_clicks=" +
          signal.deadClicks +
          "; sessions=" +
          signal.sessions +
          "; dead_rate=" +
          pct(signal.deadClicks, signal.sessions)
        : "clarity_28d rage_clicks=" +
          signal.rageClicks +
          "; sessions=" +
          signal.sessions +
          "; rage_rate=" +
          pct(signal.rageClicks, signal.sessions);

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "clarity_friction",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [{ kind: "page_snapshot", ref: targetUrl, detail }],
      confidence: reason.confidence,
      impact_estimate: reason.kind === "script_errors" ? "high" : "medium",
      customer_copy: clarityFrictionCopy(reason.kind),
      operator_evidence:
        "signal=clarity_friction; reason=" +
        reason.kind +
        "; sessions=" +
        signal.sessions +
        "; script_errors=" +
        signal.scriptErrors +
        "; rage_clicks=" +
        signal.rageClicks +
        "; dead_clicks=" +
        signal.deadClicks +
        "; play=" +
        (reason.kind === "script_errors"
          ? "fix_js_errors (also blocks JS-free AI crawlers)"
          : reason.kind === "dead_clicks"
            ? "find_dead_element (looks tappable, isn't)"
            : "review_frustrating_element"),
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: snapshot.fetched_at,
      safety_flags: [],
    },
  ];
}
