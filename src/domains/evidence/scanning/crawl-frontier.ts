/**
 * crawl-frontier - the resumable, Vercel-safe crawl over the owned-page INVENTORY.
 *
 * WHY IT EXISTS: one serverless invocation can read a handful of pages and then dies. This module
 * turns that into a durable queue: every invocation crawls one BOUNDED batch (max pages plus a hard
 * time budget, both inside a serverless window), persists its cursor, and stops. A visit runs
 * exactly one more batch until the site is read.
 *
 * WHAT CHANGED 2026-08-03: the frontier is no longer the inventory. owned_pages is, and it is
 * unbounded. This blob is now only the ORDER of one crawl: a small working set refilled from the
 * inventory (uncrawled first, then stale, then blocked pages past their retry date), plus the
 * per-page facts the first-look preview reads. Every read writes its state back to the inventory,
 * so a blocked page waits out its backoff and a page that 404s is never asked for again.
 *
 * Discipline (same posture as in-process-scan): crawl-only and $0, polite identified fetch with
 * robots respected and a hard timeout, sequential with a small delay, the SAME stable page ids so
 * batches upsert the same rows, and failure-soft returns instead of throws.
 */

import { fetchPageHtml } from "@/domains/evidence/competitor-intel/polite-fetch";
import { loadBusinessProfile } from "@/domains/account";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import type { PageEntity, PageSnapshot } from "@/domains/evidence/pages/types";
import { syncPages, syncPageSnapshots } from "@/lib/persistence/dual-write";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";
import {
  canonicalOwnedUrl,
  discoverUrls,
  inferPageType,
  originFromDomain,
  pageIdFor,
} from "./in-process-scan";
import { markBlocked, markCrawled, nextCrawlCandidates, upsertDiscovery } from "./owned-pages-store";

const STORE = "crawl-frontier";

/** Total pages ONE site's cold-start crawl will ever read. Raised from 150 to 600 (2026-08-03):
 *  the inventory is unbounded, and a real small-business or encyclopedia site is hundreds of pages,
 *  not 150. Per-PASS work is unchanged, so this costs wall clock spread over visits, never one
 *  longer invocation. */
export const CRAWL_PAGE_CAP = 600;
/** One batch = one serverless invocation. Both bounds are hard. */
export const BATCH_MAX_PAGES = 15;
export const BATCH_BUDGET_MS = 45_000;
const PER_REQUEST_MS = 8_000;
/** Politeness delay between sequential pulls. */
const INTER_FETCH_DELAY_MS = 250;
/** Discovery (robots, sitemaps, homepage) shares one bounded budget at init. */
const DISCOVERY_BUDGET_MS = 12_000;
/** The queued WORKING SET, refilled from the inventory. Small on purpose: the durable list of URLs
 *  is owned_pages, and this blob is mirrored on every write. */
const MAX_FRONTIER_URLS = 200;
/** Preview facts kept in the blob, independent of the page cap so a 600-page site does not carry a
 *  600-entry payload through every mirror. */
const MAX_PAGE_FACTS = 150;
/** Question lines kept per page fact. */
const MAX_QUESTIONS_PER_PAGE = 6;

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
  /** URLs waiting to be read (a bounded working set, refilled from the inventory). */
  frontier: string[];
  /** Stable url keys already attempted this crawl. */
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
  /** Inventory seams (tests inject; production uses owned-pages-store). */
  recordDiscovery?: typeof upsertDiscovery;
  pickCandidates?: typeof nextCrawlCandidates;
  recordCrawled?: typeof markCrawled;
  recordBlocked?: typeof markBlocked;
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

/** Every persisted frontier row (the stalled-signup rescue reads the whole set once). */
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

/**
 * PURE frontier math: add newly discovered links to the working set. Skips keys already visited or
 * already queued, and never grows the total workload (visited + queued) past the page cap.
 */
export function enqueueDiscovered(
  state: Pick<CrawlFrontierState, "frontier" | "visited" | "page_cap" | "domain">,
  candidates: readonly string[],
  baseUrl?: string,
): { frontier: string[]; added: number } {
  const visited = new Set(state.visited);
  const queuedKeys = new Set<string>();
  for (const url of state.frontier) {
    const n = canonicalOwnedUrl(url, state.domain);
    if (n) queuedKeys.add(n.key);
  }
  const next = [...state.frontier];
  let added = 0;
  for (const raw of candidates) {
    if (visited.size + next.length >= state.page_cap) break;
    if (next.length >= MAX_FRONTIER_URLS) break;
    const n = canonicalOwnedUrl(raw, state.domain, baseUrl);
    if (!n) continue;
    if (visited.has(n.key) || queuedKeys.has(n.key)) continue;
    queuedKeys.add(n.key);
    next.push(n.url);
    added++;
  }
  return { frontier: next, added };
}

