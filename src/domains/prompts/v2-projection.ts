/**
 * /prompts v2A — pure projection layer for the strategic surface.
 *
 * Bundle (2026-05-11) — second pass at /prompts per the maximum-depth
 * UI audit (`~/.claude/plans/i-want-a-maximum-depth-curried-curry.md`).
 *
 * Goal: keep the legacy 5-category concept intact (it's already the
 * strongest framing on the product), but project it through a
 * customer-safe vocabulary layer so the v2 surface reads as
 * "buyer questions AI answers with or without you" instead of an
 * operator categorization page.
 *
 * Pure module. No I/O, no DOM, no React. Takes the same
 * `PromptOpportunity` / `DecisionMatrix` shapes the legacy page
 * already consumes; emits typed records the v2 client renders.
 *
 * Customer-vocabulary contract:
 *   • Category labels are plain English ("Winning", "Almost there",
 *     "Missing", "Outranked", "Still learning"). Legacy enum keys
 *     (`absent`, `close`, `early`) stay as code identifiers.
 *   • One-line explanations describe the customer's state in their
 *     vocabulary, never "primary-rate", "absent-count", or
 *     "signal strength".
 *   • Platform names render branded ("ChatGPT", "Perplexity",
 *     "Google AI Overviews"). Unknown platform keys fall through.
 *   • No `prompt_answer_observations`, no `resolver_tier`, no
 *     `evidence tier`, no `stableKey`, no debug strings.
 */

import type {
  PromptOpportunity,
  PromptOpportunityCategory,
  PromptPlatformStats,
} from "@/domains/prompts/opportunity-classify";

// ─────────────────────────────────────────────────────────────────────
// Category vocabulary
// ─────────────────────────────────────────────────────────────────────

/**
 * Customer-facing category kind. One per legacy
 * `PromptOpportunityCategory` but with names a non-engineer reads
 * as the answer to "how am I doing on this prompt?".
 */
export type PromptsV2CategoryKind =
  | "winning"
  | "almost_there"
  | "missing"
  | "outranked"
  | "still_learning";

export type PromptsV2CategoryTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "muted";

export type PromptsV2Category = {
  kind: PromptsV2CategoryKind;
  /** Legacy enum key — kept for join-back logic / data-attrs. */
  legacyCategory: PromptOpportunityCategory;
  label: string;
  /** One-line plain-English explanation of what this group means. */
  lead: string;
  tone: PromptsV2CategoryTone;
};

/**
 * Canonical projection table. Source of truth for the v2 vocabulary.
 * Tests pin this table to the legacy enum so any future rename has
 * to update both.
 */
export const PROMPTS_V2_CATEGORY_TABLE: ReadonlyArray<PromptsV2Category> = [
  {
    kind: "winning",
    legacyCategory: "winning",
    label: "Winning",
    lead: "AI recommends you first on at least one platform.",
    tone: "success",
  },
  {
    kind: "almost_there",
    legacyCategory: "close",
    label: "Almost there",
    lead: "AI mentions you, but you're not the top pick yet.",
    tone: "warning",
  },
  {
    kind: "missing",
    legacyCategory: "absent",
    label: "Missing",
    lead: "AI never mentions you for these questions.",
    tone: "warning",
  },
  {
    kind: "outranked",
    legacyCategory: "outranked",
    label: "Outranked",
    lead: "Competitors dominate these answers. You're absent.",
    tone: "danger",
  },
  {
    kind: "still_learning",
    legacyCategory: "early",
    label: "Still learning",
    lead: "Beacon is still gathering AI readings for these prompts.",
    tone: "muted",
  },
];

/** Display order on the v2 page. Winning first; "Still learning" last. */
export const PROMPTS_V2_CATEGORY_ORDER: ReadonlyArray<PromptsV2CategoryKind> = [
  "winning",
  "almost_there",
  "missing",
  "outranked",
  "still_learning",
];

const BY_LEGACY = new Map<PromptOpportunityCategory, PromptsV2Category>(
  PROMPTS_V2_CATEGORY_TABLE.map((c) => [c.legacyCategory, c]),
);

