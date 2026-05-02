/**
 * Sprint 6A.1 Phase 7 (2026-04-24) — Specific Edit Evidence Packet builder.
 *
 * The structured contract that every Specific Edit Generator (deterministic
 * v1, deterministic+LLM v2 in Sprint 6A.2) consumes. Pure compute, no I/O,
 * no DB writes, no LLM, no UI. Composes already-derived inputs from the
 * recommendation pipeline + Phase 6A.1.6's `page_element_inventory` rows
 * into one immutable, JSON-serializable packet plus a stable
 * `evidenceHash` so caches can detect "same evidence" across runs.
 *
 * This is intentionally separate from
 * `src/domains/recommendations/evidence-packet.ts` (Phase v7, 2026-04-23):
 *
 *   - That packet feeds the GPT-5-mini RECOMMENDATION ADJUDICATOR — it
 *     decides ACTION + MOTIVE + TARGET URL for each rec.
 *   - This packet feeds the SPECIFIC EDIT GENERATOR — it decides
 *     "change H2 X to Y, add FAQ Z, rewrite title to W" given a rec
 *     whose action + target URL is already settled.
 *
 * Two pipelines, two packets. Sharing the type would force one to
 * carry the other's bloat. The two stay independent on purpose.
 *
 * Hard rules (locked in by tests):
 *   1. `allowedTargetUrls` MUST come from owned inventory only (+ the
 *      `needs_new_page` sentinel). Generators / LLM cannot invent URLs.
 *   2. `targetPageElements` rows MUST come from `page_element_inventory`
 *      (carry `element_key` + `display_label` + `element_text`).
 *   3. `evidenceHash` MUST be deterministic (same inputs → same hash) and
 *      MUST change when meaningful evidence changes (tracked by tests on
 *      affectedPrompts, ownedPageCandidates, targetPageElements,
 *      competitorAngles, allowedTargetUrls).
 *   4. `tenantId` + `recId` are required and threaded through to every
 *      consumer + the hash itself.
 *   5. No tenant-specific (Ritz) hardcoding. Tests use neutral fixtures.
 *   6. Empty data on any optional dimension (no competitors observed, no
 *      page elements yet, no priors) does NOT crash — every collection
 *      defaults to `[]` and the packet still validates.
 *
 * Caps are intentionally generous for v1 — the LLM cost path lives
 * downstream in Phase 6A.2's provider adapter; v1 deterministic
 * generators don't pay per-token. Future tightening will live there.
 */

import { createHash } from "node:crypto";

import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { ElementType } from "@/domains/pages/extractors/registry";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { CitationEvidenceIndex } from "@/domains/pages/types";
import type { CompetitorPageEvidence } from "@/domains/pages/competitor-evidence";
import {
  DIRECTORY_DOMAINS_FOR_FILTER,
  makeCompetitorRankingFilter,
} from "./entity-pollution-filter";

import {
  ACTION_TYPES,
  ACTION_TYPE_REGISTRY,
  type ActionType,
} from "./action-types";
import {
  matchClusterToInventory,
  type PageInventoryEntry,
} from "./page-inventory";
import { canonicalStringify } from "./evidence-packet";
import { NEEDS_NEW_PAGE } from "./resolved-types";
import {
  getCrossTenantPatterns,
  type CrossTenantPattern,
} from "./cross-tenant-brain";

// ---------------------------------------------------------------------------
// Types — every field designed to round-trip through JSON.stringify cleanly.
// No Date objects, no Maps/Sets, no class instances, no functions. Only
// JSON primitives + plain objects + arrays.
// ---------------------------------------------------------------------------

export type SpecificEditClusterKind = "geo" | "topic";

export type AffectedPromptBlock = {
  promptId: string;
  promptText: string;
  /** PromptOpportunityCategory — "absent" | "outranked" | "close" |
   *  "winning" | "early". */
  category: string;
  observationCount: number;
  /** 0..1, rounded to 2dp. */
  brandPrimaryShare: number;
  /** Highest-share competitor on this prompt; null when none reach majority
   *  or no competitor data is available. Always tenant-agnostic. */
  topPrimaryCompetitor: { name: string; share: number } | null;
  /** Top descriptors AI used near the brand on this prompt (cap 6). */
  descriptorsNearBrand: string[];
  /**
   * Sprint 6A.2g.E (2026-04-26) — evidence-priority enrichment.
   *
   * actualSearchQueries: queries the AI actually emitted while answering
   * THIS prompt (sourced from observation.metadata.extracted.searchQueries
   * which Phase D populates for OpenAI native polls). Cap 10. Pre-Phase-D
   * observations have no extraction → array stays []. Honest blind spot
   * for Perplexity (Sonar doesn't expose internal queries).
   *
   * citedSourcePages: URLs the AI cited when answering THIS prompt
   * (sourced from observation.citation_urls). Cap 10. These are the
   * pages the operator must outrank for visibility.
   *
   * descriptorWindows: adjective windows around brand mentions (sourced
   * from observation.descriptor_window — Schema v2.1 extraction). Cap 5.
   * Useful for tone-mirroring in proposed copy.
   *
   * SYSTEM_PROMPT Rule 14 instructs the model to prefer these in
   * priority order: actualSearchQueries > citedSourcePages >
   * descriptorWindows > promptText.
   */
  actualSearchQueries: string[];
  citedSourcePages: string[];
  descriptorWindows: string[];
};

export type OwnedPageCandidateBlock = {
  /** Canonicalized URL; only owned URLs land here. */
  url: string;
  routeType: string;
  detectedGeo: string | null;
  detectedService: string | null;
  /** 0..1 blended score from `matchClusterToInventory`. */
  matchScore: number;
  matchReasons: string[];
  /** Raw inventory snapshot tokens — title + h1 + h2s — for generator
   *  context (e.g. avoid duplicating an H2 the page already has). */
  title: string | null;
  h1: string | null;
  h2s: string[];
};

export type TargetPageElementBlock = {
  /** The owned URL this element belongs to. Always one of
   *  `allowedTargetUrls` (excluding the `needs_new_page` sentinel). */
  url: string;
  elementKey: string;
  elementType: ElementType;
  displayLabel: string;
  elementText: string | null;
  /** Light-weight diagnostics from extractor (faq_source, anchor, etc.).
   *  Already small per Phase 6A.1.5 caps. */
  elementMetadata: Record<string, unknown>;
};

export type CompetitorAngleBlock = {
  /** Tenant-agnostic name (drawn from observations, not config). */
  competitorName: string;
  /** Number of affected prompts where this competitor occupies the
   *  primary slot at all (count of unique prompts). */
  promptsWherePrimary: number;
  /** Total affected prompts (denominator). */
  totalAffectedPrompts: number;
  /** Sum of primary observations across all affected prompts. Useful for
   *  weighting competitors that dominate one prompt vs. those that
   *  appear weakly across many. */
  totalPrimaryObservations: number;
};

