/**
 * audit-3 #6 (2026-06-22) — pullDayRows must NOT return a truncated day.
 *
 * pullDayRows paginates by 25k rows. Pre-fix, a query failure AFTER the first
 * full page returned the PARTIAL accumulated rows, and the sync persisted them
 * with is_final=true — a truncated day frozen as complete, which the re-pull
 * watermark then skips forever. The fix returns null on ANY page failure so
 * the caller stops + re-pulls the day cleanly next run.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  pullDayRows,
  GSC_SA_ROW_LIMIT,
  type GscSearchAnalyticsRow,
} from "@/lib/connectors/gsc/search-analytics";

function fullPage(n: number): GscSearchAnalyticsRow[] {
  return Array.from({ length: n }, (_, i) => ({
    keys: [`/p${i}`, `q${i}`],
    clicks: 1,
    impressions: 10,
    ctr: 0.1,
    position: 5,
  }));
}

const baseArgs = {
  accessToken: "tok",
  siteUrl: "sc-domain:example.com",
  day: "2026-06-01",
  dimensions: ["page", "query"] as string[],
};

describe("pullDayRows truncation (audit-3 #6)", () => {
  it("returns NULL (not partial) when a later page fails mid-pagination", async () => {
    // Page 0 is a FULL page (== limit → more expected); page 1 fails (null).
    const queryImpl = vi
      .fn()
      .mockResolvedValueOnce(fullPage(GSC_SA_ROW_LIMIT))
      .mockResolvedValueOnce(null);
    const result = await pullDayRows({ ...baseArgs, queryImpl: queryImpl as never });
    expect(result).toBeNull();
    expect(queryImpl).toHaveBeenCalledTimes(2);
  });

  it("returns the full set when every page succeeds (last page short)", async () => {
    const queryImpl = vi
      .fn()
      .mockResolvedValueOnce(fullPage(GSC_SA_ROW_LIMIT))
      .mockResolvedValueOnce(fullPage(3)); // short page → done
    const result = await pullDayRows({ ...baseArgs, queryImpl: queryImpl as never });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(GSC_SA_ROW_LIMIT + 3);
  });

  it("returns null when the FIRST page fails", async () => {
    const queryImpl = vi.fn().mockResolvedValueOnce(null);
    const result = await pullDayRows({ ...baseArgs, queryImpl: queryImpl as never });
    expect(result).toBeNull();
  });

  it("returns a single short page as the complete day", async () => {
    const queryImpl = vi.fn().mockResolvedValueOnce(fullPage(42));
    const result = await pullDayRows({ ...baseArgs, queryImpl: queryImpl as never });
    expect(result!.length).toBe(42);
    expect(queryImpl).toHaveBeenCalledTimes(1);
  });
});
