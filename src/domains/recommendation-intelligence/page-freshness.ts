import "server-only";

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

export async function loadLatestPageSnapshots(tenantId: string): Promise<PageSnapshotMeta[]> {
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
