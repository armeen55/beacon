/**
 * serp-feature-change (2026-07-03, BEACON_500 P9 v1 251) - PURE detector over
 * the append-only dataforseo_serp_history rows (see dataforseo-serp.ts /
 * serp-history.ts). It answers ONE question with $0 marginal cost, from data the
 * SERP writer already paid for and persisted: has a Google result FEATURE the
 * tenant could win (an answer box, a People Also Ask block, an image row)
 * appeared or disappeared for a tracked search?
 *
 * THE GAP, named: feature-steal reacts to WHO OWNS a feature right now; this
 * reacts to a feature's ARRIVAL or DEPARTURE. An answer box that Google just
 * turned on for a query is a timely opening ("Google just added an answer box
 * for 'farsi numbers'. Add an answer block to grab it."). A feature going away
 * changes how the page should compete (the classic top link matters more again).
 * Neither transition was surfaced before this detector.
 *
 * DETERMINISTIC DIFF, never inferred from absence-of-history:
 *   • A feature must be OBSERVED-ABSENT in the earliest usable capture inside the
 *     window and OBSERVED-PRESENT in the latest (that is an "appeared"), or the
 *     reverse (a "disappeared"). Two real captures minimum - one lone snapshot
 *     can never manufacture a transition.
 *   • Only features the tenant could WIN are reported: the AI/answer box, the
 *     People Also Ask block, and the image row. Knowledge panels and paid slots
 *     are not tenant-winnable, so a change in those never fires.
 *   • Presence is read from BOTH the serp_features flag list AND the richer
 *     parsed fields (ai_overview_present, snippet_owner, paa_questions), so a
 *     feature counts as present if EITHER source saw it (belt and suspenders -
 *     the flag list and the parsed fields are written from the same body).
 *
 * Empty when history has fewer than two captures for a query, when nothing
 * changed, or when the input is empty - honest silence, byte-identical to the
 * pre-detector world. No I/O, no server-only: the caller passes already-read
 * history rows (the loader in serp-history.ts does the bounded Supabase read).
 */

import type { ParsedFeaturedSnippet, ParsedPaaQuestion } from "./dataforseo-serp";

/** One history row's feature-change-relevant fields, as read from
 *  dataforseo_serp_history. */
export type SerpFeatureHistoryRow = {
  query: string;
  capturedAt: string;
  ownRank: number | null;
  /** The raw SerpFeature flag list captured at snapshot time. */
  serpFeatures: string[];
  aiOverviewPresent: boolean;
  snippetOwner: ParsedFeaturedSnippet | null;
  paaQuestions: ParsedPaaQuestion[];
};

/** The three tenant-winnable Google result features this detector tracks. A
 *  knowledge panel or a paid slot is not something the tenant can grab with a
 *  content edit, so those are deliberately excluded. */
export type WinnableFeature = "answer_box" | "people_also_ask" | "image_row";

export type FeatureChangeDirection = "appeared" | "disappeared";

export type SerpFeatureChange = {
  query: string;
  feature: WinnableFeature;
  direction: FeatureChangeDirection;
  /** The tenant's most-recent observed own rank for the query, when known. */
  ownRank: number | null;
  fromAt: string;
  toAt: string;
  /** First-person, dash-clean operator sentence with the concrete facts. */
  sentence: string;
};

const DEFAULT_WINDOW_DAYS = 30;

/** Plain, customer-safe labels for each feature (never "SERP"). */
const FEATURE_LABEL: Record<WinnableFeature, string> = {
  answer_box: "an answer box",
  people_also_ask: "a People Also Ask block",
  image_row: "an image row",
};

/** The-form label used in a "disappeared" sentence (definite article). */
const FEATURE_LABEL_THE: Record<WinnableFeature, string> = {
  answer_box: "the answer box",
  people_also_ask: "the People Also Ask block",
  image_row: "the image row",
};

/** The plain grab instruction for an "appeared" feature. */
const GRAB_INSTRUCTION: Record<WinnableFeature, string> = {
  answer_box: "Add a clear answer block near the top of your page",
  people_also_ask: "Answer the exact questions people ask on your page",
  image_row: "Add clear, named images to your page",
};

function normQuery(q: string): string {
  return q.trim().toLowerCase();
}

/** Is a winnable feature present in one capture? Reads BOTH the flag list and
 *  the parsed fields, so presence in EITHER counts (they come from the same
 *  paid-for body; a mismatch just means one parser saw it and the other did not). */
