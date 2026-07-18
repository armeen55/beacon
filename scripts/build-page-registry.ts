/**
 * Build page registry + citation evidence index from existing imported data.
 *
 * Run with: npx tsx --require ./scripts/mock-server-only.cjs scripts/build-page-registry.ts
 */

import { readStore, writeStore } from "../src/lib/persistence/json-store";
import { getAllCitationDates, getCitationsForDate } from "../src/lib/persistence/cold-store";
import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { ChangelogEntry } from "../src/domains/changelog/types";
import type { TrackedEntity } from "../src/domains/tracked-entities/types";
import type { PromptAnswerObservation } from "../src/domains/prompt-answer-observations/types";
import type { CitationObservation } from "../src/domains/citation-observations/types";
import type { PageEntity, CitationEvidenceIndex } from "../src/domains/pages/types";
import { discoverPages } from "../src/domains/pages/discover";
import { buildCitationEvidenceIndex } from "../src/domains/pages/citation-index";
import { classifyAllEntries } from "../src/domains/pages/evidence-tier";
import { getSiteConfig } from "../src/lib/site-config";

async function main() {
  console.log("=== Building Page Registry ===\n");

  // Stage D2 (2026-05-09): require explicit BEACON_TENANT_ID so the
  // discovered pages carry a real tenant_id rather than empty string.
  const tenantId = process.env.BEACON_TENANT_ID;
  if (!tenantId) {
    console.error(
      "[build-page-registry] BEACON_TENANT_ID env var is required " +
        "(e.g. BEACON_TENANT_ID=tenant-ritz-founder)",
    );
    process.exit(1);
  }

  const changes = await readStore<ChangelogEntry>("imported-changes");
  const entities = await readStore<TrackedEntity>("tracked-entities");
  const promptAnswers = await readStore<PromptAnswerObservation>("prompt-answer-observations");

  console.log(`Loaded: ${changes.length} changes, ${entities.length} entities, ${promptAnswers.length} prompt answers`);

  // Load all citations from cold store
  const dates = getAllCitationDates();
  console.log(`Citation dates: ${dates.length}`);
  const allCitations: CitationObservation[] = [];
  for (const date of dates) {
    const batch = getCitationsForDate(date);
    allCitations.push(...batch);
  }
  console.log(`Total citations loaded: ${allCitations.length}`);

  // Phase 1: Discover pages
  console.log("\n--- Phase 1: Page Discovery ---");
  const ownedDomain = getSiteConfig(tenantId).siteDomain;
  const existingPages = await readStore<PageEntity>("pages");
  const pages = discoverPages({
    citations: allCitations,
    changes,
    entities,
    ownedDomain,
    tenantId,
    existingPages,
  });

  const ownedPages = pages.filter(p => p.is_owned);
  const competitorPages = pages.filter(p => p.ownership_tier === "competitor");
  const directoryPages = pages.filter(p => p.ownership_tier === "directory");
  const otherPages = pages.filter(p => !p.is_owned && p.ownership_tier !== "competitor" && p.ownership_tier !== "directory");

  console.log(`Total pages discovered: ${pages.length}`);
  console.log(`  Owned: ${ownedPages.length}`);
  console.log(`  Competitor: ${competitorPages.length}`);
  console.log(`  Directory: ${directoryPages.length}`);
  console.log(`  Other: ${otherPages.length}`);

  console.log(`\nOwned pages:`);
  for (const p of ownedPages.sort((a, b) => a.path.localeCompare(b.path))) {
    console.log(`  ${p.page_type.padEnd(18)} ${p.path.padEnd(40)} city=${p.city ?? "-"} sources=${p.discovery_sources.join(",")}`);
  }

  const byType = new Map<string, number>();
  for (const p of pages) {
    byType.set(p.page_type, (byType.get(p.page_type) ?? 0) + 1);
  }
  console.log(`\nBy page type:`);
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  await writeStore("pages", pages);
  console.log(`\nWrote ${pages.length} pages to .data/pages.json`);

  // Phase 2: Citation evidence index
  console.log("\n--- Phase 2: Citation Evidence Index ---");
  const citationIndex = buildCitationEvidenceIndex({
    citations: allCitations,
    promptAnswers,
    ownedDomain,
  });

  console.log(`Citations processed: ${citationIndex.total_citations_processed}`);
  console.log(`Page × topic rollups: ${citationIndex.by_page_and_topic.length}`);
  console.log(`Topics: ${citationIndex.by_topic.length}`);
  console.log(`Pages with topics: ${Object.keys(citationIndex.page_to_topics).length}`);

  const ownedRollups = citationIndex.by_page_and_topic.filter(r => r.is_owned);
  console.log(`\nOwned page citation rollups: ${ownedRollups.length}`);

  console.log(`\nTop 5 topics by total citations:`);
  for (const t of citationIndex.by_topic.slice(0, 5)) {
    const ownedPct = t.total_citations > 0 ? Math.round((t.owned_citations / t.total_citations) * 100) : 0;
    console.log(`  ${t.topic}`);
    console.log(`    Total: ${t.total_citations} | Owned: ${t.owned_citations} (${ownedPct}%) | Competitor: ${t.competitor_citations} | Directory: ${t.directory_citations}`);
    if (t.top_owned_pages.length > 0) {
      console.log(`    Top owned: ${t.top_owned_pages.map(p => `${p.url} (${p.count})`).join(", ")}`);
    }
  }

  const indexPath = join(process.cwd(), ".data", "citation-evidence-index.json");
  const tmpPath = indexPath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(citationIndex, null, 2), "utf-8");
  renameSync(tmpPath, indexPath);
  console.log(`\nWrote citation evidence index to .data/citation-evidence-index.json`);

  // Phase 3: Evidence tiers
  console.log("\n--- Phase 3: Evidence Tier Classification ---");
  const pageRegistry = new Map<string, PageEntity>();
  for (const p of pages) {
    pageRegistry.set(p.canonical_url, p);
  }

  const tiers = classifyAllEntries(changes, pageRegistry);

  const tierCounts: Record<string, number> = { exact: 0, probable: 0, weak: 0, inferred: 0 };
  for (const meta of tiers.values()) {
    tierCounts[meta.tier]++;
  }

  console.log(`Evidence tier distribution:`);
  for (const [tier, count] of Object.entries(tierCounts)) {
    const pct = changes.length > 0 ? Math.round((count / changes.length) * 100) : 0;
    console.log(`  ${tier}: ${count} (${pct}%)`);
  }

  console.log(`\nSample classifications:`);
  let shown = 0;
  for (const [id, meta] of tiers) {
    if (shown >= 8) break;
    const ch = changes.find(c => c.id === id);
    if (!ch) continue;
    console.log(`  [${meta.tier.toUpperCase().padEnd(8)}] ${ch.id} | ${ch.change_description?.slice(0, 60)} | url=${ch.url?.slice(0, 30) ?? "none"} | flags=${meta.flags.join(",")}`);
    shown++;
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
