/**
 * Shared serialized Today types (2026-06-16 — extracted from the 989-line
 * legacy `today-client.tsx`). These are consumed by LIVE v2 components
 * (command-center, today-primary-action, today-v2-do-today,
 * today-v2-recent-wins, today-findings, today-visibility-snapshot,
 * change-review) AND by the live data loaders (`today-v2-data.ts`,
 * `today-data.ts`), so their home must NOT be a `"use client"` component
 * module. Pulling the type definitions here decouples live code from the
 * legacy client file and shrinks it — the first safe, behavior-neutral step
 * toward collapsing the legacy↔v2 dual surface (the client component itself
 * stays until the loader's `ComponentProps<typeof TodayClient>` derivation is
 * lifted off it). `today-client.tsx` re-exports these names so any importer
 * that still points at it keeps resolving.
 *
 * Pure type module — no runtime, no client/server boundary.
 */

import type { FindingPriority, PromotionStatus } from "@/domains/scanning/types";
import type { TodayLiveChange } from "@/domains/today/live-changes-data";
// Dependency types for the relocated TodayClientProps (2026-06-16, step 2b).
// All type-only — erased at runtime, so importing from client-component
// modules here does not cross the server/client boundary.
import type { TodaySummary } from "@/lib/today-summary";
import type { TodayProofContext } from "@/lib/today-proof-context";
import type { ScoreboardData } from "@/components/today/today-scoreboard";
import type { PollHealthSnapshot } from "@/domains/observations/poll-health";
import type {
  EnrichmentRollup,
  EnrichmentV2Data,
} from "@/domains/prompt-answer-observations/enrichment-rollup";
import type { PromptsTeaserSummary } from "@/components/today/prompts-teaser";
import type { TopPickSummary } from "@/components/today/top-pick-card";
import type {
  VisibilityMetric,
  VisibilityPoint,
  EntityVisibility,
} from "@/domains/product/visibility-score";

export type SerializedFinding = {
  id: string;
  type: string;
  url: string;
  pagePath: string;
  detectedAt: string;
  previousState: string | null;
  currentState: string | null;
  severity: "high" | "medium" | "low";
  priority: FindingPriority;
  priorityScore: number;
  summary: string;
  suggestedAction: string;
  status: string;
  promotionStatus: PromotionStatus;
  citationCount: number;
  isHomepage: boolean;
  contradictsChangelog: boolean;
  /** Tier 1A: crawl comparison provenance */
  scanRunId?: string;
  provenanceSummary?: string;
  crawlProofHref?: string | null;
};

export type RecResponseStatus = "accepted" | "dismissed" | "deferred" | null;

export type TodayPrimaryAction = {
  id: string;
  headline: string;
  rationale: string;
  expectedOutcome: string;
  sourceEvidence: string;
  priorityScore: number;
  bucket: "critical" | "high_leverage" | "opportunistic";
  type: string;
  confidence: "high" | "medium" | "low";
  href: string;
  responseStatus?: RecResponseStatus;
  confidenceReason?: string;
  watchAfter?: string;
  dataFreshness?: string | null;
  hasExperiment?: boolean;
  targetPageUrl?: string | null;
  targetPagePath?: string | null;
  baselineCitations?: number | null;
  /** Tier 1A: link to scorecard row when recommendation is grounded in a change */
  sourceChangeId?: string | null;
  /** Tier 1A: bullet list shown under primary card */
  lineageBullets?: string[];
  /** AI answer context — mention rate, positioning, trend for matched topic */
  answerContext?: string | null;
  /** Specific action to take */
  specificMove?: string | null;
  /** Which page section to target */
  targetSection?: string | null;
  /** Prior change where this move worked */
  priorSuccess?: { changeId: string; pagePath: string; description: string; citationDelta: number } | null;
  /** Per-engine expected signal timing */
  engineTiming?: { platform: string; medianDays: number; sampleCount: number }[] | null;
  /** Concrete expected metric */
  expectedMetric?: string | null;
  /** Fix 2 (2026-04-21): carried so accept handler can pass auto-link
   *  context (targetPageUrl + patternId) to the response store. */
  patternId?: string | null;
};

export type TodayMilestoneTeaser = {
  title: string;
  subtitle: string;
  proofSummary: string;
  achievedAt: string;
  magnitude?: "major" | "minor";
};

export type TodayQueueItem = {
  id: string;
  group: "fix" | "ship" | "frontier" | "verify" | "review" | "waiting" | "wins";
  plainGroup?: "fix_this" | "in_progress" | "wins";
  label: string;
  meta: string;
  href: string;
  dot: string;
  detail: string;
  issueId?: string;
  issueStatus?: string;
  pageUrl?: string;
  pagePath?: string;
  observationRunId?: string | null;
  observationRunHref?: string | null;
};

