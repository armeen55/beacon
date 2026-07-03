/**
 * dismissal-learning (R23 P15, 2026-07-03) - the LEARN-FROM-SKIPS half of the
 * visible learning loop. Two pure, deterministic, decided-only jobs, both applied
 * OUTSIDE the pure demand-graph scorer (in load-graph.ts), never touching raw
 * MoveComponents:
 *
 *  1. DO-NOT-REPEAT: never re-suggest an EXACT thing the operator already
 *     rejected, or that is already shipped/live. Keyed on the same coarse
 *     (moveType × page) key the cooldown + dismissal stores use, so a card the
 *     operator killed on a page stays gone and a change already live never
 *     reappears as a fresh suggestion. A Move whose key is in the registry is
 *     removed from the list (not merely demoted) - the honest "I've dealt with
 *     that" state.
 *
 *  2. KIND DEMOTION: when the operator repeatedly SKIPS a KIND of move (e.g.
 *     they keep dismissing schema fixes), gently deprioritize that whole kind so
 *     the worklist stops leading with the thing they never do. Bounded, keyed on
 *     the move KIND (not one page), and - like every learner in this domain -
 *     DECIDED-ONLY: a kind needs >= MIN_DISMISSALS_TO_DEMOTE observed dismissals
 *     before it moves anything. Below that it is neutral (multiplier 1.0).
 *
 * ZERO-RISK CONTRACT (pinned): with no dismissals and no shipped/rejected keys,
 * BOTH functions are byte-identical no-ops - every Move survives, every score is
 * unchanged, the order is the input order. A fresh tenant learns nothing until it
 * has actually skipped or shipped something. Never overfits: one skip can never
 * demote a kind (1 < MIN_DISMISSALS_TO_DEMOTE), and the demotion is clamped so it
 * only ever breaks ties, never vaults a low-demand Move over a high-demand one.
 *
 * PURE / deterministic / no I/O. Pinned by dismissal-learning.test.ts. The store
 * reads (opportunity_dismissals, proof ledger, recommendation responses) happen
 * at the load-graph edge and are handed in as plain rows.
 */

import type { MoveCandidate } from "@/domains/demand-graph/build-graph";
import { canonicalMoveType } from "./experiment-prior";

/** A kind needs at least this many observed dismissals before its whole-kind
 *  demotion fires. Below this → neutral (one skip is not a pattern). */
export const MIN_DISMISSALS_TO_DEMOTE = 3;

/** Bounded demotion band. A repeatedly-skipped kind is nudged DOWN only, and
 *  never below this floor, so it tilts ties without ever dominating demand/$. */
export const MIN_DEMOTION_MULTIPLIER = 0.8;
/** Slope from "share of this kind's rows that were dismissed" to the demotion. */
const DEMOTION_SENSITIVITY = 0.4;

// ---------------------------------------------------------------------------
// Shared key: the same coarse (moveType × page) identity the cooldown +
// dismissal stores partition on, so do-not-repeat matches a rejected card, a
// shipped change, and a live-Move to the SAME bucket. Canonicalized so an
// engine gap ("answer_block") and a rec action_type ("add_answer_block") that
// mean the same move collapse together (reuses experiment-prior's canonicalizer).
// ---------------------------------------------------------------------------

/** Host-stripped, trailing-slash-stripped, query-stripped, lowercased path.
 *  Matches how the dismissal + shipped stores normalize a page URL. */
export function normalizePageKey(url: string | null | undefined): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  let path: string;
  if (raw.startsWith("/")) {
    // Already a path (e.g. "/flags" from an opp key) - do NOT prepend a scheme,
    // which would turn the first segment into a hostname (https:///flags).
    path = raw;
  } else {
    try {
      path = new URL(raw.startsWith("http") ? raw : `https://${raw}`).pathname;
    } catch {
      path = raw;
    }
  }
  return path.split("?")[0]!.replace(/\/+$/, "").toLowerCase() || "/";
}

/** The do-not-repeat / demotion identity for a move: `moveType|page`. */
export function moveRepeatKey(moveType: string, url: string | null | undefined): string {
  return `${canonicalMoveType(moveType)}|${normalizePageKey(url)}`;
}

/** One already-decided thing the operator will not want re-suggested: a card they
 *  rejected, or a change that is already shipped/live. Reduced to what the
 *  registry needs. */
export type DecidedMoveRef = {
  /** Raw action_type / gap (canonicalized internally). */
  moveType: string;
  /** The page it targeted (null for a site-wide / no-page move). */
  page: string | null;
  /** Why it is in the registry (for the honest one-liner / audit; not matched on). */
  reason: "rejected" | "shipped";
};

/** One observed dismissal, reduced to the move KIND the operator skipped. The
 *  page is not needed for the KIND demotion (that is do-not-repeat's job). */
export type DismissalObservation = {
  moveType: string;
};

// ---------------------------------------------------------------------------
// 1. DO-NOT-REPEAT registry
// ---------------------------------------------------------------------------

/**
 * Build the set of (moveType|page) keys that must never be re-suggested. PURE.
 * Empty input → empty set → the suppressor below is a byte-identical no-op.
 */
export function buildDoNotRepeatRegistry(refs: readonly DecidedMoveRef[]): Set<string> {
  const out = new Set<string>();
  for (const r of refs) {
    if (!r.moveType) continue;
    out.add(moveRepeatKey(r.moveType, r.page));
  }
  return out;
}

/** The result of a suppression pass: the surviving moves + what was removed
 *  (for the honest log / count; never silent). */
export type SuppressionResult = {
  moves: MoveCandidate[];
  suppressed: { key: string; label: string }[];
};

