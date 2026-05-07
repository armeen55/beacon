/**
 * verify-tenant-data-integrity — Trust Sprint Mini-Phase T1.1 (2026-05-06).
 *
 * Read-only invariant check on the live Supabase tables. Asserts that the
 * tenant-ownership cleanup landed and stays landed. Run before/after any
 * schema change that touches `daily_metric_snapshots`,
 * `prompt_answer_observations`, or `recommended_edits`.
 *
 * Invariants verified:
 *   1. `daily_metric_snapshots.tenant_id`: 0 rows where tenant_id = ''
 *   2. `daily_metric_snapshots.tenant_id`: 0 rows where tenant_id IS NULL
 *   3. `prompt_answer_observations.tenant_id`: 0 rows where tenant_id = ''
 *   4. `prompt_answer_observations.tenant_id`: 0 rows where tenant_id IS NULL
 *   5. `recommended_edits.tenant_id`: 0 rows where tenant_id LIKE 'test-%'
 *   6. `recommended_edits.tenant_id`: 0 rows where tenant_id = ''
 *   7. `recommended_edits.tenant_id`: 0 rows where tenant_id IS NULL
 *
 * Prints per-table totals + per-tenant breakdown. Exits non-zero on any
 * violation. Safe to run as a CI guard or operator pre-deploy check.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/verify-tenant-data-integrity.ts
 *
 * Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in env (loaded from
 * `.env.local` if present).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

import { getSupabaseAdmin } from "../src/lib/persistence/supabase";

type Probe = {
  label: string;
  table: "daily_metric_snapshots" | "prompt_answer_observations" | "recommended_edits";
  /** Filter applied via PostgREST. `null` = no filter (total count). */
  filter:
    | { kind: "eq"; column: string; value: string }
    | { kind: "is_null"; column: string }
    | { kind: "like"; column: string; pattern: string }
    | null;
  expected: "zero" | "positive" | "any";
};

const PROBES: ReadonlyArray<Probe> = [
  // Totals (must be > 0 — sanity check that we're connected to the right DB)
  { label: "daily_metric_snapshots TOTAL", table: "daily_metric_snapshots", filter: null, expected: "positive" },
  { label: "prompt_answer_observations TOTAL", table: "prompt_answer_observations", filter: null, expected: "positive" },
  { label: "recommended_edits TOTAL", table: "recommended_edits", filter: null, expected: "any" },

  // T1 invariants — must all be 0
  { label: "daily_metric_snapshots tenant_id = ''", table: "daily_metric_snapshots", filter: { kind: "eq", column: "tenant_id", value: "" }, expected: "zero" },
  { label: "daily_metric_snapshots tenant_id IS NULL", table: "daily_metric_snapshots", filter: { kind: "is_null", column: "tenant_id" }, expected: "zero" },
  { label: "prompt_answer_observations tenant_id = ''", table: "prompt_answer_observations", filter: { kind: "eq", column: "tenant_id", value: "" }, expected: "zero" },
  { label: "prompt_answer_observations tenant_id IS NULL", table: "prompt_answer_observations", filter: { kind: "is_null", column: "tenant_id" }, expected: "zero" },
  { label: "recommended_edits tenant_id LIKE 'test-%'", table: "recommended_edits", filter: { kind: "like", column: "tenant_id", pattern: "test-%" }, expected: "zero" },
  { label: "recommended_edits tenant_id = ''", table: "recommended_edits", filter: { kind: "eq", column: "tenant_id", value: "" }, expected: "zero" },
  { label: "recommended_edits tenant_id IS NULL", table: "recommended_edits", filter: { kind: "is_null", column: "tenant_id" }, expected: "zero" },
];

async function runProbe(p: Probe): Promise<{ ok: boolean; count: number; reason?: string }> {
  const sb = getSupabaseAdmin();
  let q = sb.from(p.table).select("*", { count: "exact", head: true });
  if (p.filter?.kind === "eq") q = q.eq(p.filter.column, p.filter.value);
  else if (p.filter?.kind === "is_null") q = q.is(p.filter.column, null);
  else if (p.filter?.kind === "like") q = q.like(p.filter.column, p.filter.pattern);
  const { count, error } = await q;
  if (error) return { ok: false, count: -1, reason: `query error: ${error.message}` };
  const n = count ?? 0;
  if (p.expected === "zero" && n !== 0) return { ok: false, count: n, reason: `expected 0, got ${n}` };
  if (p.expected === "positive" && n <= 0) return { ok: false, count: n, reason: `expected > 0, got ${n}` };
  return { ok: true, count: n };
}

async function main(): Promise<void> {
  console.log("verify-tenant-data-integrity — Trust Sprint T1.1 invariants\n");

  let failures = 0;
  for (const probe of PROBES) {
    const r = await runProbe(probe);
    const status = r.ok ? "PASS" : "FAIL";
    const detail = r.reason ? ` — ${r.reason}` : "";
    console.log(`  [${status}] ${probe.label}: ${r.count}${detail}`);
    if (!r.ok) failures += 1;
  }

  console.log("\nPer-tenant breakdown (paginated to defeat PostgREST 1k row cap):");
  for (const table of ["daily_metric_snapshots", "prompt_answer_observations", "recommended_edits"] as const) {
    const sb = getSupabaseAdmin();
    const PAGE = 1000;
    const counts = new Map<string, number>();
    let from = 0;
    for (;;) {
      const { data: rows, error } = await sb
        .from(table)
        .select("tenant_id")
        .range(from, from + PAGE - 1);
      if (error) {
        console.log(`    ${table}: lookup error — ${error.message}`);
        break;
      }
      for (const row of rows ?? []) {
        const tid = (row as { tenant_id: string | null }).tenant_id ?? "<NULL>";
        counts.set(tid, (counts.get(tid) ?? 0) + 1);
      }
      if (!rows || rows.length < PAGE) break;
      from += PAGE;
    }
    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    console.log(`  ${table}:`);
    for (const [tid, n] of entries) {
      console.log(`    ${JSON.stringify(tid)}: ${n}`);
    }
  }

  if (failures > 0) {
    console.error(`\nFAIL: ${failures} invariant(s) violated`);
    process.exit(1);
  }
  console.log("\nPASS: all tenant-ownership invariants satisfied");
}

main().catch((err) => {
  console.error("verify-tenant-data-integrity crashed:", err);
  process.exit(2);
});
