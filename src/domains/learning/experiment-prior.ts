/**
 * experiment-prior (2026-06-25, Sprint 3 / P11) — the LEARNING half of the loop:
 * turn SETTLED move outcomes (from the proof ledger) into a bounded, explainable
 * multiplier that gently re-ranks future Moves toward what has actually WON.
 *
 * Design guarantees (the operator's hard rules):
 *  - INFLUENCE, NOT DOMINATE: the multiplier is clamped to [0.85, 1.15] (±15%).
 *    A learned prior tilts ties; it can never vault a low-demand Move over a
 *    high-demand one. The raw R&R MoveComponents (the lie detector) are NEVER
 *    touched — only the final sort key is multiplied, OUTSIDE the pure scorer.
 *  - NO FAKE LEARNING: only DECIDED outcomes (won/lost) count; measuring /
 *    inconclusive / insufficient_data / operator-excluded are ignored. A
 *    dimension needs ≥ MIN_DECIDED settled outcomes before it earns a prior —
 *    below that it stays neutral (1.0). One early result can never bias the
 *    system (1 < MIN_DECIDED → neutral).
 *  - MULTI-DIMENSIONAL + BACKOFF: priors are computed per (actionType, pageType,
 *    queryCluster); a Move resolves to the MOST SPECIFIC dimension that is
 *    proven, else backs off to a coarser one, else neutral. This learns
 *    "answer-blocks on flag pages win" without fragmenting into n<3 cells.
 *  - DETERMINISTIC + EXPLAINABLE: same ledger → same multipliers; every prior
 *    carries the dimension + win/loss counts that earned it (the "Beacon learned"
 *    tag). Recomputed from the ledger every run → fully reversible.
 *
 * PURE / deterministic / no I/O. Pinned by experiment-prior.test.ts.
 */

import type { MoveCandidate } from "@/domains/demand-graph/build-graph";

/** Minimum DECIDED (won+lost) outcomes in a dimension bucket before its win-rate
 *  is trusted enough to move ranking. Below this → neutral (no prior). */
export const MIN_DECIDED = 3;
/** Bounded multiplier band — learning tilts ties, never dominates. */
export const MIN_MULTIPLIER = 0.85;
export const MAX_MULTIPLIER = 1.15;
/** Slope from win-rate to multiplier before clamping. */
const SENSITIVITY = 0.5;

/** Dimensions a prior can be keyed by, MOST specific first (the backoff order). */
export const PRIOR_DIMENSIONS = ["queryCluster", "pageType", "actionType"] as const;
export type PriorDimension = (typeof PRIOR_DIMENSIONS)[number];

/** A settled (or in-flight) outcome from the proof ledger, reduced to what the
 *  prior needs. `dims` carries the dimension values for THIS outcome. */
export type SettledOutcome = {
  verdict: string; // won | lost | inconclusive | measuring | insufficient_data
  /** Operator pinned this out of learning (mis-attribution) — excluded. */
  operatorVerdictOverride?: string | null;
  dims: Partial<Record<PriorDimension, string>>;
};

export type DimPrior = {
  /** `${dimension}:${value}` */
  key: string;
  dimension: PriorDimension;
  value: string;
  won: number;
  lost: number;
  decided: number;
  /** 0..1 */
  winRate: number;
  /** clamped [MIN_MULTIPLIER, MAX_MULTIPLIER] */
  multiplier: number;
};

/** The resolved prior applied to one Move (attached for the UI + explainability). */
export type LearnedPrior = {
  multiplier: number;
  decidedSample: number;
  /** The dimension+value that earned it (e.g. "actionType:add_answer_block"). */
  basis: string | null;
  /** Operator-friendly one-liner, or null when neutral (no evidence). */
  tag: string | null;
};

const NEUTRAL: LearnedPrior = { multiplier: 1, decidedSample: 0, basis: null, tag: null };

// ── dimension derivation (pure) — used to map BOTH proof-ledger outcomes AND
//    live Moves into the SAME dimension space, so a prior matches a Move. ──

/** Collapse a rec action_type (add_answer_block, edit_title…) OR a graph gap
 *  (answer_block, edit_page…) onto one shared move-type bucket. */
export function canonicalMoveType(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().trim();
  if (!s) return "other";
  if (s.includes("answer_block") || s.includes("answer")) return "answer_block";
  if (s === "create_page" || s.includes("create")) return "create_page";
  if (s.includes("fix_page_experience") || s.includes("experience") || s === "fix_ux") return "fix_experience";
  if (s.includes("title") || s.includes("meta") || s === "edit_page" || s.includes("h1") || s.includes("edit")) return "edit_page";
  if (s.includes("schema")) return "add_schema";
  if (s.includes("internal_link") || s.includes("link")) return "internal_links";
  return s;
}

/** Coarse page type = the first path segment (e.g. "/iran-flags/x" → "iran-flags").
 *  Tenant-agnostic; honest empty → null when no path. */
