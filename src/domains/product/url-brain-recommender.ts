/**
 * URL brain recommender — Today action cards powered by the G3/G4 learning loop.
 *
 * Reads ONLY these three sources (no legacy dependencies):
 *   - `.data/url-change-patterns.json`    — edit_type × asset_type buckets
 *   - `.data/url-change-outcomes.json`    — per (change, URL) landed outcomes
 *   - citation-evidence-index (per-URL owned-citation totals)
 *
 * Produces a small ranked list of `BrainAction`s. Today renders the first as
 * the primary card; 2–3 secondary cards follow.
 *
 * If the brain has zero `helping` outcomes to date (typical for new workspaces
 * or before any change has landed), all actions are explicitly labelled
 * "Exploratory — no proven wins yet." No fabricated confidence.
 *
 * This module does NOT touch the legacy `recommendation-engine.ts`. The legacy
 * engine continues to feed Pages / Review / other surfaces. Today's action
 * card slot is the ONLY consumer that migrates tonight.
 */

import "server-only";

import type { UrlChangePattern } from "@/domains/learning/change-patterns";
import type { UrlChangeOutcome } from "@/domains/attribution/url-change-outcome";
import type { ChangelogEntry } from "@/domains/changelog/types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BrainActionKind =
  | "replicate_winner" // Apply a proven pattern to a page that hasn't tried it
  | "reverse_hurter" // Investigate / revert a pattern that's causing drops
  | "start_experiment" // High-citation page with no active experiment
  | "exploratory"; // Fallback when no helping data exists yet

