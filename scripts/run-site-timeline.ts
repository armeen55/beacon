/**
 * Phase 0 Day 2 — Site citation timeline + movement detector dry run.
 *
 * Loads:
 *   - all `.data/citations-by-date/*.json` shards
 *   - `.data/data-quality-flags.json` (produced by Day 1's dry run)
 *
 * Writes:
 *   - `.data/site-citation-timeline.json` — one dense series
 *   - `.data/site-movement-events.json`   — detected movement events
 *
 * Prints a ranked table to stdout so we can visually confirm the four
 * target spike days (Mar 10, Mar 13, Mar 26, Apr 13) appear within ±1
 * day of a detected movement window.
 *
 * Usage:
 *   npx tsx scripts/run-site-timeline.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  buildSiteCitationTimeline,
  detectSiteMovements,
  rankMovementsByMagnitude,
} from "../src/domains/truth/site-citation-timeline";
import type { RawCitation } from "../src/domains/truth/data-quality";
import type { DataQualityFlag } from "../src/domains/events/types";

const DATA_DIR = join(process.cwd(), ".data");
const SHARD_DIR = join(DATA_DIR, "citations-by-date");
const FLAGS_PATH = join(DATA_DIR, "data-quality-flags.json");
const TIMELINE_PATH = join(DATA_DIR, "site-citation-timeline.json");
const EVENTS_PATH = join(DATA_DIR, "site-movement-events.json");

const TENANT_ID = "tenant-ritz-founder";
const OWNED_DOMAIN = "ritzbuilders.com";
const TARGETS = ["2026-03-10", "2026-03-13", "2026-03-26", "2026-04-13"];
const TOLERANCE_MS = 24 * 60 * 60 * 1000;

function loadShards(): Record<string, RawCitation[]> {
  const out: Record<string, RawCitation[]> = {};
  const files = readdirSync(SHARD_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files.sort()) {
    const date = file.replace(/\.json$/, "");
    out[date] = JSON.parse(
      readFileSync(join(SHARD_DIR, file), "utf8"),
    ) as RawCitation[];
  }
  return out;
}

function loadFlags(): DataQualityFlag[] {
  if (!existsSync(FLAGS_PATH)) return [];
  return JSON.parse(readFileSync(FLAGS_PATH, "utf8")) as DataQualityFlag[];
}

function withinTolerance(a: string, b: string): boolean {
  return Math.abs(Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) <= TOLERANCE_MS;
}

function main() {
  const citationsByDate = loadShards();
  const dataQualityFlags = loadFlags();

  const timeline = buildSiteCitationTimeline({
    tenant_id: TENANT_ID,
    domain: OWNED_DOMAIN,
    citationsByDate,
    dataQualityFlags,
  });

  const events = detectSiteMovements(timeline);
  const ranked = rankMovementsByMagnitude(events);

  writeFileSync(TIMELINE_PATH, JSON.stringify(timeline, null, 2) + "\n", "utf8");
  writeFileSync(EVENTS_PATH, JSON.stringify(events, null, 2) + "\n", "utf8");

  // ---------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------
  console.log(`Site timeline — domain=${OWNED_DOMAIN} tenant=${TENANT_ID}`);
  console.log(`Days: ${timeline.days.length}`);
  console.log(`Data-bad days: ${timeline.days.filter((d) => d.is_data_bad).length}`);
  console.log("");

  console.log(`Detected movement events: ${events.length}`);
  console.log("");
  console.log("rank  date         prev  →  curr   Δ_abs    Δ_pct    trigger                        target match?");
  console.log("----  -----------  ----  --  ----  -------  -------  -----------------------------  -------------");
  ranked.forEach((e, i) => {
    const matched = TARGETS.find((t) => withinTolerance(e.date, t));
    const match = matched ? `${matched} (±${Math.abs((Date.parse(e.date + "T00:00:00Z") - Date.parse(matched + "T00:00:00Z")) / (24 * 3600 * 1000))}d)` : "";
    const pctStr = `${(e.delta_pct * 100).toFixed(0)}%`;
    console.log(
      `${String(i + 1).padStart(4)}  ${e.date}  ${String(e.prev_count).padStart(4)}  →  ${String(e.count).padStart(4)}  ${String(e.delta_abs).padStart(+7)}  ${pctStr.padStart(7)}  ${e.trigger.padEnd(29)}  ${match}`,
    );
  });

  // ---------------------------------------------------------------------
  // Acceptance self-check
  // ---------------------------------------------------------------------
  console.log("");
  const missing: string[] = [];
  for (const target of TARGETS) {
    const hit = events.some((e) => withinTolerance(e.date, target));
    if (!hit) missing.push(target);
  }
  if (missing.length === 0) {
    console.log("✓ Day 2 acceptance: All 4 target spikes (Mar 10, Mar 13, Mar 26, Apr 13) matched ±1 day.");
  } else {
    console.log(`✗ Day 2 acceptance FAILED — missing targets: ${missing.join(", ")}`);
    process.exitCode = 1;
  }

  console.log(`Wrote timeline to ${TIMELINE_PATH}`);
  console.log(`Wrote ${events.length} movement event(s) to ${EVENTS_PATH}`);
}

main();
