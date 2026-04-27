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
  };
  /** Sprint 6A.3c — null when no budget event. */
  skipReason: "budget_blocked" | "per_run_blocked" | null;
  /** Sprint 6A.3c — operator-facing message when `skipReason` is non-null. */
  budgetReason: string | null;
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
    try {
      const result = await client.sample(prompt.text);
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
      };

      observations.push(obs);
      answerTexts[observationId] = result.answer_text;

      // Sprint 6A.3c — cost record for this successful sample. Sample
      // failure (catch block below) intentionally skips this — we don't
      // book spend the operator wasn't charged for. Missing usage from
      // the provider response → estimate cost is 0; observation still
      // persisted; loop continues (the conservative-fallback contract
      // documented in src/lib/cost/pricing.ts).
      const usage: QueryUsage | undefined = result.usage;
      const promptCost = estimatePromptCost({
        provider: pricingProvider,
        model: result.model,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        webSearchCalls: usage?.webSearchCalls,
      });
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
    } catch {
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

  // Sprint 6A.3c — embed cost + budget context into scope_label so the
  // poll-canary + cron logs surface it without needing a schema change.
  const baseScope = `Native ${platform} poll · chunk offset=${offset} limit=${opts.limit ?? "all"} · ${observations.length}/${prompts.length} prompts`;
  const costSuffix = ` · cost=$${costUsage.totalUsd.toFixed(4)}`;
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
    scope_label: baseScope + costSuffix + skipSuffix,
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
        `cost=$${costUsage.totalUsd.toFixed(4)} ` +
        `tokens(in=${costUsage.inputTokens} out=${costUsage.outputTokens}) ` +
        `web_searches=${costUsage.webSearchCalls} status=${status}`,
    );
  }

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
    },
    skipReason,
    budgetReason,
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
