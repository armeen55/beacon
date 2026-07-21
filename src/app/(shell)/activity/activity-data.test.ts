/**
 * activity-data (certified-fix 2026-07-20, defect 2) - the daily refresh_runs
 * pulls (Search Console / Analytics / Clarity / AI answer tracking) must land
 * on /activity with honest first-person copy, not stay invisible behind the
 * repeated sub-cent spend lines. Every dependency loadActivityFeed touches is
 * mocked so this test pins ONLY the refresh-run join + copy, deterministically.
 */
import { describe, expect, it, vi } from "vitest";

import type { RefreshRunRow } from "@/domains/ops/refresh-runs-store";

const { listRecentRefreshRuns } = vi.hoisted(() => ({
  listRecentRefreshRuns: vi.fn(),
}));

vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-test" }));
vi.mock("@/domains/proof-gsc/shipped-change-store", () => ({ loadShippedChanges: async () => [] }));
vi.mock("@/domains/autopilot/autopilot-store", () => ({
  getAutopilotState: async () => ({ receipts: [] }),
}));
vi.mock("@/domains/experiments/daily-experiment-plan-store", () => ({ listPlans: async () => [] }));
vi.mock("@/domains/ops/cron-runs-store", () => ({
  listKnownJobs: async () => [],
  listRecentCronRuns: async () => [],
}));
vi.mock("@/lib/obs/error-ledger", () => ({ listAppErrorsForTenant: async () => [] }));
vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: async () => ({ status: "disconnected", connected_at: null, auth_failed_at: null }),
}));
vi.mock("@/lib/cost/budget-ledger-supabase", () => ({ readRecentSpendRows: async () => [] }));
vi.mock("@/domains/ops/refresh-runs-store", () => ({ listRecentRefreshRuns }));

import { loadActivityFeed, refreshRunSentence } from "./activity-data";

const NOW = new Date("2026-07-20T12:00:00.000Z");

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

describe("refreshRunSentence (pure copy, R14a defect-2 fix)", () => {
  it("names the source, the row count, and the data-through date for a healthy pull", () => {
    const line = refreshRunSentence(mkRow({ source: "gsc", rows_persisted: 8397, latest_data_date: "2026-07-17" }));
    expect(line).toBe("I pulled fresh Search Console data: 8,397 rows through Jul 17.");
  });

  it("gives the honest failed line with no vendor jargon", () => {
    const line = refreshRunSentence(
      mkRow({ source: "ga4", result: "failed", rows_persisted: null, latest_data_date: null }),
    );
    expect(line).toBe("The Analytics pull did not work. I keep retrying.");
    expect(line).not.toMatch(/[‒–—―]/);
  });

  it("gives an honest partial line (claimed success, no new data) instead of a false win", () => {
    const line = refreshRunSentence(
      mkRow({ source: "profound", result: "partial", rows_persisted: 0, latest_data_date: "2026-07-15" }),
    );
    expect(line).toBe("The AI answer tracking pull ran but found no new data since Jul 15.");
  });

  it("never claims a lying row count when a healthy pull wrote zero new rows", () => {
    const line = refreshRunSentence(
      mkRow({ source: "clarity", result: "ok", rows_persisted: 0, latest_data_date: "2026-07-16" }),
    );
    expect(line).toBe("I checked Clarity. Nothing new since Jul 16.");
  });
});

describe("loadActivityFeed refresh-run join (defect 2)", () => {
  it("surfaces a recent ok pull and a recent failed pull as honest activity entries", async () => {
    listRecentRefreshRuns.mockResolvedValue([
      mkRow({
        id: "gsc-ok",
        source: "gsc",
        result: "ok",
        rows_persisted: 8397,
        latest_data_date: "2026-07-17",
        finished_at: "2026-07-19T03:02:00.000Z",
      }),
      mkRow({
        id: "ga4-failed",
        source: "ga4",
        result: "failed",
        rows_persisted: null,
        latest_data_date: null,
        finished_at: "2026-07-19T03:05:00.000Z",
      }),
    ]);

    const feed = await loadActivityFeed(NOW);

    const gsc = feed.events.find((e) => e.title === "Search Console data refreshed");
    const ga4 = feed.events.find((e) => e.title === "Analytics pull failed");

    expect(gsc).toBeDefined();
    expect(gsc?.sentence).toBe("I pulled fresh Search Console data: 8,397 rows through Jul 17.");
    expect(gsc?.href).toBe("/settings/connectors");

    expect(ga4).toBeDefined();
    expect(ga4?.sentence).toBe("The Analytics pull did not work. I keep retrying.");
    expect(feed.anyReadFailed).toBe(false);
  });

  it("drops refresh pulls older than the 7-day lookback window", async () => {
    listRecentRefreshRuns.mockResolvedValue([
      mkRow({ id: "stale", source: "clarity", finished_at: "2026-06-01T00:00:00.000Z" }),
    ]);

    const feed = await loadActivityFeed(NOW);
    expect(feed.events.find((e) => e.title.startsWith("Clarity"))).toBeUndefined();
  });

  it("collapses repeated same-day retries for one source to a single entry", async () => {
    listRecentRefreshRuns.mockResolvedValue([
      mkRow({
        id: "retry-1",
        source: "clarity",
        result: "failed",
        finished_at: "2026-07-19T02:00:00.000Z",
      }),
      mkRow({
        id: "retry-2",
        source: "clarity",
        result: "ok",
        rows_persisted: 42,
        latest_data_date: "2026-07-19",
        finished_at: "2026-07-19T08:00:00.000Z",
      }),
    ]);

    const feed = await loadActivityFeed(NOW);
    const clarityEvents = feed.events.filter((e) => e.title.startsWith("Clarity"));
    expect(clarityEvents).toHaveLength(1);
    // The later same-day retry (the eventual success) wins over the earlier failure.
    expect(clarityEvents[0]?.sentence).toContain("I pulled fresh Clarity data");
  });
});
