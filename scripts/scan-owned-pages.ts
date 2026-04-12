/**
 * Page Scanner v1 — sitemap-first owned page scanning.
 *
 * Uses the live sitemap.xml as the canonical source of truth for owned pages.
 * Reconciles sitemap URLs against the page registry to separate canonical
 * current-site pages from stale legacy-domain entries.
 *
 * Run with:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/scan-owned-pages.ts
 *
 * Flags:
 *   --dry-run     Show what would be scanned without fetching
 *   --limit=N     Scan only first N pages
 *   --url=<url>   Scan a single URL only
 *   --skip-fetch-sitemap   Use cached sitemap reconciliation instead of re-fetching
 */

import { readStore } from "../src/lib/persistence/json-store";
import { extractPageSnapshot } from "../src/domains/pages/extractor";
import { diffSnapshots } from "../src/domains/pages/snapshot-diff";
import { classifyGuardrails, type GuardrailAlert, type ScanRunMeta } from "../src/domains/pages/guardrails";
import type { ObservationRun } from "../src/domains/observations/types";
import { OBSERVATION_RUN_PARSER_VERSION } from "../src/domains/observations/types";
import { checkTopPages, type RenderCheckResult } from "../src/domains/pages/render-check";
import type { PageEntity, PageSnapshot, PageSnapshotDiff } from "../src/domains/pages/types";
import { writeFileSync, renameSync, existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { getSiteConfig } from "../src/lib/site-config";
import { observationUniverseFieldsForCli } from "../src/domains/competitors/universe-fields-cli";
import type { CompetitorUniverseFile } from "../src/domains/competitors/universe-schema";
import {
  writeLastScanResultFile,
  type LastScanResultPayload,
} from "../src/domains/scanning/last-scan-result";

const DATA_DIR = join(process.cwd(), ".data");
const { siteOrigin, siteDomain: CANONICAL_DOMAIN } = getSiteConfig();
const SITEMAP_URL = `${siteOrigin.replace(/\/+$/, "")}/sitemap.xml`;

// ── Types ──

type CanonicalPage = {
  url: string;
  path: string;
  registry_page_id: string | null;
  scan_page_id: string;
  sitemap_lastmod: string | null;
};

type StalePage = {
  url: string;
  path: string;
  domain: string;
  registry_page_id: string;
  reason: "stale_domain" | "not_in_sitemap" | "unscannable_url";
};

type SitemapReconciliation = {
  fetched_at: string;
  sitemap_domain: string;
  sitemap_url_count: number;
  canonical_pages: CanonicalPage[];
  stale_pages: StalePage[];
  registry_matched: number;
  sitemap_only: number;
};

// ── Sitemap fetcher ──

async function fetchSitemap(): Promise<{ url: string; lastmod: string | null }[]> {
  const res = await fetch(SITEMAP_URL, {
    headers: { "User-Agent": "BeaconScanner/1.0" },
  });
  if (!res.ok) throw new Error(`Sitemap fetch failed: ${res.status}`);
  const xml = await res.text();

  const entries: { url: string; lastmod: string | null }[] = [];
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
    const modMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/);
    if (locMatch) {
      entries.push({
        url: locMatch[1].replace(/\/+$/, ""),
        lastmod: modMatch ? modMatch[1] : null,
      });
    }
  }
  return entries;
}

// ── URL normalization ──

function normalizeUrl(raw: string): string {
  return raw.replace(/\/+$/, "").toLowerCase();
}

// ── Fetch with timeout ──

async function fetchPage(
  url: string,
  timeoutMs: number = 15000
): Promise<{ html: string; status: number } | { error: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BeaconScanner/1.0; +https://beacon.app)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      return { error: `Non-HTML content-type: ${contentType}`, status: res.status };
    }
    const html = await res.text();
    return { html, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// ── Persistence ──

function loadPreviousSnapshots(): PageSnapshot[] {
  const path = join(DATA_DIR, "page-snapshots.json");
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PageSnapshot[];
  } catch {
    return [];
  }
}

