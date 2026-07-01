/**
 * clarity-move-router (2026-06-25, Sprint 6) - turn a Clarity friction signal into a
 * SPECIFIC fix Move (not just a friction score). PURE / deterministic / no I/O.
 *
 * The friction trigger today emits one generic "fix experience" rec. But the
 * friction PATTERN tells you what to fix: script errors (block crawlers + break the
 * page), dead clicks (a control that looks clickable but isn't, usually near the
 * CTA), rage clicks (a frustrating interaction), quick-backs (the page doesn't match
 * the query intent), shallow scroll (the answer is buried). This router picks the
 * dominant pattern and the matching move. Fail closed: below the session floor or
 * with no clear pattern → null (no guess).
 *
 * Pinned by clarity-move-router.test.ts.
 */

import type { ClarityPageSignal } from "./clarity-page-signals";

export type ClarityMoveType =
  | "fix_js_errors"
  | "fix_dead_click"
  | "fix_rage_interaction"
  | "fix_intent_mismatch"
  | "raise_answer";

export type ClarityMoveDecision = {
  moveType: ClarityMoveType;
  severity: "high" | "medium";
  reason: string;
  /** The dominant metric + its per-session rate (or value), for evidence. */
  evidence: string;
};

export type ClarityRouterThresholds = {
  minSessions: number;
  scriptErrorRate: number;
  deadRate: number;
  rageRate: number;
  quickbackRate: number;
  shallowScrollPct: number;
};

const DEFAULTS: ClarityRouterThresholds = {
  minSessions: 20,
  scriptErrorRate: 0.05,
  deadRate: 0.06,
  rageRate: 0.06,
  quickbackRate: 0.35,
  shallowScrollPct: 0.3,
};

/**
 * Route a Clarity signal to its most-specific fix Move. PURE. Priority reflects
 * impact: script errors first (they block AI crawlers + break UX), then dead/rage
 * interaction, then intent mismatch, then buried answer. Returns null when the page
 * has too few sessions or no clear friction pattern.
 */
export function routeClarityFriction(
  signal: ClarityPageSignal,
  thresholds: Partial<ClarityRouterThresholds> = {},
): ClarityMoveDecision | null {
  const t = { ...DEFAULTS, ...thresholds };
  if ((signal.sessions ?? 0) < t.minSessions) return null;

  const errorRate = signal.sessions > 0 ? signal.scriptErrors / signal.sessions : 0;

  if (errorRate >= t.scriptErrorRate) {
    return {
      moveType: "fix_js_errors",
      severity: "high",
      reason: "Script errors break the page for users AND can stop AI crawlers from reading it.",
      evidence: `${(errorRate * 100).toFixed(1)}% of sessions hit a script error`,
    };
  }
  if (signal.deadRate >= t.deadRate) {
    return {
      moveType: "fix_dead_click",
      severity: "medium",
      reason: "Dead clicks mean people click something that looks interactive but isn't - often a broken CTA.",
      evidence: `${(signal.deadRate * 100).toFixed(1)}% dead-click rate`,
    };
  }
  if (signal.rageRate >= t.rageRate) {
    return {
      moveType: "fix_rage_interaction",
      severity: "medium",
      reason: "Rage clicks signal a frustrating/unresponsive interaction.",
      evidence: `${(signal.rageRate * 100).toFixed(1)}% rage-click rate`,
    };
  }
  if (signal.quickbackRate >= t.quickbackRate) {
    return {
      moveType: "fix_intent_mismatch",
      severity: "medium",
      reason: "High quick-backs mean visitors bounce straight back - the page likely doesn't match the query intent.",
      evidence: `${(signal.quickbackRate * 100).toFixed(0)}% quick-back rate`,
    };
  }
  if (signal.scrollDepthPct != null && signal.scrollDepthPct < t.shallowScrollPct) {
    return {
      moveType: "raise_answer",
      severity: "medium",
      reason: "Visitors barely scroll - the key answer is likely buried; move it above the fold.",
      evidence: `avg scroll depth ${(signal.scrollDepthPct * 100).toFixed(0)}%`,
    };
  }
  return null;
}
