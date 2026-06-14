/**
 * check-yesterday-poll — Poll-health canary.
 *
 * Queries Supabase for today's observation_runs and exits non-zero if any
 * platform isn't "ok" (i.e. < 4/4 chunks completed in chunk mode, or the
 * whole-mode run didn't complete successfully).
 *
 * Multi-tenant (2026-06-14): checks EACH enabled tenant in
 * `ops/active-tenants.json` independently and fails if ANY tenant is not ok
 * (pre-fix it ran one GLOBAL query that let a healthy tenant mask a failing
 * one). Pass `--tenant <id>` to check a single tenant.
 *
 * Wired from `.github/workflows/poll-canary.yml` to run daily at 10:45 UTC
 * (45 minutes after the main poll cron at 10:00 UTC). GitHub Actions emails
 * the repo owner on any non-zero exit, turning silent pipeline failures into
 * hours-not-days alerts.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/check-yesterday-poll.ts                       # all enabled tenants, today (UTC)
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/check-yesterday-poll.ts 2026-04-23            # all enabled tenants, specific date
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/check-yesterday-poll.ts --tenant tenant-x     # one tenant, today
 *
 * The mock-server-only require stubs out the `import "server-only"` guard in
 * src/domains/observations/poll-health.ts so Node CLI execution works. The
 * guard still prevents accidental client-component bundling in the Next.js
 * build.
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Exit codes:
 *   0 — all platforms ok
 *   1 — at least one platform not ok (partial / failed / pending)
 *   2 — query/runtime error (treated as alert)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Load .env.local for local runs. CI provides env vars directly.
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

import {
  fetchPollHealthForDate,
  todayISOUtc,
  type PlatformPollHealth,
} from "../src/domains/observations/poll-health";
import {
  readSpendSnapshotForDate,
  type SpendSnapshotRow,
} from "../src/lib/cost/budget-ledger-supabase";
// Reuse the cron's canonical "enabled active tenants" parser so the canary
// checks the SAME fleet the poll matrix runs (no drift between who polls and
// who gets verified).
import { parseJsonFallback } from "./list-active-tenants";

type CheckTarget = { tenantId: string | undefined; label: string };

/**
 * Resolve which tenant(s) to verify.
 *
 * Multi-tenant fail-loud (2026-06-14): pre-fix this canary always ran a
 * single GLOBAL `fetchPollHealthForDate(date)` (no tenant filter), aggregating
 * EVERY tenant's runs into one health view. With 2+ active tenants that masks
 * a per-tenant failure — Ritz's healthy poll hides Iranopedia's total miss,
 * the canary exits 0, and the operator never learns Iranopedia broke until
 * they manually notice zero data days later. Now we check EACH enabled tenant
 * independently and fail if ANY is not ok.
 *
 *   • `--tenant <id>` (explicit CLI flag) → check only that tenant.
 *   • else → every enabled tenant in ops/active-tenants.json (the same fleet
 *     `list-active-tenants.ts` feeds the poll matrix).
 *   • JSON missing/empty/unreadable → one global check (backward-compatible
 *     last resort; logs a WARN so the degraded mode is visible).
 *
 * BEACON_TENANT_ID env is intentionally NOT used for selection: poll-canary.yml
 * sets it to only the FIRST tenant, which would silently re-introduce the
 * single-tenant blind spot. Per-tenant selection is the explicit `--tenant`
 * flag only.
 */
function resolveTargets(tenantFlag: string | undefined): CheckTarget[] {
  if (tenantFlag) {
    return [{ tenantId: tenantFlag, label: tenantFlag }];
  }
  const opsPath = join(process.cwd(), "ops", "active-tenants.json");
  if (existsSync(opsPath)) {
    try {
      const raw = JSON.parse(readFileSync(opsPath, "utf-8")) as unknown;
      const enabled = parseJsonFallback(raw, (m) =>
        console.warn(`[check-yesterday-poll] ${m}`),
      );
      if (enabled.length > 0) {
        return enabled.map((t) => ({ tenantId: t.tenantId, label: t.tenantId }));
      }
      console.warn(
        "[check-yesterday-poll] ops/active-tenants.json has 0 enabled tenants — falling back to a single global check",
      );
    } catch (err) {
      console.warn(
        `[check-yesterday-poll] could not parse ops/active-tenants.json (${String(err)}) — falling back to a single global check`,
      );
    }
  }
  return [{ tenantId: undefined, label: "all-tenants (global fallback)" }];
}

