/**
 * in-process-scan - owned-page DISCOVERY, plus the Vercel-safe launch crawl.
 *
 * DISCOVERY IS THE POINT. A website's one public answer to "what pages do you have" is the
 * Sitemap: directives in its robots.txt, and the sitemaps (often an index of indexes) they name.
 * The site's own answer comes first, the index is followed to depth 3 inside hard fetch bounds,
 * and every URL found lands in the DURABLE inventory (owned-pages-store).
 *
 * ONLY THIS SITE. Every queued sitemap document is host-checked before it is fetched: a hostile or
 * merely careless index that points at another domain would otherwise aim 200 fetches wherever it
 * liked, under our identified user agent.
 *
 * Discipline: crawl-only, zero paid calls, polite robots-respecting fetch, hard per-request and
 * total-time budgets, stable deterministic page ids (`page-<sha16(urlKey)>`) so every crawler
 * upserts the SAME rows, and failure-soft returns instead of throws.
 */

import { createHash } from "node:crypto";

import { fetchPageHtml, COMPETITOR_INTEL_UA } from "@/domains/evidence/competitor-intel/polite-fetch";
import { parseSitemapUrlEntries, parseSitemapIndexLocs, dedupeSitemapEntries } from "./sitemap-parse";
import { parseRobotsText } from "@/domains/evidence/pages/robots-parser";
import { upsertDiscovery, type DiscoveredPage, type DiscoveredVia } from "./owned-pages-store";
import { loadBusinessProfile } from "@/domains/account";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import type { PageEntity, PageSnapshot } from "@/domains/evidence/pages/types";
import { syncPages, syncPageSnapshots } from "@/lib/persistence/dual-write";
import { pickSecondaryPaths } from "@/domains/account/onboarding/fetch-site-profile";

const DEFAULT_MAX_PAGES = 18;
const DEFAULT_TOTAL_BUDGET_MS = 22_000;
/** Per-request timeout, kept well under the route's maxDuration ceiling. */
const DEFAULT_PER_REQUEST_MS = 5_000;

/** A malformed chain has an explicit pending hold, never a silently discarded child. */
const MAX_SITEMAP_DEPTH = 32;
const MAX_SITEMAP_FETCHES = 200;
/** One discovery pass records at most this many URLs per account. THE BOUND IS PER PASS, NEVER PER
 *  SITE: the overflow is counted and a CURSOR is handed back, so the next pass resumes the enumeration
 *  where this one stopped instead of walking the same first few thousand URLs forever. */
export const MAX_DISCOVERED_URLS = 5_000;
/** File-ish URLs a content crawl must never spend a fetch on. */
const NON_HTML_EXT_RE =
  /\.(?:jpe?g|png|gif|webp|svg|ico|css|js|json|xml|pdf|zip|gz|mp4|mp3|webm|woff2?|ttf|eot|avif)$/i;

/** www-insensitive host. A bare apex whose sitemap 301s to www (or the reverse) is the common
 *  small-business case, and keying on the raw host would drop the ENTIRE sitemap. */
export function stripWww(host: string): string {
  return host.replace(/^www\./i, "");
}

interface InProcessColdStartScanResult {
  status: "scanned" | "no_domain" | "no_pages" | "error";
  pagesDiscovered: number;
  pagesCrawled: number;
  snapshotsWritten: number;
  durationMs: number;
  source: "sitemap" | "homepage" | "none";
  detail?: string;
}