export function pageTypeFromUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  let path = url;
  try {
    path = new URL(url.startsWith("http") ? url : `https://${url}`).pathname;
  } catch {
    /* use raw */
  }
  const seg = path.split("/").filter(Boolean)[0];
  return seg ? seg.toLowerCase() : undefined;
}

/** Normalize a query/label into a stable cluster key (lowercased, collapsed). */
export function queryClusterKey(query: string | null | undefined): string | undefined {
  const k = (query ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return k.length >= 3 ? k : undefined;
}

function clampMult(n: number): number {
  return Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, n));
}

function isDecidedWin(o: SettledOutcome): boolean {
  return o.operatorVerdictOverride !== "inconclusive" && o.verdict === "won";
}
function isDecidedLoss(o: SettledOutcome): boolean {
  return o.operatorVerdictOverride !== "inconclusive" && o.verdict === "lost";
}

/**
 * Build the per-dimension prior table from the proof ledger. PURE. Only buckets
 * with ≥ MIN_DECIDED settled (won+lost) outcomes appear (others stay neutral by
 * absence). Returns a Map keyed `${dimension}:${value}`.
 */
export function computeDimPriors(outcomes: readonly SettledOutcome[]): Map<string, DimPrior> {
  const won = new Map<string, number>();
  const lost = new Map<string, number>();
  for (const o of outcomes) {
    const w = isDecidedWin(o);
    const l = isDecidedLoss(o);
    if (!w && !l) continue;
    for (const dim of PRIOR_DIMENSIONS) {
      const v = o.dims[dim];
      if (!v) continue;
      const key = `${dim}:${v}`;
      if (w) won.set(key, (won.get(key) ?? 0) + 1);
      else lost.set(key, (lost.get(key) ?? 0) + 1);
    }
  }
  const out = new Map<string, DimPrior>();
  for (const key of new Set([...won.keys(), ...lost.keys()])) {
    const w = won.get(key) ?? 0;
    const l = lost.get(key) ?? 0;
    const decided = w + l;
    if (decided < MIN_DECIDED) continue; // thin sample → neutral (omitted)
    const winRate = w / decided;
    const [dimension, ...rest] = key.split(":");
    out.set(key, {
      key,
      dimension: dimension as PriorDimension,
      value: rest.join(":"),
      won: w,
      lost: l,
      decided,
      winRate,
      multiplier: clampMult(1 + (winRate - 0.5) * SENSITIVITY),
    });
  }
  return out;
}

function tagFor(p: DimPrior): string {
  const label = p.value.replace(/[_-]+/g, " ");
  const dimLabel =
    p.dimension === "actionType" ? "moves like this" : p.dimension === "pageType" ? `${label} pages` : `"${label}"`;
  if (p.winRate >= 0.6) return `Similar ${dimLabel} won ${p.won} of ${p.decided} — ranked higher`;
  if (p.winRate <= 0.4) return `Similar ${dimLabel} underperformed (${p.won}/${p.decided}) — ranked lower`;
  return `Mixed results on ${dimLabel} (${p.won}/${p.decided})`;
}

/**
 * Resolve the prior for ONE Move's dimensions using the backoff ladder: the most
 * SPECIFIC dimension (queryCluster → pageType → actionType) that has a proven
 * bucket wins; otherwise neutral. PURE.
 */
export function resolvePrior(
  dims: Partial<Record<PriorDimension, string>>,
  table: Map<string, DimPrior>,
): LearnedPrior {
  for (const dim of PRIOR_DIMENSIONS) {
    const v = dims[dim];
    if (!v) continue;
    const hit = table.get(`${dim}:${v}`);
    if (hit) {
      return { multiplier: hit.multiplier, decidedSample: hit.decided, basis: hit.key, tag: tagFor(hit) };
    }
  }
  return NEUTRAL;
}

/**
 * Apply the learned prior to a ranked Move list, OUTSIDE the pure scorer. PURE.
 * Multiplies each Move's final `score` by its resolved (bounded) prior, attaches
 * `learnedPrior` for the UI, and re-sorts. Raw `components` are left untouched.
 * With NO decided outcomes the table is empty → every multiplier is 1.0 → the
 * order is byte-identical to the input (zero behavior change until there's
 * evidence — the safest possible rollout).
 */
export function applyExperimentPriorToMoves(
  moves: readonly MoveCandidate[],
  outcomes: readonly SettledOutcome[],
  resolveDims: (m: MoveCandidate) => Partial<Record<PriorDimension, string>>,
): MoveCandidate[] {
  const table = computeDimPriors(outcomes);
  const out = moves.map((m) => {
    const prior = resolvePrior(resolveDims(m), table);
    if (prior.multiplier === 1) return { ...m, learnedPrior: prior };
    return {
      ...m,
      score: Math.max(0, Math.round(m.score * prior.multiplier)),
      learnedPrior: prior,
    };
  });
  out.sort((a, b) => b.score - a.score);
  return out;
}