/**
 * Remove every Move whose (moveType × page) key is already in the do-not-repeat
 * registry (rejected or shipped). PURE. Order of survivors is preserved. An empty
 * registry returns the SAME array reference (===) so a fresh tenant is provably a
 * no-op (byte-identical). Raw components are never touched.
 */
export function suppressDoNotRepeat(
  moves: readonly MoveCandidate[],
  registry: ReadonlySet<string>,
): SuppressionResult {
  if (registry.size === 0) return { moves: moves as MoveCandidate[], suppressed: [] };
  const kept: MoveCandidate[] = [];
  const suppressed: { key: string; label: string }[] = [];
  for (const m of moves) {
    const key = moveRepeatKey(m.gap, m.ownedUrl);
    if (registry.has(key)) suppressed.push({ key, label: m.label });
    else kept.push(m);
  }
  // Nothing actually matched → hand back the original reference (still a no-op).
  if (suppressed.length === 0) return { moves: moves as MoveCandidate[], suppressed: [] };
  return { moves: kept, suppressed };
}

// ---------------------------------------------------------------------------
// 2. KIND demotion from repeated skips
// ---------------------------------------------------------------------------

export type KindDemotion = {
  /** Canonical move kind, e.g. "add_schema". */
  kind: string;
  dismissals: number;
  /** How many live Moves of this kind are on the board right now (the base the
   *  dismissal share is taken against). */
  present: number;
  /** clamped [MIN_DEMOTION_MULTIPLIER, 1.0] */
  multiplier: number;
};

function clampDemotion(n: number): number {
  return Math.max(MIN_DEMOTION_MULTIPLIER, Math.min(1, n));
}

/**
 * Compute a per-KIND demotion from observed dismissals. PURE. A kind earns a
 * demotion only when it has >= MIN_DISMISSALS_TO_DEMOTE observed dismissals AND
 * at least one live Move of that kind (nothing to demote otherwise). The tilt
 * scales with how heavily that kind has been skipped relative to how many of it
 * are on the board - a kind the operator dismisses far more than they act on is
 * pushed down harder, but always within the bounded band. Kinds below the
 * threshold are omitted (neutral by absence). Returns a Map<kind, KindDemotion>.
 */
export function computeKindDemotions(
  dismissals: readonly DismissalObservation[],
  moves: readonly MoveCandidate[],
): Map<string, KindDemotion> {
  const dismissedByKind = new Map<string, number>();
  for (const d of dismissals) {
    const kind = canonicalMoveType(d.moveType);
    if (!kind) continue;
    dismissedByKind.set(kind, (dismissedByKind.get(kind) ?? 0) + 1);
  }
  const presentByKind = new Map<string, number>();
  for (const m of moves) {
    const kind = canonicalMoveType(m.gap);
    presentByKind.set(kind, (presentByKind.get(kind) ?? 0) + 1);
  }
  const out = new Map<string, KindDemotion>();
  for (const [kind, dismissed] of dismissedByKind) {
    if (dismissed < MIN_DISMISSALS_TO_DEMOTE) continue; // one/two skips is not a pattern
    const present = presentByKind.get(kind) ?? 0;
    if (present === 0) continue; // nothing of this kind to demote right now
    // Dismissal weight relative to current presence, capped at 1 so a huge skip
    // history can't blow past the bounded band.
    const skewed = Math.min(1, dismissed / (dismissed + present));
    const multiplier = clampDemotion(1 - skewed * DEMOTION_SENSITIVITY);
    out.set(kind, { kind, dismissals: dismissed, present, multiplier });
  }
  return out;
}

/**
 * Apply the kind demotions to a ranked Move list, OUTSIDE the pure scorer. PURE.
 * Multiplies each Move's final `score` by its kind's (bounded, <=1) demotion and
 * re-sorts. With NO qualifying kind the table is empty → every multiplier is 1.0
 * → the SAME array reference is returned (byte-identical order; provable no-op on
 * a fresh tenant). Raw `components` are left untouched.
 */
export function applyKindDemotionsToMoves(
  moves: readonly MoveCandidate[],
  demotions: ReadonlyMap<string, KindDemotion>,
): MoveCandidate[] {
  if (demotions.size === 0) return moves as MoveCandidate[];
  let changed = false;
  const out = moves.map((m) => {
    const d = demotions.get(canonicalMoveType(m.gap));
    if (!d || d.multiplier === 1) return m;
    changed = true;
    return { ...m, score: Math.max(0, Math.round(m.score * d.multiplier)) };
  });
  if (!changed) return moves as MoveCandidate[];
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Convenience one-pass used by load-graph: suppress do-not-repeat keys, then
 * demote heavily-skipped kinds. PURE. Both steps are individually no-ops on empty
 * inputs, so an undecided tenant gets the input moves back unchanged.
 */
export function applyDismissalLearning(
  moves: readonly MoveCandidate[],
  args: {
    doNotRepeat: readonly DecidedMoveRef[];
    dismissals: readonly DismissalObservation[];
  },
): { moves: MoveCandidate[]; suppressed: { key: string; label: string }[]; demotions: KindDemotion[] } {
  const registry = buildDoNotRepeatRegistry(args.doNotRepeat);
  const { moves: afterSuppress, suppressed } = suppressDoNotRepeat(moves, registry);
  const demotionTable = computeKindDemotions(args.dismissals, afterSuppress);
  const afterDemote = applyKindDemotionsToMoves(afterSuppress, demotionTable);
  return { moves: afterDemote, suppressed, demotions: [...demotionTable.values()] };
}
