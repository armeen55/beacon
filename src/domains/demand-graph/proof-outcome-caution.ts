/**
 * proof-outcome-caution (2026-06-28) — the PAGE-SPECIFIC half of the learning loop,
 * complementing learning/experiment-prior.ts (which learns SETTLED win/loss patterns
 * across action-types/page-types, and deliberately IGNORES measuring rows).
 *
 * This module closes the gap experiment-prior leaves open: a Move whose OWN page +
 * compatible action family already has a shipped change that is...
 *  - still MEASURING  → slight demote + "held while measuring" (do NOT re-recommend
 *    the same edit on a page mid-experiment — it muddies the measurement).
 *  - settled NO-LIFT / LOST → demote + "same edit showed no lift" (don't repeat a
 *    change that didn't work on THIS exact page).
 *  - settled WON (verdict-ready + not low-confidence) → modest boost + "similar edit
 *    on this page lifted" (a follow-up compatible move is worth doing).
 * Everything else (inconclusive / insufficient_data / operator-excluded / a measuring
 * row of a DIFFERENT family) is NEUTRAL — never learn a verdict from a waiting row.
 *
 * Conservative by construction (the operator's hard rules):
 *  - Bounded ±10% (tighter than experiment-prior's ±15%); a page caution tilts, never
 *    dominates. Raw MoveComponents (the lie detector) are NEVER touched — only the
 *    final sort key is multiplied, OUTSIDE the pure scorer.
 *  - EXACT same-page + same-family match beats the generic "edit" bridge.
 *  - No rows → every multiplier 1.0 → byte-identical order (safest rollout).
 * Reuses the Results linker's URL/family matching (proof-linker) for consistency.
 * PURE / deterministic / no I/O. Pinned by proof-outcome-caution.test.ts.
 */

import { normPath, familyOfLedgerAction, familyCompatible } from "@/domains/action-pack/proof-linker";
import type { MoveCandidate, GapKind } from "@/domains/demand-graph/build-graph";

/** Bounded band — page cautions influence ties, never dominate. */
export const CAUTION_MIN = 0.9;
export const CAUTION_MAX = 1.1;
const MEASURING_HOLD = 0.92;
const NO_LIFT_DEMOTE = 0.9;
const SAME_PAGE_WIN_BOOST = 1.08;
/** A settled win needs at least this baseline (the GSC verdict already enforces 200,
 *  so this is a belt-and-suspenders floor for the boost specifically). */
const MIN_WIN_BASELINE = 200;

/** One proof-ledger row reduced to what the caution needs (page + verdict + family). */
export type ProofOutcomeRow = {
  id: string;
  page: string;
  actionType: string;
  verdict: string; // measuring | won | lost | inconclusive | insufficient_data
  confidence: string; // high | medium | low
  operatorVerdictOverride: string | null;
  baselineImpressions: number;
};

export type OutcomeCautionKind = "held_measuring" | "no_lift" | "lifted" | "neutral";

export type OutcomeCaution = {
  multiplier: number;
  kind: OutcomeCautionKind;
  /** Operator-friendly one-liner, or null when neutral. */
  label: string | null;
  reason: string | null;
  confidence: "none" | "low" | "medium" | "high";
  /** Linked proof row ids (for "View in Results"). */
  evidence: string[];
};

export const NEUTRAL_CAUTION: OutcomeCaution = {
  multiplier: 1,
  kind: "neutral",
  label: null,
  reason: null,
  confidence: "none",
  evidence: [],
};

/** Map a demand-graph Move gap onto the Results-linker family vocabulary so a Move
 *  and a proof row can be matched by the SAME conservative family logic. */
export function familyOfMoveGap(gap: GapKind | string): string {
  const s = String(gap ?? "").toLowerCase();
  if (s.includes("answer") || s.includes("schema") || s.includes("aeo") || s.includes("faq")) return "aeo";
  if (s.includes("internal") || s.includes("link") || s.includes("consolidat")) return "links";
  if (s.includes("experience") || s === "fix_ux" || s.includes("friction") || s.includes("cro")) return "cro";
  if (s.includes("create") || s.includes("hub") || s.includes("new_page")) return "new_page";
  if (s.includes("title") || s.includes("meta") || s.includes("ctr")) return "title_meta";
  return "edit"; // generic existing-page edit (edit_page) — bridges title/meta/etc.
}

function rowConfidence(c: string): OutcomeCaution["confidence"] {
  return c === "high" || c === "medium" || c === "low" ? c : "low";
}

