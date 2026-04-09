import type { VisibilityObservationRun } from "./visibility-types";

/** True when citation index is older than the latest crawl completion timestamp. */
export function visibilitySampleStaleVsCrawl(
  vis: VisibilityObservationRun | null,
  crawlCompletedAt: string | null
): { stale: boolean; note: string | null } {
  if (!vis?.citation_index_built_at || !crawlCompletedAt) {
    return { stale: false, note: null };
  }
  const v = new Date(vis.citation_index_built_at).getTime();
  const c = new Date(crawlCompletedAt).getTime();
  if (Number.isNaN(v) || Number.isNaN(c)) {
    return { stale: false, note: null };
  }
  if (v < c) {
    return {
      stale: true,
      note:
        "Visibility sample may be stale vs latest crawl — citation index `built_at` is older than last website crawl.",
    };
  }
  return { stale: false, note: null };
}
