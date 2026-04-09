import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { ObservationRun } from "./types";
import { isDualWriteEnabled } from "@/lib/persistence/dual-write";

const CAP = 50;

/**
 * Append a website observation row to `.data/observation-runs.json` (scan + verify passes).
 * When DUAL_WRITE=true, also upserts to the `observation_runs` Supabase table (best-effort).
 */
export function appendObservationRunSync(run: ObservationRun): void {
  const dir = join(process.cwd(), ".data");
  const path = join(dir, "observation-runs.json");
  let runs: ObservationRun[] = [];
  if (existsSync(path)) {
    try {
      runs = JSON.parse(readFileSync(path, "utf8")) as ObservationRun[];
    } catch {
      runs = [];
    }
  }
  runs.push(run);
  if (runs.length > CAP) runs = runs.slice(-CAP);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(runs, null, 2), "utf8");
  renameSync(tmp, path);

  if (isDualWriteEnabled()) {
    upsertObservationRunToDb(run).catch((e) =>
      console.error(
        `[dual-write] observation_runs: upsert failed — ${e instanceof Error ? e.message : e}`,
      ),
    );
  }
}

async function upsertObservationRunToDb(run: ObservationRun): Promise<void> {
  const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("observation_runs").upsert(
    {
      run_id: run.run_id,
      run_type: run.run_type,
      source: run.source,
      status: run.status,
      started_at: run.started_at,
      completed_at: run.completed_at,
      scope_label: run.scope_label,
      parser_version: run.parser_version ?? null,
      pages_scanned: run.pages_scanned,
      pages_changed: run.pages_changed,
      pages_with_errors: run.pages_with_errors,
      guardrail_alerts: run.guardrail_alerts,
      critical_count: run.critical_count,
      regression_count: run.regression_count,
      improvement_count: run.improvement_count,
      baseline_run_id: run.baseline_run_id ?? null,
      competitor_universe_version: run.competitor_universe_version ?? null,
      competitor_universe_fingerprint:
        run.competitor_universe_fingerprint ?? null,
      competitor_universe_scope: run.competitor_universe_scope ?? null,
      competitor_universe_pin_status:
        run.competitor_universe_pin_status ?? null,
    },
    { onConflict: "run_id" },
  );
  if (error) {
    console.error(
      `[dual-write] observation_runs upsert error: ${error.message}`,
    );
  }
}
