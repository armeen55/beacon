/**
 * Sprint 7 Phase 7.5a + Phase 7.5b Commit 1A (2026-04-25) — one-shot .data stamping.
 *
 * Stamps `.data/pages.json`, `.data/observation-runs.json`,
 * `.data/change-outcomes.json`, and `.data/imported-results.json` with
 * `tenant_id = 'tenant-ritz-founder'` for any row missing the field
 * (Phase 7.5a) or carrying empty-string (Phase 7.5b Commit 1A). Idempotent:
 * re-running is a no-op once stamped. Atomic: temp file + rename.
 *
 * Why: file-backed tenant adapters in `src/lib/tenant-data.ts` filter via
 * `r.tenant_id === tenantId`. Without this stamping the founder query
 * returns zero rows. Phase 7.5a covered 3 files (rows missing the field);
 * Phase 7.5b Commit 1A adds the 4th (`imported-results.json` — rows with
 * empty-string `tenant_id`, same shape as the Phase 7.2 Supabase backfill).
 * After 1A, `tests/tenants/isolation.test.ts` should be fully green.
 *
 * Verification: prints before/after counts. Run from repo root:
 *   npx tsx scripts/stamp-data-files-sprint7-phase5a.ts
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

const TENANT_ID = "tenant-ritz-founder";
const FILES = [
  "pages.json",
  "observation-runs.json",
  "change-outcomes.json",
  "imported-results.json",
];

type Row = Record<string, unknown> & { tenant_id?: unknown };

function classify(rows: Row[]): {
  total: number;
  ritz: number;
  needsStamp: number;
} {
  let ritz = 0;
  let needsStamp = 0;
  for (const r of rows) {
    if (r.tenant_id === TENANT_ID) ritz += 1;
    else if (r.tenant_id == null || r.tenant_id === "") needsStamp += 1;
  }
  return { total: rows.length, ritz, needsStamp };
}

function stampFile(filename: string): void {
  const path = join(process.cwd(), ".data", filename);
  if (!existsSync(path)) {
    console.log(`[stamp] ${filename}: file not found — skipping`);
    return;
  }
  const raw = readFileSync(path, "utf8");
  const rows = JSON.parse(raw) as Row[];
  const before = classify(rows);
  console.log(
    `[stamp] ${filename} BEFORE: total=${before.total} ritz=${before.ritz} missing=${before.needsStamp}`,
  );

  if (before.needsStamp === 0) {
    console.log(`[stamp] ${filename}: nothing to stamp; idempotent no-op`);
    return;
  }

  for (const r of rows) {
    if (r.tenant_id == null || r.tenant_id === "") {
      r.tenant_id = TENANT_ID;
    }
  }

  // Atomic: write temp + rename.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(rows, null, 2), "utf8");
  renameSync(tmp, path);

  const after = classify(rows);
  console.log(
    `[stamp] ${filename} AFTER:  total=${after.total} ritz=${after.ritz} missing=${after.needsStamp}`,
  );
  if (after.needsStamp !== 0) {
    throw new Error(
      `[stamp] ${filename} failed: ${after.needsStamp} rows still missing tenant_id`,
    );
  }
}

for (const f of FILES) stampFile(f);

console.log("[stamp] done.");