export type BrainAction = {
  id: string;
  kind: BrainActionKind;
  rank: number; // 1 = primary, 2+ = secondary

  /** Short action headline for the card. */
  headline: string;

  /** 1–2 sentence rationale citing the data source. */
  rationale: string;

  /** Plain-English expected outcome. */
  expectedOutcome: string;

  /** Confidence backed by pattern sample count + success rate. */
  confidence: "high" | "medium" | "low" | "exploratory";

  /** Primary URL the action targets (path form, e.g. "/services/foo"). Null for global. */
  targetUrl: string | null;

  /** Pattern ID if this action references a bucket. Null for non-pattern actions. */
  patternId: string | null;

  /** Fully-qualified data citations so the "why" panel can be defensible. */
  dataCitations: {
    patternSampleCount?: number;
    patternHelpingCount?: number;
    patternHurtingCount?: number;
    urlCitationCount?: number;
    outcomeIds?: string[];
  };
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_ACTIONS = 4;
const HIGH_CITATION_THRESHOLD = 20; // URL must have ≥20 citations to be "high-citation"
const MIN_SAMPLES_FOR_REPLICATE = 3; // bucket needs ≥3 samples to recommend replication
const MIN_SAMPLES_FOR_REVERSE = 3; // bucket needs ≥3 samples to recommend reverse
const DAYS_SINCE_CHANGE_THRESHOLD = 30; // pages without changes in last 30d are "quiet"

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeBrainActions(input: {
  patterns: UrlChangePattern[];
  outcomes: UrlChangeOutcome[];
  changelog: ChangelogEntry[];
  /** Per-URL-path total owned citations (normalized path → count). */
  citationsByUrl: Map<string, number>;
  /** Optional cap; defaults to 4 (1 primary + 3 secondary). */
  maxActions?: number;
}): BrainAction[] {
  const cap = input.maxActions ?? MAX_ACTIONS;
  const actions: BrainAction[] = [];

  const hasAnyHelping = input.patterns.some((p) => p.helping_count > 0);

  // 1. Replicate a winning pattern (only when helping data exists)
  const replicateAction = buildReplicateAction(input);
  if (replicateAction) actions.push(replicateAction);

  // 2. Reverse a hurting pattern
  const reverseAction = buildReverseAction(input);
  if (reverseAction) actions.push(reverseAction);

  // 3. Start experiment on high-citation pages that haven't been touched
  const startActions = buildStartExperimentActions(input, cap);
  actions.push(...startActions);

  // 4. Exploratory fallback — always add at least one when no helping exists
  if (!hasAnyHelping && actions.length < cap) {
    const exploratory = buildExploratoryAction(input);
    if (exploratory) actions.push(exploratory);
  }

  // Rank by action kind × data strength
  actions.sort(compareActions);

  // Assign sequential ranks
  return actions.slice(0, cap).map((a, i) => ({ ...a, rank: i + 1 }));
}

// ---------------------------------------------------------------------------
// Action builders — each reads from one narrow slice of the brain
// ---------------------------------------------------------------------------

function buildReplicateAction(input: {
  patterns: UrlChangePattern[];
  outcomes: UrlChangeOutcome[];
  changelog: ChangelogEntry[];
  citationsByUrl: Map<string, number>;
}): BrainAction | null {
  // Find the best pattern with actual helping outcomes.
  const winners = input.patterns
    .filter(
      (p) =>
        p.helping_count > 0 &&
        p.sample_count >= MIN_SAMPLES_FOR_REPLICATE &&
        p.confidence_tier !== "low",
    )
    .sort(
      (a, b) =>
        b.success_rate - a.success_rate ||
        b.helping_count - a.helping_count ||
        b.sample_count - a.sample_count,
    );

  const best = winners[0];
  if (!best) return null;

  // Find a high-citation page that has NOT had this edit_type applied yet.
  const pagesWithThisEdit = new Set(
    input.outcomes
      .filter((o) => o.edit_type_tokens.includes(best.edit_type_token))
      .map((o) => o.url),
  );
  const target = findHighestCitationUrlWithoutPattern(
    input.citationsByUrl,
    pagesWithThisEdit,
  );

  if (!target) return null;

  const editLabel = prettyToken(best.edit_type_token);
  const assetLabel = prettyAsset(best.asset_type);
  const landingDays = best.median_landing_day ?? 7;

  return {
    id: `replicate:${best.id}:${target.url}`,
    kind: "replicate_winner",
    rank: 0,
    headline: `Replicate proven ${editLabel} on ${target.url}`,
    rationale: `${best.helping_count} of ${best.sample_count} ${editLabel} edits on ${assetLabel}s in your workspace have landed as Helping (${Math.round(best.success_rate * 100)}% success rate). ${target.url} has ${target.citations} citations and hasn't had this edit yet.`,
    expectedOutcome:
      best.median_delta_pct !== null && best.median_delta_pct > 0
        ? `Median lift for this pattern: +${Math.round(best.median_delta_pct)}% citations, typically landing by day ${landingDays}.`
        : `Median landing window for this pattern: ${landingDays} days.`,
    confidence: best.confidence_tier === "high" ? "high" : "medium",
    targetUrl: target.url,
    patternId: best.id,
    dataCitations: {
      patternSampleCount: best.sample_count,
      patternHelpingCount: best.helping_count,
      urlCitationCount: target.citations,
    },
  };
}

function buildReverseAction(input: {
  patterns: UrlChangePattern[];
  outcomes: UrlChangeOutcome[];
  citationsByUrl: Map<string, number>;
}): BrainAction | null {
  // Find the worst pattern: high regress rate + sufficient samples.
  const hurters = input.patterns
    .filter(
      (p) =>
        p.hurting_count >= 2 &&
        p.sample_count >= MIN_SAMPLES_FOR_REVERSE &&
        p.regress_rate >= 0.25,
    )
    .sort(
      (a, b) =>
        b.regress_rate - a.regress_rate || b.hurting_count - a.hurting_count,
    );

  const worst = hurters[0];
  if (!worst) return null;

  // Find the worst-affected URL in this bucket by recent outcome.
  const affected = input.outcomes
    .filter(
      (o) =>
        o.verdict === "hurting" &&
        o.asset_type === worst.asset_type &&
        o.edit_type_tokens.includes(worst.edit_type_token),
    )
    .sort(
      (a, b) => (a.delta_pct ?? 0) - (b.delta_pct ?? 0), // most negative first
    );

  const topAffected = affected[0];
  if (!topAffected) return null;

  const editLabel = prettyToken(worst.edit_type_token);
  const assetLabel = prettyAsset(worst.asset_type);

  return {
    id: `reverse:${worst.id}:${topAffected.url}`,
    kind: "reverse_hurter",
    rank: 0,
    headline: `Investigate ${editLabel} regression on ${topAffected.url}`,
    rationale: `${Math.round(worst.regress_rate * 100)}% of ${editLabel} edits on ${assetLabel}s in your workspace have hurt visibility (${worst.hurting_count} of ${worst.sample_count} samples). ${topAffected.url} is down ${Math.round(Math.abs((topAffected.delta_pct ?? 0) * 100))}% after its last ${editLabel}.`,
    expectedOutcome: `Investigate the last ${editLabel} change on this URL. Consider reverting or testing a variant to confirm the regression is caused by the edit.`,
    confidence: worst.confidence_tier === "high" ? "high" : "medium",
    targetUrl: topAffected.url,
    patternId: worst.id,
    dataCitations: {
      patternSampleCount: worst.sample_count,
      patternHurtingCount: worst.hurting_count,
      outcomeIds: [topAffected.change_id],
    },
  };
}

function buildStartExperimentActions(
  input: {
    changelog: ChangelogEntry[];
    citationsByUrl: Map<string, number>;
  },
  cap: number,
): BrainAction[] {
  const now = Date.now();
  const thresholdMs = DAYS_SINCE_CHANGE_THRESHOLD * 86_400_000;

  // Index: URL path -> most recent change timestamp
  const lastChangeByUrl = new Map<string, number>();
  for (const c of input.changelog) {
    if (!c.url || c.archived) continue;
    const path = normalizePath(c.url);
    if (!path) continue;
    const ts = new Date(c.timestamp).getTime();
    const prev = lastChangeByUrl.get(path);
    if (prev === undefined || ts > prev) lastChangeByUrl.set(path, ts);
  }

  // Rank candidate URLs: high citations + no recent change
  const candidates: { url: string; citations: number }[] = [];
  for (const [url, cit] of input.citationsByUrl) {
    if (cit < HIGH_CITATION_THRESHOLD) continue;
    const lastChange = lastChangeByUrl.get(url);
    const quiet = lastChange === undefined || now - lastChange > thresholdMs;
    if (!quiet) continue;
    candidates.push({ url, citations: cit });
  }

  candidates.sort((a, b) => b.citations - a.citations);

  const take = Math.min(cap - 1, candidates.length, 3);
  return candidates.slice(0, take).map((c) => ({
    id: `start:${c.url}`,
    kind: "start_experiment" as const,
    rank: 0,
    headline: `Test a measurable change on ${c.url}`,
    rationale: `${c.url} is receiving ${c.citations} AI citations but has no change logged in the last ${DAYS_SINCE_CHANGE_THRESHOLD} days. This is a high-signal page — any experiment here will produce a clean before/after read-out.`,
    expectedOutcome: `Pick one measurable edit (title, H1, FAQ, schema) and log it. The watcher will track the URL and produce a verdict within 14 days.`,
    confidence: "medium",
    targetUrl: c.url,
    patternId: null,
    dataCitations: {
      urlCitationCount: c.citations,
    },
  }));
}

function buildExploratoryAction(input: {
  citationsByUrl: Map<string, number>;
}): BrainAction | null {
  // Find the highest-citation URL overall as a sane first target.
  let top: { url: string; citations: number } | null = null;
  for (const [url, cit] of input.citationsByUrl) {
    if (!top || cit > top.citations) top = { url, citations: cit };
  }
  if (!top) return null;

  return {
    id: `exploratory:${top.url}`,
    kind: "exploratory",
    rank: 0,
    headline: `Exploratory — no proven wins yet. Start with ${top.url}.`,
    rationale: `Beacon hasn't seen any of your changes land as "Helping" yet, so we can't recommend a proven pattern. Start by making one small, measurable edit on your highest-citation page (${top.citations} AI citations) and the brain will calibrate from there.`,
    expectedOutcome: `After 14 days, the URL-level verdict will tell us whether this edit type moves the needle on this page. That first landing becomes the first data point for future recommendations.`,
    confidence: "exploratory",
    targetUrl: top.url,
    patternId: null,
    dataCitations: {
      urlCitationCount: top.citations,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findHighestCitationUrlWithoutPattern(
  citationsByUrl: Map<string, number>,
  excludeUrls: Set<string>,
): { url: string; citations: number } | null {
  let best: { url: string; citations: number } | null = null;
  for (const [url, cit] of citationsByUrl) {
    if (excludeUrls.has(url)) continue;
    if (!best || cit > best.citations) best = { url, citations: cit };
  }
  return best;
}

function normalizePath(u: string | null): string | null {
  if (!u) return null;
  try {
    if (/^https?:\/\//i.test(u)) {
      return new URL(u).pathname.replace(/\/+$/, "").toLowerCase() || "/";
    }
    return u.replace(/\/+$/, "").toLowerCase() || "/";
  } catch {
    return null;
  }
}

function prettyToken(token: string): string {
  return token.replace(/_/g, " ");
}

function prettyAsset(asset: string): string {
  return asset.replace(/_/g, " ");
}

function kindRank(kind: BrainActionKind): number {
  switch (kind) {
    case "replicate_winner":
      return 0; // Highest priority — proven win available
    case "reverse_hurter":
      return 1; // Second — stop ongoing damage
    case "start_experiment":
      return 2; // Third — opportunity to learn
    case "exploratory":
      return 3; // Fourth — fallback
  }
}

function compareActions(a: BrainAction, b: BrainAction): number {
  const rk = kindRank(a.kind) - kindRank(b.kind);
  if (rk !== 0) return rk;
  // Secondary ordering: confidence (high > medium > low > exploratory).
  const confRank = {
    high: 0,
    medium: 1,
    low: 2,
    exploratory: 3,
  };
  return confRank[a.confidence] - confRank[b.confidence];
}
