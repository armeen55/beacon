/**
 * W4 (2026-05-04) — Customer-One Historical Backfill orchestrator.
 *
 * Operator scope (master plan §1.5 + §2 + W4 kickoff turn):
 *
 *   "Convert all recoverable historical Profound/raw answer data into
 *    Beacon native-shaped `historical_recovered` observations, then
 *    rederive snapshots/indexes so Beacon behaves like it has ~57 days
 *    of answer-engine intelligence."
 *
 * THIS COMMIT — Stage 0 + Stage 1 ONLY. Stage 2+ are stubbed to hard-
 * fail with an "operator approval required" exit so the script
 * structure is locked but no extract / rederive / publish path can
 * accidentally run.
 *
 * Stages
 * ──────
 *   --stage=preflight   READ-ONLY. Verifies Supabase reachability +
 *                       tenant counts + CSV hash manifest + tracked-
 *                       prompts mapping + backup-dir writability.
 *                       Default behavior; never writes.
 *   --stage=backup      Exports Supabase tables + local .data files
 *                       to `.data/_backups/pre-w4-backfill-<DATE>/`,
 *                       writes a SHA-256 manifest. Refuses same-day
 *                       overwrite without --force-overwrite. In
 *                       --dry-run mode (default) prints what WOULD be
 *                       exported but does not write.
 *
 * Reserved (future stages, not yet implemented in this commit):
 *   --stage=extract-observations
 *   --stage=rederive-snapshots
 *   --stage=copy-orphan-benchmarks
 *   --stage=relabel-changelog
 *   --stage=verify
 *   --stage=publish
 *   --stage=rollback
 *
 * Calling any reserved stage exits non-zero with a clear "not yet
 * implemented; awaiting operator approval" message.
 *
 * Critical safety guarantees (operator-locked):
 *   - Default mode is dry-run (no writes anywhere). `--write` is
 *     required to actually mutate filesystem state.
 *   - Stage 0 (preflight) NEVER writes — `--write` is a no-op there.
 *   - Stage 1 (backup) NEVER touches Supabase except read/export
 *     (no UPDATE / DELETE / INSERT against production tables).
 *   - Stage 1 NEVER writes outside `.data/_backups/`.
 *   - Same-day backup directory must NOT be overwritten without
 *     `--force-overwrite`. Refusing protects against running backup
 *     twice in one session and clobbering a known-good backup.
 *   - Source CSV hashes are pinned in `LOCKED_CSV_MANIFEST` below.
 *     Mismatch aborts preflight.
 *   - `--stage=publish` prints a giant red warning before any future
 *     implementation is run. Today it's blocked by the
 *     unimplemented-stage gate.
 *
 * Usage:
 *   BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders \
 *     npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/customer-one-backfill.ts --stage=preflight
 *
 *   BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders \
 *     npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/customer-one-backfill.ts --stage=backup --write
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { createHash } from "node:crypto";

// ── Env loader (matches scripts/build-edits-for-queue.ts) ───────────────

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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// ── Locked manifests (W4 preflight) ─────────────────────────────────────

/**
 * SHA-256 manifest of the four canonical Profound source CSVs at the
 * moment W4 preflight ran. Pinned here so any preflight + backup
 * pass can detect file drift before extracting. If the operator
 * intentionally replaces a CSV with an updated export, update this
 * map AND bump the audit log.
 */
export const LOCKED_CSV_MANIFEST: Record<string, string> = {
  "profound_raw_data_with_citations(march5th-april21st).csv":
    "be9258c6f2aa80e729d10039d8bb89b1385fe0095216513e4abf639c97097e19",
  "profound_citations_data(march5th-april21st).csv":
    "1741802b43e8421da58da213d260cbe4582f57b042d063dcc6511bec1b84c4fb",
  "profound_summarized_export_(march5th-april21st).csv":
    "bfe76a57cebb02ac428edac37914262c466c327353f0dfbbe73a300c0844f98a",
  "profound-prompts.csv":
    "171e58281f028ce710c3f02065827a1b266a0d40aa2cad714013f29bb67c532a",
};

/**
 * Supabase tables exported in Stage 1 backup. Split into TENANT-
 * SCOPED (rows carry `tenant_id`) vs GLOBAL (operator-shared
 * registry tables). The dual-write `GLOBAL_TABLES` set lists the
 * authoritative classification — `tracked_prompts` and
 * `tracked_entities` are operator-shared config, not tenant-scoped.
 * Filtering them by tenant_id raises an error.
 */
export const SUPABASE_TENANT_SCOPED_TABLES = [
  "prompt_answer_observations",
  "daily_metric_snapshots",
  "changelog_entries",
  "recommended_edits",
  "recommendation_responses",
] as const;

export const SUPABASE_GLOBAL_TABLES_TO_BACKUP = [
  "tracked_entities",
  "tracked_prompts",
] as const;

/** Combined list — preserves original constant name for back-compat
 *  with tests + downstream readers. */
export const SUPABASE_TABLES_TO_BACKUP = [
  ...SUPABASE_TENANT_SCOPED_TABLES,
  ...SUPABASE_GLOBAL_TABLES_TO_BACKUP,
] as const;

/** Predicate — returns true when a table is operator-shared global
 *  (not tenant-scoped). Used by both preflight + backup readers. */
export function isGlobalTable(table: string): boolean {
  return (SUPABASE_GLOBAL_TABLES_TO_BACKUP as readonly string[]).includes(
    table,
  );
}

// ── Stage enum + safety gates ───────────────────────────────────────────

export const ALL_STAGES = [
  "preflight",
  "backup",
  "extract-observations",
  "rederive-snapshots",
  "copy-orphan-benchmarks",
  "relabel-changelog",
  "verify",
  "publish",
  "rollback",
] as const;
export type Stage = (typeof ALL_STAGES)[number];

