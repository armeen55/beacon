#!/usr/bin/env node
/**
 * Seed a single tenant's REAL .data into a fresh Supabase project.
 *
 * Why this exists (and why it is NOT scripts/backfill-to-supabase.ts): the
 * generic backfill reads the legacy GLOBAL `.data/*.json` layout and never
 * covers `recommended_edits`. The real per-tenant data lives in
 * `.data/tenants/<slug>/` and the recs are the whole point. This reads the
 * tenant-scoped dir directly and upserts only the four stores that carry real
 * content for Iranopedia today: tenants, business_config, recommended_edits,
 * page_snapshots. Pure DATA-PLANE (supabase-js upsert) — no DDL, no service
 * other than the rows. Idempotent (upsert on PK).
 *
 * Usage:
 *   BEACON_TENANT_ID=tenant-iranopedia BEACON_TENANT_SLUG=iranopedia \
 *     node scripts/seed-tenant-to-supabase.mjs
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
 * (same pattern as backfill). The service_role key bypasses RLS for the seed.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- load .env.local (do not overwrite already-set shell vars) ---
try {
  const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) {
      const val = m[2].replace(/^["']|["']$/g, "");
      process.env[m[1]] ??= val;
    }
  }
} catch {
  /* no .env.local */
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TENANT_ID = process.env.BEACON_TENANT_ID || "tenant-iranopedia";
const SLUG = process.env.BEACON_TENANT_SLUG || "iranopedia";

if (!URL || !KEY) {
  console.error("ERROR: need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!KEY.startsWith("eyJ")) {
  console.error(
    `ERROR: SUPABASE_SERVICE_ROLE_KEY does not look like a JWT (got "${KEY.slice(0, 6)}…"). ` +
      "Seeding bypasses RLS and needs the secret/service_role key, not a publishable or PAT token.",
  );
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const TDIR = join(ROOT, ".data", "tenants", SLUG);
const GDIR = join(ROOT, ".data", "global");

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`  ! parse error ${path}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function upsert(table, rows, onConflict) {
  if (!rows || rows.length === 0) {
    console.log(`  ${table}: 0 rows — skip`);
    return;
  }
  // chunk to keep payloads sane (page_snapshots is large)
  const CHUNK = 200;
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await sb.from(table).upsert(slice, { onConflict });
    if (error) {
      console.error(`  ✖ ${table} chunk @${i}: ${error.message}`);
      process.exit(1);
    }
    done += slice.length;
  }
  console.log(`  ✓ ${table}: ${done} rows`);
}

const NOW = new Date().toISOString();

console.log(`Seeding ${SLUG} (${TENANT_ID}) → ${URL}\n`);

// 1) tenants — both rows from the global registry (drop `features`: no column)
const tenants = (readJson(join(GDIR, "tenants.json")) || []).map((t) => {
  const { features, ...rest } = t;
  // publish_target is NOT NULL with a CHECK in (wix_cms, git_pr, dev_note).
  // The founder (Ritz) ships via the dev-note export; default missing values to it.
  if (!rest.publish_target) rest.publish_target = "dev_note";
  return rest;
});
await upsert("tenants", tenants, "id");

// 2) business_config — per-tenant row keyed by tenant id (see syncTenantBusinessConfig)
const cfg = readJson(join(TDIR, "business-config.json"));
if (cfg) {
  await upsert("business_config", [{ id: TENANT_ID, data: cfg, updated_at: NOW }], "id");
} else {
  console.log("  business_config: no file — skip");
}

// 3) recommended_edits — already snake_case, columns match the table
const recs = readJson(join(TDIR, "recommended-edits.json")) || [];
await upsert("recommended_edits", recs, "id");

// 4) page_snapshots — already snake_case, columns match the table
const snaps = readJson(join(TDIR, "page-snapshots.json")) || [];
await upsert("page_snapshots", snaps, "id");

console.log("\n✓ Seed complete.");
