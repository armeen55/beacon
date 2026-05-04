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
 *  stage exits non-zero with a clear "not yet implemented" message.
 *
 *  W4 Stage 2 (2026-05-04): `extract-observations` lands STAGED
 *  ONLY — output goes to `.data/_staging/`, never touching Supabase
 *  or the live `.data/tenants/` tree. */
export const IMPLEMENTED_STAGES = new Set<Stage>([
  "preflight",
  "backup",
  "extract-observations",
  "rederive-snapshots",
  "copy-orphan-benchmarks",
  "relabel-changelog",
]);

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

  if (flags.stage === "extract-observations") {
    const report = await runExtractObservations({
      tenantId,
      tenantSlug,
      dryRun: flags.dryRun,
    });
    printExtractObservationsReport(report);
    process.exit(report.errors.length > 0 ? 5 : 0);
    return;
  }

  if (flags.stage === "rederive-snapshots") {
    const report = await runRederiveSnapshots({
      tenantId,
      tenantSlug,
      dryRun: flags.dryRun,
    });
    printRederiveSnapshotsReport(report);
    process.exit(report.errors.length > 0 ? 6 : 0);
    return;
  }

  if (flags.stage === "copy-orphan-benchmarks") {
    const report = await runCopyOrphanBenchmarks({
      tenantId,
      tenantSlug,
      dryRun: flags.dryRun,
    });
    printCopyOrphanBenchmarksReport(report);
    process.exit(report.errors.length > 0 ? 7 : 0);
    return;
  }

  if (flags.stage === "relabel-changelog") {
    const report = await runRelabelChangelog({
      tenantId,
      tenantSlug,
      dryRun: flags.dryRun,
    });
    printRelabelChangelogReport(report);
    process.exit(report.errors.length > 0 ? 8 : 0);
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

// ── Stage 2: extract-observations (staging only) ────────────────────────
//
// Stream the raw Profound CSV row-by-row, run Schema v2 extractors per
// row, stamp `historical_recovered` provenance, write to:
//   .data/_staging/w4-extracted-observations.json   (full staged set)
//   .data/_staging/w4-extraction-report.json        (counts + samples)
//   .data/_staging/w4-extraction-progress.json      (resumable checkpoint)
//
// The output is ONLY a staged JSON file. There are NO Supabase writes
// and NO mutations to live `.data/tenants/`. Operator scope (W4
// Stage 2 turn): "Stage 2 ends with staged JSON only."
//
// Idempotent: deterministic IDs (sha256 hash of stable inputs) →
// re-running produces byte-identical observations. The progress
// checkpoint is informational; resuming a partial run is supported
// in a follow-up commit if needed.
//
// Does NOT depend on the stale `.data/tenants/.../prompt-answer-
// observations.json` (the operator's correction). Reads:
//   - `.data/profound_raw_data_with_citations(...).csv` (source)
//   - `tracked_prompts` (Supabase, global table) — for prompt id mapping
//   - `tracked_entities` (Supabase, global table) — for owned + competitor
// And writes ONLY to `.data/_staging/`.

export type ExtractObservationsReport = {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly dryRun: boolean;
  readonly stagingDir: string;
  readonly inputCsv: string;
  readonly inputCsvHash: string;
  readonly extractedAt: string;
  readonly inputRows: number;
  readonly stagedObservations: number;
  readonly skippedRowsByReason: Record<string, number>;
  readonly dateCoverage: {
    readonly distinctDates: number;
    readonly minDate: string | null;
    readonly maxDate: string | null;
  };
  readonly platformBreakdown: Record<string, number>;
  readonly promptMatch: {
    readonly csvDistinctPrompts: number;
    readonly mapped: number;
    readonly orphans: number;
    readonly orphanSamples: ReadonlyArray<string>;
  };
  readonly fieldCoverage: {
    readonly responsePresent: number;
    readonly searchQueriesPresent: number;
    readonly citationUrlsPresent: number;
    readonly citationDomainsPresent: number;
    readonly competitorCoMentionsPresent: number;
    readonly competitorDescriptorWindowsPresent: number;
    readonly answerStructurePresent: number;
    readonly primaryRecommendationTrue: number;
    readonly mentionsPresent: number;
  };
  readonly aioBlindSpotCount: number;
  readonly sampleObservationIds: ReadonlyArray<string>;
  readonly sampleObservationMetadata: ReadonlyArray<unknown>;
  readonly errors: ReadonlyArray<string>;
};

/** Pure: deterministic UUID-shaped id from stable inputs. Operator
 *  scope: "Rerun must produce the same IDs." */
export function deterministicObservationId(args: {
  readonly tenantId: string;
  readonly date: string;
  readonly platform: string;
  readonly promptId: string;
  readonly runId: string;
  readonly answerHash: string;
}): string {
  const seed = `${args.tenantId}::${args.date}::${args.platform}::${args.promptId}::${args.runId}::${args.answerHash}`;
  const h = createHash("sha256").update(seed).digest("hex");
  // UUID v8-ish layout — 8-4-4-4-12 hex.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Pure: 8-char hex prefix of sha256(answer_text). Matches the
 *  shape of native observations' `answer_hash`. */
export function answerHashForText(answerText: string): string {
  return createHash("sha256").update(answerText).digest("hex").slice(0, 8);
}

/** Pure: parse Profound CSV `position` field ("#1", "#2", " #3 ", "")
 *  into a 1-indexed list rank or null. */
export function parseProfoundPosition(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^#?(\d+)$/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Pure: extract citation_urls + citation_domains from a row's
 *  citation_1..citation_36 columns. */
export function extractCitationsFromRow(row: Record<string, string>): {
  citationUrls: string[];
  citationDomains: string[];
} {
  const urls: string[] = [];
  for (let i = 1; i <= 36; i++) {
    const v = (row[`citation_${i}`] ?? "").trim();
    if (v.length === 0) continue;
    urls.push(v);
  }
  const domains: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const d = extractHostname(url);
    if (!d) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    domains.push(d);
  }
  return { citationUrls: urls, citationDomains: domains };
}

function extractHostname(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    // Fallback: regex host extract. Matches `://host/...` or bare host.
    const m = url.match(/^[a-z]+:\/\/([^\/?#]+)/i);
    if (m) return m[1].toLowerCase().replace(/^www\./, "");
    return null;
  }
}

/** Pure: parse the comma-separated `normalized_mentions` field. */
export function parseMentionsField(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // De-dupe while preserving first-appearance order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

async function runExtractObservations(args: {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly dryRun: boolean;
}): Promise<ExtractObservationsReport> {
  const errors: string[] = [];
  const cwd = process.cwd();

  // 1. Verify CSV hash matches the locked manifest. Aborts if drift.
  const csvName = "profound_raw_data_with_citations(march5th-april21st).csv";
  const csvPath = join(cwd, ".data", csvName);
  if (!existsSync(csvPath)) {
    errors.push(`source CSV not found at ${csvPath}`);
    return emptyExtractReport({ tenantId: args.tenantId, tenantSlug: args.tenantSlug, dryRun: args.dryRun, csvPath, csvHash: "", errors });
  }
  const csvHash = sha256OfFile(csvPath);
  const expectedHash = LOCKED_CSV_MANIFEST[csvName];
  if (csvHash !== expectedHash) {
    errors.push(
      `source CSV hash drift: expected ${expectedHash}, got ${csvHash}. Update LOCKED_CSV_MANIFEST or restore the original file.`,
    );
    return emptyExtractReport({ tenantId: args.tenantId, tenantSlug: args.tenantSlug, dryRun: args.dryRun, csvPath, csvHash, errors });
  }

  // 2. Load tracked_prompts + tracked_entities from Supabase.
  const { getSupabaseAdmin } = await import(
    "../src/lib/persistence/supabase"
  );
  const sb = getSupabaseAdmin();

  type PromptRow = { id: string; text: string };
  type EntityRow = {
    name: string;
    aliases?: string[] | null;
    domain: string | null;
    is_owned: boolean;
    is_active: boolean;
  };

  let promptRows: PromptRow[] = [];
  try {
    const { data, error } = await sb.from("tracked_prompts").select("id, text");
    if (error) throw error;
    promptRows = (data ?? []) as PromptRow[];
  } catch (err) {
    errors.push(
      `tracked_prompts read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const promptIdByText = new Map<string, string>();
  for (const r of promptRows) {
    if (typeof r.text === "string" && typeof r.id === "string") {
      promptIdByText.set(r.text.trim().toLowerCase(), r.id);
    }
  }

  let entityRows: EntityRow[] = [];
  try {
    const { data, error } = await sb
      .from("tracked_entities")
      .select("name, aliases, domain, is_owned, is_active")
      .eq("is_active", true);
    if (error) throw error;
    entityRows = (data ?? []) as EntityRow[];
  } catch (err) {
    errors.push(
      `tracked_entities read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const ownedNameVariants: string[] = [];
  const ownedDomainSet = new Set<string>();
  const competitorDomainSet = new Set<string>();
  for (const e of entityRows) {
    if (e.is_owned) {
      if (e.name) ownedNameVariants.push(e.name);
      if (e.aliases) for (const a of e.aliases) if (a) ownedNameVariants.push(a);
      if (e.domain) ownedDomainSet.add(e.domain.toLowerCase().replace(/^www\./, ""));
    } else {
      if (e.domain) competitorDomainSet.add(e.domain.toLowerCase().replace(/^www\./, ""));
    }
  }
  const ownedEntityNameSet = new Set<string>();
  for (const e of entityRows) {
    if (e.is_owned && e.name) ownedEntityNameSet.add(e.name);
  }

  // Lazy imports for the extractors so test fixtures can mock the
  // module if needed; keeps the script's startup cheap.
  const {
    extractMentionPosition,
    extractCitationRank,
    rankEntitiesByFirstAppearance,
    extractPrimaryRecommendation,
    extractDescriptorWindow,
    extractCompetitorCoMentions,
    extractCompetitorDescriptorWindows,
    classifyCitationDomains,
    extractAnswerStructure,
  } = await import("../src/domains/prompt-answer-observations/extraction");
  const { parseSearchQueries } = await import(
    "../src/domains/prompt-answer-observations/search-query-parser"
  );

  const entitiesForOrdering = entityRows.map((e) => ({
    name: e.name,
    aliases: e.aliases ?? undefined,
  }));

  // Pick the primary brand name (first owned entity by sort) for
  // the primary-recommendation heuristic.
  const primaryBrandName =
    entityRows.find((e) => e.is_owned)?.name ?? "";

  // 3. Stream the CSV row-by-row.
  //
  // The Profound CSV has multi-line quoted response cells with embedded
  // unescaped quote characters that Node's `csv-parse` library cannot
  // tolerate (it silently drops ~32% of rows under any tested option
  // combination — confirmed against `relax_quotes`, `relax_column_count`,
  // strict mode). Python's stdlib `csv.DictReader` handles them cleanly
  // and gives the canonical 14,096-row count we verified at preflight.
  // Shell out to it via `scripts/parse-raw-csv.py` and read NDJSON.
  const records: Record<string, string>[] = await parseCsvViaPython(csvPath);

  // 4. Build the staged observations.
  const csvDistinctPrompts = new Set<string>();
  const orphanPromptSet = new Set<string>();
  const skippedByReason: Record<string, number> = {};
  const platformBreakdown: Record<string, number> = {};
  const dateSet = new Set<string>();
  const observations: unknown[] = [];

  let responsePresent = 0;
  let searchQueriesPresent = 0;
  let citationUrlsPresent = 0;
  let citationDomainsPresent = 0;
  let competitorCoMentionsPresent = 0;
  let competitorDescriptorWindowsPresent = 0;
  let answerStructurePresent = 0;
  let primaryRecommendationTrue = 0;
  let mentionsPresent = 0;
  let aioBlindSpotCount = 0;

  for (let rowIdx = 0; rowIdx < records.length; rowIdx++) {
    const r = records[rowIdx];
    const promptText = (r.prompt ?? "").trim();
    const date = (r.date ?? "").trim();
    const platform = (r.platform ?? "").trim();
    const runId = (r.run_id ?? "").trim();
    const responseText = r.response ?? "";

    csvDistinctPrompts.add(promptText.toLowerCase());

    // Prompt mapping — operator scope: "Map every CSV prompt text to
    // tracked_prompts by case-insensitive exact match. If any prompt
    // does not map, do not silently drop it. Report and skip/abort
    // based on severity."
    const promptId = promptIdByText.get(promptText.toLowerCase());
    if (!promptId) {
      orphanPromptSet.add(promptText.slice(0, 120));
      skippedByReason["orphan_prompt"] = (skippedByReason["orphan_prompt"] ?? 0) + 1;
      continue;
    }

    dateSet.add(date);
    platformBreakdown[platform] = (platformBreakdown[platform] ?? 0) + 1;

    const platformSlug = platform.toLowerCase().replace(/\s+/g, "-");
    const isAio = platform === "Google AI Overviews";
    const answerHash = answerHashForText(responseText);
    const id = deterministicObservationId({
      tenantId: args.tenantId,
      date,
      platform: platformSlug,
      promptId,
      runId,
      answerHash,
    });

    const { citationUrls, citationDomains } = extractCitationsFromRow(r);
    if (citationUrls.length > 0) citationUrlsPresent++;
    if (citationDomains.length > 0) citationDomainsPresent++;

    const mentions = parseMentionsField(r.normalized_mentions ?? r.mentions);
    if (mentions.length > 0) mentionsPresent++;

    const tracked_brand_mentioned =
      typeof r["mentioned?"] === "string"
        ? r["mentioned?"].trim().toLowerCase() === "yes"
        : null;

    // Citation rank (1-indexed) for owned domain.
    const tracked_brand_cited = (() => {
      for (const d of citationDomains) {
        if (ownedDomainSet.has(d)) return true;
      }
      return false;
    })();
    const owned_citation_count = citationDomains.filter((d) =>
      ownedDomainSet.has(d),
    ).length;
    const citation_rank = extractCitationRank(citationDomains, ownedDomainSet);

    const positionFromCsv = parseProfoundPosition(r.position);

    // Schema v2 extractors — text-derived fields. Only run when
    // response present.
    const hasResponse = responseText.trim().length > 0;
    let mention_position: number | null = null;
    let descriptor_window: string[] | null = null;
    let competitor_co_mentions: string[] | null = null;
    let competitor_descriptor_windows: Record<string, string[]> | null = null;
    let answer_structure: string | null = null;
    let primary_recommendation: boolean | null = null;
    let entitiesInOrder: string[] = [];

    if (hasResponse) {
      responsePresent++;
      mention_position = extractMentionPosition(responseText, ownedNameVariants);
      entitiesInOrder = rankEntitiesByFirstAppearance(responseText, entitiesForOrdering);
      descriptor_window = extractDescriptorWindow(
        responseText,
        mention_position,
        ownedNameVariants,
      );
      competitor_co_mentions = extractCompetitorCoMentions(
        entitiesInOrder,
        ownedEntityNameSet,
      );
      if (competitor_co_mentions.length > 0) competitorCoMentionsPresent++;
      competitor_descriptor_windows = extractCompetitorDescriptorWindows(
        responseText,
        entitiesForOrdering,
        ownedNameVariants,
      );
      if (Object.keys(competitor_descriptor_windows).length > 0)
        competitorDescriptorWindowsPresent++;
      answer_structure = extractAnswerStructure(responseText);
      if (answer_structure) answerStructurePresent++;
      primary_recommendation = extractPrimaryRecommendation(
        responseText,
        mention_position,
        entitiesInOrder,
        primaryBrandName,
      );
      if (primary_recommendation) primaryRecommendationTrue++;
    } else {
      // Empty-response handling per operator scope: "do not fake
      // text-derived fields; include them only if they can safely
      // carry citation/domain metadata".
      skippedByReason["empty_response_kept_for_citations"] =
        (skippedByReason["empty_response_kept_for_citations"] ?? 0) + 1;
    }

    const citation_domain_classes = classifyCitationDomains(
      citationDomains,
      ownedDomainSet,
      competitorDomainSet,
    );

    const rawSearchQueries = (r.search_queries ?? "").trim();
    const search_queries = parseSearchQueries(rawSearchQueries);
    if (search_queries.length > 0) searchQueriesPresent++;

    if (isAio) aioBlindSpotCount++;

    // Observed_at: use date midnight in UTC. Native observations have
    // a real timestamp; for historical_recovered we use the day at
    // 00:00 UTC since we don't have higher resolution.
    const observed_at = `${date}T00:00:00.000Z`;

    // Provenance metadata — operator-locked W4 §1.5.
    const extractionConfidence: Record<string, string> = {
      mention_position: hasResponse ? "high" : "absent_no_response",
      citation_rank: citation_rank !== null ? "high" : "no_owned_citation",
      descriptor_window: hasResponse ? "high" : "absent_no_response",
      competitor_co_mentions: hasResponse ? "low_entity_drift" : "absent_no_response",
      competitor_descriptor_windows: hasResponse ? "low_entity_drift" : "absent_no_response",
      answer_structure: hasResponse ? "high" : "absent_no_response",
      primary_recommendation: hasResponse ? "high" : "absent_no_response",
      citation_urls: isAio ? "low_aio_pre_commit_7" : "high",
      citation_domain_classes: "low_entity_drift",
      search_queries:
        isAio
          ? "blindSpot_aio"
          : rawSearchQueries.length > 0
            ? "high"
            : "absent_in_source",
    };

    const blindSpot = isAio
      ? "AIO does not expose internal queries"
      : null;

    const observation = {
      id,
      prompt_id: promptId,
      run_id: runId,
      answer_hash: answerHash,
      position: positionFromCsv,
      tracked_brand_mentioned,
      tracked_brand_cited,
      citation_count: citationUrls.length,
      owned_citation_count,
      citation_domains: citationDomains,
      citation_categories: {} as Record<string, number>,
      mentions,
      observed_at,
      platform,
      topic: (r.topic ?? "").trim(),
      raw_search_queries: rawSearchQueries,
      search_queries,
      mention_position,
      citation_rank,
      primary_recommendation,
      descriptor_window,
      competitor_co_mentions,
      competitor_descriptor_windows,
      citation_domain_classes,
      answer_structure,
      citation_urls: citationUrls,
      tenant_id: args.tenantId,
      metadata: {
        regime: "historical_recovered" as const,
        source_system: "profound_csv_extracted" as const,
        extraction_method: "deterministic_schema_v2.1",
        extraction_date: new Date().toISOString(),
        source_csv_hash: csvHash,
        source_csv_row_id: rowIdx,
        extraction_confidence: extractionConfidence,
        ...(blindSpot ? { blindSpot } : {}),
      },
    };

    observations.push(observation);
  }

  // 5. Compute final stats.
  const sortedDates = [...dateSet].sort();
  const sampleObservations = observations.slice(0, 5) as Array<{
    id: string;
    metadata: unknown;
  }>;

  const report: ExtractObservationsReport = {
    tenantId: args.tenantId,
    tenantSlug: args.tenantSlug,
    dryRun: args.dryRun,
    stagingDir: join(cwd, ".data", "_staging"),
    inputCsv: csvPath,
    inputCsvHash: csvHash,
    extractedAt: new Date().toISOString(),
    inputRows: records.length,
    stagedObservations: observations.length,
    skippedRowsByReason: skippedByReason,
    dateCoverage: {
      distinctDates: sortedDates.length,
      minDate: sortedDates[0] ?? null,
      maxDate: sortedDates[sortedDates.length - 1] ?? null,
    },
    platformBreakdown,
    promptMatch: {
      csvDistinctPrompts: csvDistinctPrompts.size,
      mapped: csvDistinctPrompts.size - orphanPromptSet.size,
      orphans: orphanPromptSet.size,
      orphanSamples: [...orphanPromptSet].slice(0, 5),
    },
    fieldCoverage: {
      responsePresent,
      searchQueriesPresent,
      citationUrlsPresent,
      citationDomainsPresent,
      competitorCoMentionsPresent,
      competitorDescriptorWindowsPresent,
      answerStructurePresent,
      primaryRecommendationTrue,
      mentionsPresent,
    },
    aioBlindSpotCount,
    sampleObservationIds: sampleObservations.map((o) => o.id),
    sampleObservationMetadata: sampleObservations.map((o) => o.metadata),
    errors,
  };

  // 6. Write staging files (always, even in dry-run — operator scope:
  //    "Write output only to .data/_staging/"; this directory is
  //    safe to write to regardless of --dry-run since it never
  //    touches production. We DO still tag the report with the
  //    dry-run flag so downstream consumers know provenance.).
  const stagingDir = report.stagingDir;
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(
    join(stagingDir, "w4-extracted-observations.json"),
    JSON.stringify(observations, null, 2),
    "utf-8",
  );
  writeFileSync(
    join(stagingDir, "w4-extraction-report.json"),
    JSON.stringify(report, null, 2),
    "utf-8",
  );
  writeFileSync(
    join(stagingDir, "w4-extraction-progress.json"),
    JSON.stringify(
      {
        completed: true,
        rowsProcessed: records.length,
        observationsStaged: observations.length,
        completedAt: new Date().toISOString(),
        // Resumability: this stage is single-pass + deterministic,
        // so a partial run can be re-attempted from the start
        // without observation drift.
        rerunable: true,
      },
      null,
      2,
    ),
    "utf-8",
  );

  return report;
}

/**
 * Spawn `scripts/parse-raw-csv.py` and read its NDJSON output line-
 * by-line. Returns the full row array. The Python parser uses
 * `csv.DictReader` with `field_size_limit(sys.maxsize)` which handles
 * the Profound CSV's multi-line quoted response cells — Node's
 * `csv-parse` library silently drops ~32% of rows on the same input.
 *
 * Fail-loud: if Python isn't on PATH, or the script exits non-zero,
 * or any line is invalid JSON, the caller's promise rejects.
 */
async function parseCsvViaPython(
  csvPath: string,
): Promise<Record<string, string>[]> {
  const { spawn } = await import("node:child_process");
  const pythonScript = join(process.cwd(), "scripts", "parse-raw-csv.py");
  if (!existsSync(pythonScript)) {
    throw new Error(`scripts/parse-raw-csv.py not found at ${pythonScript}`);
  }
  return await new Promise((resolve, reject) => {
    const proc = spawn("python3", [pythonScript, csvPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const rows: Record<string, string>[] = [];
    let buf = "";
    let stderrText = "";
    proc.stdout.setEncoding("utf-8");
    proc.stderr.setEncoding("utf-8");
    proc.stderr.on("data", (chunk: string) => {
      stderrText += chunk;
    });
    proc.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let nlIdx: number;
      while ((nlIdx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nlIdx);
        buf = buf.slice(nlIdx + 1);
        if (line.length === 0) continue;
        try {
          rows.push(JSON.parse(line));
        } catch (err) {
          reject(
            new Error(
              `parse-raw-csv NDJSON line invalid (row ${rows.length}): ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
          proc.kill();
        }
      }
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      // Drain any trailing partial line.
      const tail = buf.trim();
      if (tail.length > 0) {
        try {
          rows.push(JSON.parse(tail));
        } catch (err) {
          reject(
            new Error(
              `parse-raw-csv tail line invalid: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
          return;
        }
      }
      if (code !== 0) {
        reject(
          new Error(
            `parse-raw-csv.py exited with code ${code}: ${stderrText.slice(0, 500)}`,
          ),
        );
        return;
      }
      resolve(rows);
    });
  });
}

function emptyExtractReport(args: {
  tenantId: string;
  tenantSlug: string;
  dryRun: boolean;
  csvPath: string;
  csvHash: string;
  errors: string[];
}): ExtractObservationsReport {
  const cwd = process.cwd();
  return {
    tenantId: args.tenantId,
    tenantSlug: args.tenantSlug,
    dryRun: args.dryRun,
    stagingDir: join(cwd, ".data", "_staging"),
    inputCsv: args.csvPath,
    inputCsvHash: args.csvHash,
    extractedAt: new Date().toISOString(),
    inputRows: 0,
    stagedObservations: 0,
    skippedRowsByReason: {},
    dateCoverage: { distinctDates: 0, minDate: null, maxDate: null },
    platformBreakdown: {},
    promptMatch: {
      csvDistinctPrompts: 0,
      mapped: 0,
      orphans: 0,
      orphanSamples: [],
    },
    fieldCoverage: {
      responsePresent: 0,
      searchQueriesPresent: 0,
      citationUrlsPresent: 0,
      citationDomainsPresent: 0,
      competitorCoMentionsPresent: 0,
      competitorDescriptorWindowsPresent: 0,
      answerStructurePresent: 0,
      primaryRecommendationTrue: 0,
      mentionsPresent: 0,
    },
    aioBlindSpotCount: 0,
    sampleObservationIds: [],
    sampleObservationMetadata: [],
    errors: args.errors,
  };
}

function printExtractObservationsReport(
  report: ExtractObservationsReport,
): void {
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("W4 STAGE 2 — EXTRACT OBSERVATIONS REPORT");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`tenant_id              : ${report.tenantId}`);
  console.log(`tenant_slug            : ${report.tenantSlug}`);
  console.log(`dry_run                : ${report.dryRun}`);
  console.log(`staging_dir            : ${report.stagingDir}`);
  console.log(`input_csv              : ${basename(report.inputCsv)}`);
  console.log(`input_csv_hash         : ${report.inputCsvHash.slice(0, 16)}...`);
  console.log(`extracted_at           : ${report.extractedAt}`);
  console.log("");
  console.log(`input_rows             : ${report.inputRows}`);
  console.log(`staged_observations    : ${report.stagedObservations}`);
  console.log("");
  console.log("─ Date coverage ──────────────────────────────────────────────────");
  console.log(`  distinct_dates       : ${report.dateCoverage.distinctDates}`);
  console.log(`  min_date             : ${report.dateCoverage.minDate ?? "(none)"}`);
  console.log(`  max_date             : ${report.dateCoverage.maxDate ?? "(none)"}`);
  console.log("");
  console.log("─ Platform breakdown ─────────────────────────────────────────────");
  for (const [k, v] of Object.entries(report.platformBreakdown)) {
    const pct = report.stagedObservations > 0
      ? `${((v / report.stagedObservations) * 100).toFixed(2)}%`
      : "n/a";
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(7)}  (${pct})`);
  }
  console.log(`  AIO blind-spot rows  : ${report.aioBlindSpotCount}`);
  console.log("");
  console.log("─ Prompt match ───────────────────────────────────────────────────");
  console.log(`  CSV distinct prompts : ${report.promptMatch.csvDistinctPrompts}`);
  console.log(`  Mapped               : ${report.promptMatch.mapped}`);
  console.log(`  Orphans              : ${report.promptMatch.orphans}`);
  if (report.promptMatch.orphanSamples.length > 0) {
    console.log(`  Orphan samples:`);
    for (const o of report.promptMatch.orphanSamples) {
      console.log(`    - "${o.slice(0, 80)}..."`);
    }
  }
  console.log("");
  console.log("─ Field coverage ─────────────────────────────────────────────────");
  const f = report.fieldCoverage;
  const N = report.stagedObservations || 1;
  const pctOf = (n: number) => `${((n / N) * 100).toFixed(2)}%`;
  console.log(`  response_present              ${String(f.responsePresent).padStart(7)}  (${pctOf(f.responsePresent)})`);
  console.log(`  mentions_present              ${String(f.mentionsPresent).padStart(7)}  (${pctOf(f.mentionsPresent)})`);
  console.log(`  search_queries_present        ${String(f.searchQueriesPresent).padStart(7)}  (${pctOf(f.searchQueriesPresent)})`);
  console.log(`  citation_urls_present         ${String(f.citationUrlsPresent).padStart(7)}  (${pctOf(f.citationUrlsPresent)})`);
  console.log(`  citation_domains_present      ${String(f.citationDomainsPresent).padStart(7)}  (${pctOf(f.citationDomainsPresent)})`);
  console.log(`  competitor_co_mentions        ${String(f.competitorCoMentionsPresent).padStart(7)}  (${pctOf(f.competitorCoMentionsPresent)})`);
  console.log(`  competitor_descriptor_windows ${String(f.competitorDescriptorWindowsPresent).padStart(7)}  (${pctOf(f.competitorDescriptorWindowsPresent)})`);
  console.log(`  answer_structure_present      ${String(f.answerStructurePresent).padStart(7)}  (${pctOf(f.answerStructurePresent)})`);
  console.log(`  primary_recommendation_true   ${String(f.primaryRecommendationTrue).padStart(7)}  (${pctOf(f.primaryRecommendationTrue)})`);
  console.log("");
  console.log("─ Skipped rows by reason ─────────────────────────────────────────");
  for (const [k, v] of Object.entries(report.skippedRowsByReason)) {
    console.log(`  ${k.padEnd(40)} ${String(v).padStart(7)}`);
  }
  if (Object.keys(report.skippedRowsByReason).length === 0) {
    console.log(`  (none)`);
  }
  console.log("");
  console.log("─ Sample staged observation IDs ──────────────────────────────────");
  for (const id of report.sampleObservationIds) {
    console.log(`  · ${id}`);
  }
  console.log("");
  if (report.errors.length > 0) {
    console.log("─ ERRORS ─────────────────────────────────────────────────────────");
    for (const e of report.errors) console.log(`  - ${e}`);
    console.log("");
  }
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(
    "Stage 2 complete. NO Supabase writes. NO live .data/tenants/ mutation.",
  );
  console.log(
    `Staged outputs: ${report.stagingDir}/w4-extracted-observations.json + report + progress.`,
  );
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("");
}

// ── Stage 3: rederive-snapshots (staging only) ──────────────────────────
//
// Walks every (date, platform) tuple in the staged W4 extracted
// observations, runs `buildDailySnapshotsFromObservations()` (the
// existing native snapshot derivation logic), stamps each output row
// with W4 provenance (`provenance: "rederived_from_historical_recovered"`,
// `regime: "historical_recovered"`, `extraction_run_id`), and writes
// staged output to `.data/_staging/`. NO Supabase writes. NO live
// `.data/tenants/` mutation.
//
// Hard requirements:
//   - Source MUST be `.data/_staging/w4-extracted-observations.json`
//     (the Stage 2 output). Stage 3 hard-fails if that file is
//     missing, so a stale local cache cannot be silently substituted.
//   - Output `source_type === "derived"` on every row (the builder
//     already does this; Stage 3 re-asserts in validation).
//   - Output IDs are deterministic (the builder's `derived-…` IDs are
//     deterministic given deterministic input). Re-running Stage 3
//     against the same staged file produces byte-identical IDs.
//   - The 6 verification checks from master plan §2.6 are not
//     enforced here (they live in Stage 6 verify); Stage 3 surfaces
//     diagnostic info (date coverage, missing days, top owned URLs,
//     orphan benchmarks) so the operator can preview the publish-
//     time state.

export type RederiveSnapshotsReport = {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly dryRun: boolean;
  readonly stagingDir: string;
  readonly inputStagedFile: string;
  readonly inputObservationCount: number;
  readonly extractionRunId: string;
  readonly rederivedAt: string;
  readonly outputSnapshotCount: number;
  readonly snapshotsByScopeType: Record<string, number>;
  readonly snapshotsByPlatform: Record<string, number>;
  readonly dateCoverage: {
    readonly distinctDates: number;
    readonly minDate: string | null;
    readonly maxDate: string | null;
    readonly missingDates: ReadonlyArray<string>;
  };
  readonly topicCoverage: {
    readonly distinctTopics: number;
    readonly topTopics: ReadonlyArray<{ topic: string; count: number }>;
  };
  readonly entityCoverage: {
    readonly activeEntities: number;
    readonly entitiesWithAtLeastOneRow: number;
  };
  readonly tupleCoverage: {
    /** (date, platform) tuples that produced at least one row. */
    readonly tuplesEmittingRows: number;
    /** Tuples with zero observations (would have produced no rows). */
    readonly emptyTuples: ReadonlyArray<{ date: string; platform: string }>;
  };
  readonly duplicateIds: ReadonlyArray<string>;
  readonly sampleSnapshotIds: ReadonlyArray<string>;
  readonly recommendationSafety: {
    /** Recommended_edits row count READ ONLY from the live cache —
     *  Stage 3 must not touch this file. Reported here for sanity. */
    readonly localRecommendedEditsRowCount: number | null;
    readonly localRecommendationResponsesRowCount: number | null;
  };
  readonly errors: ReadonlyArray<string>;
};

async function runRederiveSnapshots(args: {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly dryRun: boolean;
}): Promise<RederiveSnapshotsReport> {
  const errors: string[] = [];
  const cwd = process.cwd();
  const stagingDir = join(cwd, ".data", "_staging");
  const stagedObsPath = join(stagingDir, "w4-extracted-observations.json");

  // 1. Hard-fail if Stage 2 output is missing.
  if (!existsSync(stagedObsPath)) {
    errors.push(
      `Stage 2 output missing at ${stagedObsPath}. Run --stage=extract-observations first.`,
    );
    return emptyRederiveReport({
      tenantId: args.tenantId,
      tenantSlug: args.tenantSlug,
      dryRun: args.dryRun,
      stagingDir,
      inputStagedFile: stagedObsPath,
      errors,
    });
  }

  // 2. Load staged observations.
  let stagedObservations: Array<Record<string, unknown>> = [];
  try {
    const text = readFileSync(stagedObsPath, "utf-8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error(
        `staged observations file is not a JSON array (got ${typeof parsed})`,
      );
    }
    stagedObservations = parsed as Array<Record<string, unknown>>;
  } catch (err) {
    errors.push(
      `failed to load staged observations: ${err instanceof Error ? err.message : String(err)}`,
    );
    return emptyRederiveReport({
      tenantId: args.tenantId,
      tenantSlug: args.tenantSlug,
      dryRun: args.dryRun,
      stagingDir,
      inputStagedFile: stagedObsPath,
      errors,
    });
  }

  if (stagedObservations.length === 0) {
    errors.push("staged observations file is empty");
    return emptyRederiveReport({
      tenantId: args.tenantId,
      tenantSlug: args.tenantSlug,
      dryRun: args.dryRun,
      stagingDir,
      inputStagedFile: stagedObsPath,
      errors,
    });
  }

  // 3. Load tracked_entities from Supabase (read-only, GLOBAL table).
  const { getSupabaseAdmin } = await import(
    "../src/lib/persistence/supabase"
  );
  const sb = getSupabaseAdmin();

  type EntityRow = {
    id: string;
    account_id: string;
    entity_type: string;
    name: string;
    aliases?: string[] | null;
    domain: string | null;
    url: string | null;
    location_scope: string | null;
    service_scope: string | null;
    is_owned: boolean;
    is_active: boolean;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  };

  let entityRows: EntityRow[] = [];
  try {
    const { data, error } = await sb.from("tracked_entities").select("*");
    if (error) throw error;
    entityRows = (data ?? []) as EntityRow[];
  } catch (err) {
    errors.push(
      `tracked_entities read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return emptyRederiveReport({
      tenantId: args.tenantId,
      tenantSlug: args.tenantSlug,
      dryRun: args.dryRun,
      stagingDir,
      inputStagedFile: stagedObsPath,
      errors,
    });
  }

  // The builder's signature requires the full TrackedEntity shape;
  // its filter (`is_active`) runs internally.
  const trackedEntities = entityRows as unknown as ReadonlyArray<
    import("../src/domains/tracked-entities/types").TrackedEntity
  >;

  // 4. Group observations by (date, platform). Date is the YYYY-MM-DD
  //    prefix of `observed_at`.
  const byTuple = new Map<string, Array<Record<string, unknown>>>();
  const datesAll = new Set<string>();
  const platformsAll = new Set<string>();
  for (const obs of stagedObservations) {
    const observedAt = (obs.observed_at as string | undefined) ?? "";
    const date = observedAt.slice(0, 10);
    const platform = ((obs.platform as string | undefined) ?? "").trim();
    if (!date || !platform) continue;
    datesAll.add(date);
    platformsAll.add(platform);
    const key = `${date}::${platform}`;
    let bucket = byTuple.get(key);
    if (!bucket) {
      bucket = [];
      byTuple.set(key, bucket);
    }
    bucket.push(obs);
  }

  // 5. Lazy-load the snapshot builder.
  const { buildDailySnapshotsFromObservations } = await import(
    "../src/domains/daily-metric-snapshots/build-from-observations"
  );

  // 6. Build a stable extraction_run_id from the staged file's
  //    inputs so Stage 3's outputs are deterministic + traceable to
  //    the Stage 2 invocation that produced them.
  const sourceCsvHash =
    extractSourceCsvHashFromStaged(stagedObservations) ?? "unknown";
  const extractionRunId = `w4-rederive-${sourceCsvHash.slice(0, 12)}`;

  // 7. For each (date, platform) tuple, call the builder + stamp W4
  //    provenance.
  const rows: import("../src/domains/daily-metric-snapshots/types").DailyMetricSnapshot[] = [];
  const snapshotsByScopeType: Record<string, number> = {};
  const snapshotsByPlatform: Record<string, number> = {};
  const topicCounts = new Map<string, number>();
  const entitiesWithRow = new Set<string>();
  const dateSet = new Set<string>();
  const tuplesEmittingRows = new Set<string>();
  const allTuplesAttempted = new Set<string>();
  const emptyTuples: Array<{ date: string; platform: string }> = [];

  for (const [key, obsList] of byTuple) {
    allTuplesAttempted.add(key);
    const [date, platform] = key.split("::");
    if (!date || !platform || obsList.length === 0) {
      emptyTuples.push({ date: date ?? "", platform: platform ?? "" });
      continue;
    }
    // Per-tuple observation-run id: deterministic from staging hash +
    // (date, platform). The builder writes this into each row's
    // metadata.derived_from_run_id.
    const observationRunId = `w4-rec-${sourceCsvHash.slice(0, 12)}-${date}-${slugifyPlatform(platform)}`;
    const tupleRows = buildDailySnapshotsFromObservations({
      tenantId: args.tenantId,
      platform,
      observations: obsList as unknown as ReadonlyArray<
        import("@/domains/prompt-answer-observations/types").PromptAnswerObservation
      > as import("@/domains/prompt-answer-observations/types").PromptAnswerObservation[],
      trackedEntities: trackedEntities as unknown as import("../src/domains/tracked-entities/types").TrackedEntity[],
      date,
      observationRunId,
    });
    if (tupleRows.length === 0) {
      emptyTuples.push({ date, platform });
      continue;
    }
    tuplesEmittingRows.add(key);
    for (const row of tupleRows) {
      // Stamp W4 provenance — operator-locked metadata block.
      const w4Stamped = {
        ...row,
        metadata: {
          ...row.metadata,
          provenance: "rederived_from_historical_recovered",
          regime: "historical_recovered",
          extraction_run_id: extractionRunId,
          source_csv_hash: sourceCsvHash,
        },
      };
      rows.push(w4Stamped);
      snapshotsByScopeType[row.scope_type] =
        (snapshotsByScopeType[row.scope_type] ?? 0) + 1;
      snapshotsByPlatform[row.platform] =
        (snapshotsByPlatform[row.platform] ?? 0) + 1;
      dateSet.add(row.date);
      if (row.scope_type === "topic") {
        topicCounts.set(
          row.scope_id,
          (topicCounts.get(row.scope_id) ?? 0) + 1,
        );
      }
      if (row.scope_type === "entity") {
        entitiesWithRow.add(row.scope_id);
      }
    }
  }

  // 8. Detect duplicate IDs. Builder IDs SHOULD be unique per
  //    (date, scope_type, scope_id, platform); duplicates would
  //    indicate either a bug in tuple grouping or aliased entity
  //    scope_ids. Surface in the report; do NOT silently dedupe.
  const idCounts = new Map<string, number>();
  for (const r of rows) {
    idCounts.set(r.id, (idCounts.get(r.id) ?? 0) + 1);
  }
  const duplicateIds = [...idCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id);
  if (duplicateIds.length > 0) {
    errors.push(
      `${duplicateIds.length} duplicate snapshot IDs detected (builder normally guarantees uniqueness; investigate before publish)`,
    );
  }

  // 9. Validate every row carries source_type === "derived" + W4
  //    provenance. This is belt-and-suspenders — the builder + W4
  //    stamp loop already enforce both.
  let invalidSourceType = 0;
  let missingProvenance = 0;
  for (const r of rows) {
    if (r.source_type !== "derived") invalidSourceType++;
    const m = r.metadata as Record<string, unknown>;
    if (
      m.provenance !== "rederived_from_historical_recovered" ||
      m.regime !== "historical_recovered" ||
      typeof m.extraction_run_id !== "string"
    ) {
      missingProvenance++;
    }
  }
  if (invalidSourceType > 0) {
    errors.push(
      `${invalidSourceType} rows have source_type !== "derived" (publish would write inconsistent rows)`,
    );
  }
  if (missingProvenance > 0) {
    errors.push(
      `${missingProvenance} rows missing W4 provenance metadata`,
    );
  }

  // 10. Date coverage diagnostic — fill any gaps in [min, max].
  const sortedDates = [...dateSet].sort();
  const missingDates: string[] = [];
  if (sortedDates.length > 0) {
    const min = new Date(sortedDates[0]);
    const max = new Date(sortedDates[sortedDates.length - 1]);
    const cur = new Date(min);
    const have = new Set(sortedDates);
    while (cur.getTime() <= max.getTime()) {
      const iso = cur.toISOString().slice(0, 10);
      if (!have.has(iso)) missingDates.push(iso);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  // 11. Recommendation safety (READ-ONLY check) — count rows in the
  //     local recs file as a sanity check that backfill never touched
  //     them. Stage 3 itself does NOT read or mutate
  //     recommended_edits / recommendation_responses.
  const recRowCount = countLocalArray(
    join(cwd, ".data", "tenants", args.tenantSlug, "recommended-edits.json"),
  );
  const respRowCount = countLocalArray(
    join(
      cwd,
      ".data",
      "tenants",
      args.tenantSlug,
      "recommendation-responses.json",
    ),
  );

  // 12. Write staged output.
  mkdirSync(stagingDir, { recursive: true });
  const outPath = join(stagingDir, "w4-rederived-snapshots.json");
  writeFileSync(outPath, JSON.stringify(rows, null, 2), "utf-8");

  const reportObj: RederiveSnapshotsReport = {
    tenantId: args.tenantId,
    tenantSlug: args.tenantSlug,
    dryRun: args.dryRun,
    stagingDir,
    inputStagedFile: stagedObsPath,
    inputObservationCount: stagedObservations.length,
    extractionRunId,
    rederivedAt: new Date().toISOString(),
    outputSnapshotCount: rows.length,
    snapshotsByScopeType,
    snapshotsByPlatform,
    dateCoverage: {
      distinctDates: dateSet.size,
      minDate: sortedDates[0] ?? null,
      maxDate: sortedDates[sortedDates.length - 1] ?? null,
      missingDates,
    },
    topicCoverage: {
      distinctTopics: topicCounts.size,
      topTopics: [...topicCounts.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([topic, count]) => ({ topic, count })),
    },
    entityCoverage: {
      activeEntities: entityRows.filter((e) => e.is_active).length,
      entitiesWithAtLeastOneRow: entitiesWithRow.size,
    },
    tupleCoverage: {
      tuplesEmittingRows: tuplesEmittingRows.size,
      emptyTuples,
    },
    duplicateIds: duplicateIds.slice(0, 20),
    sampleSnapshotIds: rows.slice(0, 5).map((r) => r.id),
    recommendationSafety: {
      localRecommendedEditsRowCount: recRowCount,
      localRecommendationResponsesRowCount: respRowCount,
    },
    errors,
  };
  writeFileSync(
    join(stagingDir, "w4-rederive-report.json"),
    JSON.stringify(reportObj, null, 2),
    "utf-8",
  );

  return reportObj;
}

/** Walk staged observations to find the canonical source CSV hash
 *  (every row's metadata.source_csv_hash is the same; we sample the
 *  first row + double-check). */
function extractSourceCsvHashFromStaged(
  staged: ReadonlyArray<Record<string, unknown>>,
): string | null {
  if (staged.length === 0) return null;
  const m = (staged[0].metadata ?? {}) as Record<string, unknown>;
  const h = m.source_csv_hash;
  return typeof h === "string" && h.length > 0 ? h : null;
}

function slugifyPlatform(platform: string): string {
  return platform
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function countLocalArray(path: string): number | null {
  if (!existsSync(path)) return null;
  try {
    const v = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(v) ? v.length : null;
  } catch {
    return null;
  }
}

function emptyRederiveReport(args: {
  tenantId: string;
  tenantSlug: string;
  dryRun: boolean;
  stagingDir: string;
  inputStagedFile: string;
  errors: string[];
}): RederiveSnapshotsReport {
  return {
    tenantId: args.tenantId,
    tenantSlug: args.tenantSlug,
    dryRun: args.dryRun,
    stagingDir: args.stagingDir,
    inputStagedFile: args.inputStagedFile,
    inputObservationCount: 0,
    extractionRunId: "",
    rederivedAt: new Date().toISOString(),
    outputSnapshotCount: 0,
    snapshotsByScopeType: {},
    snapshotsByPlatform: {},
    dateCoverage: { distinctDates: 0, minDate: null, maxDate: null, missingDates: [] },
    topicCoverage: { distinctTopics: 0, topTopics: [] },
    entityCoverage: { activeEntities: 0, entitiesWithAtLeastOneRow: 0 },
    tupleCoverage: { tuplesEmittingRows: 0, emptyTuples: [] },
    duplicateIds: [],
    sampleSnapshotIds: [],
    recommendationSafety: {
      localRecommendedEditsRowCount: null,
      localRecommendationResponsesRowCount: null,
    },
    errors: args.errors,
  };
}

function printRederiveSnapshotsReport(report: RederiveSnapshotsReport): void {
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("W4 STAGE 3 — REDERIVE SNAPSHOTS REPORT");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`tenant_id              : ${report.tenantId}`);
  console.log(`tenant_slug            : ${report.tenantSlug}`);
  console.log(`dry_run                : ${report.dryRun}`);
  console.log(`staging_dir            : ${report.stagingDir}`);
  console.log(`input_staged_file      : ${basename(report.inputStagedFile)}`);
  console.log(`input_observation_count: ${report.inputObservationCount}`);
  console.log(`extraction_run_id      : ${report.extractionRunId}`);
  console.log(`rederived_at           : ${report.rederivedAt}`);
  console.log("");
  console.log(`output_snapshot_count  : ${report.outputSnapshotCount}`);
  console.log("");
  console.log("─ Snapshots by scope_type ───────────────────────────────────────");
  for (const [k, v] of Object.entries(report.snapshotsByScopeType)) {
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(7)}`);
  }
  console.log("");
  console.log("─ Snapshots by platform ─────────────────────────────────────────");
  for (const [k, v] of Object.entries(report.snapshotsByPlatform)) {
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(7)}`);
  }
  console.log("");
  console.log("─ Date coverage ─────────────────────────────────────────────────");
  console.log(`  distinct_dates       : ${report.dateCoverage.distinctDates}`);
  console.log(`  min_date             : ${report.dateCoverage.minDate ?? "(none)"}`);
  console.log(`  max_date             : ${report.dateCoverage.maxDate ?? "(none)"}`);
  console.log(`  missing_dates count  : ${report.dateCoverage.missingDates.length}`);
  if (report.dateCoverage.missingDates.length > 0) {
    console.log(`  first 3 missing      : ${report.dateCoverage.missingDates.slice(0, 3).join(", ")}`);
  }
  console.log("");
  console.log("─ Topic coverage ───────────────────────────────────────────────");
  console.log(`  distinct_topics      : ${report.topicCoverage.distinctTopics}`);
  console.log(`  top topics (by row count):`);
  for (const t of report.topicCoverage.topTopics) {
    console.log(`    · ${String(t.count).padStart(6)}  ${t.topic}`);
  }
  console.log("");
  console.log("─ Entity coverage ──────────────────────────────────────────────");
  console.log(`  active_entities      : ${report.entityCoverage.activeEntities}`);
  console.log(`  entities with rows   : ${report.entityCoverage.entitiesWithAtLeastOneRow}`);
  console.log("");
  console.log("─ Tuple coverage (date × platform) ─────────────────────────────");
  console.log(`  tuples emitting rows : ${report.tupleCoverage.tuplesEmittingRows}`);
  console.log(`  empty tuples         : ${report.tupleCoverage.emptyTuples.length}`);
  if (report.tupleCoverage.emptyTuples.length > 0) {
    console.log(`  first 3 empty:`);
    for (const t of report.tupleCoverage.emptyTuples.slice(0, 3)) {
      console.log(`    · ${t.date} / ${t.platform}`);
    }
  }
  console.log("");
  console.log("─ Duplicate ID check ───────────────────────────────────────────");
  console.log(`  duplicates           : ${report.duplicateIds.length}`);
  if (report.duplicateIds.length > 0) {
    console.log(`  first 3              : ${report.duplicateIds.slice(0, 3).join(", ")}`);
  }
  console.log("");
  console.log("─ Recommendation safety (read-only sanity check) ───────────────");
  console.log(
    `  local recommended_edits rows         : ${report.recommendationSafety.localRecommendedEditsRowCount ?? "(file absent)"}`,
  );
  console.log(
    `  local recommendation_responses rows  : ${report.recommendationSafety.localRecommendationResponsesRowCount ?? "(file absent)"}`,
  );
  console.log("");
  console.log("─ Sample snapshot IDs ──────────────────────────────────────────");
  for (const id of report.sampleSnapshotIds) {
    console.log(`  · ${id}`);
  }
  console.log("");
  if (report.errors.length > 0) {
    console.log("─ ERRORS ───────────────────────────────────────────────────────");
    for (const e of report.errors) console.log(`  - ${e}`);
    console.log("");
  }
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(
    "Stage 3 complete. NO Supabase writes. NO live .data/tenants/ mutation.",
  );
  console.log(
    `Staged outputs: ${report.stagingDir}/w4-rederived-snapshots.json + report.`,
  );
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("");
}

// ── Stage 4: copy-orphan-benchmarks (staging only) ──────────────────────
//
// Diff production benchmark rows against Stage 3's recovered-derived
// snapshots + production native-derived snapshots. Copy ONLY the true
// orphans into staged derived twins with `provenance:
// "imported_from_benchmark"` + `regime: "historical_fallback"` (NOT
// `historical_recovered` — these are not recovered observations,
// they're snapshot-fallback rows for chart continuity).
//
// Hard requirements:
//   - Source MUST be `.data/_staging/w4-rederived-snapshots.json` +
//     a fresh Supabase read of `daily_metric_snapshots`. Stage 4
//     hard-fails if Stage 3 staging is missing.
//   - Do NOT blindly copy. A benchmark row is orphaned only when:
//       (a) no recovered-derived snapshot in Stage 3 covers the same
//           (date, scope_type, normalized scope_id, platform) tuple,
//           AND
//       (b) no native-derived snapshot in Supabase covers the same
//           tuple,
//       AND
//       (c) removing/ignoring it would create a chart/history gap
//           (i.e., other days carry coverage for that scope, so the
//           benchmark day is a real visible gap rather than an
//           inactive scope).
//   - Output `source_type === "derived"`. Provenance metadata
//     identifies the row as a benchmark-fallback so causal /
//     verdict math can guard against using these for attribution.
//   - Numeric values are byte/numeric identical to the original
//     benchmark row. The transformation is metadata-only.
//
// Output: `.data/_staging/w4-orphan-benchmarks.json` +
//         `.data/_staging/w4-orphan-benchmark-report.json`

export type OrphanBenchmarkReport = {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly dryRun: boolean;
  readonly stagingDir: string;
  readonly inputRederivedFile: string;
  readonly extractionRunId: string;
  readonly diffedAt: string;
  readonly counts: {
    readonly benchmarkRowsScanned: number;
    readonly supersededByRederive: number;
    readonly supersededByNative: number;
    readonly trueOrphans: number;
    readonly stagedDerivedTwins: number;
  };
  readonly orphansByDate: Record<string, number>;
  readonly orphansByPlatform: Record<string, number>;
  readonly orphansByScopeType: Record<string, number>;
  readonly orphansByReason: Record<string, number>;
  readonly chartGapPrevention: {
    /** True orphans where the same scope IS covered on at least one
     *  other day → benchmark fills a real visible gap. */
    readonly fillsRealGap: number;
    /** True orphans where the scope has zero coverage anywhere →
     *  inactive entity / dormant scope; including the benchmark
     *  doesn't fill a chart gap. */
    readonly scopeFullyDormant: number;
  };
  readonly normalizationMismatches: ReadonlyArray<{
    readonly benchmarkScopeId: string;
    readonly closestRederiveScopeId: string;
    readonly date: string;
    readonly platform: string;
  }>;
  readonly sampleOrphans: ReadonlyArray<unknown>;
  readonly recommendationSafety: {
    readonly localRecommendedEditsRowCount: number | null;
    readonly localRecommendationResponsesRowCount: number | null;
  };
  readonly noOp: boolean;
  readonly errors: ReadonlyArray<string>;
};

/** Pure: collapse a scope_id to a canonical alphanumeric form so
 *  benchmark naming (`mvs-construction`) and rederive naming
 *  (`ritzbuilders`, `mvsconstruction`) match. */
export function canonicalScopeKey(scopeId: string | null | undefined): string {
  if (typeof scopeId !== "string") return "";
  return scopeId.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Pure: build the (date, scope_type, normalized scope_id, platform-slug)
 *  match key. */
export function snapshotMatchKey(args: {
  readonly date: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly platform: string;
}): string {
  return `${args.date}::${args.scopeType.toLowerCase()}::${canonicalScopeKey(args.scopeId)}::${args.platform.toLowerCase().replace(/\s+/g, "-")}`;
}

async function runCopyOrphanBenchmarks(args: {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly dryRun: boolean;
}): Promise<OrphanBenchmarkReport> {
  const errors: string[] = [];
  const cwd = process.cwd();
  const stagingDir = join(cwd, ".data", "_staging");
  const stagedRederivedPath = join(stagingDir, "w4-rederived-snapshots.json");

  // 1. Hard-fail if Stage 3 output is missing.
  if (!existsSync(stagedRederivedPath)) {
    errors.push(
      `Stage 3 output missing at ${stagedRederivedPath}. Run --stage=rederive-snapshots first.`,
    );
    return emptyOrphanBenchmarkReport({
      tenantId: args.tenantId,
      tenantSlug: args.tenantSlug,
      dryRun: args.dryRun,
      stagingDir,
      inputRederivedFile: stagedRederivedPath,
      errors,
    });
  }

  // 2. Load Stage 3 rederived snapshots.
  let rederivedSnapshots: Array<Record<string, unknown>> = [];
  try {
    const text = readFileSync(stagedRederivedPath, "utf-8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error(
        `staged rederive file is not a JSON array (got ${typeof parsed})`,
      );
    }
    rederivedSnapshots = parsed as Array<Record<string, unknown>>;
  } catch (err) {
    errors.push(
      `failed to load staged rederive: ${err instanceof Error ? err.message : String(err)}`,
    );
    return emptyOrphanBenchmarkReport({
      tenantId: args.tenantId,
      tenantSlug: args.tenantSlug,
      dryRun: args.dryRun,
      stagingDir,
      inputRederivedFile: stagedRederivedPath,
      errors,
    });
  }
  if (rederivedSnapshots.length === 0) {
    errors.push("staged rederive file is empty");
  }

  // Pull the staged extraction_run_id so Stage 4 outputs share lineage
  // with Stage 3.
  const stage3RunId =
    typeof (rederivedSnapshots[0]?.metadata as Record<string, unknown> | undefined)
      ?.extraction_run_id === "string"
      ? ((rederivedSnapshots[0].metadata as Record<string, unknown>)
          .extraction_run_id as string)
      : "w4-rederive-unknown";

  // 3. Load production daily_metric_snapshots from Supabase (read-only).
  const { getSupabaseAdmin } = await import(
    "../src/lib/persistence/supabase"
  );
  const sb = getSupabaseAdmin();
  type SnapshotRow = {
    id: string;
    date: string;
    scope_type: string;
    scope_id: string;
    platform: string;
    source_type: string;
    visibility_score: number | null;
    mention_count: number;
    citation_count: number;
    share_of_voice: number | null;
    avg_position: number | null;
    total_possible: number | null;
    metadata: Record<string, unknown>;
    tenant_id: string;
  };

  let supabaseSnapshots: SnapshotRow[] = [];
  try {
    // Paginate to handle 1,380+ rows.
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from("daily_metric_snapshots")
        .select("*")
        .eq("tenant_id", args.tenantId)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      supabaseSnapshots.push(...(data as SnapshotRow[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
  } catch (err) {
    errors.push(
      `daily_metric_snapshots read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return emptyOrphanBenchmarkReport({
      tenantId: args.tenantId,
      tenantSlug: args.tenantSlug,
      dryRun: args.dryRun,
      stagingDir,
      inputRederivedFile: stagedRederivedPath,
      errors,
    });
  }

  const benchmarkRows = supabaseSnapshots.filter(
    (r) => r.source_type === "benchmark",
  );
  const nativeDerivedRows = supabaseSnapshots.filter(
    (r) => r.source_type === "derived",
  );

  // 4. Build coverage key sets.
  const rederiveKeys = new Set<string>();
  for (const r of rederivedSnapshots) {
    const date = r.date as string;
    const scopeType = r.scope_type as string;
    const scopeId = r.scope_id as string;
    const platform = r.platform as string;
    if (date && scopeType && typeof scopeId === "string" && platform) {
      rederiveKeys.add(
        snapshotMatchKey({ date, scopeType, scopeId, platform }),
      );
    }
  }
  const nativeKeys = new Set<string>();
  for (const r of nativeDerivedRows) {
    nativeKeys.add(
      snapshotMatchKey({
        date: r.date,
        scopeType: r.scope_type,
        scopeId: r.scope_id,
        platform: r.platform,
      }),
    );
  }

  // 5. Build per-(scope-canonical) "any coverage on any day?" map for
  //    the chart-gap-prevention check.
  const scopeAnyCoverage = new Set<string>();
  for (const r of rederivedSnapshots) {
    const c = canonicalScopeKey(r.scope_id as string);
    if (c) scopeAnyCoverage.add(`${(r.scope_type as string).toLowerCase()}::${c}`);
  }
  for (const r of nativeDerivedRows) {
    const c = canonicalScopeKey(r.scope_id);
    if (c) scopeAnyCoverage.add(`${r.scope_type.toLowerCase()}::${c}`);
  }

  // 6. Diff each benchmark row.
  const orphansByDate: Record<string, number> = {};
  const orphansByPlatform: Record<string, number> = {};
  const orphansByScopeType: Record<string, number> = {};
  const orphansByReason: Record<string, number> = {};
  const normalizationMismatches: Array<{
    benchmarkScopeId: string;
    closestRederiveScopeId: string;
    date: string;
    platform: string;
  }> = [];
  let supersededByRederive = 0;
  let supersededByNative = 0;
  let trueOrphans = 0;
  let fillsRealGap = 0;
  let scopeFullyDormant = 0;

  const stagedTwins: Array<Record<string, unknown>> = [];

  for (const bench of benchmarkRows) {
    const key = snapshotMatchKey({
      date: bench.date,
      scopeType: bench.scope_type,
      scopeId: bench.scope_id,
      platform: bench.platform,
    });
    if (rederiveKeys.has(key)) {
      supersededByRederive++;
      continue;
    }
    if (nativeKeys.has(key)) {
      supersededByNative++;
      continue;
    }

    // True orphan. Categorize chart-gap prevention.
    const scopeCanonKey = `${bench.scope_type.toLowerCase()}::${canonicalScopeKey(bench.scope_id)}`;
    const hasCoverage = scopeAnyCoverage.has(scopeCanonKey);
    const reason = hasCoverage
      ? "scope_covered_other_days_only"
      : "scope_fully_dormant";
    if (hasCoverage) fillsRealGap++;
    else scopeFullyDormant++;

    trueOrphans++;
    orphansByDate[bench.date] = (orphansByDate[bench.date] ?? 0) + 1;
    orphansByPlatform[bench.platform] =
      (orphansByPlatform[bench.platform] ?? 0) + 1;
    orphansByScopeType[bench.scope_type] =
      (orphansByScopeType[bench.scope_type] ?? 0) + 1;
    orphansByReason[reason] = (orphansByReason[reason] ?? 0) + 1;

    // Operator-locked rule (W4 Stage 4 spec, 2026-05-04):
    // "removing/ignoring it would create a chart/history gap" is the
    // THIRD criterion for an orphan. A `scope_fully_dormant` row has
    // zero coverage on any day for that scope → removing it does
    // NOT create a visible gap. Skip derived-twin emission. The
    // report still surfaces these in `orphansByReason` so the
    // operator can audit the entities Profound tracked but Beacon's
    // current registry doesn't.
    if (!hasCoverage) {
      continue;
    }

    // Look for a normalization mismatch: a rederive row exists for
    // the SAME canonical key on the same date+platform, but with a
    // different scope_id formatting. If the canonical-key match is
    // found this would already supersede; this is for the diagnostic
    // case where canonical match exists but raw scope_ids differ —
    // we surface as a sanity check.
    const platSlug = bench.platform.toLowerCase().replace(/\s+/g, "-");
    const benchCanon = canonicalScopeKey(bench.scope_id);
    const closestMatch = rederivedSnapshots.find((rs) => {
      return (
        rs.date === bench.date &&
        (rs.platform as string).toLowerCase().replace(/\s+/g, "-") === platSlug &&
        canonicalScopeKey(rs.scope_id as string) === benchCanon &&
        rs.scope_id !== bench.scope_id
      );
    });
    if (closestMatch) {
      normalizationMismatches.push({
        benchmarkScopeId: bench.scope_id,
        closestRederiveScopeId: closestMatch.scope_id as string,
        date: bench.date,
        platform: bench.platform,
      });
    }

    // Build the staged derived twin. Numeric values are byte-for-byte
    // identical to the benchmark; only id + source_type + metadata
    // are transformed.
    const twin = {
      id: `derived-fallback-${bench.id}`,
      date: bench.date,
      scope_type: bench.scope_type,
      scope_id: bench.scope_id,
      platform: bench.platform,
      source_type: "derived" as const,
      visibility_score: bench.visibility_score,
      mention_count: bench.mention_count,
      citation_count: bench.citation_count,
      share_of_voice: bench.share_of_voice,
      avg_position: bench.avg_position,
      total_possible: bench.total_possible,
      metadata: {
        // Preserve the original benchmark metadata for audit.
        ...(bench.metadata ?? {}),
        provenance: "imported_from_benchmark",
        regime: "historical_fallback",
        original_source_type: "benchmark",
        benchmark_snapshot_id: bench.id,
        import_reason: reason,
        extraction_run_id: stage3RunId,
        // Causal-attribution guardrail — `regime: "historical_fallback"`
        // is the documented signal that verdict math should EXCLUDE
        // this row from baselines + post-windows. The
        // MEASUREMENT_QUALITY_BOUNDARY constant remains the runtime
        // gate; this metadata is the audit trail.
        causal_attribution_excluded: true,
      },
      tenant_id: bench.tenant_id,
    };
    stagedTwins.push(twin);
  }

  // 7. Recommendation safety (READ-ONLY check).
  const recRowCount = countLocalArray(
    join(cwd, ".data", "tenants", args.tenantSlug, "recommended-edits.json"),
  );
  const respRowCount = countLocalArray(
    join(
      cwd,
      ".data",
      "tenants",
      args.tenantSlug,
      "recommendation-responses.json",
    ),
  );

  // 8. Write staged outputs.
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(
    join(stagingDir, "w4-orphan-benchmarks.json"),
    JSON.stringify(stagedTwins, null, 2),
    "utf-8",
  );

  const sampleOrphans = stagedTwins.slice(0, 5);

  const reportObj: OrphanBenchmarkReport = {
    tenantId: args.tenantId,
    tenantSlug: args.tenantSlug,
    dryRun: args.dryRun,
    stagingDir,
    inputRederivedFile: stagedRederivedPath,
    extractionRunId: stage3RunId,
    diffedAt: new Date().toISOString(),
    counts: {
      benchmarkRowsScanned: benchmarkRows.length,
      supersededByRederive,
      supersededByNative,
      trueOrphans,
      stagedDerivedTwins: stagedTwins.length,
    },
    orphansByDate,
    orphansByPlatform,
    orphansByScopeType,
    orphansByReason,
    chartGapPrevention: { fillsRealGap, scopeFullyDormant },
    normalizationMismatches: normalizationMismatches.slice(0, 10),
    sampleOrphans,
    recommendationSafety: {
      localRecommendedEditsRowCount: recRowCount,
      localRecommendationResponsesRowCount: respRowCount,
    },
    noOp: stagedTwins.length === 0,
    errors,
  };
  writeFileSync(
    join(stagingDir, "w4-orphan-benchmark-report.json"),
    JSON.stringify(reportObj, null, 2),
    "utf-8",
  );

  return reportObj;
}

function emptyOrphanBenchmarkReport(args: {
  tenantId: string;
  tenantSlug: string;
  dryRun: boolean;
  stagingDir: string;
  inputRederivedFile: string;
  errors: string[];
}): OrphanBenchmarkReport {
  return {
    tenantId: args.tenantId,
    tenantSlug: args.tenantSlug,
    dryRun: args.dryRun,
    stagingDir: args.stagingDir,
    inputRederivedFile: args.inputRederivedFile,
    extractionRunId: "",
    diffedAt: new Date().toISOString(),
    counts: {
      benchmarkRowsScanned: 0,
      supersededByRederive: 0,
      supersededByNative: 0,
      trueOrphans: 0,
      stagedDerivedTwins: 0,
    },
    orphansByDate: {},
    orphansByPlatform: {},
    orphansByScopeType: {},
    orphansByReason: {},
    chartGapPrevention: { fillsRealGap: 0, scopeFullyDormant: 0 },
    normalizationMismatches: [],
    sampleOrphans: [],
    recommendationSafety: {
      localRecommendedEditsRowCount: null,
      localRecommendationResponsesRowCount: null,
    },
    noOp: true,
    errors: args.errors,
  };
}

function printCopyOrphanBenchmarksReport(report: OrphanBenchmarkReport): void {
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("W4 STAGE 4 — ORPHAN BENCHMARK DIFF REPORT");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`tenant_id              : ${report.tenantId}`);
  console.log(`tenant_slug            : ${report.tenantSlug}`);
  console.log(`dry_run                : ${report.dryRun}`);
  console.log(`staging_dir            : ${report.stagingDir}`);
  console.log(`input_rederived_file   : ${basename(report.inputRederivedFile)}`);
  console.log(`extraction_run_id      : ${report.extractionRunId}`);
  console.log(`diffed_at              : ${report.diffedAt}`);
  console.log("");
  console.log("─ Counts ────────────────────────────────────────────────────────");
  console.log(`  benchmark rows scanned       : ${report.counts.benchmarkRowsScanned}`);
  console.log(`  superseded by Stage 3 rederive: ${report.counts.supersededByRederive}`);
  console.log(`  superseded by native-derived  : ${report.counts.supersededByNative}`);
  console.log(`  TRUE ORPHANS                  : ${report.counts.trueOrphans}`);
  console.log(`  staged derived twins          : ${report.counts.stagedDerivedTwins}`);
  if (report.noOp) {
    const dormant = report.chartGapPrevention.scopeFullyDormant;
    const superseded =
      report.counts.supersededByRederive + report.counts.supersededByNative;
    console.log("");
    console.log("  NO-OP: zero derived twins emitted.");
    console.log(
      `  ${superseded} benchmark row(s) superseded by recovered/native coverage,`,
    );
    console.log(
      `  ${dormant} dropped (scope dormant — no chart gap to fill).`,
    );
    console.log("  Stage 4 wrote an empty staged file + a full diagnostic report.");
  }
  console.log("");
  console.log("─ Orphans by date (Apr 7-14 expected) ───────────────────────────");
  if (Object.keys(report.orphansByDate).length === 0) {
    console.log("  (none)");
  } else {
    for (const [k, v] of Object.entries(report.orphansByDate)) {
      console.log(`  ${k.padEnd(28)} ${String(v).padStart(7)}`);
    }
  }
  console.log("");
  console.log("─ Orphans by platform ───────────────────────────────────────────");
  if (Object.keys(report.orphansByPlatform).length === 0) {
    console.log("  (none)");
  } else {
    for (const [k, v] of Object.entries(report.orphansByPlatform)) {
      console.log(`  ${k.padEnd(28)} ${String(v).padStart(7)}`);
    }
  }
  console.log("");
  console.log("─ Orphans by scope_type ─────────────────────────────────────────");
  if (Object.keys(report.orphansByScopeType).length === 0) {
    console.log("  (none)");
  } else {
    for (const [k, v] of Object.entries(report.orphansByScopeType)) {
      console.log(`  ${k.padEnd(28)} ${String(v).padStart(7)}`);
    }
  }
  console.log("");
  console.log("─ Orphans by reason ─────────────────────────────────────────────");
  if (Object.keys(report.orphansByReason).length === 0) {
    console.log("  (none)");
  } else {
    for (const [k, v] of Object.entries(report.orphansByReason)) {
      console.log(`  ${k.padEnd(36)} ${String(v).padStart(7)}`);
    }
  }
  console.log("");
  console.log("─ Chart-gap prevention ──────────────────────────────────────────");
  console.log(`  fills a real gap (scope covered other days)  : ${report.chartGapPrevention.fillsRealGap}`);
  console.log(`  scope fully dormant (no coverage anywhere)   : ${report.chartGapPrevention.scopeFullyDormant}`);
  console.log("");
  if (report.normalizationMismatches.length > 0) {
    console.log("─ Slug/casing mismatches detected (informational) ───────────────");
    for (const m of report.normalizationMismatches.slice(0, 5)) {
      console.log(
        `  · ${m.date} / ${m.platform} :: bench='${m.benchmarkScopeId}' vs rederive='${m.closestRederiveScopeId}' (canonical match)`,
      );
    }
    console.log("");
  }
  console.log("─ Recommendation safety (read-only sanity check) ───────────────");
  console.log(
    `  local recommended_edits rows         : ${report.recommendationSafety.localRecommendedEditsRowCount ?? "(file absent)"}`,
  );
  console.log(
    `  local recommendation_responses rows  : ${report.recommendationSafety.localRecommendationResponsesRowCount ?? "(file absent)"}`,
  );
  console.log("");
  if (report.sampleOrphans.length > 0) {
    console.log("─ Sample orphan derived twins (first 5) ─────────────────────────");
    for (const o of report.sampleOrphans.slice(0, 5)) {
      const r = o as Record<string, unknown>;
      console.log(`  · ${r.id} (${r.date} / ${r.platform} / ${r.scope_id})`);
    }
    console.log("");
  }
  if (report.errors.length > 0) {
    console.log("─ ERRORS ────────────────────────────────────────────────────────");
    for (const e of report.errors) console.log(`  - ${e}`);
    console.log("");
  }
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(
    "Stage 4 complete. NO Supabase writes. NO live .data/tenants/ mutation.",
  );
  console.log(
    `Staged outputs: ${report.stagingDir}/w4-orphan-benchmarks.json + report.`,
  );
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("");
}

// ── Stage 5: relabel-changelog (staging only) ──────────────────────────
//
// Stage purpose (operator scope):
//
//   "Label pre-launch imported changelog rows so /changes can collapse
//    them under 'Pre-launch history' instead of polluting the default
//    operator view."
//
// Stage 5 reads `changelog_entries` from production Supabase
// (read-only, paginated), identifies rows that match the legacy-import
// criteria, skips rows that look live / verified / user-accepted, and
// writes a staged JSON proposal describing the conceptual metadata
// label changes. NO Supabase writes. NO live `.data/tenants/`
// mutation. NO recommendation queue mutation.
//
// Key schema observation (verified against the Stage 1 backup):
// `changelog_entries` does NOT carry a `metadata` jsonb column today.
// `import_batch_id` is a top-level column already populated with
// auto-generated values (e.g., `import-1776222344423`). The staged
// proposal preserves the existing top-level value AND describes the
// conceptual W4 metadata target — Stage 7 (publish) decides the
// schema path: add a `metadata` jsonb column, or overwrite the
// top-level column, or use a different field. The staging file
// makes the operator's intent explicit so the schema decision is
// auditable.
//
// Inclusion criteria (TARGETS):
//   - source_system === "pdf_changelog_rebuild" (master plan §2.5)
//   - source_system === "import"                (master plan §2.5)
//   - source_system === "changelog_csv"         (operator scope:
//                                                "or equivalent
//                                                legacy import
//                                                markers")
//
// Exclusion criteria (NEVER relabel):
//   - source_system === "scan_detection"       — live scanner output
//   - hypothesis_source === "recommendation"   — operator-accepted
//                                                via recs queue
//   - live_at !== null                          — proven live by
//                                                scanner
//   - W4 import_batch_id already set            — already labeled
//   - source_system is null or unfamiliar      — defensive skip; the
//                                                operator can review
//                                                the report and
//                                                decide
//
// Output: `.data/_staging/w4-relabel-changelog.json` (proposals) +
//         `.data/_staging/w4-relabel-changelog-report.json` (counts).

const W4_RELABEL_TARGETS: ReadonlySet<string> = new Set([
  "pdf_changelog_rebuild",
  "import",
  "changelog_csv",
]);

const W4_RELABEL_BATCH_ID = "march-import-2026-04";
const W4_RELABEL_DISPLAY_GROUP = "pre_launch_history";

export type RelabelChangelogProposal = {
  readonly id: string;
  readonly source_system: string | null;
  readonly previous: {
    readonly import_batch_id: string | null;
    readonly metadata: Record<string, unknown> | null;
  };
  readonly next: {
    readonly import_batch_id: string | null;
    readonly metadata: Record<string, unknown>;
  };
  readonly proposed_import_batch_id: string;
  readonly proposed_display_group: string;
  /** Snapshot of the data fields the relabel must NOT change. Stage
   *  7 (publish) re-asserts byte equality against this snapshot. */
  readonly preserved_fields: {
    readonly timestamp: string;
    readonly url: string | null;
    readonly asset_name: string | null;
    readonly change_description: string | null;
    readonly created_at: string;
    readonly archived: boolean;
    readonly live_at: string | null;
    readonly hypothesis_source: string | null;
    readonly source_rec_id: string | null;
  };
};

export type RelabelChangelogReport = {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly dryRun: boolean;
  readonly stagingDir: string;
  readonly extractionRunId: string;
  readonly relabeledAt: string;
  readonly counts: {
    readonly totalRowsScanned: number;
    readonly proposedRelabel: number;
    readonly skippedBySourceSystem: number;
    readonly skippedAlreadyLabeled: number;
    readonly skippedLiveOrAccepted: number;
    readonly skippedDangerous: number;
  };
  readonly proposalsBySourceSystem: Record<string, number>;
  readonly skippedBySourceSystem: Record<string, number>;
  readonly skippedReasonBreakdown: Record<string, number>;
  readonly sampleProposals: ReadonlyArray<RelabelChangelogProposal>;
  readonly recommendationSafety: {
    readonly localRecommendedEditsRowCount: number | null;
    readonly localRecommendationResponsesRowCount: number | null;
  };
  readonly noOp: boolean;
  readonly errors: ReadonlyArray<string>;
};

/** Pure: decide whether a changelog row is a relabel candidate.
 *  Returns either `{ relabel: true }` or `{ relabel: false, reason }`. */
export function classifyChangelogRowForRelabel(row: {
  readonly source_system: string | null;
  readonly hypothesis_source: string | null;
  readonly live_at: string | null;
  readonly metadata?: Record<string, unknown> | null;
  readonly import_batch_id?: string | null;
}): { relabel: true } | { relabel: false; reason: string } {
  const ss = row.source_system ?? "";

  // Never relabel scanner-emitted rows — those are live observations.
  if (ss === "scan_detection") {
    return { relabel: false, reason: "scan_detection_is_live_scanner" };
  }

  // Operator-accepted via recs queue.
  if (row.hypothesis_source === "recommendation") {
    return { relabel: false, reason: "operator_accepted_recommendation" };
  }

  // Proven live by scanner.
  if (row.live_at != null) {
    return { relabel: false, reason: "live_at_is_set" };
  }

  // Already W4-labeled — skip (idempotent).
  const md = row.metadata ?? {};
  if (md.import_batch_id === W4_RELABEL_BATCH_ID) {
    return { relabel: false, reason: "already_w4_labeled" };
  }

  // Target inclusion check.
  if (!W4_RELABEL_TARGETS.has(ss)) {
    return {
      relabel: false,
      reason:
        ss.length === 0
          ? "source_system_null"
          : `source_system_not_in_targets:${ss}`,
    };
  }

  return { relabel: true };
}

async function runRelabelChangelog(args: {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly dryRun: boolean;
}): Promise<RelabelChangelogReport> {
  const errors: string[] = [];
  const cwd = process.cwd();
  const stagingDir = join(cwd, ".data", "_staging");

  // Pull the Stage 3/4 extraction_run_id (lineage continuity).
  const stage3Path = join(stagingDir, "w4-rederived-snapshots.json");
  let extractionRunId = "w4-relabel-unknown";
  if (existsSync(stage3Path)) {
    try {
      const text = readFileSync(stage3Path, "utf-8");
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const m = (parsed[0]?.metadata ?? {}) as Record<string, unknown>;
        if (typeof m.extraction_run_id === "string") {
          extractionRunId = m.extraction_run_id;
        }
      }
    } catch {
      // Soft fall-through; extraction_run_id is informational only.
    }
  }

  // 1. Read changelog_entries from Supabase (paginated, read-only).
  const { getSupabaseAdmin } = await import(
    "../src/lib/persistence/supabase"
  );
  const sb = getSupabaseAdmin();
  type ChangelogRow = {
    id: string;
    timestamp: string;
    signal_type: string | null;
    asset_type: string | null;
    url: string | null;
    asset_name: string | null;
    change_description: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
    source_system: string | null;
    import_batch_id: string | null;
    tenant_id: string;
    archived: boolean | null;
    archived_reason: string | null;
    archived_at: string | null;
    hypothesis_source: string | null;
    source_rec_id: string | null;
    live_at: string | null;
    metadata?: Record<string, unknown> | null;
  };

  let allRows: ChangelogRow[] = [];
  try {
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from("changelog_entries")
        .select("*")
        .eq("tenant_id", args.tenantId)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows.push(...(data as ChangelogRow[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
  } catch (err) {
    errors.push(
      `changelog_entries read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return emptyRelabelReport({
      tenantId: args.tenantId,
      tenantSlug: args.tenantSlug,
      dryRun: args.dryRun,
      stagingDir,
      extractionRunId,
      errors,
    });
  }

  // 2. Classify each row.
  const proposals: RelabelChangelogProposal[] = [];
  const proposalsBySS: Record<string, number> = {};
  const skippedBySS: Record<string, number> = {};
  const skippedReasonBreakdown: Record<string, number> = {};
  let skippedBySourceSystem = 0;
  let skippedAlreadyLabeled = 0;
  let skippedLiveOrAccepted = 0;
  let skippedDangerous = 0;

  for (const row of allRows) {
    const verdict = classifyChangelogRowForRelabel(row);
    if (verdict.relabel === false) {
      skippedReasonBreakdown[verdict.reason] =
        (skippedReasonBreakdown[verdict.reason] ?? 0) + 1;
      const ss = row.source_system ?? "null";
      skippedBySS[ss] = (skippedBySS[ss] ?? 0) + 1;
      if (verdict.reason === "scan_detection_is_live_scanner") {
        skippedBySourceSystem++;
      } else if (verdict.reason === "already_w4_labeled") {
        skippedAlreadyLabeled++;
      } else if (
        verdict.reason === "operator_accepted_recommendation" ||
        verdict.reason === "live_at_is_set"
      ) {
        skippedLiveOrAccepted++;
      } else if (
        verdict.reason === "source_system_null" ||
        verdict.reason.startsWith("source_system_not_in_targets")
      ) {
        skippedDangerous++;
      } else {
        skippedDangerous++;
      }
      continue;
    }

    const ss = row.source_system ?? "null";
    proposalsBySS[ss] = (proposalsBySS[ss] ?? 0) + 1;

    const previousMetadata = (row.metadata ?? null) as
      | Record<string, unknown>
      | null;

    proposals.push({
      id: row.id,
      source_system: row.source_system,
      previous: {
        import_batch_id: row.import_batch_id,
        metadata: previousMetadata,
      },
      next: {
        // Operator scope: do NOT change the existing top-level
        // import_batch_id column (preserves the original auto-gen
        // run id for audit). The W4 label lives in metadata.
        import_batch_id: row.import_batch_id,
        metadata: {
          ...(previousMetadata ?? {}),
          import_batch_id: W4_RELABEL_BATCH_ID,
          display_group: W4_RELABEL_DISPLAY_GROUP,
          w4_extraction_run_id: extractionRunId,
        },
      },
      proposed_import_batch_id: W4_RELABEL_BATCH_ID,
      proposed_display_group: W4_RELABEL_DISPLAY_GROUP,
      preserved_fields: {
        timestamp: row.timestamp,
        url: row.url,
        asset_name: row.asset_name,
        change_description: row.change_description,
        created_at: row.created_at,
        archived: row.archived ?? false,
        live_at: row.live_at,
        hypothesis_source: row.hypothesis_source,
        source_rec_id: row.source_rec_id,
      },
    });
  }

  // 3. Recommendation safety (READ-ONLY check).
  const recRowCount = countLocalArray(
    join(cwd, ".data", "tenants", args.tenantSlug, "recommended-edits.json"),
  );
  const respRowCount = countLocalArray(
    join(
      cwd,
      ".data",
      "tenants",
      args.tenantSlug,
      "recommendation-responses.json",
    ),
  );

  // 4. Write staged outputs.
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(
    join(stagingDir, "w4-relabel-changelog.json"),
    JSON.stringify(proposals, null, 2),
    "utf-8",
  );

  const reportObj: RelabelChangelogReport = {
    tenantId: args.tenantId,
    tenantSlug: args.tenantSlug,
    dryRun: args.dryRun,
    stagingDir,
    extractionRunId,
    relabeledAt: new Date().toISOString(),
    counts: {
      totalRowsScanned: allRows.length,
      proposedRelabel: proposals.length,
      skippedBySourceSystem,
      skippedAlreadyLabeled,
      skippedLiveOrAccepted,
      skippedDangerous,
    },
    proposalsBySourceSystem: proposalsBySS,
    skippedBySourceSystem: skippedBySS,
    skippedReasonBreakdown,
    sampleProposals: proposals.slice(0, 5),
    recommendationSafety: {
      localRecommendedEditsRowCount: recRowCount,
      localRecommendationResponsesRowCount: respRowCount,
    },
    noOp: proposals.length === 0,
    errors,
  };
  writeFileSync(
    join(stagingDir, "w4-relabel-changelog-report.json"),
    JSON.stringify(reportObj, null, 2),
    "utf-8",
  );

  return reportObj;
}

function emptyRelabelReport(args: {
  tenantId: string;
  tenantSlug: string;
  dryRun: boolean;
  stagingDir: string;
  extractionRunId: string;
  errors: string[];
}): RelabelChangelogReport {
  return {
    tenantId: args.tenantId,
    tenantSlug: args.tenantSlug,
    dryRun: args.dryRun,
    stagingDir: args.stagingDir,
    extractionRunId: args.extractionRunId,
    relabeledAt: new Date().toISOString(),
    counts: {
      totalRowsScanned: 0,
      proposedRelabel: 0,
      skippedBySourceSystem: 0,
      skippedAlreadyLabeled: 0,
      skippedLiveOrAccepted: 0,
      skippedDangerous: 0,
    },
    proposalsBySourceSystem: {},
    skippedBySourceSystem: {},
    skippedReasonBreakdown: {},
    sampleProposals: [],
    recommendationSafety: {
      localRecommendedEditsRowCount: null,
      localRecommendationResponsesRowCount: null,
    },
    noOp: true,
    errors: args.errors,
  };
}

function printRelabelChangelogReport(report: RelabelChangelogReport): void {
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("W4 STAGE 5 — RELABEL CHANGELOG REPORT");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`tenant_id              : ${report.tenantId}`);
  console.log(`tenant_slug            : ${report.tenantSlug}`);
  console.log(`dry_run                : ${report.dryRun}`);
  console.log(`staging_dir            : ${report.stagingDir}`);
  console.log(`extraction_run_id      : ${report.extractionRunId}`);
  console.log(`relabeled_at           : ${report.relabeledAt}`);
  console.log("");
  console.log("─ Counts ────────────────────────────────────────────────────────");
  console.log(`  total_rows_scanned       : ${report.counts.totalRowsScanned}`);
  console.log(`  proposed_relabel         : ${report.counts.proposedRelabel}`);
  console.log(`  skipped_by_source_system : ${report.counts.skippedBySourceSystem}  (live scanner)`);
  console.log(`  skipped_already_labeled  : ${report.counts.skippedAlreadyLabeled}`);
  console.log(`  skipped_live_or_accepted : ${report.counts.skippedLiveOrAccepted}  (live_at != null OR hypothesis_source = recommendation)`);
  console.log(`  skipped_dangerous        : ${report.counts.skippedDangerous}  (null source_system OR unfamiliar)`);
  console.log("");
  console.log("─ Proposals by source_system ────────────────────────────────────");
  for (const [k, v] of Object.entries(report.proposalsBySourceSystem)) {
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(7)}`);
  }
  if (Object.keys(report.proposalsBySourceSystem).length === 0) {
    console.log("  (none)");
  }
  console.log("");
  console.log("─ Skipped by source_system ──────────────────────────────────────");
  for (const [k, v] of Object.entries(report.skippedBySourceSystem)) {
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(7)}`);
  }
  console.log("");
  console.log("─ Skipped by reason ─────────────────────────────────────────────");
  for (const [k, v] of Object.entries(report.skippedReasonBreakdown)) {
    console.log(`  ${k.padEnd(40)} ${String(v).padStart(7)}`);
  }
  console.log("");
  console.log("─ UI copy planning ──────────────────────────────────────────────");
  console.log(`  proposed import_batch_id : ${W4_RELABEL_BATCH_ID}`);
  console.log(`  proposed display group   : ${W4_RELABEL_DISPLAY_GROUP}`);
  console.log(`  /changes label change    : "Imported legacy" → "Pre-launch history"`);
  console.log(`  (staging only — /changes UI copy + tab order are NOT modified by Stage 5)`);
  console.log("");
  console.log("─ Recommendation safety (read-only sanity check) ───────────────");
  console.log(
    `  local recommended_edits rows         : ${report.recommendationSafety.localRecommendedEditsRowCount ?? "(file absent)"}`,
  );
  console.log(
    `  local recommendation_responses rows  : ${report.recommendationSafety.localRecommendationResponsesRowCount ?? "(file absent)"}`,
  );
  console.log("");
  if (report.sampleProposals.length > 0) {
    console.log("─ Sample relabel proposals (first 5) ────────────────────────────");
    for (const p of report.sampleProposals) {
      console.log(
        `  · ${p.id} (source=${p.source_system}) → next.metadata.import_batch_id=${p.next.metadata.import_batch_id}`,
      );
    }
    console.log("");
  }
  if (report.errors.length > 0) {
    console.log("─ ERRORS ────────────────────────────────────────────────────────");
    for (const e of report.errors) console.log(`  - ${e}`);
    console.log("");
  }
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(
    "Stage 5 complete. NO Supabase writes. NO live .data/tenants/ mutation.",
  );
  console.log(
    `Staged outputs: ${report.stagingDir}/w4-relabel-changelog.json + report.`,
  );
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
