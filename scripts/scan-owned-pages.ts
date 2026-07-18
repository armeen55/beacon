/**
 * Page Scanner v1 — sitemap-first owned page scanning.
 *
 * Uses the live sitemap.xml as the canonical source of truth for owned pages.
 * Reconciles sitemap URLs against the page registry to separate canonical
 * current-site pages from stale legacy-domain entries.
 *
 * Run with (same flags as `orchestrate-scan.ts`):
 *   npx tsx --require ./scripts/mock-server-only.cjs --require ./scripts/apply-scan-site-domain.cjs scripts/scan-owned-pages.ts
 *
 * Flags:
 *   --dry-run     Show what would be scanned without fetching
 *   --limit=N     Scan only first N pages
 *   --url=<url>   Scan a single URL only
 *   --skip-fetch-sitemap   Use cached sitemap reconciliation instead of re-fetching
 */

// Allow self-signed / intermediate cert issues in scanner context
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { readStore } from "../src/lib/persistence/json-store";
import { extractPageSnapshot } from "../src/domains/pages/extractor";
import {
  buildPageElementRows,
  type PageElementInventoryRow,
} from "../src/domains/pages/extractors/persist";
import { diffSnapshots } from "../src/domains/pages/snapshot-diff";
import { classifyGuardrails, type GuardrailAlert, type ScanRunMeta } from "../src/domains/pages/guardrails";
import type { ObservationRun } from "../src/domains/observations/types";
import { OBSERVATION_RUN_PARSER_VERSION } from "../src/domains/observations/types";
import { checkTopPages, type RenderCheckResult } from "../src/domains/pages/render-check";
import type { PageEntity, PageSnapshot, PageSnapshotDiff } from "../src/domains/pages/types";
import { writeFileSync, renameSync, existsSync, readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getSiteConfig } from "../src/lib/site-config";
import { observationUniverseFieldsForCli } from "../src/domains/competitors/universe-fields-cli";
import type { CompetitorUniverseFile } from "../src/domains/competitors/universe-schema";
import {
  writeLastScanResultFile,
  type LastScanResultPayload,
} from "../src/domains/scanning/last-scan-result";
import { writeIdleScanStateFromLastResult } from "../src/domains/scanning/scan-state";
import { currentTenantId } from "../src/lib/tenant-context";
import {
  mergeLatestCanonicalInventory,
  mergeLatestCanonicalSnapshots,
  pageFetchRejectionReason,
} from "../src/domains/scanning/scan-persistence";

// Root .data dir — only used for un-classified outputs / legacy fall-through.
const DATA_DIR = join(process.cwd(), ".data");

// 2026-04-28 tenant-routing fix.
// Sprint 7.8c (2026-04-26) classified per-tenant scan stores
// (page-snapshots, page-element-inventory, etc.) so the runtime reads
// from `.data/tenants/{slug}/...`. The CLI was never updated alongside
// and continued writing to the root `.data/...` paths, producing a
// split-brain where the scan succeeded but the lifecycle runner read
// the (stale) tenant file. This block resolves the tenant slug ONCE
// at module load and exports per-classification dir helpers used by
// every saveX/loadX function below.
//
// Fail-loud: tenant-scoped writes/reads REQUIRE BEACON_TENANT_SLUG.
// We default-resolve here so the dir paths can be `const`s used
// everywhere; if the env var is missing, the helper throws on first
// access (not at module load — see `requireTenantDir`).
const TENANT_SLUG = process.env.BEACON_TENANT_SLUG?.trim() || null;

/** Resolve the per-tenant data directory. Throws fail-loud when
 *  BEACON_TENANT_SLUG is not set — preferable to silently writing
 *  tenant data to the wrong location (the bug Sprint 7.8c surfaced). */
