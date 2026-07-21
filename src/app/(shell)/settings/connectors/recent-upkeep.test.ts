/**
 * recent-upkeep (Phase 4B Lane 1 fold, 2026-07-21) - /activity is retired; its
 * "recent refresh history" value prop now renders on /settings/connectors from
 * this module. Pins the same refresh-run join + copy the retired /activity
 * page's activity-data.ts used to pin, now scoped to this smaller surface.
 */
import { describe, expect, it, vi } from "vitest";

import type { RefreshRunRow } from "@/domains/ops/refresh-runs-store";

const { listRecentRefreshRuns } = vi.hoisted(() => ({
  listRecentRefreshRuns: vi.fn(),
}));

vi.mock("@/domains/ops/refresh-runs-store", () => ({ listRecentRefreshRuns }));

import { loadRecentUpkeep, recentUpkeepSentence, RecentUpkeepList } from "./recent-upkeep";

function mkRow(over: Partial<RefreshRunRow>): RefreshRunRow {
  return {
    id: "run-1",
    tenant_id: "tenant-test",
    source: "gsc",
    trigger: "cron",
    started_at: "2026-07-17T03:00:00.000Z",
    finished_at: "2026-07-17T03:02:00.000Z",
    duration_ms: 120_000,
    result: "ok",
    rows_persisted: 8397,
    latest_data_date: "2026-07-17",
    failure_category: null,
    next_retry_at: null,
    created_at: "2026-07-17T03:02:00.000Z",
    ...over,
  };
}

describe("recentUpkeepSentence (pure copy, ported from the retired /activity page)", () => {
  it("names the source, the row count, and the data-through date for a healthy pull", () => {
    const line = recentUpkeepSentence(
      mkRow({ source: "gsc", rows_persisted: 8397, latest_data_date: "2026-07-17" }),
    );
    expect(line).toBe("I pulled fresh Search Console data: 8,397 rows through Jul 17.");
  });

  it("gives the honest failed line with no vendor jargon", () => {
    const line = recentUpkeepSentence(
      mkRow({ source: "ga4", result: "failed", rows_persisted: null, latest_data_date: null }),
    );
    expect(line).toBe("The Analytics pull did not work. I keep retrying.");
    expect(line).not.toMatch(/[‒–—―]/);
  });

  it("gives an honest partial line instead of a false win", () => {
    const line = recentUpkeepSentence(
      mkRow({ source: "profound", result: "partial", rows_persisted: 0, latest_data_date: "2026-07-15" }),
    );
    expect(line).toBe("The AI answer tracking pull ran but found no new data since Jul 15.");
  });
});

describe("loadRecentUpkeep", () => {
  it("collapses repeated same-day retries for one source to a single, latest entry", async () => {
    listRecentRefreshRuns.mockResolvedValue([
      mkRow({ id: "retry-1", source: "clarity", result: "failed", finished_at: "2026-07-19T02:00:00.000Z" }),
      mkRow({
        id: "retry-2",
        source: "clarity",
        result: "ok",
        rows_persisted: 42,
        latest_data_date: "2026-07-19",
        finished_at: "2026-07-19T08:00:00.000Z",
      }),
    ]);

    const entries = await loadRecentUpkeep("tenant-test");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sentence).toContain("I pulled fresh Clarity data");
  });

  it("trims to the 10 most recent entries, newest first", async () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      mkRow({
        id: `row-${i}`,
        source: "gsc",
        finished_at: `2026-07-${String(i + 1).padStart(2, "0")}T03:00:00.000Z`,
      }),
    );
    listRecentRefreshRuns.mockResolvedValue(rows);

    const entries = await loadRecentUpkeep("tenant-test");
    expect(entries).toHaveLength(10);
    expect(entries[0]?.dateLabel).toBe("2026-07-15");
  });

  it("never throws when the ledger read fails - the section just self-hides", async () => {
    listRecentRefreshRuns.mockRejectedValue(new Error("boom"));
    await expect(loadRecentUpkeep("tenant-test")).resolves.toEqual([]);
  });
});

describe("RecentUpkeepList", () => {
  it("renders null (self-hides) when there is nothing to show", () => {
    expect(RecentUpkeepList({ entries: [] })).toBeNull();
  });
});
