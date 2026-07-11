import { describe, it, expect } from "vitest";
import { deriveProviderStreaks, streaksAtOrAboveThreshold, FAILURE_STREAK_ALERT_THRESHOLD } from "./cron-streak";
import type { CronRunRow } from "./cron-runs-store";

function run(startedAt: string, perSource: CronRunRow["per_source"]): CronRunRow {
  return {
    id: startedAt,
    tenant_id: null,
    job: "sync-connectors",
    started_at: startedAt,
    finished_at: startedAt,
    duration_ms: 1000,
    ok: perSource.every((s) => s.ok),
    per_source: perSource,
    notes: {},
    created_at: startedAt,
    phase: "finished",
  };
}

describe("deriveProviderStreaks", () => {
  it("counts consecutive failures from the most recent run backward", () => {
    const runs = [
      run("2026-07-03T09:00:00Z", [{ tenantId: "tenant-a", provider: "google_gsc", ok: false, detail: "401" }]),
      run("2026-07-02T09:00:00Z", [{ tenantId: "tenant-a", provider: "google_gsc", ok: false, detail: "401" }]),
      run("2026-07-01T09:00:00Z", [{ tenantId: "tenant-a", provider: "google_gsc", ok: false, detail: "401" }]),
      run("2026-06-30T09:00:00Z", [{ tenantId: "tenant-a", provider: "google_gsc", ok: true, detail: "synced" }]),
    ];
    const streaks = deriveProviderStreaks(runs);
    const gsc = streaks.find((s) => s.provider === "google_gsc");
    expect(gsc?.consecutiveFailures).toBe(3);
    expect(gsc?.lastFailureDetail).toBe("401");
    expect(gsc?.lastRunAt).toBe("2026-07-03T09:00:00Z");
  });

  it("stops counting at the first success looking backward", () => {
    const runs = [
      run("2026-07-03T09:00:00Z", [{ tenantId: "tenant-a", provider: "google_gsc", ok: false, detail: "x" }]),
      run("2026-07-02T09:00:00Z", [{ tenantId: "tenant-a", provider: "google_gsc", ok: true, detail: "synced" }]),
      run("2026-07-01T09:00:00Z", [{ tenantId: "tenant-a", provider: "google_gsc", ok: false, detail: "x" }]),
    ];
    const streaks = deriveProviderStreaks(runs);
    expect(streaks.find((s) => s.provider === "google_gsc")?.consecutiveFailures).toBe(1);
  });

  it("returns 0 streak when the most recent run succeeded", () => {
    const runs = [run("2026-07-03T09:00:00Z", [{ tenantId: "tenant-a", provider: "google_gsc", ok: true, detail: "synced" }])];
    const streaks = deriveProviderStreaks(runs);
    expect(streaks.find((s) => s.provider === "google_gsc")?.consecutiveFailures).toBe(0);
  });

  it("treats a night the pair is absent from as a gap, not a failure or success", () => {
    const runs = [
      run("2026-07-03T09:00:00Z", [{ tenantId: "tenant-a", provider: "google_gsc", ok: false, detail: "x" }]),
      // GSC wasn't connected/didn't appear this night at all (gap).
      run("2026-07-02T09:00:00Z", []),
      run("2026-07-01T09:00:00Z", [{ tenantId: "tenant-a", provider: "google_gsc", ok: false, detail: "x" }]),
    ];
    const streaks = deriveProviderStreaks(runs);
    // Only 2 nights actually recorded this pair, both failures -> streak 2.
    expect(streaks.find((s) => s.provider === "google_gsc")?.consecutiveFailures).toBe(2);
  });

  it("keeps different tenants' streaks for the same provider separate", () => {
    const runs = [
      run("2026-07-03T09:00:00Z", [
        { tenantId: "tenant-a", provider: "google_gsc", ok: false, detail: "x" },
        { tenantId: "tenant-b", provider: "google_gsc", ok: true, detail: "synced" },
      ]),
    ];
    const streaks = deriveProviderStreaks(runs);
    const a = streaks.find((s) => s.tenantId === "tenant-a" && s.provider === "google_gsc");
    const b = streaks.find((s) => s.tenantId === "tenant-b" && s.provider === "google_gsc");
    expect(a?.consecutiveFailures).toBe(1);
    expect(b?.consecutiveFailures).toBe(0);
  });

  it("sorts worst streak first", () => {
    const runs = [
      run("2026-07-03T09:00:00Z", [
        { tenantId: "tenant-a", provider: "google_gsc", ok: false, detail: "x" },
        { tenantId: "tenant-a", provider: "clarity", ok: false, detail: "y" },
      ]),
      run("2026-07-02T09:00:00Z", [{ tenantId: "tenant-a", provider: "clarity", ok: false, detail: "y" }]),
    ];
    const streaks = deriveProviderStreaks(runs);
    expect(streaks[0]!.provider).toBe("clarity");
    expect(streaks[0]!.consecutiveFailures).toBe(2);
  });

  it("does not depend on input already being sorted newest-first", () => {
    const runs = [
      run("2026-07-01T09:00:00Z", [{ tenantId: "tenant-a", provider: "google_gsc", ok: false, detail: "x" }]),
      run("2026-07-03T09:00:00Z", [{ tenantId: "tenant-a", provider: "google_gsc", ok: true, detail: "synced" }]),
      run("2026-07-02T09:00:00Z", [{ tenantId: "tenant-a", provider: "google_gsc", ok: false, detail: "x" }]),
    ];
    const streaks = deriveProviderStreaks(runs);
    // Newest is 07-03 (success) -> streak must be 0 regardless of input order.
    expect(streaks.find((s) => s.provider === "google_gsc")?.consecutiveFailures).toBe(0);
  });
});

describe("streaksAtOrAboveThreshold", () => {
  it("filters to the default 3-night threshold", () => {
    const streaks = [
      { tenantId: "t", provider: "google_gsc", consecutiveFailures: 2, lastRunAt: null, lastFailureDetail: null },
      { tenantId: "t", provider: "clarity", consecutiveFailures: 3, lastRunAt: null, lastFailureDetail: null },
      { tenantId: "t", provider: "profound", consecutiveFailures: 5, lastRunAt: null, lastFailureDetail: null },
    ];
    const alerted = streaksAtOrAboveThreshold(streaks);
    expect(alerted.map((s) => s.provider).sort()).toEqual(["clarity", "profound"]);
    expect(FAILURE_STREAK_ALERT_THRESHOLD).toBe(3);
  });
});
