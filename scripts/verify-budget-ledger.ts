/**
 * verify-budget-ledger — read-only ops check for the dual-write
 * Supabase budget ledger.
 *
 * Compares `public.llm_budget_ledger` rows for a given UTC date against
 * the same day's `observation_runs` and `prompt_answer_observations`,
 * platform by platform. Prints a calm status line per platform and an
 * aggregate verdict.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/verify-budget-ledger.ts          # today UTC
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/verify-budget-ledger.ts 2026-05-09
 *
 * Exit codes:
 *   0 — overall ok or pending (no poll yet, ledger empty too)
 *   1 — overall warn or failed
 *   2 — runtime error (Supabase down, bad date, etc.)
 *
 * Read-only. No INSERT / UPDATE / DELETE. Safe to run any time.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Hydrate .env.local for local runs. CI provides env directly.
const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

import {
  verifyBudgetLedger,
  type LedgerVerifyReport,
  type LedgerVerifyStatus,
} from "../src/lib/cost/verify-budget-ledger";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function glyph(s: LedgerVerifyStatus): string {
  switch (s) {
    case "ok":
      return "✓";
    case "warn":
      return "▲";
    case "failed":
      return "✗";
    case "pending":
      return "…";
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function logReport(r: LedgerVerifyReport): void {
  console.log(`Verifying llm_budget_ledger for ${r.date}...`);
  if (r.duplicateRowsDetected) {
    console.log(
      `  ✗ DUPLICATE ROWS detected at PK grain (tenant_id, date_utc, platform)`,
    );
  }
  for (const p of r.perPlatform) {
    const lr = p.ledgerRow;
    const rows = p.observationRuns;
    const ledgerSummary = lr
      ? `$${lr.spent_usd.toFixed(4)} / ${lr.prompt_count} prompts / ${lr.chunk_count} chunks`
      : "no ledger row";
    const runsSummary =
      rows.completed === 0
        ? "no completed runs"
        : `${rows.completed} run(s), $${(rows.sumCostUsdFromScopeLabel ?? 0).toFixed(4)} via scope_label`;
    console.log(
      `  ${glyph(p.status)} ${pad(p.ledgerPlatform, 12)} ${pad(p.status, 8)} ` +
        `ledger: ${pad(ledgerSummary, 40)}  runs: ${runsSummary}`,
    );
    for (const note of p.notes) {
      console.log(`      • ${note}`);
    }
  }
  console.log();
  console.log(`Overall: ${glyph(r.overall)} ${r.overall}`);
}

async function main(): Promise<number> {
  const arg = process.argv[2];
  const date = arg ?? todayUtc();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`Invalid date "${date}", expected YYYY-MM-DD or no arg.`);
    return 2;
  }
  let report: LedgerVerifyReport;
  try {
    report = await verifyBudgetLedger(date);
  } catch (err) {
    console.error(`verifyBudgetLedger threw: ${String(err)}`);
    return 2;
  }
  logReport(report);
  if (report.overall === "ok" || report.overall === "pending") return 0;
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("Unhandled error:", err);
    process.exit(2);
  },
);
