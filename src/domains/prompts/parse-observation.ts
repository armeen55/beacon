/**
 * CX2.5 — Result parser + observation writer.
 *
 * Converts a NormalizedObservation (adapter output) into the existing
 * PromptAnswerObservation type that the canonical pipeline already
 * consumes. This preserves backward compat with all routes and domain
 * modules that read from `prompt-answer-observations.json`.
 *
 * Also writes a per-tenant observation to the store.
 */

import { createHash } from "node:crypto";
import type { NormalizedObservation } from "./contracts";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { RenderedPrompt } from "./renderer";
import type { PlatformId } from "@/adapters/llm/types";

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * Convert a NormalizedObservation into a PromptAnswerObservation that
 * fits the existing store schema. The mapping is straightforward — the
 * normalized shape was designed to be a superset of what the legacy
 * Profound-imported observations carry.
 */
export function toPromptAnswerObservation(opts: {
  observation: NormalizedObservation;
  rendered: RenderedPrompt;
  platform: PlatformId;
  tenantId: string;
  runId: string;
  observedAt?: string;
}): PromptAnswerObservation {
  const { observation, rendered, platform, tenantId, runId, observedAt } =
    opts;
  const now = observedAt ?? new Date().toISOString();

  // Citation domains grouped by category (builder site, directory, etc.)
  const citationCategories: Record<string, number> = {};
  for (const cit of observation.citations) {
    const domain = cit.url
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
    citationCategories[domain] = (citationCategories[domain] ?? 0) + 1;
  }

  // Mentions: brand alias strings found in the answer
  const mentions = observation.entities_mentioned
    .filter((e) => e.type === "brand")
    .map((e) => e.name);

  const id = `pao-${createHash("sha256").update(`${runId}::${rendered.rendering_key}::${platform}`).digest("hex").slice(0, 12)}`;

  return {
    id,
    prompt_id: rendered.definition.id,
    run_id: runId,
    answer_hash: observation.raw_response_hash,
    position: null, // position within a ranking is not applicable for free-text queries
    tracked_brand_mentioned: observation.brand_mentioned,
    tracked_brand_cited: observation.brand_cited,
    citation_count: observation.citations.length,
    owned_citation_count: observation.citations.filter((c) => c.is_owned)
      .length,
    citation_domains: [
      ...new Set(
        observation.citations.map((c) =>
          c.url
            .replace(/^https?:\/\/(www\.)?/, "")
            .replace(/\/.*$/, "")
            .toLowerCase(),
        ),
      ),
    ],
    citation_categories: citationCategories,
    mentions,
    observed_at: now,
    platform,
    topic: rendered.definition.topic_cluster,
    metadata: {
      prompt_version: rendered.definition.version,
      prompt_content_hash: rendered.definition.content_hash,
      strata: rendered.definition.strata,
      city: rendered.city,
      competitor: rendered.competitor,
    },
    tenant_id: tenantId,
  };
}
