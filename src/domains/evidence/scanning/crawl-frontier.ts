/**
 * crawl-frontier (2026-07-03, BEACON_500 R12 / T0e) - the resumable,
 * Vercel-safe cold-start crawl PAST the 18-page launch cap.
 *
 * WHY: `runInProcessColdStartScan` reads at most 18 pages in one serverless
 * invocation and then stops forever. A 120-page site never gets its long
 * tail read unless the operator wires a GitHub PAT. This module turns the
 * cold-start into a durable QUEUE: every invocation crawls one BOUNDED batch
 * (max pages + a hard time budget, both well inside a serverless window),
 * persists the frontier cursor, and stops. Visit-driven continuation runs
 * exactly one more batch each time until the frontier is exhausted or the
 * 150-page cap is reached.
 *
 * Persistence: a GLOBAL json-store ("crawl-frontier") whose rows carry
 * tenant_id, Supabase-mirrored so the cursor survives Vercel's read-only,
 * recycled lambdas.
 *
 * Discipline (same posture as in-process-scan):
 *   - Crawl-only, $0: polite fetch (identified UA, robots.txt respected,
 *     hard per-request timeout, sequential + a small delay between pulls).
 *   - Same stable page ids (`page-<sha16(urlKey)>`) as the launch crawler,
 *     so batches UPSERT the same rows and re-runs stay idempotent.
 *   - Failure-soft: never throws to the caller; returns structured results.
 *   - Compact per-page audit facts (title/meta/h1/word count/questions) ride
 *     the frontier state itself so the /onboard/done scorecard composes at
 *     $0 with zero extra reads, on file mode and hosted prod alike.
 */

import { fetchPageHtml } from "@/domains/evidence/competitor-intel/polite-fetch";
import { loadBusinessProfile } from "@/domains/account";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import type { PageEntity, PageSnapshot } from "@/domains/evidence/pages/types";
import { syncPages, syncPageSnapshots } from "@/lib/persistence/dual-write";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import {
  discoverUrls,
  inferPageType,
  normPath,
  originFromDomain,
  pageIdFor,
  stripWww,
  urlKey,
} from "./in-process-scan";

const STORE = "crawl-frontier";

/** Total pages the cold-start queue will ever read for one site. */
export const CRAWL_PAGE_CAP = 150;
/** One batch = one serverless invocation. Both bounds are hard. */
export const BATCH_MAX_PAGES = 15;
export const BATCH_BUDGET_MS = 45_000;
const PER_REQUEST_MS = 8_000;
/** Small politeness delay between sequential pulls (same posture as the
 *  competitor teardown crawler: identified UA + sequential + unhurried). */
const INTER_FETCH_DELAY_MS = 250;
/** Discovery (sitemap + homepage) shares one bounded budget at init. */
const DISCOVERY_BUDGET_MS = 12_000;
/** Keep the queued tail bounded too - a 10k-URL sitemap must not bloat the
 *  mirrored blob. The cap is what we will ever crawl anyway. */
const MAX_FRONTIER_URLS = CRAWL_PAGE_CAP;
/** Question lines kept per page fact (titles/headings that read like a
 *  question, kept for the deterministic profile read). */
const MAX_QUESTIONS_PER_PAGE = 6;

/** File-ish URLs a content crawl should never spend budget on. */
const NON_HTML_EXT_RE =
  /\.(?:jpe?g|png|gif|webp|svg|ico|css|js|json|xml|pdf|zip|gz|mp4|mp3|webm|woff2?|ttf|eot|avif)$/i;

export type CrawlPageFact = {
  url: string;
  path: string;
  title: string | null;
  h1: string | null;
  has_meta_description: boolean;
  word_count: number;
  faq_count: number;
  /** Question-shaped title/headings/FAQ questions found on the page. */
  questions: string[];
};

export type CrawlFrontierStatus = "in_progress" | "complete" | "unreachable";

export type CrawlFrontierState = {
  tenant_id: string;
  /** Bare domain (www-stripped, lowercased). */
  domain: string;
  status: CrawlFrontierStatus;
  /** URLs waiting to be read (bounded). */
  frontier: string[];
  /** Stable url keys already attempted (crawled or failed) - never retried. */
  visited: string[];
  /** Pages successfully read + snapshotted. */
  pages_crawled: number;
  /** Fetch attempts that failed (robots block, HTTP error, timeout). */
  pages_failed: number;
  page_cap: number;
  source: "sitemap" | "homepage" | "none";
  started_at: string;
  updated_at: string;
  last_batch_at: string | null;
  batches_run: number;
  /** Compact audit facts per crawled page - the first-look preview's input. */
  page_facts: CrawlPageFact[];
  /** Honest failure detail when status is "unreachable". */
  detail?: string;
};

