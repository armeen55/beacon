import "server-only";

/**
 * early-body-text (2026-07-03, R8 / N18) - a scoped, bounded read of
 * page_snapshots.body_paragraph_sample for a SHORT list of URLs.
 *
 * The egress-lean snapshot projections (EGRESS-P0) deliberately omit
 * body_paragraph_sample (5-15KB/row), which would leave the snippet-promise
 * audit silently blind on hosted - the same silent-empty class the link-graph
 * merge read (getPageSnapshotLinkGraphs) fixed for the orphan-page triggers.
 * This helper mirrors that pattern at a smaller scope: the caller pre-selects
 * only the pages whose title/meta actually makes a checkable promise AND that
 * have real impressions, then this fetches early body text for just those
 * URLs (hard-capped). Fail-soft to an empty map - unknown body text means the
 * audit honestly abstains, never a fabricated flag.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";

/** Hard cap on how many URLs one run may fetch body samples for. */
export const MAX_EARLY_BODY_URLS = 40;

export async function loadEarlyBodyTextForUrls(
  tenantId: string,
  urls: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const targets = [...new Set(urls)].slice(0, MAX_EARLY_BODY_URLS);
  if (targets.length === 0 || !tenantId) return out;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("page_snapshots")
      .select("url, body_paragraph_sample, fetched_at")
      .eq("tenant_id", tenantId)
      .in("url", targets)
      .order("fetched_at", { ascending: false });
    if (error || !Array.isArray(data)) return out;
    for (const r of data as Array<{ url: string; body_paragraph_sample: unknown }>) {
      if (out.has(r.url)) continue; // newest snapshot first
      const sample = Array.isArray(r.body_paragraph_sample)
        ? r.body_paragraph_sample.filter((s): s is string => typeof s === "string").join(" ")
        : "";
      if (sample.trim()) out.set(r.url, sample);
    }
    return out;
  } catch {
    return out;
  }
}
