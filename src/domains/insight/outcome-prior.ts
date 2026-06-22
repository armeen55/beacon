/**
 * Outcome priors — the Learning Loop's read side.
 *
 * Beacon already MEASURES which shipped changes worked: the GSC diff-in-diff
 * proof engine lands a per-URL verdict (helping / hurting / nothing_yet), and
 * `learning/change-patterns.ts` aggregates those verdicts into UrlChangePattern
 * buckets keyed by (edit_type_token × asset_type). But that brain was passive —
 * its own header reads "stored only, not consumed by UI or recommendations."
 * Every recommendation was recomputed from first principles, blind to which
 * levers the operator had already PROVEN work on this exact site.
 *
 * This module turns those proven outcomes into a bounded PRIOR that ranking can
 * consume: per lever×asset, a multiplier in [0.8, 1.3] plus a plain-English tag
 * ("Based on your results: title fixes landed on 5 of 6 city pages like this").
 * Shipping a change that wins nudges that lever UP for the next page; a change
 * that regresses nudges it DOWN. Each shipped result compounds into intelligence.
 *
 * STATUS: this is the pure read-side CORE only (slice 1). It is NOT yet wired
 * into the ranking pipeline (priority-score.ts / opportunity.ts) — that is
 * slices 2-4, deferred until the live experiments land verdicts (~late June).
 * Until then these priors steer nothing; the "compounding loop" above describes
 * the intended wiring, not current behaviour.
 *
 * Honesty contract (why this can't make Beacon wrong):
 *   • PURE — no I/O, fully unit-tested; consumers pass patterns in.
 *   • ADDITIVE — a multiplier, never a hard filter; it re-ranks, never invents
 *     or suppresses a recommendation.
 *   • DECIDED-ONLY — the prior is computed from landed verdicts (helping +
 *     hurting). A change that hasn't landed yet (nothing_yet) is NOT counted as
 *     a failure, so an in-flight experiment can't drag a lever down.
 *   • NEVER PENALIZES THE UNPROVEN — below MIN_DECIDED_SAMPLE the multiplier is
 *     pinned to 1.0 (neutral). A brand-new lever competes on its own merits;
 *     only a lever with real, landed evidence moves off neutral.
 *   • CLAMPED — multiplier is hard-bounded to [0.8, 1.3] so learning tilts the
 *     order, it can never dominate the underlying opportunity math.
 */

import type { EditToken } from "@/domains/changelog/dedupe";
import type { AssetType } from "@/lib/constants";
import { ASSET_TYPE_LABELS } from "@/lib/constants";
import type { UrlChangePattern } from "@/domains/learning/change-patterns";

/** Landed verdicts needed before a lever's prior moves off neutral (1.0). */
export const MIN_DECIDED_SAMPLE = 3;

/** Multiplier bounds — learning tilts ranking, it never dominates it. */
export const PRIOR_MULTIPLIER_MIN = 0.8;
export const PRIOR_MULTIPLIER_MAX = 1.3;

/** How hard a 0%→100% swing in success rate moves the multiplier (±0.3). */
const PRIOR_SENSITIVITY = 0.6;

export type OutcomePrior = {
  /** `${edit_type_token}::${asset_type}` — matches UrlChangePattern.id. */
  leverKey: string;
  token: EditToken;
  assetType: AssetType;
  /** Landed verdicts (helping + hurting); the evidence the prior rests on. */
  decidedSample: number;
  helpingCount: number;
  /** helping / decided, 0..1 (null-safe: 0 when nothing decided). */
  successRate: number;
  /** Bounded ranking multiplier in [0.8, 1.3]; 1.0 = neutral/unproven. */
  multiplier: number;
  /** Median days for a winning change of this kind to show in Search. */
  medianLandingDays: number | null;
  /** Trust in the prior, from the DECIDED sample (not total). */
  confidence: "high" | "medium" | "low";
  /** True once decidedSample >= MIN_DECIDED_SAMPLE (the prior left neutral). */
  proven: boolean;
  /** Plain-English track record; "" when not proven (render nothing). */
  tag: string;
};

