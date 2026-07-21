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

const runOnVisitEnrichmentMock = vi.fn();
vi.mock("./on-visit-enrichment", () => ({
  runOnVisitEnrichment: (...a: unknown[]) => runOnVisitEnrichmentMock(...a),
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
import { log } from "@/lib/logger";

const T = "tenant-iranopedia";
// Enrichment now runs LAST behind a 5s production settle; inject 0 so the cycle
// under test does not idle a real timer. Ordering-critical assertions live in the
// dedicated "enrichment runs last" describe below.
const CYCLE_OPTS = { enrichmentSettleMs: 0 } as const;

beforeEach(() => {
  vi.clearAllMocks();
  autoRefreshStaleConnectorsForTenantMock.mockResolvedValue([]);
  continueDeepBackfillIfStartedMock.mockResolvedValue({ ran: false, reason: "not_started" });
  refreshStaleCrawlForCurrentTenantMock.mockResolvedValue(null);
  readLastWarmReceiptMock.mockResolvedValue(null);
  recordWarmRunMock.mockResolvedValue(undefined);
  runAutonomousResearchForTenantMock.mockResolvedValue({ ok: true, steps: [], date: "2026-07-18", ran_at: "x", totalMs: 1, tenant_id: T });
  runOnVisitEnrichmentMock.mockResolvedValue({ ran: [], failed: [], skippedPastDeadline: [] });
  replenishReadyQueueForTenantMock.mockResolvedValue({ skipped: true });
  recoverAbandonedPageFactoryForTenantMock.mockResolvedValue({ status: "not_needed" });
  releaseAutonomousRunMock.mockResolvedValue(undefined);
});

describe("runPostResponseCycle claim gating", () => {
  it("does no work and releases nothing when another instance already owns today", async () => {
    claimAutonomousRunMock.mockResolvedValue("already-claimed");

    await runPostResponseCycle(T, CYCLE_OPTS);

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

    await runPostResponseCycle(T, CYCLE_OPTS);

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

    await expect(runPostResponseCycle(T, CYCLE_OPTS)).rejects.toThrow();
    expect(releaseAutonomousRunMock).toHaveBeenCalledTimes(1);
  });

  it("proceeds best-effort (no claim held) when the lock is unavailable", async () => {
    claimAutonomousRunMock.mockResolvedValue("unavailable");

    await runPostResponseCycle(T, CYCLE_OPTS);

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

    await runPostResponseCycle(T, CYCLE_OPTS);

    expect(continueDeepBackfillIfStartedMock).toHaveBeenCalledTimes(1);
    expect(continueDeepBackfillIfStartedMock).toHaveBeenCalledWith(T, expect.any(Date));
    // The rest of the cycle still runs after the chunk.
    expect(runAutonomousResearchForTenantMock).toHaveBeenCalled();
    expect(releaseAutonomousRunMock).toHaveBeenCalledTimes(1);
  });

  it("skips cheaply (one call, no chunk) when no backfill was ever started", async () => {
    continueDeepBackfillIfStartedMock.mockResolvedValue({ ran: false, reason: "not_started" });

    await runPostResponseCycle(T, CYCLE_OPTS);

    // One cheap read-only probe per cycle; the rest of the cycle is unaffected.
    expect(continueDeepBackfillIfStartedMock).toHaveBeenCalledTimes(1);
    expect(runAutonomousResearchForTenantMock).toHaveBeenCalled();
    expect(releaseAutonomousRunMock).toHaveBeenCalledTimes(1);
  });

  it("a backfill failure does not abort the rest of the cycle", async () => {
    // The real continuation never throws, but the wrapper must isolate one if it
    // ever did: the research pass, recovery, and lock release all still run.
    continueDeepBackfillIfStartedMock.mockRejectedValue(new Error("gsc 500"));

    await runPostResponseCycle(T, CYCLE_OPTS);

    expect(continueDeepBackfillIfStartedMock).toHaveBeenCalledTimes(1);
    expect(runAutonomousResearchForTenantMock).toHaveBeenCalled();
    expect(releaseAutonomousRunMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a real chunk failure (auth/quota/network) as a warn so a wedged backfill is not silent", async () => {
    continueDeepBackfillIfStartedMock.mockResolvedValue({ ran: false, reason: "gsc_auth_transient" });

    await runPostResponseCycle(T, CYCLE_OPTS);

    expect(log.warn).toHaveBeenCalledWith(
      "[autonomous] gsc deep backfill chunk did not advance",
      expect.objectContaining({ tenantId: T, reason: "gsc_auth_transient" }),
    );
    // The rest of the cycle is unaffected by a failed chunk.
    expect(runAutonomousResearchForTenantMock).toHaveBeenCalled();
    expect(releaseAutonomousRunMock).toHaveBeenCalledTimes(1);
  });

  it("stays silent on the benign no-op reasons that fire for every tenant with no backfill", async () => {
    continueDeepBackfillIfStartedMock.mockResolvedValue({ ran: false, reason: "already_complete" });

    await runPostResponseCycle(T, CYCLE_OPTS);

    expect(log.warn).not.toHaveBeenCalledWith(
      "[autonomous] gsc deep backfill chunk did not advance",
      expect.anything(),
    );
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

    await runPostResponseCycle(T, { deadlineMs: 10, enrichmentSettleMs: 0 });

    expect(continueDeepBackfillIfStartedMock).toHaveBeenCalledTimes(1);
    expect(runAutonomousResearchForTenantMock).toHaveBeenCalled();
    expect(releaseAutonomousRunMock).toHaveBeenCalledTimes(1);
    // Let the abandoned loader settle so it never surfaces as an unhandled reject.
    resolveSlow({ ran: false, reason: "not_started" });
  });
});

/**
 * Pins the reliability fix: the once-daily $0 enrichment spine runs LAST, after
 * the whole customer-critical path, behind a settle guard. It previously ran
 * FIRST inside the daily branch, where its bounded Supabase reads competed with
 * the same visit's SWR surface rebuilds; that shared connection pressure once
 * pushed the readiness-critical drafts read past its timeout and silently zeroed
 * the Ready queue. These tests prove enrichment cannot begin until the
 * surface-critical steps have finished, and that a slow enrichment cannot delay
 * or starve them.
 */
describe("runPostResponseCycle enrichment runs last (reliability fix)", () => {
  beforeEach(() => {
    claimAutonomousRunMock.mockResolvedValue("claimed");
  });

  it("starts enrichment only after research + surface-warm/recovery complete", async () => {
    // A deliberately slow enrichment: it parks until released. The cycle must have
    // already driven every surface-critical step to completion before enrichment's
    // first line runs, so a starved Ready queue is structurally impossible.
    const enrichmentStarted = vi.fn();
    let releaseEnrichment: () => void = () => {};
    runOnVisitEnrichmentMock.mockImplementation(() => {
      enrichmentStarted();
      return new Promise((resolve) => {
        releaseEnrichment = () => resolve({ ran: [], failed: [], skippedPastDeadline: [] });
      });
    });

    // Do NOT await yet: enrichment parks, so the cycle promise stays pending.
    const cyclePromise = runPostResponseCycle(T, { enrichmentSettleMs: 0 });

    // Drain until the slow enrichment is entered. By construction, everything the
    // customer sees had to finish first.
    await vi.waitFor(() => expect(enrichmentStarted).toHaveBeenCalledTimes(1));

    // The surface-critical path is provably done before enrichment's first read.
    expect(runAutonomousResearchForTenantMock).toHaveBeenCalledTimes(1);
    expect(recoverAbandonedPageFactoryForTenantMock).toHaveBeenCalledTimes(1);
    // The terminal research receipt was already written (started + terminal).
    expect(recordWarmRunMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Invocation order is the hard proof: enrichment is strictly last.
    const researchAt = runAutonomousResearchForTenantMock.mock.invocationCallOrder[0]!;
    const recoveryAt = recoverAbandonedPageFactoryForTenantMock.mock.invocationCallOrder[0]!;
    const enrichmentAt = runOnVisitEnrichmentMock.mock.invocationCallOrder[0]!;
    expect(researchAt).toBeLessThan(enrichmentAt);
    expect(recoveryAt).toBeLessThan(enrichmentAt);

    // Release the parked enrichment so the cycle can settle cleanly.
    releaseEnrichment();
    await cyclePromise;
    expect(releaseAutonomousRunMock).toHaveBeenCalledTimes(1);
  });

  it("waits the settle delay after the critical path before touching enrichment", async () => {
    // The settle guard is injectable; assert it is applied (with the configured
    // delay) and only after the surface-critical steps have run.
    const sleepSpy = vi.fn().mockResolvedValue(undefined);

    await runPostResponseCycle(T, { enrichmentSettleMs: 250, sleep: sleepSpy });

    expect(sleepSpy).toHaveBeenCalledTimes(1);
    expect(sleepSpy).toHaveBeenCalledWith(250);
    const sleepAt = sleepSpy.mock.invocationCallOrder[0]!;
    const researchAt = runAutonomousResearchForTenantMock.mock.invocationCallOrder[0]!;
    const enrichmentAt = runOnVisitEnrichmentMock.mock.invocationCallOrder[0]!;
    // Settle happens after research, before enrichment.
    expect(researchAt).toBeLessThan(sleepAt);
    expect(sleepAt).toBeLessThan(enrichmentAt);
  });

  it("does not run enrichment at all on a non-research day", async () => {
    // A successful same-day receipt suppresses research; enrichment is gated on the
    // same daily branch, so it must not run either (only queue replenishment does).
    readLastWarmReceiptMock.mockResolvedValue({
      tenant_id: T,
      date: new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
      ran_at: new Date().toISOString(),
      ok: true,
      totalMs: 1,
      trigger: "visit",
      steps: [],
    });

    await runPostResponseCycle(T, CYCLE_OPTS);

    expect(runAutonomousResearchForTenantMock).not.toHaveBeenCalled();
    expect(replenishReadyQueueForTenantMock).toHaveBeenCalledTimes(1);
    expect(runOnVisitEnrichmentMock).not.toHaveBeenCalled();
  });
});