const QUESTION_SHAPE_RE = /^(what|how|why|when|where|who|which|is|are|does|do|can|should)\b|\?\s*$/i;

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

/** The honest one-line progress sentence (concrete numbers, a next step, no lab words). */
export function crawlProgressLine(
  state: Pick<CrawlFrontierState, "status" | "pages_crawled" | "frontier" | "visited" | "page_cap" | "domain">,
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

/** PURE. What one failed fetch means as an HTTP status: the server's own number when we have it,
 *  403 for a robots refusal (the site declining is the same fact from the crawler's side), and 0
 *  for a transport failure, which leaves the page eligible rather than writing it off. */
export function failureStatusOf(result: { reason: string; detail?: string }): number {
  const m = /^http_(\d{3})$/.exec(result.detail ?? "");
  if (m) return Number(m[1]);
  return result.reason === "robots_blocked" ? 403 : 0;
}

/** PURE. How much of the page the stored snapshot holds. `partial` only when the extractor's own
 *  ceiling cut the text; everything else read whole is `complete`. */
export function completenessOf(snap: PageSnapshot): "complete" | "partial" {
  return (snap.structural_warnings ?? []).some((w) => w.startsWith("body_text_truncated"))
    ? "partial"
    : "complete";
}

// ---------------------------------------------------------------------------
// Init: bounded discovery -> durable inventory -> working set
// ---------------------------------------------------------------------------

export type StartCrawlResult = {
  status: CrawlFrontierStatus;
  discovered: number;
  /** URLs found past the per-pass discovery ceiling, counted rather than hidden. */
  truncated?: number;
  detail?: string;
};

/**
 * Initialize (or force-reset) the crawl for a tenant: one bounded discovery pass, recorded in the
 * DURABLE inventory, then a working set drawn from that inventory. Does NOT crawl content pages
 * itself. Failure-soft; never throws.
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
  const recordDiscovery = deps.recordDiscovery ?? upsertDiscovery;
  const pickCandidates = deps.pickCandidates ?? nextCrawlCandidates;

  try {
    if (!args.tenantId.trim()) return { status: "unreachable", discovered: 0, detail: "tenant_id_required" };
    const site = originFromDomain(args.domain);
    if (!site) return { status: "unreachable", discovered: 0, detail: "no_usable_domain" };

    if (!args.force) {
      const existing = await load(args.tenantId);
      if (existing && existing.status !== "unreachable" && existing.domain === site.host) {
        return { status: existing.status, discovered: existing.visited.length + existing.frontier.length };
      }
    }

    const started = now();
    const { pages: discovered, source, truncated } = await discoverUrls(
      site.origin, fetchImpl, perRequestMs, now, started + DISCOVERY_BUDGET_MS);
    if (truncated > 0) {
      log.warn("[crawl-frontier] the site has more pages than one discovery pass records", {
        tenant: args.tenantId, recorded: discovered.length, past_ceiling: truncated });
    }

    // THE INVENTORY IS THE RECORD. A failed write is logged and the crawl still runs off what this
    // pass found, because a first look the operator can see beats a durable nothing.
    const recorded = await recordDiscovery(args.tenantId, discovered).catch(() => 0);
    if (recorded === 0 && discovered.length > 0) {
      log.warn("[crawl-frontier] I found pages but could not record them in the inventory yet", {
        tenant: args.tenantId, found: discovered.length });
    }

    // A single homepage seed is UNVERIFIED: discovery cannot tell "no links" from "no answer", so
    // probe it once and let a dead site read as honestly unreachable.
    const nowIsoStart = new Date(now()).toISOString();
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
      started_at: nowIsoStart,
      updated_at: nowIsoStart,
      last_batch_at: null,
      batches_run: 0,
      page_facts: [],
    };
    if (source === "homepage" && discovered.length === 1) {
      const probe = await fetchPageHtml(site.origin, new Map(), { fetchImpl, timeoutMs: perRequestMs });
      if (!probe.ok) {
        const dead: CrawlFrontierState = {
          ...base,
          status: "unreachable",
          source: "none",
          detail: probe.reason === "robots_blocked" ? "robots_blocked" : "no_reachable_pages",
        };
        await save(dead);
        return { status: "unreachable", discovered: 0, detail: dead.detail };
      }
    }

    // The working set comes from the INVENTORY when it is there, so a resumed account picks up the
    // pages it never reached; this pass's own findings are the fallback.
    const fromInventory = await pickCandidates(args.tenantId, MAX_FRONTIER_URLS, new Date(now())).catch(() => []);
    const seeds = fromInventory.length > 0 ? fromInventory : discovered.map((d) => d.url);
    const { frontier, added } = enqueueDiscovered(base, seeds);
    if (added === 0) {
      const dead: CrawlFrontierState = { ...base, status: "unreachable", detail: "no_reachable_pages" };
      await save(dead);
      return { status: "unreachable", discovered: 0, detail: "no_reachable_pages" };
    }
    await save({ ...base, frontier });
    return { status: "in_progress", discovered: Math.max(added, discovered.length), truncated };
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
 * Crawl exactly one bounded batch: at most `maxPagesPerBatch` pages and at most `batchBudgetMs` of
 * wall clock, whichever ends first. The working set is refilled from the inventory when it runs
 * dry, each page is robots-checked and politely fetched, snapshotted through the SAME extractor and
 * dual-write as every other scan, and WHAT THE READ FOUND IS WRITTEN BACK to the inventory: crawled
 * with the hash of the text held, blocked with a bounded retry date, or gone. Newly discovered
 * same-host links are recorded too. Failure-soft; never throws.
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
  const pickCandidates = deps.pickCandidates ?? nextCrawlCandidates;
  const recordDiscovery = deps.recordDiscovery ?? upsertDiscovery;
  const recordCrawled = deps.recordCrawled ?? markCrawled;
  const recordBlocked = deps.recordBlocked ?? markBlocked;

  const noRun = (detail: string, status: CrawlBatchResult["status"]): CrawlBatchResult => ({
    ran: false, status, crawled: 0, failed: 0, totalCrawled: 0, remaining: 0,
    complete: status === "complete", detail,
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

    // REFILL FROM THE INVENTORY. An empty working set no longer means the site is finished: it
    // means this blob is spent, and the inventory knows what is still uncrawled or due again.
    if (frontier.length === 0 && visited.size < state.page_cap) {
      const more = await pickCandidates(args.tenantId, MAX_FRONTIER_URLS, new Date(now())).catch(() => []);
      frontier = enqueueDiscovered({ ...state, frontier: [], visited: [...visited] }, more).frontier;
    }

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
      const n = canonicalOwnedUrl(rawUrl, state.domain);
      if (!n || visited.has(n.key)) continue;
      visited.add(n.key);
      attempts++;

      const res = await fetchPageHtml(n.url, robotsCache, { fetchImpl, timeoutMs: perRequestMs });
      if (!res.ok) {
        failed++;
        await recordBlocked(args.tenantId, n.url, failureStatusOf(res), new Date(now())).catch(() => false);
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
      await recordCrawled(args.tenantId, n.url, {
        httpStatus: res.status,
        contentHash: snap.content_hash,
        completeness: completenessOf(snap),
        isCanonicalTarget: !snap.has_canonical_mismatch,
        redirectsTo: res.finalUrl && res.finalUrl !== n.url ? res.finalUrl : null,
      }, new Date(now())).catch(() => false);

      // The page's own internal links are discovery too: they go to the inventory AND the queue.
      const hrefs = (snap.internal_links ?? []).map((l) => l.href);
      if (hrefs.length > 0) {
        const linked = hrefs
          .map((h) => canonicalOwnedUrl(h, state.domain, n.url))
          .filter((c): c is NonNullable<typeof c> => c != null)
          .map((c) => ({ url: c.url, via: "nav" as const }));
        if (linked.length > 0) await recordDiscovery(args.tenantId, linked).catch(() => 0);
        frontier = enqueueDiscovered(
          { frontier, visited: [...visited], page_cap: state.page_cap, domain: state.domain },
          hrefs, n.url,
        ).frontier;
      }

      if (frontier.length > 0 && attempts < maxPages && now() < deadlineAt) {
        await sleep(INTER_FETCH_DELAY_MS);
      }
    }

    // Persist inventory FIRST (the pages registry is a prerequisite for snapshots), and only then
    // advance the durable cursor. Neither write is optional: if either fails the cursor must NOT
    // advance, or these pages are marked visited forever and never read again.
    const notPersisted = (kind: string, e: unknown): CrawlBatchResult => ({
      ran: true, status: "in_progress", crawled: 0, failed,
      totalCrawled: state.pages_crawled, remaining: state.frontier.length, complete: false,
      detail: `${kind}:${e instanceof Error ? e.message.slice(0, 120) : "?"}`,
    });
    if (pages.length > 0) {
      try { await syncPagesImpl(pages, args.tenantId); }
      catch (e) { return notPersisted("pages_registry_write_failed", e); }
      try { await syncSnapshotsImpl(snapshots, args.tenantId); }
      catch (e) { return notPersisted("snapshot_write_failed", e); }
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
      page_facts: [...state.page_facts, ...newFacts].slice(0, MAX_PAGE_FACTS),
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
    return { ...noRun(e instanceof Error ? e.message.slice(0, 160) : String(e), "no_crawl"), ran: false };
  }
}

/**
 * Continue exactly one more batch for a tenant whose crawl is still in progress. A no-op when
 * never started, finished, or unreachable. Never throws.
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
      ran: false, status: "no_crawl", crawled: 0, failed: 0, totalCrawled: 0, remaining: 0,
      complete: false, detail: e instanceof Error ? e.message.slice(0, 160) : String(e),
    };
  }
}
