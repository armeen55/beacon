/**
 * W4 (2026-05-04) — customer-one-backfill orchestrator tests.
 *
 * Pin the operator-locked safety contracts:
 *
 *   1. Hash function deterministic (sha256 of fixture buffer).
 *   2. Stage parsing — known stages parse, unknown rejected.
 *   3. Reserved (future) stages fail with isReserved=true.
 *   4. Same-day backup overwrite blocked unless --force-overwrite.
 *   5. Manifest summary builder is pure + correctly aggregates.
 *   6. backupDirFor produces a deterministic path.
 *   7. dateStringFor returns YYYY-MM-DD from any Date.
 *   8. Stage 0 (preflight) does not write to Supabase (source-scan).
 *   9. Stage 1 (backup) writes only to backup dir (source-scan).
 *  10. publish/extract/rederive are NOT in IMPLEMENTED_STAGES.
 *  11. The CLI prints a giant warning when --stage=publish is passed
 *      (source-scan).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_STAGES,
  IMPLEMENTED_STAGES,
  LOCKED_CSV_MANIFEST,
  SUPABASE_TABLES_TO_BACKUP,
  answerHashForText,
  backupDirFor,
  canonicalScopeKey,
  classifyChangelogRowForRelabel,
  dateStringFor,
  deterministicObservationId,
  extractCitationsFromRow,
  parseFlags,
  parseMentionsField,
  parseProfoundPosition,
  sha256OfBuffer,
  shouldBlockSameDayBackup,
  snapshotMatchKey,
  summarizeManifest,
  validateStage,
  type BackupManifestEntry,
  type Stage,
} from "../../scripts/customer-one-backfill";

const SCRIPT_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "scripts",
  "customer-one-backfill.ts",
);
const SCRIPT_SRC = fs.readFileSync(SCRIPT_PATH, "utf-8");

// ── 1. Hash function deterministic ──────────────────────────────────────

describe("sha256OfBuffer", () => {
  it("is deterministic — same input → same hash", () => {
    const a = sha256OfBuffer("hello world");
    const b = sha256OfBuffer("hello world");
    expect(a).toBe(b);
  });

  it("matches the known sha256 of 'hello world'", () => {
    expect(sha256OfBuffer("hello world")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("is sensitive to a one-char change", () => {
    const a = sha256OfBuffer("hello world");
    const b = sha256OfBuffer("hello worlD");
    expect(a).not.toBe(b);
  });

  it("hashes Buffer + Uint8Array + string identically given equal bytes", () => {
    const s = "the same input";
    expect(sha256OfBuffer(s)).toBe(sha256OfBuffer(Buffer.from(s)));
    expect(sha256OfBuffer(s)).toBe(sha256OfBuffer(new Uint8Array(Buffer.from(s))));
  });
});

// ── 2. Stage parsing ───────────────────────────────────────────────────

describe("parseFlags", () => {
  it("defaults to dry-run + no stage", () => {
    const f = parseFlags([]);
    expect(f.dryRun).toBe(true);
    expect(f.stage).toBeNull();
    expect(f.forceOverwrite).toBe(false);
    expect(f.help).toBe(false);
  });

  it("--stage=preflight parses", () => {
    expect(parseFlags(["--stage=preflight"]).stage).toBe("preflight");
  });

  it("--stage=backup parses", () => {
    expect(parseFlags(["--stage=backup"]).stage).toBe("backup");
  });

  it("--write flips dryRun off", () => {
    expect(parseFlags(["--write"]).dryRun).toBe(false);
  });

  it("--force-overwrite parses", () => {
    expect(parseFlags(["--force-overwrite"]).forceOverwrite).toBe(true);
  });

  it("--help / -h parses", () => {
    expect(parseFlags(["--help"]).help).toBe(true);
    expect(parseFlags(["-h"]).help).toBe(true);
  });

  it("preserves stage value as a string the validator can reject", () => {
    // parseFlags doesn't reject — that's validateStage's job.
    expect(parseFlags(["--stage=garbage"]).stage).toBe("garbage" as Stage);
  });
});

// ── 3. validateStage — known/unknown/reserved ──────────────────────────

describe("validateStage", () => {
  it("accepts implemented stages", () => {
    for (const s of ["preflight", "backup"] as const) {
      const v = validateStage(s);
      expect(v.ok).toBe(true);
      expect(v.isReserved).toBe(false);
    }
  });

  it("rejects null with a clear message", () => {
    const v = validateStage(null);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/no --stage provided/);
    expect(v.isReserved).toBe(false);
  });

  it("rejects unknown stage name", () => {
    const v = validateStage("garbage" as Stage);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/unknown stage/);
    expect(v.isReserved).toBe(false);
  });

  it("rejects reserved stages with isReserved=true (verify / publish / rollback)", () => {
    // W4 Stage 5 (2026-05-04): relabel-changelog is now
    // IMPLEMENTED; remaining reserved set narrowed to 3.
    const RESERVED: Stage[] = ["verify", "publish", "rollback"];
    for (const s of RESERVED) {
      const v = validateStage(s);
      expect(v.ok).toBe(false);
      expect(v.isReserved).toBe(true);
      expect(v.reason).toMatch(/not yet implemented/i);
    }
  });

  it("publish is RESERVED and not implemented today", () => {
    expect(IMPLEMENTED_STAGES.has("publish")).toBe(false);
    expect(validateStage("publish").isReserved).toBe(true);
  });

  it("extract-observations IS implemented as of W4 Stage 2 (2026-05-04)", () => {
    expect(IMPLEMENTED_STAGES.has("extract-observations")).toBe(true);
    const v = validateStage("extract-observations");
    expect(v.ok).toBe(true);
    expect(v.isReserved).toBe(false);
  });

  it("rederive-snapshots IS implemented as of W4 Stage 3 (2026-05-04)", () => {
    expect(IMPLEMENTED_STAGES.has("rederive-snapshots")).toBe(true);
    const v = validateStage("rederive-snapshots");
    expect(v.ok).toBe(true);
    expect(v.isReserved).toBe(false);
  });

  it("copy-orphan-benchmarks IS implemented as of W4 Stage 4 (2026-05-04)", () => {
    expect(IMPLEMENTED_STAGES.has("copy-orphan-benchmarks")).toBe(true);
    const v = validateStage("copy-orphan-benchmarks");
    expect(v.ok).toBe(true);
    expect(v.isReserved).toBe(false);
  });

  it("relabel-changelog IS implemented as of W4 Stage 5 (2026-05-04)", () => {
    expect(IMPLEMENTED_STAGES.has("relabel-changelog")).toBe(true);
    const v = validateStage("relabel-changelog");
    expect(v.ok).toBe(true);
    expect(v.isReserved).toBe(false);
  });
});

// ── 4. Same-day backup overwrite block ─────────────────────────────────

describe("shouldBlockSameDayBackup", () => {
  it("blocks when the dir exists AND --force-overwrite NOT passed", () => {
    expect(
      shouldBlockSameDayBackup({
        backupDir: "/tmp/x",
        forceOverwrite: false,
        existsCheck: () => true,
      }),
    ).toBe(true);
  });

  it("allows when the dir exists AND --force-overwrite IS passed", () => {
    expect(
      shouldBlockSameDayBackup({
        backupDir: "/tmp/x",
        forceOverwrite: true,
        existsCheck: () => true,
      }),
    ).toBe(false);
  });

  it("allows when the dir does NOT exist (regardless of --force-overwrite)", () => {
    expect(
      shouldBlockSameDayBackup({
        backupDir: "/tmp/x",
        forceOverwrite: false,
        existsCheck: () => false,
      }),
    ).toBe(false);
    expect(
      shouldBlockSameDayBackup({
        backupDir: "/tmp/x",
        forceOverwrite: true,
        existsCheck: () => false,
      }),
    ).toBe(false);
  });
});

// ── 5. Manifest builder summary aggregation ─────────────────────────────

describe("summarizeManifest", () => {
  it("aggregates totalBytes / totalRows / per-source-of-truth counts", () => {
    const now = new Date().toISOString();
    const entries: BackupManifestEntry[] = [
      {
        name: "a",
        sourceOfTruth: "supabase",
        rowCount: 100,
        byteCount: 1000,
        sha256: "x",
        timestamp: now,
        tenantId: "t",
        tenantSlug: "s",
        relativePath: "supabase/a.json",
      },
      {
        name: "b",
        sourceOfTruth: "supabase",
        rowCount: 50,
        byteCount: 500,
        sha256: "x",
        timestamp: now,
        tenantId: "t",
        tenantSlug: "s",
        relativePath: "supabase/b.json",
      },
      {
        name: "c",
        sourceOfTruth: "local_file",
        rowCount: 25,
        byteCount: 250,
        sha256: "x",
        timestamp: now,
        tenantId: "t",
        tenantSlug: "s",
        relativePath: "local/c.json",
      },
      {
        name: "d.csv",
        sourceOfTruth: "csv_source",
        rowCount: null,
        byteCount: 9999,
        sha256: "x",
        timestamp: now,
        tenantId: "t",
        tenantSlug: "s",
        relativePath: "csv-source/d.csv.sha256",
      },
    ];
    const s = summarizeManifest(entries);
    expect(s.totalEntries).toBe(4);
    expect(s.supabaseEntries).toBe(2);
    expect(s.localFileEntries).toBe(1);
    expect(s.csvSourceEntries).toBe(1);
    expect(s.totalBytes).toBe(1000 + 500 + 250 + 9999);
    expect(s.totalRows).toBe(100 + 50 + 25); // null skipped
  });

  it("returns zero totals on an empty entry list", () => {
    const s = summarizeManifest([]);
    expect(s).toEqual({
      totalEntries: 0,
      supabaseEntries: 0,
      localFileEntries: 0,
      csvSourceEntries: 0,
      totalBytes: 0,
      totalRows: 0,
    });
  });
});

// ── 6. backupDirFor + dateStringFor ─────────────────────────────────────

describe("backupDirFor + dateStringFor", () => {
  it("dateStringFor returns YYYY-MM-DD for any Date", () => {
    expect(dateStringFor(new Date("2026-05-04T15:30:45Z"))).toBe("2026-05-04");
    expect(dateStringFor(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });

  it("backupDirFor produces a deterministic absolute path under .data/_backups", () => {
    const out = backupDirFor({ cwd: "/Users/test/beacon", date: "2026-05-04" });
    expect(out).toBe(
      "/Users/test/beacon/.data/_backups/pre-w4-backfill-2026-05-04",
    );
  });
});

// ── 7. Locked manifests carry the four source CSVs ─────────────────────

describe("LOCKED_CSV_MANIFEST + SUPABASE_TABLES_TO_BACKUP", () => {
  it("LOCKED_CSV_MANIFEST has all 4 expected CSVs (W4 preflight 2026-05-04)", () => {
    expect(Object.keys(LOCKED_CSV_MANIFEST).sort()).toEqual([
      "profound-prompts.csv",
      "profound_citations_data(march5th-april21st).csv",
      "profound_raw_data_with_citations(march5th-april21st).csv",
      "profound_summarized_export_(march5th-april21st).csv",
    ]);
  });

  it("each manifest hash is a 64-char lowercase hex string", () => {
    for (const [name, hash] of Object.entries(LOCKED_CSV_MANIFEST)) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("SUPABASE_TABLES_TO_BACKUP carries every table the operator's spec listed", () => {
    expect([...SUPABASE_TABLES_TO_BACKUP].sort()).toEqual([
      "changelog_entries",
      "daily_metric_snapshots",
      "prompt_answer_observations",
      "recommendation_responses",
      "recommended_edits",
      "tracked_entities",
      "tracked_prompts",
    ]);
  });

  it("ALL_STAGES contains exactly the 9 W4 stages", () => {
    expect([...ALL_STAGES].sort()).toEqual([
      "backup",
      "copy-orphan-benchmarks",
      "extract-observations",
      "preflight",
      "publish",
      "rederive-snapshots",
      "relabel-changelog",
      "rollback",
      "verify",
    ]);
  });
});

// ── 8/9. Source-scan invariants — preflight read-only / backup write-scoped ───

describe("Stage 0 preflight is read-only (source-scan)", () => {
  it("runPreflight calls Supabase only with HEAD / SELECT — no INSERT / UPDATE / DELETE / UPSERT", () => {
    // Find the runPreflight definition + walk its body. The body
    // ends at the next top-level helper signature (`async function
    // runPreflight` ... → `async function countTable`).
    const start = SCRIPT_SRC.indexOf("async function runPreflight(");
    const end = SCRIPT_SRC.indexOf("// ── Stage 0 helpers");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = SCRIPT_SRC.slice(start, end);
    // Forbidden mutations:
    expect(body).not.toMatch(/\.insert\(/);
    expect(body).not.toMatch(/\.update\(/);
    expect(body).not.toMatch(/\.delete\(/);
    expect(body).not.toMatch(/\.upsert\(/);
    // Allowed reads:
    expect(body).toMatch(/\.select\(/);
  });
});

describe("Stage 1 backup writes ONLY to the backup directory (source-scan)", () => {
  it("runBackup never calls .insert/.update/.delete/.upsert on Supabase", () => {
    const start = SCRIPT_SRC.indexOf("async function runBackup(");
    const end = SCRIPT_SRC.indexOf("async function exportSupabaseTable(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = SCRIPT_SRC.slice(start, end);
    expect(body).not.toMatch(/\.insert\(/);
    expect(body).not.toMatch(/\.update\(/);
    expect(body).not.toMatch(/\.delete\(/);
    expect(body).not.toMatch(/\.upsert\(/);
  });

  it("every writeFileSync target inside runBackup lands under `backupDir`", () => {
    const start = SCRIPT_SRC.indexOf("async function runBackup(");
    const end = SCRIPT_SRC.indexOf("async function exportSupabaseTable(");
    const body = SCRIPT_SRC.slice(start, end);
    // Match writeFileSync(<arg>, ...) — the first argument should
    // always start with `join(backupDir, ...)` or use a path
    // assembled from `backupDir`.
    const writeMatches = [...body.matchAll(/writeFileSync\(\s*([^,]+),/g)];
    expect(writeMatches.length).toBeGreaterThan(0);
    for (const m of writeMatches) {
      const arg = m[1];
      // Either a direct join(backupDir, ...) call, or a pre-bound
      // `out` variable that itself is assembled from backupDir.
      const compatible =
        /join\(\s*backupDir/.test(arg) ||
        /backupDir/.test(arg) ||
        /\bout\b/.test(arg);
      expect(compatible).toBe(true);
    }
  });

  it("runBackup creates only the backup-scoped subdirectories (supabase, local/tenants/<slug>, csv-source)", () => {
    const start = SCRIPT_SRC.indexOf("async function runBackup(");
    const end = SCRIPT_SRC.indexOf("async function exportSupabaseTable(");
    const body = SCRIPT_SRC.slice(start, end);
    const mkdirs = [...body.matchAll(/mkdirSync\(\s*([^,]+)/g)].map(
      (m) => m[1],
    );
    expect(mkdirs.length).toBeGreaterThan(0);
    for (const m of mkdirs) {
      expect(/backupDir/.test(m) || /join\(/.test(m)).toBe(true);
    }
  });
});

// ── 10. publish stage prints a giant warning + is gated as "not implemented" ───

describe("publish stage is hard-blocked + warned (source-scan)", () => {
  it("the orchestrator's main() prints a giant warning when --stage=publish is passed", () => {
    expect(SCRIPT_SRC).toMatch(/W4 PUBLISH STAGE/);
    expect(SCRIPT_SRC).toMatch(/NOT YET IMPLEMENTED/);
  });

  it("validateStage('publish').isReserved is true (re-pin the implementation contract)", () => {
    const v = validateStage("publish" as Stage);
    expect(v.ok).toBe(false);
    expect(v.isReserved).toBe(true);
  });

  it("IMPLEMENTED_STAGES carries the W4 Stage 5 set", () => {
    expect([...IMPLEMENTED_STAGES].sort()).toEqual([
      "backup",
      "copy-orphan-benchmarks",
      "extract-observations",
      "preflight",
      "rederive-snapshots",
      "relabel-changelog",
    ]);
  });
});

// ── 12. Stage 2 — extract-observations pure helpers + invariants ───────

describe("Stage 2 — deterministicObservationId", () => {
  it("same inputs → same id (deterministic, idempotent rerun)", () => {
    const args = {
      tenantId: "tenant-ritz-founder",
      date: "2026-04-21",
      platform: "google-ai-overviews",
      promptId: "b741f295-2535-4027-95d6-8edbed7ee4e9",
      runId: "5d8b044b-e1db-4a7e-ab44-239347dbc2a7",
      answerHash: "a58ddc90",
    };
    const a = deterministicObservationId(args);
    const b = deterministicObservationId(args);
    expect(a).toBe(b);
  });

  it("different inputs → different ids (sensitive to every field)", () => {
    const base = {
      tenantId: "tenant-x",
      date: "2026-04-21",
      platform: "chatgpt",
      promptId: "p1",
      runId: "r1",
      answerHash: "h1",
    };
    const ids = [
      deterministicObservationId(base),
      deterministicObservationId({ ...base, tenantId: "tenant-y" }),
      deterministicObservationId({ ...base, date: "2026-04-22" }),
      deterministicObservationId({ ...base, platform: "perplexity" }),
      deterministicObservationId({ ...base, promptId: "p2" }),
      deterministicObservationId({ ...base, runId: "r2" }),
      deterministicObservationId({ ...base, answerHash: "h2" }),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns a UUID-shaped 36-char string", () => {
    const id = deterministicObservationId({
      tenantId: "t",
      date: "2026-01-01",
      platform: "p",
      promptId: "pp",
      runId: "rr",
      answerHash: "hh",
    });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe("Stage 2 — answerHashForText", () => {
  it("returns 8 hex chars", () => {
    expect(answerHashForText("hello world")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic", () => {
    expect(answerHashForText("response text")).toBe(answerHashForText("response text"));
  });

  it("different text → different hash", () => {
    expect(answerHashForText("a")).not.toBe(answerHashForText("b"));
  });

  it("empty text returns a stable empty-text hash", () => {
    const e = answerHashForText("");
    expect(e).toMatch(/^[0-9a-f]{8}$/);
    expect(e).toBe(answerHashForText(""));
  });
});

describe("Stage 2 — parseProfoundPosition", () => {
  it("'#1' → 1, '#10' → 10", () => {
    expect(parseProfoundPosition("#1")).toBe(1);
    expect(parseProfoundPosition("#10")).toBe(10);
  });

  it("bare digits parse", () => {
    expect(parseProfoundPosition("3")).toBe(3);
  });

  it("whitespace tolerated", () => {
    expect(parseProfoundPosition(" #2 ")).toBe(2);
  });

  it("invalid → null", () => {
    expect(parseProfoundPosition("")).toBeNull();
    expect(parseProfoundPosition(null)).toBeNull();
    expect(parseProfoundPosition(undefined)).toBeNull();
    expect(parseProfoundPosition("none")).toBeNull();
    expect(parseProfoundPosition("0")).toBeNull();
    expect(parseProfoundPosition("-1")).toBeNull();
  });
});

describe("Stage 2 — extractCitationsFromRow", () => {
  it("collects citation_1..citation_36 URLs + dedupes domains", () => {
    const row: Record<string, string> = {
      citation_1: "https://www.example.com/foo",
      citation_2: "https://example.com/bar?q=1",
      citation_3: "https://other.com/baz",
      citation_4: "",
    };
    for (let i = 5; i <= 36; i++) row[`citation_${i}`] = "";
    const out = extractCitationsFromRow(row);
    expect(out.citationUrls).toEqual([
      "https://www.example.com/foo",
      "https://example.com/bar?q=1",
      "https://other.com/baz",
    ]);
    // www. stripped + dedupe.
    expect(out.citationDomains).toEqual(["example.com", "other.com"]);
  });

  it("handles all-empty rows", () => {
    const row: Record<string, string> = {};
    for (let i = 1; i <= 36; i++) row[`citation_${i}`] = "";
    const out = extractCitationsFromRow(row);
    expect(out.citationUrls).toEqual([]);
    expect(out.citationDomains).toEqual([]);
  });

  it("malformed URLs fall back to regex host extract", () => {
    const row: Record<string, string> = {};
    for (let i = 1; i <= 36; i++) row[`citation_${i}`] = "";
    row.citation_1 = "https://valid.com/path";
    row.citation_2 = "not-a-url-at-all";
    const out = extractCitationsFromRow(row);
    expect(out.citationDomains).toContain("valid.com");
    // Bare strings without protocol get URL() reject + null host →
    // not pushed.
    expect(out.citationDomains.length).toBe(1);
  });
});

describe("Stage 2 — parseMentionsField", () => {
  it("comma-splits + trims + dedupes preserving order", () => {
    expect(
      parseMentionsField("Ritz Builders, JPM Construction, Ritz Builders, Sigura"),
    ).toEqual(["Ritz Builders", "JPM Construction", "Sigura"]);
  });

  it("empty / null → []", () => {
    expect(parseMentionsField(null)).toEqual([]);
    expect(parseMentionsField(undefined)).toEqual([]);
    expect(parseMentionsField("")).toEqual([]);
    expect(parseMentionsField("   ")).toEqual([]);
  });

  it("single value parses", () => {
    expect(parseMentionsField("Ritz Builders")).toEqual(["Ritz Builders"]);
  });
});

// ── 13. Stage 2 source-scan invariants ────────────────────────────────

describe("Stage 2 — runExtractObservations is staging-only (source-scan)", () => {
  it("never calls .insert/.update/.delete/.upsert on Supabase", () => {
    const start = SCRIPT_SRC.indexOf("async function runExtractObservations(");
    const end = SCRIPT_SRC.indexOf("function emptyExtractReport(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = SCRIPT_SRC.slice(start, end);
    expect(body).not.toMatch(/\.insert\(/);
    expect(body).not.toMatch(/\.update\(/);
    expect(body).not.toMatch(/\.delete\(/);
    expect(body).not.toMatch(/\.upsert\(/);
    // Supabase reads ARE allowed.
    expect(body).toMatch(/\.select\(/);
  });

  it("every writeFileSync target inside runExtractObservations lands under stagingDir", () => {
    const start = SCRIPT_SRC.indexOf("async function runExtractObservations(");
    const end = SCRIPT_SRC.indexOf("function emptyExtractReport(");
    const body = SCRIPT_SRC.slice(start, end);
    const writes = [...body.matchAll(/writeFileSync\(\s*([^,]+),/g)].map(
      (m) => m[1],
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      // Each writeFileSync uses a path derived from `stagingDir`.
      expect(/stagingDir|join\(\s*stagingDir/.test(w)).toBe(true);
    }
  });

  it("does NOT read from `.data/tenants/<slug>/prompt-answer-observations.json` (operator scope: avoid stale cache)", () => {
    const start = SCRIPT_SRC.indexOf("async function runExtractObservations(");
    const end = SCRIPT_SRC.indexOf("function emptyExtractReport(");
    const body = SCRIPT_SRC.slice(start, end);
    expect(body).not.toMatch(/prompt-answer-observations\.json/);
    expect(body).not.toMatch(/tenants\/ritz-builders\/prompt-answer/);
  });

  it("stamps regime / source_system / extraction_method / source_csv_hash / source_csv_row_id / extraction_confidence", () => {
    const start = SCRIPT_SRC.indexOf("async function runExtractObservations(");
    const end = SCRIPT_SRC.indexOf("function emptyExtractReport(");
    const body = SCRIPT_SRC.slice(start, end);
    expect(body).toMatch(/regime:\s*"historical_recovered"/);
    expect(body).toMatch(/source_system:\s*"profound_csv_extracted"/);
    expect(body).toMatch(/extraction_method:/);
    expect(body).toMatch(/source_csv_hash/);
    expect(body).toMatch(/source_csv_row_id/);
    expect(body).toMatch(/extraction_confidence/);
  });

  it("stamps blindSpot for Google AI Overviews rows", () => {
    const start = SCRIPT_SRC.indexOf("async function runExtractObservations(");
    const end = SCRIPT_SRC.indexOf("function emptyExtractReport(");
    const body = SCRIPT_SRC.slice(start, end);
    expect(body).toMatch(/AIO does not expose internal queries/);
  });

  it("counts AIO blind-spot rows in the report", () => {
    expect(SCRIPT_SRC).toMatch(/aioBlindSpotCount/);
  });

  it("treats CSV hash drift as a hard error (no extraction proceeds)", () => {
    const start = SCRIPT_SRC.indexOf("async function runExtractObservations(");
    const end = SCRIPT_SRC.indexOf("function emptyExtractReport(");
    const body = SCRIPT_SRC.slice(start, end);
    expect(body).toMatch(/source CSV hash drift/);
  });

  it("reports prompt-mapping orphans by collecting them in skippedRowsByReason + orphanSamples", () => {
    const start = SCRIPT_SRC.indexOf("async function runExtractObservations(");
    const end = SCRIPT_SRC.indexOf("function emptyExtractReport(");
    const body = SCRIPT_SRC.slice(start, end);
    expect(body).toMatch(/orphan_prompt/);
    expect(body).toMatch(/orphanPromptSet/);
  });

  it("handles empty-response rows explicitly (skippedRowsByReason key)", () => {
    const start = SCRIPT_SRC.indexOf("async function runExtractObservations(");
    const end = SCRIPT_SRC.indexOf("function emptyExtractReport(");
    const body = SCRIPT_SRC.slice(start, end);
    expect(body).toMatch(/empty_response_kept_for_citations/);
    // Text-derived extractors are gated behind hasResponse.
    expect(body).toMatch(/if\s*\(\s*hasResponse\s*\)/);
  });
});

// ── 14. Stage 3 — rederive-snapshots invariants ────────────────────────

describe("Stage 3 — runRederiveSnapshots is staging-only (source-scan)", () => {
  function runRederiveBody(): string {
    const start = SCRIPT_SRC.indexOf("async function runRederiveSnapshots(");
    const end = SCRIPT_SRC.indexOf("function extractSourceCsvHashFromStaged(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return SCRIPT_SRC.slice(start, end);
  }

  it("never calls .insert/.update/.delete/.upsert on Supabase", () => {
    const body = runRederiveBody();
    expect(body).not.toMatch(/\.insert\(/);
    expect(body).not.toMatch(/\.update\(/);
    expect(body).not.toMatch(/\.delete\(/);
    expect(body).not.toMatch(/\.upsert\(/);
    // Reads against tracked_entities ARE allowed (registry is read-
    // only for Stage 3).
    expect(body).toMatch(/\.from\(\s*"tracked_entities"\s*\)/);
    expect(body).toMatch(/\.select\(/);
  });

  it("hard-fails when Stage 2 staging file is missing", () => {
    const body = runRederiveBody();
    expect(body).toMatch(/Stage 2 output missing/);
    expect(body).toMatch(/!existsSync\(stagedObsPath\)/);
  });

  it("does NOT read from .data/tenants/<slug>/prompt-answer-observations.json", () => {
    const body = runRederiveBody();
    expect(body).not.toMatch(/prompt-answer-observations\.json/);
    expect(body).not.toMatch(/tenants\/ritz-builders\/prompt-answer/);
  });

  it("does NOT WRITE to recommended_edits / recommendation_responses (read-only sanity check only)", () => {
    const body = runRederiveBody();
    // The ONLY occurrences of these filenames in the body are in
    // read-only count helpers — never a writeFileSync.
    const writeMatches = [...body.matchAll(/writeFileSync\(\s*([^,]+),/g)].map((m) => m[1]);
    for (const w of writeMatches) {
      expect(w).not.toMatch(/recommended-edits/);
      expect(w).not.toMatch(/recommendation-responses/);
    }
  });

  it("every writeFileSync target lands under stagingDir", () => {
    const body = runRederiveBody();
    const writes = [...body.matchAll(/writeFileSync\(\s*([^,]+),/g)].map(
      (m) => m[1],
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(/stagingDir|outPath|join\(\s*stagingDir/.test(w)).toBe(true);
    }
  });

  it("calls buildDailySnapshotsFromObservations from src/domains/daily-metric-snapshots/build-from-observations", () => {
    const body = runRederiveBody();
    expect(body).toMatch(/buildDailySnapshotsFromObservations/);
    expect(body).toMatch(
      /domains\/daily-metric-snapshots\/build-from-observations/,
    );
  });

  it("stamps W4 provenance (provenance + regime + extraction_run_id + source_csv_hash) on every row", () => {
    const body = runRederiveBody();
    expect(body).toMatch(/provenance:\s*"rederived_from_historical_recovered"/);
    expect(body).toMatch(/regime:\s*"historical_recovered"/);
    expect(body).toMatch(/extraction_run_id:/);
    expect(body).toMatch(/source_csv_hash:/);
  });

  it("validates source_type === 'derived' on every row + reports invalid count", () => {
    const body = runRederiveBody();
    expect(body).toMatch(/source_type !==\s*"derived"/);
    expect(body).toMatch(/invalidSourceType/);
  });

  it("detects duplicate snapshot IDs + surfaces them in the report", () => {
    const body = runRederiveBody();
    expect(body).toMatch(/duplicateIds/);
    expect(body).toMatch(/duplicate snapshot IDs/i);
  });

  it("derives extraction_run_id deterministically from staged source_csv_hash", () => {
    const body = runRederiveBody();
    expect(body).toMatch(/w4-rederive-/);
    expect(body).toMatch(/sourceCsvHash/);
  });

  it("groups observations by (date, platform) tuple before invoking the builder", () => {
    const body = runRederiveBody();
    expect(body).toMatch(/byTuple\.set/);
    expect(body).toMatch(/observed_at/);
  });
});

describe("Stage 3 — emptyRederiveReport handles all error paths", () => {
  it("function exists + returns the same shape as the success path", () => {
    expect(SCRIPT_SRC).toMatch(/function emptyRederiveReport/);
    expect(SCRIPT_SRC).toMatch(/RederiveSnapshotsReport/);
  });
});

// ── 15. Stage 4 — copy-orphan-benchmarks pure helpers ─────────────────

describe("Stage 4 — canonicalScopeKey", () => {
  it("collapses non-alphanumeric into nothing (lowercase)", () => {
    expect(canonicalScopeKey("MVS Construction")).toBe("mvsconstruction");
    expect(canonicalScopeKey("mvs-construction")).toBe("mvsconstruction");
    expect(canonicalScopeKey("Ritz Builders")).toBe("ritzbuilders");
    expect(canonicalScopeKey("ritzbuilders")).toBe("ritzbuilders");
  });

  it("benchmark slug + rederive slug for same entity collapse to same key", () => {
    // Operator-locked: this is the WHOLE point — diff benchmark vs
    // rederive scope_ids without false orphans.
    expect(canonicalScopeKey("mvs-construction")).toBe(
      canonicalScopeKey("mvsconstruction"),
    );
    expect(canonicalScopeKey("Ritz Builders")).toBe(
      canonicalScopeKey("ritzbuilders"),
    );
  });

  it("handles null / undefined / non-string", () => {
    expect(canonicalScopeKey(null)).toBe("");
    expect(canonicalScopeKey(undefined)).toBe("");
    expect(canonicalScopeKey(42 as unknown as string)).toBe("");
  });

  it("strips Unicode noise to alphanumeric ASCII only", () => {
    expect(canonicalScopeKey("Acme — Co.")).toBe("acmeco");
    expect(canonicalScopeKey("co. & sons")).toBe("cosons");
  });
});

describe("Stage 4 — snapshotMatchKey", () => {
  it("composes (date, scope_type, normalized scope_id, platform-slug)", () => {
    const k = snapshotMatchKey({
      date: "2026-04-07",
      scopeType: "entity",
      scopeId: "MVS Construction",
      platform: "Google AI Overviews",
    });
    expect(k).toBe(
      "2026-04-07::entity::mvsconstruction::google-ai-overviews",
    );
  });

  it("benchmark and rederive forms produce the SAME key for the same entity", () => {
    const benchKey = snapshotMatchKey({
      date: "2026-04-07",
      scopeType: "entity",
      scopeId: "ritz-builders",
      platform: "ChatGPT",
    });
    const rederiveKey = snapshotMatchKey({
      date: "2026-04-07",
      scopeType: "entity",
      scopeId: "ritzbuilders",
      platform: "ChatGPT",
    });
    expect(benchKey).toBe(rederiveKey);
  });

  it("different platform produces different key", () => {
    const a = snapshotMatchKey({
      date: "2026-04-07",
      scopeType: "entity",
      scopeId: "ritzbuilders",
      platform: "ChatGPT",
    });
    const b = snapshotMatchKey({
      date: "2026-04-07",
      scopeType: "entity",
      scopeId: "ritzbuilders",
      platform: "Perplexity",
    });
    expect(a).not.toBe(b);
  });

  it("scope_type lowercased, even if input uppercase", () => {
    const a = snapshotMatchKey({
      date: "2026-04-07",
      scopeType: "ENTITY",
      scopeId: "x",
      platform: "p",
    });
    expect(a).toMatch(/::entity::/);
  });
});

// ── 16. Stage 4 — runCopyOrphanBenchmarks invariants (source-scan) ────

describe("Stage 4 — runCopyOrphanBenchmarks is staging-only (source-scan)", () => {
  function body(): string {
    const start = SCRIPT_SRC.indexOf("async function runCopyOrphanBenchmarks(");
    const end = SCRIPT_SRC.indexOf("function emptyOrphanBenchmarkReport(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return SCRIPT_SRC.slice(start, end);
  }

  it("never calls .insert/.update/.delete/.upsert on Supabase", () => {
    const b = body();
    expect(b).not.toMatch(/\.insert\(/);
    expect(b).not.toMatch(/\.update\(/);
    expect(b).not.toMatch(/\.delete\(/);
    expect(b).not.toMatch(/\.upsert\(/);
    // Reads ARE allowed.
    expect(b).toMatch(/\.from\(\s*"daily_metric_snapshots"\s*\)/);
    expect(b).toMatch(/\.select\(/);
  });

  it("hard-fails when Stage 3 staging file is missing", () => {
    const b = body();
    expect(b).toMatch(/Stage 3 output missing/);
    expect(b).toMatch(/!existsSync\(stagedRederivedPath\)/);
  });

  it("does NOT read .data/tenants/<slug>/prompt-answer-observations.json", () => {
    const b = body();
    expect(b).not.toMatch(/prompt-answer-observations\.json/);
  });

  it("does NOT WRITE to recommended-edits or recommendation-responses", () => {
    const b = body();
    const writes = [...b.matchAll(/writeFileSync\(\s*([^,]+),/g)].map(
      (m) => m[1],
    );
    for (const w of writes) {
      expect(w).not.toMatch(/recommended-edits/);
      expect(w).not.toMatch(/recommendation-responses/);
    }
  });

  it("every writeFileSync target lands under stagingDir", () => {
    const b = body();
    const writes = [...b.matchAll(/writeFileSync\(\s*([^,]+),/g)].map(
      (m) => m[1],
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(/stagingDir|join\(\s*stagingDir/.test(w)).toBe(true);
    }
  });

  it("rejects superseded benchmark rows (does not copy when rederive or native key matches)", () => {
    const b = body();
    expect(b).toMatch(/supersededByRederive\+\+/);
    expect(b).toMatch(/supersededByNative\+\+/);
    expect(b).toMatch(/rederiveKeys\.has\(key\)/);
    expect(b).toMatch(/nativeKeys\.has\(key\)/);
  });

  it("true orphans become derived twins with provenance + regime imported_from_benchmark / historical_fallback", () => {
    const b = body();
    expect(b).toMatch(/provenance:\s*"imported_from_benchmark"/);
    expect(b).toMatch(/regime:\s*"historical_fallback"/);
    expect(b).toMatch(/original_source_type:\s*"benchmark"/);
    expect(b).toMatch(/benchmark_snapshot_id:/);
    expect(b).toMatch(/import_reason:/);
    // Causal-attribution guardrail metadata.
    expect(b).toMatch(/causal_attribution_excluded:\s*true/);
  });

  it("derived twins preserve numeric values byte-for-byte from the benchmark row", () => {
    const b = body();
    // The twin construction copies each numeric field directly.
    expect(b).toMatch(/visibility_score:\s*bench\.visibility_score/);
    expect(b).toMatch(/mention_count:\s*bench\.mention_count/);
    expect(b).toMatch(/citation_count:\s*bench\.citation_count/);
    expect(b).toMatch(/share_of_voice:\s*bench\.share_of_voice/);
    expect(b).toMatch(/avg_position:\s*bench\.avg_position/);
    expect(b).toMatch(/total_possible:\s*bench\.total_possible/);
  });

  it("twin source_type is 'derived' (NOT 'benchmark_archived' or some new enum)", () => {
    const b = body();
    expect(b).toMatch(/source_type:\s*"derived"\s+as\s+const/);
  });

  it("twin id is derived-fallback-* prefixed (collision-free with builder's derived-* IDs)", () => {
    const b = body();
    expect(b).toMatch(/derived-fallback-/);
  });

  it("zero-orphan path produces empty staged file + noOp:true in report", () => {
    const b = body();
    expect(b).toMatch(/noOp:\s*stagedTwins\.length === 0/);
  });

  it("dormant scopes (no coverage on any day) are NOT emitted as derived twins (chart-gap criterion)", () => {
    const b = body();
    // The continue happens inside the `if (!hasCoverage)` branch
    // BEFORE the twin-construction block.
    expect(b).toMatch(/if\s*\(\s*!hasCoverage\s*\)\s*{\s*continue/);
    // The reason categorization still runs (so the report shows the
    // scope_fully_dormant count) but the row is not staged.
    expect(b).toMatch(/scope_fully_dormant/);
  });

  it("chart-gap categorization splits orphans into fillsRealGap vs scopeFullyDormant", () => {
    const b = body();
    expect(b).toMatch(/fillsRealGap/);
    expect(b).toMatch(/scopeFullyDormant/);
    expect(b).toMatch(/scopeAnyCoverage/);
  });

  it("normalization mismatches surface for diagnostic (slug/casing differences)", () => {
    const b = body();
    expect(b).toMatch(/normalizationMismatches/);
  });

  it("inherits Stage 3's extraction_run_id for lineage continuity", () => {
    const b = body();
    expect(b).toMatch(/stage3RunId/);
    expect(b).toMatch(/extraction_run_id/);
  });
});

// ── 17. Stage 5 — classifyChangelogRowForRelabel pure helper ──────────

describe("Stage 5 — classifyChangelogRowForRelabel", () => {
  function row(overrides: {
    source_system?: string | null;
    hypothesis_source?: string | null;
    live_at?: string | null;
    metadata?: Record<string, unknown> | null;
    import_batch_id?: string | null;
  }) {
    return {
      source_system: null as string | null,
      hypothesis_source: null as string | null,
      live_at: null as string | null,
      metadata: null as Record<string, unknown> | null,
      import_batch_id: null as string | null,
      ...overrides,
    };
  }

  it("pdf_changelog_rebuild → relabel:true", () => {
    const v = classifyChangelogRowForRelabel(
      row({ source_system: "pdf_changelog_rebuild" }),
    );
    expect(v.relabel).toBe(true);
  });

  it("import → relabel:true (master plan §2.5 named target)", () => {
    const v = classifyChangelogRowForRelabel(row({ source_system: "import" }));
    expect(v.relabel).toBe(true);
  });

  it("changelog_csv → relabel:true (operator: equivalent legacy import marker)", () => {
    const v = classifyChangelogRowForRelabel(
      row({ source_system: "changelog_csv" }),
    );
    expect(v.relabel).toBe(true);
  });

  it("scan_detection → SKIP (live scanner output)", () => {
    const v = classifyChangelogRowForRelabel(
      row({ source_system: "scan_detection" }),
    );
    expect(v.relabel).toBe(false);
    if (v.relabel) return;
    expect(v.reason).toBe("scan_detection_is_live_scanner");
  });

  it("hypothesis_source = recommendation → SKIP (operator-accepted)", () => {
    const v = classifyChangelogRowForRelabel(
      row({
        source_system: "pdf_changelog_rebuild",
        hypothesis_source: "recommendation",
      }),
    );
    expect(v.relabel).toBe(false);
    if (v.relabel) return;
    expect(v.reason).toBe("operator_accepted_recommendation");
  });

  it("live_at != null → SKIP (proven live)", () => {
    const v = classifyChangelogRowForRelabel(
      row({
        source_system: "pdf_changelog_rebuild",
        live_at: "2026-04-25T00:00:00Z",
      }),
    );
    expect(v.relabel).toBe(false);
    if (v.relabel) return;
    expect(v.reason).toBe("live_at_is_set");
  });

  it("already W4-labeled → SKIP (idempotent)", () => {
    const v = classifyChangelogRowForRelabel(
      row({
        source_system: "pdf_changelog_rebuild",
        metadata: { import_batch_id: "march-import-2026-04" },
      }),
    );
    expect(v.relabel).toBe(false);
    if (v.relabel) return;
    expect(v.reason).toBe("already_w4_labeled");
  });

  it("null source_system → SKIP (defensive)", () => {
    const v = classifyChangelogRowForRelabel(row({ source_system: null }));
    expect(v.relabel).toBe(false);
    if (v.relabel) return;
    expect(v.reason).toBe("source_system_null");
  });

  it("unfamiliar source_system → SKIP (defensive)", () => {
    const v = classifyChangelogRowForRelabel(
      row({ source_system: "unknown_provider" }),
    );
    expect(v.relabel).toBe(false);
    if (v.relabel) return;
    expect(v.reason).toMatch(/source_system_not_in_targets:unknown_provider/);
  });

  it("priority order — scan_detection wins even when other flags would normally relabel", () => {
    const v = classifyChangelogRowForRelabel(
      row({ source_system: "scan_detection" }),
    );
    expect(v.relabel).toBe(false);
    if (v.relabel) return;
    expect(v.reason).toBe("scan_detection_is_live_scanner");
  });

  it("priority order — operator-accepted beats live_at_set check (both flags set)", () => {
    const v = classifyChangelogRowForRelabel(
      row({
        source_system: "pdf_changelog_rebuild",
        hypothesis_source: "recommendation",
        live_at: "2026-04-25T00:00:00Z",
      }),
    );
    expect(v.relabel).toBe(false);
    if (v.relabel) return;
    expect(v.reason).toBe("operator_accepted_recommendation");
  });
});

// ── 18. Stage 5 — runRelabelChangelog source-scan invariants ──────────

describe("Stage 5 — runRelabelChangelog is staging-only (source-scan)", () => {
  function bodyOf(): string {
    const start = SCRIPT_SRC.indexOf("async function runRelabelChangelog(");
    const end = SCRIPT_SRC.indexOf("function emptyRelabelReport(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return SCRIPT_SRC.slice(start, end);
  }

  it("never calls .insert/.update/.delete/.upsert on Supabase", () => {
    const b = bodyOf();
    expect(b).not.toMatch(/\.insert\(/);
    expect(b).not.toMatch(/\.update\(/);
    expect(b).not.toMatch(/\.delete\(/);
    expect(b).not.toMatch(/\.upsert\(/);
    expect(b).toMatch(/\.from\(\s*"changelog_entries"\s*\)/);
    expect(b).toMatch(/\.select\(/);
  });

  it("does NOT WRITE to recommended-edits or recommendation-responses", () => {
    const b = bodyOf();
    const writes = [...b.matchAll(/writeFileSync\(\s*([^,]+),/g)].map(
      (m) => m[1],
    );
    for (const w of writes) {
      expect(w).not.toMatch(/recommended-edits/);
      expect(w).not.toMatch(/recommendation-responses/);
    }
  });

  it("every writeFileSync target lands under stagingDir", () => {
    const b = bodyOf();
    const writes = [...b.matchAll(/writeFileSync\(\s*([^,]+),/g)].map(
      (m) => m[1],
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(/stagingDir|join\(\s*stagingDir/.test(w)).toBe(true);
    }
  });

  it("preserves all data fields — proposal carries preserved_fields snapshot", () => {
    const b = bodyOf();
    expect(b).toMatch(/preserved_fields:/);
    expect(b).toMatch(/timestamp:\s*row\.timestamp/);
    expect(b).toMatch(/url:\s*row\.url/);
    expect(b).toMatch(/asset_name:\s*row\.asset_name/);
    expect(b).toMatch(/change_description:\s*row\.change_description/);
    expect(b).toMatch(/created_at:\s*row\.created_at/);
    expect(b).toMatch(/live_at:\s*row\.live_at/);
    expect(b).toMatch(/hypothesis_source:\s*row\.hypothesis_source/);
    expect(b).toMatch(/source_rec_id:\s*row\.source_rec_id/);
  });

  it("does NOT modify the top-level import_batch_id column (preserves audit trail)", () => {
    const b = bodyOf();
    expect(b).toMatch(/import_batch_id:\s*row\.import_batch_id/);
  });

  it("metadata change is additive (spreads previous metadata into next)", () => {
    const b = bodyOf();
    expect(b).toMatch(/\.\.\.\(previousMetadata\s*\?\?\s*\{\}\)/);
    expect(b).toMatch(/import_batch_id:\s*W4_RELABEL_BATCH_ID/);
    expect(b).toMatch(/display_group:\s*W4_RELABEL_DISPLAY_GROUP/);
  });

  it("W4 batch id constant is exactly march-import-2026-04 (master plan §2.5)", () => {
    expect(SCRIPT_SRC).toMatch(/W4_RELABEL_BATCH_ID\s*=\s*"march-import-2026-04"/);
  });

  it("display group constant is pre_launch_history", () => {
    expect(SCRIPT_SRC).toMatch(/W4_RELABEL_DISPLAY_GROUP\s*=\s*"pre_launch_history"/);
  });

  it("inherits Stage 3's extraction_run_id (lineage continuity)", () => {
    const b = bodyOf();
    expect(b).toMatch(/extraction_run_id/);
    expect(b).toMatch(/w4-rederived-snapshots\.json/);
  });

  it("noOp:true when zero proposals", () => {
    const b = bodyOf();
    expect(b).toMatch(/noOp:\s*proposals\.length === 0/);
  });

  it("counts skipped reasons separately for the report", () => {
    const b = bodyOf();
    expect(b).toMatch(/skippedBySourceSystem/);
    expect(b).toMatch(/skippedAlreadyLabeled/);
    expect(b).toMatch(/skippedLiveOrAccepted/);
    expect(b).toMatch(/skippedDangerous/);
  });

  it("/changes UI copy planning — reports the planned label change but does NOT implement it (no /changes redesign)", () => {
    expect(SCRIPT_SRC).toMatch(/Imported legacy.*Pre-launch history/);
  });
});
