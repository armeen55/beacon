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

function readJsonFile<T>(name: string): T | null {
  const path = join(DATA_DIR, `${name}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function readJsonArray(name: string): Record<string, unknown>[] {
  const data = readJsonFile<Record<string, unknown>[]>(name);
  return Array.isArray(data) ? data : [];
}

// ── Key transformation for camelCase TS → snake_case DB ──

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function transformKeys(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toSnakeCase(key)] = value;
  }
  return result;
}

// ── Upsert helper ──

async function upsertRows(
  table: string,
  rows: Record<string, unknown>[],
  conflictCol: string,
): Promise<number> {
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows on disk — skip`);
    return 0;
  }

  const BATCH = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await sb
      .from(table)
      .upsert(batch, { onConflict: conflictCol });
    if (error) {
      console.error(`  ${table}: FAILED batch ${i}–${i + batch.length}: ${error.message}`);
      process.exitCode = 1;
      return inserted;
    }
    inserted += batch.length;
  }

  const { count } = await sb
    .from(table)
    .select("*", { count: "exact", head: true });

  const match = count === rows.length ? "✓" : `(DB has ${count})`;
  console.log(`  ${table}: ${rows.length} upserted ${match}`);
  return inserted;
}

async function insertRows(
  table: string,
  rows: Record<string, unknown>[],
): Promise<number> {
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows on disk — skip`);
    return 0;
  }

  await sb.from(table).delete().neq("id", -1);

  const BATCH = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await sb.from(table).insert(batch);
    if (error) {
      console.error(`  ${table}: FAILED batch ${i}–${i + batch.length}: ${error.message}`);
      process.exitCode = 1;
      return inserted;
    }
    inserted += batch.length;
  }

  const { count } = await sb
    .from(table)
    .select("*", { count: "exact", head: true });

  console.log(`  ${table}: ${inserted} inserted (${count} in DB)`);
  return inserted;
}

// ── Backfill ──

async function backfill() {
  console.log("Beacon → Supabase backfill (full)\n");

  let total = 0;

  // ── Phase 1A/B stores (snake_case, direct upsert) ──
  console.log("Phase 1 stores:");
  total += await upsertRows("import_runs", readJsonArray("import-runs"), "id");
  total += await upsertRows("results", readJsonArray("imported-results"), "id");
  total += await upsertRows(
    "changelog_entries",
    readJsonArray("imported-changes"),
    "id",
  );
  total += await upsertRows(
    "opportunities",
    readJsonArray("imported-opportunities"),
    "id",
  );
  total += await upsertRows(
    "competitors",
    readJsonArray("imported-competitors"),
    "id",
  );

  // ── Phase 1C stores (snake_case, direct upsert) ──
  console.log("\nPhase 1C stores:");

  total += await upsertRows(
    "attribution_decisions",
    readJsonArray("event-decisions"),
    "id",
  );

  total += await upsertRows(
    "candidate_links",
    readJsonArray("candidate-links"),
    "id",
  );

  // page_issues: camelCase → snake_case
  total += await upsertRows(
    "page_issues",
    readJsonArray("page-issues").map(transformKeys),
    "issue_id",
  );

  // change_contracts: camelCase → snake_case
  total += await upsertRows(
    "change_contracts",
    readJsonArray("change-contracts").map(transformKeys),
    "contract_id",
  );

  // pages: snake_case, direct
  total += await upsertRows("pages", readJsonArray("pages"), "id");

  // page_snapshots: snake_case, direct (dotdata format = raw JSON array)
  const snapshots = readJsonFile<Record<string, unknown>[]>("page-snapshots");
  if (Array.isArray(snapshots)) {
    total += await upsertRows("page_snapshots", snapshots, "id");
  } else {
    console.log("  page_snapshots: not an array or missing — skip");
  }

  // guardrail_alerts: no natural PK, use delete+insert
  const alerts = readJsonFile<Record<string, unknown>[]>("page-guardrails");
  if (Array.isArray(alerts) && alerts.length > 0) {
    total += await insertRows("guardrail_alerts", alerts);
  } else {
    console.log("  guardrail_alerts: 0 rows or missing — skip");
  }

  // citation_evidence_index: single document
  const citIndex = readJsonFile<Record<string, unknown>>(
    "citation-evidence-index",
  );
  if (citIndex && typeof citIndex === "object" && !Array.isArray(citIndex)) {
    const row = {
      id: "current",
      built_at: citIndex.built_at ?? new Date().toISOString(),
      total_citations_processed: citIndex.total_citations_processed ?? 0,
      by_page_and_topic: citIndex.by_page_and_topic ?? [],
      by_topic: citIndex.by_topic ?? [],
      page_to_topics: citIndex.page_to_topics ?? {},
    };
    const { error } = await sb
      .from("citation_evidence_index")
      .upsert(row, { onConflict: "id" });
    if (error) {
      console.error(`  citation_evidence_index: FAILED — ${error.message}`);
    } else {
      console.log("  citation_evidence_index: 1 document upserted ✓");
      total += 1;
    }
  } else {
    console.log("  citation_evidence_index: missing or invalid — skip");
  }

  // observation_runs: .data/observation-runs.json is mixed (ProfoundImportRun +
  // website ObservationRun). This script does not bulk-upsert that file; it only
  // pushes visibility-observation-runs.json when present. Website crawl rows are
  // aligned via Phase 3C merge + dual-write / manual ops — see master_execution_plan.
  const visRuns = readJsonFile<Record<string, unknown>[]>(
    "visibility-observation-runs",
  );

  if (Array.isArray(visRuns) && visRuns.length > 0) {
    const mapped = visRuns.map((r) => ({ ...r, run_id: r.run_id ?? r.id }));
    total += await upsertRows("observation_runs", mapped, "run_id");
  } else {
    console.log("  observation_runs: no visibility runs on disk — skip");
  }

  // competitor_config: v2 file has {competitors: [...]} wrapper
  const universe = readJsonFile<unknown>("competitor-universe");
  let configEntries: Record<string, unknown>[] = [];

  if (Array.isArray(universe)) {
    configEntries = universe;
  } else if (universe && typeof universe === "object") {
    const u = universe as Record<string, unknown>;
    const candidates = u.competitors ?? u.entries;
    if (Array.isArray(candidates)) {
      configEntries = candidates as Record<string, unknown>[];
    }
  }

  if (configEntries.length > 0) {
    total += await upsertRows("competitor_config", configEntries, "id");
  } else {
    console.log("  competitor_config: 0 entries — skip");
  }

  // ── Phase 10 stores ──
  console.log("\nPhase 10 stores:");

  // tracked_prompts: snake_case, direct
  total += await upsertRows("tracked_prompts", readJsonArray("tracked-prompts"), "id");

  // tracked_entities: snake_case, direct
  total += await upsertRows("tracked_entities", readJsonArray("tracked-entities"), "id");

  // answer_texts: local format is { observation_id: text_body } map
  const answerTextsRaw = readJsonFile<Record<string, string>>("answer-texts");
  if (answerTextsRaw && typeof answerTextsRaw === "object" && !Array.isArray(answerTextsRaw)) {
    const entries = Object.entries(answerTextsRaw);
    console.log(`  answer_texts: ${entries.length} entries on disk — upserting...`);
    const rows = entries.map(([observation_id, body]) => ({ observation_id, body }));
    const BATCH = 500;
    let answerInserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await sb
        .from("answer_texts")
        .upsert(batch, { onConflict: "observation_id" });
      if (error) {
        console.error(`  answer_texts: FAILED batch ${i}–${i + batch.length}: ${error.message}`);
        process.exitCode = 1;
        break;
      }
      answerInserted += batch.length;
    }
    const { count } = await sb
      .from("answer_texts")
      .select("*", { count: "exact", head: true });
    console.log(`  answer_texts: ${answerInserted} upserted (${count} in DB)`);
    total += answerInserted;
  } else {
    console.log("  answer_texts: missing or invalid — skip");
  }

  console.log(`\nDone. ${total} total rows processed.`);
}

backfill().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
