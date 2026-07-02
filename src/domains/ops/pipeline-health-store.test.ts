/**
 * pipeline-health-store (2026-07-02, master plan item 10).
 *
 * Round-trip on an in-memory json-store + the registration pins that make the
 * store real: GLOBAL classification (cron fan-out, rows carry tenant_id) and
 * the Supabase mirror entry (Vercel durability).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let stored: unknown[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => stored,
  writeStore: async (_name: string, data: unknown[]) => {
    stored = data;
  },
}));

import {
  buildPipelineHealthRow,
  readPipelineHealth,
  writePipelineHealth,
  type PipelineHealthRow,
} from "./pipeline-health-store";
import { checkPipelineInvariants, RECENT_WINDOW_HOURS, type PipelineReadings } from "./pipeline-invariants";
import { classifyStore } from "@/lib/persistence/store-classification";

const NOW = new Date("2026-07-02T12:00:00.000Z");

function readings(over: Partial<PipelineReadings> = {}): PipelineReadings {
  return {
    tenantId: "tenant-a",
    checkedAt: NOW.toISOString(),
    recentWindowHours: RECENT_WINDOW_HOURS,
    connectors: {
      gsc: { connected: true, lastSyncedAt: NOW.toISOString() },
      ga4: { connected: false, lastSyncedAt: null },
      profound: { connected: false, lastSyncedAt: null },
    },
    tables: {
      gsc_daily_rows: { recentRows: 0, latestRowAt: "2026-06-30T02:00:00Z" },
      ga4_url_traffic: { recentRows: null, latestRowAt: null },
      ga4_ai_referral_daily: { recentRows: null, latestRowAt: null },
      profound_citation_rows: { recentRows: null, latestRowAt: null },
      prompt_answer_observations: { recentRows: null, latestRowAt: null },
    },
    dailyPlan: { hasPlan: true, candidateCount: 3, planCreatedAt: NOW.toISOString() },
    demandGraph: { nodes: 214, moves: 237 },
    ...over,
  };
}

beforeEach(() => {
  stored = [];
});

describe("registration pins", () => {
  it("pipeline-violations is a GLOBAL store (cron fan-out; rows carry tenant_id)", () => {
    expect(classifyStore("pipeline-violations")).toBe("global");
  });

  it("pipeline-violations is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../lib/persistence/json-store.ts"),
      "utf8",
    );
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"pipeline-violations"');
  });
});

describe("round-trip", () => {
  it("writes the latest check and reads it back for the same tenant", async () => {
    const r = readings();
    const violations = checkPipelineInvariants(r);
    expect(violations.length).toBeGreaterThan(0); // gsc wrote 0 rows
    await writePipelineHealth(buildPipelineHealthRow(r, violations));
    const back = await readPipelineHealth("tenant-a", NOW);
    expect(back).not.toBeNull();
    expect(back!.tenant_id).toBe("tenant-a");
    expect(back!.violations.map((v) => v.stage)).toEqual(violations.map((v) => v.stage));
    expect(back!.summary.gscRecentRows).toBe(0);
    expect(back!.summary.planCandidates).toBe(3);
    expect(back!.summary.graphMoves).toBe(237);
  });

  it("latest wins per tenant; other tenants untouched", async () => {
    await writePipelineHealth(buildPipelineHealthRow(readings({ tenantId: "tenant-b" }), []));
    await writePipelineHealth(buildPipelineHealthRow(readings(), [
      { stage: "gsc_sync", expected: "x", actual: "y", sentence: "s" },
    ]));
    await writePipelineHealth(buildPipelineHealthRow(readings(), []));
    expect((await readPipelineHealth("tenant-a", NOW))!.violations).toEqual([]);
    expect(await readPipelineHealth("tenant-b", NOW)).not.toBeNull();
    expect((stored as PipelineHealthRow[]).filter((r) => r.tenant_id === "tenant-a")).toHaveLength(1);
  });

  it("a clean run OVERWRITES a prior alarm (silence when clean)", async () => {
    await writePipelineHealth(buildPipelineHealthRow(readings(), [
      { stage: "ga4_sync", expected: "x", actual: "y", sentence: "s" },
    ]));
    await writePipelineHealth(buildPipelineHealthRow(readings(), []));
    const back = await readPipelineHealth("tenant-a", NOW);
    expect(back!.violations).toEqual([]);
  });

  it("hides a check older than 7 days (honest staleness) and missing tenants", async () => {
    const old = buildPipelineHealthRow(
      readings({ checkedAt: "2026-06-20T12:00:00.000Z" }),
      [{ stage: "gsc_sync", expected: "x", actual: "y", sentence: "s" }],
    );
    await writePipelineHealth(old);
    expect(await readPipelineHealth("tenant-a", NOW)).toBeNull();
    expect(await readPipelineHealth("tenant-never", NOW)).toBeNull();
  });

  it("read is fail-soft: a throwing store reads as null", async () => {
    const mod = await import("@/lib/persistence/json-store");
    const spy = vi.spyOn(mod, "readStore").mockRejectedValueOnce(new Error("disk gone"));
    expect(await readPipelineHealth("tenant-a", NOW)).toBeNull();
    spy.mockRestore();
  });
});