// ---------------------------------------------------------------------------
// W3 Step 3.2 (2026-05-01) — Recommendation Engine v2 evidence packet
// foundation.
//
// Three new blocks land here:
//   - aiSearchSignal: what AI actually emits while answering the
//     affected prompts (verbatim search queries, descriptors near
//     brand, real-competitor co-mentions).
//   - competitorPageBlueprints: top competitor pages cited on
//     affected-prompt observations + structural data when known.
//   - crossTenantPatterns: stub today; locked contract for later.
//
// These blocks are the foundation for W3 Step 3.4's LLM grounding
// (the SYSTEM_PROMPT v2 will instruct the model to mirror real
// search-query phrasing, counter real competitor pages, and respect
// cross-tenant patterns once they exist). Step 3.2 ships the packet
// shape only — no LLM call, no UI consumer.
// ---------------------------------------------------------------------------

/**
 * One aggregated row per distinct AI-emitted search query across the
 * affected prompts. Source: `observations[i].search_queries`. Pre-
 * Phase-D Perplexity rows have no search queries (Sonar doesn't
 * expose them); they contribute nothing — graceful empty.
 */
export type AiSearchQueryAggregate = {
  /** Verbatim query string the AI emitted. */
  query: string;
  /** How many observations across affected prompts emitted this exact
   *  query. */
  count: number;
  /** Unique affected-prompt ids whose observations emitted this query. */
  promptIds: string[];
  /** Unique platforms that emitted this query (e.g. ["chatgpt"]).
   *  Honest blind spot for Perplexity (Sonar doesn't expose). */
  platforms: string[];
};

/**
 * One aggregated row per distinct descriptor AI used near the brand
 * across affected-prompt observations. Source:
 * `observations[i].descriptor_window` — Schema v2.1 deterministic
 * extraction of the ±5-word window around the first brand mention.
 */
export type AiDescriptorAggregate = {
  /** The descriptor word/phrase, lowercased. */
  word: string;
  /** Total occurrences across observations of affected prompts. */
  count: number;
  /** Unique affected-prompt ids whose observations carry this descriptor. */
  promptIds: string[];
};

/**
 * One aggregated row per real competitor co-mentioned in affected-
 * prompt observations. Source: `observations[i].competitor_co_mentions`.
 * Filtered through `entity-pollution-filter` so directories ("Houzz")
 * and generic-noun mentions ("General Contractors") don't ride along.
 */
export type AiCompetitorCoMentionAggregate = {
  /** Canonical competitor name (already filtered to "real competitor"). */
  competitorName: string;
  /** Total co-mention occurrences across observations. */
  count: number;
  /** Unique affected-prompt ids where this competitor co-appeared
   *  with the brand. */
  promptIds: string[];
};

/**
 * The W3 Step 3.2 search-signal block. Fed into the W3 Step 3.4
 * LLM SYSTEM_PROMPT as the FIRST source ("AI consistently asks
 * '<query>' on this cluster — mirror that phrasing in the FAQ").
 *
 * Empty arrays when no signal exists (pre-Phase-D rows / no
 * descriptor windows / all competitors filtered as directories).
 * Better empty than fake: callers must abstain when this signal is
 * thin, never invent.
 */
export type AiSearchSignalBlock = {
  /** Top distinct search queries by `count` desc, ties broken by
   *  query asc for hash determinism. Capped to AI_SEARCH_SIGNAL_TOP_N. */
  topSearchQueries: AiSearchQueryAggregate[];
  /** Top distinct descriptors by `count` desc, ties broken by word
   *  asc. Capped. */
  topDescriptors: AiDescriptorAggregate[];
  /** Top real-competitor co-mentions by `count` desc, ties broken by
   *  name asc. Filtered through the entity-pollution-filter. Capped. */
  topCompetitorCoMentions: AiCompetitorCoMentionAggregate[];
  /** Caps used during aggregation — for transparency / future audit. */
  caps: {
    maxSearchQueries: number;
    maxDescriptors: number;
    maxCompetitorCoMentions: number;
  };
};

/**
 * One competitor page worth countering on the affected prompts.
 * Source: aggregate `observations[i].citation_urls` paired with
 * `observations[i].citation_domain_classes` (where parallel index
 * carries class === "competitor"). Enriched with title /
 * structural data from `CompetitorPageEvidence` when a row exists.
 *
 * Hard rules:
 *   - `url` is verbatim from the citation (no normalization beyond
 *     basic trim). The LLM uses it for "outrank this exact URL"
 *     grounding, not for crawling.
 *   - `domain` is the lowercased apex; never tenant-owned.
 *   - `pageTitle` / `h1` / `topH2s` / `faqQuestions` /
 *     `metaDescription` are nullable — present when we've crawled
 *     the page (today: only `pageTitle` from
 *     `CompetitorPageEvidence`); the rest stay null/empty until a
 *     future scraper lands. Never invented.
 */
export type CompetitorPageBlueprint = {
  url: string;
  domain: string;
  /** Topic from the citation index ("Atherton Construction") if known. */
  topic: string | null;
  /** Times this URL was cited across observations of affected prompts. */
  citationCount: number;
  /** Unique affected-prompt ids whose observations cite this URL. */
  promptsCitedOn: string[];
  /** Operator-readable page title from `CompetitorPageEvidence` when
   *  the producer has captured it. Null when unknown. */
  pageTitle: string | null;
  /** Future-proof structural data. All optional / nullable today —
   *  never invented. */
  h1: string | null;
  topH2s: string[];
  faqQuestions: string[];
  metaDescription: string | null;
};

// Re-export so callers can import the cross-tenant pattern type from
// the same module they import the packet from.
export type { CrossTenantPattern };

/**
 * Per-tenant historical signal: "for this action_type on this tenant,
 * how often did past edits move citations". Phase 6A.1.7 ships an
 * empty array — the materialization job that populates this lives in
 * Sprint 6A.2 (`element_change_outcomes` aggregation). Builder accepts
 * the input today so the contract is locked even before the producer
 * exists.
 */
export type PriorOutcomeBlock = {
  actionType: ActionType;
  /** How many historical changelog entries with this action_type fed the rate. */
  sampleSize: number;
  /** 0..1, rounded to 2dp. Higher = more often correlated with citation lift. */
  positiveOutcomeRate: number;
};

