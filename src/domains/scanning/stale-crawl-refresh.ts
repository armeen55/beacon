import "server-only";

import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import {
  continueColdStartCrawlIfStarted,
  loadCrawlFrontier,
  runCrawlBatch,
  startColdStartCrawl,
  type CrawlFrontierState,
} from "./crawl-frontier";

/** A weekly owned-site reread is fresh enough for ranking without turning
 * normal navigation into a crawler. The work is free, bounded, and runs only
 * after the response. */
export const STALE_CRAWL_REFRESH_MS = 7 * 86_400_000;

export function isCrawlRefreshDue(
  state: CrawlFrontierState | null,
  nowMs: number,
): boolean {
  if (!state || state.status !== "complete") return false;
  const updatedMs = Date.parse(state.updated_at);
  return !Number.isFinite(updatedMs) || nowMs - updatedMs >= STALE_CRAWL_REFRESH_MS;
}

export type StaleCrawlRefreshResult = {
  ran: boolean;
  reason: "continued" | "requeued" | "fresh" | "missing_domain" | "unreachable";
  crawled: number;
};

/** Continue an unfinished crawl, or re-discover and read one bounded batch
 * when the last complete crawl is a week old. No cron is required. */
export async function refreshStaleCrawlForCurrentTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<StaleCrawlRefreshResult> {
  const state = await loadCrawlFrontier(tenantId);
  if (state?.status === "in_progress") {
    const batch = await continueColdStartCrawlIfStarted(tenantId);
    return { ran: batch.ran, reason: "continued", crawled: batch.crawled };
  }
  if (!isCrawlRefreshDue(state, now.getTime())) {
    return { ran: false, reason: "fresh", crawled: 0 };
  }

  const config = await getBusinessConfigForCurrentTenant();
  if (!config.domain.trim()) {
    return { ran: false, reason: "missing_domain", crawled: 0 };
  }
  const started = await startColdStartCrawl({
    tenantId,
    domain: config.domain,
    force: true,
  });
  if (started.status === "unreachable") {
    return { ran: false, reason: "unreachable", crawled: 0 };
  }
  const batch = await runCrawlBatch({ tenantId });
  return { ran: batch.ran, reason: "requeued", crawled: batch.crawled };
}
