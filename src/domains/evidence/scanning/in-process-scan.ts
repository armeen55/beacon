/**
 * in-process-scan - owned-page DISCOVERY, plus the Vercel-safe launch crawl.
 *
 * DISCOVERY IS THE POINT. A generic website has exactly one public answer to "what pages do you
 * have": robots.txt names its sitemaps, and those sitemaps (often an index of indexes) name the
 * URLs. Until 2026-08-03 this module guessed two paths, recursed one level, and never read a
 * Sitemap: directive at all, so a site whose sitemap lived anywhere else was invisible. Now the
 * site's own answer comes first, the index is followed to depth 3 inside hard fetch bounds, and
 * every URL found lands in the DURABLE inventory (owned-pages-store) rather than a 150-slot queue.
 *
 * Discipline: crawl-only, zero paid calls, polite robots-respecting fetch, hard per-request and
 * total-time budgets, stable deterministic page ids (`page-<sha16(urlKey)>`) so every crawler
 * upserts the SAME rows, and failure-soft returns instead of throws.
 */

import { createHash } from "node:crypto";

import { fetchPageHtml, COMPETITOR_INTEL_UA } from "@/domains/evidence/competitor-intel/polite-fetch";
import { parseSitemapUrlEntries, parseSitemapIndexLocs, dedupeSitemapEntries } from "./sitemap-parse";
import { parseRobotsText } from "@/domains/evidence/pages/robots-parser";
import type { DiscoveredPage, DiscoveredVia } from "./owned-pages-store";
import { loadBusinessProfile } from "@/domains/account";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import type { PageEntity, PageSnapshot, PageType } from "@/domains/evidence/pages/types";
import { syncPages, syncPageSnapshots } from "@/lib/persistence/dual-write";
import { pickSecondaryPaths } from "@/domains/account/onboarding/fetch-site-profile";

const DEFAULT_MAX_PAGES = 18;
const DEFAULT_TOTAL_BUDGET_MS = 22_000;
/** Per-request timeout, kept well under the route's maxDuration ceiling. */
const DEFAULT_PER_REQUEST_MS = 5_000;

/** DISCOVERY BOUNDS. A sitemap index may point at indexes; three levels reaches every real site
 *  shape while a hostile or cyclic index runs out of budget instead of running forever. */
const MAX_SITEMAP_DEPTH = 3;
const MAX_SITEMAP_FETCHES = 200;
/** One discovery pass records at most this many URLs per account; the overflow is COUNTED, never
 *  silently dropped, so the inventory can say how much of the site it has not enumerated yet. */
export const MAX_DISCOVERED_URLS = 5_000;
/** File-ish URLs a content crawl must never spend a fetch on. */
const NON_HTML_EXT_RE =
  /\.(?:jpe?g|png|gif|webp|svg|ico|css|js|json|xml|pdf|zip|gz|mp4|mp3|webm|woff2?|ttf|eot|avif)$/i;

/** www-insensitive host. A bare apex whose sitemap 301s to www (or the reverse) is the common
 *  small-business case, and keying on the raw host would drop the ENTIRE sitemap. */
export function stripWww(host: string): string {
  return host.replace(/^www\./i, "");
}

export interface InProcessColdStartScanResult {
  status: "scanned" | "no_domain" | "no_pages" | "error";
  pagesDiscovered: number;
  pagesCrawled: number;
  snapshotsWritten: number;
  durationMs: number;
  source: "sitemap" | "homepage" | "none";
  detail?: string;
}

export interface InProcessColdStartScanDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  maxPages?: number;
  totalBudgetMs?: number;
  perRequestMs?: number;
  syncPagesImpl?: typeof syncPages;
  syncPageSnapshotsImpl?: typeof syncPageSnapshots;
}

/** Scheme+host as an https origin, or null when the input is unusable. `host` is www-stripped for
 *  comparison and stable ids; `origin` keeps the host as typed (redirects are followed). */
