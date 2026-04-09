/**
 * Backfill script: reads .data/*.json file stores and upserts into Supabase.
 * Idempotent — safe to run multiple times (uses upsert on id).
 *
 * Usage: npx tsx scripts/backfill-to-supabase.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local ──

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      process.env[key] ??= val;
    }
  }
}

// ── Supabase client ──

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Ensure .env.local exists with the correct values.",
  );
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

// ── File reading ──

const DATA_DIR = join(process.cwd(), ".data");

function readJsonFile<T>(name: string): T[] {
  const path = join(DATA_DIR, `${name}.json`);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ── Store → table mapping ──

const STORES = [
  { file: "import-runs", table: "import_runs" },
  { file: "imported-results", table: "results" },
  { file: "imported-changes", table: "changelog_entries" },
  { file: "imported-opportunities", table: "opportunities" },
  { file: "imported-competitors", table: "competitors" },
] as const;

// ── Backfill ──

async function backfill() {
  console.log("Beacon → Supabase backfill\n");

  let totalBackfilled = 0;

  for (const { file, table } of STORES) {
    const rows = readJsonFile(file);

    if (rows.length === 0) {
      console.log(`  ${table}: 0 rows on disk — skip`);
      continue;
    }

    const { error } = await sb.from(table).upsert(rows, { onConflict: "id" });

    if (error) {
      console.error(`  ${table}: FAILED — ${error.message}`);
      process.exitCode = 1;
      continue;
    }

    const { count, error: countErr } = await sb
      .from(table)
      .select("*", { count: "exact", head: true });

    if (countErr) {
      console.log(`  ${table}: ${rows.length} upserted (count verify failed)`);
    } else {
      const match = count === rows.length ? "✓" : `⚠ expected ${rows.length}`;
      console.log(`  ${table}: ${count} rows in DB ${match}`);
    }

    totalBackfilled += rows.length;
  }

  console.log(`\nDone. ${totalBackfilled} total rows processed.`);
}

backfill().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
