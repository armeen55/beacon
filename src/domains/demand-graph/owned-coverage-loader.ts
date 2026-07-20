import "server-only";

import { log } from "@/lib/logger";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { loadTopTenantQueriesWithOwner } from "@/domains/recommendation-intelligence/gsc-page-queries";
import type { OwnedCoverageInput, OwnedPageContent, OwnedServingRow } from "./owned-coverage";

/**
 * owned-coverage-loader (2026-07-11) - the I/O boundary for owned-coverage.ts. Reads
 * the two already-stored signals the pure detector needs, both fail-soft ($0, no new
 * paid call):
 *
 *   serving     loadTopTenantQueriesWithOwner (gsc_daily_rows, 90d, ANY position) -
 *               which owned page Google sends each query to.
 *   ownedPages  a bounded page_snapshots read (url + title + h1) for the owned pages -
 *               the crawled content the detector matches a topic against.
 *
 * Owned URLs come from the caller (the demand graph's owned pageNodes) unioned with
 * every page GSC already serves, so a page that ranks but was not in the graph's owned
 * set is still checked. Every read degrades to empty: no data narrows detection to
 * "nothing found", it never throws (a failed read simply means the board behaves
 * exactly as it did before this detector existed).
 */

/** Bound both reads so one call stays cheap on the cockpit's hot path. */
const SERVING_QUERY_LIMIT = 1000;
const MAX_OWNED_CONTENT_PAGES = 200;

type OwnedContentRow = { url: string; title: string | null; h1: string | null; word_count: number | null };

async function readOwnedPageContent(tenantId: string, urls: readonly string[]): Promise<OwnedPageContent[]> {
  const wanted = [...new Set(urls.filter(Boolean))].slice(0, MAX_OWNED_CONTENT_PAGES);
  if (!isSupabaseConfigured() || wanted.length === 0) return [];
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("page_snapshots")
      .select("url, title, h1, word_count, fetched_at")
      .eq("tenant_id", tenantId)
      .in("url", wanted)
      .order("fetched_at", { ascending: false })
      .limit(wanted.length * 3);
    if (error || !Array.isArray(data)) return [];
    const seen = new Set<string>();
    const out: OwnedPageContent[] = [];
    for (const r of data as (OwnedContentRow & { fetched_at?: string })[]) {
      const key = (r.url ?? "").toLowerCase();
      if (!key || seen.has(key)) continue; // newest snapshot per URL wins (rows arrive newest first)
      seen.add(key);
      out.push({ url: r.url, title: r.title ?? null, h1: r.h1 ?? null, wordCount: r.word_count ?? null });
    }
    return out;
  } catch (e) {
    log.warn("[owned-coverage] owned content read failed (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return [];
  }
}

/**
 * Load both detector inputs for one tenant. `ownedUrls` seeds the owned-content read
 * (typically the demand graph's owned pageNodes); the GSC-served pages are added so a
 * ranking-but-ungraphed page is still content-checked. Never throws.
 */
export async function loadOwnedCoverageInputs(
  tenantId: string,
  ownedUrls: readonly string[] = [],
): Promise<OwnedCoverageInput> {
  if (!tenantId) return { serving: [], ownedPages: [] };

  const servingRows = await loadTopTenantQueriesWithOwner(tenantId, { limit: SERVING_QUERY_LIMIT }).catch(() => []);
  const serving: OwnedServingRow[] = servingRows.map((r) => ({
    query: r.query,
    ownerPage: r.ownerPage,
    position: r.position ?? null,
  }));

  const contentUrls = [
    ...ownedUrls,
    ...serving.map((s) => s.ownerPage).filter((u): u is string => !!u),
  ];
  const ownedPages = await readOwnedPageContent(tenantId, contentUrls);

  return { serving, ownedPages };
}
