/**
 * Competitor Sitemap Crawler CLI — fetches sitemaps, detects changes, stores state.
 *
 * Run with:
 *   npx tsx scripts/crawl-competitor-sitemaps.ts
 *
 * Flags:
 *   --dry-run     Show what would be crawled without fetching
 */

// Allow self-signed / intermediate cert issues
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { crawlAllCompetitors } from "../src/domains/competitor-monitoring/sitemap-crawler";
import { detectCompetitorChanges, generateCompetitorAlerts } from "../src/domains/competitor-monitoring/detect-changes";
import type { CompetitorMonitoringState } from "../src/domains/competitor-monitoring/types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR = join(process.cwd(), ".data");
const STORE_FILE = join(DATA_DIR, "competitor-monitoring.json");

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");

// ---------------------------------------------------------------------------
// Load competitor universe
// ---------------------------------------------------------------------------

function loadCompetitors(): { domain: string; displayName: string }[] {
  const universeFile = join(DATA_DIR, "competitor-universe.json");
  if (!existsSync(universeFile)) {
    console.error("❌ No competitor-universe.json found. Configure competitors first.");
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(universeFile, "utf-8"));
  const entries = raw.competitors ?? raw.entries ?? raw;
  if (!Array.isArray(entries)) {
    console.error("❌ Invalid competitor-universe.json format.");
    process.exit(1);
  }

  return entries
    .filter((e: { status?: string }) => e.status === "active")
    .map((e: { domain: string; display_name: string }) => ({
      domain: e.domain,
      displayName: e.display_name,
    }));
}

// ---------------------------------------------------------------------------
// Load previous state
// ---------------------------------------------------------------------------

function loadState(): CompetitorMonitoringState {
  if (!existsSync(STORE_FILE)) {
    return { lastCrawlAt: null, snapshots: [], recentChanges: [] };
  }
  try {
    return JSON.parse(readFileSync(STORE_FILE, "utf-8"));
  } catch {
    return { lastCrawlAt: null, snapshots: [], recentChanges: [] };
  }
}

function saveState(state: CompetitorMonitoringState): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(STORE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const competitors = loadCompetitors();
  console.log(`\n🔍 Competitor Sitemap Crawler`);
  console.log(`   Competitors: ${competitors.length}`);
  console.log(`   Dry run: ${isDryRun}\n`);

  if (competitors.length === 0) {
    console.log("No active competitors configured. Exiting.");
    return;
  }

  for (const c of competitors) {
    console.log(`   • ${c.displayName} (${c.domain})`);
  }

  if (isDryRun) {
    console.log("\n🏁 Dry run — no sitemaps fetched.");
    return;
  }

  const previousState = loadState();
  const previousSnapshots = previousState.snapshots;

  console.log(`\n📡 Crawling sitemaps...`);
  const currentSnapshots = await crawlAllCompetitors(competitors);

  for (const snap of currentSnapshots) {
    if (snap.error) {
      console.log(`   ⚠ ${snap.displayName}: ${snap.error}`);
    } else {
      console.log(`   ✅ ${snap.displayName}: ${snap.pageCount} pages`);
    }
  }

  // Detect changes
  const changes = detectCompetitorChanges(currentSnapshots, previousSnapshots);
  console.log(`\n📊 Changes detected: ${changes.length}`);

  if (changes.length > 0) {
    const added = changes.filter((c) => c.type === "added");
    const removed = changes.filter((c) => c.type === "removed");
    const updated = changes.filter((c) => c.type === "updated");

    if (added.length > 0) console.log(`   + ${added.length} new pages`);
    if (removed.length > 0) console.log(`   - ${removed.length} removed pages`);
    if (updated.length > 0) console.log(`   ~ ${updated.length} updated pages`);

    // Show top changes
    const alerts = generateCompetitorAlerts(changes);
    if (alerts.length > 0) {
      console.log(`\n🚨 Alerts:`);
      for (const alert of alerts.slice(0, 10)) {
        console.log(`   ${alert.headline}`);
        console.log(`     ${alert.detail}\n`);
      }
    }
  }

  // Save state
  const newState: CompetitorMonitoringState = {
    lastCrawlAt: new Date().toISOString(),
    snapshots: currentSnapshots,
    recentChanges: changes,
  };
  saveState(newState);
  console.log(`\n✅ State saved to ${STORE_FILE}`);
  console.log(`🏁 Done.\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
