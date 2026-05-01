import "server-only";

/**
 * Native Perplexity polling adapter (pure).
 *
 * Given a tenantId, this function reads tracked prompts + entities, calls the
 * Perplexity API client once per active prompt, and maps each response into
 * the Profound-shaped `PromptAnswerObservation` type the UI already reads.
 *
 * It performs ZERO writes — the caller (script or route handler) is
 * responsible for persisting via `syncPromptAnswerObservations`,
 * `syncAnswerTexts`, and `syncObservationRuns`.
 *
 * Why this shape: the existing UI surfaces (Today, /pages, /competitors) read
 * `prompt_answer_observations`. A separate sampling pipeline
 * (`scripts/sample-visibility.ts`) writes to a different, dead-end store
 * (`.data/answer-snapshots.json`). This adapter intentionally bypasses that
 * path and feeds the live UI spine directly.
 */

import { createHash } from "node:crypto";
import { createPerplexityClient } from "@/lib/querying/perplexity-client";
import type { QueryClient, QueryUsage } from "@/lib/querying/types";
import { getRepository } from "@/lib/persistence/repositories";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { ObservationRun } from "@/domains/observations/types";
// Sprint 6A.3c (2026-04-26) — cost tracking + runaway protection.
// `estimatePromptCost` (6A.3a) + `checkTenantBudget` / `checkPerRunBudget` /
// `recordSpend` (6A.3b) / `checkMonthlyBudget` (6A.3b). Wiring is
// additive: normal full-native polling runs identically when caps don't
// trip. Caps are operator-set high enough that normal operation never
// hits them — they are runaway protection, not throttling.
import {
  estimatePromptCost,
  type PollProvider,
} from "@/lib/cost/pricing";
import {
  checkTenantBudget,
  checkPerRunBudget,
  recordSpend,
} from "@/lib/cost/budget";
import { checkMonthlyBudget } from "@/lib/cost/monthly";
import {
  extractMentionPosition,
  extractCitationRank,
  rankEntitiesByFirstAppearance,
  extractPrimaryRecommendation,
  extractDescriptorWindow,
  extractCompetitorCoMentions,
  classifyCitationDomains,
  extractAnswerStructure,
} from "@/domains/prompt-answer-observations/extraction";
// Step 1.5 (master plan) — classify failures so the loop only retries
// transient kinds (network blip, timeout, 5xx) and surfaces the rest
// as systemic problems. Rate-limit / auth / invalid-request / parse
// errors are intentionally non-retryable per operator brief.
import {
  classifyPollError,
  dominantFailureKind,
  type PollErrorKind,
} from "./poll-error-classifier";

// Default platform constants for Perplexity. Callers targeting other platforms
// (e.g. ChatGPT adapter in src/adapters/openai/poll.ts) override these via opts
// to reuse the same generic polling logic without duplication.
const DEFAULT_POLL_SOURCE = "perplexity-native-poll";
const DEFAULT_PLATFORM = "perplexity";
const DEFAULT_PARSER_VERSION = "perplexity-native-v1";

/**
 * Sprint 6A.3c (2026-04-26) — additive cost aggregation. Normal runs
 * populate `cost` with the per-call estimates summed across the chunk.
 * `skipReason` flags budget events for higher-level callers (the API
 * route + cron logs) without changing the existing `observationRun.status`
 * enum (still `"completed" | "partial" | "failed"`):
 *   - pre-flight tenant or monthly block → status="failed", skipReason="budget_blocked"
 *   - mid-run per-run cap                → status="partial", skipReason="per_run_blocked"
 *   - normal partial (some prompts errored) → status="partial", skipReason=null
 *   - normal full success                → status="completed", skipReason=null
 */
