#!/usr/bin/env node
/**
 * Apply Beacon's SQL migrations to a Supabase project via the Management API.
 *
 * Why this exists: the MCP needs SQL inline (heavy on the agent's context) and
 * `pg`/`postgres` aren't installed. This reads the migration files at RUNTIME
 * (never through the agent's context) and POSTs each to the Management API, so a
 * fresh project can be schema-provisioned in one command with full per-file
 * logging.
 *
 * Auth: a Supabase Personal Access Token (Account → Access Tokens → Generate),
 * read from env — never logged, never hardcoded. Same pattern as the existing
 * backfill script reading SUPABASE_SERVICE_ROLE_KEY from env.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-migrations-mgmt-api.mjs <project-ref>
 *   (or set BEACON_TARGET_PROJECT_REF; defaults to the arg)
 * It also reads SUPABASE_ACCESS_TOKEN from .env.local if present.
 *
 * Order: the 2026-05-08 baseline first, then every post-baseline migration in
 * filename order. Pre-baseline files (already inside the baseline) and any
 * file beginning with "_" are skipped. Idempotent enough for a fresh DB
 * (CREATE TABLE IF NOT EXISTS throughout); re-running on a populated DB may
 * error on non-idempotent statements — intended for a FRESH project.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(ROOT, "migrations");
const BASELINE = "2026-05-08_baseline_schema.sql";

function loadEnvLocalToken() {
  // Prefer a DEDICATED migrate token so we never pick up a read-scoped
  // SUPABASE_ACCESS_TOKEN that may be in the shell env (that one 403s on the
  // migration endpoint). .env.local wins over the shell env on purpose.
  try {
    const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
    // Dedicated token vars first; then ANY var holding an sbp_ Personal Access
    // Token (the operator may have pasted the PAT into the service_role slot —
    // a PAT, not a DB key, is what the Management API needs).
    for (const key of ["SUPABASE_MGMT_TOKEN", "SUPABASE_ACCESS_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"]) {
      for (const line of raw.split("\n")) {
        const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`));
        if (m) {
          const val = m[1].replace(/^["']|["']$/g, "");
          if (val.startsWith("sbp_")) return val; // a real PAT
        }
      }
    }
  } catch {
    /* no .env.local */
  }
  return null;
}

// .env.local (dedicated token) FIRST, then a dedicated shell var, then the
// generic shell token (last — it may be the read-scoped one).
const token =
  loadEnvLocalToken() ||
  process.env.SUPABASE_MGMT_TOKEN ||
  process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.BEACON_TARGET_PROJECT_REF || process.argv[2];

if (!token) {
  console.error(
    "ERROR: no SUPABASE_ACCESS_TOKEN. Create one at Supabase → Account →\n" +
      "Access Tokens → Generate, then add to .env.local:\n" +
      "  SUPABASE_ACCESS_TOKEN=sbp_xxxxx\n",
  );
  process.exit(1);
}
if (!ref) {
  console.error("ERROR: pass the project ref as arg 1 or set BEACON_TARGET_PROJECT_REF.");
  process.exit(1);
}

// Build the apply list: baseline first, then everything sorted AFTER it.
const all = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql") && !f.startsWith("_"))
  .sort();
const baselineIdx = all.indexOf(BASELINE);
if (baselineIdx < 0) {
  console.error(`ERROR: baseline ${BASELINE} not found in migrations/.`);
  process.exit(1);
}
const toApply = all.slice(baselineIdx); // baseline + all post-baseline, in order

const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/query`;

async function runSql(name, sql) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 400)}`);
  }
  return res.json().catch(() => ({}));
}

console.log(
  `Applying ${toApply.length} migrations to project ${ref} (baseline-first)…\n`,
);
let ok = 0;
for (const name of toApply) {
  const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
  process.stdout.write(`  • ${name} … `);
  try {
    await runSql(name, sql);
    ok += 1;
    console.log("OK");
  } catch (e) {
    console.log("FAILED");
    console.error(`\n✖ ${name} failed:\n${e instanceof Error ? e.message : String(e)}\n`);
    console.error(`Applied ${ok}/${toApply.length} before the failure. Fix + re-run (it resumes cleanly on a fresh DB via IF NOT EXISTS, or comment out the applied ones).`);
    process.exit(1);
  }
}
console.log(`\n✓ All ${ok} migrations applied to ${ref}.`);
