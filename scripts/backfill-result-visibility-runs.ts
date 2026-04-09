/**
 * One-shot backfill: stamp imported Result rows with visibility_observation_run_id
 * vis-imp-{import_batch_id} and ensure matching rows exist in visibility-observation-runs.json.
 *
 * Safe only when: row has source_system + import_batch_id and was imported before
 * row-level provenance shipped. Does not invent batch ids.
 *
 * Usage: npx tsx scripts/backfill-result-visibility-runs.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../src/domains/results/types";
import type { VisibilityObservationRun } from "../src/domains/observations/visibility-types";

const DATA = join(process.cwd(), ".data");
const RES = join(DATA, "imported-results.json");
const VIS = join(DATA, "visibility-observation-runs.json");

function main() {
  if (!existsSync(RES)) {
    console.log("No .data/imported-results.json — nothing to do.");
    return;
  }
  const results = JSON.parse(readFileSync(RES, "utf8")) as Result[];
  let runs: VisibilityObservationRun[] = [];
  if (existsSync(VIS)) {
    try {
      runs = JSON.parse(readFileSync(VIS, "utf8")) as VisibilityObservationRun[];
    } catch {
      runs = [];
    }
  }
  const runById = new Map(runs.map((r) => [r.run_id, r]));
  const batches = new Map<
    string,
    { count: number; source: string; earliest: string }
  >();

  for (const r of results) {
    if (r.visibility_observation_run_id) continue;
    if (!r.import_batch_id || !r.source_system) continue;
    const runId = `vis-imp-${r.import_batch_id}`;
    const ex = batches.get(runId);
    const created = r.created_at || new Date().toISOString();
    if (!ex) {
      batches.set(runId, { count: 1, source: r.source_system, earliest: created });
    } else {
      ex.count++;
      if (created < ex.earliest) ex.earliest = created;
    }
    r.visibility_observation_run_id = runId;
  }

  for (const [runId, meta] of batches) {
    if (runById.has(runId)) continue;
    const row: VisibilityObservationRun = {
      run_id: runId,
      run_type: "prompt_results_import",
      source: `backfill · ${meta.source}`,
      status: "completed",
      started_at: meta.earliest,
      completed_at: meta.earliest,
      scope_label: `Backfilled ${meta.count} Sample history row(s); batch inferred from import_batch_id.`,
      prompt_set_version: null,
      engine_platform_note: null,
      parser_version: "backfill-vis-imp-v1",
      baseline_visibility_run_id: null,
      counts: {
        topic_buckets: 0,
        page_topic_rollup_rows: 0,
        total_citations_accounted: 0,
        distinct_external_domains_sampled: 0,
        owned_rollup_rows: 0,
      },
      is_synthetic_wrapper: false,
      citation_index_built_at: null,
      sample_result_row_count: meta.count,
      linked_citation_index_run_id: null,
    };
    runs.push(row);
    runById.set(runId, row);
  }

  writeFileSync(RES, JSON.stringify(results, null, 2), "utf8");
  writeFileSync(VIS, JSON.stringify(runs, null, 2), "utf8");
  console.log(
    `Updated ${results.length} results; added ${batches.size} visibility run(s) where missing.`
  );
}

main();
