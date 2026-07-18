import { describe, expect, it } from "vitest";

import { buildAutonomousHealth } from "./autonomous-health";
import type { RefreshRunRow, RefreshSource } from "./refresh-runs-store";
import type { WarmRunReceipt } from "./warm-receipt-store";

const NOW = new Date("2026-07-18T06:00:00.000Z");

function refresh(source: RefreshSource, result: RefreshRunRow["result"] = "ok"): RefreshRunRow {
  return {
    id: source,
    tenant_id: "tenant-iranopedia",
    source,
    trigger: "on-use",
    started_at: "2026-07-18T05:00:00.000Z",
    finished_at: "2026-07-18T05:01:00.000Z",
    duration_ms: 60_000,
    result,
    rows_persisted: 10,
    latest_data_date: "2026-07-17",
    failure_category: result === "ok" ? null : "token expired",
    next_retry_at: null,
    created_at: "2026-07-18T05:01:00.000Z",
  };
}

function receipt(overrides: Partial<WarmRunReceipt> = {}): WarmRunReceipt {
  return {
    tenant_id: "tenant-iranopedia",
    date: "2026-07-17",
    ran_at: "2026-07-18T05:30:00.000Z",
    ok: true,
    totalMs: 100,
    trigger: "visit",
    steps: [],
    ...overrides,
  };
}

describe("buildAutonomousHealth", () => {
  it("says the lifecycle starts on use when no receipt exists", () => {
    expect(buildAutonomousHealth({ receipt: null, latestBySource: {}, connectedSources: [], now: NOW }))
      .toEqual({ state: "none", headline: "starts when you use Beacon." });
  });

  it("shows the durable running phase without claiming completion", () => {
    const out = buildAutonomousHealth({
      receipt: receipt({
        ok: false,
        steps: [{ name: "autonomous-research", ok: true, ms: 0, note: "running after this response" }],
      }),
      latestBySource: {},
      connectedSources: [],
      now: NOW,
    });
    expect(out).toEqual({ state: "working", headline: "working now in the background." });
  });

  it("reports only connected-source failures", () => {
    const out = buildAutonomousHealth({
      receipt: receipt(),
      latestBySource: { gsc: refresh("gsc", "failed"), profound: refresh("profound", "failed") },
      connectedSources: ["gsc"],
      now: NOW,
    });
    expect(out.state).toBe("issues");
    expect(out.headline).toContain("1 connected source needs attention");
  });

  it("uses the newest on-use evidence for a clean completion line", () => {
    const out = buildAutonomousHealth({
      receipt: receipt(),
      latestBySource: { gsc: refresh("gsc") },
      connectedSources: ["gsc"],
      now: NOW,
    });
    expect(out.state).toBe("ok");
    expect(out.headline).toContain("last finished Jul 17, 10:30 PM");
    expect(out.headline).not.toMatch(/night|schedule|cron/i);
  });
});
