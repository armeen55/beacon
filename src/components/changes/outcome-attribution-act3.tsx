/**
 * 2026-05-19 — Slice 9.A2β — customer-safe outcome-attribution sub-
 * line for Changes detail Act 3.
 *
 * Pure presentational component. Type-only import of `ModeAResult`;
 * no loader, no server-only modules, no repository, no GA4
 * connector imports, no Supabase reads. Safely consumable by the
 * existing Changes detail client component.
 *
 * Locked customer copy (Section 9 K5 + K4 + Slice 9.A2β preflight
 * P1–P5):
 *   • eligible (calls = 0): "This page received {N} session(s) in the
 *     {X} day(s) since going live."
 *   • eligible (calls ≥ 1): "This page received {N} session(s) and
 *     {M} call(s) in the {X} day(s) since going live."
 *   • still_learning_outcome / insufficient_volume:
 *     "Not enough post-live traffic evidence yet for this page.
 *      Refresh your connected data over the next week or two to
 *      gather more."
 *   • still_learning_outcome / insufficient_days:
 *     "This page is still too newly live to attribute outcomes —
 *      Beacon needs at least 7 days of post-live traffic data.
 *      Refresh your connected data over the next week or two to
 *      fill that in."
 *
 * Plural-aware: `1 session` / `N sessions`; `1 call` / `M calls`;
 * `1 day` / `X days`.
 *
 * Forward-compat (K2 CallRail-deferred):
 *   `post_live_qualified_calls` is always 0 in production today.
 *   The eligible-with-calls branch is preserved so the day CallRail
 *   ships and `qualifiedCallCount ≥ 1` flows through, the customer
 *   copy auto-extends to the "N sessions and M calls" form with no
 *   code change required.
 *
 * Suppression rules:
 *   - `result == null` → null (loader fail-soft / unconnected
 *     surface).
 *   - `result.kind === "ineligible"` → null (substrate gap — NOT a
 *     customer message; per Section 6 / Section 9 architecture
 *     invariant).
 *
 * K5 customer-vocab discipline (defense in depth):
 *   Customer-facing copy never uses `drove` / `caused` / `generated`
 *   / `revenue` / `dollars` / `$` / `ROI` / `sales` / `leads`. Never
 *   mentions `Mode A` / `Mode B` / `Mode C` / `primary
 *   recommendation`. Never names connector internals (CallRail /
 *   GA4 / Google / GBP). Pinned by
 *   `outcome-attribution-changes-detail-vocab` architecture
 *   invariant.
 */

import type { ReactElement } from "react";

import type { ModeAResult } from "@/domains/outcome-attribution/mode-a-cited-here-traffic-here";

type OutcomeAttributionAct3Props = {
  result: ModeAResult | null;
};

/** Singular/plural helper: `1 session` vs `N sessions`. Avoids
 *  nested template literals so static-text source scanners can
 *  reason about every customer-visible literal independently. */
function pluralize(n: number, singular: string): string {
  const word = n === 1 ? singular : singular + "s";
  return n + " " + word;
}

/**
 * Locked customer copy assembled deterministically from the
 * discriminator. Suppression (return null) handled at the call site;
 * this helper assumes the caller already filtered out `ineligible`
 * and `null` cases.
 */
function buildCopy(
  result: Exclude<ModeAResult, { kind: "ineligible" }>,
): string {
  if (result.kind === "eligible") {
    const sessionsClause = pluralize(result.post_live_sessions, "session");
    const callsClause =
      result.post_live_qualified_calls >= 1
        ? ` and ${pluralize(result.post_live_qualified_calls, "call")}`
        : "";
    const daysClause = pluralize(result.days_since_live, "day");
    return `This page received ${sessionsClause}${callsClause} in the ${daysClause} since going live.`;
  }
  // still_learning_outcome
  if (result.reason === "insufficient_days") {
    return "This page is still too newly live to attribute outcomes — Beacon needs at least 7 days of post-live traffic data. Refresh your connected data over the next week or two to fill that in.";
  }
  // insufficient_volume
  return "Not enough post-live traffic evidence yet for this page. Refresh your connected data over the next week or two to gather more.";
}

/**
 * Data attribute carrying the discriminator's shape — operator-side
 * triage / E2E test hook. Customer copy stays in the visible text;
 * the kind attribute is mechanism-only.
 */
function kindAttr(result: Exclude<ModeAResult, { kind: "ineligible" }>): string {
  if (result.kind === "eligible") return "eligible";
  return result.reason === "insufficient_days"
    ? "still_learning_insufficient_days"
    : "still_learning_insufficient_volume";
}

/**
 * Customer-facing outcome-attribution sub-line. Renders inside Act 3
 * AFTER the existing repeat-citation sub-line; no bridging copy
 * between the two.
 */
export function OutcomeAttributionAct3({
  result,
}: OutcomeAttributionAct3Props): ReactElement | null {
  if (result == null) return null;
  if (result.kind === "ineligible") return null;

  const copy = buildCopy(result);
  const attr = kindAttr(result);

  return (
    <div
      className="mt-3 rounded-md border border-border/40 bg-surface-inset/30 px-3 py-2"
      data-change-detail-outcome-attribution="true"
      data-outcome-attribution-kind={attr}
    >
      <p
        className="text-[12.5px] font-medium text-foreground"
        data-change-detail-outcome-label="true"
      >
        Outcomes
      </p>
      <p
        className="mt-0.5 text-[11.5px] text-muted-foreground"
        data-change-detail-outcome-detail="true"
      >
        {copy}
      </p>
    </div>
  );
}
