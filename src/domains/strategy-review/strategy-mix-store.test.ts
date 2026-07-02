/**
 * strategy-mix-store (2026-07-02, master plan item 51).
 *
 * Round-trip on an in-memory json-store + idempotency (one review per tenant per week) +
 * the 12-week history cap + the registration pins that make the store real: GLOBAL
 * classification (fan-out, rows carry tenant_id) and the Supabase mirror entry (Vercel
 * durability).
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
  appendStrategyMixRecord,
  loadStrategyMixHistory,
  loadLatestStrategyMix,
  hasStrategyMixForWeek,
  MAX_HISTORY_WEEKS,
  type StrategyMixRecord,
} from "./strategy-mix-store";
import { classifyStore } from "@/lib/persistence/store-classification";

beforeEach(() => {
  stored = [];
});

function rec(over: Partial<StrategyMixRecord> = {}): StrategyMixRecord {
  return {
    tenant_id: "t",
    weekOf: "2026-07-06",
    leverMix: [{ family: "answer", weight: 1.4, reason: "won 3 of 4" }],
    focusFamilies: [{ family: "flags", reason: "9x its detection floor" }],
    memo: "I am leaning into answer blocks this week.",
    appliedAt: "2026-07-05T22:00:00.000Z",
    source: "llm",
    ...over,
  };
}

describe("registration pins", () => {
  it("strategy-mix-history is a GLOBAL store (fan-out; rows carry tenant_id)", () => {
    expect(classifyStore("strategy-mix-history")).toBe("global");
  });

  it("strategy-mix-history is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"strategy-mix-history"');
  });
});

describe("round-trip", () => {
  it("appends and reads back a record for the right tenant", async () => {
    const wrote = await appendStrategyMixRecord(rec());
    expect(wrote).toBe(true);
    const history = await loadStrategyMixHistory("t");
    expect(history).toHaveLength(1);
    expect(history[0]!.weekOf).toBe("2026-07-06");
  });

  it("scopes reads to the requesting tenant only", async () => {
    await appendStrategyMixRecord(rec({ tenant_id: "tenant-a" }));
    await appendStrategyMixRecord(rec({ tenant_id: "tenant-b" }));
    expect(await loadStrategyMixHistory("tenant-a")).toHaveLength(1);
    expect(await loadStrategyMixHistory("tenant-b")).toHaveLength(1);
  });

  it("loadLatestStrategyMix returns the newest weekOf", async () => {
    await appendStrategyMixRecord(rec({ weekOf: "2026-06-22" }));
    await appendStrategyMixRecord(rec({ weekOf: "2026-06-29" }));
    await appendStrategyMixRecord(rec({ weekOf: "2026-07-06" }));
    const latest = await loadLatestStrategyMix("t");
    expect(latest?.weekOf).toBe("2026-07-06");
  });

  it("loadLatestStrategyMix returns null when no record exists", async () => {
    expect(await loadLatestStrategyMix("nobody")).toBeNull();
  });

  it("idempotent: appending a second record for the same tenant+week is a no-op (never overwrites)", async () => {
    const first = rec({ memo: "first memo" });
    const second = rec({ memo: "second memo" });
    expect(await appendStrategyMixRecord(first)).toBe(true);
    expect(await appendStrategyMixRecord(second)).toBe(false);
    const history = await loadStrategyMixHistory("t");
    expect(history).toHaveLength(1);
    expect(history[0]!.memo).toBe("first memo"); // the FIRST write stands - never mutated
  });

  it("hasStrategyMixForWeek reflects the idempotency guard", async () => {
    expect(await hasStrategyMixForWeek("t", "2026-07-06")).toBe(false);
    await appendStrategyMixRecord(rec());
    expect(await hasStrategyMixForWeek("t", "2026-07-06")).toBe(true);
    expect(await hasStrategyMixForWeek("t", "2026-07-13")).toBe(false);
  });

  it("read is fail-soft: a throwing store reads as an empty list", async () => {
    const mod = await import("@/lib/persistence/json-store");
    const spy = vi.spyOn(mod, "readStore").mockRejectedValueOnce(new Error("disk gone"));
    expect(await loadStrategyMixHistory("t")).toEqual([]);
    spy.mockRestore();
  });

  it("write is fail-soft: a throwing store returns false, never throws", async () => {
    const mod = await import("@/lib/persistence/json-store");
    const spy = vi.spyOn(mod, "writeStore").mockRejectedValueOnce(new Error("disk gone"));
    await expect(appendStrategyMixRecord(rec())).resolves.toBe(false);
    spy.mockRestore();
  });
});

describe("12-week history cap", () => {
  it("keeps only the last MAX_HISTORY_WEEKS records per tenant, oldest dropped first", async () => {
    for (let i = 0; i < MAX_HISTORY_WEEKS + 3; i += 1) {
      const week = new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString().slice(0, 10);
      await appendStrategyMixRecord(rec({ weekOf: week }));
    }
    const history = await loadStrategyMixHistory("t");
    expect(history).toHaveLength(MAX_HISTORY_WEEKS);
    // Oldest 3 weeks were dropped - the earliest remaining week is the 4th one written.
    const expectedOldest = new Date(Date.UTC(2026, 0, 5 + 3 * 7)).toISOString().slice(0, 10);
    expect(history[0]!.weekOf).toBe(expectedOldest);
  });

  it("does not let one tenant's cap affect another tenant's history", async () => {
    for (let i = 0; i < MAX_HISTORY_WEEKS + 2; i += 1) {
      const week = new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString().slice(0, 10);
      await appendStrategyMixRecord(rec({ tenant_id: "busy-tenant", weekOf: week }));
    }
    await appendStrategyMixRecord(rec({ tenant_id: "quiet-tenant", weekOf: "2026-07-06" }));
    expect(await loadStrategyMixHistory("busy-tenant")).toHaveLength(MAX_HISTORY_WEEKS);
    expect(await loadStrategyMixHistory("quiet-tenant")).toHaveLength(1);
  });
});

describe("never mutates existing rows on append (additive-only ledger)", () => {
  it("keeps every prior record byte-identical after a new append", async () => {
    await appendStrategyMixRecord(rec({ weekOf: "2026-06-29", memo: "week one" }));
    const before = JSON.stringify((await loadStrategyMixHistory("t"))[0]);
    await appendStrategyMixRecord(rec({ weekOf: "2026-07-06", memo: "week two" }));
    const after = (await loadStrategyMixHistory("t")).find((r) => r.weekOf === "2026-06-29");
    expect(JSON.stringify(after)).toBe(before);
  });
});