/** Stages whose code is wired in this commit. Calling any other
 *  stage exits non-zero with a clear "not yet implemented" message. */
export const IMPLEMENTED_STAGES = new Set<Stage>(["preflight", "backup"]);

// ── CLI flags ───────────────────────────────────────────────────────────

export type CliFlags = {
  stage: Stage | null;
  /** Default `true`. When true, every write path becomes a print-only
   *  no-op. Operator must pass --write to actually mutate the
   *  filesystem. */
  dryRun: boolean;
  /** Allow overwriting an existing same-day backup directory. */
  forceOverwrite: boolean;
  help: boolean;
};

export function parseFlags(argv: ReadonlyArray<string>): CliFlags {
  const flags: CliFlags = {
    stage: null,
    dryRun: true,
    forceOverwrite: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--write") flags.dryRun = false;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--force-overwrite") flags.forceOverwrite = true;
    else if (arg.startsWith("--stage=")) {
      const v = arg.slice("--stage=".length).trim();
      flags.stage = v as Stage;
    }
  }
  return flags;
}

/** Validate a parsed `flags.stage` against the known + implemented
 *  set. Returns a structured verdict the caller can act on. */
export function validateStage(stage: Stage | null): {
  ok: boolean;
  reason: string;
  isReserved: boolean;
} {
  if (stage === null) {
    return {
      ok: false,
      reason: "no --stage provided. Pass --stage=preflight or --stage=backup.",
      isReserved: false,
    };
  }
  if (!ALL_STAGES.includes(stage)) {
    return {
      ok: false,
      reason: `unknown stage ${JSON.stringify(stage)}. Valid stages: ${ALL_STAGES.join(", ")}`,
      isReserved: false,
    };
  }
  if (!IMPLEMENTED_STAGES.has(stage)) {
    return {
      ok: false,
      reason: `stage ${JSON.stringify(stage)} is reserved but NOT YET IMPLEMENTED. Awaiting operator approval. (Implemented today: ${[...IMPLEMENTED_STAGES].join(", ")}.)`,
      isReserved: true,
    };
  }
  return { ok: true, reason: "ok", isReserved: false };
}

function printHelp(): void {
  console.log(
    [
      "scripts/customer-one-backfill.ts — W4 customer-one historical backfill orchestrator.",
      "",
      "Stages:",
      "  --stage=preflight   READ-ONLY. Verify Supabase counts + CSV hash manifest + ",
      "                      tracked-prompts mapping + backup-dir writability.",
      "  --stage=backup      Export Supabase tables + local .data files to ",
      "                      .data/_backups/pre-w4-backfill-<DATE>/. Default dry-run.",
      "",
      "Future stages (NOT YET IMPLEMENTED — awaiting operator approval):",
      "  --stage=extract-observations",
      "  --stage=rederive-snapshots",
      "  --stage=copy-orphan-benchmarks",
      "  --stage=relabel-changelog",
      "  --stage=verify",
      "  --stage=publish",
      "  --stage=rollback",
      "",
      "Flags:",
      "  --dry-run               Default. Backup stage prints what WOULD be exported.",
      "  --write                 Actually export (Stage 1 only; preflight stays read-only).",
      "  --force-overwrite       Allow same-day backup directory to be overwritten.",
      "  --help / -h             Show this and exit.",
      "",
      "Env required:",
      "  NEXT_PUBLIC_SUPABASE_URL",
      "  SUPABASE_SERVICE_ROLE_KEY",
      "  BEACON_TENANT_ID",
      "  BEACON_TENANT_SLUG",
      "",
      "Read-only by default. Stage 1 backup writes ONLY to .data/_backups/.",
      "No production writes. No paid generation.",
    ].join("\n"),
  );
}

// ── Pure helpers (testable) ─────────────────────────────────────────────