/** Serialized experiment data for the proof line. */
export type TodayExperimentProof = {
  id: string;
  headline: string;
  status: string;
  daysSinceStart: number;
  citationDeltaPct: number | null;
  mentionDeltaPct: number | null;
  targetPagePath: string | null;
};

/* ── Lifecycle types (2026-06-16 — relocated from today-data.ts to break the
 *    today-data ↔ TodayClient-props circular type dependency; today-data
 *    re-exports them so existing importers keep resolving). ── */

export type TodayLifecycleQueueItem = {
  id: string;
  rec_id: string;
  action_type: string;
  target_url: string | null;
  display_label: string | null;
  proposed_text_preview: string | null;
  updated_at: string;
  /** Phase 6A.8 — true when the proposed_text is a generator placeholder
   *  the operator must rewrite before shipping. */
  needsRewrite: boolean;
};

export type TodayLifecycleSummary = {
  counts: {
    liveVerified: number;
    pendingImplementation: number;
    needsReview: number;
    notFoundAfter7d: number;
  };
  queue: TodayLifecycleQueueItem[];
  /**
   * T-LiveChanges (2026-05-08) — actual verified_live rows with their
   * dynamic state copy. Top 3 most-recent. Empty array when no
   * verified_live edits exist; the LiveChangesBlock component renders
   * `null` for empty arrays so the strip's "0 live verified" chip is
   * the only acknowledgement.
   */
  liveChanges: TodayLiveChange[];
};

/* ── TodayClient props (2026-06-16, step 2b — relocated from today-client.tsx
 *    so the live `today-data.ts` loader can derive `TodayPageData` from a named
 *    type instead of `ComponentProps<typeof TodayClient>`, decoupling the
 *    server loader from the (unrendered) legacy client component value. ── */

/** Per-page proof signal for the "Latest signal" strip (was a local type in
 *  today-client.tsx; a duplicate copy still lives in today-v2-recent-wins.tsx). */
export type UrlVerdictProof = {
  changeId: string;
  pagePath: string;
  changeDate: string | null;
  citationDeltaPct: number;
  deltaLabel: string;
};

export type TodayClientProps = {
  isDemoMode?: boolean;
  scanPhaseFailed?: boolean;
  todayFreshness?: {
    lastObservationDate: string;
    daysStale: number;
  } | null;
  hostedScanDisabled?: boolean;
  summary: TodaySummary;
  primaryAction?: TodayPrimaryAction | null;
  secondaryAction?: TodayPrimaryAction | null;
  moreActions?: TodayPrimaryAction[];
  measuredWins?: TodayPrimaryAction[];
  scoreboard: ScoreboardData;
  visibilityData?: {
    brandName: string;
    brandSeriesByMetric: Record<VisibilityMetric, VisibilityPoint[]>;
    brandSeriesByPlatform?: Record<string, VisibilityPoint[]>;
    leaderboardByMetric: Record<VisibilityMetric, EntityVisibility[]>;
    leaderboardByMetricAndWindow?: Record<
      VisibilityMetric,
      Record<number, EntityVisibility[]>
    >;
    chartEndDate?: string;
    competitorSeriesByMetric: Record<
      VisibilityMetric,
      Array<{ name: string; points: VisibilityPoint[] }>
    >;
    chartEvents?: Array<{ date: string; tone: "danger" | "success" | "neutral"; label: string }>;
  } | null;
  urlVerdictProof?: UrlVerdictProof | null;
  onRespondToRec?: (
    recId: string,
    status: "accepted" | "dismissed" | "deferred"
  ) => Promise<{ success: boolean }>;
  pendingFindings?: SerializedFinding[];
  shouldTriggerScan?: boolean;
  proofContext: TodayProofContext;
  onConfirmFinding?: (findingId: string) => Promise<{ success: boolean; changeId?: string }>;
  onDismissFinding?: (findingId: string) => Promise<{ success: boolean }>;
  experimentProof?: TodayExperimentProof | null;
  faqSchemaCoverage?: { covered: number; total: number } | null;
  platformDistribution?: { google_aio: number; chatgpt: number; perplexity: number; total: number } | null;
  concentratedPlatform?: "google_aio" | "chatgpt" | "perplexity" | null;
  pollHealth?: PollHealthSnapshot | null;
  siteScan?: { completedAt: string | null; status: "completed" | "partial" | "failed" | null } | null;
  enrichmentRollup?: EnrichmentRollup | null;
  enrichmentV2?: EnrichmentV2Data | null;
  promptsTeaser?: PromptsTeaserSummary | null;
  topPick?: TopPickSummary | null;
  lifecycleSummary?: TodayLifecycleSummary | null;
  firstReading?: import(
    "@/domains/onboarding/first-reading-state"
  ).FirstReadingDetection;
  dataSourcesStrip?: import("react").ReactNode;
};