export function originFromDomain(domain: string): { origin: string; host: string } | null {
  const raw = (domain ?? "").trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(candidate);
    if (!u.hostname) return null;
    return { origin: `https://${u.hostname}`, host: stripWww(u.hostname.toLowerCase()) };
  } catch {
    return null;
  }
}

/** Path with trailing slashes stripped (root stays "/"). */
export function normPath(u: URL): string {
  return u.pathname.replace(/\/+$/, "") || "/";
}

/** Stable join/dedup key: www-stripped lowercase host + normalized path, no query or hash. */
export function urlKey(u: URL): string {
  return `${stripWww(u.hostname.toLowerCase())}${normPath(u)}`;
}

/** Deterministic page id from the url key, stable across re-runs so every crawler upserts the
 *  same row. */
export function pageIdFor(key: string): string {
  return `page-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

export function inferPageType(path: string): PageType {
  return path === "/" ? "homepage" : "other";
}

/**
 * THE canonical form of one owned URL: scheme + host + normalized path, no query, no fragment.
 * Returns null for cross-host links, non-http schemes, and obvious non-HTML files, so one page is
 * one row whatever spelling the site used.
 */
export function canonicalOwnedUrl(
  raw: string,
  host: string,
  baseUrl?: string,
): { url: string; key: string; path: string } | null {
  let u: URL;
  try {
    u = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (stripWww(u.hostname.toLowerCase()) !== host) return null;
  const path = normPath(u);
  if (NON_HTML_EXT_RE.test(path)) return null;
  return { url: `${u.protocol}//${u.hostname}${path}`, key: urlKey(u), path };
}

