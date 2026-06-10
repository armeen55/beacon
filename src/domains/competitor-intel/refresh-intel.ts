import "server-only";

/**
 * 2026-06-09 — Competitor-intel refresh (operator-triggered).
 *
 * One pass, sequential and polite:
 *   1. Crawl tracked competitors' sitemaps (existing crawler), detect
 *      page changes vs the stored snapshots, save the shared monitoring
 *      state (same replace semantics the crawl script uses — Today's
 *      alerts depend on them) AND append this run's changes to the
 *      durable sitemap-change history move detection reads.
 *   2. Pick the pages worth structural eyes: their most-cited URLs
 *      (competitor-page-evidence, existing top-N picker) + URLs that
 *      just changed in step 1. Bounded.
 *   3. Fetch each (robots-respecting, identified UA, 10s timeout,
 *      sequential), extract structure with the owned-page extractor,
 *      diff vs the stored snapshot, persist fresh snapshots + any
 *      detected structural changes.
 *
 * No cron — operator-triggered, same posture as every other connector
 * refresh. `fetchImpl` is injectable so tests never touch the network.
 */

import { createHash } from "crypto";

import { crawlAllCompetitors } from "@/domains/competitor-monitoring/sitemap-crawler";
import type { CompetitorSitemapSnapshot } from "@/domains/competitor-monitoring/types";
import { detectCompetitorChanges } from "@/domains/competitor-monitoring/detect-changes";
import {
  getCompetitorMonitoringState,
  saveCompetitorMonitoringState,
} from "@/domains/competitor-monitoring/store";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { getCompetitorPages } from "@/domains/pages/competitor-evidence";
import {
  getCompetitorPageSnapshotsByUrl,
  persistCompetitorPageSnapshots,
  pickTopCompetitorUrls,
  type CompetitorPageSnapshot,
} from "@/domains/pages/competitor-page-snapshots";
import { extractPageSnapshot } from "@/domains/pages/extractor";
import { currentTenantId } from "@/lib/tenant-context";

import { diffCompetitorPageStructure } from "./structural-diff";
import { normalizeHost } from "./citation-series";
import { appendCompetitorStructuralChanges } from "./structural-changes-store";
import { appendCompetitorSitemapChanges } from "./sitemap-changes-store";
import { fetchPageHtml, type PoliteFetchDeps } from "./polite-fetch";

/** Most-cited competitor URLs to keep structural eyes on per refresh. */
const TOP_CITED_URL_CAP = 12;
/** Just-changed URLs from this run's sitemap diff to also fetch. */
const CHANGED_URL_CAP = 8;

export type RefreshCompetitorIntelResult = {
  ok: true;
  competitorsCrawled: number;
  sitemapChangesDetected: number;
  sitemapChangesRecorded: number;
  urlsFetched: number;
  urlsBlocked: number;
  urlsFailed: number;
  structuralChangesDetected: number;
};

function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

function toCompetitorSnapshot(args: {
  url: string;
  html: string;
  status: number;
  tenantId: string;
  fetchedAt: string;
}): CompetitorPageSnapshot {
  // Narrow the owned-page extractor's full PageSnapshot to the
  // structure-only competitor shape (questions only, never FAQ answer
  // bodies — the type's locked safety posture).
  const owned = extractPageSnapshot(
    args.html,
    args.url,
    `comp-${urlHash(args.url)}`,
    args.tenantId,
    args.status,
  );
  return {
    id: `comp-snap-${args.tenantId}-${urlHash(args.url)}`,
    tenant_id: args.tenantId,
    url: args.url,
    canonical_url: owned.canonical_url,
    fetched_at: args.fetchedAt,
    http_status: args.status,
    title: owned.title,
    meta_description: owned.meta_description,
    h1: owned.h1,
    h2_list: owned.h2_list,
    faq_questions: owned.faqs.map((f) => f.question),
    extraction_certainty: owned.extraction_certainty ?? "uncertain",
  };
}

