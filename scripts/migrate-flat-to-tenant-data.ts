/**
 * Sprint 7 Phase 7.8a (2026-04-25) — flat .data → per-tenant migration.
 *
 * Reads every `.data/*.json` file and routes each store to its
 * per-tenant or global destination:
 *
 *   - per-tenant array stores (e.g. results, page-snapshots):
 *       filter rows where `tenant_id` matches the Ritz tenant (or is
 *       empty/missing — those were stamped Ritz by Phase 7.2 backfill)
 *       → write to `.data/tenants/{slug}/{name}.json`
 *
 *   - per-tenant singleton stores (e.g. citation-evidence-index):
 *       copy verbatim → `.data/tenants/{slug}/{name}.json`
 *
 *   - global stores (e.g. business-config, change-patterns):
 *       copy verbatim → `.data/global/{name}.json`
 *
 *   - unknown stores (any flat *.json not in the three lists above):
 *       skip with a "note" — the operator must add to one of the lists.
 *
 * Default mode is dry-run — prints the migration plan without writing.
 * Pass `--commit` to actually write files.
 *
 * Phase 7.8a does NOT:
 *   - delete or rename flat `.data/*.json` files (Phase 7.8d will)
 *   - update json-store / dotdata-json routing (Phase 7.8b)
 *   - move flat originals to `.data/_legacy/` (Phase 7.8d)
 *   - lift `seed-data.server.ts` module-level await (Phase 7.8e)
 *
 * Rollback (during 7.8a only — flat files untouched):
 *   $ rm -rf .data/tenants .data/global
 *   # flat .data/*.json still in place; nothing else changed.
 *
 * Usage:
 *   npx tsx scripts/migrate-flat-to-tenant-data.ts            # dry-run
 *   npx tsx scripts/migrate-flat-to-tenant-data.ts --commit   # write
 *
 * Exit codes:
 *   0 — completed (dry-run or commit)
 *   1 — fatal error (e.g. .data/ missing)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// ── Store classification ────────────────────────────────────────────
//
// Aligned with `scripts/backfill-tenant-id.ts`. Phase 7.8 will eventually
// consolidate these lists with `GLOBAL_TABLES` in `dual-write.ts`; until
// then, treat backfill-tenant-id as the authoritative source for which
// .data/*.json stores carry tenant_id.

export const TENANT_SCOPED_STORES = new Set<string>([
  // Inherited from scripts/backfill-tenant-id.ts (38 stores).
  "imported-results",
  "imported-changes",
  "imported-opportunities",
  "imported-competitors",
  "import-runs",
  "event-decisions",
  "candidate-links",
  "pages",
  "page-snapshots",
  "page-snapshots-prev",
  "page-guardrails",
  "page-issues",
  "scan-findings",
  "observation-runs",
  "scan-runs",
  "daily-metric-snapshots",
  "experiments",
  "change-outcomes",
  "change-contracts",
  "truth-labels",
  "tracked-prompts",
  "tracked-entities",
  "prompt-answer-observations",
  "local-reviews",
  "page-visibility",
  "recommendation-responses",
  "action-states",
  "brief-states",
  "rollout-executions",
  "pattern-evidence",
  "frontier-attack-packages",
  "tracked-missing-pages",
  "asset-responses",
  "outcome-store",
  "competitor-page-evidence",
  "source-pattern-evidence",
  "render-checks",
  "page-snapshot-diffs",
  // Phase 7.8a.1 (2026-04-25) — classified from the live dry-run.
  // 9 stores added; rationale recorded in docs/VERIFICATION_LOG.md.
  "change-events", // per-tenant Phase 0 truth-layer events
  "classified-events", // per-tenant taxonomy classification of historical changes
  "data-quality-flags", // per-tenant data-quality flags for ingestion windows
  "event-attributions", // per-tenant attribution verdicts on change-events
  "natural-control-results", // per-tenant natural-control attribution per event
  "page-element-inventory", // Sprint 6A.1 P6; rows already carry tenant_id
  "recommended-edits", // Sprint 6A.1 P11; rows already carry tenant_id
  "site-movement-events", // per-tenant Phase 0 movement events
  "url-change-outcomes", // Tier A; rows already carry tenant_id
]);

export const SINGLETON_STORES = new Set<string>([
  "answer-intelligence-index",
  "citation-evidence-index",
  // Phase 7.8a.1 (2026-04-25) — per-tenant singletons added from
  // the live dry-run. Each is a single object scoped to one tenant
  // (or trivially scoped because the operator runs one site today).
  "change-outcomes-summary", // aggregate of change-outcomes
  "natural-control-summary", // aggregate of natural-control-results
  "robots-state", // per-tenant parsed robots.txt for the tenant's domain
  "site-citation-timeline", // per-tenant timeline; root object carries tenant_id
  "taxonomy-distribution-report", // aggregate of classified-events
  "url-daily-citations", // per-tenant daily citation series (single-entry)
  "url-watcher-state", // per-tenant watcher throttle/phase state
]);

export const GLOBAL_STORES = new Set<string>([
  "tenants",
  "change-patterns",
  "triage-rules",
  "confidence-calibration",
  "business-config",
  "competitor-universe",
  "competitor-monitoring",
  "co-mention-matrix",
  "exit-gates",
  "milestone-state",
  "scan-state",
  "last-scan-result",
  "sitemap-reconciliation",
  "prompt-library",
  "answer-texts",
  "cost-ledger",
  // Phase 7.8a.1 (2026-04-25) — globals added from the live dry-run.
  // Each is operator-shared / cross-tenant by design.
  "adjudicator-cache", // LLM dedup cache, no tenant_id; operator-shared
  "adjudicator-history", // LLM call audit log; operator-shared
  "llm-budget", // operator-paid monthly LLM spend cap
  "shared-brain", // explicit cross-tenant pattern aggregate
  "shared-brain-summary", // aggregate of shared-brain
  "url-change-patterns", // global learning aggregate (mirror of change-patterns)
]);

// ── Types ───────────────────────────────────────────────────────────

export type StoreClassification =
  | "per-tenant"
  | "singleton"
  | "global"
  | "unknown";

export type FileReport = {
  name: string;
  classification: StoreClassification;
  sourcePath: string;
  sourceExists: boolean;
  /** Number of rows in the source array; null for non-array sources. */
  sourceRowCount: number | null;
  destPath: string;
  /** Number of rows written to the dest. May be < sourceRowCount when
   *  per-tenant filtering drops other-tenant rows. Null for non-array. */
  destRowCount: number | null;
  /** For per-tenant array stores: counts grouped by `tenant_id` value
   *  observed in the source file. Empty/missing tenant_ids show as
   *  `(empty)`. */
  byTenant: Record<string, number>;
  notes: string[];
  wrote: boolean;
};

