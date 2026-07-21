import "server-only";

import { cache } from "react";

import { log } from "@/lib/logger";
import { getRepository } from "@/lib/persistence/repositories";
import type { PageSnapshotLinkGraph } from "@/lib/persistence/repositories/types";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import {
  getBusinessConfig,
  hydrateBusinessConfigFromSupabase,
} from "@/lib/business-config";

import {
  computeInternalPageRank,
  type InternalPageRankResult,
  type PageRankInputPage,
} from "./internal-pagerank";
import {
  isPageRankSnapshotValid,
  readPageRankSnapshot,
  writePageRankSnapshot,
  type PageRankSnapshotRow,
} from "./internal-pagerank-store";

/**
 * internal-pagerank-loader (2026-07-03, BEACON_500 R18 / N23) - the I/O boundary
 * for internal-pagerank.ts. Reads the tenant's ALREADY-STORED page_snapshots
 * link graph (getPageSnapshotLinkGraphs - the scoped link-graph read the trigger
 * loader already uses, so this spends nothing new), resolves + canonicalizes
 * every owned->owned link into node ids, and computes the pure PageRank +
 * click-depth + orphan snapshot. Persisted per tenant to the "internal-pagerank"
 * store for cross-request + cross-surface reuse (the buried-page and
 * entity-interlink triggers read it).
 *
 * Fail-soft throughout: a read failure yields an empty result (no pages), never
 * a throw - a caller consuming the snapshot must never be able to crash the
 * pipeline it feeds.
 */

/** File extensions that classify a URL as a non-HTML asset. Universal - no
 *  tenant config needed. Relocated from the retired
 *  recommendation-intelligence/page-classifier (2026-07-21) - this loader is
 *  its only live consumer. */
const NON_HTML_EXTENSIONS: ReadonlySet<string> = new Set([
  "txt",
  "xml",
  "json",
  "pdf",
  "css",
  "js",
  "map",
  "webmanifest",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "ico",
  "webp",
  "avif",
  "mp4",
  "mov",
  "mp3",
  "wav",
  "webm",
  "ogg",
]);

