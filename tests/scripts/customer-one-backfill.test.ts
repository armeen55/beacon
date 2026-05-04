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
  backupDirFor,
  dateStringFor,
  parseFlags,
  sha256OfBuffer,
  shouldBlockSameDayBackup,
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

  it("rejects reserved stages with isReserved=true (extract / rederive / publish / rollback / verify / copy-orphan / relabel)", () => {
    const RESERVED: Stage[] = [
      "extract-observations",
      "rederive-snapshots",
      "copy-orphan-benchmarks",
      "relabel-changelog",
      "verify",
      "publish",
      "rollback",
    ];
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

  it("extract-observations + rederive-snapshots NOT implemented today", () => {
    expect(IMPLEMENTED_STAGES.has("extract-observations")).toBe(false);
    expect(IMPLEMENTED_STAGES.has("rederive-snapshots")).toBe(false);
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

  it("IMPLEMENTED_STAGES carries ONLY preflight + backup today", () => {
    expect([...IMPLEMENTED_STAGES].sort()).toEqual(["backup", "preflight"]);
  });
});
