/**
 * page-factory/batch-store (BEACON 500 item 62).
 *
 * Round-trip on an in-memory json-store + weekly idempotency (one batch per
 * tenant per week) + per-item status update + the registration pins that make
 * the store real: GLOBAL classification (fan-out, rows carry tenant_id) and the
 * Supabase mirror entry (Vercel durability).
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
  createFactoryBatch,
  loadFactoryBatchHistory,
  loadLatestFactoryBatch,
  hasFactoryBatchForWeek,
  updateFactoryBatchItemStatus,
  MAX_BATCH_HISTORY_WEEKS,
  type FactoryBatchRecord,
} from "./batch-store";
import { classifyStore } from "@/lib/persistence/store-classification";

beforeEach(() => {
  stored = [];
});

function rec(over: Partial<FactoryBatchRecord> = {}): FactoryBatchRecord {
  return {
    tenant_id: "t",
    weekOf: "2026-07-06",
    items: [
      {
        slug: "nowruz-meaning",
        title: "Nowruz Meaning",
        entity: "nowruz",
        attribute: "meaning",
        matchedKeyword: "nowruz meaning",
        searchVolume: 400,
        demandSource: "cached_keyword",
        why: "I found real search demand for this: 400 searches a month.",
        status: "pending",
        targetUrl: null,
        costUsd: 0.04,
        updatedAt: "2026-07-05T22:00:00.000Z",
      },
    ],
    queuedForKeywordBatch: [],
    totalCostUsd: 0.04,
    generatedAt: "2026-07-05T22:00:00.000Z",
    ...over,
  };
}

describe("registration pins", () => {
  it("page-factory-batches is a GLOBAL store (fan-out; rows carry tenant_id)", () => {
    expect(classifyStore("page-factory-batches")).toBe("global");
  });

  it("page-factory-batches is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"page-factory-batches"');
  });
});

describe("round-trip", () => {
  it("creates and reads back a batch for the right tenant", async () => {
    const created = await createFactoryBatch(rec());
    expect(created).toBe(true);
    const history = await loadFactoryBatchHistory("t");
    expect(history).toHaveLength(1);
    expect(history[0]!.weekOf).toBe("2026-07-06");
  });

  it("scopes reads to the requesting tenant only", async () => {
    await createFactoryBatch(rec({ tenant_id: "tenant-a" }));
    await createFactoryBatch(rec({ tenant_id: "tenant-b", weekOf: "2026-07-06" }));
    expect(await loadFactoryBatchHistory("tenant-a")).toHaveLength(1);
    expect(await loadFactoryBatchHistory("tenant-b")).toHaveLength(1);
  });

  it("loadLatestFactoryBatch returns the most recent week", async () => {
    await createFactoryBatch(rec({ weekOf: "2026-06-22" }));
    await createFactoryBatch(rec({ weekOf: "2026-06-29" }));
    const latest = await loadLatestFactoryBatch("t");
    expect(latest?.weekOf).toBe("2026-06-29");
  });
});

describe("weekly idempotency", () => {
  it("hasFactoryBatchForWeek reflects an existing batch", async () => {
    expect(await hasFactoryBatchForWeek("t", "2026-07-06")).toBe(false);
    await createFactoryBatch(rec());
    expect(await hasFactoryBatchForWeek("t", "2026-07-06")).toBe(true);
  });

  it("refuses a second create for the same (tenant, weekOf) - never overwrites in-progress approvals", async () => {
    const first = await createFactoryBatch(rec());
    expect(first).toBe(true);
    const second = await createFactoryBatch(rec({ items: [] })); // would wipe the batch if it landed
    expect(second).toBe(false);
    const history = await loadFactoryBatchHistory("t");
    expect(history[0]!.items).toHaveLength(1); // untouched
  });

  it("allows a different tenant to create the same weekOf independently", async () => {
    await createFactoryBatch(rec({ tenant_id: "tenant-a" }));
    const created = await createFactoryBatch(rec({ tenant_id: "tenant-b" }));
    expect(created).toBe(true);
  });
});

describe("history cap", () => {
  it("trims a tenant's own history to MAX_BATCH_HISTORY_WEEKS, oldest dropped first", async () => {
    for (let i = 0; i < MAX_BATCH_HISTORY_WEEKS + 3; i++) {
      const week = `2026-01-${String(i + 1).padStart(2, "0")}`;
      await createFactoryBatch(rec({ weekOf: week }));
    }
    const history = await loadFactoryBatchHistory("t");
    expect(history).toHaveLength(MAX_BATCH_HISTORY_WEEKS);
    expect(history[0]!.weekOf).toBe("2026-01-04"); // first 3 dropped
  });

  it("never touches another tenant's rows while trimming", async () => {
    await createFactoryBatch(rec({ tenant_id: "other", weekOf: "2020-01-01" }));
    for (let i = 0; i < MAX_BATCH_HISTORY_WEEKS + 2; i++) {
      await createFactoryBatch(rec({ weekOf: `2026-02-${String(i + 1).padStart(2, "0")}` }));
    }
    const other = await loadFactoryBatchHistory("other");
    expect(other).toHaveLength(1);
  });
});

describe("updateFactoryBatchItemStatus", () => {
  it("updates one item's status without touching other items or other weeks", async () => {
    await createFactoryBatch(
      rec({
        items: [
          { ...rec().items[0]!, slug: "a" },
          { ...rec().items[0]!, slug: "b" },
        ],
      }),
    );
    const ok = await updateFactoryBatchItemStatus({ tenantId: "t", weekOf: "2026-07-06", slug: "a", status: "approved" });
    expect(ok).toBe(true);
    const history = await loadFactoryBatchHistory("t");
    const items = history[0]!.items;
    expect(items.find((i) => i.slug === "a")!.status).toBe("approved");
    expect(items.find((i) => i.slug === "b")!.status).toBe("pending");
  });

  it("can set a targetUrl alongside the status (approve records where it will publish)", async () => {
    await createFactoryBatch(rec());
    await updateFactoryBatchItemStatus({
      tenantId: "t",
      weekOf: "2026-07-06",
      slug: "nowruz-meaning",
      status: "approved",
      targetUrl: "https://example.com/nowruz-meaning",
    });
    const history = await loadFactoryBatchHistory("t");
    expect(history[0]!.items[0]!.targetUrl).toBe("https://example.com/nowruz-meaning");
  });

  it("returns false for an unknown tenant/week/slug, never throws", async () => {
    await createFactoryBatch(rec());
    expect(await updateFactoryBatchItemStatus({ tenantId: "t", weekOf: "2099-01-01", slug: "nowruz-meaning", status: "skipped" })).toBe(false);
    expect(await updateFactoryBatchItemStatus({ tenantId: "t", weekOf: "2026-07-06", slug: "no-such-slug", status: "skipped" })).toBe(false);
    expect(await updateFactoryBatchItemStatus({ tenantId: "no-such-tenant", weekOf: "2026-07-06", slug: "nowruz-meaning", status: "skipped" })).toBe(false);
  });
});
