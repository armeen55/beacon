/**
 * IndexNow per-tenant config store (BEACON_500 item 75, 2026-07-02).
 *
 * Pins: no key configured -> null (lane self-hides), round-trip save/read,
 * a blank/whitespace key is rejected, and a read error fails soft to null
 * rather than throwing into a render path.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mem = vi.hoisted(() => ({
  rows: null as unknown[] | null,
  failReads: false,
}));

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(async () => {
    if (mem.failReads) throw new Error("boom");
    return mem.rows ?? [];
  }),
  writeStore: vi.fn(async (_name: string, data: unknown[]) => {
    mem.rows = data;
  }),
}));

import { getIndexNowConfig, saveIndexNowConfig } from "@/lib/connectors/indexnow/config-store";

beforeEach(() => {
  mem.rows = null;
  mem.failReads = false;
});

describe("getIndexNowConfig", () => {
  it("returns null when nothing has been configured (lane self-hides)", async () => {
    expect(await getIndexNowConfig()).toBeNull();
  });

  it("fails soft to null on a read error", async () => {
    mem.failReads = true;
    expect(await getIndexNowConfig()).toBeNull();
  });

  it("returns null for a stored row with an empty key", async () => {
    mem.rows = [{ key: "   ", connected_at: "2026-07-02T00:00:00Z" }];
    expect(await getIndexNowConfig()).toBeNull();
  });
});

describe("saveIndexNowConfig / getIndexNowConfig round trip", () => {
  it("persists and reads back the full config", async () => {
    await saveIndexNowConfig({
      key: "abc12345",
      host: "example.com",
      keyLocation: "https://example.com/custom/abc12345.txt",
      bingWebmasterApiKey: "bing-key-1",
      connected_at: "2026-07-02T00:00:00Z",
    });
    const config = await getIndexNowConfig();
    expect(config).toEqual({
      key: "abc12345",
      host: "example.com",
      keyLocation: "https://example.com/custom/abc12345.txt",
      bingWebmasterApiKey: "bing-key-1",
      connected_at: "2026-07-02T00:00:00Z",
    });
  });

  it("omits optional fields when absent (no undefined leaking into stored shape)", async () => {
    await saveIndexNowConfig({ key: "abc12345", connected_at: "2026-07-02T00:00:00Z" });
    const config = await getIndexNowConfig();
    expect(config?.host).toBeUndefined();
    expect(config?.keyLocation).toBeUndefined();
    expect(config?.bingWebmasterApiKey).toBeUndefined();
  });

  it("throws on save when the key is blank (never persists an unusable config)", async () => {
    await expect(
      saveIndexNowConfig({ key: "   ", connected_at: "2026-07-02T00:00:00Z" }),
    ).rejects.toThrow();
  });
});
