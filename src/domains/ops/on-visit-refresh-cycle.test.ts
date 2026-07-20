/**
 * on-visit-refresh-cycle.test.ts
 *
 * Pins the cross-instance claim gating in runPostResponseCycle: when another
 * instance already owns today's cycle ("already-claimed"), this instance does
 * NOTHING - no connector refresh, no crawl, no research, no receipt write - and
 * never releases a claim it did not take. The "claimed" path, by contrast, does
 * the work and releases the lock in its finally.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const claimAutonomousRunMock = vi.fn();
const releaseAutonomousRunMock = vi.fn();
vi.mock("./autonomous-run-claim", () => ({
  claimAutonomousRun: (...a: unknown[]) => claimAutonomousRunMock(...a),
  releaseAutonomousRun: (...a: unknown[]) => releaseAutonomousRunMock(...a),
}));

const autoRefreshStaleConnectorsForTenantMock = vi.fn();
vi.mock("@/lib/connectors/on-use-refresh", () => ({
  autoRefreshStaleConnectorsForTenant: (...a: unknown[]) => autoRefreshStaleConnectorsForTenantMock(...a),
}));

const continueDeepBackfillIfStartedMock = vi.fn();
vi.mock("@/lib/connectors/gsc/deep-backfill", () => ({
  continueDeepBackfillIfStarted: (...a: unknown[]) => continueDeepBackfillIfStartedMock(...a),
}));

const refreshStaleCrawlForCurrentTenantMock = vi.fn();
vi.mock("@/domains/scanning/stale-crawl-refresh", () => ({
  refreshStaleCrawlForCurrentTenant: (...a: unknown[]) => refreshStaleCrawlForCurrentTenantMock(...a),
}));

const runAutonomousResearchForTenantMock = vi.fn();
vi.mock("./autonomous-research", () => ({
  runAutonomousResearchForTenant: (...a: unknown[]) => runAutonomousResearchForTenantMock(...a),
}));

const replenishReadyQueueForTenantMock = vi.fn();
vi.mock("./ready-queue-replenishment", () => ({
  replenishReadyQueueForTenant: (...a: unknown[]) => replenishReadyQueueForTenantMock(...a),
}));

const recoverAbandonedPageFactoryForTenantMock = vi.fn();
vi.mock("./recover-abandoned-work", () => ({
  recoverAbandonedPageFactoryForTenant: (...a: unknown[]) => recoverAbandonedPageFactoryForTenantMock(...a),
}));

const readLastWarmReceiptMock = vi.fn();
const recordWarmRunMock = vi.fn();
vi.mock("./warm-receipt-store", () => ({
  readLastWarmReceipt: (...a: unknown[]) => readLastWarmReceiptMock(...a),
  recordWarmRun: (...a: unknown[]) => recordWarmRunMock(...a),
}));

import { runPostResponseCycle } from "./on-visit-refresh";

const T = "tenant-iranopedia";

beforeEach(() => {
  vi.clearAllMocks();
  autoRefreshStaleConnectorsForTenantMock.mockResolvedValue([]);
  continueDeepBackfillIfStartedMock.mockResolvedValue({ ran: false, reason: "not_started" });
  refreshStaleCrawlForCurrentTenantMock.mockResolvedValue(null);
  readLastWarmReceiptMock.mockResolvedValue(null);
  recordWarmRunMock.mockResolvedValue(undefined);
  runAutonomousResearchForTenantMock.mockResolvedValue({ ok: true, steps: [], date: "2026-07-18", ran_at: "x", totalMs: 1, tenant_id: T });
  replenishReadyQueueForTenantMock.mockResolvedValue({ skipped: true });
  recoverAbandonedPageFactoryForTenantMock.mockResolvedValue({ status: "not_needed" });
  releaseAutonomousRunMock.mockResolvedValue(undefined);
});

describe("runPostResponseCycle claim gating", () => {
  it("does no work and releases nothing when another instance already owns today", async () => {
    claimAutonomousRunMock.mockResolvedValue("already-claimed");

    await runPostResponseCycle(T);

    expect(claimAutonomousRunMock).toHaveBeenCalledTimes(1);
    expect(autoRefreshStaleConnectorsForTenantMock).not.toHaveBeenCalled();
    expect(continueDeepBackfillIfStartedMock).not.toHaveBeenCalled();
    expect(refreshStaleCrawlForCurrentTenantMock).not.toHaveBeenCalled();
    expect(runAutonomousResearchForTenantMock).not.toHaveBeenCalled();
    expect(recordWarmRunMock).not.toHaveBeenCalled();
    expect(recoverAbandonedPageFactoryForTenantMock).not.toHaveBeenCalled();
    // Nothing was claimed by THIS instance, so nothing is released.
    expect(releaseAutonomousRunMock).not.toHaveBeenCalled();
  });

  it("runs the cycle and releases the lock in finally when it wins the claim", async () => {
    claimAutonomousRunMock.mockResolvedValue("claimed");

    await runPostResponseCycle(T);

    expect(autoRefreshStaleConnectorsForTenantMock).toHaveBeenCalledWith(T);
    expect(runAutonomousResearchForTenantMock).toHaveBeenCalled();
    expect(releaseAutonomousRunMock).toHaveBeenCalledTimes(1);
    expect(releaseAutonomousRunMock).toHaveBeenCalledWith(T, expect.any(String));
  });

  it("releases the lock even when the owned cycle throws", async () => {
    claimAutonomousRunMock.mockResolvedValue("claimed");
    autoRefreshStaleConnectorsForTenantMock.mockRejectedValue(new Error("boom"));
    // The connector refresh has its own catch, so force a throw deeper: make the
    // recovery step throw AND its catch is internal, so instead throw from
    // readLastWarmReceipt which is not individually caught.
    readLastWarmReceiptMock.mockRejectedValue(new Error("store down"));

    await expect(runPostResponseCycle(T)).rejects.toThrow();
    expect(releaseAutonomousRunMock).toHaveBeenCalledTimes(1);
  });

  it("proceeds best-effort (no claim held) when the lock is unavailable", async () => {
    claimAutonomousRunMock.mockResolvedValue("unavailable");

    await runPostResponseCycle(T);

    expect(autoRefreshStaleConnectorsForTenantMock).toHaveBeenCalledWith(T);
    expect(runAutonomousResearchForTenantMock).toHaveBeenCalled();
    // Nothing durable was claimed, so nothing is released.
    expect(releaseAutonomousRunMock).not.toHaveBeenCalled();
  });
});

/**
 * Pins the GSC deep-history backfill continuation wired into the owned cycle:
 * Beacon has no scheduler, so the nightly cron path that used to advance a
 * started backfill never runs. The on-use cycle now advances exactly one chunk
 * per visit so a started backfill finishes during normal use, no-ops cheaply for
 * every tenant that never started one, isolates its own failures, and is bounded
 * by the cycle deadline so a wedged GSC pull can never strand the cycle.
 */
