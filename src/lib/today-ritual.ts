import type { CoverageTone } from "@/lib/today-proof-context";

export type RecResponseStatus = "accepted" | "dismissed" | "deferred" | null;

/**
 * Tier 1A: “Nothing needs your attention” — only when queues are clear and
 * coverage is not flagged partial/stale.
 */
export function shouldShowTodayAllClear(params: {
  pendingFindingsCount: number;
  /** True when a primary recommendation card exists */
  hasPrimaryAction: boolean;
  primaryResponseStatus: RecResponseStatus | undefined;
  crawlStale: boolean;
  visibilityStaleVsCrawl: boolean;
  coverageTone: CoverageTone;
}): boolean {
  const primaryHandled =
    !params.hasPrimaryAction ||
    params.primaryResponseStatus === "accepted" ||
    params.primaryResponseStatus === "dismissed";

  return (
    params.pendingFindingsCount === 0 &&
    primaryHandled &&
    !params.crawlStale &&
    !params.visibilityStaleVsCrawl &&
    params.coverageTone !== "partial"
  );
}