function requireTenantDir(): string {
  if (!TENANT_SLUG) {
    throw new Error(
      "[scan] BEACON_TENANT_SLUG is required for tenant-scoped scan outputs. " +
        "Per Sprint 7.8c (2026-04-26), page-snapshots / page-element-inventory / " +
        "page-snapshot-diffs / scan-runs / observation-runs / page-guardrails / " +
        "render-checks / page-snapshots-prev all live under .data/tenants/{slug}/. " +
        "Set BEACON_TENANT_SLUG in .env.local or pass via env to the CLI.",
    );
  }
  const dir = join(DATA_DIR, "tenants", TENANT_SLUG);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve the cross-tenant global data directory.
 *  business-config and citation-evidence-index examples live here. */
function globalDir(): string {
  const dir = join(DATA_DIR, "global");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Keeps `.data/scan-state.json` aligned with the CLI outcome (Today polls this file). */
function syncScanStateAfterResult(payload: LastScanResultPayload): void {
  try {
    writeIdleScanStateFromLastResult("cli", payload);
  } catch (err) {
    console.warn("[scan] scan-state sync failed:", err instanceof Error ? err.message : String(err));
  }
}
const { siteOrigin, siteDomain: CANONICAL_DOMAIN } = getSiteConfig(
  process.env.BEACON_TENANT_ID,
);
const SITEMAP_URL = `${siteOrigin.replace(/\/+$/, "")}/sitemap.xml`;

function formatErrorWithCause(e: unknown): string {
  if (!(e instanceof Error)) return String(e).slice(0, 2000);
  const parts = [e.message];
  const c = e.cause;
  if (c instanceof Error && c.message) parts.push(c.message);
  else if (typeof c === "object" && c !== null && "code" in c) {
    parts.push(String((c as { code?: unknown }).code));
  }
  return parts.filter(Boolean).join(" — ").slice(0, 2000);
}

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
//
// Handles BOTH sitemap shapes (2026-06-10, P0 wall 2):
//   • flat <urlset> (Ritz) — parsed directly;
//   • <sitemapindex> (Wix sites like Iranopedia) — recurses ONE level
//     into child sitemaps (capped at MAX_CHILD_SITEMAPS) and merges
//     their <url> entries.
// Parsing lives in src/domains/scanning/sitemap-parse.ts (pure, tested).

// Night-shift hardening (2026-06-11): retry-with-backoff. A single
// transient upstream hiccup (caught live: ritzbuilders.com served HTTP
// 415 for one minute on 2026-06-10) used to kill the ENTIRE nightly
// scan — sitemap fetch was one-shot.
const SITEMAP_RETRY_DELAYS_MS = [5_000, 15_000];

async function fetchSitemapXml(url: string): Promise<string | null> {
  for (let attempt = 0; attempt <= SITEMAP_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "BeaconScanner/1.0" },
      });
      if (res.ok) return res.text();
      console.warn(
        `[scan] Sitemap ${url} → HTTP ${res.status} (attempt ${attempt + 1}/${SITEMAP_RETRY_DELAYS_MS.length + 1})`,
      );
    } catch (err) {
      console.warn(
        `[scan] Sitemap ${url} fetch error (attempt ${attempt + 1}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const delay = SITEMAP_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await new Promise((r) => setTimeout(r, delay));
  }
  return null;
}

async function fetchSitemap(): Promise<{ url: string; lastmod: string | null }[]> {
  const { parseSitemapUrlEntries, parseSitemapIndexLocs, dedupeSitemapEntries } =
    await import("../src/domains/scanning/sitemap-parse");
  const origin = siteOrigin.replace(/\/+$/, "");
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ];
  let lastError = "";

  for (const url of candidates) {
    try {
      console.log(`[scan] Trying sitemap: ${url}`);
      const xml = await fetchSitemapXml(url);
      if (xml === null) {
        lastError = `${url} → fetch failed`;
        continue;
      }
      console.log(`[scan] Sitemap fetched: ${url} (${xml.length} chars)`);

      let entries = parseSitemapUrlEntries(xml);

      // Sitemap-index shape: no direct <url> entries — fetch children.
      if (entries.length === 0) {
        const childLocs = parseSitemapIndexLocs(xml);
        if (childLocs.length > 0) {
          console.log(
            `[scan] Sitemap index detected: ${childLocs.length} child sitemap(s) — fetching`,
          );
          for (const child of childLocs) {
            try {
              const childXml = await fetchSitemapXml(child);
              if (childXml === null) continue;
              const childEntries = parseSitemapUrlEntries(childXml);
              console.log(`[scan]   child ${child} → ${childEntries.length} URLs`);
              entries.push(...childEntries);
            } catch (err) {
              console.warn(
                `[scan]   child ${child} failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
          entries = dedupeSitemapEntries(entries);
        }
      }

      if (entries.length > 0) {
        console.log(`[scan] Sitemap resolved: ${url} → ${entries.length} URLs`);
        return entries;
      }
      console.warn(`[scan] Sitemap at ${url} parsed but contained 0 <url> entries`);
      lastError = `${url} → 0 entries`;
    } catch (err) {
      lastError = `${url} → ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`[scan] Sitemap fetch error: ${lastError}`);
    }
  }

  throw new Error(`All sitemap URLs failed for ${origin}. Last error: ${lastError}`);
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
    if (html.length < 500) {
      console.warn(`[scan] WARNING: ${url} returned only ${html.length} chars — may be empty shell`);
    }
    return { html, status: res.status };
  } catch (err) {
    const msg = formatErrorWithCause(err);
    console.error(`[scan] Fetch failed for ${url}: ${msg}`);
    return { error: msg, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// ── Persistence ──

function loadPreviousSnapshots(): PageSnapshot[] {
  // Tenant-scoped per Sprint 7.8c. requireTenantDir throws if
  // BEACON_TENANT_SLUG is missing — fail-loud is the right behavior
  // because this path drives diff baseline; reading from the wrong
  // location would produce nonsense diffs.
  const path = join(requireTenantDir(), "page-snapshots.json");
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PageSnapshot[];
  } catch {
    return [];
  }
}

function saveSnapshots(snapshots: PageSnapshot[]): void {
  const path = join(requireTenantDir(), "page-snapshots.json");
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(snapshots, null, 2), "utf8");
  renameSync(tmp, path);
}

/** Sprint 6A.1 Phase 6 — write the freshly-extracted page_element_inventory
 *  rows for this scan. Full replace (matches `saveSnapshots`'s
 *  full-rewrite shape). orchestrate-scan reads this file after the CLI
 *  exits and dual-writes to Supabase. */
function saveElementInventory(rows: PageElementInventoryRow[]): void {
  const path = join(requireTenantDir(), "page-element-inventory.json");
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(rows, null, 2), "utf8");
  renameSync(tmp, path);
}

function loadPreviousElementInventory(): PageElementInventoryRow[] {
  const path = join(requireTenantDir(), "page-element-inventory.json");
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PageElementInventoryRow[];
  } catch {
    return [];
  }
}

/** Read city + service dictionaries directly from the on-disk
 *  business config. Avoids importing server-only modules into the CLI
 *  subprocess. Missing/invalid file → empty dictionaries (mention
 *  extractors degrade to zero rows gracefully). */
function loadInventoryDictionaries(): {
  cities: string[];
  services: string[];
} {
  try {
    // business-config is GLOBAL per Sprint 7.8c — read from .data/global/.
    // Fall back to the legacy root path so a partially-migrated repo
    // still yields dictionaries.
    const globalPath = join(globalDir(), "business-config.json");
    const legacyPath = join(DATA_DIR, "business-config.json");
    const cfgPath = existsSync(globalPath) ? globalPath : legacyPath;
    if (!existsSync(cfgPath)) return { cities: [], services: [] };
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as {
      locations?: unknown;
      services?: unknown;
    };
    const cities = Array.isArray(cfg.locations)
      ? cfg.locations.filter((s): s is string => typeof s === "string")
      : [];
    const services = Array.isArray(cfg.services)
      ? cfg.services.filter((s): s is string => typeof s === "string")
      : [];
    return { cities, services };
  } catch {
    return { cities: [], services: [] };
  }
}

function saveDiffs(diffs: PageSnapshotDiff[]): void {
  const path = join(requireTenantDir(), "page-snapshot-diffs.json");
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(diffs, null, 2), "utf8");
  renameSync(tmp, path);
}

function saveGuardrails(alerts: GuardrailAlert[]): void {
  const path = join(requireTenantDir(), "page-guardrails.json");
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(alerts, null, 2), "utf8");
  renameSync(tmp, path);
}

function appendScanRun(meta: ScanRunMeta): void {
  const path = join(requireTenantDir(), "scan-runs.json");
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
  const obsPath = join(requireTenantDir(), "observation-runs.json");
  if (existsSync(obsPath)) {
    try {
      const list = JSON.parse(readFileSync(obsPath, "utf8")) as ObservationRun[];
      for (let i = list.length - 1; i >= 0; i--) {
        const r = list[i];
        if (r?.run_id && r.run_type === "website_crawl") return r.run_id;
      }
    } catch {}
  }
  const scanPath = join(requireTenantDir(), "scan-runs.json");
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
  const path = join(requireTenantDir(), "observation-runs.json");
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
  const current = join(requireTenantDir(), "page-snapshots.json");
  const prev = join(requireTenantDir(), "page-snapshots-prev.json");
  if (existsSync(current)) {
    try { copyFileSync(current, prev); } catch {}
  }
}

async function saveReconciliation(
  recon: SitemapReconciliation,
  tenantId: string,
): Promise<void> {
  // Phase A.3 (post-A.3.5, 2026-05-15) — sitemap-reconciliation is
  // now TENANT_SCOPED (classification flipped in
  // `store-classification.ts`). Writes go through the tenant-scoped
  // repository, which:
  //   • UPSERTs to `public.sitemap_reconciliation` in the
  //     supabase-backend (production daily-scan persistence).
  //   • writes `.data/tenants/{slug}/sitemap-reconciliation.json`
  //     in the file-backend (dev parity).
  //
  // Fail-loud (sequencing model A): if the Supabase migration
  // hasn't applied yet, the UPSERT throws "undefined_table" and
  // the scan errors out. Operator notices and applies the
  // migration before the next scheduled run.
  const { getRepository } = await import(
    "../src/lib/persistence/repositories"
  );
  const repo = getRepository().forTenant(tenantId);
  await repo.setSitemapReconciliation(recon);
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  // Crawl ceiling resolution (multi-tenant fleet, 2026-06-10):
  //   --limit=N CLI arg → BEACON_SCAN_MAX_PAGES env (per-tenant, set by the
  //   daily-scan matrix from the tenant's `scanMaxPages` ops override) →
  //   DEFAULT_SCAN_PAGE_CAP. The default exists so an encyclopedia-scale
  //   sitemap (thousands of URLs) cannot blow the scheduled job's time
  //   window with serial fetches; small sites are unaffected.
  const DEFAULT_SCAN_PAGE_CAP = 1500;
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const envCap = parseInt(process.env.BEACON_SCAN_MAX_PAGES ?? "", 10);
  const limit = limitArg
    ? parseInt(limitArg.split("=")[1], 10)
    : Number.isFinite(envCap) && envCap > 0
      ? envCap
      : DEFAULT_SCAN_PAGE_CAP;
  const urlArg = args.find((a) => a.startsWith("--url="));
  const singleUrl = urlArg ? urlArg.split("=").slice(1).join("=") : null;

  console.log("=== Page Scanner v1 (Sitemap-First) ===\n");
  console.log(`[scan] canonical_domain=${CANONICAL_DOMAIN} origin=${siteOrigin}`);

  // Phase A.3 (post-A.3.5, 2026-05-15) — resolve tenant identity
  // ONCE at the top of main() so both the reconciliation write
  // (Step 3.5) and the inventory loop (Step 4+) share a single
  // tenant resolution. Previously the reconciliation write went to
  // a global file path; now it routes through the tenant-scoped
  // repository and needs the id.
  const tenantId = await currentTenantId();

  // ── Step 1: Fetch sitemap ──
  console.log(`[scan] step=sitemap_fetch url=${SITEMAP_URL}`);
  console.log(`Fetching sitemap from ${SITEMAP_URL}...`);
  let sitemapEntries: { url: string; lastmod: string | null }[];
  try {
    sitemapEntries = await fetchSitemap();
  } catch (e) {
    const failPayload: LastScanResultPayload = {
      schemaVersion: 1,
      finishedAt: new Date().toISOString(),
      exit: "failed",
      trigger: "cli",
      observationRunId: null,
      pagesScanned: 0,
      pagesChanged: 0,
      pagesWithErrors: 0,
      guardrailAlertCount: 0,
      cliError: `${formatErrorWithCause(e)} (sitemap: ${SITEMAP_URL})`,
    };
    await writeLastScanResultFile(failPayload);
    syncScanStateAfterResult(failPayload);
    throw e;
  }
  console.log(`[scan] step=sitemap_ok count=${sitemapEntries.length}`);
  console.log(`Sitemap URLs: ${sitemapEntries.length}`);

  // ── Step 2: Load registry ──
  console.log(`[scan] step=load_pages_registry`);
  const allPages = await readStore<PageEntity>("pages");
  const ownedPages = allPages.filter((p) => p.is_owned);
  console.log(`[scan] step=registry_loaded total=${allPages.length} owned=${ownedPages.length}`);
  console.log(`Registry owned pages: ${ownedPages.length}`);

  // ── Step 3: Reconcile ──
  console.log("\n--- Reconciliation ---\n");

  const registryByUrl = new Map<string, PageEntity>();
  for (const p of ownedPages) {
    registryByUrl.set(normalizeUrl(p.url), p);
  }

  const canonical: CanonicalPage[] = [];
  for (const entry of sitemapEntries) {
    const normUrl = normalizeUrl(entry.url);
    const registryPage = registryByUrl.get(normUrl);

    canonical.push({
      url: entry.url,
      path: new URL(entry.url).pathname.replace(/\/+$/, "") || "/",
      registry_page_id: registryPage?.id ?? null,
      // audit-wave4 #10: STABLE id derived from the normalized URL (was a
      // positional `sm-${idx}` that shifted across scans, so the same
      // sitemap-only page got a new id whenever sitemap order/count changed —
      // breaking change-detection joins). Mirrors in-process-scan pageIdFor().
      scan_page_id:
        registryPage?.id ??
        `sm-${createHash("sha256").update(normUrl).digest("hex").slice(0, 16)}`,
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
  await saveReconciliation(reconciliation, tenantId);
  console.log(
    `\nWrote reconciliation via tenant repository (tenant=${tenantId}).`,
  );

  // ── Step 4: Determine scan set ──
  let scanSet = canonical;
  if (singleUrl) {
    scanSet = canonical.filter((c) => normalizeUrl(c.url) === normalizeUrl(singleUrl));
    if (scanSet.length === 0) {
      console.log(`\nNo canonical page matches URL: ${singleUrl}`);
      const abortedPayload: LastScanResultPayload = {
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
      };
      await writeLastScanResultFile(abortedPayload);
      syncScanStateAfterResult(abortedPayload);
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
    const dryPayload: LastScanResultPayload = {
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
    };
    await writeLastScanResultFile(dryPayload);
    syncScanStateAfterResult(dryPayload);
    return;
  }

  // ── Step 5: Scan canonical pages ──
  console.log(`[scan] step=page_fetch_start pages=${scanSet.length}`);
  console.log(`\n--- Scanning ${scanSet.length} canonical pages ---\n`);

  const previousSnapshots = loadPreviousSnapshots();
  const previousElementRows = loadPreviousElementInventory();
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

  // Sprint 6A.1 Phase 6 — accumulate page_element_inventory rows during
  // the scan loop. Written to disk near the snapshot save so the
  // file-first invariant matches `page-snapshots.json`.
  // Dictionaries + tenantId are read once before the loop; both live in
  // .data and are read directly from JSON (avoids dragging server-only
  // BusinessConfig + Supabase imports into the CLI subprocess).
  const allElementRows: PageElementInventoryRow[] = [];
  // Sprint 7 Phase 7.5d/2 (2026-04-25) — fail-loud tenant resolution.
  // Phase A.3 (post-A.3.5): tenant identity is now resolved at the
  // top of main() into `tenantId`. Aliased here for backwards
  // compatibility with the rest of the loop's existing references
  // (no semantic change — same value).
  const tenantIdForInventory = tenantId;
  const { cities: cityDictionary, services: serviceDictionary } =
    loadInventoryDictionaries();

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

    const rejectionReason = pageFetchRejectionReason(result);
    if (rejectionReason) {
      console.warn(`[scan] refusing untrustworthy response for ${page.url}: ${rejectionReason}`);
      errors.push({ url: page.url, error: rejectionReason });
      continue;
    }

    const snapshot = extractPageSnapshot(
      result.html,
      page.url,
      page.scan_page_id,
      tenantIdForInventory,
      result.status,
    );
    const stamped: PageSnapshot = { ...snapshot, observation_run_id: observationRunId };
    newSnapshots.push(stamped);

    // Sprint 6A.1 Phase 6 — extract inventory rows alongside the snapshot.
    // Per-page try/catch so a bad page doesn't abort the rest of the scan.
    try {
      const rows = buildPageElementRows({
        snapshot: stamped,
        html: result.html,
        tenantId: tenantIdForInventory,
        cityDictionary,
        serviceDictionary,
      });
      for (const r of rows) allElementRows.push(r);
    } catch (err) {
      console.warn(
        `[scan] inventory extraction failed for ${page.url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const prev = prevByPageId.get(page.scan_page_id) ?? prevByUrl.get(normalizeUrl(page.url));
    if (prev) {
      diffs.push(diffSnapshots(snapshot, prev));
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("\n");
  console.log(
    `[scan] step=page_fetch_done snapshots=${newSnapshots.length} errors=${errors.length}`,
  );

  // ── Step 6: Classify guardrails (load citation counts for context) ──
  let citationsByUrl = new Map<string, number>();
  try {
    // citation-evidence-index is per-tenant per Sprint 7.8c — read from
    // .data/tenants/{slug}/. Fall back to legacy root for partial migrations.
    const tenantPath = join(requireTenantDir(), "citation-evidence-index.json");
    const legacyPath = join(DATA_DIR, "citation-evidence-index.json");
    const ciPath = existsSync(tenantPath) ? tenantPath : legacyPath;
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
    const alerts = classifyGuardrails(snap, diff, tenantIdForInventory, citCount);
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
            tenant_id: tenantIdForInventory,
          });
        }
      }
      console.log();
    } catch (err) {
      console.log(`  Render check skipped: ${err instanceof Error ? err.message : err}\n`);
    }
  }

  // ── Step 7: Save ──
  const persistedSnapshots = mergeLatestCanonicalSnapshots({
    canonicalUrls: canonical.map((page) => page.url),
    freshSnapshots: newSnapshots,
    previousSnapshots,
  });
  const persistedElementRows = mergeLatestCanonicalInventory({
    canonicalUrls: canonical.map((page) => page.url),
    freshRows: allElementRows,
    previousRows: previousElementRows,
    freshSnapshotUrls: newSnapshots.map((snapshot) => snapshot.url),
  });
  archivePreviousSnapshots();
  saveSnapshots(persistedSnapshots);
  console.log(
    `Wrote ${persistedSnapshots.length} latest-known snapshots (${newSnapshots.length} freshly observed; tenant-routed)`,
  );

  // Sprint 6A.1 Phase 6 — write the inventory rows accumulated in the
  // scan loop. orchestrate-scan reads this file after the CLI exits and
  // calls `syncPageElementInventory` to dual-write to Supabase.
  saveElementInventory(persistedElementRows);
  console.log(
    `Wrote ${persistedElementRows.length} latest-known page-element-inventory rows (${allElementRows.length} freshly observed; tenant-routed)`,
  );

  if (diffs.length > 0) {
    saveDiffs(diffs);
    console.log(`Wrote ${diffs.length} diffs (tenant-routed)`);
  }

  const alertsStamped: GuardrailAlert[] = allAlerts.map((a) => ({
    ...a,
    observation_run_id: observationRunId,
  }));
  saveGuardrails(alertsStamped);
  console.log(`Wrote ${alertsStamped.length} guardrail alerts (tenant-routed)`);

  if (renderResults.length > 0) {
    const renderPath = join(requireTenantDir(), "render-checks.json");
    const renderTmp = renderPath + ".tmp";
    writeFileSync(renderTmp, JSON.stringify(renderResults, null, 2), "utf8");
    renameSync(renderTmp, renderPath);
    console.log(`Wrote ${renderResults.length} render checks (tenant-routed)`);
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
    // Phase 6D (2026-04-28) — environment-aware source label.
    // GH Actions workflow sets `BEACON_SCAN_SOURCE_LABEL=github-actions-daily-scan`
    // (env inherits through `runWebsiteScan`'s `execAsync` to this CLI). Local
    // CLI runs leave the env unset so they remain identifiable as
    // `"scan-owned-pages.ts"`. This is the single divergence point between
    // hosted vs local scans for `observation_runs.source`.
    source: process.env.BEACON_SCAN_SOURCE_LABEL?.trim() || "scan-owned-pages.ts",
    status: errors.length > 0 && newSnapshots.length === 0 ? "failed" : errors.length > 0 ? "partial" : "completed",
    scope_label: `Sitemap canonical scan · ${newSnapshots.length} page(s) fetched${singleUrl ? " (single URL)" : ""}${limit !== Infinity ? ` · limit ${limit}` : ""}`,
    parser_version: OBSERVATION_RUN_PARSER_VERSION,
    baseline_run_id: baselineRunId,
    ...cliUniversePin,
    tenant_id: tenantIdForInventory,
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

  const finalPayload: LastScanResultPayload = {
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
  };
  await writeLastScanResultFile(finalPayload);
  syncScanStateAfterResult(finalPayload);

  console.log("\n=== Done ===");
}

main().catch(async (e) => {
  console.error(e);
  try {
    const crashPayload: LastScanResultPayload = {
      schemaVersion: 1,
      finishedAt: new Date().toISOString(),
      exit: "failed",
      trigger: "cli",
      observationRunId: null,
      pagesScanned: 0,
      pagesChanged: 0,
      pagesWithErrors: 0,
      guardrailAlertCount: 0,
      cliError: formatErrorWithCause(e),
    };
    await writeLastScanResultFile(crashPayload);
    syncScanStateAfterResult(crashPayload);
  } catch {
    /* ignore secondary write failure */
  }
});