function urlPath(url: string): string {
  const noProtocol = url.replace(/^https?:\/\/[^/]+/, "");
  const beforeQuery = noProtocol.split(/[?#]/)[0] ?? "";
  return beforeQuery.toLowerCase();
}

function urlExtension(path: string): string | null {
  // Use last path segment only - don't pick up dots in earlier segments
  // (e.g., `/v1.2/about` should not look like a `.2/about` extension).
  const lastSegment = path.split("/").pop() ?? "";
  const idx = lastSegment.lastIndexOf(".");
  if (idx <= 0) return null;
  return lastSegment.slice(idx + 1).toLowerCase();
}

export function isNonHtmlAsset(url: string): boolean {
  const ext = urlExtension(urlPath(url));
  return ext != null && NON_HTML_EXTENSIONS.has(ext);
}

const EMPTY_RESULT: InternalPageRankResult = {
  pages: [],
  homepage: null,
  totalEdges: 0,
  builtAt: new Date(0).toISOString(),
};

/** Resolve a possibly-relative href against its source page and canonicalize
 *  (mirror of orphan-page.ts / internal-link-opportunity.ts local helpers). */
function resolveAndCanonicalize(href: string, sourceUrl: string): string | null {
  if (typeof href !== "string" || href.length === 0) return null;
  try {
    return canonicalizeCitationUrl(new URL(href, sourceUrl).toString());
  } catch {
    return null;
  }
}

/** Derive the homepage node from the tenant's configured domain, when it maps to
 *  a known owned node - otherwise the pure core infers it structurally. */
function homepageNodeFromDomain(domain: string | null | undefined, nodeSet: Set<string>): string | null {
  const d = (domain ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!d) return null;
  const canon = canonicalizeCitationUrl(`https://${d}/`);
  if (canon && nodeSet.has(canon)) return canon;
  return null;
}

/**
 * Build the internal-authority snapshot for one tenant from live link-graph
 * reads (no persist). Fail-soft -> EMPTY_RESULT.
 */
export async function buildInternalPageRankForTenant(tenantId: string): Promise<InternalPageRankResult> {
  if (!tenantId) return EMPTY_RESULT;
  let graphs: PageSnapshotLinkGraph[];
  try {
    graphs = await getRepository().forTenant(tenantId).getPageSnapshotLinkGraphs();
  } catch (e) {
    log.warn("[internal-pagerank] link-graph read failed (fail-soft to empty)", {
      tenantId,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return EMPTY_RESULT;
  }

  // Newest snapshot per URL wins (defensive against multiple snapshot rows per
  // page). Rows arrive unordered; keep the freshest fetched_at.
  const byUrl = new Map<string, { url: string; internal_links: { href: string }[]; fetched_at: string }>();
  for (const g of graphs) {
    if (!g?.url || isNonHtmlAsset(g.url)) continue;
    const canon = canonicalizeCitationUrl(g.url);
    if (!canon) continue;
    const prev = byUrl.get(canon);
    if (!prev || (g.fetched_at ?? "") > (prev.fetched_at ?? "")) {
      byUrl.set(canon, { url: canon, internal_links: g.internal_links ?? [], fetched_at: g.fetched_at ?? "" });
    }
  }

  const nodeSet = new Set(byUrl.keys());
  const inputPages: PageRankInputPage[] = [];
  for (const [canon, row] of byUrl) {
    const outbound: string[] = [];
    for (const link of row.internal_links) {
      const target = resolveAndCanonicalize(link.href, canon);
      if (target && target !== canon && nodeSet.has(target)) outbound.push(target);
    }
    inputPages.push({ url: canon, outbound });
  }

  // Config homepage override (best-effort; pure core infers structurally if the
  // config domain doesn't map to a known node).
  let homepage: string | null = null;
  try {
    const config =
      (await hydrateBusinessConfigFromSupabase(tenantId)) ?? getBusinessConfig(tenantId);
    homepage = homepageNodeFromDomain(config?.domain, nodeSet);
  } catch {
    /* pure core infers the homepage */
  }

  return computeInternalPageRank(inputPages, { homepage });
}

/**
 * Nightly cron phase entry: rebuild the snapshot from the link graph and persist
 * it (replacing this tenant's single snapshot row). Never throws.
 */
export type PageRankRebuildResult = {
  tenantId: string;
  pages: number;
  orphaned: number;
  edges: number;
};

export async function rebuildInternalPageRankForTenant(tenantId: string): Promise<PageRankRebuildResult> {
  const result = await buildInternalPageRankForTenant(tenantId);
  await writePageRankSnapshot(result, result.builtAt);
  return {
    tenantId,
    pages: result.pages.length,
    orphaned: result.pages.filter((p) => p.orphaned).length,
    edges: result.totalEdges,
  };
}

/**
 * The consumer read: this tenant's persisted snapshot, or a live rebuild when
 * none is stored yet. React cache()-d per request. Never throws - a failure
 * yields EMPTY_RESULT (every consumer treats empty as "feature silent").
 */
export const loadInternalPageRankForTenant = cache(
  async (tenantId: string): Promise<InternalPageRankResult> => {
    if (!tenantId) return EMPTY_RESULT;
    try {
      const row: PageRankSnapshotRow | null = await readPageRankSnapshot();
      if (isPageRankSnapshotValid(row)) return row.data;
      // No valid snapshot yet (pre-first-nightly) - build once so the first
      // consumer still gets a real answer. Do NOT persist here (no write on a
      // read path); the nightly rebuild owns persistence.
      return await buildInternalPageRankForTenant(tenantId);
    } catch (e) {
      log.warn("[internal-pagerank] load failed (fail-soft to empty)", {
        tenantId,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      return EMPTY_RESULT;
    }
  },
);