export type PerplexityPollResult = {
  observations: PromptAnswerObservation[];
  answerTexts: Record<string, string>;
  observationRun: ObservationRun;
  errorCount: number;
  /** Sprint 6A.3c — populated on every run (zeros on hard pre-flight block). */
  cost: {
    totalUsd: number;
    inputTokens: number;
    outputTokens: number;
    webSearchCalls: number;
    /** Number of prompts the provider was successfully sampled for. */
    promptsCompleted: number;
    /** Number of prompts skipped due to a budget event in this run. */
    promptsSkippedBudget: number;
    /**
     * Sprint 6A.3d (2026-04-26) — number of prompts within this run
     * whose normalized text duplicated an earlier prompt's text. Counted
     * once per dupe (the FIRST occurrence is paid for; subsequent
     * occurrences increment this counter without a provider call).
     */
    promptsDeduped: number;
  };
  /** Sprint 6A.3c — null when no budget event. */
  skipReason: "budget_blocked" | "per_run_blocked" | null;
  /** Sprint 6A.3c — operator-facing message when `skipReason` is non-null. */
  budgetReason: string | null;
  /**
   * Step 1.5 (master plan) — observability fields. Surfaced into the
   * API route response + chunk summary log so an operator scanning a
   * cron output can see in one glance whether the chunk's losses were
   * a budget block, a transient network blip, or a systemic auth bug.
   */
  reliability: {
    /** Number of per-prompt retries the loop attempted (max 1 per prompt). */
    retryCount: number;
    /** Failure kind histogram. Empty when zero failures. */
    failureCountsByKind: Record<PollErrorKind, number>;
    /** Most common failure kind in this run (or null when no failures). */
    dominantFailureType: PollErrorKind | null;
    /**
     * Costs that the provider may have billed despite the observation
     * not being persisted (e.g. post-sample parse failure where the
     * answer text was received but extraction broke). Tracked separately
     * from `cost.totalUsd` so the operator can reconcile against the
     * provider dashboard without double-counting.
     */
    estimatedUnconfirmedCostUsd: number;
  };
};

export type PerplexityPollOptions = {
  /** Inject a QueryClient (tests, alternative platforms). Defaults to live Perplexity. */
  client?: QueryClient;
  /** Inject clock for deterministic tests. */
  now?: () => Date;
  /**
   * Skip the first N eligible prompts. Combined with `limit` this defines a
   * chunk window: prompts[offset .. offset+limit). Defaults to 0.
   * (Phase 5 Step 1.5 — hosted chunking for Hobby-tier 300s cap.)
   */
  offset?: number;
  /** Cap how many prompts to poll (dry-runs, budget guards, chunk limit). */
  limit?: number;
  /** Optional pre-fetched prompts; if omitted, read via repository. */
  trackedPrompts?: TrackedPrompt[];
  /** Optional pre-fetched entities; if omitted, read via repository. */
  trackedEntities?: TrackedEntity[];
  /**
   * Platform label stored on observations (lowercase convention:
   * "perplexity", "chatgpt", etc.). Also the value matched against
   * TrackedPrompt.platforms[] when filtering eligible prompts. Defaults
   * to "perplexity".
   */
  platform?: string;
  /**
   * Source label for the observation_run row (e.g. "perplexity-native-poll",
   * "openai-native-poll"). Defaults to the Perplexity source.
   */
  pollSource?: string;
  /**
   * Parser version string stamped on the observation_run row. Defaults to
   * the Perplexity v1 parser tag.
   */
  parserVersion?: string;
};

