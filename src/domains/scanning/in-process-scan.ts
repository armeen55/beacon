/**
 * in-process-scan — Vercel-safe cold-start crawler (2026-06-23).
 *
 * WHY: the launch-time first scan (`dispatchFirstScanForTenant`) is INERT
 * without a GitHub PAT, and the only real scan path (`orchestrate-scan` →
 * `scripts/scan-owned-pages.ts`) spawns `npx tsx` and writes `.data/` — both
 * impossible on Vercel's read-only serverless runtime. The production
 * recommendation path reads pages + snapshots FROM Supabase, which is only
 * ever populated by that scan dual-writing back. Net effect today: a brand-new
 * Vercel tenant who connects GSC/Wix sees ZERO recommendations until a nightly
 * fleet run (or forever, with crons off). This module closes that cold-start
 * gap by crawling the tenant's own domain IN-PROCESS using only pure,
 * already-shipped pieces, and dual-writing the result straight to Supabase so
 * the very next `/today` render has real inventory.
 *
 * Discipline:
 *   - Crawl-only: zero paid API calls (polite, robots-respecting fetch).
 *   - HARD CAPS: a small page cap + a total-time budget well under the
 *     serverless function limit. Cold-start is small and fast on purpose; the
 *     nightly fleet finishes the long tail.
 *   - Stable, deterministic page ids (`page-<sha16(urlKey)>`) so (a) the
 *     snapshot.page_id ↔ PageEntity.id join holds on the read path and
 *     (b) re-runs upsert the same rows (idempotent), and the nightly scan —
 *     which reconciles the registry BY NORMALIZED URL — reuses these ids
 *     instead of duplicating rows.
 *   - Failure-soft: never throws to the caller; returns a structured outcome.
 *   - PURE composition: sitemap-parse + polite-fetch + extractPageSnapshot +
 *     dual-write. Does NOT touch orchestrate-scan / .data / child processes.
 */

import { createHash } from "node:crypto";

import { fetchPageHtml, COMPETITOR_INTEL_UA } from "@/domains/competitor-intel/polite-fetch";
import {
  parseSitemapUrlEntries,
  parseSitemapIndexLocs,
  dedupeSitemapEntries,
} from "@/domains/scanning/sitemap-parse";
import { extractPageSnapshot } from "@/domains/pages/extractor";
import type { PageEntity, PageSnapshot, PageType } from "@/domains/pages/types";
import { syncPages, syncPageSnapshots } from "@/lib/persistence/dual-write";
import { pickSecondaryPaths } from "@/domains/onboarding/fetch-site-profile";

const DEFAULT_MAX_PAGES = 18;
const DEFAULT_TOTAL_BUDGET_MS = 22_000;
const DEFAULT_PER_REQUEST_MS = 7_000;
const MAX_CHILD_SITEMAPS = 5;

export interface InProcessColdStartScanResult {
  status: "scanned" | "no_domain" | "no_pages" | "error";
  /** Distinct candidate URLs discovered (sitemap or homepage seed). */
  pagesDiscovered: number;
  /** URLs actually fetched within the caps/budget. */
  pagesCrawled: number;
  /** Snapshots successfully extracted + dual-written. */
  snapshotsWritten: number;
  durationMs: number;
  source: "sitemap" | "homepage" | "none";
  detail?: string;
}

export interface InProcessColdStartScanDeps {
  fetchImpl?: typeof fetch;
  /** Injectable clock for budget + timestamps (defaults to Date.now). */
  now?: () => number;
  maxPages?: number;
  totalBudgetMs?: number;
  perRequestMs?: number;
  /** Injectable persistence for tests. */
  syncPagesImpl?: typeof syncPages;
  syncPageSnapshotsImpl?: typeof syncPageSnapshots;
}