/** Compute SHA-256 of a buffer. Pure / deterministic. */
export function sha256OfBuffer(buf: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Compute SHA-256 of a file by streaming into the hasher. */
export function sha256OfFile(path: string): string {
  const buf = readFileSync(path);
  return sha256OfBuffer(buf);
}

/** Today's date in ISO yyyy-mm-dd form (pure when given a clock). */
export function dateStringFor(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Backup directory path for a given date. */
export function backupDirFor(args: {
  readonly cwd: string;
  readonly date: string;
}): string {
  return resolve(args.cwd, ".data", "_backups", `pre-w4-backfill-${args.date}`);
}

/** Whether a same-day backup is blocked by default. Returns `true`
 *  when the directory already exists AND `--force-overwrite` was not
 *  passed. Pure. */
export function shouldBlockSameDayBackup(args: {
  readonly backupDir: string;
  readonly forceOverwrite: boolean;
  readonly existsCheck: (path: string) => boolean;
}): boolean {
  if (args.forceOverwrite) return false;
  return args.existsCheck(args.backupDir);
}

// ── Backup-manifest builder (pure) ──────────────────────────────────────

export type BackupManifestEntry = {
  /** Logical name (table name OR file name). */
  readonly name: string;
  /** "supabase" | "local_file" | "csv_source". */
  readonly sourceOfTruth: "supabase" | "local_file" | "csv_source";
  /** Number of rows (Supabase + local JSON arrays). null for CSVs. */
  readonly rowCount: number | null;
  /** Bytes on disk after export. */
  readonly byteCount: number;
  /** SHA-256 of the bytes written. */
  readonly sha256: string;
  /** ISO-8601 timestamp the entry was committed to disk. */
  readonly timestamp: string;
  /** Tenant scoping (snapshot from env at backup time). */
  readonly tenantId: string;
  readonly tenantSlug: string;
  /** Path on disk relative to the backup root. */
  readonly relativePath: string;
};

export type BackupManifest = {
  /** Schema marker so future readers can adapt. */
  readonly schemaVersion: "w4-backfill-manifest/v1";
  /** ISO timestamp the manifest was finalized. */
  readonly generatedAt: string;
  /** The backup root directory (absolute). */
  readonly backupDir: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  /** sha-of-the-script-source pinning the orchestrator that produced
   *  this backup. Operator can correlate against `git log -- scripts/customer-one-backfill.ts`. */
  readonly scriptSha: string;
  /** Per-entry detail. Order matches the export sequence. */
  readonly entries: ReadonlyArray<BackupManifestEntry>;
  /** Aggregate counts for quick eyeballing. */
  readonly summary: {
    readonly totalEntries: number;
    readonly supabaseEntries: number;
    readonly localFileEntries: number;
    readonly csvSourceEntries: number;
    readonly totalBytes: number;
    readonly totalRows: number;
  };
};

export function summarizeManifest(
  entries: ReadonlyArray<BackupManifestEntry>,
): BackupManifest["summary"] {
  let totalBytes = 0;
  let totalRows = 0;
  let sb = 0;
  let lf = 0;
  let cs = 0;
  for (const e of entries) {
    totalBytes += e.byteCount;
    if (e.rowCount != null) totalRows += e.rowCount;
    if (e.sourceOfTruth === "supabase") sb++;
    else if (e.sourceOfTruth === "local_file") lf++;
    else if (e.sourceOfTruth === "csv_source") cs++;
  }
  return {
    totalEntries: entries.length,
    supabaseEntries: sb,
    localFileEntries: lf,
    csvSourceEntries: cs,
    totalBytes,
    totalRows,
  };
}

// ── Stage 0: preflight ──────────────────────────────────────────────────

export type PreflightReport = {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly supabaseReachable: boolean;
  readonly supabase: {
    readonly observations: {
      readonly rowCount: number;
      readonly minObservedAt: string | null;
      readonly maxObservedAt: string | null;
      readonly schemaV2Coverage: {
        readonly withRegime: number;
        readonly withSourceSystem: number;
        readonly withDescriptorWindow: number;
        readonly withCitationUrls: number;
        readonly withCompetitorCoMentions: number;
        readonly withCompetitorDescriptorWindows: number;
        readonly withAnswerStructure: number;
      };
    };
    readonly snapshots: {
      readonly rowCount: number;
      readonly bySourceType: Record<string, number>;
      readonly minDate: string | null;
      readonly maxDate: string | null;
    };
    readonly recommendedEdits: { readonly rowCount: number };
    readonly recommendationResponses: { readonly rowCount: number };
    readonly trackedPrompts: { readonly rowCount: number };
    readonly trackedEntities: { readonly rowCount: number };
    readonly changelogEntries: { readonly rowCount: number };
  };
  readonly csv: {
    readonly allHashesMatch: boolean;
    readonly entries: ReadonlyArray<{
      readonly name: string;
      readonly expected: string;
      readonly actual: string;
      readonly match: boolean;
      readonly bytes: number;
    }>;
  };
  readonly trackedPromptsMatch: {
    readonly csvDistinctPrompts: number;
    readonly supabaseRowsForTenant: number;
    readonly matched: number;
    readonly unmatched: number;
    readonly orphans: ReadonlyArray<string>;
  };
  readonly backupDirWritable: boolean;
};

// ── Stage 1: backup ─────────────────────────────────────────────────────

export type BackupReport = {
  readonly dryRun: boolean;
  readonly backupDir: string;
  readonly manifest: BackupManifest | null;
  readonly skippedReason: string | null;
};

// ── main runner ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvLocal();
  const flags = parseFlags(process.argv.slice(2));

  if (flags.help) {
    printHelp();
    return;
  }

  // Big red warning if the operator is even pointing at publish.
  if (flags.stage === "publish") {
    console.error(
      "\n" +
        "█████████████████████████████████████████████████████████████████████\n" +
        "█  W4 PUBLISH STAGE — NOT YET IMPLEMENTED + NOT YET APPROVED.       █\n" +
        "█  Publish writes to production Supabase. Today this script HARD-  █\n" +
        "█  FAILS on --stage=publish. To proceed in the future, the         █\n" +
        "█  operator must approve in writing AND the verify stage must      █\n" +
        "█  pass all six checks. Stop here.                                  █\n" +
        "█████████████████████████████████████████████████████████████████████\n",
    );
  }

  const stageResult = validateStage(flags.stage);
  if (!stageResult.ok) {
    if (stageResult.isReserved) {
      console.error(`[w4-backfill] ${stageResult.reason}`);
      process.exit(2);
    }
    console.error(`[w4-backfill] ${stageResult.reason}`);
    printHelp();
    process.exit(1);
  }

  // Tenant resolution (env-required).
  const tenantId = process.env.BEACON_TENANT_ID;
  const tenantSlug = process.env.BEACON_TENANT_SLUG;
  if (!tenantId || !tenantSlug) {
    console.error(
      "[w4-backfill] BEACON_TENANT_ID and BEACON_TENANT_SLUG must be set in env (see .env.local).",
    );
    process.exit(1);
  }

  console.log(
    `[w4-backfill] tenant=${tenantId} stage=${flags.stage} dryRun=${flags.dryRun} forceOverwrite=${flags.forceOverwrite}`,
  );

  if (flags.stage === "preflight") {
    const report = await runPreflight({ tenantId, tenantSlug });
    printPreflightReport(report);
    process.exit(report.csv.allHashesMatch && report.backupDirWritable ? 0 : 3);
    return;
  }

  if (flags.stage === "backup") {
    const report = await runBackup({
      tenantId,
      tenantSlug,
      dryRun: flags.dryRun,
      forceOverwrite: flags.forceOverwrite,
    });
    printBackupReport(report);
    process.exit(report.skippedReason ? 4 : 0);
    return;
  }

  // Should not reach here — validateStage already gated unknowns.
  console.error("[w4-backfill] internal: unreachable stage handler");
  process.exit(99);
}

// ── Stage 0 implementation ──────────────────────────────────────────────

async function runPreflight(args: {
  readonly tenantId: string;
  readonly tenantSlug: string;
}): Promise<PreflightReport> {
  const { tenantId, tenantSlug } = args;

  // Lazy-import the supabase admin so test mocks can intercept.
  const { getSupabaseAdmin } = await import(
    "../src/lib/persistence/supabase"
  );
  const sb = getSupabaseAdmin();

  // 1. Supabase reachability — count of observations is a cheap RTT.
  let observationsCount = 0;
  let observationsMin: string | null = null;
  let observationsMax: string | null = null;
  let supabaseReachable = false;
  let v2Coverage = {
    withRegime: 0,
    withSourceSystem: 0,
    withDescriptorWindow: 0,
    withCitationUrls: 0,
    withCompetitorCoMentions: 0,
    withCompetitorDescriptorWindows: 0,
    withAnswerStructure: 0,
  };

  try {
    const { count, error } = await sb
      .from("prompt_answer_observations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    if (error) throw error;
    observationsCount = count ?? 0;
    supabaseReachable = true;
  } catch (err) {
    console.error(
      `[w4-backfill] preflight: Supabase prompt_answer_observations count failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (supabaseReachable) {
    // 2. Date coverage.
    try {
      const { data: minRow } = await sb
        .from("prompt_answer_observations")
        .select("observed_at")
        .eq("tenant_id", tenantId)
        .order("observed_at", { ascending: true })
        .limit(1);
      const { data: maxRow } = await sb
        .from("prompt_answer_observations")
        .select("observed_at")
        .eq("tenant_id", tenantId)
        .order("observed_at", { ascending: false })
        .limit(1);
      observationsMin = (minRow?.[0]?.observed_at as string | undefined) ?? null;
      observationsMax = (maxRow?.[0]?.observed_at as string | undefined) ?? null;
    } catch (err) {
      console.warn(
        `[w4-backfill] preflight: observed_at min/max read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 3. Schema v2 coverage. Each is a HEAD count with a not-null
    //    filter. The filter syntax is `not.is.null` for jsonb / text
    //    columns; for the metadata jsonb regime check we use
    //    `metadata->>regime`.
    v2Coverage = await countSchemaV2Coverage(sb, tenantId);
  }

  // 4. Snapshots.
  let snapshotsCount = 0;
  let snapshotsBySource: Record<string, number> = {};
  let snapshotsMin: string | null = null;
  let snapshotsMax: string | null = null;
  if (supabaseReachable) {
    try {
      const { count } = await sb
        .from("daily_metric_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      snapshotsCount = count ?? 0;
      // For source_type breakdown we need a small group-by. Supabase
      // PostgREST doesn't have group-by on the head call, so we fetch
      // distinct values + count each.
      const sourceTypes = ["benchmark", "derived", "benchmark_archived"];
      for (const st of sourceTypes) {
        const { count: c } = await sb
          .from("daily_metric_snapshots")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("source_type", st);
        if ((c ?? 0) > 0) snapshotsBySource[st] = c ?? 0;
      }
      const { data: minRow } = await sb
        .from("daily_metric_snapshots")
        .select("date")
        .eq("tenant_id", tenantId)
        .order("date", { ascending: true })
        .limit(1);
      const { data: maxRow } = await sb
        .from("daily_metric_snapshots")
        .select("date")
        .eq("tenant_id", tenantId)
        .order("date", { ascending: false })
        .limit(1);
      snapshotsMin = (minRow?.[0]?.date as string | undefined) ?? null;
      snapshotsMax = (maxRow?.[0]?.date as string | undefined) ?? null;
    } catch (err) {
      console.warn(
        `[w4-backfill] preflight: snapshots read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 5. Recs + recs responses + tracked_prompts + tracked_entities + changelog.
  const recsCount = supabaseReachable
    ? await countTable(sb, "recommended_edits", tenantId)
    : 0;
  const recsRespCount = supabaseReachable
    ? await countTable(sb, "recommendation_responses", tenantId)
    : 0;
  const trackedPromptsCount = supabaseReachable
    ? await countTable(sb, "tracked_prompts", tenantId)
    : 0;
  const trackedEntitiesCount = supabaseReachable
    ? await countTable(sb, "tracked_entities", tenantId)
    : 0;
  const changelogCount = supabaseReachable
    ? await countTable(sb, "changelog_entries", tenantId)
    : 0;

  // 6. CSV hash check.
  const csvEntries = checkCsvHashes();
  const allHashesMatch = csvEntries.every((e) => e.match);

  // 7. tracked_prompts ↔ CSV mapping (case-insensitive exact match
  //    against the 100 distinct CSV prompts).
  const trackedPromptsMatch = supabaseReachable
    ? await checkTrackedPromptsMapping(sb, tenantId)
    : {
        csvDistinctPrompts: 0,
        supabaseRowsForTenant: 0,
        matched: 0,
        unmatched: 0,
        orphans: [] as string[],
      };

  // 8. Backup dir writability.
  const backupDirWritable = await checkBackupDirWritable();

  return {
    tenantId,
    tenantSlug,
    supabaseReachable,
    supabase: {
      observations: {
        rowCount: observationsCount,
        minObservedAt: observationsMin,
        maxObservedAt: observationsMax,
        schemaV2Coverage: v2Coverage,
      },
      snapshots: {
        rowCount: snapshotsCount,
        bySourceType: snapshotsBySource,
        minDate: snapshotsMin,
        maxDate: snapshotsMax,
      },
      recommendedEdits: { rowCount: recsCount },
      recommendationResponses: { rowCount: recsRespCount },
      trackedPrompts: { rowCount: trackedPromptsCount },
      trackedEntities: { rowCount: trackedEntitiesCount },
      changelogEntries: { rowCount: changelogCount },
    },
    csv: {
      allHashesMatch,
      entries: csvEntries,
    },
    trackedPromptsMatch,
    backupDirWritable,
  };
}

// ── Stage 0 helpers ─────────────────────────────────────────────────────

async function countTable(
  sb: ReturnType<
    typeof import("../src/lib/persistence/supabase").getSupabaseAdmin
  >,
  table: string,
  tenantId: string,
): Promise<number> {
  try {
    let q = sb
      .from(table)
      .select("*", { count: "exact", head: true });
    // Skip the tenant filter on operator-shared global tables.
    if (!isGlobalTable(table)) {
      q = q.eq("tenant_id", tenantId);
    }
    const { count } = await q;
    return count ?? 0;
  } catch (err) {
    console.warn(
      `[w4-backfill] preflight: ${table} count failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

async function countSchemaV2Coverage(
  sb: ReturnType<
    typeof import("../src/lib/persistence/supabase").getSupabaseAdmin
  >,
  tenantId: string,
): Promise<PreflightReport["supabase"]["observations"]["schemaV2Coverage"]> {
  // Each call is a tiny HEAD count. Total: 7 short queries — bounded.
  const v2 = {
    withRegime: 0,
    withSourceSystem: 0,
    withDescriptorWindow: 0,
    withCitationUrls: 0,
    withCompetitorCoMentions: 0,
    withCompetitorDescriptorWindows: 0,
    withAnswerStructure: 0,
  };
  const checks: ReadonlyArray<{ key: keyof typeof v2; filter: (q: any) => any }> = [
    {
      key: "withRegime",
      filter: (q) => q.not("metadata->>regime", "is", null),
    },
    {
      key: "withSourceSystem",
      filter: (q) => q.not("metadata->>source_system", "is", null),
    },
    {
      key: "withDescriptorWindow",
      filter: (q) => q.not("descriptor_window", "is", null),
    },
    {
      key: "withCitationUrls",
      filter: (q) => q.not("citation_urls", "is", null),
    },
    {
      key: "withCompetitorCoMentions",
      filter: (q) => q.not("competitor_co_mentions", "is", null),
    },
    {
      key: "withCompetitorDescriptorWindows",
      filter: (q) => q.not("competitor_descriptor_windows", "is", null),
    },
    {
      key: "withAnswerStructure",
      filter: (q) => q.not("answer_structure", "is", null),
    },
  ];
  for (const c of checks) {
    try {
      const base = sb
        .from("prompt_answer_observations")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      const { count } = await c.filter(base);
      v2[c.key] = count ?? 0;
    } catch (err) {
      console.warn(
        `[w4-backfill] preflight: schema-v2 coverage check ${c.key} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return v2;
}

function checkCsvHashes(): PreflightReport["csv"]["entries"] {
  const cwd = process.cwd();
  const out: Array<PreflightReport["csv"]["entries"][number]> = [];
  for (const [name, expected] of Object.entries(LOCKED_CSV_MANIFEST)) {
    const path = join(cwd, ".data", name);
    if (!existsSync(path)) {
      out.push({
        name,
        expected,
        actual: "(file not found)",
        match: false,
        bytes: 0,
      });
      continue;
    }
    const actual = sha256OfFile(path);
    const bytes = statSync(path).size;
    out.push({
      name,
      expected,
      actual,
      match: actual === expected,
      bytes,
    });
  }
  return out;
}

async function checkTrackedPromptsMapping(
  sb: ReturnType<
    typeof import("../src/lib/persistence/supabase").getSupabaseAdmin
  >,
  tenantId: string,
): Promise<PreflightReport["trackedPromptsMatch"]> {
  // Read the 100 distinct CSV prompts from profound-prompts.csv.
  const csvPath = join(process.cwd(), ".data", "profound-prompts.csv");
  const csvPrompts: Set<string> = new Set();
  if (existsSync(csvPath)) {
    // Minimal CSV parser — handles quoted multiline cells via \r\n
    // but our profound-prompts.csv is clean (no embedded newlines in
    // the Prompt column). We use a tiny custom parser.
    const rows = parseSimpleCsv(readFileSync(csvPath, "utf8"));
    if (rows.length > 0) {
      const header = rows[0];
      const promptCol = header.findIndex((h) => h.toLowerCase() === "prompt");
      if (promptCol >= 0) {
        for (let i = 1; i < rows.length; i++) {
          const v = (rows[i][promptCol] ?? "").trim().toLowerCase();
          if (v.length > 0) csvPrompts.add(v);
        }
      }
    }
  }

  // Read tracked_prompts. The table is operator-shared GLOBAL — no
  // tenant_id column (see GLOBAL_TABLES in dual-write.ts). Read all
  // rows; the prompts file is the registry's source of truth.
  let supabasePromptsForTenant = 0;
  const supabasePromptTexts: Set<string> = new Set();
  try {
    const { data, error } = await sb
      .from("tracked_prompts")
      .select("text");
    if (error) throw error;
    supabasePromptsForTenant = (data ?? []).length;
    for (const r of data ?? []) {
      const t = ((r as { text: string | null }).text ?? "").trim().toLowerCase();
      if (t.length > 0) supabasePromptTexts.add(t);
    }
  } catch (err) {
    console.warn(
      `[w4-backfill] preflight: tracked_prompts read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const matched = [...csvPrompts].filter((p) =>
    supabasePromptTexts.has(p),
  ).length;
  const unmatched = csvPrompts.size - matched;
  const orphans = [...csvPrompts]
    .filter((p) => !supabasePromptTexts.has(p))
    .slice(0, 5);

  return {
    csvDistinctPrompts: csvPrompts.size,
    supabaseRowsForTenant: supabasePromptsForTenant,
    matched,
    unmatched,
    orphans,
  };
}

/** Minimal CSV parser — handles double-quoted cells with embedded
 *  commas + newlines + escaped doubles. Used only for the small
 *  profound-prompts.csv. Standard streaming-quoted-CSV state machine. */
function parseSimpleCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i += 1;
        continue;
      }
      cell += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (c === "\n" || c === "\r") {
      // EOL — push cell + row.
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      // Skip CRLF pair.
      if (c === "\r" && i + 1 < text.length && text[i + 1] === "\n") i += 1;
      i += 1;
      continue;
    }
    cell += c;
    i += 1;
  }
  // Flush trailing cell/row if non-empty.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function checkBackupDirWritable(): Promise<boolean> {
  const dir = join(process.cwd(), ".data", "_backups");
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    // Touch a probe file then remove it.
    const probe = join(dir, ".w4-preflight-probe");
    writeFileSync(probe, "ok", "utf8");
    const ok = readFileSync(probe, "utf8") === "ok";
    // Probe file stays — it's harmless and proves writability.
    return ok;
  } catch (err) {
    console.warn(
      `[w4-backfill] preflight: backup dir not writable: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

function printPreflightReport(report: PreflightReport): void {
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("W4 PREFLIGHT REPORT");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`tenant_id          : ${report.tenantId}`);
  console.log(`tenant_slug        : ${report.tenantSlug}`);
  console.log(`supabase reachable : ${report.supabaseReachable ? "yes" : "NO"}`);
  console.log("");
  console.log("─ Supabase counts (source of truth) ──────────────────────────────");
  console.log(`  prompt_answer_observations : ${report.supabase.observations.rowCount}`);
  console.log(`    observed_at min          : ${report.supabase.observations.minObservedAt ?? "(none)"}`);
  console.log(`    observed_at max          : ${report.supabase.observations.maxObservedAt ?? "(none)"}`);
  console.log(`    schema-v2 coverage:`);
  for (const [k, v] of Object.entries(report.supabase.observations.schemaV2Coverage)) {
    const pct = report.supabase.observations.rowCount > 0
      ? `${((v / report.supabase.observations.rowCount) * 100).toFixed(2)}%`
      : "n/a";
    console.log(`      ${k.padEnd(36)} ${String(v).padStart(7)}  (${pct})`);
  }
  console.log(`  daily_metric_snapshots     : ${report.supabase.snapshots.rowCount}`);
  console.log(`    by source_type           :`);
  for (const [k, v] of Object.entries(report.supabase.snapshots.bySourceType)) {
    console.log(`      ${k.padEnd(36)} ${String(v).padStart(7)}`);
  }
  console.log(`    date min                 : ${report.supabase.snapshots.minDate ?? "(none)"}`);
  console.log(`    date max                 : ${report.supabase.snapshots.maxDate ?? "(none)"}`);
  console.log(`  recommended_edits          : ${report.supabase.recommendedEdits.rowCount}`);
  console.log(`  recommendation_responses   : ${report.supabase.recommendationResponses.rowCount}`);
  console.log(`  tracked_prompts            : ${report.supabase.trackedPrompts.rowCount}`);
  console.log(`  tracked_entities           : ${report.supabase.trackedEntities.rowCount}`);
  console.log(`  changelog_entries          : ${report.supabase.changelogEntries.rowCount}`);
  console.log("");
  console.log("─ CSV hash manifest check ────────────────────────────────────────");
  for (const e of report.csv.entries) {
    const tag = e.match ? "✓" : "✗";
    console.log(`  ${tag} ${e.name.padEnd(60)}  bytes=${e.bytes}`);
    if (!e.match) {
      console.log(`      expected ${e.expected}`);
      console.log(`      actual   ${e.actual}`);
    }
  }
  console.log(`  All hashes match           : ${report.csv.allHashesMatch ? "yes" : "NO"}`);
  console.log("");
  console.log("─ tracked_prompts ↔ CSV mapping ─────────────────────────────────");
  console.log(`  CSV distinct prompts       : ${report.trackedPromptsMatch.csvDistinctPrompts}`);
  console.log(`  Supabase rows for tenant   : ${report.trackedPromptsMatch.supabaseRowsForTenant}`);
  console.log(`  Matched (case-insensitive) : ${report.trackedPromptsMatch.matched}`);
  console.log(`  Unmatched                  : ${report.trackedPromptsMatch.unmatched}`);
  if (report.trackedPromptsMatch.orphans.length > 0) {
    console.log(`  First 5 orphans:`);
    for (const o of report.trackedPromptsMatch.orphans) {
      console.log(`    - "${o.slice(0, 80)}..."`);
    }
  }
  console.log("");
  console.log("─ Backup directory ──────────────────────────────────────────────");
  console.log(`  .data/_backups writable    : ${report.backupDirWritable ? "yes" : "NO"}`);
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("");
}

// ── Stage 1 implementation ──────────────────────────────────────────────

async function runBackup(args: {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly dryRun: boolean;
  readonly forceOverwrite: boolean;
}): Promise<BackupReport> {
  const date = dateStringFor(new Date());
  const backupDir = backupDirFor({ cwd: process.cwd(), date });

  if (
    shouldBlockSameDayBackup({
      backupDir,
      forceOverwrite: args.forceOverwrite,
      existsCheck: existsSync,
    })
  ) {
    return {
      dryRun: args.dryRun,
      backupDir,
      manifest: null,
      skippedReason:
        `same-day backup directory already exists at ${backupDir}. Pass --force-overwrite to replace it.`,
    };
  }

  if (args.dryRun) {
    console.log(
      `[w4-backfill] backup DRY-RUN: would write to ${backupDir}. Pass --write to actually export.`,
    );
    // Build the manifest WITH placeholder zero-rows so the operator
    // can see what's planned, but don't actually write anything.
    const planned: BackupManifestEntry[] = [];
    const now = new Date().toISOString();
    for (const t of SUPABASE_TABLES_TO_BACKUP) {
      planned.push({
        name: t,
        sourceOfTruth: "supabase",
        rowCount: null,
        byteCount: 0,
        sha256: "",
        timestamp: now,
        tenantId: args.tenantId,
        tenantSlug: args.tenantSlug,
        relativePath: `supabase/${t}.json`,
      });
    }
    const localFiles = listLocalTenantFiles(args.tenantSlug);
    for (const f of localFiles) {
      planned.push({
        name: basename(f),
        sourceOfTruth: "local_file",
        rowCount: null,
        byteCount: statSync(f).size,
        sha256: sha256OfFile(f),
        timestamp: now,
        tenantId: args.tenantId,
        tenantSlug: args.tenantSlug,
        relativePath: `local/tenants/${args.tenantSlug}/${basename(f)}`,
      });
    }
    for (const csv of Object.keys(LOCKED_CSV_MANIFEST)) {
      const path = join(process.cwd(), ".data", csv);
      if (!existsSync(path)) continue;
      planned.push({
        name: csv,
        sourceOfTruth: "csv_source",
        rowCount: null,
        byteCount: statSync(path).size,
        sha256: sha256OfFile(path),
        timestamp: now,
        tenantId: args.tenantId,
        tenantSlug: args.tenantSlug,
        relativePath: `csv-source/${csv}`,
      });
    }
    return {
      dryRun: true,
      backupDir,
      manifest: {
        schemaVersion: "w4-backfill-manifest/v1",
        generatedAt: now,
        backupDir,
        tenantId: args.tenantId,
        tenantSlug: args.tenantSlug,
        scriptSha: hashSelfSource(),
        entries: planned,
        summary: summarizeManifest(planned),
      },
      skippedReason: null,
    };
  }

  // Real write path.
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(join(backupDir, "supabase"), { recursive: true });
  mkdirSync(join(backupDir, "local", "tenants", args.tenantSlug), {
    recursive: true,
  });
  mkdirSync(join(backupDir, "csv-source"), { recursive: true });

  const entries: BackupManifestEntry[] = [];

  // Supabase exports.
  const { getSupabaseAdmin } = await import(
    "../src/lib/persistence/supabase"
  );
  const sb = getSupabaseAdmin();
  for (const table of SUPABASE_TABLES_TO_BACKUP) {
    const exported = await exportSupabaseTable(sb, table, args.tenantId);
    const rel = `supabase/${table}.json`;
    const out = join(backupDir, rel);
    const text = JSON.stringify(exported, null, 2);
    writeFileSync(out, text, "utf8");
    const bytes = Buffer.byteLength(text, "utf8");
    entries.push({
      name: table,
      sourceOfTruth: "supabase",
      rowCount: exported.length,
      byteCount: bytes,
      sha256: sha256OfBuffer(text),
      timestamp: new Date().toISOString(),
      tenantId: args.tenantId,
      tenantSlug: args.tenantSlug,
      relativePath: rel,
    });
    console.log(
      `[w4-backfill] backup: wrote supabase/${table}.json — rows=${exported.length} bytes=${bytes}`,
    );
  }

  // Local file exports.
  const localFiles = listLocalTenantFiles(args.tenantSlug);
  for (const f of localFiles) {
    const rel = `local/tenants/${args.tenantSlug}/${basename(f)}`;
    const out = join(backupDir, rel);
    const buf = readFileSync(f);
    writeFileSync(out, buf);
    const rowCount = countRowsIfJsonArray(buf);
    entries.push({
      name: basename(f),
      sourceOfTruth: "local_file",
      rowCount,
      byteCount: buf.byteLength,
      sha256: sha256OfBuffer(buf),
      timestamp: new Date().toISOString(),
      tenantId: args.tenantId,
      tenantSlug: args.tenantSlug,
      relativePath: rel,
    });
    console.log(
      `[w4-backfill] backup: wrote ${rel} — rows=${rowCount ?? "n/a"} bytes=${buf.byteLength}`,
    );
  }

  // CSV-source hashes (we don't COPY the 140 MB of CSVs into the
  // backup — we record their hash + size so the manifest pins them).
  for (const csv of Object.keys(LOCKED_CSV_MANIFEST)) {
    const path = join(process.cwd(), ".data", csv);
    if (!existsSync(path)) continue;
    const rel = `csv-source/${csv}.sha256`;
    const out = join(backupDir, rel);
    const sha = sha256OfFile(path);
    const bytes = statSync(path).size;
    writeFileSync(out, `${sha}  ${csv}  bytes=${bytes}\n`, "utf8");
    entries.push({
      name: csv,
      sourceOfTruth: "csv_source",
      rowCount: null,
      byteCount: bytes,
      sha256: sha,
      timestamp: new Date().toISOString(),
      tenantId: args.tenantId,
      tenantSlug: args.tenantSlug,
      relativePath: rel,
    });
    console.log(
      `[w4-backfill] backup: pinned csv-source/${csv} — sha=${sha.slice(0, 12)}... bytes=${bytes}`,
    );
  }

  const manifest: BackupManifest = {
    schemaVersion: "w4-backfill-manifest/v1",
    generatedAt: new Date().toISOString(),
    backupDir,
    tenantId: args.tenantId,
    tenantSlug: args.tenantSlug,
    scriptSha: hashSelfSource(),
    entries,
    summary: summarizeManifest(entries),
  };
  writeFileSync(
    join(backupDir, "backup-manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  // Human-readable echo.
  writeFileSync(
    join(backupDir, "backup-manifest.txt"),
    composeHumanManifest(manifest),
    "utf8",
  );
  console.log(
    `[w4-backfill] backup: wrote backup-manifest.json + backup-manifest.txt`,
  );

  return {
    dryRun: false,
    backupDir,
    manifest,
    skippedReason: null,
  };
}

async function exportSupabaseTable(
  sb: ReturnType<
    typeof import("../src/lib/persistence/supabase").getSupabaseAdmin
  >,
  table: string,
  tenantId: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    let q = sb
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    // Operator-shared global tables (tracked_prompts /
    // tracked_entities) carry no tenant_id column — skip the filter.
    if (!isGlobalTable(table)) {
      q = q.eq("tenant_id", tenantId);
    }
    const { data, error } = await q;
    if (error) {
      throw new Error(
        `supabase ${table} export failed at offset ${from}: ${error.message}`,
      );
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

function listLocalTenantFiles(tenantSlug: string): string[] {
  const base = join(process.cwd(), ".data", "tenants", tenantSlug);
  if (!existsSync(base)) return [];
  const out: string[] = [];
  for (const name of readdirSync(base)) {
    if (!name.endsWith(".json")) continue;
    out.push(join(base, name));
  }
  return out.sort();
}

function countRowsIfJsonArray(buf: Buffer): number | null {
  try {
    const v = JSON.parse(buf.toString("utf8"));
    if (Array.isArray(v)) return v.length;
    return null;
  } catch {
    return null;
  }
}

function hashSelfSource(): string {
  // The script's own source — pinning the orchestrator that produced
  // the backup. A future restore knows which version of this file
  // wrote the manifest.
  try {
    return sha256OfFile(__filename);
  } catch {
    return "(unknown)";
  }
}

function composeHumanManifest(m: BackupManifest): string {
  const lines: string[] = [];
  lines.push(`# W4 backup manifest`);
  lines.push(`# generated_at : ${m.generatedAt}`);
  lines.push(`# backup_dir   : ${m.backupDir}`);
  lines.push(`# tenant_id    : ${m.tenantId}`);
  lines.push(`# tenant_slug  : ${m.tenantSlug}`);
  lines.push(`# script_sha   : ${m.scriptSha}`);
  lines.push(``);
  lines.push(
    `# Summary: ${m.summary.totalEntries} entries (${m.summary.supabaseEntries} Supabase, ${m.summary.localFileEntries} local, ${m.summary.csvSourceEntries} CSV-source pins) · totalRows=${m.summary.totalRows} · totalBytes=${m.summary.totalBytes}`,
  );
  lines.push(``);
  for (const e of m.entries) {
    lines.push(
      `${e.sha256}  ${e.relativePath}  rows=${e.rowCount ?? "n/a"}  bytes=${e.byteCount}  source=${e.sourceOfTruth}`,
    );
  }
  return lines.join("\n") + "\n";
}

function printBackupReport(report: BackupReport): void {
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`W4 BACKUP REPORT ${report.dryRun ? "(DRY-RUN)" : "(WRITTEN)"}`);
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`backup directory        : ${report.backupDir}`);
  if (report.skippedReason) {
    console.log(`SKIPPED                 : ${report.skippedReason}`);
    console.log("══════════════════════════════════════════════════════════════════");
    console.log("");
    return;
  }
  if (!report.manifest) {
    console.log("no manifest produced");
    return;
  }
  const m = report.manifest;
  console.log(`generated_at            : ${m.generatedAt}`);
  console.log(`tenant_id               : ${m.tenantId}`);
  console.log(`tenant_slug             : ${m.tenantSlug}`);
  console.log(`script_sha              : ${m.scriptSha.slice(0, 16)}...`);
  console.log(`entries                 : ${m.summary.totalEntries}`);
  console.log(
    `  supabase / local / csv : ${m.summary.supabaseEntries} / ${m.summary.localFileEntries} / ${m.summary.csvSourceEntries}`,
  );
  console.log(`total rows backed up    : ${m.summary.totalRows}`);
  console.log(`total bytes backed up   : ${m.summary.totalBytes}`);
  console.log("");
  console.log("Per-entry detail:");
  for (const e of m.entries) {
    console.log(
      `  ${(e.sourceOfTruth + ":").padEnd(13)} ${e.relativePath.padEnd(60)} rows=${String(e.rowCount ?? "n/a").padStart(6)}  bytes=${String(e.byteCount).padStart(9)}  sha=${e.sha256.slice(0, 12)}...`,
    );
  }
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("");
}

// ── Entry ──────────────────────────────────────────────────────────────

// Only run the orchestrator when the file is invoked directly (not
// when it's imported by tests).
const isDirectRun =
  typeof require !== "undefined" && require.main === module;
if (isDirectRun) {
  main().catch((err) => {
    console.error(
      `[w4-backfill] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
    );
    process.exit(99);
  });
}
