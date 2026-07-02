import { describe, it, expect, vi, beforeEach } from "vitest";

let runsByJob: Record<string, unknown[]> = {};
vi.mock("./cron-runs-store", () => ({
  listRecentCronRuns: async (job: string) => runsByJob[job] ?? [],
}));

import { loadCronHealthView } from "./cron-health-view";
import { CRON_SCHEDULE_MAP } from "./cron-schedule-map";

function run(startedAt: string, ok: boolean, perSource: Array<{ tenantId: string | null; provider: string; ok: boolean; detail: string }>) {
  return {
    id: startedAt,
    tenant_id: null,
    job: "sync-connectors",
    started_at: startedAt,
    finished_at: startedAt,
    duration_ms: 1000,
    ok,
    per_source: perSource,
    notes: {},
    created_at: startedAt,
  };
}

beforeEach(() => {
  runsByJob = {};
});

describe("loadCronHealthView", () => {
  it("returns one entry per scheduled job", async () => {
    const view = await loadCronHealthView();
    expect(view).toHaveLength(CRON_SCHEDULE_MAP.length);
  });

  it("says 'I have not run yet' when there is no history", async () => {
    const view = await loadCronHealthView();
    const sync = view.find((j) => j.job === "sync-connectors");
    expect(sync?.headline).toBe("I have not run yet.");
    expect(sync?.lastRun).toBeNull();
  });

  it("builds the 'showed up N of M nights' headline naming the worst source", async () => {
    runsByJob["sync-connectors"] = [
      run("2026-07-03T09:00:00Z", true, [{ tenantId: "tenant-a", provider: "google_gsc", ok: true, detail: "synced" }]),
      run("2026-07-02T09:00:00Z", false, [{ tenantId: "tenant-a", provider: "google_gsc", ok: false, detail: "401" }]),
      run("2026-07-01T09:00:00Z", true, [{ tenantId: "tenant-a", provider: "google_gsc", ok: true, detail: "synced" }]),
    ];
    const view = await loadCronHealthView();
    const sync = view.find((j) => j.job === "sync-connectors");
    expect(sync?.headline).toContain("I showed up 2 of 3 nights this week");
    expect(sync?.headline).toContain("Search Console synced 2 of 3 nights");
  });

  it("reports per-source success counts for the week", async () => {
    runsByJob["sync-connectors"] = [
      run("2026-07-03T09:00:00Z", true, [
        { tenantId: "tenant-a", provider: "google_gsc", ok: true, detail: "synced" },
        { tenantId: "tenant-a", provider: "clarity", ok: true, detail: "synced" },
      ]),
    ];
    const view = await loadCronHealthView();
    const sync = view.find((j) => j.job === "sync-connectors");
    expect(sync?.perSourceThisWeek).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "google_gsc", successNights: 1, totalNights: 1 }),
        expect.objectContaining({ provider: "clarity", successNights: 1, totalNights: 1 }),
      ]),
    );
  });

  it("surfaces a 3+ night failure streak", async () => {
    runsByJob["sync-connectors"] = [
      run("2026-07-03T09:00:00Z", false, [{ tenantId: "tenant-a", provider: "profound", ok: false, detail: "timeout" }]),
      run("2026-07-02T09:00:00Z", false, [{ tenantId: "tenant-a", provider: "profound", ok: false, detail: "timeout" }]),
      run("2026-07-01T09:00:00Z", false, [{ tenantId: "tenant-a", provider: "profound", ok: false, detail: "timeout" }]),
    ];
    const view = await loadCronHealthView();
    const sync = view.find((j) => j.job === "sync-connectors");
    expect(sync?.failureStreaks).toEqual([
      expect.objectContaining({ provider: "profound", consecutiveFailures: 3, lastFailureDetail: "timeout" }),
    ]);
  });

  it("includes a next-scheduled ISO timestamp for every job", async () => {
    const view = await loadCronHealthView();
    for (const j of view) {
      expect(j.nextScheduledAtIso).toBeTruthy();
    }
  });

  it("degrades a single job to an honest error headline without throwing", async () => {
    vi.doMock("./cron-runs-store", () => ({
      listRecentCronRuns: async (job: string) => {
        if (job === "sync-connectors") throw new Error("boom");
        return [];
      },
    }));
    vi.resetModules();
    const mod = await import("./cron-health-view");
    const view = await mod.loadCronHealthView();
    const sync = view.find((j) => j.job === "sync-connectors");
    expect(sync?.headline).toBe("I could not read my run history right now.");
  });
});
