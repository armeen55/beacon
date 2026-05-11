/**
 * /prompts/[id] v2B — pure projection from drilldown to brief.
 *
 * Bundle (2026-05-11) per the maximum-depth UI audit. Mirrors the
 * Changes v2 detail pattern: take the already-computed
 * `PromptDrilldown` (legacy data flow, no new fetches) and emit a
 * typed 5-act prop bundle the v2 client renders.
 *
 * Pure module. No I/O, no DOM, no React. Reuses the v2A category
 * vocabulary + per-platform projection helpers so the detail page
 * and the timeline card never disagree about what to call the same
 * prompt's state.
 *
 * Customer-vocabulary contract:
 *   • No `prompt_answer_observations` / `stableKey` / `resolver
 *     tier` / `evidence tier` / `native observation` / raw enum
 *     names / cron-time disclosures in any output string.
 *   • Recent-movement labels use plain English ("Came back",
 *     "Dropped", "Mention surge", "Still learning").
 *   • Empty states are intentional fallbacks ("No consistent
 *     competitor pattern yet.", "Beacon is still gathering
 *     readings for this prompt.").
 */

import type {
  PromptDrilldown,
  PromptCompetitorRow,
  PromptRawAnswerSample,
} from "@/domains/prompts/prompt-drilldown";
import {
  categoryForLegacy,
  projectPlatformBadge,
  platformLabel,
  type PromptsV2Category,
  type PromptsV2PlatformBadge,
} from "@/domains/prompts/v2-projection";

// ─────────────────────────────────────────────────────────────────────
// Header + summary
// ─────────────────────────────────────────────────────────────────────

export type PromptsV2BriefHeader = {
  /** The prompt's full text — never an id. */
  promptText: string;
  /** Customer-safe category resolved from the drilldown classifier. */
  category: PromptsV2Category;
  /** Plain-English one-line summary derived from the classifier
   *  reasoning. The drilldown's `decisionSentence` includes the
   *  "Likely action: …" suffix; the header strips that so it
   *  reads as a state summary, not a tutorial. */
  summary: string;
  /** Per-platform badges, sorted strongest-first. */
  platformBadges: PromptsV2PlatformBadge[];
};

// ─────────────────────────────────────────────────────────────────────
// Act 2 — per-platform status cards
// ─────────────────────────────────────────────────────────────────────

export type PromptsV2BriefPlatform = {
  /** Stable platform key (`chatgpt`, `perplexity`, …). */
  platform: string;
  /** Branded customer-facing label. */
  label: string;
  /** Resolved state from the v2A platform-badge resolver. */
  state: PromptsV2PlatformBadge["state"];
  /** Plain-English microcopy ("Recommended first" / etc.). */
  microcopy: string;
  /** Honest answer-count summary ("Cited in 3 of 4 readings"). */
  detail: string;
  /** Optional simple sparkline of weekly observation counts —
   *  derived from `rawSamples` so we never invent data. Null when
   *  fewer than 2 unique days. */
  sparkline: ReadonlyArray<{ date: string; count: number }> | null;
};

// ─────────────────────────────────────────────────────────────────────
// Act 3 — competitors
// ─────────────────────────────────────────────────────────────────────

export type PromptsV2BriefCompetitor = {
  name: string;
  appearances: number;
  totalObservations: number;
  /** Pre-formatted "AI cited X in N of M readings" sentence. */
  summary: string;
};

// ─────────────────────────────────────────────────────────────────────
// Act 4 — recent movement
// ─────────────────────────────────────────────────────────────────────

export type PromptsV2BriefMovementKind =
  | "first_cited"
  | "came_back"
  | "dropped"
  | "mentions_jumped"
  | "mentions_slowed"
  | "still_learning";

export type PromptsV2BriefMovement = {
  kind: PromptsV2BriefMovementKind;
  label: string;
  /** Plain-English explanation. Already includes platform name
   *  when relevant. */
  summary: string;
  /** Tone for the row's visual treatment. */
  tone: "success" | "danger" | "muted";
  /** YYYY-MM-DD date of the movement (or the most-recent
   *  reading when "still learning"). */
  date: string;
};

// ─────────────────────────────────────────────────────────────────────
// Act 5 — next-action CTAs
// ─────────────────────────────────────────────────────────────────────

export type PromptsV2BriefCtaKind =
  | "open_recommendation"
  | "open_recommendations_queue"
  | "keep_monitoring"
  | "open_legacy_detail"
  | "back_to_prompts";

