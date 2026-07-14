import { describe, expect, it, vi } from "vitest";

import { recoverAbandonedPageFactoryForTenant, type PageFactoryRecoveryDeps } from "./recover-abandoned-work";
import type { CronRunRow } from "./cron-runs-store";
import type { ProductionLineSummary } from "@/domains/page-factory/production-line";

const NOW = new Date("2026-07-14T20:00:00.000Z");

function run(phase: "running" | "finished", startedAt: string): CronRunRow {
  return {
    id: "run-1",
    tenant_id: null,
    job: "page-factory",
    started_at: startedAt,
    finished_at: startedAt,
    duration_ms: 0,
    ok: phase === "finished",
    per_source: [],
    notes: {},
    created_at: startedAt,
    phase,
  };
}

const summary = (reason = "ok"): ProductionLineSummary => ({
  tenantId: "tenant-iranopedia",
  weekOf: "2026-07-13",
  ran: reason === "ok",
  reason,
  drafted: reason === "ok" ? 3 : 0,
  queued: 1,
  rejected: 2,
  costUsd: 0.12,
  batch: null,
});

function deps(over: Partial<PageFactoryRecoveryDeps> = {}): Partial<PageFactoryRecoveryDeps> {
  return {
    listRuns: vi.fn(async () => [run("running", "2026-07-13T13:49:00.000Z")]),
    hasBatch: vi.fn(async () => false),
    runFactory: vi.fn(async () => summary()),
    recordRun: vi.fn(async () => {}),
    ...over,
  };
}

describe("recoverAbandonedPageFactoryForTenant", () => {
  it("does nothing when the latest invocation is healthy", async () => {
    const d = deps({ listRuns: vi.fn(async () => [run("finished", "2026-07-13T13:49:00.000Z")]) });
    const result = await recoverAbandonedPageFactoryForTenant("tenant-iranopedia", NOW, d);
    expect(result.status).toBe("not_needed");
    expect(d.runFactory).not.toHaveBeenCalled();
  });

  it("reconciles an abandoned receipt when this week's batch already exists", async () => {
    const d = deps({ hasBatch: vi.fn(async () => true) });
    const result = await recoverAbandonedPageFactoryForTenant("tenant-iranopedia", NOW, d);
    expect(result.status).toBe("reconciled");
    expect(d.runFactory).not.toHaveBeenCalled();
    expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      job: "page-factory",
      tenantId: "tenant-iranopedia",
      ok: true,
      notes: expect.objectContaining({ recovered_on_visit: true }),
    }));
  });

  it("reruns the idempotent current-week factory and clears the deadman on success", async () => {
    const d = deps();
    const result = await recoverAbandonedPageFactoryForTenant("tenant-iranopedia", NOW, d);
    expect(result.status).toBe("recovered");
    expect(d.runFactory).toHaveBeenCalledWith("tenant-iranopedia", "2026-07-13", NOW);
    expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      notes: expect.objectContaining({ recovered_on_visit: true, drafted: 3 }),
    }));
  });

  it("leaves the abandoned alarm intact when recovery itself fails", async () => {
    const d = deps({ runFactory: vi.fn(async () => summary("error: graph load failed")) });
    const result = await recoverAbandonedPageFactoryForTenant("tenant-iranopedia", NOW, d);
    expect(result.status).toBe("failed");
    expect(d.recordRun).not.toHaveBeenCalled();
  });
});
