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

const PERPLEXITY_POLL_SOURCE = "perplexity-native-poll";
const PLATFORM = "perplexity";
const PARSER_VERSION = "perplexity-native-v1";

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
  /** Cap how many prompts to poll (dry-runs, budget guards). */
  limit?: number;
  /** Optional pre-fetched prompts; if omitted, read via repository. */
  trackedPrompts?: TrackedPrompt[];
  /** Optional pre-fetched entities; if omitted, read via repository. */
  trackedEntities?: TrackedEntity[];
};

export async function pollPerplexityForTenant(
  tenantId: string,
  opts: PerplexityPollOptions = {},
): Promise<PerplexityPollResult> {
  const now = opts.now ?? (() => new Date());
  const client = opts.client ?? createPerplexityClient();

  const repo = getRepository();
  const trackedPrompts =
    opts.trackedPrompts ?? (await repo.getTrackedPrompts());
  const trackedEntities =
    opts.trackedEntities ?? (await repo.getTrackedEntities());

  const activePrompts = trackedPrompts
    .filter((p) => p.is_active)
    .filter(
      (p) => p.platforms.length === 0 || p.platforms.includes(PLATFORM),
    );
  const prompts =
    opts.limit && opts.limit > 0
      ? activePrompts.slice(0, opts.limit)
      : activePrompts;

  const activeEntities = trackedEntities.filter((e) => e.is_active);
  const ownedEntities = activeEntities.filter((e) => e.is_owned);
  const ownedDomains = new Set(
    ownedEntities
      .map((e) => e.domain?.toLowerCase())
      .filter((d): d is string => Boolean(d)),
  );
  const ownedNames = ownedEntities.map((e) => e.name).filter(Boolean);

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
      const brandMentioned = ownedNames.some((name) =>
        containsCaseInsensitive(result.answer_text, name),
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
        platform: PLATFORM,
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
    source: PERPLEXITY_POLL_SOURCE,
    status,
    started_at: startedAt,
    completed_at: completedAt,
    scope_label: `Native Perplexity poll · ${observations.length}/${prompts.length} prompts`,
    parser_version: PARSER_VERSION,
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

function detectMentions(
  answerText: string,
  entities: TrackedEntity[],
): string[] {
  const found = new Set<string>();
  for (const entity of entities) {
    if (entity.name && containsCaseInsensitive(answerText, entity.name)) {
      found.add(entity.name);
    }
  }
  return Array.from(found);
}