export type PromptsV2BriefCta = {
  kind: PromptsV2BriefCtaKind;
  label: string;
  href: string;
  emphasis: "primary" | "secondary";
};

// ─────────────────────────────────────────────────────────────────────
// Full brief props
// ─────────────────────────────────────────────────────────────────────

export type PromptsV2BriefProps = {
  /** Stable prompt id (for data-attrs, NOT shown to the customer). */
  promptId: string;
  header: PromptsV2BriefHeader;
  /** Act 1 supplementary line — "why this matters" derived from
   *  topic / location when present. Null when the data doesn't
   *  cleanly support a sentence. */
  whyItMatters: string | null;
  /** Act 2 — per-platform status. Always non-empty when the prompt
   *  has at least one tracked platform. */
  platforms: PromptsV2BriefPlatform[];
  /** Act 3 — dominant competitors. Empty list triggers the
   *  "No consistent competitor pattern yet." copy in the view. */
  competitors: PromptsV2BriefCompetitor[];
  /** Act 4 — at most 3 recent movements, newest-first. Empty list
   *  triggers the "Beacon is still gathering readings…" copy. */
  recentMovement: PromptsV2BriefMovement[];
  /** Act 5 — ordered CTAs. Always non-empty (ends with
   *  back_to_prompts). */
  nextActions: PromptsV2BriefCta[];
};

// ─────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────

/**
 * Strip the "Likely action: …" suffix the drilldown adds to its
 * decisionSentence. The brief surfaces "likely action" through
 * Act 5 CTAs instead, so the header summary should read as a
 * state, not a recommendation.
 */
function stripLikelyAction(sentence: string): string {
  const idx = sentence.indexOf("Likely action:");
  const idx2 = sentence.indexOf("Keep monitoring");
  const idx3 = sentence.indexOf("Check back once more AI readings");
  const candidates = [idx, idx2, idx3].filter((i) => i >= 0);
  if (candidates.length === 0) return sentence.trim();
  const cut = Math.min(...candidates);
  return sentence.slice(0, cut).trim();
}

function formatPlatformDetail(
  badge: PromptsV2PlatformBadge,
  stats: { observations: number; primary: number; cited: number; mentioned: number; absent: number },
): string {
  if (stats.observations === 0) return "No AI readings in the lookback window.";
  switch (badge.state) {
    case "primary":
      return `Recommended first in ${stats.primary} of ${stats.observations} readings.`;
    case "cited":
      return `Cited in ${stats.cited} of ${stats.observations} readings.`;
    case "mentioned":
      return `Mentioned in ${stats.mentioned} of ${stats.observations} readings, never cited.`;
    case "absent":
      return `Absent from every reading (${stats.observations} checks).`;
    case "no_data":
      return "No AI readings yet.";
  }
}

