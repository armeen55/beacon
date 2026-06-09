/**
 * 2026-05-26 Phase A.2 (Section 3.2 / Decision Lock E2/E3/E5) —
 * cross-tenant pattern AGGREGATION core (pure).
 *
 * The brain's actual learning logic: given cited shipped-edit outcomes
 * gathered ACROSS tenants, roll them up per `matchKey` into the
 * `CrossTenantPattern[]` the LLM evidence packet carries. This is the
 * pure compute half of the producer. The I/O half (enumerate tenants
 * via `listTenants()`, read each tenant's cited edits via the
 * `forTenant` repository, then call this) + the sync→async caller
 * change in `specific-edit-evidence.ts` is the SEPARATE coordinated
 * activation slice gated behind `BEACON_CROSS_TENANT_BRAIN=1` — this
 * module deliberately does NO I/O so it can be exhaustively tested
 * with synthetic multi-tenant fixtures and stays inert until wired.
 *
 * Locked contract (Section 3.2 + E-block):
 *   • EXCLUDE the requesting tenant's own records (E4 / contract: no
 *     tenant learns from its own data via this surface).
 *   • A record "helped" iff its first citation landed within the
 *     tenant's median-day window (E2 = "within median_days"). The
 *     PRODUCER decides `helped` per record (it owns the threshold
 *     policy); this module aggregates the boolean — keeping the
 *     compute pure + threshold-policy-agnostic.
 *   • `helpingRate` = helped / sampleSize, rounded to 2dp, 0..1.
 *   • `sampleSize` = shipped attempts aggregated for the matchKey.
 *   • Emit a pattern ONLY when `sampleSize >= minSampleSize`
 *     (default `BRAIN_SAMPLE_THRESHOLDS.llm_packet` = 5 per E3).
 *   • Cap the result at `cap` patterns (default 5 per E5), ranked by
 *     (helpingRate desc, sampleSize desc, matchKey asc) — deterministic.
 *   • Keep only patterns whose matchKey references one of the caller's
 *     `actionTypes` (the rec engine's emittable set).
 *   • Every emitted `description` is run through the E4 scrubber; a
 *     pattern whose description STILL contains a blocklisted term
 *     after scrubbing is DROPPED entirely (belt-and-suspenders — a
 *     leak must never reach the packet).
 *
 * Determinism: no Date, no Math.random, no I/O. Same inputs → same
 * output (input array is never mutated).
 */

import { BRAIN_SAMPLE_THRESHOLDS } from "./thresholds";
import {
  scrubPatternDescription,
  containsBlocklistedTerm,
} from "./privacy";
import type { CrossTenantPattern } from "../cross-tenant-brain";

/**
 * One cited shipped-edit outcome from some tenant, pre-classified by
 * the producer. `matchKey` is a closed-vocabulary token string (e.g.
 * "edit_type:add_h2_section|intent:cost_question"). `helped` is the
 * producer's verdict (cited within that tenant's median-day window).
 */
export type CrossTenantEditOutcome = {
  tenantId: string;
  matchKey: string;
  helped: boolean;
};

export type AggregateCrossTenantPatternsOpts = {
  /** The tenant requesting patterns — its records are excluded. */
  requestingTenantId: string;
  /** Emittable action types; a matchKey must reference one of these.
   *  Empty array = no filtering (keep all matchKeys). */
  actionTypes: ReadonlyArray<string>;
  /** Names/domains/aliases/competitors to scrub from descriptions
   *  (E4 scope). Assembled by the producer across all tenants. */
  blocklist: ReadonlyArray<string>;
  /** Minimum aggregated ships to emit a pattern. Defaults to the
   *  locked LLM-packet trust gate (5). */
  minSampleSize?: number;
  /** Max patterns to emit (E5 = 5). */
  cap?: number;
  /** Folded into patternId so a vocabulary bump yields fresh ids. */
  schemaVersion?: string;
};

/** djb2 → 8-hex-char. Deterministic, pure, dependency-free. Stable
 *  patternId per (matchKey, schemaVersion) so the LLM can cite a
 *  pattern by id without any tenant data leaking into the id. */
function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Decode a matchKey into a short human phrase for the operator-facing
 * description. Closed-vocab tokens only → never contains tenant data,
 * but the result is still scrubbed downstream as defense-in-depth.
 */
function describePattern(
  matchKey: string,
  helped: number,
  sampleSize: number,
): string {
  const editToken = matchKey
    .split("|")
    .find((t) => t.startsWith("edit_type:"));
  const action = editToken ? editToken.slice("edit_type:".length) : "this edit";
  const readableAction = action.replace(/_/g, " ");
  return `${helped} of ${sampleSize} tracked sites saw citations rise after ${readableAction}.`;
}

function matchKeyReferencesAction(
  matchKey: string,
  actionTypes: ReadonlyArray<string>,
): boolean {
  if (actionTypes.length === 0) return true;
  return actionTypes.some((a) => matchKey.includes(a));
}

/**
 * Pure aggregation. See module header for the locked contract.
 */
export function aggregateCrossTenantPatterns(
  records: ReadonlyArray<CrossTenantEditOutcome>,
  opts: AggregateCrossTenantPatternsOpts,
): CrossTenantPattern[] {
  const minSampleSize =
    opts.minSampleSize ?? BRAIN_SAMPLE_THRESHOLDS.llm_packet;
  const cap = opts.cap ?? 5;
  const schemaVersion = opts.schemaVersion ?? "v1";

  // 1. Exclude self + filter to referenced action types.
  const grouped = new Map<string, { helped: number; total: number }>();
  for (const r of records) {
    if (r.tenantId === opts.requestingTenantId) continue; // exclude-self
    if (!matchKeyReferencesAction(r.matchKey, opts.actionTypes)) continue;
    const g = grouped.get(r.matchKey) ?? { helped: 0, total: 0 };
    g.total += 1;
    if (r.helped) g.helped += 1;
    grouped.set(r.matchKey, g);
  }

  // 2. Build candidate patterns above the sample gate, with scrubbed
  //    + leak-checked descriptions.
  const out: CrossTenantPattern[] = [];
  for (const [matchKey, g] of grouped) {
    if (g.total < minSampleSize) continue; // sample-size gate (E3)
    const rawDescription = describePattern(matchKey, g.helped, g.total);
    const description = scrubPatternDescription(rawDescription, opts.blocklist);
    // Belt-and-suspenders: never emit a pattern whose description still
    // carries a blocklisted term after scrubbing.
    if (containsBlocklistedTerm(description, opts.blocklist)) continue;
    out.push({
      patternId: `ctp_${stableHash(`${matchKey}::${schemaVersion}`)}`,
      matchKey,
      sampleSize: g.total,
      helpingRate: round2(g.helped / g.total),
      description,
    });
  }

  // 3. Deterministic rank + cap (E5).
  out.sort(
    (a, b) =>
      b.helpingRate - a.helpingRate ||
      b.sampleSize - a.sampleSize ||
      (a.matchKey < b.matchKey ? -1 : a.matchKey > b.matchKey ? 1 : 0),
  );
  return out.slice(0, cap);
}