interface InProcessColdStartScanDeps {
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
function normPath(u: URL): string {
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

export function inferPageType(path: string): PageEntity["page_type"] {
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

async function fetchText(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<{ text: string | null; retry: boolean }> {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": COMPETITOR_INTEL_UA, Accept: "application/xml,text/xml,*/*" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return { text: null, retry: res.status === 408 || res.status === 429 || res.status >= 500 };
    return { text: await res.text(), retry: false };
  } catch {
    return { text: null, retry: true };
  }
}

type SitemapFrame = { url: string; depth: number; via: DiscoveredVia; offset: number; hash?: string };
type DiscoveryCheckpoint = { root: number; rootsHash: string | null; stack: SitemapFrame[]; hadPages: boolean;
  hold?: "robots_unreadable" | "sitemap_unreadable" | "depth_limit" | "budget" | "discovery_write_incomplete" };
type DiscoveryResult = {
  /** Canonical owned URLs with how each became known, deduped, in discovery order. */
  pages: DiscoveredPage[];
  source: "sitemap" | "homepage" | "none";
  /** Remaining entries in the current document after this pass's page ceiling. */
  truncated: number;
  /** A small document stack plus offsets; null only after every root and child was examined. */
  checkpoint: DiscoveryCheckpoint | null;
  held?: DiscoveryCheckpoint["hold"];
};

/**
 * Enumerate the site's own discoverable URLs, bounded on every axis: the deadline the caller owns,
 * MAX_SITEMAP_FETCHES sitemap documents, MAX_SITEMAP_DEPTH levels of index nesting, and
 * MAX_DISCOVERED_URLS recorded URLs. Order of authority: the Sitemap: directives robots.txt
 * publishes, then the two conventional paths as a fallback, then the homepage and its nav as a
 * last resort for a site with no sitemap at all.
 *
 * RESUMABLE. A document stack records each index/leaf offset. The caller commits that checkpoint only
 * after the discovered pages have landed in the inventory; a stopped document stays on the stack.
 */
export async function discoverUrls(
  origin: string,
  fetchImpl: typeof fetch,
  perRequestMs: number,
  now: () => number,
  deadlineAt: number,
  resume?: DiscoveryCheckpoint | null,
): Promise<DiscoveryResult> {
  const site = originFromDomain(origin);
  const host = site?.host ?? "";
  const overBudget = () => now() > deadlineAt;
  const found = new Map<string, DiscoveredPage>();
  const seen = new Set<string>();
  const state: DiscoveryCheckpoint = resume ? { ...resume, stack: resume.stack.map((f) => ({ ...f })) }
    : { root: 0, rootsHash: null, stack: [], hadPages: false };
  let truncated = 0;
  const record = (raw: string, via: DiscoveredVia) => {
    const c = canonicalOwnedUrl(raw, host);
    if (!c || seen.has(c.key)) return;
    seen.add(c.key); state.hadPages = true;
    found.set(c.key, { url: c.url, via });
  };
  // Roots are reconstructed from robots once per pass; their hash restarts enumeration if the site
  // changes its list. Only the active ancestry is persisted, so a 50,000-child index cannot bloat state.
  let roots: { url: string; via: DiscoveredVia }[] | null = null;
  const rootsOf = async () => {
    if (roots) return true;
    const robots = await fetchText(`${origin}/robots.txt`, fetchImpl, perRequestMs);
    if (robots.retry) return false;
    const declared = robots.text ? parseRobotsText(robots.text, `${origin}/robots.txt`, 200).sitemaps : [];
    roots = [...declared.map((url) => ({ url, via: "robots_sitemap" as DiscoveredVia })),
      { url: `${origin}/sitemap.xml`, via: "sitemap" }, { url: `${origin}/sitemap_index.xml`, via: "sitemap" }];
    const hash = createHash("sha256").update(roots.map((r) => r.url).join("\n")).digest("hex").slice(0, 16);
    if (state.rootsHash && state.rootsHash !== hash) { state.root = 0; state.stack = []; state.hadPages = false; }
    state.rootsHash = hash;
    return true;
  };
  const onSite = (u: string): boolean => {
    try { return stripWww(new URL(u).hostname.toLowerCase()) === host; } catch { return false; }
  };
  const docs = new Map<string, { hash: string; children: string[]; entries: ReturnType<typeof parseSitemapUrlEntries> }>();
  let fetches = 0, done = false, held: DiscoveryResult["held"];
  while (!overBudget()) {
    if (state.stack.length === 0) {
      if (!await rootsOf()) { held = "robots_unreadable"; break; }
      if (state.root >= roots!.length) { done = true; break; }
      const root = roots![state.root++]!;
      state.stack.push({ ...root, depth: 0, offset: 0 });
    }
    const frame = state.stack.at(-1)!;
    if (!onSite(frame.url)) { state.stack.pop(); continue; }
    let doc = docs.get(frame.url);
    if (!doc) {
      if (fetches >= MAX_SITEMAP_FETCHES) break;
      const response = await fetchText(frame.url, fetchImpl, perRequestMs); fetches++;
      if (response.retry) { held = "sitemap_unreadable"; break; }
      if (response.text === null) { state.stack.pop(); continue; }
      doc = { hash: createHash("sha256").update(response.text).digest("hex").slice(0, 16), children: parseSitemapIndexLocs(response.text), entries: dedupeSitemapEntries(parseSitemapUrlEntries(response.text)) };
      docs.set(frame.url, doc);
    }
    if (frame.hash && frame.hash !== doc.hash) frame.offset = 0;
    frame.hash = doc.hash;
    if (doc.children.length > 0) {
      if (frame.offset >= doc.children.length) { state.stack.pop(); continue; }
      const child = doc.children[frame.offset]!;
      if (!onSite(child) || state.stack.some((f) => f.url === child)) { frame.offset++; continue; }
      if (state.stack.length >= MAX_SITEMAP_DEPTH) { held = "depth_limit"; break; }
      frame.offset++; state.stack.push({ url: child, depth: frame.depth + 1, via: frame.via, offset: 0 });
    } else {
      if (frame.offset >= doc.entries.length) { state.stack.pop(); continue; }
      if (found.size >= MAX_DISCOVERED_URLS) { truncated = doc.entries.length - frame.offset; break; }
      record(doc.entries[frame.offset++]!.url, frame.via);
    }
  }
  if (!done) { state.hold = held ?? "budget"; return { pages: [...found.values()], source: state.hadPages ? "sitemap" : "none",
    truncated, checkpoint: state, held: state.hold }; }
  if (state.hadPages) return { pages: [...found.values()], source: "sitemap", truncated: 0, checkpoint: null };

  // No sitemap supplied a page. Homepage/nav are the final, still bounded source.
  record(origin, "homepage");
  const homeHtml = overBudget() ? null : (await fetchText(origin, fetchImpl, perRequestMs)).text;
  if (homeHtml) for (const path of pickSecondaryPaths(homeHtml)) record(`${origin}${path}`, "nav");
  return { pages: [...found.values()], source: "homepage", truncated: 0, checkpoint: null };
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
    // THE INVENTORY IS THE RECORD, and this pass reads at most 18 of what it found. Without this
    // write the other pages were discovered and then forgotten, so the crawl phase had nothing to
    // work through. Failure-soft: a write that could not land still leaves this scan its pages.
    await upsertDiscovery(tenantId, discovered).catch(() => 0);
    const candidates: { url: string; key: string; path: string }[] = [];
    for (const d of discovered) {
      const c = canonicalOwnedUrl(d.url, site.host);
      if (!c) continue;
      candidates.push(c);
      if (candidates.length >= maxPages) break;
    }

    const robotsCache = new Map<string, ReturnType<typeof parseRobotsText>["directives"]>();
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
      // A FORWARD IS NOT A PAGE: an address that lands somewhere else never gets a content row wearing the
      // destination's words, or one page under three old slugs reads as three duplicates.
      const landed = res.finalUrl ? canonicalOwnedUrl(res.finalUrl, site.host) : null;
      if (landed && landed.key !== c.key) continue;
      const id = pageIdFor(c.key);
      const snap = extractPageSnapshot(res.html, c.url, id, tenantId, res.status, profile, res.finalUrl ?? c.url);
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