const BY_KIND = new Map<PromptsV2CategoryKind, PromptsV2Category>(
  PROMPTS_V2_CATEGORY_TABLE.map((c) => [c.kind, c]),
);

/** Resolve the v2 category for a legacy enum key. */
export function categoryForLegacy(
  legacy: PromptOpportunityCategory,
): PromptsV2Category {
  const found = BY_LEGACY.get(legacy);
  // The mapping is exhaustive — every legacy key has an entry — so a
  // missing entry is a code bug, not a data bug.
  if (!found) {
    throw new Error(
      `[prompts-v2-projection] no v2 category for legacy='${legacy}'`,
    );
  }
  return found;
}

/** Resolve a v2 category by its customer-safe kind. */
export function categoryForKind(
  kind: PromptsV2CategoryKind,
): PromptsV2Category {
  const found = BY_KIND.get(kind);
  if (!found) {
    throw new Error(
      `[prompts-v2-projection] no v2 category for kind='${kind}'`,
    );
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────
// Counter projection
// ─────────────────────────────────────────────────────────────────────

export type PromptsV2Counter = {
  kind: PromptsV2CategoryKind;
  label: string;
  count: number;
  tone: PromptsV2CategoryTone;
};

/**
 * Pure: derive the v2 counter strip from already-classified
 * prompts. Order matches `PROMPTS_V2_CATEGORY_ORDER`; "Still
 * learning" is included so the strip reflects the full coverage,
 * not just action-meaningful buckets.
 */
export function computePromptsV2Counters(
  prompts: ReadonlyArray<Pick<PromptOpportunity, "category">>,
): PromptsV2Counter[] {
  const counts = new Map<PromptsV2CategoryKind, number>();
  for (const kind of PROMPTS_V2_CATEGORY_ORDER) counts.set(kind, 0);
  for (const p of prompts) {
    const cat = categoryForLegacy(p.category);
    counts.set(cat.kind, (counts.get(cat.kind) ?? 0) + 1);
  }
  return PROMPTS_V2_CATEGORY_ORDER.map((kind) => {
    const meta = categoryForKind(kind);
    return {
      kind,
      label: meta.label,
      count: counts.get(kind) ?? 0,
      tone: meta.tone,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Per-platform projection
// ─────────────────────────────────────────────────────────────────────

const PLATFORM_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  google_aio: "Google AI Overviews",
  perplexity: "Perplexity",
};

/** Customer-friendly platform label. Falls through for unknown keys
 *  so a future-tracked engine doesn't crash the page. */
export function platformLabel(key: string): string {
  return PLATFORM_LABEL[key] ?? key;
}

/**
 * Plain-English state on one platform. Drives the per-platform
 * badge that appears on each card.
 */
export type PromptsV2PlatformBadge = {
  platform: string;
  label: string;
  state: "primary" | "cited" | "mentioned" | "absent" | "no_data";
  /** Short customer-safe phrase used in tooltip / badge body. */
  microcopy: string;
};

const PLATFORM_STATE_MICROCOPY: Record<
  PromptsV2PlatformBadge["state"],
  string
> = {
  primary: "Recommended first",
  cited: "AI mentioned you",
  mentioned: "Mentioned",
  absent: "Not mentioned",
  no_data: "Not checked yet",
};

/**
 * Resolve a platform's state from its `PromptPlatformStats`. Picks
 * the strongest signal that applies — "primary" wins, then "cited",
 * etc. Defensive against zero-observation rows.
 */
export function projectPlatformBadge(
  stats: PromptPlatformStats,
): PromptsV2PlatformBadge {
  let state: PromptsV2PlatformBadge["state"];
  if (stats.observations <= 0) {
    state = "no_data";
  } else if (stats.primary > 0) {
    state = "primary";
  } else if (stats.cited > 0) {
    state = "cited";
  } else if (stats.mentioned > 0) {
    state = "mentioned";
  } else {
    state = "absent";
  }
  return {
    platform: stats.platform,
    label: platformLabel(stats.platform),
    state,
    microcopy: PLATFORM_STATE_MICROCOPY[state],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Card-row projection
// ─────────────────────────────────────────────────────────────────────

export type PromptsV2CardRow = {
  /** Stable id for keys + the detail href. */
  promptId: string;
  /** The actual prompt text the customer sees. */
  text: string;
  /** Customer-safe category. */
  category: PromptsV2Category;
  /** Sentence Beacon already wrote about this prompt's state. */
  reasoning: string;
  /** Sorted strongest-first list of per-platform badges. */
  platformBadges: PromptsV2PlatformBadge[];
  /** Up to 3 dominant competitor names — already cleaned by the
   *  classifier. Empty list when no competitor dominates. */
  competitors: string[];
  /** Geo / topic cluster labels for context chips. Already cleaned
   *  by the classifier into `geo_cluster:<slug>` form; v2 strips
   *  the prefix when rendering. */
  clusterChips: Array<{ kind: "geo" | "topic"; label: string }>;
  /** Sort weight inside the category section (matches legacy). */
  signalStrength: number;
};

/** Project one `PromptOpportunity` into a customer-safe v2 row. */
export function projectPromptToCardRow(
  op: PromptOpportunity,
  text: string,
): PromptsV2CardRow {
  const category = categoryForLegacy(op.category);
  const platformBadges = [...op.evidence.byPlatform]
    .map(projectPlatformBadge)
    .sort((a, b) => {
      // Sort primary → cited → mentioned → absent → no_data, then
      // alphabetically by platform key for stability.
      const order: Record<PromptsV2PlatformBadge["state"], number> = {
        primary: 0,
        cited: 1,
        mentioned: 2,
        absent: 3,
        no_data: 4,
      };
      const d = order[a.state] - order[b.state];
      if (d !== 0) return d;
      return a.platform.localeCompare(b.platform);
    });

  // Up to 3 dominant competitors — already ordered by co-mention
  // frequency by the classifier.
  const competitors = op.evidence.dominantCompetitors.slice(0, 3);

  // Extract geo / topic cluster chips from the tag list. Raw tag
  // format: `geo_cluster:<slug>` / `topic_cluster:<slug>`.
  const clusterChips: PromptsV2CardRow["clusterChips"] = [];
  for (const tag of op.tags) {
    if (tag.startsWith("geo_cluster:")) {
      clusterChips.push({ kind: "geo", label: tag.slice("geo_cluster:".length) });
    } else if (tag.startsWith("topic_cluster:")) {
      clusterChips.push({
        kind: "topic",
        label: tag.slice("topic_cluster:".length),
      });
    }
  }

  return {
    promptId: op.prompt_id,
    text,
    category,
    reasoning: op.reasoning,
    platformBadges,
    competitors,
    clusterChips,
    signalStrength: op.signalStrength,
  };
}

/**
 * Project the whole prompt list into v2 card rows, grouped by
 * customer-safe category in the locked display order. Empty groups
 * are kept so the page can render an honest "No prompts in this
 * group right now." state per section.
 */
export type PromptsV2Section = {
  category: PromptsV2Category;
  rows: PromptsV2CardRow[];
};

export function projectPromptsToSections(
  prompts: ReadonlyArray<PromptOpportunity>,
  textById: ReadonlyMap<string, string>,
): PromptsV2Section[] {
  const byKind = new Map<PromptsV2CategoryKind, PromptsV2CardRow[]>();
  for (const kind of PROMPTS_V2_CATEGORY_ORDER) byKind.set(kind, []);
  for (const op of prompts) {
    const cat = categoryForLegacy(op.category);
    const text = textById.get(op.prompt_id) ?? "";
    byKind.get(cat.kind)?.push(projectPromptToCardRow(op, text));
  }
  return PROMPTS_V2_CATEGORY_ORDER.map((kind) => {
    const rows = byKind.get(kind) ?? [];
    rows.sort((a, b) => b.signalStrength - a.signalStrength);
    return {
      category: categoryForKind(kind),
      rows,
    };
  });
}
