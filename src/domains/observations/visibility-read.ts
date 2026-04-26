import type { CitationEvidenceIndex } from "@/domains/pages/types";
import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import { getVisibilityObservationRunsExplicit } from "./visibility-observation-explicit-store";
import {
  type VisibilityObservationRun,
  VISIBILITY_SEED_WALKTHROUGH_RUN_ID,
} from "./visibility-types";

function countDomainsFromRollups(
  rows: CitationEvidenceIndex["by_page_and_topic"]
): { externalDomains: Set<string>; ownedRows: number } {
  const externalDomains = new Set<string>();
  let ownedRows = 0;
  for (const r of rows) {
    if (r.is_owned) {
      ownedRows++;
      continue;
    }
    try {
      const host = new URL(r.page_url).hostname.replace(/^www\./, "");
      if (host) externalDomains.add(host);
    } catch {
      /* skip */
    }
  }
  return { externalDomains, ownedRows };
}

/**
 * Build a stable, honest wrapper around `citation-evidence-index.json` when no
 * explicit `visibility-observation-runs.json` exists.
 */
function syntheticFromCitationIndex(
  ci: CitationEvidenceIndex
): VisibilityObservationRun {
  const { externalDomains, ownedRows } = countDomainsFromRollups(
    ci.by_page_and_topic
  );
  const builtAt = ci.built_at;
  const runId = `vis-citation-${encodeURIComponent(builtAt)}`;

  return {
    run_id: runId,
    run_type: "citation_sample_import",
    source: "citation-evidence-index.json (synthetic visibility ObservationRun)",
    status: "completed",
    started_at: builtAt,
    completed_at: builtAt,
    scope_label:
      "Imported citation / mention rollup — not a live nightly prompt engine run unless you recorded one separately.",
    prompt_set_version: null,
    engine_platform_note:
      "Platforms in history rows are separate from this index; tie both to this wrapper only at import time.",
    parser_version: "citation-index-v1",
    baseline_visibility_run_id: null,
    counts: {
      topic_buckets: ci.by_topic.length,
      page_topic_rollup_rows: ci.by_page_and_topic.length,
      total_citations_accounted: ci.total_citations_processed,
      distinct_external_domains_sampled: externalDomains.size,
      owned_rollup_rows: ownedRows,
    },
    is_synthetic_wrapper: true,
    citation_index_built_at: builtAt,
    sample_result_row_count: null,
    linked_citation_index_run_id: null,
    competitor_universe_version: null,
    competitor_universe_fingerprint: null,
    competitor_universe_scope: null,
    competitor_universe_pin_status: "synthetic_unpinned",
  };
}

/** In-memory descriptor for demo `Result` rows (also merge into list if not on disk). */
export function buildSeedWalkthroughVisibilityRun(): VisibilityObservationRun {
  return {
    run_id: VISIBILITY_SEED_WALKTHROUGH_RUN_ID,
    run_type: "prompt_results_import",
    source: "lib/seed-data.ts (walkthrough, no import)",
    status: "completed",
    started_at: "2025-03-25T08:00:00Z",
    completed_at: "2025-03-25T08:00:00Z",
    scope_label:
      "Demo history rows shipped with Beacon — not imported from your systems.",
    prompt_set_version: null,
    engine_platform_note: "chatgpt · google_aio · perplexity · all (demo mix)",
    parser_version: "seed-v1",
    baseline_visibility_run_id: null,
    counts: {
      topic_buckets: 0,
      page_topic_rollup_rows: 0,
      total_citations_accounted: 0,
      distinct_external_domains_sampled: 0,
      owned_rollup_rows: 0,
    },
    is_synthetic_wrapper: true,
    citation_index_built_at: null,
    sample_result_row_count: 6,
    linked_citation_index_run_id: null,
    competitor_universe_version: null,
    competitor_universe_fingerprint: null,
    competitor_universe_scope: null,
    competitor_universe_pin_status: "synthetic_unpinned",
  };
}

/**
 * All visibility observation runs, newest `completed_at` first.
 * On-disk `visibility-observation-runs.json` wins on `run_id` collision; then
 * citation-index synthetic; then seed walkthrough stub.
 */
export async function listVisibilityObservationRuns(): Promise<VisibilityObservationRun[]> {
  const fromFile = (await getVisibilityObservationRunsExplicit()).filter(
    (r) => r?.run_id && r?.completed_at,
  );
  const sortedExplicit = [...fromFile].sort(
    (a, b) =>
      new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
  );

  const byId = new Map<string, VisibilityObservationRun>();
  for (const r of sortedExplicit) {
    byId.set(r.run_id, r);
  }

  const ci: CitationEvidenceIndex | null = citationEvidenceIndex;
  if (ci?.built_at) {
    const synthetic = syntheticFromCitationIndex(ci);
    if (!byId.has(synthetic.run_id)) {
      byId.set(synthetic.run_id, synthetic);
    }
  }

  const seed = buildSeedWalkthroughVisibilityRun();
  if (!byId.has(seed.run_id)) {
    byId.set(seed.run_id, seed);
  }

  return [...byId.values()].sort(
    (a, b) =>
      new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
  );
}

export async function getVisibilityObservationRun(
  runId: string
): Promise<VisibilityObservationRun | null> {
  return (await listVisibilityObservationRuns()).find((r) => r.run_id === runId) ?? null;
}

export async function latestVisibilityObservationRun(): Promise<VisibilityObservationRun | null> {
  const list = await listVisibilityObservationRuns();
  return list[0] ?? null;
}

/** Citation-index synthetic run (used for staleness vs crawl, not necessarily “latest” overall). */
export async function citationRollupVisibilityRun(): Promise<VisibilityObservationRun | null> {
  return (
    (await listVisibilityObservationRuns()).find(
      (r) => r.run_type === "citation_sample_import"
    ) ?? null
  );
}
