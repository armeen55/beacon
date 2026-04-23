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
import type { QueryClient } from "@/lib/querying/types";
import { getRepository } from "@/lib/persistence/repositories";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { ObservationRun } from "@/domains/observations/types";

// Default platform constants for Perplexity. Callers targeting other platforms
// (e.g. ChatGPT adapter in src/adapters/openai/poll.ts) override these via opts
// to reuse the same generic polling logic without duplication.
const DEFAULT_POLL_SOURCE = "perplexity-native-poll";
const DEFAULT_PLATFORM = "perplexity";
const DEFAULT_PARSER_VERSION = "perplexity-native-v1";

export type PerplexityPollResult = {
  observations: PromptAnswerObservation[];
  answerTexts: Record<string, string>;
  observationRun: ObservationRun;
  errorCount: number;
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

  const observations: PromptAnswerObservation[] = [];
  const answerTexts: Record<string, string> = {};
  let errorCount = 0;

  for (const prompt of prompts) {
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
      const ownedCitationCount = citationDomains.filter((d) =>
        ownedDomains.has(d),
      ).length;

      const mentions = detectMentions(result.answer_text, activeEntities);
      const brandMentioned = ownedNameVariants.some((variant) =>
        containsCaseInsensitive(result.answer_text, variant),
      );

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
      };

      observations.push(obs);
      answerTexts[observationId] = result.answer_text;
    } catch {
      errorCount += 1;
    }
  }

  const completedAt = now().toISOString();
  const status: ObservationRun["status"] =
    prompts.length === 0
      ? "completed"
      : errorCount === 0
        ? "completed"
        : errorCount < prompts.length
          ? "partial"
          : "failed";

  const observationRun: ObservationRun = {
    run_id: runId,
    run_type: "citation_sample_import",
    source: pollSource,
    status,
    started_at: startedAt,
    completed_at: completedAt,
    scope_label: `Native ${platform} poll · chunk offset=${offset} limit=${opts.limit ?? "all"} · ${observations.length}/${prompts.length} prompts`,
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

  return { observations, answerTexts, observationRun, errorCount };
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