export type CrawlFrontierDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Injectable delay so tests never actually wait. */
  sleep?: (ms: number) => Promise<void>;
  maxPagesPerBatch?: number;
  batchBudgetMs?: number;
  perRequestMs?: number;
  pageCap?: number;
  syncPagesImpl?: typeof syncPages;
  syncPageSnapshotsImpl?: typeof syncPageSnapshots;
  loadState?: (tenantId: string) => Promise<CrawlFrontierState | null>;
  saveState?: (state: CrawlFrontierState) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Store access (GLOBAL rows keyed by tenant_id - cron fans out tenant-less)
// ---------------------------------------------------------------------------

export async function loadCrawlFrontier(tenantId: string): Promise<CrawlFrontierState | null> {
  try {
    const rows = (await readStore<CrawlFrontierState>(STORE)) ?? [];
    return rows.find((r) => r && r.tenant_id === tenantId) ?? null;
  } catch {
    return null;
  }
}

export async function saveCrawlFrontier(state: CrawlFrontierState): Promise<void> {
  const rows = (await readStore<CrawlFrontierState>(STORE)) ?? [];
  const others = rows.filter((r) => r && r.tenant_id !== state.tenant_id);
  await writeStore<CrawlFrontierState>(STORE, [...others, state]);
}

/** Every persisted frontier row (the /diagnostics stalled-signup rescue
 *  reads the whole set once instead of N per-tenant lookups). */