/** Strip scheme+host into an https origin, or null if the input is unusable. */
function originFromDomain(domain: string): { origin: string; host: string } | null {
  const raw = (domain ?? "").trim();
  if (!raw) return null;
  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const u = new URL(candidate);
    if (!u.hostname) return null;
    return { origin: `https://${u.hostname}`, host: u.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

/** Path with trailing slashes stripped (root stays "/"). */
function normPath(u: URL): string {
  return u.pathname.replace(/\/+$/, "") || "/";
}

/** Stable join/dedup key: lowercase host + normalized path (no query/hash). */
function urlKey(u: URL): string {
  return `${u.hostname.toLowerCase()}${normPath(u)}`;
}

/** Deterministic page id from the url key — stable across re-runs. */
function pageIdFor(key: string): string {
  return `page-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

function inferPageType(path: string): PageType {
  return path === "/" ? "homepage" : "other";
}

async function fetchText(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": COMPETITOR_INTEL_UA, Accept: "application/xml,text/xml,*/*" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Discover candidate page URLs from sitemap.xml (incl. index), else seed homepage. */
async function discoverUrls(
  origin: string,
  fetchImpl: typeof fetch,
  perRequestMs: number,
  maxPages: number,
): Promise<{ urls: string[]; source: "sitemap" | "homepage" | "none" }> {
  const found = new Set<string>();
  for (const name of ["/sitemap.xml", "/sitemap_index.xml"]) {
    const xml = await fetchText(`${origin}${name}`, fetchImpl, perRequestMs);
    if (!xml) continue;
    const childLocs = parseSitemapIndexLocs(xml);
    if (childLocs.length > 0) {
      for (const child of childLocs.slice(0, MAX_CHILD_SITEMAPS)) {
        const childXml = await fetchText(child, fetchImpl, perRequestMs);
        if (!childXml) continue;
        for (const e of dedupeSitemapEntries(parseSitemapUrlEntries(childXml))) {
          found.add(e.url);
          if (found.size >= maxPages * 3) break;
        }
        if (found.size >= maxPages * 3) break;
      }
    } else {
      for (const e of dedupeSitemapEntries(parseSitemapUrlEntries(xml))) found.add(e.url);
    }
    if (found.size > 0) break;
  }
  if (found.size > 0) return { urls: [...found], source: "sitemap" };
  // Fallback: no sitemap. Seed the homepage PLUS nav-discovered secondary paths
  // (reusing onboarding's pure pickSecondaryPaths) so a sitemap-less small site
  // gets real inventory, not just a single homepage snapshot. The crawl loop
  // still robots-checks + same-host-filters + caps every seeded URL.
  const seeded = new Set<string>([origin]);
  const homeHtml = await fetchText(origin, fetchImpl, perRequestMs);
  if (homeHtml) {
    for (const path of pickSecondaryPaths(homeHtml)) {
      seeded.add(`${origin}${path}`);
      if (seeded.size >= maxPages) break;
    }
  }
  return { urls: [...seeded], source: "homepage" };
}

/**
 * Crawl the tenant's own domain in-process and dual-write pages + snapshots to
 * Supabase. Failure-soft: always resolves with a structured result. Intended
 * to run as a launch-time fallback when GitHub-dispatch is unavailable
 * (no PAT — the Vercel case).
 */
export async function runInProcessColdStartScan(args: {
  tenantId: string;
  domain: string;
  deps?: InProcessColdStartScanDeps;
}): Promise<InProcessColdStartScanResult> {
  const { tenantId, domain } = args;
  const deps = args.deps ?? {};
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const maxPages = Math.max(1, Math.min(deps.maxPages ?? DEFAULT_MAX_PAGES, 50));
  const budgetMs = deps.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
  const perRequestMs = deps.perRequestMs ?? DEFAULT_PER_REQUEST_MS;
  const syncPagesImpl = deps.syncPagesImpl ?? syncPages;
  const syncSnapshotsImpl = deps.syncPageSnapshotsImpl ?? syncPageSnapshots;

  const started = now();
  const result = (over: Partial<InProcessColdStartScanResult>): InProcessColdStartScanResult => ({
    status: "error",
    pagesDiscovered: 0,
    pagesCrawled: 0,
    snapshotsWritten: 0,
    durationMs: now() - started,
    source: "none",
    ...over,
  });

  if (!tenantId) return result({ status: "error", detail: "tenant_id_required" });
  const site = originFromDomain(domain);
  if (!site) return result({ status: "no_domain", detail: "no_usable_domain" });

  try {
    const { urls, source } = await discoverUrls(site.origin, fetchImpl, perRequestMs, maxPages);
    // Same-origin only, dedup by stable key, cap.
    const seen = new Set<string>();
    const candidates: { url: string; key: string; path: string }[] = [];
    for (const raw of urls) {
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        continue;
      }
      if (u.hostname.toLowerCase() !== site.host) continue;
      const key = urlKey(u);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ url: u.toString(), key, path: normPath(u) });
      if (candidates.length >= maxPages) break;
    }

    const robotsCache = new Map<string, string[]>();
    const snapshots: PageSnapshot[] = [];
    const pages: PageEntity[] = [];
    let crawled = 0;
    const nowIso = new Date(now()).toISOString();

    for (const c of candidates) {
      if (now() - started > budgetMs) break;
      const res = await fetchPageHtml(c.url, robotsCache, { fetchImpl, timeoutMs: perRequestMs });
      crawled++;
      if (!res.ok) continue;
      const id = pageIdFor(c.key);
      const snap = extractPageSnapshot(res.html, c.url, id, tenantId, res.status);
      snapshots.push(snap);
      pages.push({
        id,
        url: c.url,
        canonical_url: snap.canonical_url ?? c.url,
        domain: site.host,
        path: c.path,
        page_type: inferPageType(c.path),
        city: null,
        service: null,
        topics: [],
        ownership_tier: "owned",
        tracked_entity_id: null,
        is_owned: true,
        first_seen_at: nowIso,
        last_observed_at: nowIso,
        discovery_sources: ["entity_url"],
        title_last_seen: snap.title ?? null,
        changelog_ids: [],
        metadata: { source: "in_process_cold_start" },
        tenant_id: tenantId,
      });
    }

    if (snapshots.length === 0) {
      return result({
        status: "no_pages",
        pagesDiscovered: candidates.length,
        pagesCrawled: crawled,
        source,
        detail: "no_fetchable_pages",
      });
    }

    // Persist pages registry FIRST (so snapshots have a row to join to), then
    // snapshots. Each is independently fail-soft so a partial write still
    // leaves something usable for the next render.
    let snapshotsWritten = 0;
    try {
      await syncPagesImpl(pages, tenantId);
    } catch (e) {
      console.error(
        `[in-process-scan] syncPages failed (tenant=${tenantId}): ${e instanceof Error ? e.message : e}`,
      );
    }
    try {
      await syncSnapshotsImpl(snapshots, tenantId);
      snapshotsWritten = snapshots.length;
    } catch (e) {
      console.error(
        `[in-process-scan] syncPageSnapshots failed (tenant=${tenantId}): ${e instanceof Error ? e.message : e}`,
      );
    }

    return result({
      status: "scanned",
      pagesDiscovered: candidates.length,
      pagesCrawled: crawled,
      snapshotsWritten,
      source,
    });
  } catch (e) {
    return result({ status: "error", detail: e instanceof Error ? e.message : String(e) });
  }
}