async function fetchText(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<string | null> {
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

type DiscoveryResult = {
  /** Canonical owned URLs with how each became known, deduped, in discovery order. */
  pages: DiscoveredPage[];
  source: "sitemap" | "homepage" | "none";
  /** URLs the pass found and could not record because the per-pass ceiling was reached. */
  truncated: number;
};

/**
 * Enumerate the site's own discoverable URLs, bounded on every axis: the deadline the caller owns,
 * MAX_SITEMAP_FETCHES sitemap documents, MAX_SITEMAP_DEPTH levels of index nesting, and
 * MAX_DISCOVERED_URLS recorded URLs. Order of authority: the Sitemap: directives robots.txt
 * publishes, then the two conventional paths as a fallback, then the homepage and its nav as a
 * last resort for a site with no sitemap at all.
 */
export async function discoverUrls(
  origin: string,
  fetchImpl: typeof fetch,
  perRequestMs: number,
  now: () => number,
  deadlineAt: number,
): Promise<DiscoveryResult> {
  const site = originFromDomain(origin);
  const host = site?.host ?? "";
  const overBudget = () => now() > deadlineAt;
  const found = new Map<string, DiscoveredPage>();
  let truncated = 0;
  const record = (raw: string, via: DiscoveredVia) => {
    const c = canonicalOwnedUrl(raw, host);
    if (!c) return;
    if (found.has(c.key)) return;
    if (found.size >= MAX_DISCOVERED_URLS) {
      truncated++;
      return;
    }
    found.set(c.key, { url: c.url, via });
  };

  // 1. The site's own answer. A robots.txt that names its sitemaps is authoritative; the two
  //    guessed paths only ever existed because nothing here read those directives.
  const robotsTxt = overBudget() ? null : await fetchText(`${origin}/robots.txt`, fetchImpl, perRequestMs);
  const declared = robotsTxt ? parseRobotsText(robotsTxt, `${origin}/robots.txt`, 200).sitemaps : [];
  const queue: { url: string; depth: number; via: DiscoveredVia }[] = [
    ...declared.map((url) => ({ url, depth: 0, via: "robots_sitemap" as DiscoveredVia })),
    { url: `${origin}/sitemap.xml`, depth: 0, via: "sitemap" as DiscoveredVia },
    { url: `${origin}/sitemap_index.xml`, depth: 0, via: "sitemap" as DiscoveredVia },
  ];

  // 2. Breadth-first through the index tree. Each document is fetched at most once.
  const fetched = new Set<string>();
  while (queue.length > 0 && fetched.size < MAX_SITEMAP_FETCHES && !overBudget()) {
    const next = queue.shift()!;
    if (fetched.has(next.url)) continue;
    fetched.add(next.url);
    const xml = await fetchText(next.url, fetchImpl, perRequestMs);
    if (!xml) continue;
    const children = parseSitemapIndexLocs(xml);
    if (children.length > 0) {
      if (next.depth + 1 >= MAX_SITEMAP_DEPTH) continue;
      for (const child of children) queue.push({ url: child, depth: next.depth + 1, via: next.via });
      continue;
    }
    for (const e of dedupeSitemapEntries(parseSitemapUrlEntries(xml))) record(e.url, next.via);
  }
  if (found.size > 0) return { pages: [...found.values()], source: "sitemap", truncated };

  // 3. No sitemap anywhere. Seed the homepage plus its nav links so a sitemap-less small site still
  //    gets real inventory. Every seeded URL is still robots-checked and host-filtered at crawl time.
  record(origin, "homepage");
  const homeHtml = overBudget() ? null : await fetchText(origin, fetchImpl, perRequestMs);
  if (homeHtml) for (const path of pickSecondaryPaths(homeHtml)) record(`${origin}${path}`, "nav");
  return { pages: [...found.values()], source: "homepage", truncated };
}

/**
 * Crawl the tenant's own domain in-process and dual-write pages + snapshots to Supabase. The
 * launch-time fallback for a brand-new account; the resumable frontier finishes the long tail.
 * Failure-soft: always resolves with a structured result.
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
    const { pages: discovered, source } = await discoverUrls(
      site.origin, fetchImpl, perRequestMs, now, started + budgetMs);
    const candidates: { url: string; key: string; path: string }[] = [];
    for (const d of discovered) {
      const c = canonicalOwnedUrl(d.url, site.host);
      if (!c) continue;
      candidates.push(c);
      if (candidates.length >= maxPages) break;
    }

    const robotsCache = new Map<string, string[]>();
    const snapshots: PageSnapshot[] = [];
    const pages: PageEntity[] = [];
    let crawled = 0;
    const nowIso = new Date(now()).toISOString();
    // One durable profile read for the whole scan; extraction is pure.
    const profile = await loadBusinessProfile(tenantId).catch(() => null);

    for (const c of candidates) {
      if (now() - started > budgetMs) break;
      const res = await fetchPageHtml(c.url, robotsCache, { fetchImpl, timeoutMs: perRequestMs });
      crawled++;
      if (!res.ok) continue;
      const id = pageIdFor(c.key);
      const snap = extractPageSnapshot(res.html, c.url, id, tenantId, res.status, profile);
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

    // The pages registry is a PREREQUISITE, not an independent fail-soft step: snapshots join to a
    // page row by id, so writing snapshots after a failed registry write leaves orphans the read
    // path cannot surface while the scan falsely reports success.
    try {
      await syncPagesImpl(pages, tenantId);
    } catch (e) {
      console.error(
        `[in-process-scan] syncPages failed (tenant=${tenantId}): ${e instanceof Error ? e.message : e}`,
      );
      return result({
        status: "error",
        pagesDiscovered: candidates.length,
        pagesCrawled: crawled,
        source,
        detail: "pages_registry_write_failed",
      });
    }
    // Snapshots are the evidence the whole scan exists to produce. Fail closed.
    try {
      await syncSnapshotsImpl(snapshots, tenantId);
    } catch (e) {
      console.error(
        `[in-process-scan] syncPageSnapshots failed (tenant=${tenantId}): ${e instanceof Error ? e.message : e}`,
      );
      return result({
        status: "error",
        pagesDiscovered: candidates.length,
        pagesCrawled: crawled,
        source,
        detail: "snapshot_write_failed",
      });
    }

    return result({
      status: "scanned",
      pagesDiscovered: candidates.length,
      pagesCrawled: crawled,
      snapshotsWritten: snapshots.length,
      source,
    });
  } catch (e) {
    return result({ status: "error", detail: e instanceof Error ? e.message : String(e) });
  }
}