export async function refreshCompetitorIntel(
  deps: PoliteFetchDeps & { now?: Date } = {},
): Promise<RefreshCompetitorIntelResult> {
  const now = deps.now ?? new Date();
  const tenantId = await currentTenantId();
  const universe = await loadCompetitorUniverseRuntime();
  const competitors = universe.entries.map((e) => ({
    domain: e.domain,
    displayName: e.display_name,
  }));
  const domainMeta = new Map(
    competitors.map((c) => [
      normalizeHost(c.domain),
      { domain: normalizeHost(c.domain), displayName: c.displayName },
    ]),
  );

  // ── 1. Sitemap crawl + change detection ─────────────────────────────
  let snapshots: CompetitorSitemapSnapshot[] = [];
  let sitemapChangesDetected = 0;
  let sitemapChangesRecorded = 0;
  if (competitors.length > 0) {
    const previous = await getCompetitorMonitoringState();
    snapshots = await crawlAllCompetitors(competitors);
    const changes = detectCompetitorChanges(snapshots, previous.snapshots);
    sitemapChangesDetected = changes.length;
    await saveCompetitorMonitoringState({
      lastCrawlAt: now.toISOString(),
      snapshots,
      recentChanges: changes,
    });
    sitemapChangesRecorded = await appendCompetitorSitemapChanges(changes);
  }

  // ── 2. Pick URLs worth structural eyes ──────────────────────────────
  const trackedHosts = new Set(domainMeta.keys());
  const hostOf = (url: string): string | null => {
    try {
      return normalizeHost(new URL(url).hostname);
    } catch {
      return null;
    }
  };

  let evidence: Awaited<ReturnType<typeof getCompetitorPages>> = [];
  try {
    evidence = await getCompetitorPages();
  } catch {
    evidence = [];
  }
  const topCited = pickTopCompetitorUrls(
    evidence.filter((e) => {
      const host = hostOf(e.pageUrl);
      return host != null && trackedHosts.has(host);
    }),
    TOP_CITED_URL_CAP,
  ).map((r) => r.url);

  // Just-changed URLs come from the recorded changes of this run.
  const justChanged: string[] = [];
  const state = await getCompetitorMonitoringState();
  for (const c of state.recentChanges) {
    if (justChanged.length >= CHANGED_URL_CAP) break;
    if (c.type === "removed") continue;
    const host = hostOf(c.url);
    if (host == null || !trackedHosts.has(host)) continue;
    justChanged.push(c.url);
  }

  const toFetch = [...new Set([...topCited, ...justChanged])];

  // ── 3. Fetch → extract → diff → persist ─────────────────────────────
  const stored = await getCompetitorPageSnapshotsByUrl();
  const robotsCache = new Map<string, string[]>();
  const freshSnapshots: CompetitorPageSnapshot[] = [];
  const structuralChanges: Parameters<
    typeof appendCompetitorStructuralChanges
  >[0][number][] = [];
  let urlsBlocked = 0;
  let urlsFailed = 0;

  for (const url of toFetch) {
    const host = hostOf(url);
    const meta = host != null ? domainMeta.get(host) : undefined;
    if (meta == null) continue;
    const res = await fetchPageHtml(url, robotsCache, deps);
    if (!res.ok) {
      if (res.reason === "robots_blocked") urlsBlocked++;
      else urlsFailed++;
      continue;
    }
    const fresh = toCompetitorSnapshot({
      url,
      html: res.html,
      status: res.status,
      tenantId,
      fetchedAt: now.toISOString(),
    });
    const prev = stored.get(url);
    if (prev != null) {
      structuralChanges.push(
        ...diffCompetitorPageStructure(prev, fresh, meta),
      );
    }
    freshSnapshots.push(fresh);
  }

  if (freshSnapshots.length > 0) {
    await persistCompetitorPageSnapshots(freshSnapshots);
  }
  const structuralChangesDetected =
    await appendCompetitorStructuralChanges(structuralChanges);

  return {
    ok: true,
    competitorsCrawled: competitors.length,
    sitemapChangesDetected,
    sitemapChangesRecorded,
    urlsFetched: freshSnapshots.length,
    urlsBlocked,
    urlsFailed,
    structuralChangesDetected,
  };
}
