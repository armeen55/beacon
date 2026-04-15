/**
 * Bootstrap script: reconstruct .data/*.json from Supabase.
 *
 * Use case: new machine, lost .data/, or disaster recovery.
 * Reads all Supabase tables and writes local files in the exact format
 * expected by json-store, dotdata-json, and cold-store.
 *
 * Usage: npx tsx scripts/bootstrap-from-supabase.ts
 *
 * Idempotent — safe to run on a machine that already has .data/ files
 * (overwrites with Supabase state).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
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

// ── File helpers ──

const DATA_DIR = join(process.cwd(), ".data");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function writeJsonFile(name: string, data: unknown): void {
  ensureDataDir();
  const path = join(DATA_DIR, `${name}.json`);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, path);
}

// ── Key transformation: snake_case DB → camelCase TS ──

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function snakeToCamelKeys(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toCamelCase(key)] = value;
  }
  return result;
}

// ── Paginated fetch (Supabase default limit is 1000) ──

const PAGE_SIZE = 1000;

async function fetchAll(
  table: string,
  orderCol = "id",
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from(table)
      .select("*")
      .order(orderCol)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error(`  ${table}: fetch failed at offset ${offset} — ${error.message}`);
      break;
    }

    if (!data || data.length === 0) break;
    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

// ── Bootstrap ──

async function bootstrap() {
  console.log("Supabase → Beacon bootstrap (full .data/ reconstruction)\n");

  let totalFiles = 0;

  // ─────────────────────────────────────────────────
  // Direct tables (snake_case in both DB and local)
  // ─────────────────────────────────────────────────

  async function directTable(
    table: string,
    localFile: string,
    orderCol = "id",
  ): Promise<void> {
    const rows = await fetchAll(table, orderCol);
    writeJsonFile(localFile, rows);
    console.log(`  ${localFile}.json ← ${table}: ${rows.length} rows`);
    totalFiles++;
  }

  console.log("Phase 1 stores:");
  await directTable("import_runs", "import-runs");
  await directTable("results", "imported-results");
  await directTable("changelog_entries", "imported-changes");
  await directTable("opportunities", "imported-opportunities");
  await directTable("competitors", "imported-competitors");

  console.log("\nPhase 1C stores:");
  await directTable("attribution_decisions", "event-decisions");
  await directTable("candidate_links", "candidate-links");

  // ─────────────────────────────────────────────────
  // Snake → camelCase tables
  // ─────────────────────────────────────────────────

  console.log("\nCamelCase-mapped stores:");

  // page_issues → page-issues.json (snake→camel)
  const pageIssueRows = await fetchAll("page_issues", "issue_id");
  writeJsonFile("page-issues", pageIssueRows.map(snakeToCamelKeys));
  console.log(`  page-issues.json ← page_issues: ${pageIssueRows.length} rows`);
  totalFiles++;

  // change_contracts → change-contracts.json (snake→camel)
  const contractRows = await fetchAll("change_contracts", "contract_id");
  writeJsonFile("change-contracts", contractRows.map(snakeToCamelKeys));
  console.log(`  change-contracts.json ← change_contracts: ${contractRows.length} rows`);
  totalFiles++;

  // scan_findings → scan-findings.json (snake→camel)
  const findingRows = await fetchAll("scan_findings", "id");
  writeJsonFile("scan-findings", findingRows.map(snakeToCamelKeys));
  console.log(`  scan-findings.json ← scan_findings: ${findingRows.length} rows`);
  totalFiles++;

  // ─────────────────────────────────────────────────
  // Large direct tables (need pagination)
  // ─────────────────────────────────────────────────

  console.log("\nLarge stores:");
  await directTable("pages", "pages");
  await directTable("daily_metric_snapshots", "daily-metric-snapshots");
  await directTable("prompt_answer_observations", "prompt-answer-observations");

  // ─────────────────────────────────────────────────
  // Observation runs — direct (already snake_case)
  // ─────────────────────────────────────────────────

  console.log("\nObservation stores:");
  const obsRows = await fetchAll("observation_runs", "run_id");
  writeJsonFile("observation-runs", obsRows);
  console.log(`  observation-runs.json ← observation_runs: ${obsRows.length} rows`);
  totalFiles++;

  // Derive scan-runs.json from website_crawl observation runs (legacy compat)
  const scanRuns = obsRows
    .filter((r) => r.run_type === "website_crawl")
    .map((r) => ({
      run_id: r.run_id,
      started_at: r.started_at,
      completed_at: r.completed_at,
      pages_scanned: r.pages_scanned ?? 0,
      pages_changed: r.pages_changed ?? 0,
      pages_with_errors: r.pages_with_errors ?? 0,
      guardrail_alerts: r.guardrail_alerts ?? 0,
      critical_count: r.critical_count ?? 0,
      regression_count: r.regression_count ?? 0,
      improvement_count: r.improvement_count ?? 0,
    }));
  writeJsonFile("scan-runs", scanRuns);
  console.log(`  scan-runs.json ← derived: ${scanRuns.length} rows`);
  totalFiles++;

  // ─────────────────────────────────────────────────
  // Page snapshots — dedup by page_id, keep latest
  // ─────────────────────────────────────────────────

  console.log("\nSnapshot stores:");

  // Fetch all snapshots ordered by fetched_at DESC for dedup
  const allSnapshots: Record<string, unknown>[] = [];
  let snapOffset = 0;
  while (true) {
    const { data, error } = await sb
      .from("page_snapshots")
      .select("*")
      .order("fetched_at", { ascending: false })
      .range(snapOffset, snapOffset + PAGE_SIZE - 1);
    if (error) {
      console.error(`  page_snapshots: fetch failed — ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    allSnapshots.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE_SIZE) break;
    snapOffset += PAGE_SIZE;
  }

  // Dedup: keep first occurrence per page_id (already ordered DESC)
  const seenPageIds = new Set<string>();
  const latestSnapshots: Record<string, unknown>[] = [];
  for (const snap of allSnapshots) {
    const pageId = snap.page_id as string;
    if (!seenPageIds.has(pageId)) {
      seenPageIds.add(pageId);
      latestSnapshots.push(snap);
    }
  }
  writeJsonFile("page-snapshots", latestSnapshots);
  console.log(
    `  page-snapshots.json ← page_snapshots: ${latestSnapshots.length} latest (${allSnapshots.length} total in DB)`,
  );
  totalFiles++;

  // Guardrail alerts — strip auto-increment id, write as-is
  const { data: alertData, error: alertErr } = await sb
    .from("guardrail_alerts")
    .select("*");
  if (alertErr) {
    console.error(`  guardrail_alerts: fetch failed — ${alertErr.message}`);
  }
  const alerts = (alertData ?? []).map(
    ({ id: _id, ...rest }: Record<string, unknown> & { id?: unknown }) => rest,
  );
  writeJsonFile("page-guardrails", alerts);
  console.log(`  page-guardrails.json ← guardrail_alerts: ${alerts.length} rows`);
  totalFiles++;

  // ─────────────────────────────────────────────────
  // Singleton blob stores
  // ─────────────────────────────────────────────────

  console.log("\nSingleton stores:");

  // citation_evidence_index
  const { data: citData } = await sb
    .from("citation_evidence_index")
    .select("*")
    .eq("id", "current")
    .maybeSingle();
  if (citData) {
    const citIndex = {
      built_at: citData.built_at,
      total_citations_processed: citData.total_citations_processed,
      by_page_and_topic: citData.by_page_and_topic,
      by_topic: citData.by_topic,
      page_to_topics: citData.page_to_topics,
    };
    writeJsonFile("citation-evidence-index", citIndex);
    console.log("  citation-evidence-index.json ← 1 document");
    totalFiles++;
  } else {
    console.log("  citation-evidence-index: no data in Supabase — skip");
  }

  // answer_intelligence_index
  const { data: aiData } = await sb
    .from("answer_intelligence_index")
    .select("*")
    .eq("id", "current")
    .maybeSingle();
  if (aiData?.data) {
    writeJsonFile("answer-intelligence-index", aiData.data);
    console.log("  answer-intelligence-index.json ← 1 document");
    totalFiles++;
  } else {
    console.log("  answer-intelligence-index: no data in Supabase — skip");
  }

  // business_config
  const { data: bizData } = await sb
    .from("business_config")
    .select("*")
    .eq("id", "current")
    .maybeSingle();
  if (bizData?.data) {
    writeJsonFile("business-config", bizData.data);
    console.log("  business-config.json ← 1 document");
    totalFiles++;
  } else {
    console.log("  business-config: no data in Supabase — skip");
  }

  // competitor_config → competitor-universe.json (wrap in {competitors: [...]})
  const configRows = await fetchAll("competitor_config", "id");
  writeJsonFile("competitor-universe", { competitors: configRows });
  console.log(`  competitor-universe.json ← competitor_config: ${configRows.length} entries`);
  totalFiles++;

  // ─────────────────────────────────────────────────
  // Phase 10 stores
  // ─────────────────────────────────────────────────

  console.log("\nPhase 10 stores:");
  await directTable("tracked_prompts", "tracked-prompts");
  await directTable("tracked_entities", "tracked-entities");

  // answer_texts → answer-texts.json (rows → {observation_id: body} map)
  console.log("  answer_texts: fetching (may be large)...");
  const answerRows = await fetchAll("answer_texts", "observation_id");
  const answerMap: Record<string, string> = {};
  for (const row of answerRows) {
    answerMap[row.observation_id as string] = row.body as string;
  }
  // answer-texts.json is written compact (no pretty-print) to match cold-store format
  ensureDataDir();
  const atPath = join(DATA_DIR, "answer-texts.json");
  const atTmp = atPath + ".tmp";
  writeFileSync(atTmp, JSON.stringify(answerMap), "utf-8");
  renameSync(atTmp, atPath);
  console.log(`  answer-texts.json ← answer_texts: ${answerRows.length} entries`);
  totalFiles++;

  // ─────────────────────────────────────────────────
  // Phase 11 stores
  // ─────────────────────────────────────────────────

  console.log("\nPhase 11 stores:");
  await directTable("change_outcomes", "change-outcomes");
  await directTable("page_visibility", "page-visibility");

  console.log("\nPhase 12 stores:");
  await directTable("change_patterns", "change-patterns");
  await directTable("triage_rules", "triage-rules");

  // confidence_calibration: singleton
  const { data: calData } = await sb
    .from("confidence_calibration")
    .select("*")
    .eq("id", "current")
    .maybeSingle();
  if (calData) {
    writeJsonFile("confidence-calibration", [calData]);
    console.log("  confidence-calibration.json <- 1 document");
    totalFiles++;
  } else {
    console.log("  confidence-calibration: no data in Supabase -- skip");
  }

  // ─────────────────────────────────────────────────
  // Empty defaults for supplementary stores (no tables)
  // These prevent crashes when json-store or dotdata-json read them.
  // ─────────────────────────────────────────────────

  console.log("\nSupplementary defaults (empty):");
  const emptyArrayFiles = [
    "outcome-events",
    "candidate-causes",
    "rollout-executions",
    "pattern-evidence",
    "rollout-waves",
    "frontier-opportunities",
    "frontier-attack-packages",
    "tracked-missing-pages",
    "asset-responses",
    "outcome-observations",
    "competitor-page-evidence",
    "source-pattern-evidence",
    "action-states",
    "brief-states",
    "truth-labels",
    "exit-gates",
    "local-reviews",
    "experiments",
    "recommendation-responses",
    "page-snapshot-diffs",
    "render-checks",
    "visibility-observation-runs",
    "prompt-library",
    "outcome-store",
  ];

  for (const name of emptyArrayFiles) {
    const path = join(DATA_DIR, `${name}.json`);
    if (!existsSync(path)) {
      writeJsonFile(name, []);
      totalFiles++;
    }
  }
  console.log(`  Created ${emptyArrayFiles.length} empty-array defaults (skipped existing)`);

  // Ephemeral state files — empty objects
  const emptyObjectFiles = ["milestone-state"];
  for (const name of emptyObjectFiles) {
    const path = join(DATA_DIR, `${name}.json`);
    if (!existsSync(path)) {
      writeJsonFile(name, {});
      totalFiles++;
    }
  }

  console.log(`\n✓ Bootstrap complete. ${totalFiles} files written to .data/`);
}

bootstrap().catch((e) => {
  console.error("Bootstrap failed:", e);
  process.exit(1);
});
