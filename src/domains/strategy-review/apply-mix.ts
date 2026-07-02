/**
 * strategy-review/apply-mix (2026-07-02, BEACON 500 item 51) - PURE deterministic clamps
 * + application of a weekly strategy mix onto a scored candidate. Two responsibilities,
 * both pure, both unit-pinned:
 *
 *   - clampStrategyMix: the LLM PROPOSES a lever mix; this DISPOSES. Every weight is
 *     clamped to [MIN_WEIGHT, MAX_WEIGHT], any family not in the caller's known set is
 *     dropped (never silently applied to something nobody asked for), and every string is
 *     dash-stripped. This is the one place the "LLM proposes, deterministic clamps
 *     dispose" rule is enforced for this feature - callers should never apply a raw LLM
 *     leverMix directly.
 *   - applyStrategyMix: multiplies a candidate's score by its family's clamped weight
 *     (1.0 = neutral = identical to no mix at all). Absent mix / absent family entry /
 *     unknown family all resolve to the SAME neutral 1.0 - the identity-when-absent
 *     guarantee that makes rollout (and a fail-open week) risk-free.
 *
 * No I/O. Pinned by apply-mix.test.ts.
 */

export const MIN_WEIGHT = 0.5;
export const MAX_WEIGHT = 2.0;

export type StrategyLeverWeightInput = { family: string; weight: number; reason: string };

/** A clamped, trustworthy lever mix - the ONLY shape apply-mix and the daily builder
 *  ever consume. Keyed by family for O(1) lookup. */
export type ClampedStrategyMix = Map<string, { weight: number; reason: string }>;

function stripDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, " - ").trim();
}

function clampWeight(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, n));
}

/**
 * DETERMINISTIC CLAMPS: the LLM proposes, this disposes. Drops any family not present
 * in `knownFamilies` (case-insensitive match; an unrecognized family the model invented
 * never silently rides into the plan), clamps every remaining weight to
 * [MIN_WEIGHT, MAX_WEIGHT], and dash-strips every reason string. Duplicate families in
 * the input keep only the FIRST occurrence (stable, deterministic). PURE.
 */
export function clampStrategyMix(
  proposed: readonly StrategyLeverWeightInput[],
  knownFamilies: ReadonlySet<string>,
): ClampedStrategyMix {
  const known = new Set([...knownFamilies].map((f) => f.toLowerCase()));
  const out: ClampedStrategyMix = new Map();
  for (const p of proposed) {
    const family = (p.family ?? "").toLowerCase().trim();
    if (!family || !known.has(family) || out.has(family)) continue;
    out.set(family, { weight: clampWeight(p.weight), reason: stripDashes(p.reason ?? "") });
  }
  return out;
}

export type FocusFamilyInput = { family: string; reason: string };
export type ClampedFocusFamily = { family: string; reason: string };

/** Same disposal rule for focus families: drop unknown families, dash-strip the reason,
 *  cap at 3 (the spec's "up to 3 page-family focus targets"), keep first-seen order. */
export function clampFocusFamilies(
  proposed: readonly FocusFamilyInput[],
  knownFamilies: ReadonlySet<string>,
): ClampedFocusFamily[] {
  const known = new Set([...knownFamilies].map((f) => f.toLowerCase()));
  const seen = new Set<string>();
  const out: ClampedFocusFamily[] = [];
  for (const p of proposed) {
    const family = (p.family ?? "").toLowerCase().trim();
    if (!family || !known.has(family) || seen.has(family)) continue;
    seen.add(family);
    out.push({ family, reason: stripDashes(p.reason ?? "") });
    if (out.length >= 3) break;
  }
  return out;
}

/** Minimal shape applyStrategyMix needs from a scored candidate - a real
 *  PlannedExperiment/BuiltCandidate satisfies this without importing the
 *  experiments domain here (keeps this file dependency-free and pure). */
export type MixableCandidate = { actionFamily: string; score: number };

export type StrategyMixTag = { family: string; weight: number; reason: string };

/**
 * Multiply `score` by the candidate's family weight from a CLAMPED mix. Absent mix,
 * absent family entry, or a neutral 1.0 weight all leave `score` byte-identical and
 * `mixTag` absent - the identity-when-absent guarantee. Returns a NEW object (never
 * mutates the input), matching applyExperimentPriorToMoves's pattern in
 * experiment-prior.ts. PURE.
 */
export function applyStrategyMix<T extends MixableCandidate>(
  candidates: readonly T[],
  mix: ClampedStrategyMix | null | undefined,
): Array<T & { mixTag?: StrategyMixTag }> {
  if (!mix || mix.size === 0) return candidates.map((c) => ({ ...c }));
  return candidates.map((c) => {
    const hit = mix.get((c.actionFamily ?? "").toLowerCase());
    // Absent family entry OR a neutral 1.0 weight: byte-identical to no mix at all - no
    // tag either, since "this week's plan leans into..." is only true for a REAL lean.
    if (!hit || hit.weight === 1) return { ...c };
    return {
      ...c,
      score: c.score * hit.weight,
      mixTag: { family: c.actionFamily, weight: hit.weight, reason: hit.reason },
    };
  });
}