async function main(): Promise<number> {
  // argv: optional `--tenant <id>` / `--tenant=<id>` flag + an optional
  // positional YYYY-MM-DD date (defaults to today UTC).
  const args = process.argv.slice(2);
  let tenantFlag: string | undefined;
  let dateArg: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--tenant") tenantFlag = args[++i];
    else if (a.startsWith("--tenant=")) tenantFlag = a.slice("--tenant=".length);
    else if (!a.startsWith("--")) dateArg = a;
  }
  const date = dateArg ?? todayISOUtc();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(
      `Invalid date: "${date}". Expected YYYY-MM-DD or no argument (defaults to today UTC).`,
    );
    return 2;
  }

  const targets = resolveTargets(tenantFlag);
  console.log(
    `Checking poll health for ${date} across ${targets.length} target(s): ` +
      `${targets.map((t) => t.label).join(", ")}...`,
  );

  // Exit code: 0 all ok · 1 at least one platform not ok · 2 a query error.
  // Severity ranks error > not-ok > ok, so the most serious outcome across
  // ALL tenants wins the exit code (a single tenant's failure fails the job).
  let exitCode = 0;
  for (const target of targets) {
    console.log(`\n── tenant: ${target.label} ──`);
    let snap;
    try {
      snap = await fetchPollHealthForDate(date, target.tenantId);
    } catch (err) {
      console.error(
        `Poll-health query failed for ${target.label}: ${String(err)}`,
      );
      exitCode = 2;
      continue;
    }
    let tenantOk = true;
    for (const platform of snap.platforms) {
      logPlatform(platform);
      if (platform.status !== "ok") tenantOk = false;
    }
    if (!tenantOk && exitCode !== 2) exitCode = 1;
    console.log(
      tenantOk
        ? `  ✓ ${target.label}: all platforms ok`
        : `  ✗ ${target.label}: one or more platforms NOT ok`,
    );
  }

  // Phase 2 Stage B.2 (2026-05-09): read-only spend snapshot from
  // public.llm_budget_ledger. Empty/unavailable table prints a calm
  // fallback. Always informational — never affects exit code.
  await logSpendSnapshot(date);

  if (exitCode === 0) {
    console.log(`\n✓ All platforms ok for ${date} across all checked tenants.`);
  } else if (exitCode === 1) {
    console.log(
      `\n✗ One or more tenants/platforms are NOT ok for ${date}. See the per-tenant summary above.`,
    );
  } else {
    console.log(
      `\n✗ A poll-health query errored for ${date} (treated as an alert). See above.`,
    );
  }
  return exitCode;
}

async function logSpendSnapshot(date: string): Promise<void> {
  let rows: SpendSnapshotRow[] = [];
  try {
    rows = await readSpendSnapshotForDate(date);
  } catch {
    // readSpendSnapshotForDate already logs its own warnings and never
    // throws, but belt-and-suspenders here keeps the canary calm.
    return;
  }
  if (rows.length === 0) {
    console.log(`\n  spend snapshot: ledger empty for ${date} (shadow mode)`);
    return;
  }
  console.log(`\n  spend snapshot for ${date}:`);
  for (const r of rows) {
    const cap = r.cap_usd === null ? "—" : `$${r.cap_usd.toFixed(2)}`;
    const pct =
      r.cap_usd && r.cap_usd > 0
        ? ` (${Math.round((r.spent_usd / r.cap_usd) * 100)}%)`
        : "";
    console.log(
      `    ${r.tenant_id.padEnd(24, " ")} ${r.platform.padEnd(20, " ")} ` +
        `$${r.spent_usd.toFixed(4)} / ${cap}${pct}  ${r.prompt_count} prompts`,
    );
  }
}

function logPlatform(p: PlatformPollHealth): void {
  const label = p.platform.padEnd(10, " ");
  const chunks = `${p.completedChunks}/${p.expectedChunks} chunks`;
  const obs = `${p.observationsWritten} prompts`;
  const statusGlyph =
    p.status === "ok"
      ? "✓"
      : p.status === "partial"
        ? "▲"
        : p.status === "failed"
          ? "✗"
          : "…";
  console.log(
    `  ${statusGlyph} ${label} ${p.status.padEnd(8, " ")} ${chunks}, ${obs}` +
      (p.latestRun ? `  (latest: ${p.latestRun.runId})` : ""),
  );
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("Unhandled error:", err);
    process.exit(2);
  },
);