export type SpecificEditEvidencePacket = {
  schemaVersion: "specific-edit/v1";
  generatedAt: string;
  tenantId: string;
  recId: string;
  /**
   * Optional stable identifier for the cluster this rec belongs to.
   * Null today — the existing recommendation pipeline doesn't materialize
   * clusters as first-class entities (the cluster IS its label). Reserved
   * here so when clusters get promoted to first-class in a future phase
   * the contract doesn't break.
   */
  clusterId: string | null;
  /** Operator-facing cluster label (e.g. "Palo Alto", "kitchen renovation").
   *  Null for single-prompt recs that don't participate in any cluster. */
  clusterLabel: string | null;
  /** "geo" / "topic" / null. Drives generator heuristics. */
  clusterKind: SpecificEditClusterKind | null;
  affectedPrompts: AffectedPromptBlock[];
  ownedPageCandidates: OwnedPageCandidateBlock[];
  targetPageElements: TargetPageElementBlock[];
  competitorAngles: CompetitorAngleBlock[];
  priorOutcomes: PriorOutcomeBlock[];
  /** Owned URLs the generator may target + the `needs_new_page` sentinel.
   *  Validation layer (6A.1.10) rejects outputs whose `target_url` isn't
   *  in this set. */
  allowedTargetUrls: string[];
  /** ActionTypes a generator (deterministic or LLM) may emit for this
   *  packet. Defaults to v1 active set; callers can widen for 6A.2. */
  allowedActionTypes: ActionType[];
  /**
   * W3 Step 3.2 (2026-05-01) — Recommendation Engine v2 evidence
   * foundation. Always populated (empty arrays, never null) so the
   * evidenceHash is deterministic regardless of whether a producer
   * has data yet.
   */
  aiSearchSignal: AiSearchSignalBlock;
  competitorPageBlueprints: CompetitorPageBlueprint[];
  /** Cross-tenant patterns. Stub returns []; locked contract for
   *  W3 Step 3.4+ when a real producer activates. */
  crossTenantPatterns: CrossTenantPattern[];
  /** Stable sha256 prefix of the packet contents (sans this field).
   *  Same inputs → same hash → cache hit; meaningful evidence change →
   *  fresh hash → cache miss → re-generate. */
  evidenceHash: string;
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export type BuildSpecificEditEvidencePacketArgs = {
  tenantId: string;
  recId: string;
  /** Optional — pass `null` when the cluster has no first-class id. */
  clusterId?: string | null;
  /** Operator-facing cluster label or null for single-prompt recs. */
  clusterLabel: string | null;
  /** "geo" | "topic" | null. */
  clusterKind: SpecificEditClusterKind | null;
  /** Prompt IDs the recommendation declares as affected. Ordering preserved. */
  affectedPromptIds: ReadonlyArray<string>;
  /** Already-classified prompt opportunities. Builder filters by
   *  affectedPromptIds. */
  promptOpportunities: ReadonlyArray<PromptOpportunity>;
  /** Tracked prompts — used to look up prompt text. */
  trackedPrompts: ReadonlyArray<TrackedPrompt>;
  /** Already-aggregated competitor-primary summaries per prompt. Builder
   *  filters by affectedPromptIds + sums across them. */
  primarySummaries: ReadonlyArray<PromptPrimarySummary>;
  /** Owned-only page inventory (from `buildPageInventory`). Builder runs
   *  cluster-match scoring against this. */
  ownedPageInventory: ReadonlyArray<PageInventoryEntry>;
  /** Per-snapshot extractor output rows. Builder filters to the latest
   *  snapshot per (url, element_key) and only includes elements whose
   *  url is in the candidate set. */
  pageElementInventory: ReadonlyArray<PageElementInventoryRow>;
  /**
   * Sprint 6A.2g.E (2026-04-26) — the full set of `prompt_answer_observations`
   * loaded by `LiveRecommendationQueue`. The builder filters to those
   * matching `affectedPromptIds` and aggregates Phase D extraction
   * (`metadata.extracted.searchQueries`), `citation_urls`, and
   * `descriptor_window` into the new `AffectedPromptBlock` arrays. Pre-
   * Phase-D observations (no `metadata.extracted` block) contribute
   * nothing — the empty case is graceful by design. Pass `[]` when the
   * caller hasn't loaded observations (test fixtures, legacy callers).
   */
  observations: ReadonlyArray<PromptAnswerObservation>;
  /**
   * Step 1.4 (master plan) — when supplied, directories ("Houzz") and
   * generic-noun mentions ("General Contractors") are filtered out of the
   * `competitorAngles` block so the LLM doesn't get instructed to counter
   * them. Optional for backwards compatibility; pass `[]` to disable.
   */
  trackedEntities?: ReadonlyArray<TrackedEntity>;
  /**
   * Sprint 6A.2g.A (2026-04-26) — the rec's resolved target URL, if the
   * caller has run the page-intent resolver. When non-null,
   * `allowedTargetUrls` is constrained to anchor the LLM to this single
   * URL (or just the `needs_new_page` sentinel for page-lifecycle /
   * "create" recs). Pass `null` to preserve the pre-6A.2g
   * candidate-set + sentinel behavior (test fixtures, callers without
   * a resolution). The production caller `buildPacketForRec` sources
   * this from `rec.resolution.targetUrl`.
   */
  singleTargetUrl: string | null;
  /** Optional historical action-type → outcome rates (Sprint 6A.2 will
   *  populate). Defaults to `[]`. */
  priorOutcomes?: ReadonlyArray<PriorOutcomeBlock>;
  /** Optional override; defaults to v1 active set. */
  allowedActionTypes?: ReadonlyArray<ActionType>;
  /** Cap on candidate URLs scored against the cluster. Defaults to 8. */
  maxCandidatePages?: number;
  /** Cap on element rows per packet. Defaults to 80 (10 candidate pages
   *  × 8 elements average). Generators don't need every list/H3/anchor. */
  maxTargetElements?: number;
  /**
   * W3 Step 3.2 (2026-05-01) — citation evidence index for competitor
   * page blueprint topic enrichment. Optional; pass `null` when the
   * caller hasn't loaded it (test fixtures). Empty / null index =>
   * blueprints still emit (driven by observation citation_urls), just
   * without `topic`.
   */
  citationEvidenceIndex?: CitationEvidenceIndex | null;
  /**
   * W3 Step 3.2 — competitor-page evidence rows for blueprint title
   * enrichment. Optional; empty array disables enrichment. Producer:
   * `src/domains/pages/competitor-evidence.ts`.
   */
  competitorPages?: ReadonlyArray<CompetitorPageEvidence>;
  now?: Date;
};

const DEFAULT_MAX_CANDIDATE_PAGES = 8;
const DEFAULT_MAX_TARGET_ELEMENTS = 80;
const DEFAULT_MAX_DESCRIPTORS_PER_PROMPT = 6;
const DEFAULT_MAX_H2S_PER_CANDIDATE = 8;
// Sprint 6A.2g.E (2026-04-26) — caps locked by operator scope.
// Per-prompt: 10 search queries, 10 cited URLs, 5 descriptor windows.
const MAX_ACTUAL_SEARCH_QUERIES_PER_PROMPT = 10;
const MAX_CITED_SOURCE_PAGES_PER_PROMPT = 10;
const MAX_DESCRIPTOR_WINDOWS_PER_PROMPT = 5;

// W3 Step 3.2 (2026-05-01) — packet-wide aiSearchSignal caps. The
// per-prompt evidence-priority caps above run BEFORE these; this
// block is the cross-prompt aggregate after dedupe + count.
const DEFAULT_MAX_AI_SEARCH_QUERIES = 10;
const DEFAULT_MAX_AI_DESCRIPTORS = 12;
const DEFAULT_MAX_AI_COMPETITOR_CO_MENTIONS = 8;
// Cap on competitor-page blueprints. Operator scope: 5.
const DEFAULT_MAX_COMPETITOR_PAGE_BLUEPRINTS = 5;

export function buildSpecificEditEvidencePacket(
  args: BuildSpecificEditEvidencePacketArgs,
): SpecificEditEvidencePacket {
  const now = args.now ?? new Date();
  const affectedSet = new Set(args.affectedPromptIds);

  const promptTextById = new Map(
    args.trackedPrompts.map((p) => [p.id, p.text]),
  );
  const opportunityById = new Map(
    args.promptOpportunities.map((op) => [op.prompt_id, op]),
  );
  const summaryById = new Map(
    args.primarySummaries.map((s) => [s.prompt_id, s]),
  );

  // Sprint 6A.2g.E (2026-04-26) — group observations by prompt_id so the
  // affected-prompt block builder can aggregate Phase D extraction +
  // citation URLs + descriptor windows per prompt without re-scanning
  // the full observation list per affected prompt. Sort within each
  // group by (observed_at, id) for hash determinism — observations may
  // arrive in any order from the repository.
  const observationsByPromptId = new Map<string, PromptAnswerObservation[]>();
  for (const o of args.observations) {
    const arr = observationsByPromptId.get(o.prompt_id);
    if (arr) arr.push(o);
    else observationsByPromptId.set(o.prompt_id, [o]);
  }
  for (const arr of observationsByPromptId.values()) {
    arr.sort((a, b) => {
      const at = a.observed_at ?? "";
      const bt = b.observed_at ?? "";
      if (at !== bt) return at.localeCompare(bt);
      return (a.id ?? "").localeCompare(b.id ?? "");
    });
  }

  const affectedPrompts = buildAffectedPromptBlocks(
    args.affectedPromptIds,
    promptTextById,
    opportunityById,
    summaryById,
    observationsByPromptId,
  );

  const ownedPageCandidates = buildOwnedPageCandidates(
    args.clusterLabel,
    args.clusterKind,
    args.ownedPageInventory,
    args.affectedPromptIds,
    promptTextById,
    args.maxCandidatePages ?? DEFAULT_MAX_CANDIDATE_PAGES,
  );

  const candidateUrlSet = new Set(
    ownedPageCandidates.map((c) => c.url),
  );

  const targetPageElements = buildTargetPageElements(
    candidateUrlSet,
    args.pageElementInventory,
    args.maxTargetElements ?? DEFAULT_MAX_TARGET_ELEMENTS,
  );

  // Step 1.4 (master plan) — exclude directories + generic-noun mentions
  // from the competitor angles block. Filter is shared with the /today
  // leaderboard so the two surfaces agree on "who counts as a competitor".
  const competitorRankingFilter = makeCompetitorRankingFilter(
    args.trackedEntities ?? [],
  );
  const competitorAngles = buildCompetitorAngles(
    args.affectedPromptIds,
    summaryById,
    competitorRankingFilter,
  );

  // W3 Step 3.2 (2026-05-01) — Recommendation Engine v2 evidence
  // foundation. All three blocks land here. Always populated (empty
  // arrays for the missing-data case) so evidenceHash is deterministic.
  const aiSearchSignal = buildAiSearchSignal({
    affectedPromptIds: args.affectedPromptIds,
    observationsByPromptId,
    competitorRankingFilter,
  });

  const ownedDomains = collectOwnedDomains(args.ownedPageInventory);
  const competitorPageBlueprints = buildCompetitorPageBlueprints({
    affectedPromptIds: args.affectedPromptIds,
    observationsByPromptId,
    citationEvidenceIndex: args.citationEvidenceIndex ?? null,
    competitorPages: args.competitorPages ?? [],
    ownedDomains,
  });

  const crossTenantPatterns = getCrossTenantPatterns({
    tenantId: args.tenantId,
    actionTypes: args.allowedActionTypes ?? defaultAllowedActionTypes(),
    clusterKind: args.clusterKind,
    clusterLabel: args.clusterLabel,
  });

  const allowedActionTypes = (
    args.allowedActionTypes ?? defaultAllowedActionTypes()
  )
    // De-dupe + sort for hash stability (caller may pass a mutable array
    // in unspecified order).
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice()
    .sort();

  // Sprint 6A.2g.A (2026-04-26) — `allowedTargetUrls` consults
  // `allowedActionTypes` so the page-level-only branch can fire. Order
  // change: action-type resolution moved BEFORE target-URL resolution.
  const allowedTargetUrls = buildAllowedTargetUrls(
    candidateUrlSet,
    args.singleTargetUrl,
    allowedActionTypes,
  );

  const priorOutcomes = (args.priorOutcomes ?? [])
    .slice()
    .sort((a, b) =>
      a.actionType.localeCompare(b.actionType),
    );

  // Build packet WITHOUT evidenceHash, hash it, then attach.
  const withoutHash: Omit<SpecificEditEvidencePacket, "evidenceHash"> = {
    schemaVersion: "specific-edit/v1",
    generatedAt: now.toISOString(),
    tenantId: args.tenantId,
    recId: args.recId,
    clusterId: args.clusterId ?? null,
    clusterLabel: args.clusterLabel,
    clusterKind: args.clusterKind,
    affectedPrompts,
    ownedPageCandidates,
    targetPageElements,
    competitorAngles,
    priorOutcomes,
    allowedTargetUrls,
    allowedActionTypes: [...allowedActionTypes],
    // W3 Step 3.2 (2026-05-01) — three new blocks. evidenceHash is
    // computed AFTER they're populated, so any change to the
    // aggregated search signal / blueprints / cross-tenant pattern
    // contents flips the hash and invalidates downstream caches.
    aiSearchSignal,
    competitorPageBlueprints,
    crossTenantPatterns,
  };

  const evidenceHash = computeEvidenceHash(withoutHash);

  return { ...withoutHash, evidenceHash };
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

function buildAffectedPromptBlocks(
  affectedPromptIds: ReadonlyArray<string>,
  promptTextById: ReadonlyMap<string, string>,
  opportunityById: ReadonlyMap<string, PromptOpportunity>,
  summaryById: ReadonlyMap<string, PromptPrimarySummary>,
  observationsByPromptId: ReadonlyMap<string, ReadonlyArray<PromptAnswerObservation>>,
): AffectedPromptBlock[] {
  const out: AffectedPromptBlock[] = [];
  for (const promptId of affectedPromptIds) {
    const op = opportunityById.get(promptId);
    const summary = summaryById.get(promptId);
    const observations = observationsByPromptId.get(promptId) ?? [];

    const observationCount =
      op?.evidence.observationCount ?? summary?.totalAnswers ?? 0;
    const brandPrimaryShare = summary?.ritzPrimaryShare ?? 0;

    let topPrimaryCompetitor: { name: string; share: number } | null = null;
    if (summary && summary.totalAnswers > 0) {
      const top = summary.primaryCompetitors[0];
      if (top && top.primaryCount > 0) {
        topPrimaryCompetitor = {
          name: top.name,
          share: round2(top.primaryCount / summary.totalAnswers),
        };
      }
    }

    // Sprint 6A.2g.E (2026-04-26) — evidence-priority enrichment.
    // Aggregate Phase D extraction + citation URLs + descriptor windows
    // across this prompt's observations. Dedupe is exact-string (we
    // preserve the verbatim form the AI emitted). Order is deterministic:
    // observations are pre-sorted by (observed_at, id) at the call site,
    // and within each observation the source array's order is preserved.
    // First-seen wins.
    const actualSearchQueries = collectFromObservations(
      observations,
      MAX_ACTUAL_SEARCH_QUERIES_PER_PROMPT,
      (o) => extractSearchQueriesFromMetadata(o.metadata),
    );
    const citedSourcePages = collectFromObservations(
      observations,
      MAX_CITED_SOURCE_PAGES_PER_PROMPT,
      (o) => o.citation_urls ?? null,
    );
    const descriptorWindows = collectFromObservations(
      observations,
      MAX_DESCRIPTOR_WINDOWS_PER_PROMPT,
      (o) => o.descriptor_window ?? null,
    );

    out.push({
      promptId,
      promptText: promptTextById.get(promptId) ?? promptId,
      category: op?.category ?? "early",
      observationCount,
      brandPrimaryShare: round2(brandPrimaryShare),
      topPrimaryCompetitor,
      descriptorsNearBrand:
        op?.evidence.topDescriptors.slice(
          0,
          DEFAULT_MAX_DESCRIPTORS_PER_PROMPT,
        ) ?? [],
      actualSearchQueries,
      citedSourcePages,
      descriptorWindows,
    });
  }
  return out;
}

/**
 * Sprint 6A.2g.E — generic helper. Iterate observations in caller order,
 * pull each observation's contribution via `getContribution`, push
 * non-empty + non-duplicate strings into an accumulator until the cap
 * is reached. Pre-Phase-D observations whose contribution is null /
 * undefined / non-array contribute nothing — graceful empty.
 */
function collectFromObservations(
  observations: ReadonlyArray<PromptAnswerObservation>,
  cap: number,
  getContribution: (o: PromptAnswerObservation) => unknown,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of observations) {
    if (out.length >= cap) break;
    const contribution = getContribution(o);
    if (!Array.isArray(contribution)) continue;
    for (const item of contribution) {
      if (out.length >= cap) break;
      if (typeof item !== "string" || item.length === 0) continue;
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

/**
 * Sprint 6A.2g.E — defensive accessor for Phase-D-era extracted search
 * queries. Returns null when the observation predates Phase D (no
 * `metadata.extracted` block) or when the field is the wrong shape.
 * The polling adapter writes `metadata.extracted.searchQueries` as
 * `string[]` for OpenAI native polls and `[]` (empty) for Perplexity
 * (honest blind spot).
 */
function extractSearchQueriesFromMetadata(
  metadata: unknown,
): unknown {
  if (!metadata || typeof metadata !== "object") return null;
  const extracted = (metadata as Record<string, unknown>).extracted;
  if (!extracted || typeof extracted !== "object") return null;
  return (extracted as Record<string, unknown>).searchQueries;
}

function buildOwnedPageCandidates(
  clusterLabel: string | null,
  clusterKind: SpecificEditClusterKind | null,
  ownedPageInventory: ReadonlyArray<PageInventoryEntry>,
  affectedPromptIds: ReadonlyArray<string>,
  promptTextById: ReadonlyMap<string, string>,
  topN: number,
): OwnedPageCandidateBlock[] {
  if (ownedPageInventory.length === 0) return [];

  // Match label preference: clusterLabel, fall back to first affected
  // prompt's text. If neither is available, return [] gracefully.
  const matchLabel =
    clusterLabel ??
    promptTextById.get(affectedPromptIds[0] ?? "") ??
    null;
  if (!matchLabel) return [];

  const matches = matchClusterToInventory({
    label: matchLabel,
    kind: clusterKind,
    inventory: ownedPageInventory,
    topN,
  });

  return matches.map((m) => ({
    url: m.url,
    routeType: m.entry.routeType,
    detectedGeo: m.entry.detectedGeo,
    detectedService: m.entry.detectedService,
    matchScore: round2(m.score),
    matchReasons: m.reasons.slice(0, 4),
    title: m.entry.title,
    h1: m.entry.h1,
    h2s: m.entry.h2s.slice(0, DEFAULT_MAX_H2S_PER_CANDIDATE),
  }));
}

function buildTargetPageElements(
  candidateUrlSet: ReadonlySet<string>,
  pageElementInventory: ReadonlyArray<PageElementInventoryRow>,
  maxElements: number,
): TargetPageElementBlock[] {
  if (candidateUrlSet.size === 0) return [];
  if (pageElementInventory.length === 0) return [];

  // Filter to candidate URLs first; then dedupe to the freshest row per
  // (url, element_key) by observed_at. Same element_key reused across
  // snapshots = evolving content; we want the latest.
  const filtered = pageElementInventory.filter((r) =>
    candidateUrlSet.has(r.url),
  );

  const latestByKey = new Map<string, PageElementInventoryRow>();
  for (const row of filtered) {
    const key = `${row.url}\u0000${row.element_key}`;
    const existing = latestByKey.get(key);
    if (!existing || row.observed_at > existing.observed_at) {
      latestByKey.set(key, row);
    }
  }

  // Stable order for hash determinism: by url asc, then element_key asc.
  const ordered = [...latestByKey.values()].sort(
    (a, b) =>
      a.url.localeCompare(b.url) ||
      a.element_key.localeCompare(b.element_key),
  );

  const capped = ordered.slice(0, maxElements);

  return capped.map((row) => ({
    url: row.url,
    elementKey: row.element_key,
    elementType: row.element_type,
    displayLabel: row.display_label,
    elementText: row.element_text,
    elementMetadata: row.element_metadata,
  }));
}

function buildCompetitorAngles(
  affectedPromptIds: ReadonlyArray<string>,
  summaryById: ReadonlyMap<string, PromptPrimarySummary>,
  /**
   * Step 1.4 (master plan) — predicate returns `true` for names that
   * should rank as competitors in the recommendation evidence packet.
   * Directories ("Houzz") and generic nouns ("General Contractors") are
   * filtered out so the LLM doesn't get instructed to counter them.
   * Optional: when undefined, every name is allowed (legacy behaviour).
   */
  shouldRankAsCompetitor?: (name: string) => boolean,
): CompetitorAngleBlock[] {
  const totalAffected = affectedPromptIds.length;
  if (totalAffected === 0) return [];

  type Acc = { promptsWherePrimary: number; totalPrimaryObservations: number };
  const counts = new Map<string, Acc>();

  for (const promptId of affectedPromptIds) {
    const summary = summaryById.get(promptId);
    if (!summary) continue;
    for (const c of summary.primaryCompetitors) {
      if (c.primaryCount <= 0) continue;
      if (shouldRankAsCompetitor && !shouldRankAsCompetitor(c.name)) continue;
      const acc = counts.get(c.name) ?? {
        promptsWherePrimary: 0,
        totalPrimaryObservations: 0,
      };
      acc.promptsWherePrimary += 1;
      acc.totalPrimaryObservations += c.primaryCount;
      counts.set(c.name, acc);
    }
  }

  const out: CompetitorAngleBlock[] = [];
  for (const [name, acc] of counts) {
    out.push({
      competitorName: name,
      promptsWherePrimary: acc.promptsWherePrimary,
      totalAffectedPrompts: totalAffected,
      totalPrimaryObservations: acc.totalPrimaryObservations,
    });
  }
  // Stable order: most "primary" prompts first; ties broken by total
  // observations desc; then alphabetical for hash determinism.
  out.sort(
    (a, b) =>
      b.promptsWherePrimary - a.promptsWherePrimary ||
      b.totalPrimaryObservations - a.totalPrimaryObservations ||
      a.competitorName.localeCompare(b.competitorName),
  );
  return out;
}

// ---------------------------------------------------------------------------
// W3 Step 3.2 (2026-05-01) — aiSearchSignal + competitorPageBlueprints.
// Both pure aggregators over already-grouped observations. No I/O, no LLM,
// no entity-registry mutation. Block-builder hard rules:
//   - Empty input -> empty output, never null / undefined / fake data.
//   - Stable ordering (count desc, ties broken alphabetically) so
//     evidenceHash is deterministic.
//   - Caps applied AFTER sort so the "top N" set is the highest-count N.
//   - Filters route directories + generic-noun mentions through
//     entity-pollution-filter; "real competitor" predicate is the
//     same one used by competitorAngles + the /today leaderboard.
// ---------------------------------------------------------------------------

type BuildAiSearchSignalArgs = {
  affectedPromptIds: ReadonlyArray<string>;
  observationsByPromptId: ReadonlyMap<
    string,
    ReadonlyArray<PromptAnswerObservation>
  >;
  /** Returns true for "rank as competitor" — see makeCompetitorRankingFilter. */
  competitorRankingFilter: (name: string) => boolean;
};

function buildAiSearchSignal(
  args: BuildAiSearchSignalArgs,
): AiSearchSignalBlock {
  const queries = new Map<
    string,
    { count: number; promptIds: Set<string>; platforms: Set<string> }
  >();
  const descriptors = new Map<
    string,
    { count: number; promptIds: Set<string> }
  >();
  const competitors = new Map<
    string,
    { count: number; promptIds: Set<string> }
  >();

  for (const promptId of args.affectedPromptIds) {
    const observations = args.observationsByPromptId.get(promptId) ?? [];
    for (const o of observations) {
      // Search queries — verbatim AI-emitted strings. Empty for AIO
      // (Google AI Overviews never expose) and Perplexity Sonar.
      if (Array.isArray(o.search_queries)) {
        for (const raw of o.search_queries) {
          if (typeof raw !== "string") continue;
          const q = raw.trim();
          if (q.length === 0) continue;
          const acc = queries.get(q) ?? {
            count: 0,
            promptIds: new Set<string>(),
            platforms: new Set<string>(),
          };
          acc.count += 1;
          acc.promptIds.add(promptId);
          if (typeof o.platform === "string" && o.platform.length > 0) {
            acc.platforms.add(o.platform);
          }
          queries.set(q, acc);
        }
      }

      // Descriptor windows — Schema v2.1 deterministic extraction.
      // Lowercased to match observation extractor convention.
      if (Array.isArray(o.descriptor_window)) {
        for (const raw of o.descriptor_window) {
          if (typeof raw !== "string") continue;
          const d = raw.trim().toLowerCase();
          if (d.length === 0) continue;
          const acc = descriptors.get(d) ?? {
            count: 0,
            promptIds: new Set<string>(),
          };
          acc.count += 1;
          acc.promptIds.add(promptId);
          descriptors.set(d, acc);
        }
      }

      // Competitor co-mentions — already canonical entity names per
      // Schema v2.1 extractor; filter through entity-pollution-filter
      // to drop directories / generic nouns.
      if (Array.isArray(o.competitor_co_mentions)) {
        for (const raw of o.competitor_co_mentions) {
          if (typeof raw !== "string") continue;
          const name = raw.trim();
          if (name.length === 0) continue;
          if (!args.competitorRankingFilter(name)) continue;
          const acc = competitors.get(name) ?? {
            count: 0,
            promptIds: new Set<string>(),
          };
          acc.count += 1;
          acc.promptIds.add(promptId);
          competitors.set(name, acc);
        }
      }
    }
  }

  const topSearchQueries: AiSearchQueryAggregate[] = [...queries.entries()]
    .map(([query, acc]) => ({
      query,
      count: acc.count,
      promptIds: [...acc.promptIds].sort(),
      platforms: [...acc.platforms].sort(),
    }))
    .sort(
      (a, b) =>
        b.count - a.count || a.query.localeCompare(b.query),
    )
    .slice(0, DEFAULT_MAX_AI_SEARCH_QUERIES);

  const topDescriptors: AiDescriptorAggregate[] = [...descriptors.entries()]
    .map(([word, acc]) => ({
      word,
      count: acc.count,
      promptIds: [...acc.promptIds].sort(),
    }))
    .sort(
      (a, b) => b.count - a.count || a.word.localeCompare(b.word),
    )
    .slice(0, DEFAULT_MAX_AI_DESCRIPTORS);

  const topCompetitorCoMentions: AiCompetitorCoMentionAggregate[] = [
    ...competitors.entries(),
  ]
    .map(([competitorName, acc]) => ({
      competitorName,
      count: acc.count,
      promptIds: [...acc.promptIds].sort(),
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.competitorName.localeCompare(b.competitorName),
    )
    .slice(0, DEFAULT_MAX_AI_COMPETITOR_CO_MENTIONS);

  return {
    topSearchQueries,
    topDescriptors,
    topCompetitorCoMentions,
    caps: {
      maxSearchQueries: DEFAULT_MAX_AI_SEARCH_QUERIES,
      maxDescriptors: DEFAULT_MAX_AI_DESCRIPTORS,
      maxCompetitorCoMentions: DEFAULT_MAX_AI_COMPETITOR_CO_MENTIONS,
    },
  };
}

type BuildCompetitorPageBlueprintsArgs = {
  affectedPromptIds: ReadonlyArray<string>;
  observationsByPromptId: ReadonlyMap<
    string,
    ReadonlyArray<PromptAnswerObservation>
  >;
  citationEvidenceIndex: CitationEvidenceIndex | null;
  competitorPages: ReadonlyArray<CompetitorPageEvidence>;
  /** Lowercased domain set (stripped of "www.") sourced from owned page
   *  inventory. Citations whose domain matches are dropped (we never
   *  blueprint owned pages). */
  ownedDomains: ReadonlySet<string>;
};

function buildCompetitorPageBlueprints(
  args: BuildCompetitorPageBlueprintsArgs,
): CompetitorPageBlueprint[] {
  // Aggregate citation_urls across observations of affected prompts.
  // Use citation_domain_classes (parallel array) to filter to
  // class === "competitor" — this is the cleanest signal we have for
  // "is this a real competitor page" without re-running domain
  // classification here. Pre-Commit-7 rows have null citation_urls;
  // they contribute nothing — graceful empty.
  type Acc = {
    url: string;
    domain: string;
    citationCount: number;
    promptIds: Set<string>;
  };
  const byUrl = new Map<string, Acc>();

  for (const promptId of args.affectedPromptIds) {
    const observations = args.observationsByPromptId.get(promptId) ?? [];
    for (const o of observations) {
      const urls = Array.isArray(o.citation_urls) ? o.citation_urls : null;
      const classes = Array.isArray(o.citation_domain_classes)
        ? o.citation_domain_classes
        : null;
      if (!urls) continue;
      for (let i = 0; i < urls.length; i++) {
        const rawUrl = urls[i];
        if (typeof rawUrl !== "string") continue;
        const url = rawUrl.trim();
        if (url.length === 0) continue;

        // Class-based filter when available — only "competitor"
        // entries are blueprints. When class array is missing or
        // shorter, fall back to domain-based exclusion (drop
        // owned + directory).
        const klass = classes?.[i];
        if (typeof klass === "string") {
          if (klass !== "competitor") continue;
        }

        const domain = extractDomain(url);
        if (!domain) continue;
        if (args.ownedDomains.has(domain)) continue;
        if (DIRECTORY_DOMAINS_FOR_FILTER.has(domain)) continue;

        const acc = byUrl.get(url) ?? {
          url,
          domain,
          citationCount: 0,
          promptIds: new Set<string>(),
        };
        acc.citationCount += 1;
        acc.promptIds.add(promptId);
        byUrl.set(url, acc);
      }
    }
  }

  if (byUrl.size === 0) return [];

  // Enrichment lookups built once.
  const titleByUrl = new Map<string, string>();
  const topicByUrl = new Map<string, string>();
  for (const cp of args.competitorPages) {
    if (cp.pageTitle && !titleByUrl.has(cp.pageUrl)) {
      titleByUrl.set(cp.pageUrl, cp.pageTitle);
    }
    if (cp.topic && !topicByUrl.has(cp.pageUrl)) {
      topicByUrl.set(cp.pageUrl, cp.topic);
    }
  }
  if (args.citationEvidenceIndex) {
    for (const rollup of args.citationEvidenceIndex.by_page_and_topic) {
      // Citation index is keyed by page URL; first row wins (it's
      // the dominant topic).
      if (!topicByUrl.has(rollup.page_url) && rollup.topic) {
        topicByUrl.set(rollup.page_url, rollup.topic);
      }
    }
  }

  const blueprints: CompetitorPageBlueprint[] = [...byUrl.values()]
    .map((acc) => ({
      url: acc.url,
      domain: acc.domain,
      topic: topicByUrl.get(acc.url) ?? null,
      citationCount: acc.citationCount,
      promptsCitedOn: [...acc.promptIds].sort(),
      pageTitle: titleByUrl.get(acc.url) ?? null,
      // Future-proof structural fields. Producer doesn't capture
      // these yet; never invented.
      h1: null,
      topH2s: [],
      faqQuestions: [],
      metaDescription: null,
    }))
    .sort(
      (a, b) =>
        b.citationCount - a.citationCount ||
        b.promptsCitedOn.length - a.promptsCitedOn.length ||
        a.url.localeCompare(b.url),
    )
    .slice(0, DEFAULT_MAX_COMPETITOR_PAGE_BLUEPRINTS);

  return blueprints;
}

function collectOwnedDomains(
  ownedPageInventory: ReadonlyArray<PageInventoryEntry>,
): Set<string> {
  const out = new Set<string>();
  for (const entry of ownedPageInventory) {
    const domain = extractDomain(entry.url);
    if (domain) out.add(domain);
  }
  return out;
}

// ---------------------------------------------------------------------------
// W3 Step 3.4 (2026-05-02) — packet-signal derivation for confidence rubric.
//
// Closes the loop between Step 3.2 (evidence packet foundation) and
// Step 3.3 (confidence rubric): the load-queue stamps `engineConfidence`
// per rec, and `hasAiSearchSignal` / `hasCompetitorPageBlueprints` should
// reflect the REAL packet, not hardcoded `false`.
//
// `hasAiSearchSignalForRec` + `hasCompetitorPageBlueprintsForRec` are
// thin pure helpers that run the same aggregations as the full packet
// builder but return only booleans. They avoid loading the
// `pageElementInventory` / `citationEvidenceIndex` / `competitorPages`
// the page-render path doesn't already have. The cost stays bounded:
// O(observations of affected prompts) per rec.
//
// Once Step 3.4's LLM provider activates and `runProviderAndPersist`
// runs at queue load time, callers can pass the FULL packet's blocks
// (`packet.aiSearchSignal.topSearchQueries.length > 0`, etc.) — these
// helpers exist so we don't have to build the full packet just for the
// confidence stamp.
// ---------------------------------------------------------------------------

/**
 * Return true when at least one observation across the affected prompts
 * carries a real AI search signal — verbatim search query, descriptor
 * window, or competitor co-mention (filtered through the entity-
 * pollution-filter so directories don't count). Mirrors
 * `buildAiSearchSignal`'s decision to drop empties / non-strings /
 * polluted entities.
 *
 * Pure. Empty observations / empty affected prompts → `false`.
 */
export function hasAiSearchSignalForRec(args: {
  affectedPromptIds: ReadonlyArray<string>;
  observations: ReadonlyArray<PromptAnswerObservation>;
  trackedEntities?: ReadonlyArray<TrackedEntity>;
}): boolean {
  if (args.affectedPromptIds.length === 0) return false;
  if (args.observations.length === 0) return false;

  const affectedSet = new Set(args.affectedPromptIds);
  const competitorRankingFilter = makeCompetitorRankingFilter(
    args.trackedEntities ?? [],
  );

  for (const o of args.observations) {
    if (!affectedSet.has(o.prompt_id)) continue;

    if (Array.isArray(o.search_queries)) {
      for (const raw of o.search_queries) {
        if (typeof raw === "string" && raw.trim().length > 0) return true;
      }
    }
    if (Array.isArray(o.descriptor_window)) {
      for (const raw of o.descriptor_window) {
        if (typeof raw === "string" && raw.trim().length > 0) return true;
      }
    }
    if (Array.isArray(o.competitor_co_mentions)) {
      for (const raw of o.competitor_co_mentions) {
        if (typeof raw !== "string") continue;
        const name = raw.trim();
        if (name.length === 0) continue;
        if (!competitorRankingFilter(name)) continue;
        return true;
      }
    }
  }
  return false;
}

/**
 * Return true when at least one observation across the affected prompts
 * cites a competitor URL that would survive `buildCompetitorPageBlueprints`
 * filtering — class === "competitor" (preferred) or, when the class
 * array is missing, a non-owned non-directory domain.
 *
 * Pure. Mirrors the same drop rules the full builder applies.
 */
export function hasCompetitorPageBlueprintsForRec(args: {
  affectedPromptIds: ReadonlyArray<string>;
  observations: ReadonlyArray<PromptAnswerObservation>;
  ownedPageInventory: ReadonlyArray<PageInventoryEntry>;
}): boolean {
  if (args.affectedPromptIds.length === 0) return false;
  if (args.observations.length === 0) return false;

  const affectedSet = new Set(args.affectedPromptIds);
  const ownedDomains = collectOwnedDomains(args.ownedPageInventory);

  for (const o of args.observations) {
    if (!affectedSet.has(o.prompt_id)) continue;
    const urls = Array.isArray(o.citation_urls) ? o.citation_urls : null;
    const classes = Array.isArray(o.citation_domain_classes)
      ? o.citation_domain_classes
      : null;
    if (!urls) continue;
    for (let i = 0; i < urls.length; i++) {
      const rawUrl = urls[i];
      if (typeof rawUrl !== "string") continue;
      const url = rawUrl.trim();
      if (url.length === 0) continue;

      const klass = classes?.[i];
      if (typeof klass === "string") {
        if (klass !== "competitor") continue;
      }

      const domain = extractDomain(url);
      if (!domain) continue;
      if (ownedDomains.has(domain)) continue;
      if (DIRECTORY_DOMAINS_FOR_FILTER.has(domain)) continue;

      return true;
    }
  }
  return false;
}

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    // Relative URL ("/services/foo") — operator-locked to owned site so
    // it COULD be owned; treat as null and let the caller decide.
    return null;
  }
}

function buildAllowedTargetUrls(
  candidateUrlSet: ReadonlySet<string>,
  singleTargetUrl: string | null,
  actionTypes: ReadonlyArray<ActionType>,
): string[] {
  // Sprint 6A.2g.A (2026-04-26) — strict target alignment.
  //
  // The pre-6A.2g shape was `[...owned-candidates.sort(), NEEDS_NEW_PAGE]`,
  // i.e. the LLM could pick any owned URL the cluster-matcher scored.
  // Sprint 6A.2f shipped the first `--write` and the model picked
  // `/custom-home-builder-bay-area` for a rec resolved to
  // `/services/whole-home-remodel` because both pages cleared cluster
  // scoring — the model had no way to know which one mattered. Operator
  // declined the edits.
  //
  // Sprint 6A.2g.A constrains the enum once the page-intent resolver
  // has decided. When the caller passes a real `singleTargetUrl`:
  //   - All active action types are page-level (every elementTypeDomain
  //     is empty — split / merge / create / watch): the action's
  //     "target" is conceptually a new page, so [NEEDS_NEW_PAGE].
  //   - `singleTargetUrl === NEEDS_NEW_PAGE`: the rec itself resolved
  //     to "create a new page", so [NEEDS_NEW_PAGE].
  //   - Otherwise (real URL + ≥1 content-level action): [singleTargetUrl]
  //     ONLY. No sentinel escape — the model anchors to the rec's
  //     resolved page or returns an empty bundle (Rule 5).
  //
  // When `singleTargetUrl === null` (legacy callers / test fixtures
  // without a resolution), preserve the pre-6A.2g shape so existing
  // tests + non-resolution-aware callers keep working.
  if (singleTargetUrl !== null) {
    const allPageLevel =
      actionTypes.length > 0 &&
      actionTypes.every(
        (t) => ACTION_TYPE_REGISTRY[t].elementTypeDomain.length === 0,
      );
    if (singleTargetUrl === NEEDS_NEW_PAGE || allPageLevel) {
      return [NEEDS_NEW_PAGE];
    }
    return [singleTargetUrl];
  }
  const out = [...candidateUrlSet].sort();
  out.push(NEEDS_NEW_PAGE);
  return out;
}

function defaultAllowedActionTypes(): ActionType[] {
  return ACTION_TYPES.filter(
    (t) => ACTION_TYPE_REGISTRY[t].generatorActive,
  );
}

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

/**
 * Compute a 16-char hex prefix of sha256 over the canonical-stringified
 * packet (everything except `evidenceHash`). 16 hex chars = 64 bits of
 * entropy — collision probability is negligible at the volumes Beacon
 * generates (low thousands of recs/tenant/day).
 *
 * `generatedAt` is INCLUDED in the hash by design: a packet built one
 * second after another with otherwise identical inputs is genuinely a
 * different cache entry. Callers that want timestamp-independent
 * caching should pass the same `now` value.
 *
 * The hash is built off the same canonical-stringify the existing
 * adjudicator packet uses (key-sorted, array-stable) so future tooling
 * that compares packets across systems is consistent.
 */
function computeEvidenceHash(
  withoutHash: Omit<SpecificEditEvidencePacket, "evidenceHash">,
): string {
  const canonical = canonicalStringify(withoutHash);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
