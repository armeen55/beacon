/**
 * stage-route (BEACON_500 item 15, 2026-07-02) - PURE classification + copy for
 * "Stage in Wix": which EXISTING push route (if any) could apply a change, and
 * the exact operator receipt / paste-fallback lines both cards render.
 *
 * This module adds NO push logic. It only mirrors the routes push-service
 * already owns (field-role derivation, Stores seoData, mapped body sections) so
 * the daily card and the worklist MoveCard can decide, deterministically and
 * client-safely, whether to OFFER a one-click "Stage in Wix" button. The actual
 * write authority stays entirely in executePush; anything this map gets wrong
 * simply fails closed to the paste instruction when the stage runs.
 *
 * No I/O. No server-only imports (client cards import this directly).
 */

import { LEVER_TO_ACTION_TYPE } from "@/domains/experiments/execution-state";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";

/** The existing push-service routes a staged change can travel. */
export type StageRoute = "field" | "schema" | "body";

/** Mirror of the push service's field route: content edits whose CMS field the
 *  operator can map on /diagnostics/wix (deriveWixContentFieldKey roles). */
const FIELD_ACTIONS = new Set(["edit_title", "edit_meta", "change_h1"]);
/** Mirror of the push service's body-section route (additive merges only). */
const BODY_ACTIONS = new Set(["add_answer_block", "add_faq", "add_h2_section"]);

/** Can this tenant one-click stage a pushable change in Wix right now?
 *  `enabled` gates the button; `armed`/`wixTarget` drive the quiet nudge. */
export type StagingAvailability = {
  /** armed + publish permission + a live Wix target: the button may show. */
  enabled: boolean;
  /** The site is explicitly armed for one-click publishing. */
  armed: boolean;
  /** The tenant's publish target is wix_cms (a live write is even possible). */
  wixTarget: boolean;
};

export const STAGING_OFF: StagingAvailability = {
  enabled: false,
  armed: false,
  wixTarget: false,
};

/**
 * Which existing push route could carry this change? Null means there is no
 * one-click path (internal links, UX fixes, new pages, removals) and the card
 * must stay paste-only. An explicit element key wins over the action type,
 * exactly like the push service's own routing.
 */
export function stageRouteForActionType(
  actionType: string | null | undefined,
  elementKey?: string | null,
): StageRoute | null {
  const key = (elementKey ?? "").trim();
  if (key.startsWith("field:")) return "field";
  if (key.startsWith("section:")) return "body";
  const a = (actionType ?? "").trim();
  if (FIELD_ACTIONS.has(a)) return "field";
  if (a === "add_schema") return "schema";
  if (BODY_ACTIONS.has(a)) return "body";
  return null;
}

/**
 * P2-g (2026-07-10, visual audit) - the source-safety gate (draft-quality.ts's
 * copyAllowed - "EVERY factual draft requires 1-2 authoritative sources", W5)
 * must ALSO block the one-click "Stage in Wix" button, not just the card's inline
 * copy. Verified: stage-change.ts's server-side QA backstop for a worklist move
 * checks a DIFFERENT, older verdict (recommendation-qa.ts's qaVerdict - approve +
 * pushReadiness), which has zero knowledge of missing_source / needs_source_check.
 * Without this gate, a draft the card itself refuses to show as ready copy could
 * still stage straight into Wix through the one-click button. A row with no
 * computed quality verdict at all (a legacy/undrafted row) is never newly
 * blocked - only an explicit `copyAllowed: false` verdict disables staging. */
export function copyAllowedForStaging(preparedQuality: { copyAllowed: boolean } | null | undefined): boolean {
  return !preparedQuality || preparedQuality.copyAllowed;
}

/** Daily-plan levers map through the existing lever -> action-type table.
 *  internal_link has no write path (by design) and returns null. */
export function stageRouteForLever(lever: string | null | undefined): StageRoute | null {
  if (!lever) return null;
  const action = (LEVER_TO_ACTION_TYPE as Record<string, string>)[lever];
  return action ? stageRouteForActionType(action, null) : null;
}

/** "2:14am" in the operating timezone (falls back to UTC HH:MM). */
export function formatStageTime(now: Date, timeZone = "America/Los_Angeles"): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    })
      .format(now)
      .replace(/\s+/g, "")
      .toLowerCase();
  } catch {
    return now.toISOString().slice(11, 16);
  }
}

/** The receipt the card renders after a successful stage. */
export function stagedReceiptLine(now: Date): string {
  return `Staged in Wix at ${formatStageTime(now)}. I saved the old version first; one click restores it.`;
}

/** Fail-closed paste instruction (every refusal path lands here). The reason is
 *  dash-stripped at this chokepoint so a raw push-service reason can never leak
 *  a banned dash onto a card. */
export function pasteFallbackLine(reason?: string | null): string {
  const base = "I could not stage this one in Wix, so copy and paste it yourself.";
  const r = stripBannedDashes((reason ?? "").trim());
  return r ? `${base} Why: ${r}` : base;
}
