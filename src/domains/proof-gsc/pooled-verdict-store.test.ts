/**
 * pooled-verdict-store (2026-07-02, master plan item 34).
 *
 * Round-trip on an in-memory json-store + the registration pins that make the store real: GLOBAL
 * classification (cron fan-out, rows carry tenant_id) and the Supabase mirror entry (Vercel
 * durability). Same discipline as algorithm-weather-store.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let stored: unknown[] = [];
const readRef = { throws: false };
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => {
    if (readRef.throws) throw new Error("store read failed");
    return stored;
  },
  writeStore: async (_name: string, data: unknown[]) => {
    stored = data;
  },
}));

import {
  loadPooledVerdicts,
  loadLatestPooledVerdict,
  upsertPooledVerdict,
  type PooledVerdictRow,
} from "./pooled-verdict-store";
import { classifyStore } from "@/lib/persistence/store-classification";
import { log } from "@/lib/logger";

const NOW = new Date("2026-07-02T12:00:00.000Z");

function row(over: Partial<PooledVerdictRow> = {}): PooledVerdictRow {
  return {
    tenant_id: "tenant-a",
    plan_id: "plan1",
    plan_date: "2026-06-30",
    action_family: "meta",
    computed_at: NOW.toISOString(),
    n: 6,
    pooled_lift_pct: 9,
    standard_error: 2,
    z_score: 4.5,
    permutation_p: 0.03,
    verdict: "helped",
    calibrationVersion: null,
    sentence: "As a group: this batch of 6 changes is up about 9 percent vs comparison pages.",
    pages: ["/a", "/b", "/c", "/d", "/e", "/f"],
    ...over,
  };
}

beforeEach(() => {
  stored = [];
  readRef.throws = false;
});

describe("registration pins", () => {
  it("pooled-verdicts is a GLOBAL store (cron fan-out; rows carry tenant_id)", () => {
    expect(classifyStore("pooled-verdicts")).toBe("global");
  });

  it("pooled-verdicts is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"pooled-verdicts"');
  });
});

describe("round-trip", () => {
  it("writes a row and reads it back for the same tenant", async () => {
    await upsertPooledVerdict(row());
    const rows = await loadPooledVerdicts("tenant-a", NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.plan_id).toBe("plan1");
    const latest = await loadLatestPooledVerdict("tenant-a", NOW);
    expect(latest?.sentence).toContain("up about 9 percent");
  });

  it("upsert on the same (tenant, plan, lever) key overwrites, not duplicates", async () => {
    await upsertPooledVerdict(row({ pooled_lift_pct: 5 }));
    await upsertPooledVerdict(row({ pooled_lift_pct: 9 }));
    const rows = await loadPooledVerdicts("tenant-a", NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pooled_lift_pct).toBe(9);
  });

  it("a different lever under the same plan gets its own row", async () => {
    await upsertPooledVerdict(row({ action_family: "meta" }));
    await upsertPooledVerdict(row({ action_family: "title", sentence: "titles" }));
    const rows = await loadPooledVerdicts("tenant-a", NOW);
    expect(rows).toHaveLength(2);
  });

  it("other tenants are untouched", async () => {
    await upsertPooledVerdict(row({ tenant_id: "tenant-b" }));
    expect(await loadPooledVerdicts("tenant-a", NOW)).toHaveLength(0);
    expect(await loadPooledVerdicts("tenant-b", NOW)).toHaveLength(1);
  });

  it("a row older than the max age is honest staleness: reads as absent", async () => {
    await upsertPooledVerdict(row({ computed_at: "2026-04-01T00:00:00.000Z" }));
    expect(await loadPooledVerdicts("tenant-a", NOW)).toHaveLength(0);
    expect(await loadLatestPooledVerdict("tenant-a", NOW)).toBeNull();
  });

  it("unknown tenant reads as absent", async () => {
    await upsertPooledVerdict(row());
    expect(await loadLatestPooledVerdict("tenant-z", NOW)).toBeNull();
  });

  it("sorts newest computed first", async () => {
    await upsertPooledVerdict(row({ plan_id: "planA", computed_at: "2026-06-01T00:00:00.000Z" }));
    await upsertPooledVerdict(row({ plan_id: "planB", computed_at: "2026-07-01T00:00:00.000Z" }));
    const rows = await loadPooledVerdicts("tenant-a", NOW);
    expect(rows[0]!.plan_id).toBe("planB");
  });

  it("round-trips a null calibrationVersion (the fail-closed quarantine stamp every row carries today)", async () => {
    await upsertPooledVerdict(row({ calibrationVersion: null }));
    const rows = await loadPooledVerdicts("tenant-a", NOW);
    expect(rows[0]!.calibrationVersion).toBeNull();
  });

  it("preserves a stamped calibrationVersion on round-trip (the future certified-classifier path)", async () => {
    await upsertPooledVerdict(row({ calibrationVersion: "pooled-classifier-v1" }));
    const rows = await loadPooledVerdicts("tenant-a", NOW);
    expect(rows[0]!.calibrationVersion).toBe("pooled-classifier-v1");
  });

  it("a read failure returns [] AND logs (never a silent empty pool)", async () => {
    readRef.throws = true;
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const rows = await loadPooledVerdicts("tenant-a", NOW);
    expect(rows).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("pooled-verdict-store");
    warn.mockRestore();
  });
});