describe("runPostResponseCycle GSC deep-backfill continuation", () => {
  beforeEach(() => {
    claimAutonomousRunMock.mockResolvedValue("claimed");
  });

  it("advances exactly one chunk when a backfill is in progress", async () => {
    continueDeepBackfillIfStartedMock.mockResolvedValue({
      ran: true,
      property: ["sc-domain", "example.com"].join(":"),
      chunkStart: "2025-01-01",
      chunkEnd: "2025-01-30",
      daysPulled: 30,
      rowsUpserted: 1200,
      complete: false,
    });

    await runPostResponseCycle(T);

    expect(continueDeepBackfillIfStartedMock).toHaveBeenCalledTimes(1);
    expect(continueDeepBackfillIfStartedMock).toHaveBeenCalledWith(T, expect.any(Date));
    // The rest of the cycle still runs after the chunk.
    expect(runAutonomousResearchForTenantMock).toHaveBeenCalled();
    expect(releaseAutonomousRunMock).toHaveBeenCalledTimes(1);
  });

  it("skips cheaply (one call, no chunk) when no backfill was ever started", async () => {
    continueDeepBackfillIfStartedMock.mockResolvedValue({ ran: false, reason: "not_started" });

    await runPostResponseCycle(T);

    // One cheap read-only probe per cycle; the rest of the cycle is unaffected.
    expect(continueDeepBackfillIfStartedMock).toHaveBeenCalledTimes(1);
    expect(runAutonomousResearchForTenantMock).toHaveBeenCalled();
    expect(releaseAutonomousRunMock).toHaveBeenCalledTimes(1);
  });

  it("a backfill failure does not abort the rest of the cycle", async () => {
    // The real continuation never throws, but the wrapper must isolate one if it
    // ever did: the research pass, recovery, and lock release all still run.
    continueDeepBackfillIfStartedMock.mockRejectedValue(new Error("gsc 500"));

    await runPostResponseCycle(T);

    expect(continueDeepBackfillIfStartedMock).toHaveBeenCalledTimes(1);
    expect(runAutonomousResearchForTenantMock).toHaveBeenCalled();
    expect(releaseAutonomousRunMock).toHaveBeenCalledTimes(1);
  });

  it("respects the cycle deadline: a slow chunk is abandoned and the cycle continues", async () => {
    // A chunk slower than the injected budget must not strand the cycle. The
    // loader is abandoned (its cursor is untouched, so the next visit resumes)
    // and research still runs.
    let resolveSlow: (v: unknown) => void = () => {};
    continueDeepBackfillIfStartedMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSlow = resolve;
        }),
    );

    await runPostResponseCycle(T, { deadlineMs: 10 });

    expect(continueDeepBackfillIfStartedMock).toHaveBeenCalledTimes(1);
    expect(runAutonomousResearchForTenantMock).toHaveBeenCalled();
    expect(releaseAutonomousRunMock).toHaveBeenCalledTimes(1);
    // Let the abandoned loader settle so it never surfaces as an unhandled reject.
    resolveSlow({ ran: false, reason: "not_started" });
  });
});
