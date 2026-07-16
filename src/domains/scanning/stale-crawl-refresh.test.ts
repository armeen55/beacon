import { describe, expect, it } from "vitest";

import {
  STALE_CRAWL_REFRESH_MS,
  isCrawlRefreshDue,
} from "./stale-crawl-refresh";
import type { CrawlFrontierState } from "./crawl-frontier";

function complete(updatedAt: string): CrawlFrontierState {
  return {
    tenant_id: "tenant-iranopedia",
    domain: "iranopedia.com",
    status: "complete",
    frontier: [],
    visited: ["iranopedia.com/"],
    pages_crawled: 1,
    pages_failed: 0,
    page_cap: 150,
    source: "sitemap",
    started_at: updatedAt,
    updated_at: updatedAt,
    last_batch_at: updatedAt,
    batches_run: 1,
    page_facts: [],
    day0: { question_seeding: null, serp_terms: [] },
  };
}

describe("isCrawlRefreshDue", () => {
  const now = Date.parse("2026-07-16T12:00:00.000Z");

  it("requeues a complete crawl at the weekly age boundary", () => {
    expect(isCrawlRefreshDue(complete(new Date(now - STALE_CRAWL_REFRESH_MS).toISOString()), now)).toBe(true);
  });

  it("leaves fresh and unfinished queues alone", () => {
    expect(isCrawlRefreshDue(complete(new Date(now - STALE_CRAWL_REFRESH_MS + 1).toISOString()), now)).toBe(false);
    expect(isCrawlRefreshDue({ ...complete("bad-date"), status: "in_progress" }, now)).toBe(false);
    expect(isCrawlRefreshDue(null, now)).toBe(false);
  });

  it("fails open for an invalid completion timestamp", () => {
    expect(isCrawlRefreshDue(complete("bad-date"), now)).toBe(true);
  });
});
