import type { CoverageTone } from "@/lib/today-proof-context";
import type { CoverageState } from "@/lib/coverage-state";

export type RecResponseStatus = "accepted" | "dismissed" | "deferred" | null;

/* ─────────────────────────────────────────────────────────────────────────── *
 * Inbox Zero — formal definition (Track 1.2)
 *
 * An operator is "done for the day" when ALL of:
 *   1. No primary action remains unhandled
 *   2. No critical or important findings remain
 *   3. No urgent coverage issues exist (stale crawl, stale visibility, partial)
 *   4. Not in demo mode
 *
 * When all conditions are met, Today shows: "You're clear."
 * When NOT met, a digest line summarises what remains.
 * ─────────────────────────────────────────────────────────────────────────── */

export function shouldShowTodayAllClear(params: {
  pendingFindingsCount: number;
  hasPrimaryAction: boolean;
  primaryResponseStatus: RecResponseStatus | undefined;
  crawlStale: boolean;
  visibilityStaleVsCrawl: boolean;
  coverageTone: CoverageTone;
  /** Tier 1.1i — blocks all-clear when data freshness is critical, stale, or partial; aging alone does not block. */
  coverageState?: CoverageState;
  isDemoMode?: boolean;
}): boolean {
  if (params.isDemoMode) return false;

  const primaryHandled =
    !params.hasPrimaryAction ||
    params.primaryResponseStatus === "accepted" ||
    params.primaryResponseStatus === "dismissed";

  const cs = params.coverageState;
  const coverageBlocksAllClear =
    cs === "critical" || cs === "stale" || cs === "partial";

  return (
    params.pendingFindingsCount === 0 &&
    primaryHandled &&
    !params.crawlStale &&
    !params.visibilityStaleVsCrawl &&
    params.coverageTone !== "partial" &&
    !coverageBlocksAllClear
  );
}

/* ─────────────────────────────────────────────────────────────────────────── *
 * Digest — single-line summary of remaining work (Track 1.2)
 * ─────────────────────────────────────────────────────────────────────────── */

export type TodayDigest = {
  /** True when all critical work is done but optional items remain. */
  criticalWorkDone: boolean;
  /** The single formatted digest line. Null when allClear. */
  line: string | null;
};

export function computeTodayDigest(params: {
  allClear: boolean;
  hasPrimaryAction: boolean;
  primaryResponseStatus: RecResponseStatus | undefined;
  /** Count of critical + important findings */
  actionableFindingsCount: number;
  /** Count of minor + informational findings */
  lowPriorityFindingsCount: number;
  crawlStale: boolean;
  /** Tier 1.1i — factual freshness hints (no aging here; aging is low-priority vs other digest items). */
  coverageState?: CoverageState;
}): TodayDigest {
  if (params.allClear) return { criticalWorkDone: true, line: null };

  const primaryPending =
    params.hasPrimaryAction &&
    params.primaryResponseStatus !== "accepted" &&
    params.primaryResponseStatus !== "dismissed";

  const parts: string[] = [];

  if (primaryPending) parts.push("1 action remaining");
  if (params.actionableFindingsCount > 0) {
    parts.push(
      `${params.actionableFindingsCount} finding${params.actionableFindingsCount !== 1 ? "s" : ""} to review`,
    );
  }
  if (params.crawlStale) parts.push("scan overdue");
  if (params.coverageState === "critical") {
    parts.push("no recent crawl data");
  } else if (params.coverageState === "stale") {
    parts.push("data may be outdated");
  }

  if (parts.length === 0 && params.lowPriorityFindingsCount > 0) {
    return {
      criticalWorkDone: true,
      line: `All critical work complete · ${params.lowPriorityFindingsCount} optional item${params.lowPriorityFindingsCount !== 1 ? "s" : ""} remain`,
    };
  }

  if (parts.length === 0) {
    return { criticalWorkDone: true, line: null };
  }

  return { criticalWorkDone: false, line: parts.join(" · ") };
}