function saveSnapshots(snapshots: PageSnapshot[]): void {
  const path = join(DATA_DIR, "page-snapshots.json");
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(snapshots, null, 2), "utf8");
  renameSync(tmp, path);
}

function saveDiffs(diffs: PageSnapshotDiff[]): void {
  const path = join(DATA_DIR, "page-snapshot-diffs.json");
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(diffs, null, 2), "utf8");
  renameSync(tmp, path);
}

function saveGuardrails(alerts: GuardrailAlert[]): void {
  const path = join(DATA_DIR, "page-guardrails.json");
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(alerts, null, 2), "utf8");
  renameSync(tmp, path);
}

function appendScanRun(meta: ScanRunMeta): void {
  const path = join(DATA_DIR, "scan-runs.json");
  let runs: ScanRunMeta[] = [];
  if (existsSync(path)) {
    try { runs = JSON.parse(readFileSync(path, "utf8")) as ScanRunMeta[]; } catch {}
  }
  runs.push(meta);
  if (runs.length > 50) runs = runs.slice(-50);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(runs, null, 2), "utf8");
  renameSync(tmp, path);
}

function loadLastRunId(): string | null {
  const obsPath = join(DATA_DIR, "observation-runs.json");
  if (existsSync(obsPath)) {
    try {
      const list = JSON.parse(readFileSync(obsPath, "utf8")) as ObservationRun[];
      for (let i = list.length - 1; i >= 0; i--) {
        const r = list[i];
        if (r?.run_id && r.run_type === "website_crawl") return r.run_id;
      }
    } catch {}
  }
  const scanPath = join(DATA_DIR, "scan-runs.json");
  if (existsSync(scanPath)) {
    try {
      const list = JSON.parse(readFileSync(scanPath, "utf8")) as ScanRunMeta[];
      const last = list[list.length - 1];
      if (last?.run_id) return last.run_id;
    } catch {}
  }
  return null;
}

function appendObservationRun(run: ObservationRun): void {
  const path = join(DATA_DIR, "observation-runs.json");
  let runs: ObservationRun[] = [];
  if (existsSync(path)) {
    try { runs = JSON.parse(readFileSync(path, "utf8")) as ObservationRun[]; } catch {}
  }
  runs.push(run);
  if (runs.length > 50) runs = runs.slice(-50);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(runs, null, 2), "utf8");
  renameSync(tmp, path);
}

function archivePreviousSnapshots(): void {
  const current = join(DATA_DIR, "page-snapshots.json");
  const prev = join(DATA_DIR, "page-snapshots-prev.json");
  if (existsSync(current)) {
    try { copyFileSync(current, prev); } catch {}
  }
}