function featurePresent(row: SerpFeatureHistoryRow, feature: WinnableFeature): boolean {
  const flags = new Set(row.serpFeatures.map((f) => f.toLowerCase()));
  switch (feature) {
    case "answer_box":
      // The answer box family: Google's AI Overview OR a classic featured
      // snippet. Either one is a top-of-page answer slot the tenant can target.
      return (
        row.aiOverviewPresent ||
        row.snippetOwner != null ||
        flags.has("ai_overview") ||
        flags.has("featured_snippet")
      );
    case "people_also_ask":
      return row.paaQuestions.length > 0 || flags.has("people_also_ask");
    case "image_row":
      return flags.has("image_pack");
  }
}

const WINNABLE_FEATURES: readonly WinnableFeature[] = ["answer_box", "people_also_ask", "image_row"];

function buildAppearedSentence(feature: WinnableFeature, query: string): string {
  return `Google just added ${FEATURE_LABEL[feature]} for "${query}". ${GRAB_INSTRUCTION[feature]} to grab it.`;
}

function buildDisappearedSentence(feature: WinnableFeature, query: string): string {
  return `Google dropped ${FEATURE_LABEL_THE[feature]} for "${query}", so the classic top link matters more here again.`;
}

/**
 * PURE: reduce ONE query's captures into its feature-change findings. Needs at
 * least two usable captures inside the window. Compares the EARLIEST usable
 * capture against the LATEST: a feature absent-then-present is "appeared",
 * present-then-absent is "disappeared". Returns [] when nothing changed or when
 * there is only one usable capture (never inferred from a single point).
 */
export function computeSerpFeatureChangesForQuery(
  rows: SerpFeatureHistoryRow[],
  opts: { windowDays?: number; now?: Date } = {},
): SerpFeatureChange[] {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = opts.now ?? new Date();
  const cutoffMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  const usable = rows
    .filter((r) => {
      const t = Date.parse(r.capturedAt);
      return Number.isFinite(t) && t >= cutoffMs && t <= now.getTime();
    })
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  if (usable.length < 2) return [];

  const earliest = usable[0];
  const latest = usable[usable.length - 1];
  const query = latest.query;
  // Latest known own rank across the window (most recent non-null wins).
  let ownRank: number | null = null;
  for (let i = usable.length - 1; i >= 0; i -= 1) {
    if (typeof usable[i].ownRank === "number") {
      ownRank = usable[i].ownRank;
      break;
    }
  }

  const out: SerpFeatureChange[] = [];
  for (const feature of WINNABLE_FEATURES) {
    const before = featurePresent(earliest, feature);
    const after = featurePresent(latest, feature);
    if (before === after) continue;
    const direction: FeatureChangeDirection = after ? "appeared" : "disappeared";
    out.push({
      query,
      feature,
      direction,
      ownRank,
      fromAt: earliest.capturedAt,
      toAt: latest.capturedAt,
      sentence:
        direction === "appeared"
          ? buildAppearedSentence(feature, query)
          : buildDisappearedSentence(feature, query),
    });
  }
  return out;
}

/**
 * PURE: feature-change findings across every query in the input. Groups rows by
 * normalized query, diffs each query's captures, and returns the changes.
 * "appeared" changes sort first (the actionable ones - grab the new feature),
 * then by query. Empty when nothing changed anywhere.
 */
export function computeSerpFeatureChanges(
  rows: SerpFeatureHistoryRow[],
  opts: { windowDays?: number; now?: Date } = {},
): SerpFeatureChange[] {
  const byQuery = new Map<string, SerpFeatureHistoryRow[]>();
  for (const r of rows) {
    const key = normQuery(r.query);
    if (!key) continue;
    const list = byQuery.get(key) ?? [];
    list.push(r);
    byQuery.set(key, list);
  }
  const out: SerpFeatureChange[] = [];
  for (const list of byQuery.values()) {
    out.push(...computeSerpFeatureChangesForQuery(list, opts));
  }
  return out.sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === "appeared" ? -1 : 1;
    if (a.query !== b.query) return a.query.localeCompare(b.query);
    return a.feature.localeCompare(b.feature);
  });
}

/** Only the "appeared" changes - the ones Beacon can honestly queue as a
 *  grab-it-now Move. A disappeared feature is informational (it changes how to
 *  compete) but is not a fresh opportunity. */
export function appearedFeatureChanges(changes: SerpFeatureChange[]): SerpFeatureChange[] {
  return changes.filter((c) => c.direction === "appeared");
}

/** At most this many feature-change Moves reach the plan per night - the same
 *  bounded-hint precedent as feature-steal / broken-competitor / displacement. */
export const MAX_SERP_FEATURE_CHANGE_CANDIDATES = 3;
