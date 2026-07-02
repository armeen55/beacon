import "server-only";

import { cache } from "react";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { log } from "@/lib/logger";

/**
 * page-freshness (2026-06-25) — latest crawl metadata per page from the same
 * `page_snapshots` read the State-of-Union schema check uses (`fetched_at` +
 * `word_count`, latest row per canonical URL). Powers the "stale but still
 * pulling traffic = refresh candidate" lens. Bounded (≤3000 rows, ~hundreds for
 * a content site) + fail-soft → [].
 */

export type PageSnapshotMeta = { url: string; fetchedAt: string | null; wordCount: number };

export const loadLatestPageSnapshots = cache(loadLatestPageSnapshotsImpl);
async function loadLatestPageSnapshotsImpl(tenantId: string): Promise<PageSnapshotMeta[]> {
  if (!tenantId) return [];
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("page_snapshots")
      .select("url, fetched_at, word_count")
      .eq("tenant_id", tenantId)
      .order("fetched_at", { ascending: false })
      .limit(3000);
    if (error || !data) {
      if (error) log.warn("[page-freshness] read failed", { tenantId, error: error.message });
      return [];
    }
    const latest = new Map<string, PageSnapshotMeta>();
    for (const r of data as Array<{ url: string; fetched_at: string | null; word_count: number | null }>) {
      if (!r.url) continue;
      const u = canonicalizeCitationUrl(r.url) ?? r.url;
      if (latest.has(u)) continue; // desc by fetched_at → first seen is newest
      latest.set(u, { url: u, fetchedAt: r.fetched_at, wordCount: Number(r.word_count) || 0 });
    }
    return [...latest.values()];
  } catch (e) {
    log.warn("[page-freshness] threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/** One page's own content facts, straight from its latest crawl - the dossier's
 *  "content" band. Title/meta/H1/word count only (never the full body, which stays
 *  in the leaner readers under ai-visibility/drafts that already own that read). */
export type PageContentSnapshot = {
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  wordCount: number;
  fetchedAt: string | null;
};

/** Read ONE owned URL's latest content facts (title/meta/h1/word count/fetched_at).
 *  Mirrors the proven single-URL point-read in answer-alignment-store.ts /
 *  factual-entailment-store.ts (same table, same tenant+url filter, same fail-soft
 *  contract) - just a different column slice, so a page's dossier can show what its
 *  title and meta actually say without pulling body text it doesn't need. Tries the
 *  exact URL, then a www./bare-host variant (the same mismatch those readers found
 *  in real data). Fail-soft -> null, never throws. */
export async function loadPageContentSnapshot(tenantId: string, url: string): Promise<PageContentSnapshot | null> {
  if (!tenantId || !url) return null;
  try {
    const sb = getSupabaseAdmin();
    const candidates = [url, wwwToggled(url)].filter((u): u is string => !!u);
    for (const candidate of candidates) {
      const { data, error } = await sb
        .from("page_snapshots")
        .select("title, meta_description, h1, word_count, fetched_at")
        .eq("tenant_id", tenantId)
        .eq("url", candidate)
        .order("fetched_at", { ascending: false })
        .limit(1);
      if (error) {
        log.warn("[page-freshness] content snapshot read failed", { tenantId, url: candidate, error: error.message });
        continue;
      }
      const row = (data ?? [])[0] as
        | { title: string | null; meta_description: string | null; h1: string | null; word_count: number | null; fetched_at: string | null }
        | undefined;
      if (row) {
        return {
          title: row.title,
          metaDescription: row.meta_description,
          h1: row.h1,
          wordCount: Number(row.word_count) || 0,
          fetchedAt: row.fetched_at,
        };
      }
    }
    return null;
  } catch (e) {
    log.warn("[page-freshness] content snapshot read threw", { tenantId, url, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** A www./bare-host variant of the same URL, or null on a malformed URL. */
function wwwToggled(url: string): string | null {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
    return u.toString();
  } catch {
    return null;
  }
}
