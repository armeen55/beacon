/**
 * Phase 0 Day 1 — Data-quality dry run.
 *
 * Loads all citation shards from `.data/citations-by-date/*.json`, runs the
 * `detectDataQualityFlags` gate against Ritz's owned domain, and writes the
 * result to `.data/data-quality-flags.json`. Also prints a summary table to
 * stdout so we can visually confirm the expected Apr 7–12 flags (and nothing
 * else) are present.
 *
 * Writes directly with `fs` to bypass the `"server-only"` guard in the
 * shared json-store module.
 *
 * Usage:
 *   npx tsx scripts/run-data-quality.ts
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  detectDataQualityFlags,
  type RawCitation,
} from "../src/domains/truth/data-quality";
import type { DataQualityFlag } from "../src/domains/events/types";

const DATA_DIR = join(process.cwd(), ".data");
const SHARD_DIR = join(DATA_DIR, "citations-by-date");
const OUT_PATH = join(DATA_DIR, "data-quality-flags.json");
const OWNED_DOMAIN = "ritzbuilders.com";

function loadShards(): Record<string, RawCitation[]> {
  const out: Record<string, RawCitation[]> = {};
  const files = readdirSync(SHARD_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files.sort()) {
    const date = file.replace(/\.json$/, "");
    const raw = readFileSync(join(SHARD_DIR, file), "utf8");
    const rows = JSON.parse(raw) as RawCitation[];
    out[date] = rows;
  }
  return out;
}

function main() {
  const shards = loadShards();
  const dates = Object.keys(shards).sort();

  const flags = detectDataQualityFlags({
    citationsByDate: shards,
    ownedDomain: OWNED_DOMAIN,
  });

  writeFileSync(OUT_PATH, JSON.stringify(flags, null, 2) + "\n", "utf8");

  // ---------------------------------------------------------------------
  // Human-readable summary
  // ---------------------------------------------------------------------
  console.log(`Data-quality gate — domain=${OWNED_DOMAIN}`);
  console.log(
    `Shards scanned: ${dates.length} (${dates[0]} → ${dates[dates.length - 1]})`,
  );
  console.log(`Flagged days: ${flags.length}`);
  console.log("");

  console.log(
    "date         source_category=owned    is_owned=true    flagged?",
  );
  console.log(
    "-----------  ----------------------   ---------------  --------",
  );
  const flagged = new Set(flags.map((f) => f.date));
  for (const date of dates) {
    const rows = shards[date] ?? [];
    const byCategory = rows.filter(
      (r) => r.domain === OWNED_DOMAIN && r.source_category === "owned",
    ).length;
    const byFlag = rows.filter(
      (r) => r.domain === OWNED_DOMAIN && r.is_owned === true,
    ).length;
    const mark = flagged.has(date) ? "FLAG" : "";
    console.log(
      `${date}  ${String(byCategory).padStart(22)}   ${String(byFlag).padStart(15)}  ${mark}`,
    );
  }

  console.log("");
  console.log(`Wrote ${flags.length} flag(s) to ${OUT_PATH}`);

  // ---------------------------------------------------------------------
  // Acceptance self-check (matches the Day-1 plan acceptance)
  // ---------------------------------------------------------------------
  const expected = [
    "2026-04-07",
    "2026-04-08",
    "2026-04-09",
    "2026-04-10",
    "2026-04-11",
    "2026-04-12",
  ];
  const got = flags.map((f) => f.date).sort();
  const missing = expected.filter((d) => !got.includes(d));
  const unexpected = got.filter((d) => !expected.includes(d));

  if (missing.length === 0 && unexpected.length === 0) {
    console.log("✓ Day 1 acceptance: Apr 7–12 flagged and nothing else.");
  } else {
    console.log("✗ Day 1 acceptance FAILED");
    if (missing.length) console.log(`  missing: ${missing.join(", ")}`);
    if (unexpected.length) console.log(`  unexpected: ${unexpected.join(", ")}`);
    process.exitCode = 1;
  }
}

main();
