/**
 * Sprint 6A.1 Phase 15 (2026-04-25) — orchestrated scan CLI wrapper.
 *
 * Mirrors `runWebsiteScan`'s behavior in two stages, but imports
 * ONLY the dual-write helpers — `orchestrate-scan.ts` itself imports
 * `seed-data.server.ts` which uses top-level await, and tsx →
 * esbuild CJS transform can't handle it. Equivalent runtime path,
 * smaller import surface.
 *
 * Stages:
 *   1. Spawn `scripts/scan-owned-pages.ts` (the existing CLI). It
 *      fetches every owned URL, builds new snapshots + guardrails +
 *      page_element_inventory rows, writes them to `.data/`. This
 *      step is identical to what runWebsiteScan + the cron + the
 *      "Scan now" button all run.
 *   2. Read back the freshly-written `.data/*.json` and dual-write
 *      to Supabase via the existing helpers. Idempotent — `id`-keyed
 *      upsert for snapshots / observation_runs; URL-keyed delete-
 *      replace for guardrails (matching existing scan semantics);
 *      (source_snapshot_id, element_key)-keyed upsert for inventory.
 *
 * Gated by `DUAL_WRITE=true`. With `DATA_SOURCE=supabase` writes land
 * in production Supabase. Without DUAL_WRITE the run still completes
 * locally — useful for dry-runs.
 *
 * **What this CLI does NOT touch:**
 *   - `recommended_edits` (Phase 11 row writes — only triggered by
 *     `scripts/build-edits-for-queue.ts --write` /
 *     `scripts/generate-specific-edits.ts --write`).
 *   - `changelog_entries` (only operator-driven via Accept /
 *     Confirm-finding flows; auto-link is OFF by default).
 *   - Any LLM provider / paid API.
 *
 * Exit codes:
 *   0 — scan completed (success or partial)
 *   1 — fatal error before scan started
 *   2 — scan ran but returned non-zero exit
 */

import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  syncGuardrailAlerts,
  syncObservationRuns,
  syncPageElementInventory,
  syncPageSnapshots,
} from "../src/lib/persistence/dual-write";

import { currentTenantId } from "../src/lib/tenant-context";

function loadEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
import type { ObservationRun } from "../src/domains/observations/types";
import type { GuardrailAlert } from "../src/domains/pages/guardrails";
import type { PageSnapshot } from "../src/domains/pages/types";
import type { PageElementInventoryRow } from "../src/domains/pages/extractors/persist";

const execAsync = promisify(exec);

const SCAN_CLI_CMD =
  "npx tsx --require ./scripts/mock-server-only.cjs --require ./scripts/apply-scan-site-domain.cjs scripts/scan-owned-pages.ts";

const DATA_DIR = join(process.cwd(), ".data");

function dedupeBy<T>(rows: ReadonlyArray<T>, keyFn: (row: T) => string): T[] {
  const out = new Map<string, T>();
  for (const row of rows) out.set(keyFn(row), row);
  return [...out.values()];
}

function readJson<T>(name: string): T | null {
  const path = join(DATA_DIR, `${name}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    console.warn(
      `[run-orchestrated-scan] failed to parse .data/${name}.json: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return null;
  }
}

