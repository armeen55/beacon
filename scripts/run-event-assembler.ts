/**
 * Phase 0 Day 3 — Event assembler dry run.
 *
 * Loads:
 *   - `.data/imported-changes.json` (active + tenant-matching rows)
 *   - all `.data/citations-by-date/*.json` shards → first-citation-date per
 *     owned URL
 *
 * Writes:
 *   - `.data/change-events.json`
 *
 * Prints:
 *   - Coverage line (N assigned of M active rows)
 *   - Breakdown by scope / event_type
 *   - Compound-launch detail for `/luxury-home-builder-bay-area`
 *   - Sitewide rollout summary
 *
 * Usage:
 *   npx tsx scripts/run-event-assembler.ts
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { assembleEvents, pathOnly } from "../src/domains/events/assembler";
import type { ChangelogRow } from "../src/domains/events/assembler";
import type { ChangeEvent } from "../src/domains/events/types";
import type { RawCitation } from "../src/domains/truth/data-quality";

const DATA_DIR = join(process.cwd(), ".data");
const SHARD_DIR = join(DATA_DIR, "citations-by-date");
const CHANGELOG_PATH = join(DATA_DIR, "imported-changes.json");
const OUT_PATH = join(DATA_DIR, "change-events.json");

const TENANT_ID = "tenant-ritz-founder";
const OWNED_DOMAIN = "ritzbuilders.com";

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

type ImportedChange = {
  id: string;
  timestamp: string;
  url: string | null;
  change_description: string;
  asset_type?: string | null;
  tenant_id: string;
  archived?: boolean;
};

function loadChangelog(): ChangelogRow[] {
  const raw = JSON.parse(readFileSync(CHANGELOG_PATH, "utf8")) as ImportedChange[];
  return raw
    .filter((r) => !r.archived && r.tenant_id === TENANT_ID)
    .map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      url: r.url,
      change_description: r.change_description,
      asset_type: r.asset_type ?? null,
      tenant_id: r.tenant_id,
    }));
}

function loadFirstCitationDates(): Record<string, string> {
  const byUrl: Record<string, string> = {};
  const files = readdirSync(SHARD_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files.sort()) {
    const date = file.replace(/\.json$/, "");
    const rows = JSON.parse(readFileSync(join(SHARD_DIR, file), "utf8")) as RawCitation[];
    for (const r of rows) {
      if (r.domain !== OWNED_DOMAIN) continue;
      const normalized = pathOnly(
        (r as unknown as { url?: string }).url ?? null,
      );
      if (!normalized) continue;
      if (!byUrl[normalized]) byUrl[normalized] = date;
    }
  }
  return byUrl;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const changelog = loadChangelog();
  const firstCitationDateByUrl = loadFirstCitationDates();

  const events = assembleEvents({
    changelog,
    firstCitationDateByUrl,
    tenant_id: TENANT_ID,
  });

  writeFileSync(OUT_PATH, JSON.stringify(events, null, 2) + "\n", "utf8");

  // ------------------------------------------------------------------
  // Coverage invariant check
  // ------------------------------------------------------------------
  const assigned = new Set<string>();
  let double = 0;
  for (const e of events) {
    for (const c of e.child_change_ids) {
      if (assigned.has(c)) double += 1;
      assigned.add(c);
    }
  }
  const orphan = changelog.filter((r) => !assigned.has(r.id)).length;

  console.log(`Active changelog rows: ${changelog.length}`);
  console.log(
    `coverage: ${assigned.size} of ${changelog.length} active changelog rows assigned, ${orphan} orphan, ${double} double-assign`,
  );
  console.log("");

  // ------------------------------------------------------------------
  // Scope / event_type breakdown
  // ------------------------------------------------------------------
  const byScope: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const e of events) {
    byScope[e.scope] = (byScope[e.scope] ?? 0) + 1;
    byType[e.event_type] = (byType[e.event_type] ?? 0) + 1;
  }
  console.log(`Total events: ${events.length}`);
  console.log("By scope:", byScope);
  console.log("By event_type:", byType);
  console.log("");

  // ------------------------------------------------------------------
  // Compound launch detail: /luxury-home-builder-bay-area
  // ------------------------------------------------------------------
  const lux = events.find(
    (e) =>
      e.scope === "compound_launch" &&
      e.created_url === "/luxury-home-builder-bay-area",
  );
  console.log("Compound launch — /luxury-home-builder-bay-area:");
  if (lux) {
    console.log(`  id: ${lux.id}`);
    console.log(`  label: ${lux.label}`);
    console.log(`  started_at: ${lux.started_at}  ended_at: ${lux.ended_at}`);
    console.log(`  children: ${lux.child_change_ids.length}`);
  } else {
    console.log("  NOT FOUND");
    process.exitCode = 1;
  }
  console.log("");

  // ------------------------------------------------------------------
  // Sitewide rollout summary
  // ------------------------------------------------------------------
  const sitewide = events.filter((e) => e.scope === "sitewide_rollout");
  console.log(`Sitewide rollouts: ${sitewide.length}`);
  for (const e of sitewide) {
    const urlsLabel = e.target_urls === null ? "sitewide" : `${e.target_urls.length} URLs`;
    console.log(
      `  [${e.event_type.padEnd(22)}] ${e.started_at} → ${e.ended_at}  ${String(e.child_change_ids.length).padStart(3)} children  ${urlsLabel}`,
    );
  }
  console.log("");

  // ------------------------------------------------------------------
  // Acceptance self-check
  // ------------------------------------------------------------------
  const coverageOk = orphan === 0 && double === 0 && assigned.size === changelog.length;
  const luxOk = lux != null;

  if (coverageOk && luxOk) {
    console.log("✓ Day 3 acceptance: coverage invariant satisfied + compound launch detected.");
  } else {
    console.log("✗ Day 3 acceptance FAILED");
    process.exitCode = 1;
  }

  console.log(`Wrote ${events.length} event(s) to ${OUT_PATH}`);
}

main();