function saveReconciliation(recon: SitemapReconciliation): void {
  const path = join(DATA_DIR, "sitemap-reconciliation.json");
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(recon, null, 2), "utf8");
  renameSync(tmp, path);
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
  const urlArg = args.find((a) => a.startsWith("--url="));
  const singleUrl = urlArg ? urlArg.split("=").slice(1).join("=") : null;

  console.log("=== Page Scanner v1 (Sitemap-First) ===\n");

  // ── Step 1: Fetch sitemap ──
  console.log(`Fetching sitemap from ${SITEMAP_URL}...`);
  let sitemapEntries: { url: string; lastmod: string | null }[];
  try {
    sitemapEntries = await fetchSitemap();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeLastScanResultFile({
      schemaVersion: 1,
      finishedAt: new Date().toISOString(),
      exit: "failed",
      trigger: "cli",
      observationRunId: null,
      pagesScanned: 0,
      pagesChanged: 0,
      pagesWithErrors: 0,
      guardrailAlertCount: 0,
      cliError: msg,
    });
    throw e;
  }
  console.log(`Sitemap URLs: ${sitemapEntries.length}`);

  // ── Step 2: Load registry ──
  const allPages = readStore<PageEntity>("pages");
  const ownedPages = allPages.filter((p) => p.is_owned);
  console.log(`Registry owned pages: ${ownedPages.length}`);

  // ── Step 3: Reconcile ──
  console.log("\n--- Reconciliation ---\n");

  const registryByUrl = new Map<string, PageEntity>();
  for (const p of ownedPages) {
    registryByUrl.set(normalizeUrl(p.url), p);
  }

  const canonical: CanonicalPage[] = [];
  let smIdx = 0;
  for (const entry of sitemapEntries) {
    smIdx++;
    const normUrl = normalizeUrl(entry.url);
    const registryPage = registryByUrl.get(normUrl);

    canonical.push({
      url: entry.url,
      path: new URL(entry.url).pathname.replace(/\/+$/, "") || "/",
      registry_page_id: registryPage?.id ?? null,
      scan_page_id: registryPage?.id ?? `sm-${smIdx}`,
      sitemap_lastmod: entry.lastmod,
    });

    if (registryPage) {
      registryByUrl.delete(normUrl);
    }
  }

  const stale: StalePage[] = [];
  for (const [, p] of registryByUrl) {
    const isLegacy = p.domain !== CANONICAL_DOMAIN;
    stale.push({
      url: p.url,
      path: p.path,
      domain: p.domain,
      registry_page_id: p.id,
      reason: isLegacy ? "stale_domain" : "not_in_sitemap",
    });
  }

  const registryMatched = canonical.filter((c) => c.registry_page_id).length;
  const sitemapOnly = canonical.length - registryMatched;

  console.log(`Canonical sitemap pages:    ${canonical.length}`);
  console.log(`  Matched to registry:      ${registryMatched}`);
  console.log(`  Sitemap-only (new to Beacon): ${sitemapOnly}`);
  console.log(`Stale/legacy registry pages: ${stale.length}`);
  const staleDomain = stale.filter((s) => s.reason === "stale_domain").length;
  const staleNotSitemap = stale.filter((s) => s.reason === "not_in_sitemap").length;
  if (staleDomain > 0) console.log(`  Stale domain (rfritz.com): ${staleDomain}`);
  if (staleNotSitemap > 0) console.log(`  Not in sitemap:            ${staleNotSitemap}`);

  // Save reconciliation
  const reconciliation: SitemapReconciliation = {
    fetched_at: new Date().toISOString(),
    sitemap_domain: CANONICAL_DOMAIN,
    sitemap_url_count: sitemapEntries.length,
    canonical_pages: canonical,
    stale_pages: stale,
    registry_matched: registryMatched,
    sitemap_only: sitemapOnly,
  };
  saveReconciliation(reconciliation);
  console.log(`\nWrote reconciliation to .data/sitemap-reconciliation.json`);

  // ── Step 4: Determine scan set ──
  let scanSet = canonical;
  if (singleUrl) {
    scanSet = canonical.filter((c) => normalizeUrl(c.url) === normalizeUrl(singleUrl));
    if (scanSet.length === 0) {
      console.log(`\nNo canonical page matches URL: ${singleUrl}`);
      writeLastScanResultFile({
        schemaVersion: 1,
        finishedAt: new Date().toISOString(),
        exit: "aborted",
        trigger: "cli",
        observationRunId: null,
        pagesScanned: 0,
        pagesChanged: 0,
        pagesWithErrors: 0,
        guardrailAlertCount: 0,
        abortedReason: `No canonical page matches URL: ${singleUrl}`,
      });
      return;
    }
  }
  scanSet = scanSet.slice(0, limit);

  if (dryRun) {
    console.log("\n[DRY RUN] Would scan:");
    for (const c of scanSet) {
      const tag = c.registry_page_id ? "registry" : "sitemap-only";
      console.log(`  ${c.url}  [${tag}]`);
    }
    console.log("\nStale pages (would NOT scan):");
    for (const s of stale) {
      console.log(`  ${s.url}  [${s.reason}]`);
    }
    writeLastScanResultFile({
      schemaVersion: 1,
      finishedAt: new Date().toISOString(),
      exit: "success",
      trigger: "cli",
      observationRunId: null,
      pagesScanned: 0,
      pagesChanged: 0,
      pagesWithErrors: 0,
      guardrailAlertCount: 0,
      dryRun: true,
    });
    return;
  }

  // ── Step 5: Scan canonical pages ──
  console.log(`\n--- Scanning ${scanSet.length} canonical pages ---\n`);

  const previousSnapshots = loadPreviousSnapshots();
  const prevByPageId = new Map<string, PageSnapshot>();
  const prevByUrl = new Map<string, PageSnapshot>();
  for (const snap of previousSnapshots) {
    prevByPageId.set(snap.page_id, snap);
    prevByUrl.set(normalizeUrl(snap.url), snap);
  }
  console.log(`Previous snapshots loaded: ${previousSnapshots.length}`);

  const newSnapshots: PageSnapshot[] = [];
  const diffs: PageSnapshotDiff[] = [];
  const errors: { url: string; error: string }[] = [];
  let scanned = 0;

  const observationRunId = `obs-${Date.now()}`;
  const baselineRunId = loadLastRunId();

  for (const page of scanSet) {
    scanned++;
    process.stdout.write(
      `\r  Scanning ${scanned}/${scanSet.length}: ${page.url.slice(0, 60).padEnd(60)}`
    );

    const result = await fetchPage(page.url);

    if ("error" in result) {
      errors.push({ url: page.url, error: result.error });
      continue;
    }

    const snapshot = extractPageSnapshot(
      result.html,
      page.url,
      page.scan_page_id,
      result.status
    );
    newSnapshots.push({ ...snapshot, observation_run_id: observationRunId });

    const prev = prevByPageId.get(page.scan_page_id) ?? prevByUrl.get(normalizeUrl(page.url));
    if (prev) {
      diffs.push(diffSnapshots(snapshot, prev));
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("\n");

  // ── Step 6: Classify guardrails (load citation counts for context) ──
  let citationsByUrl = new Map<string, number>();
  try {
    const ciPath = join(DATA_DIR, "citation-evidence-index.json");
    if (existsSync(ciPath)) {
      const ci = JSON.parse(readFileSync(ciPath, "utf8"));
      for (const r of ci.by_page_and_topic ?? []) {
        if (r.is_owned) {
          const normUrl = r.page_url.replace(/\/+$/, "").toLowerCase();
          citationsByUrl.set(normUrl, (citationsByUrl.get(normUrl) ?? 0) + r.total_citations);
        }
      }
    }
  } catch {}

  const allAlerts: GuardrailAlert[] = [];
  for (const snap of newSnapshots) {
    const diff = diffs.find((d) => d.page_id === snap.page_id) ?? null;
    const normUrl = snap.url.replace(/\/+$/, "").toLowerCase();
    const citCount = citationsByUrl.get(normUrl) ?? 0;
    const alerts = classifyGuardrails(snap, diff, citCount);
    allAlerts.push(...alerts);
  }

  // ── Step 6b: Render verification on top citation pages ──
  const skipRender = args.includes("--skip-render");
  let renderResults: RenderCheckResult[] = [];

  if (!skipRender && newSnapshots.length > 0) {
    console.log("--- Render Verification (top citation pages) ---\n");
    try {
      renderResults = await checkTopPages(newSnapshots, citationsByUrl, 5);
      for (const r of renderResults) {
        if (r.error) {
          console.log(`  ${r.url.padEnd(55)} SKIP: ${r.error}`);
        } else if (r.render_ok) {
          console.log(`  ${r.url.padEnd(55)} ✓ render matches raw`);
        } else {
          console.log(`  ${r.url.padEnd(55)} ✗ MISMATCH:`);
          for (const m of r.mismatches) {
            console.log(`      ${m.field}: raw="${m.raw}" → rendered="${m.rendered}"`);
          }
          allAlerts.push({
            page_id: r.page_id,
            url: r.url,
            severity: "warning",
            category: "render_mismatch",
            message: `Render mismatch: ${r.mismatches.map((m) => m.field).join(", ")}`,
            detail: r.mismatches
              .map((m) => `${m.field}: raw="${m.raw}" vs rendered="${m.rendered}"`)
              .join("; "),
          });
        }
      }
      console.log();
    } catch (err) {
      console.log(`  Render check skipped: ${err instanceof Error ? err.message : err}\n`);
    }
  }

  // ── Step 7: Save ──
  archivePreviousSnapshots();
  saveSnapshots(newSnapshots);
  console.log(`Wrote ${newSnapshots.length} snapshots to .data/page-snapshots.json`);

  if (diffs.length > 0) {
    saveDiffs(diffs);
    console.log(`Wrote ${diffs.length} diffs to .data/page-snapshot-diffs.json`);
  }

  const alertsStamped: GuardrailAlert[] = allAlerts.map((a) => ({
    ...a,
    observation_run_id: observationRunId,
  }));
  saveGuardrails(alertsStamped);
  console.log(`Wrote ${alertsStamped.length} guardrail alerts to .data/page-guardrails.json`);

  if (renderResults.length > 0) {
    const renderPath = join(DATA_DIR, "render-checks.json");
    const renderTmp = renderPath + ".tmp";
    writeFileSync(renderTmp, JSON.stringify(renderResults, null, 2), "utf8");
    renameSync(renderTmp, renderPath);
    console.log(`Wrote ${renderResults.length} render checks to .data/render-checks.json`);
  }

  const completedAt = new Date().toISOString();
  const startedAt = new Date(Date.now() - 30000).toISOString();

  const scanRun: ScanRunMeta = {
    run_id: observationRunId,
    started_at: startedAt,
    completed_at: completedAt,
    pages_scanned: newSnapshots.length,
    pages_changed: diffs.filter((d) => d.changed).length,
    pages_with_errors: errors.length,
    guardrail_alerts: alertsStamped.length,
    critical_count: alertsStamped.filter((a) => a.severity === "critical").length,
    regression_count: alertsStamped.filter((a) => a.severity === "regression").length,
    improvement_count: alertsStamped.filter((a) => a.severity === "improvement").length,
  };
  appendScanRun(scanRun);

  const universePath = join(DATA_DIR, "competitor-universe.json");
  let universeRaw: CompetitorUniverseFile | null = null;
  if (existsSync(universePath)) {
    try {
      universeRaw = JSON.parse(
        readFileSync(universePath, "utf8")
      ) as CompetitorUniverseFile;
    } catch {
      universeRaw = null;
    }
  }
  const cliUniversePin = observationUniverseFieldsForCli(universeRaw);

  const observationRun: ObservationRun = {
    ...scanRun,
    run_type: "website_crawl",
    source: "scan-owned-pages.ts",
    status: errors.length > 0 && newSnapshots.length === 0 ? "failed" : errors.length > 0 ? "partial" : "completed",
    scope_label: `Sitemap canonical scan · ${newSnapshots.length} page(s) fetched${singleUrl ? " (single URL)" : ""}${limit !== Infinity ? ` · limit ${limit}` : ""}`,
    parser_version: OBSERVATION_RUN_PARSER_VERSION,
    baseline_run_id: baselineRunId,
    ...cliUniversePin,
  };
  appendObservationRun(observationRun);
  console.log(`Appended observation run to .data/observation-runs.json (${observationRunId})`);
  console.log(`Appended scan run to .data/scan-runs.json (same run_id for compat)`);

  // ── Step 8: Report ──
  console.log("\n--- Scan Summary ---\n");
  console.log(`Canonical sitemap pages: ${canonical.length}`);
  console.log(`Scanned successfully:    ${newSnapshots.length}`);
  console.log(`Errors:                  ${errors.length}`);
  if (diffs.length > 0) {
    const changed = diffs.filter((d) => d.changed).length;
    console.log(`Diffs computed:          ${diffs.length} (${changed} changed, ${diffs.length - changed} unchanged)`);
  }

  const withFaq = newSnapshots.filter((s) => s.faqs.length > 0);
  const withSchema = newSnapshots.filter((s) => s.schema_types.length > 0);
  const withCanonicalMismatch = newSnapshots.filter((s) => s.has_canonical_mismatch);
  const withNoIndex = newSnapshots.filter(
    (s) => s.robots_meta && s.robots_meta.toLowerCase().includes("noindex")
  );
  const weakStructure = newSnapshots.filter(
    (s) => s.faqs.length === 0 && s.schema_types.length === 0
  );

  console.log(`\n--- Structure Quality (canonical pages only) ---\n`);
  console.log(`FAQ present:       ${withFaq.length}/${newSnapshots.length}`);
  console.log(`Schema present:    ${withSchema.length}/${newSnapshots.length}`);
  console.log(`Weak structure:    ${weakStructure.length} (no FAQ + no schema)`);
  console.log(`Canonical issues:  ${withCanonicalMismatch.length}`);
  console.log(`noindex detected:  ${withNoIndex.length}`);

  console.log(`\n--- Per-Page Detail ---\n`);
  for (const snap of newSnapshots) {
    const faqLabel = snap.faqs.length > 0 ? `${snap.faqs.length} FAQs` : "no FAQ";
    const schemaLabel =
      snap.schema_types.length > 0 ? snap.schema_types.join(", ") : "no schema";
    const flags: string[] = [];
    if (snap.has_canonical_mismatch) flags.push("CANONICAL_MISMATCH");
    if (snap.robots_meta?.toLowerCase().includes("noindex")) flags.push("NOINDEX");

    const diff = diffs.find((d) => d.page_id === snap.page_id);
    const diffLabel = diff
      ? diff.changed
        ? `CHANGED: ${diff.summary}`
        : "unchanged"
      : "first scan";

    const tag = canonical.find((c) => normalizeUrl(c.url) === normalizeUrl(snap.url))?.registry_page_id
      ? ""
      : " [NEW]";

    console.log(
      `  ${snap.url.padEnd(62)} ${snap.word_count.toString().padStart(5)} words | ${faqLabel.padEnd(8)} | ${schemaLabel.padEnd(30)} | ${snap.internal_link_count} int / ${snap.external_link_count} ext | ${diffLabel}${flags.length > 0 ? " | " + flags.join(", ") : ""}${tag}`
    );
  }

  if (errors.length > 0) {
    console.log(`\n--- Errors ---\n`);
    for (const e of errors) {
      console.log(`  ${e.url}: ${e.error}`);
    }
  }

  // ── Guardrails ──
  if (allAlerts.length > 0) {
    console.log(`\n--- Guardrail Alerts (${allAlerts.length}) ---\n`);
    const bySeverity = new Map<string, GuardrailAlert[]>();
    for (const a of allAlerts) {
      if (!bySeverity.has(a.severity)) bySeverity.set(a.severity, []);
      bySeverity.get(a.severity)!.push(a);
    }
    for (const sev of ["critical", "regression", "warning", "improvement", "info"]) {
      const group = bySeverity.get(sev);
      if (!group) continue;
      console.log(`  ${sev.toUpperCase()} (${group.length}):`);
      for (const a of group) {
        console.log(`    ${a.url.padEnd(55)} ${a.message}`);
      }
    }
  }

  console.log(`\n--- Stale Registry Pages (quarantined, not scanned) ---\n`);
  for (const s of stale) {
    console.log(`  ${s.url.padEnd(62)} [${s.reason}]`);
  }

  const scanExit: LastScanResultPayload["exit"] =
    errors.length > 0 && newSnapshots.length === 0
      ? "failed"
      : errors.length > 0
        ? "partial"
        : "success";

  writeLastScanResultFile({
    schemaVersion: 1,
    finishedAt: completedAt,
    exit: scanExit,
    trigger: "cli",
    observationRunId: observationRunId,
    pagesScanned: newSnapshots.length,
    pagesChanged: diffs.filter((d) => d.changed).length,
    pagesWithErrors: errors.length,
    guardrailAlertCount: alertsStamped.length,
    fetchErrors: errors.length > 0 ? errors : undefined,
  });

  console.log("\n=== Done ===");
}

main().catch((e) => {
  console.error(e);
  try {
    writeLastScanResultFile({
      schemaVersion: 1,
      finishedAt: new Date().toISOString(),
      exit: "failed",
      trigger: "cli",
      observationRunId: null,
      pagesScanned: 0,
      pagesChanged: 0,
      pagesWithErrors: 0,
      guardrailAlertCount: 0,
      cliError: e instanceof Error ? e.message : String(e),
    });
  } catch {
    /* ignore secondary write failure */
  }
});