export async function loadAllCrawlFrontiers(): Promise<CrawlFrontierState[]> {
  try {
    const rows = (await readStore<CrawlFrontierState>(STORE)) ?? [];
    return rows.filter((r) => r != null && typeof r === "object" && Boolean(r.tenant_id));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** Normalize one discovered link against the crawl's host. Returns null for
 *  cross-host links, non-http(s) schemes, and obvious non-HTML files. */
export function normalizeCrawlUrl(
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
  // Query strings and fragments are dropped: one canonical read per path.
  return { url: `${u.protocol}//${u.hostname}${path === "/" ? "/" : path}`, key: urlKey(u), path };
}

/**
 * PURE frontier math: add newly discovered links to the queue. Skips keys
 * already visited or already queued, and never grows the total workload
 * (visited + queued) past the page cap. Returns the next frontier plus how
 * many links were actually added. `queuedKeys` is derived from the frontier
 * itself so callers cannot drift the two.
 */
export function enqueueDiscovered(
  state: Pick<CrawlFrontierState, "frontier" | "visited" | "page_cap" | "domain">,
  candidates: readonly string[],
  baseUrl?: string,
): { frontier: string[]; added: number } {
  const visited = new Set(state.visited);
  const queuedKeys = new Set<string>();
  for (const url of state.frontier) {
    const n = normalizeCrawlUrl(url, state.domain);
    if (n) queuedKeys.add(n.key);
  }
  const next = [...state.frontier];
  let added = 0;
  for (const raw of candidates) {
    if (visited.size + next.length >= state.page_cap) break;
    if (next.length >= MAX_FRONTIER_URLS) break;
    const n = normalizeCrawlUrl(raw, state.domain, baseUrl);
    if (!n) continue;
    if (visited.has(n.key) || queuedKeys.has(n.key)) continue;
    queuedKeys.add(n.key);
    next.push(n.url);
    added++;
  }
  return { frontier: next, added };
}

const QUESTION_SHAPE_RE =
  /^(what|how|why|when|where|who|which|is|are|does|do|can|should)\b|\?\s*$/i;

/** Question-shaped lines on one snapshot: title, H1/H2s, FAQ questions. */
export function questionLinesFromSnapshot(snap: {
  title: string | null;
  h1: string | null;
  h2_list: string[];
  faqs: { question: string }[];
}): string[] {
  const out: string[] = [];
  const push = (line: string | null | undefined) => {
    const t = (line ?? "").trim();
    if (!t || t.length < 8 || t.length > 160) return;
    if (!QUESTION_SHAPE_RE.test(t)) return;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    if (out.length < MAX_QUESTIONS_PER_PAGE) out.push(t);
  };
  push(snap.title);
  push(snap.h1);
  for (const h2 of snap.h2_list) push(h2);
  for (const f of snap.faqs) push(f.question);
  return out;
}

/** The compact scorecard fact for one crawled page. */
export function pageFactFromSnapshot(snap: PageSnapshot, path: string): CrawlPageFact {
  return {
    url: snap.url,
    path,
    title: snap.title,
    h1: snap.h1,
    has_meta_description: Boolean(snap.meta_description?.trim()),
    word_count: snap.word_count,
    faq_count: snap.faqs.length,
    questions: questionLinesFromSnapshot(snap),
  };
}

/**
 * The honest one-line progress sentence (Beacon voice: concrete numbers,
 * a next step, no lab words, no em or en dashes).
 */
export function crawlProgressLine(
  state: Pick<
    CrawlFrontierState,
    "status" | "pages_crawled" | "frontier" | "visited" | "page_cap" | "domain"
  >,
): string {
  if (state.status === "unreachable") {
    return `I could not reach ${state.domain}. Check the address and try again.`;
  }
  const total = Math.min(state.visited.length + state.frontier.length, state.page_cap);
  if (state.status === "complete") {
    return `I read ${state.pages_crawled} pages on ${state.domain}. That is every page I could find, so the first look is complete.`;
  }
  return `I have read ${state.pages_crawled} of about ${Math.max(total, state.pages_crawled)} pages so far. I keep going in the background.`;
}

// ---------------------------------------------------------------------------
// Init: bounded discovery -> persisted queue
// ---------------------------------------------------------------------------

export type StartCrawlResult = {
  status: CrawlFrontierStatus;
  discovered: number;
  detail?: string;
};

/**
 * Initialize (or force-reset) the crawl queue for a tenant: one bounded
 * discovery pass (sitemap.xml incl. index, else homepage + nav links), then
 * persist the frontier. Does NOT crawl content pages itself - the first
 * batch is the caller's next step. Failure-soft; never throws.
 */
export async function startColdStartCrawl(args: {
  tenantId: string;
  domain: string;
  force?: boolean;
  deps?: CrawlFrontierDeps;
}): Promise<StartCrawlResult> {
  const deps = args.deps ?? {};
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const perRequestMs = deps.perRequestMs ?? PER_REQUEST_MS;
  const pageCap = Math.max(1, Math.min(deps.pageCap ?? CRAWL_PAGE_CAP, CRAWL_PAGE_CAP));
  const load = deps.loadState ?? loadCrawlFrontier;
  const save = deps.saveState ?? saveCrawlFrontier;

  try {
    if (!args.tenantId.trim()) return { status: "unreachable", discovered: 0, detail: "tenant_id_required" };
    const site = originFromDomain(args.domain);
    if (!site) return { status: "unreachable", discovered: 0, detail: "no_usable_domain" };

    if (!args.force) {
      const existing = await load(args.tenantId);
      if (existing && existing.status !== "unreachable" && existing.domain === site.host) {
        // Already queued for this domain - init is idempotent.
        return { status: existing.status, discovered: existing.visited.length + existing.frontier.length };
      }
    }

    const started = now();
    const { urls, source } = await discoverUrls(
      site.origin,
      fetchImpl,
      perRequestMs,
      pageCap,
      now,
      started + DISCOVERY_BUDGET_MS,
    );

    // The homepage fallback seeds the bare origin even when the homepage
    // fetch itself failed (discoverUrls cannot tell "no links" from "no
    // answer"). A single-URL homepage seed is therefore unverified: probe it
    // once so a dead site becomes an HONEST unreachable state instead of a
    // queue that fails forever one batch at a time.
    if (source === "homepage" && urls.length === 1) {
      const probe = await fetchPageHtml(site.origin, new Map(), {
        fetchImpl,
        timeoutMs: perRequestMs,
      });
      if (!probe.ok) {
        const nowIsoDead = new Date(now()).toISOString();
        const dead: CrawlFrontierState = {
          tenant_id: args.tenantId,
          domain: site.host,
          status: "unreachable",
          frontier: [],
          visited: [],
          pages_crawled: 0,
          pages_failed: 0,
          page_cap: pageCap,
          source: "none",
          started_at: nowIsoDead,
          updated_at: nowIsoDead,
          last_batch_at: null,
          batches_run: 0,
          page_facts: [],
          detail: probe.reason === "robots_blocked" ? "robots_blocked" : "no_reachable_pages",
        };
        await save(dead);
        return { status: "unreachable", discovered: 0, detail: dead.detail };
      }
    }

    const nowIso = new Date(now()).toISOString();
    const base: CrawlFrontierState = {
      tenant_id: args.tenantId,
      domain: site.host,
      status: "in_progress",
      frontier: [],
      visited: [],
      pages_crawled: 0,
      pages_failed: 0,
      page_cap: pageCap,
      source,
      started_at: nowIso,
      updated_at: nowIso,
      last_batch_at: null,
      batches_run: 0,
      page_facts: [],
    };
    const { frontier, added } = enqueueDiscovered(base, urls);
    // A homepage-source discovery whose ONLY yield failed (not even the
    // homepage answered) is discoverUrls returning the origin seed; a truly
    // dead site yields zero usable candidates only when the domain itself
    // is unusable, so treat an empty frontier as unreachable, honestly.
    if (added === 0) {
      const dead: CrawlFrontierState = {
        ...base,
        status: "unreachable",
        detail: "no_reachable_pages",
        updated_at: new Date(now()).toISOString(),
      };
      await save(dead);
      return { status: "unreachable", discovered: 0, detail: "no_reachable_pages" };
    }
    await save({ ...base, frontier });
    return { status: "in_progress", discovered: added };
  } catch (e) {
    return {
      status: "unreachable",
      discovered: 0,
      detail: e instanceof Error ? e.message.slice(0, 160) : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// One bounded batch (one serverless invocation)
// ---------------------------------------------------------------------------

export type CrawlBatchResult = {
  ran: boolean;
  status: CrawlFrontierStatus | "no_crawl";
  crawled: number;
  failed: number;
  totalCrawled: number;
  remaining: number;
  complete: boolean;
  detail?: string;
};

/**
 * Crawl exactly one bounded batch off the persisted frontier: at most
 * `maxPagesPerBatch` pages and at most `batchBudgetMs` of wall clock,
 * whichever ends first. Each page is robots-checked, politely fetched,
 * snapshotted through the SAME extractor + dual-write as every other scan
 * (stable ids -> idempotent upserts), and newly discovered same-host links
 * are queued. The cursor persists even when every fetch fails, so a flaky
 * night can never wedge the queue. Failure-soft; never throws.
 */
export async function runCrawlBatch(args: {
  tenantId: string;
  deps?: CrawlFrontierDeps;
}): Promise<CrawlBatchResult> {
  const deps = args.deps ?? {};
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const perRequestMs = deps.perRequestMs ?? PER_REQUEST_MS;
  const maxPages = Math.max(1, Math.min(deps.maxPagesPerBatch ?? BATCH_MAX_PAGES, BATCH_MAX_PAGES));
  const budgetMs = Math.min(deps.batchBudgetMs ?? BATCH_BUDGET_MS, BATCH_BUDGET_MS);
  const syncPagesImpl = deps.syncPagesImpl ?? syncPages;
  const syncSnapshotsImpl = deps.syncPageSnapshotsImpl ?? syncPageSnapshots;
  const load = deps.loadState ?? loadCrawlFrontier;
  const save = deps.saveState ?? saveCrawlFrontier;

  const noRun = (detail: string, status: CrawlBatchResult["status"]): CrawlBatchResult => ({
    ran: false,
    status,
    crawled: 0,
    failed: 0,
    totalCrawled: 0,
    remaining: 0,
    complete: status === "complete",
    detail,
  });

  try {
    const state = await load(args.tenantId);
    if (!state) return noRun("no_frontier_state", "no_crawl");
    if (state.status === "unreachable") return noRun("unreachable", "unreachable");
    if (state.status === "complete") {
      return { ...noRun("already_complete", "complete"), totalCrawled: state.pages_crawled };
    }

    const started = now();
    const deadlineAt = started + budgetMs;
    const robotsCache = new Map<string, string[]>();
    const visited = new Set(state.visited);
    let frontier = [...state.frontier];

    const snapshots: PageSnapshot[] = [];
    const pages: PageEntity[] = [];
    const newFacts: CrawlPageFact[] = [];
    let crawled = 0;
    let failed = 0;
    let attempts = 0;
    const nowIso = new Date(now()).toISOString();
    // One durable profile read for the whole batch; extraction is pure.
    const profile = await loadBusinessProfile(args.tenantId).catch(() => null);


    while (frontier.length > 0 && attempts < maxPages && now() < deadlineAt) {
      if (visited.size >= state.page_cap) break;
      const rawUrl = frontier.shift()!;
      const n = normalizeCrawlUrl(rawUrl, state.domain);
      if (!n || visited.has(n.key)) continue;
      visited.add(n.key);
      attempts++;

      const res = await fetchPageHtml(n.url, robotsCache, { fetchImpl, timeoutMs: perRequestMs });
      if (!res.ok) {
        failed++;
        continue;
      }
      const id = pageIdFor(n.key);
      const snap = extractPageSnapshot(res.html, n.url, id, args.tenantId, res.status, profile);
      snapshots.push(snap);
      newFacts.push(pageFactFromSnapshot(snap, n.path));
      pages.push({
        id,
        url: n.url,
        canonical_url: snap.canonical_url ?? n.url,
        domain: state.domain,
        path: n.path,
        page_type: inferPageType(n.path),
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
        metadata: { source: "cold_start_frontier" },
        tenant_id: args.tenantId,
      });
      crawled++;

      // Queue the page's own internal links (same host, capped, deduped).
      const hrefs = (snap.internal_links ?? []).map((l) => l.href);
      if (hrefs.length > 0) {
        const result = enqueueDiscovered(
          { frontier, visited: [...visited], page_cap: state.page_cap, domain: state.domain },
          hrefs,
          n.url,
        );
        frontier = result.frontier;
      }

      if (frontier.length > 0 && attempts < maxPages && now() < deadlineAt) {
        await sleep(INTER_FETCH_DELAY_MS);
      }
    }

    // Persist inventory FIRST (pages registry is a prerequisite for
    // snapshots - same contract as in-process-scan audit-6 #4), and only
    // then advance the durable cursor for those rows.
    if (pages.length > 0) {
      try {
        await syncPagesImpl(pages, args.tenantId);
      } catch (e) {
        // Registry write failed: do NOT mark these pages visited, so the
        // next batch retries them instead of orphaning their snapshots.
        return {
          ran: true,
          status: "in_progress",
          crawled: 0,
          failed,
          totalCrawled: state.pages_crawled,
          remaining: state.frontier.length,
          complete: false,
          detail: `pages_registry_write_failed:${e instanceof Error ? e.message.slice(0, 120) : "?"}`,
        };
      }
      try {
        await syncSnapshotsImpl(snapshots, args.tenantId);
      } catch (e) {
        console.error(
          `[crawl-frontier] snapshot write failed (tenant=${args.tenantId}): ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    const capReached = visited.size >= state.page_cap;
    const complete = frontier.length === 0 || capReached;
    const updatedIso = new Date(now()).toISOString();
    const next: CrawlFrontierState = {
      ...state,
      status: complete ? "complete" : "in_progress",
      frontier: capReached ? [] : frontier,
      visited: [...visited],
      pages_crawled: state.pages_crawled + crawled,
      pages_failed: state.pages_failed + failed,
      updated_at: updatedIso,
      last_batch_at: updatedIso,
      batches_run: state.batches_run + 1,
      page_facts: [...state.page_facts, ...newFacts].slice(0, state.page_cap),
    };
    await save(next);

    return {
      ran: true,
      status: next.status,
      crawled,
      failed,
      totalCrawled: next.pages_crawled,
      remaining: next.frontier.length,
      complete,
    };
  } catch (e) {
    return {
      ...noRun(e instanceof Error ? e.message.slice(0, 160) : String(e), "no_crawl"),
      ran: false,
    };
  }
}

/**
 * Continue exactly one more batch for a tenant whose crawl is still in
 * progress. A no-op when never started, finished, or unreachable. Never throws.
 */
export async function continueColdStartCrawlIfStarted(
  tenantId: string,
  deps?: CrawlFrontierDeps,
): Promise<CrawlBatchResult> {
  const load = deps?.loadState ?? loadCrawlFrontier;
  try {
    const state = await load(tenantId);
    if (!state || state.status !== "in_progress") {
      return {
        ran: false,
        status: state?.status ?? "no_crawl",
        crawled: 0,
        failed: 0,
        totalCrawled: state?.pages_crawled ?? 0,
        remaining: state?.frontier.length ?? 0,
        complete: state?.status === "complete",
        detail: state ? state.status : "no_frontier_state",
      };
    }
    return await runCrawlBatch({ tenantId, deps });
  } catch (e) {
    return {
      ran: false,
      status: "no_crawl",
      crawled: 0,
      failed: 0,
      totalCrawled: 0,
      remaining: 0,
      complete: false,
      detail: e instanceof Error ? e.message.slice(0, 160) : String(e),
    };
  }
}