function platformSparkline(
  samples: ReadonlyArray<PromptRawAnswerSample>,
  platform: string,
): PromptsV2BriefPlatform["sparkline"] {
  // Bucket the prompt's raw samples by day for this platform. Returns
  // null when fewer than 2 distinct days — a single-day "sparkline"
  // is dishonest as a trend.
  const buckets = new Map<string, number>();
  for (const s of samples) {
    if (s.platform !== platform) continue;
    const day = s.observedAt.slice(0, 10);
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  if (buckets.size < 2) return null;
  const points = [...buckets.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

function projectPlatforms(
  drilldown: PromptDrilldown,
): PromptsV2BriefPlatform[] {
  const byPlatform = drilldown.classification.evidence.byPlatform;
  // Mirror v2A's sort: primary → cited → mentioned → absent →
  // no_data; ties broken alphabetically. Keeps detail + timeline
  // visually consistent.
  const projected = byPlatform.map((stats) => {
    const badge = projectPlatformBadge(stats);
    return {
      platform: stats.platform,
      label: platformLabel(stats.platform),
      state: badge.state,
      microcopy: badge.microcopy,
      detail: formatPlatformDetail(badge, stats),
      sparkline: platformSparkline(drilldown.rawSamples, stats.platform),
    } satisfies PromptsV2BriefPlatform;
  });
  const order: Record<PromptsV2BriefPlatform["state"], number> = {
    primary: 0,
    cited: 1,
    mentioned: 2,
    absent: 3,
    no_data: 4,
  };
  projected.sort((a, b) => {
    const d = order[a.state] - order[b.state];
    if (d !== 0) return d;
    return a.platform.localeCompare(b.platform);
  });
  return projected;
}

function projectCompetitors(
  rows: ReadonlyArray<PromptCompetitorRow>,
  limit: number = 5,
): PromptsV2BriefCompetitor[] {
  return rows.slice(0, limit).map((c) => ({
    name: c.name,
    appearances: c.appearances,
    totalObservations: c.totalObservations,
    summary:
      c.totalObservations > 0
        ? `Cited in ${c.appearances} of ${c.totalObservations} readings.`
        : `Cited in ${c.appearances} readings.`,
  }));
}

const MOVEMENT_LABEL: Record<PromptsV2BriefMovementKind, string> = {
  first_cited: "First time cited",
  came_back: "Came back into the rankings",
  dropped: "Dropped from the rankings",
  mentions_jumped: "Mentions jumped",
  mentions_slowed: "Mentions slowed down",
  still_learning: "Still learning",
};

/**
 * Project recent movement from the `rawSamples` time series.
 * Pure: looks for state transitions across consecutive samples
 * on the same platform. Returns at most `limit` rows, newest-first.
 *
 * Heuristic — by design, conservative. The brief MUST NOT invent
 * proof. When we can't confidently call a transition, we don't.
 */
function projectRecentMovement(
  samples: ReadonlyArray<PromptRawAnswerSample>,
  limit: number = 3,
): PromptsV2BriefMovement[] {
  if (samples.length === 0) return [];
  // Order oldest → newest, then walk per platform.
  const ordered = [...samples].sort(
    (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
  );
  const byPlatform = new Map<string, PromptRawAnswerSample[]>();
  for (const s of ordered) {
    const arr = byPlatform.get(s.platform);
    if (arr) arr.push(s);
    else byPlatform.set(s.platform, [s]);
  }
  const movements: PromptsV2BriefMovement[] = [];
  for (const [platform, arr] of byPlatform) {
    let prev: PromptRawAnswerSample | null = null;
    for (const cur of arr) {
      if (!prev) {
        // First sample on this platform — only emit "first cited"
        // when the very first observation was already a hit.
        if (cur.ritzState === "primary" || cur.ritzState === "cited") {
          movements.push({
            kind: "first_cited",
            label: MOVEMENT_LABEL.first_cited,
            summary: `${platformLabel(platform)} cited you for the first time on ${cur.observedAt.slice(0, 10)}.`,
            tone: "success",
            date: cur.observedAt.slice(0, 10),
          });
        }
      } else {
        const wasHit = prev.ritzState === "primary" || prev.ritzState === "cited";
        const isHit = cur.ritzState === "primary" || cur.ritzState === "cited";
        const wasMentioned = prev.ritzState === "mentioned";
        const isMentioned = cur.ritzState === "mentioned";
        if (!wasHit && isHit) {
          movements.push({
            kind: "came_back",
            label: MOVEMENT_LABEL.came_back,
            summary: `${platformLabel(platform)} started citing you again on ${cur.observedAt.slice(0, 10)}.`,
            tone: "success",
            date: cur.observedAt.slice(0, 10),
          });
        } else if (wasHit && !isHit && cur.ritzState === "absent") {
          movements.push({
            kind: "dropped",
            label: MOVEMENT_LABEL.dropped,
            summary: `${platformLabel(platform)} stopped citing you on ${cur.observedAt.slice(0, 10)}.`,
            tone: "danger",
            date: cur.observedAt.slice(0, 10),
          });
        } else if (!wasMentioned && isMentioned) {
          movements.push({
            kind: "mentions_jumped",
            label: MOVEMENT_LABEL.mentions_jumped,
            summary: `${platformLabel(platform)} began mentioning you on ${cur.observedAt.slice(0, 10)}.`,
            tone: "success",
            date: cur.observedAt.slice(0, 10),
          });
        } else if (wasMentioned && !isMentioned && cur.ritzState === "absent") {
          movements.push({
            kind: "mentions_slowed",
            label: MOVEMENT_LABEL.mentions_slowed,
            summary: `${platformLabel(platform)} stopped mentioning you on ${cur.observedAt.slice(0, 10)}.`,
            tone: "danger",
            date: cur.observedAt.slice(0, 10),
          });
        }
      }
      prev = cur;
    }
  }
  // Newest-first.
  movements.sort((a, b) => b.date.localeCompare(a.date));
  return movements.slice(0, limit);
}

/**
 * Resolve the ordered Act 5 CTAs. Pure decision table on (category,
 * presence of a linked recommendation, presence of any recommendation
 * surface) — mirrors the next-action resolver from the Changes brief.
 */
function projectNextActions({
  category,
  promptRouteId,
  hasLinkedRecommendation,
  includeLegacyEscape,
}: {
  category: PromptsV2Category;
  promptRouteId: string;
  hasLinkedRecommendation: boolean;
  includeLegacyEscape: boolean;
}): PromptsV2BriefCta[] {
  const ctas: PromptsV2BriefCta[] = [];
  const kind = category.kind;

  if (hasLinkedRecommendation) {
    ctas.push({
      kind: "open_recommendation",
      label: "Open recommendation",
      href: "/recommendations?v2=1",
      emphasis: "primary",
    });
  } else if (
    kind === "missing" ||
    kind === "outranked" ||
    kind === "almost_there"
  ) {
    ctas.push({
      kind: "open_recommendations_queue",
      label: "See related recommendations",
      href: "/recommendations?v2=1",
      emphasis: "primary",
    });
  } else if (kind === "winning") {
    ctas.push({
      kind: "keep_monitoring",
      label: "Keep monitoring",
      href: `/prompts/${promptRouteId}?v2=1`,
      emphasis: "primary",
    });
  } else {
    // still_learning — no actionable next step yet.
    ctas.push({
      kind: "back_to_prompts",
      label: "Back to prompts",
      href: "/prompts?v2=1",
      emphasis: "primary",
    });
  }

  if (includeLegacyEscape) {
    ctas.push({
      kind: "open_legacy_detail",
      label: "Open full record",
      href: `/prompts/${promptRouteId}?legacy=1`,
      emphasis: "secondary",
    });
  }

  // Always end with "Back to prompts" unless we already promoted it.
  if (!ctas.some((c) => c.kind === "back_to_prompts")) {
    ctas.push({
      kind: "back_to_prompts",
      label: "Back to prompts",
      href: "/prompts?v2=1",
      emphasis: "secondary",
    });
  }

  return ctas;
}

/**
 * Why-it-matters sentence for Act 1. Honest — only renders when
 * the drilldown carries a topic OR location. Never invents
 * context.
 */
function projectWhyItMatters(drilldown: PromptDrilldown): string | null {
  const topic = drilldown.topicId?.trim() || null;
  const location = drilldown.locationScope?.trim() || null;
  if (!topic && !location) return null;
  if (topic && location) {
    return `Buyers in ${location} ask AI this kind of question about ${topic}.`;
  }
  if (topic) {
    return `Buyers ask AI this kind of question about ${topic}.`;
  }
  return `Buyers in ${location} ask AI questions like this.`;
}

/**
 * Top-level projector. Takes the already-computed `PromptDrilldown`
 * and emits the typed 5-act brief prop bundle.
 */
export function projectPromptDrilldownToBrief({
  drilldown,
  promptRouteId,
  hasLinkedRecommendation = false,
  includeLegacyEscape = true,
}: {
  drilldown: PromptDrilldown;
  promptRouteId: string;
  /** When true, Act 5's primary CTA is "Open recommendation". */
  hasLinkedRecommendation?: boolean;
  /** Append the "Open full record" → `?legacy=1` escape hatch. */
  includeLegacyEscape?: boolean;
}): PromptsV2BriefProps {
  const category = categoryForLegacy(drilldown.category);
  const platforms = projectPlatforms(drilldown);

  const header: PromptsV2BriefHeader = {
    promptText: drilldown.promptText,
    category,
    summary: stripLikelyAction(drilldown.decisionSentence),
    platformBadges: platforms.map((p) => ({
      platform: p.platform,
      label: p.label,
      state: p.state,
      microcopy: p.microcopy,
    })),
  };

  return {
    promptId: drilldown.promptId,
    header,
    whyItMatters: projectWhyItMatters(drilldown),
    platforms,
    competitors: projectCompetitors(drilldown.competitors),
    recentMovement: projectRecentMovement(drilldown.rawSamples),
    nextActions: projectNextActions({
      category,
      promptRouteId,
      hasLinkedRecommendation,
      includeLegacyEscape,
    }),
  };
}