/**
 * Resolve the page-specific caution for ONE Move from the proof rows on its own page.
 * Priority when several rows match: a settled LOSS (don't repeat) > a MEASURING hold
 * (don't muddy) > a settled WIN (do the follow-up). EXACT family beats the bridge. PURE.
 */
export function cautionForMove(
  move: { ownedUrl: string | null; gap: GapKind | string },
  rows: readonly ProofOutcomeRow[],
): OutcomeCaution {
  if (!move.ownedUrl) return NEUTRAL_CAUTION;
  const movePath = normPath(move.ownedUrl);
  if (!movePath) return NEUTRAL_CAUTION;
  const moveFam = familyOfMoveGap(move.gap);

  // Same-page rows whose family is compatible, with an exact-family flag for ranking.
  const matches = rows
    .filter((r) => r.operatorVerdictOverride !== "inconclusive")
    .filter((r) => normPath(r.page) === movePath)
    .map((r) => {
      const rowFam = familyOfLedgerAction(r.actionType);
      return { r, rowFam, compatible: familyCompatible(rowFam, moveFam), exact: rowFam === moveFam };
    })
    .filter((m) => m.compatible);
  if (matches.length === 0) return NEUTRAL_CAUTION;

  const pick = (pred: (v: (typeof matches)[number]) => boolean) =>
    matches.filter(pred).sort((a, b) => Number(b.exact) - Number(a.exact))[0];

  // 1) Settled loss on this page+family → demote (don't repeat a failed edit).
  const loss = pick((m) => m.r.verdict === "lost");
  if (loss) {
    return {
      multiplier: NO_LIFT_DEMOTE,
      kind: "no_lift",
      label: "Learning: similar edit showed no lift",
      reason: `A ${loss.rowFam.replace(/_/g, " ")} change shipped on this page didn't beat its controls — deprioritized so you don't repeat it.`,
      confidence: rowConfidence(loss.r.confidence),
      evidence: [loss.r.id],
    };
  }

  // 2) Still measuring on this page+family → slight hold (don't muddy the experiment).
  const measuring = pick((m) => m.r.verdict === "measuring");
  if (measuring) {
    return {
      multiplier: MEASURING_HOLD,
      kind: "held_measuring",
      label: "Learning: same edit still measuring",
      reason: "A change to this page is still being measured — held back so a second edit doesn't muddy the result.",
      confidence: "low",
      evidence: [measuring.r.id],
    };
  }

  // 3) Settled win on this page (verdict-ready + not low-confidence + real baseline) →
  //    modest boost for a FOLLOW-UP compatible move (the same page is responding).
  const win = pick((m) => m.r.verdict === "won" && m.r.confidence !== "low" && m.r.baselineImpressions >= MIN_WIN_BASELINE);
  if (win) {
    return {
      multiplier: SAME_PAGE_WIN_BOOST,
      kind: "lifted",
      label: "Learning: similar edit lifted",
      reason: `A ${win.rowFam.replace(/_/g, " ")} change on this page beat its controls — a follow-up here is worth prioritizing.`,
      confidence: rowConfidence(win.r.confidence),
      evidence: [win.r.id],
    };
  }

  // inconclusive / insufficient_data / low-confidence win / measuring-different-family.
  return NEUTRAL_CAUTION;
}

function clamp(n: number): number {
  return Math.max(CAUTION_MIN, Math.min(CAUTION_MAX, n));
}

/**
 * Apply the page-specific caution to a ranked Move list, OUTSIDE the pure scorer.
 * Multiplies each Move's score by its (clamped, bounded ±10%) caution, attaches
 * `outcomeCaution` for the UI, and re-sorts. With NO rows every multiplier is 1.0 →
 * order is byte-identical (zero behavior change until there's a shipped change). PURE.
 */
export function applyProofOutcomeCautionToMoves(
  moves: readonly MoveCandidate[],
  rows: readonly ProofOutcomeRow[],
): MoveCandidate[] {
  if (rows.length === 0) return moves.map((m) => ({ ...m, outcomeCaution: NEUTRAL_CAUTION }));
  const out = moves.map((m) => {
    const caution = cautionForMove({ ownedUrl: m.ownedUrl, gap: m.gap }, rows);
    if (caution.multiplier === 1) return { ...m, outcomeCaution: caution };
    return { ...m, score: Math.max(0, Math.round(m.score * clamp(caution.multiplier))), outcomeCaution: caution };
  });
  out.sort((a, b) => b.score - a.score);
  return out;
}