const EDIT_TOKEN_LABELS: Record<EditToken, string> = {
  page_created: "new pages",
  page_removed: "page removals",
  title_change: "title fixes",
  meta_description: "meta description fixes",
  h1_change: "headline fixes",
  faq_added: "added Q&A",
  schema_added: "structured-data additions",
  canonical_change: "canonical fixes",
  hero_change: "hero updates",
  section_added: "added sections",
  internal_links: "internal linking",
  images_added: "image additions",
  sitemap_robots: "sitemap/robots fixes",
  navigation_change: "navigation changes",
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function assetLabel(asset: AssetType): string {
  // Lower-case the human label for mid-sentence use ("city page").
  return (ASSET_TYPE_LABELS[asset] ?? asset).toLowerCase();
}

/**
 * Plain-English track record for a proven lever. Mirrors the operator's own
 * question: "did my <lever> changes land on pages like this?" The numbers tell
 * the truth for winners AND losers (1 of 5 reads as honestly as 5 of 6).
 */
function buildTag(
  token: EditToken,
  asset: AssetType,
  helping: number,
  decided: number,
  nothingYet: number,
  medianLandingDays: number | null,
): string {
  const lever = EDIT_TOKEN_LABELS[token] ?? token;
  const pages = decided === 1 ? "page" : "pages";
  // "all N" counts only SETTLED (helping+hurting) pages — say "settled" so it
  // never reads as the full shipped set when changes are still in flight.
  const landed =
    helping === decided
      ? `landed on all ${decided} settled`
      : `landed on ${helping} of ${decided} settled`;
  const stillMeasuring = nothingYet > 0 ? ` (${nothingYet} still measuring)` : "";
  const timing =
    medianLandingDays != null ? ` (~${medianLandingDays} days to show)` : "";
  return `Based on your results: ${lever} ${landed} ${assetLabel(asset)} ${pages} like this${stillMeasuring}${timing}.`;
}

/**
 * Transform one aggregated pattern into a bounded prior. Pure. The multiplier
 * stays at neutral 1.0 until the lever has MIN_DECIDED_SAMPLE landed verdicts,
 * so unproven levers are never penalized and in-flight (nothing_yet) changes
 * never count against a lever.
 */
export function priorFromPattern(p: UrlChangePattern): OutcomePrior {
  const decided = p.helping_count + p.hurting_count;
  const successRate = decided > 0 ? p.helping_count / decided : 0;
  const proven = decided >= MIN_DECIDED_SAMPLE;

  const multiplier = proven
    ? clamp(
        1 + (successRate - 0.5) * PRIOR_SENSITIVITY,
        PRIOR_MULTIPLIER_MIN,
        PRIOR_MULTIPLIER_MAX,
      )
    : 1.0;

  const confidence: OutcomePrior["confidence"] =
    decided >= 5 ? "high" : decided >= MIN_DECIDED_SAMPLE ? "medium" : "low";

  return {
    leverKey: p.id,
    token: p.edit_type_token,
    assetType: p.asset_type,
    decidedSample: decided,
    helpingCount: p.helping_count,
    successRate: Math.round(successRate * 100) / 100,
    multiplier: Math.round(multiplier * 1000) / 1000,
    medianLandingDays: p.median_landing_day,
    confidence,
    proven,
    tag: proven
      ? buildTag(
          p.edit_type_token,
          p.asset_type,
          p.helping_count,
          decided,
          p.nothing_yet_count,
          p.median_landing_day,
        )
      : "",
  };
}

/**
 * Build the full prior table from the aggregated patterns, keyed by leverKey
 * (`${token}::${asset_type}`). One entry per pattern — including unproven ones
 * (multiplier 1.0) so a consumer can tell "lever exists but not enough landed
 * evidence yet" from "lever never tried."
 */
export function buildOutcomePriors(
  patterns: UrlChangePattern[],
): Map<string, OutcomePrior> {
  const out = new Map<string, OutcomePrior>();
  for (const p of patterns) out.set(p.id, priorFromPattern(p));
  return out;
}

/**
 * The lookup ranking consumers use: given the edit tokens a recommendation maps
 * to + the page's asset type, return the best-evidenced matching prior, or null
 * when no pattern matches. "Best" = the most DECIDED evidence (then the stronger
 * multiplier) — a prior should rest on the lever with the most landed proof,
 * which is why this selects on decided sample rather than total sample.
 */
export function outcomePriorFor(
  editTypeTokens: readonly EditToken[],
  assetType: AssetType,
  patterns: UrlChangePattern[],
): OutcomePrior | null {
  if (editTypeTokens.length === 0) return null;
  const matches = patterns.filter(
    (p) => p.asset_type === assetType && editTypeTokens.includes(p.edit_type_token),
  );
  if (matches.length === 0) return null;

  const priors = matches.map(priorFromPattern);
  // Selection order: a PROVEN lever beats an unproven one; among proven levers
  // the stronger directional tilt (distance from neutral 1.0) wins — so a
  // strongly-proven lever is never masked by a higher-volume but neutral (50/50)
  // bucket; then more landed evidence breaks remaining ties.
  priors.sort((a, b) => {
    if (a.proven !== b.proven) return a.proven ? -1 : 1;
    if (a.proven && b.proven) {
      const da = Math.abs(a.multiplier - 1);
      const db = Math.abs(b.multiplier - 1);
      if (da !== db) return db - da;
    }
    if (a.decidedSample !== b.decidedSample) return b.decidedSample - a.decidedSample;
    return b.multiplier - a.multiplier;
  });
  return priors[0]!;
}