export async function pollPerplexityForTenant(
  tenantId: string,
  opts: PerplexityPollOptions = {},
): Promise<PerplexityPollResult> {
  const now = opts.now ?? (() => new Date());
  const client = opts.client ?? createPerplexityClient();
  const platform = opts.platform ?? DEFAULT_PLATFORM;
  const pollSource = opts.pollSource ?? DEFAULT_POLL_SOURCE;
  const parserVersion = opts.parserVersion ?? DEFAULT_PARSER_VERSION;

  const repo = getRepository();
  const trackedPrompts =
    opts.trackedPrompts ?? (await repo.getTrackedPrompts());
  const trackedEntities =
    opts.trackedEntities ?? (await repo.getTrackedEntities());

  const activePrompts = trackedPrompts
    .filter((p) => p.is_active)
    .filter(
      (p) => p.platforms.length === 0 || p.platforms.includes(platform),
    );
  // Chunk slicing: offset defaults to 0, limit defaults to "all remaining".
  // When both unset, slice(0, undefined) === full list (back-compat).
  const offset = opts.offset && opts.offset > 0 ? opts.offset : 0;
  const sliceEnd =
    opts.limit && opts.limit > 0 ? offset + opts.limit : undefined;
  const prompts = activePrompts.slice(offset, sliceEnd);

  const activeEntities = trackedEntities.filter((e) => e.is_active);
  const ownedEntities = activeEntities.filter((e) => e.is_owned);
  const ownedDomains = new Set(
    ownedEntities
      .map((e) => e.domain?.toLowerCase())
      .filter((d): d is string => Boolean(d)),
  );
  // Owned-brand match checks name + aliases so variant phrasings
  // ("Ritzbuilders", "Ritz") still resolve to the tracked brand.
  const ownedNameVariants = ownedEntities.flatMap((e) =>
    entityNameVariants(e),
  );

  const startedAt = now().toISOString();
  const runId = `pollrun-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Sprint 6A.3c (2026-04-26) — cost-tracking accumulators. Populated
  // even on early-exit so callers always get a consistent shape.
  const costUsage: { totalUsd: number; inputTokens: number; outputTokens: number; webSearchCalls: number } = {
    totalUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    webSearchCalls: 0,
  };
  let promptsCompleted = 0;
  let promptsSkippedBudget = 0;
  let promptsDeduped = 0;

  // Step 1.5 (master plan) — reliability accumulators.  We track each
  // failure by kind so the chunk summary can name the dominant cause
  // instead of just an opaque errorCount.  retryCount is per-attempt
  // (max one retry per prompt).  estimatedUnconfirmedCostUsd holds
  // billed-but-not-persisted spend from post-sample parse failures.
  let retryCount = 0;
  let estimatedUnconfirmedCostUsd = 0;
  const failureCountsByKind: Record<PollErrorKind, number> = {
    transient_network: 0,
    timeout: 0,
    server_5xx: 0,
    rate_limit: 0,
    auth: 0,
    invalid_request: 0,
    parse_error: 0,
    unknown: 0,
  };
  let skipReason: "budget_blocked" | "per_run_blocked" | null = null;
  let budgetReason: string | null = null;

  // Sprint 6A.3c — pre-flight budget gates. BOTH must pass before any
  // provider call. Loud structured logs on block; status="failed" with
  // skipReason="budget_blocked" so operators / poll-canary can detect.
  // Skipping here counts ALL prompts in this chunk as `promptsSkippedBudget`.
  if (prompts.length > 0) {
    const tenantBudget = checkTenantBudget(tenantId);
    if (!tenantBudget.allowed) {
      skipReason = "budget_blocked";
      budgetReason = tenantBudget.reason ?? "tenant daily cap reached";
      promptsSkippedBudget = prompts.length;
      console.warn(
        `[poll-${platform}] BUDGET_BLOCKED runId=${runId} tenant=${tenantId} ` +
          `kind=tenant_daily reason=${JSON.stringify(budgetReason)} ` +
          `spent=$${tenantBudget.spent_usd.toFixed(4)} cap=$${tenantBudget.cap_usd.toFixed(2)} ` +
          `percent=${tenantBudget.percent}% promptsSkipped=${promptsSkippedBudget}`,
      );
    } else {
      const monthlyBudget = checkMonthlyBudget({ tenantId, now: now() });
      if (!monthlyBudget.allowed) {
        skipReason = "budget_blocked";
        budgetReason = monthlyBudget.reason ?? "monthly cap reached";
        promptsSkippedBudget = prompts.length;
        console.warn(
          `[poll-${platform}] BUDGET_BLOCKED runId=${runId} tenant=${tenantId} ` +
            `kind=monthly month=${monthlyBudget.month_key} reason=${JSON.stringify(budgetReason)} ` +
            `spent=$${monthlyBudget.spent_usd.toFixed(4)} cap=$${monthlyBudget.cap_usd.toFixed(2)} ` +
            `percent=${monthlyBudget.percent}% promptsSkipped=${promptsSkippedBudget}`,
        );
      }
    }
  }

  // Map QueryClient.platform → pricing provider key. Both poll paths
  // (perplexity-native + openai-native via createOpenAIClient) carry
  // the right platform string ("perplexity" / "chatgpt"); the OpenAI
  // adapter overrides via opts.platform="chatgpt".
  const pricingProvider: PollProvider =
    platform === "perplexity" ? "perplexity" : "openai";

  const observations: PromptAnswerObservation[] = [];
  const answerTexts: Record<string, string> = {};
  let errorCount = 0;
  // Track the loop short-circuit so we can attribute the rest of the
  // remaining prompts as "skipped due to budget" — never silent.
  let mid_run_blocked = false;

  // Sprint 6A.3d (2026-04-26) — identical-text prompt dedupe within
  // this single run. Normalization is exact: trim + lowercase. NOT
  // fuzzy. NOT cross-day. The Map keys on normalized text and stores
  // the FIRST prompt id that produced it so dedup-skipped log lines
  // can name the original. Operator-approved tradeoff: identical
  // prompt text = identical signal value, so paying twice in one run
  // is waste. Distinct-but-similar prompts with even one character
  // difference are NOT deduped — coverage preserved.
  const seenPromptText = new Map<string, string>();

  // If pre-flight already blocked, skip the loop entirely (prompts.length
  // are all attributed as promptsSkippedBudget above). The for-of below
  // would no-op anyway because we never enter when skipReason is set,
  // but the explicit guard keeps the intent obvious + the diff readable.
  for (const prompt of skipReason === "budget_blocked" ? [] : prompts) {
    // Sprint 6A.3c — per-run cap check BEFORE each provider call. Halts
    // the loop the moment running cost exceeds BEACON_PER_RUN_BUDGET_USD
    // (default $5; ~6.7x normal chunk spend). Remaining prompts attributed
    // to skippedBudget for honest reporting.
    const perRunCheck = checkPerRunBudget(costUsage.totalUsd);
    if (!perRunCheck.allowed) {
      skipReason = "per_run_blocked";
      budgetReason = perRunCheck.reason ?? "per-run cap reached";
      mid_run_blocked = true;
      // Count completed already; remaining = total - completed - errored.
      const remaining = prompts.length - promptsCompleted - errorCount;
      promptsSkippedBudget = Math.max(0, remaining);
      console.warn(
        `[poll-${platform}] PER_RUN_BLOCKED runId=${runId} tenant=${tenantId} ` +
          `reason=${JSON.stringify(budgetReason)} completed=${promptsCompleted} ` +
          `errored=${errorCount} skipped=${promptsSkippedBudget} ` +
          `spent=$${perRunCheck.spent_usd.toFixed(4)} cap=$${perRunCheck.cap_usd.toFixed(2)} ` +
          `percent=${perRunCheck.percent}%`,
      );
      break;
    }

    // Sprint 6A.3d — identical-text dedupe. Skip provider call when
    // normalized text already appeared this run; transparent via
    // counter + log line.
    const normalizedText = prompt.text.trim().toLowerCase();
    const firstSeenId = seenPromptText.get(normalizedText);
    if (firstSeenId !== undefined) {
      promptsDeduped += 1;
      console.warn(
        `[poll-${platform}] DEDUP_SKIPPED runId=${runId} tenant=${tenantId} ` +
          `promptId=${prompt.id} originalPromptId=${firstSeenId} ` +
          `text=${JSON.stringify(prompt.text.slice(0, 80))}`,
      );
      continue;
    }
    seenPromptText.set(normalizedText, prompt.id);

    // Step 1.5 (master plan) — pre-call cost log. Surfaces accumulating
    // spend BEFORE the next provider call so a cron tail can see exactly
    // when a budget cap is about to bite.
    console.log(
      `[poll-${platform}] PRE_CALL runId=${runId} tenant=${tenantId} ` +
        `promptId=${prompt.id} accCost=$${costUsage.totalUsd.toFixed(4)} ` +
        `completed=${promptsCompleted}/${prompts.length}`,
    );

    let result: Awaited<ReturnType<QueryClient["sample"]>>;
    try {
      result = await client.sample(prompt.text);
    } catch (e) {
      const cls = classifyPollError(e);
      const message = e instanceof Error ? e.message : String(e);
      // Step 1.5 — single retry, ONLY for retryable kinds (transient_network,
      // timeout, server_5xx). Other kinds (auth, rate_limit, invalid_request,
      // parse_error) fail fast — operator brief explicitly forbids retrying
      // those.
      if (cls.retryable) {
        // Increment retryCount on ATTEMPT so the chunk summary surfaces
        // "we tried" even when the second attempt also fails.
        retryCount += 1;
        console.warn(
          `[poll-${platform}] SAMPLE_RETRY runId=${runId} tenant=${tenantId} ` +
            `promptId=${prompt.id} kind=${cls.kind} reason=${JSON.stringify(cls.reason)} ` +
            `attempt=2`,
        );
        // Short backoff — 1s. Inside the chunk's 320s ceiling so a
        // retry never exhausts the workflow timeout.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
          result = await client.sample(prompt.text);
        } catch (e2) {
          const cls2 = classifyPollError(e2);
          const message2 = e2 instanceof Error ? e2.message : String(e2);
          failureCountsByKind[cls2.kind] += 1;
          console.warn(
            `[poll-${platform}] SAMPLE_FAILED runId=${runId} tenant=${tenantId} ` +
              `promptId=${prompt.id} kind=${cls2.kind} reason=${JSON.stringify(cls2.reason)} ` +
              `error=${JSON.stringify(message2)} retried=true`,
          );
          errorCount += 1;
          continue;
        }
      } else {
        failureCountsByKind[cls.kind] += 1;
        console.warn(
          `[poll-${platform}] SAMPLE_FAILED runId=${runId} tenant=${tenantId} ` +
            `promptId=${prompt.id} kind=${cls.kind} reason=${JSON.stringify(cls.reason)} ` +
            `error=${JSON.stringify(message)} retryable=false`,
        );
        errorCount += 1;
        continue;
      }
    }

    try {
      const observedAt = now().toISOString();
      const observationId = `obs-native-${runId}-${prompt.id}`;

      const citationDomains = Array.from(
        new Set(
          result.citations
            .map((c) => c.domain?.toLowerCase())
            .filter((d): d is string => Boolean(d)),
        ),
      );
      // Commit 7 (2026-04-24): preserve full URLs in order so
      // url-citation-history can match native citations at URL granularity
      // against owned-site URL paths. citation_domains is deduped + host-only;
      // citation_urls is order-preserving and full-URL.
      const citationUrls = result.citations
        .map((c) => c.url)
        .filter((u): u is string => Boolean(u));
      const ownedCitationCount = citationDomains.filter((d) =>
        ownedDomains.has(d),
      ).length;

      const mentions = detectMentions(result.answer_text, activeEntities);
      const brandMentioned = ownedNameVariants.some((variant) =>
        containsCaseInsensitive(result.answer_text, variant),
      );

      // Schema v2 Commit 4 (2026-04-24) — must-have-now extraction.
      // Pure, deterministic, cheap: runs inline per prompt. See
      // docs/OBSERVATION_SCHEMA_V2.md for field semantics.
      const mentionPosition = extractMentionPosition(
        result.answer_text,
        ownedNameVariants,
      );
      const citationRank = extractCitationRank(citationDomains, ownedDomains);
      // For the primary-recommendation heuristic we need the order entities
      // appear in the answer. Canonical brand name = first owned entity's
      // canonical name (single-tenant assumption holds single-owned for
      // Ritz; generalizes cleanly to future multi-owned).
      const brandCanonicalName = ownedEntities[0]?.name ?? "";
      const entitiesInOrder = rankEntitiesByFirstAppearance(
        result.answer_text,
        activeEntities,
      );
      const primaryRecommendation = extractPrimaryRecommendation(
        result.answer_text,
        mentionPosition,
        entitiesInOrder,
        brandCanonicalName,
      );

      // Schema v2.1 Commit 6 (2026-04-24) — high-value-soon extraction.
      // Four more deterministic fields: descriptor window around brand,
      // competitor co-mentions ordered, per-citation domain classes,
      // answer structure enum.
      const descriptorWindow = extractDescriptorWindow(
        result.answer_text,
        mentionPosition,
        ownedNameVariants,
      );
      const ownedEntityNames = new Set<string>(
        ownedEntities.map((e) => e.name).filter(Boolean),
      );
      const competitorCoMentions = extractCompetitorCoMentions(
        entitiesInOrder,
        ownedEntityNames,
      );
      const competitorDomains = new Set<string>(
        activeEntities
          .filter((e) => !e.is_owned)
          .map((e) => e.domain?.toLowerCase())
          .filter((d): d is string => Boolean(d)),
      );
      const citationDomainClasses = classifyCitationDomains(
        citationDomains,
        ownedDomains,
        competitorDomains,
      );
      const answerStructure = extractAnswerStructure(result.answer_text);

      // Sprint 6A.3c — cost estimation BEFORE building the observation
      // so `metadata.cost.usd` (6A.2g.D) can carry the rounded amount.
      // Sample failure (caught above) intentionally skips this — we
      // don't book spend the operator wasn't charged for. Missing usage
      // from the provider response → estimate cost is 0; observation
      // still persisted; loop continues (the conservative-fallback
      // contract documented in src/lib/cost/pricing.ts).
      const usage: QueryUsage | undefined = result.usage;
      const promptCost = estimatePromptCost({
        provider: pricingProvider,
        model: result.model,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        webSearchCalls: usage?.webSearchCalls,
      });

      // Sprint 6A.2g.D — extract durable signals into the observation
      // metadata. Every field below ships from the OpenAI Responses API
      // when present; Perplexity Sonar deliberately doesn't expose
      // internal queries / system fingerprint / service tier so those
      // remain undefined on the usage object — `blindSpot` carries the
      // honest record of why.
      const extractedSearchQueries: string[] =
        usage?.webSearchQueries
          ?.map((q) => q.query)
          .filter((s): s is string => typeof s === "string" && s.length > 0) ??
        [];
      const extractedOpenPageUrls: string[] = usage?.openPageUrls ?? [];
      const blindSpot =
        platform === "perplexity"
          ? "Sonar does not expose internal queries; search_queries empty by design."
          : null;

      const obs: PromptAnswerObservation = {
        id: observationId,
        prompt_id: prompt.id,
        run_id: runId,
        answer_hash: hashAnswer(result.answer_text),
        position: null,
        tracked_brand_mentioned: brandMentioned,
        tracked_brand_cited: ownedCitationCount > 0,
        citation_count: result.citations.length,
        owned_citation_count: ownedCitationCount,
        citation_domains: citationDomains,
        citation_categories: {},
        mentions,
        observed_at: observedAt,
        platform,
        topic: prompt.topic_id ?? "",
        metadata: {
          source_system: "beacon_native",
          model: result.model,
          intent_type: prompt.intent_type ?? null,
          location_scope: prompt.location_scope ?? null,
          service_scope: prompt.service_scope ?? null,
          // Sprint 6A.2g.D — per-observation cost (Q1 — duplicated from
          // the run-level aggregate so analysts can slice cost by
          // platform/prompt without rejoining observation_runs).
          cost: {
            usd: roundUsd(promptCost.totalUsd),
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            reasoningTokens: usage?.reasoningTokens ?? 0,
            cachedTokens: usage?.cachedTokens ?? 0,
            webSearchCalls: usage?.webSearchCalls ?? 0,
          },
          // What the AI actually did when answering this prompt.
          extracted: {
            searchQueries: extractedSearchQueries,
            openPageUrls: extractedOpenPageUrls,
            refusalText: usage?.refusalText ?? null,
          },
          // Provider state surfaced for forensic analysis + drift
          // detection (system_fingerprint changes across model
          // snapshots).
          provider: {
            systemFingerprint: usage?.systemFingerprint ?? null,
            serviceTier: usage?.serviceTier ?? null,
            finishReason: usage?.finishReason ?? null,
          },
          // Forensic verbatim — capped at 20 tool calls per Q2. Null
          // when the provider doesn't surface tool calls (Perplexity).
          providerRaw: usage?.providerRaw ?? null,
          // Always null on the success path — observation only persists
          // when the sample succeeds. Failure path (catch above) skips
          // persistence entirely; the structured log records the cause.
          failure: null,
          // Honest blind spot for Perplexity Sonar (no internal queries
          // exposed). Null for OpenAI — extracted.searchQueries carries
          // the real signal.
          blindSpot,
        },
        tenant_id: tenantId,
        mention_position: mentionPosition,
        citation_rank: citationRank,
        primary_recommendation: primaryRecommendation,
        descriptor_window: descriptorWindow,
        competitor_co_mentions: competitorCoMentions,
        citation_domain_classes: citationDomainClasses,
        answer_structure: answerStructure,
        citation_urls: citationUrls,
        // Sprint 6A.2g.D — first-class column dual-populated from
        // extracted queries. OpenAI provides; Perplexity stays empty
        // (the blind spot above explains why).
        search_queries: extractedSearchQueries,
      };

      observations.push(obs);
      answerTexts[observationId] = result.answer_text;
      costUsage.totalUsd = roundUsd(costUsage.totalUsd + promptCost.totalUsd);
      costUsage.inputTokens += usage?.inputTokens ?? 0;
      costUsage.outputTokens += usage?.outputTokens ?? 0;
      costUsage.webSearchCalls += usage?.webSearchCalls ?? 0;
      promptsCompleted += 1;
      // recordSpend writes the .data/cost-ledger.json append. Wrap in
      // try/catch so a disk write failure (e.g. read-only Vercel FS)
      // never breaks the polling loop. The operator's OpenAI dashboard
      // remains the source of truth for absolute spend; a lost ledger
      // row is a tracking inaccuracy, not a runtime failure.
      try {
        recordSpend(
          tenantId,
          promptCost.totalUsd,
          `${platform}:${result.model}:${prompt.id}`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `[poll-${platform}] recordSpend failed (non-fatal) runId=${runId} ` +
            `promptId=${prompt.id} cost=$${promptCost.totalUsd.toFixed(6)} ` +
            `error=${JSON.stringify(msg)}`,
        );
      }
    } catch (e) {
      // Step 1.5 (master plan) — post-sample failures are EXTRACTION /
      // PARSE errors: the provider already returned (`result` exists, may
      // have been billed), but persistence broke. Surface explicitly +
      // attribute the cost as estimated_unconfirmed so the operator can
      // reconcile against the provider dashboard without double-counting
      // the confirmed ledger.
      const cls = classifyPollError(e);
      const message = e instanceof Error ? e.message : String(e);
      failureCountsByKind[cls.kind] += 1;
      // We have a result handle — try to estimate the cost the provider
      // booked for it.  If usage is missing, estimate is 0 (conservative).
      try {
        const usage: QueryUsage | undefined = result?.usage;
        const billedEstimate = estimatePromptCost({
          provider: pricingProvider,
          model: result?.model ?? "",
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          webSearchCalls: usage?.webSearchCalls,
        });
        estimatedUnconfirmedCostUsd = roundUsd(
          estimatedUnconfirmedCostUsd + billedEstimate.totalUsd,
        );
      } catch {
        // estimate failed — leave the unconfirmed total untouched
      }
      console.warn(
        `[poll-${platform}] PERSIST_FAILED runId=${runId} tenant=${tenantId} ` +
          `promptId=${prompt.id} kind=${cls.kind} reason=${JSON.stringify(cls.reason)} ` +
          `error=${JSON.stringify(message)} estimatedUnconfirmedUsd=$${estimatedUnconfirmedCostUsd.toFixed(4)}`,
      );
      errorCount += 1;
    }
  }

  const completedAt = now().toISOString();
  // Sprint 6A.3c (2026-04-26) — status mapping:
  //   pre-flight budget block → "failed" (zero observations created)
  //   mid-run per-run block   → "partial" (some observations created)
  //   normal partial / completed paths unchanged
  const status: ObservationRun["status"] =
    skipReason === "budget_blocked"
      ? "failed"
      : mid_run_blocked
        ? "partial"
        : prompts.length === 0
          ? "completed"
          : errorCount === 0
            ? "completed"
            : errorCount < prompts.length
              ? "partial"
              : "failed";

  // Sprint 6A.3c/d — embed cost + dedupe + budget context into scope_label
  // so the poll-canary + cron logs surface it without needing a schema change.
  const baseScope = `Native ${platform} poll · chunk offset=${offset} limit=${opts.limit ?? "all"} · ${observations.length}/${prompts.length} prompts`;
  const costSuffix = ` · cost=$${costUsage.totalUsd.toFixed(4)}`;
  const dedupSuffix = promptsDeduped > 0 ? ` · deduped=${promptsDeduped}` : "";
  const skipSuffix =
    skipReason === "budget_blocked"
      ? ` · BUDGET_BLOCKED reason=${JSON.stringify(budgetReason ?? "unknown")} skipped=${promptsSkippedBudget}`
      : skipReason === "per_run_blocked"
        ? ` · PER_RUN_BLOCKED reason=${JSON.stringify(budgetReason ?? "unknown")} skipped=${promptsSkippedBudget}`
        : "";

  const observationRun: ObservationRun = {
    run_id: runId,
    run_type: "citation_sample_import",
    source: pollSource,
    status,
    started_at: startedAt,
    completed_at: completedAt,
    scope_label: baseScope + costSuffix + dedupSuffix + skipSuffix,
    parser_version: parserVersion,
    pages_scanned: 0,
    pages_changed: 0,
    pages_with_errors: errorCount,
    guardrail_alerts: 0,
    critical_count: 0,
    regression_count: 0,
    improvement_count: 0,
    tenant_id: tenantId,
  };

  // Cron-grep-friendly success line (only logged on normal completions
  // or normal partials — block paths already wrote their own warn line).
  if (skipReason === null) {
    console.log(
      `[poll-${platform}] runId=${runId} tenant=${tenantId} ` +
        `prompts=${observations.length}/${prompts.length} errored=${errorCount} ` +
        `deduped=${promptsDeduped} ` +
        `cost=$${costUsage.totalUsd.toFixed(4)} ` +
        `tokens(in=${costUsage.inputTokens} out=${costUsage.outputTokens}) ` +
        `web_searches=${costUsage.webSearchCalls} status=${status}`,
    );
  }

  // Step 1.5 (master plan) — structured chunk summary line. One JSON
  // object per chunk so an operator (or grep|jq) sees every field the
  // brief asked for in one glance:
  //   prompts_attempted / prompts_completed / retry_count / error_count
  //   skipped_budget_count / estimated_cost_usd / confirmed_cost_usd
  //   estimated_unconfirmed_cost_usd / dominant_failure_type / status
  const dominantFailureType = dominantFailureKind(failureCountsByKind);
  const chunkSummary = {
    tag: "CHUNK_SUMMARY",
    runId,
    tenantId,
    platform,
    status,
    skipReason,
    prompts_attempted: prompts.length,
    prompts_completed: promptsCompleted,
    retry_count: retryCount,
    error_count: errorCount,
    skipped_budget_count: promptsSkippedBudget,
    deduped_count: promptsDeduped,
    confirmed_cost_usd: costUsage.totalUsd,
    estimated_cost_usd: roundUsd(
      costUsage.totalUsd + estimatedUnconfirmedCostUsd,
    ),
    estimated_unconfirmed_cost_usd: estimatedUnconfirmedCostUsd,
    dominant_failure_type: dominantFailureType,
    failure_counts_by_kind: failureCountsByKind,
  };
  console.log(`[poll-${platform}] ${JSON.stringify(chunkSummary)}`);

  return {
    observations,
    answerTexts,
    observationRun,
    errorCount,
    cost: {
      totalUsd: costUsage.totalUsd,
      inputTokens: costUsage.inputTokens,
      outputTokens: costUsage.outputTokens,
      webSearchCalls: costUsage.webSearchCalls,
      promptsCompleted,
      promptsSkippedBudget,
      promptsDeduped,
    },
    skipReason,
    budgetReason,
    reliability: {
      retryCount,
      failureCountsByKind,
      dominantFailureType,
      estimatedUnconfirmedCostUsd,
    },
  };
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function hashAnswer(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function containsCaseInsensitive(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Returns all name variants that represent an entity: the canonical `name`
 * followed by any `aliases`. Blank/falsy values are stripped. Order is stable
 * (name first) so downstream logic that prefers the canonical form can take
 * the first match.
 */
function entityNameVariants(entity: TrackedEntity): string[] {
  const variants: string[] = [];
  if (entity.name) variants.push(entity.name);
  if (entity.aliases) {
    for (const alias of entity.aliases) {
      if (alias) variants.push(alias);
    }
  }
  return variants;
}

function detectMentions(
  answerText: string,
  entities: TrackedEntity[],
): string[] {
  // Store matches under the canonical `name` even when matched via an alias,
  // so mentions[] stays stable across alias list changes. The raw variant is
  // still in answer_texts for forensic inspection.
  const found = new Set<string>();
  for (const entity of entities) {
    const variants = entityNameVariants(entity);
    for (const variant of variants) {
      if (containsCaseInsensitive(answerText, variant)) {
        if (entity.name) found.add(entity.name);
        break;
      }
    }
  }
  return Array.from(found);
}