async function main(): Promise<void> {
  // tsx doesn't auto-load .env.local the way Next.js does. Load it
  // BEFORE any sync* call so getSupabaseAdmin() can resolve URL + key.
  loadEnvLocal();

  const argv = process.argv.slice(2);
  const skipScan = argv.includes("--skip-scan");

  const dualWrite = process.env.DUAL_WRITE === "true";
  const dataSource = process.env.DATA_SOURCE ?? "(unset)";
  // Sprint 7 Phase 7.5d/2 (2026-04-25) — fail-loud tenant resolution.
  const tenant = await currentTenantId();

  console.log(
    `[run-orchestrated-scan] tenant=${tenant} data_source=${dataSource} dual_write=${dualWrite} skip_scan=${skipScan}`,
  );
  if (!dualWrite) {
    console.warn(
      "[run-orchestrated-scan] DUAL_WRITE != \"true\" — Supabase writes will be skipped (local-only run).",
    );
  }

  // ── Stage 1: spawn the scan CLI (unless --skip-scan) ──────────────────
  const t0 = Date.now();
  if (skipScan) {
    console.log(
      "[run-orchestrated-scan] stage 1 skipped (--skip-scan); reusing existing .data/*.json",
    );
  } else {
    console.log(`[run-orchestrated-scan] stage 1: ${SCAN_CLI_CMD}`);
    try {
      const { stdout, stderr } = await execAsync(SCAN_CLI_CMD, {
        cwd: process.cwd(),
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env },
      });
      if (stdout.trim()) console.log(stdout);
      if (stderr.trim()) console.error(stderr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[run-orchestrated-scan] scan CLI failed: ${msg}`);
      process.exit(2);
    }
    const stage1Ms = Date.now() - t0;
    console.log(`[run-orchestrated-scan] stage 1 done in ${stage1Ms}ms`);
  }

  // ── Stage 2: dual-write the freshly-written .data/*.json ──────────────
  if (!dualWrite) {
    console.log(
      "[run-orchestrated-scan] stage 2 skipped (DUAL_WRITE != \"true\").",
    );
    return;
  }
  console.log("[run-orchestrated-scan] stage 2: dual-write to Supabase…");

  const snapshots = readJson<PageSnapshot[]>("page-snapshots") ?? [];
  const guardrails = readJson<GuardrailAlert[]>("page-guardrails") ?? [];
  const observationRunsRaw =
    readJson<ObservationRun[]>("observation-runs") ?? [];
  const inventoryRaw =
    readJson<PageElementInventoryRow[]>("page-element-inventory") ?? [];

  // Defensive dedup: PostgREST's upsert refuses chunks containing
  // duplicate conflict-target pairs ("ON CONFLICT DO UPDATE command
  // cannot affect row a second time"). Dedupe by upsert key, keeping
  // the LAST occurrence (latest extraction wins).
  const inventory = dedupeBy(
    inventoryRaw,
    (r) => `${r.source_snapshot_id}\u0000${r.element_key}`,
  );
  const observationRuns = dedupeBy(observationRunsRaw, (r) => r.run_id);

  console.log(
    `  read .data: snapshots=${snapshots.length} guardrails=${guardrails.length} obsRuns=${observationRunsRaw.length}→${observationRuns.length} inventory=${inventoryRaw.length}→${inventory.length}`,
  );
  if (inventoryRaw.length !== inventory.length) {
    console.warn(
      `  [warn] dropped ${inventoryRaw.length - inventory.length} duplicate (source_snapshot_id, element_key) inventory rows before upsert`,
    );
  }
  if (observationRunsRaw.length !== observationRuns.length) {
    console.warn(
      `  [warn] dropped ${observationRunsRaw.length - observationRuns.length} duplicate run_id observation_runs rows before upsert`,
    );
  }

  let snapshotsOk = false;
  let guardrailsOk = false;
  let runsOk = false;
  let inventoryOk = false;

  try {
    await syncPageSnapshots(snapshots, tenant);
    snapshotsOk = true;
  } catch (e) {
    console.error(
      `  syncPageSnapshots failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    await syncGuardrailAlerts(guardrails, tenant);
    guardrailsOk = true;
  } catch (e) {
    console.error(
      `  syncGuardrailAlerts failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    if (observationRuns.length > 0) {
      await syncObservationRuns(observationRuns, tenant);
    }
    runsOk = true;
  } catch (e) {
    console.error(
      `  syncObservationRuns failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    if (inventory.length > 0) {
      await syncPageElementInventory(inventory);
    }
    inventoryOk = true;
  } catch (e) {
    console.error(
      `  syncPageElementInventory failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  console.log(
    `  dual-write: snapshots=${snapshotsOk} guardrails=${guardrailsOk} runs=${runsOk} inventory=${inventoryOk}`,
  );

  console.log(
    `[run-orchestrated-scan] complete: total=${Date.now() - t0}ms` +
      ` snapshots=${snapshots.length} inventory=${inventory.length}`,
  );

  if (!snapshotsOk || !guardrailsOk || !runsOk || !inventoryOk) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(
    `[run-orchestrated-scan] fatal: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
