/**
 * Architecture invariant — TENANT-SCOPED-ADMIN-READS (wave-2/3, 2026-06-14).
 *
 * The general net behind the wave-2 #1 CRITICAL: `today-kpis.ts` read
 * `daily_metric_snapshots` via the RLS-BYPASSING service-role admin client
 * (`getSupabaseAdmin()`) with NO tenant filter, so /today's headline tiles
 * summed citations/mentions across ALL tenants. The dozens of targeted
 * isolation ratchets didn't catch it because none checked the GENERAL class:
 * "a direct admin-client SELECT on a tenant-scoped table that is completely
 * tenant-blind." This pins that class forward.
 *
 * CONTRACT: every `getSupabaseAdmin().from("<table>")…select(…)` read in
 * application code (src, excluding the persistence repository layer that IS
 * the scoping boundary, and excluding tests) must, within its local window,
 * EITHER
 *   • filter by tenant — `.eq("tenant_id", …)` (possibly conditional), OR
 *   • carry an explicit `tenant-isolation-exempt: <reason>` marker
 *     (for deliberate fleet-wide operator diagnostics that read every tenant
 *     and group by tenant_id downstream — e.g. the poll-watchdog),
 * UNLESS the table is in the small GLOBAL_TABLES allowlist (genuinely not
 * tenant-scoped: the registry, the JSONB business_config keyed by id, the
 * anonymous cross-tenant brain aggregates, and answer_texts which is keyed by
 * the tenant-unique observation_id).
 *
 * New tables are conservatively treated as tenant-scoped (fail-closed): a new
 * unscoped admin read of an unknown table fails this test until the author
 * adds a tenant filter or an explicit exemption.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const SRC = join(REPO_ROOT, "src");

// Genuinely-not-tenant-scoped tables (verified against prod 2026-06-14):
//   tenants               — the tenant registry itself
//   business_config       — keyed by id = tenantId (JSONB blob)
//   change_patterns       — anonymous cross-tenant "brain" aggregate
//   confidence_calibration— global calibration aggregate
//   triage_rules          — global triage-outcome aggregate
//   answer_texts          — keyed by the tenant-unique obs-native-{run}-{prompt}
const GLOBAL_TABLES = new Set([
  "tenants",
  "business_config",
  "change_patterns",
  "confidence_calibration",
  "triage_rules",
  "answer_texts",
]);

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    if (name.endsWith(".d.ts")) continue;
    // The persistence repository layer + the supabase client + dual-write ARE
    // the tenant-scoping boundary (they implement forTenant / explicit
    // tenant_id filters and are covered by their own dedicated ratchets).
    if (full.includes("/persistence/repositories/")) continue;
    if (full.endsWith("/persistence/supabase.ts")) continue;
    if (full.endsWith("/persistence/dual-write.ts")) continue;
    out.push(full);
  }
  return out;
}

type Violation = { file: string; line: number; table: string };

function scanFile(path: string): Violation[] {
  const src = readFileSync(path, "utf8");
  if (!src.includes("getSupabaseAdmin")) return [];
  const violations: Violation[] = [];
  const fromRe = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(src)) !== null) {
    const table = m[1]!;
    if (GLOBAL_TABLES.has(table)) continue;
    const pos = m.index;
    const matchEnd = m.index + m[0].length;
    // Is this a READ? `.select(` must follow `.from(...)` before the next
    // write verb / statement end. Look in a tight forward window.
    const fwd = src.slice(matchEnd, matchEnd + 200);
    const isSelect = /^\s*(?:\.[a-zA-Z]+\([^)]*\)\s*)*?\.select\(/.test(fwd)
      || /\.select\(/.test(fwd.split(";")[0] ?? "");
    if (!isSelect) continue;
    // Tenant-awareness window: a tenant filter or explicit exemption within
    // ±1800 chars (captures conditional `.eq("tenant_id", …)` placed before
    // or after the builder, and a marker comment on the read).
    const win = src.slice(Math.max(0, pos - 1800), pos + 1800);
    const scoped =
      /\.eq\(\s*["'`]tenant_id["'`]/.test(win) ||
      /tenant-isolation-exempt/.test(win);
    if (scoped) continue;
    const line = src.slice(0, pos).split("\n").length;
    violations.push({ file: path.replace(REPO_ROOT + "/", ""), line, table });
  }
  return violations;
}

describe("TENANT-SCOPED-ADMIN-READS — no tenant-blind admin SELECTs", () => {
  it("every getSupabaseAdmin().from(table).select() filters by tenant_id or is explicitly exempt", () => {
    const files = collectTsFiles(SRC);
    const violations = files.flatMap(scanFile);
    expect(
      violations,
      `These admin-client SELECT reads of (presumed) tenant-scoped tables have NO ` +
        `.eq("tenant_id", …) filter and no \`tenant-isolation-exempt: <reason>\` marker ` +
        `in scope — this is the wave-2 #1 cross-tenant-bleed class. Add a tenant filter, ` +
        `or (for a deliberate fleet-wide operator read) an inline exempt marker, or add ` +
        `the table to GLOBAL_TABLES if it is genuinely not tenant-scoped:\n` +
        violations.map((v) => `  - ${v.file}:${v.line}  table=${v.table}`).join("\n"),
    ).toEqual([]);
  });
});