export type MigrateOptions = {
  /** Root directory containing `.data/`. Useful for tests with tmpdirs. */
  dataRoot: string;
  /** Tenant id used to filter per-tenant rows. Defaults to Ritz. */
  ritzTenantId: string;
  /** Tenant slug used for the destination subdirectory. */
  ritzTenantSlug: string;
  /** When false (default), do not write files. */
  commit: boolean;
};

// ── Migration logic ─────────────────────────────────────────────────

function classify(name: string): StoreClassification {
  if (TENANT_SCOPED_STORES.has(name)) return "per-tenant";
  if (SINGLETON_STORES.has(name)) return "singleton";
  if (GLOBAL_STORES.has(name)) return "global";
  return "unknown";
}

function readJson(path: string): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, data: JSON.parse(readFileSync(path, "utf8")) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function ensureDir(dir: string, commit: boolean): void {
  if (!commit) return;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeJson(path: string, data: unknown, commit: boolean): boolean {
  if (!commit) return false;
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  return true;
}

export function processStore(name: string, opts: MigrateOptions): FileReport {
  const dataDir = join(opts.dataRoot, ".data");
  const sourcePath = join(dataDir, `${name}.json`);
  const cls = classify(name);

  const tenantsDir = join(dataDir, "tenants", opts.ritzTenantSlug);
  const globalDir = join(dataDir, "global");

  const report: FileReport = {
    name,
    classification: cls,
    sourcePath,
    sourceExists: existsSync(sourcePath),
    sourceRowCount: null,
    destPath: "",
    destRowCount: null,
    byTenant: {},
    notes: [],
    wrote: false,
  };

  if (!report.sourceExists) {
    report.notes.push("source file not found — skipping");
    return report;
  }

  const parsed = readJson(sourcePath);
  if (!parsed.ok) {
    report.notes.push(`could not parse JSON: ${parsed.error}`);
    return report;
  }
  const data = parsed.data;

  if (cls === "global") {
    report.destPath = join(globalDir, `${name}.json`);
    if (Array.isArray(data)) {
      report.sourceRowCount = data.length;
      report.destRowCount = data.length;
    }
    ensureDir(globalDir, opts.commit);
    report.wrote = writeJson(report.destPath, data, opts.commit);
    return report;
  }

  if (cls === "singleton") {
    report.destPath = join(tenantsDir, `${name}.json`);
    ensureDir(tenantsDir, opts.commit);
    report.wrote = writeJson(report.destPath, data, opts.commit);
    return report;
  }

  if (cls === "per-tenant") {
    if (!Array.isArray(data)) {
      report.notes.push(
        "expected array for per-tenant store; got non-array (skipping)",
      );
      return report;
    }
    report.sourceRowCount = data.length;
    report.destPath = join(tenantsDir, `${name}.json`);

    // Tally rows by tenant_id; collect Ritz + empty rows for the
    // destination (Phase 7.2 stamped legacy empty-string rows to Ritz
    // at the DB; locally they may still be empty — coerce here).
    const ritzRows: unknown[] = [];
    for (const row of data) {
      const tid =
        row && typeof row === "object" && "tenant_id" in row
          ? String((row as { tenant_id?: unknown }).tenant_id ?? "")
          : "";
      const bucket = tid === "" ? "(empty)" : tid;
      report.byTenant[bucket] = (report.byTenant[bucket] ?? 0) + 1;
      if (tid === opts.ritzTenantId || tid === "") {
        ritzRows.push(row);
      }
    }
    report.destRowCount = ritzRows.length;

    // Honest report when other-tenant rows exist.
    const otherTenantCount = data.length - ritzRows.length;
    if (otherTenantCount > 0) {
      report.notes.push(
        `mixed-tenant: ${otherTenantCount} row(s) belong to other tenants and are NOT copied to ${opts.ritzTenantSlug}`,
      );
    }

    ensureDir(tenantsDir, opts.commit);
    report.wrote = writeJson(report.destPath, ritzRows, opts.commit);
    return report;
  }

  // unknown
  report.notes.push(
    "unclassified store — add to TENANT_SCOPED_STORES, SINGLETON_STORES, or GLOBAL_STORES",
  );
  return report;
}

/**
 * Walk every store: the union of (TENANT_SCOPED_STORES ∪ SINGLETON_STORES
 * ∪ GLOBAL_STORES) PLUS any flat `.data/*.json` file we don't recognize
 * (so the operator sees unknowns even if the lists are stale).
 */
export function runMigration(opts: MigrateOptions): FileReport[] {
  const dataDir = join(opts.dataRoot, ".data");
  const allStores = new Set<string>([
    ...TENANT_SCOPED_STORES,
    ...SINGLETON_STORES,
    ...GLOBAL_STORES,
  ]);
  if (existsSync(dataDir)) {
    for (const entry of readdirSync(dataDir)) {
      if (!entry.endsWith(".json")) continue;
      allStores.add(entry.replace(/\.json$/, ""));
    }
  }
  const sortedStores = [...allStores].sort();
  return sortedStores.map((name) => processStore(name, opts));
}

// ── CLI entry ───────────────────────────────────────────────────────

const RITZ_TENANT_ID = "tenant-ritz-founder";
const RITZ_TENANT_SLUG = "ritz-builders";

export function formatReport(reports: FileReport[]): string {
  const lines: string[] = [];
  for (const r of reports) {
    lines.push(`[${r.classification}] ${r.name}`);
    if (!r.sourceExists) {
      lines.push(`  source not found: ${r.sourcePath}`);
      continue;
    }
    const srcRows =
      r.sourceRowCount !== null ? ` (${r.sourceRowCount} rows)` : "";
    const dstRows =
      r.destRowCount !== null ? ` (${r.destRowCount} rows)` : "";
    lines.push(`  source: ${r.sourcePath}${srcRows}`);
    if (r.destPath) {
      lines.push(`  dest:   ${r.destPath}${dstRows}`);
    }
    if (Object.keys(r.byTenant).length > 0) {
      lines.push(`  by tenant: ${JSON.stringify(r.byTenant)}`);
    }
    for (const note of r.notes) {
      lines.push(`  note: ${note}`);
    }
  }
  return lines.join("\n");
}

export function summarize(reports: FileReport[]): {
  perTenant: number;
  global: number;
  singleton: number;
  unknown: number;
  missing: number;
  wrote: number;
} {
  const counts = {
    perTenant: 0,
    global: 0,
    singleton: 0,
    unknown: 0,
    missing: 0,
    wrote: 0,
  };
  for (const r of reports) {
    if (!r.sourceExists) {
      counts.missing++;
      continue;
    }
    if (r.classification === "per-tenant") counts.perTenant++;
    else if (r.classification === "global") counts.global++;
    else if (r.classification === "singleton") counts.singleton++;
    else counts.unknown++;
    if (r.wrote) counts.wrote++;
  }
  return counts;
}

function main(): void {
  const argv = process.argv.slice(2);
  const commit = argv.includes("--commit");
  const opts: MigrateOptions = {
    dataRoot: process.cwd(),
    ritzTenantId: RITZ_TENANT_ID,
    ritzTenantSlug: RITZ_TENANT_SLUG,
    commit,
  };

  console.log(
    `[migrate-flat-to-tenant-data] mode=${commit ? "COMMIT" : "DRY-RUN"}`,
  );
  console.log(`  source root:        ${join(opts.dataRoot, ".data")}`);
  console.log(
    `  per-tenant target:  ${join(opts.dataRoot, ".data", "tenants", opts.ritzTenantSlug)}`,
  );
  console.log(`  global target:      ${join(opts.dataRoot, ".data", "global")}`);
  console.log();

  if (!existsSync(join(opts.dataRoot, ".data"))) {
    console.error("[migrate-flat-to-tenant-data] .data/ does not exist; nothing to migrate.");
    process.exit(1);
  }

  const reports = runMigration(opts);
  console.log("Migration plan:");
  console.log();
  console.log(formatReport(reports));

  console.log();
  console.log("Summary:");
  const c = summarize(reports);
  console.log(`  per-tenant: ${c.perTenant}`);
  console.log(`  global:     ${c.global}`);
  console.log(`  singleton:  ${c.singleton}`);
  console.log(`  unknown:    ${c.unknown}`);
  console.log(`  missing:    ${c.missing}`);
  console.log(`  written:    ${c.wrote}`);

  if (!commit) {
    console.log();
    console.log("DRY-RUN — no files written. Re-run with --commit to apply.");
    return;
  }

  console.log();
  console.log("COMMIT complete. Flat `.data/*.json` files were NOT modified.");
  console.log();
  console.log("Rollback (Phase 7.8a state — flat files still authoritative):");
  console.log("  rm -rf .data/tenants .data/global");
  console.log("  # flat .data/*.json untouched; nothing else has been changed yet.");
}

// CLI gate — only run when invoked directly via `npx tsx`, not when
// imported by tests.
const isCliInvocation =
  typeof process !== "undefined" &&
  typeof process.argv !== "undefined" &&
  process.argv[1] !== undefined &&
  /migrate-flat-to-tenant-data\.ts$/.test(process.argv[1]);
if (isCliInvocation) {
  main();
}
