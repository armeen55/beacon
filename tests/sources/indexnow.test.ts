/**
 * SOURCES — IndexNow connector boundaries (Core 100K lane S merge).
 *
 * Merged from tests/lib/connectors/indexnow/{client, config-store,
 * receipts-store}. The verify-live wiring point lives in
 * tests/sources/connector-refresh.test.ts (it mocks these modules).
 *
 * Pinned boundaries: exact protocol payload, 200/202 success, one bounded
 * retry, never throws; config self-hides when unset and refuses blank keys;
 * receipts are bounded, newest-first, and fail-soft.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mem = vi.hoisted(() => ({
  rows: null as unknown[] | null,
  failReads: false,
  failWrites: false,
}));

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(async () => {
    if (mem.failReads) throw new Error("boom");
    return mem.rows ?? [];
  }),
  writeStore: vi.fn(async (_name: string, data: unknown[]) => {
    if (mem.failWrites) throw new Error("boom");
    mem.rows = data;
  }),
}));

import { pingIndexNow, pingIndexNowForUrl } from "@/lib/connectors/indexnow/client";
import { getIndexNowConfig, saveIndexNowConfig } from "@/lib/connectors/indexnow/config-store";
import {
  appendIndexNowReceipt,
  getIndexNowReceipts,
  type IndexNowReceipt,
} from "@/lib/connectors/indexnow/receipts-store";

beforeEach(() => {
  mem.rows = null;
  mem.failReads = false;
  mem.failWrites = false;
});

function fetchReturning(...responses: Array<{ ok: boolean; status: number }>) {
  let call = 0;
  const mockFn = vi.fn(async (_url: unknown, _init?: unknown) => {
    const r = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return { ok: r.ok, status: r.status } as Response;
  });
  return mockFn as unknown as typeof fetch & typeof mockFn;
}

describe("pingIndexNow", () => {
  it("POSTs the exact protocol payload shape; 200 and 202 both count as success", async () => {
    const fetchImpl = fetchReturning({ ok: true, status: 200 });
    const r = await pingIndexNow(
      { host: "example.com", key: "abc12345", urlList: ["https://example.com/a"] },
      fetchImpl,
    );
    expect(r).toEqual({ ok: true, status: 200 });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.indexnow.org/indexnow");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      host: "example.com",
      key: "abc12345",
      urlList: ["https://example.com/a"],
    });

    const r202 = await pingIndexNow(
      { host: "example.com", key: "abc12345", urlList: ["https://example.com/a"] },
      fetchReturning({ ok: true, status: 202 }),
    );
    expect(r202).toEqual({ ok: true, status: 202 });
  });

  it("retries exactly once on failure (succeeding retry wins), then reports failure without throwing", async () => {
    const failTwice = fetchReturning({ ok: false, status: 500 }, { ok: false, status: 500 });
    const failed = await pingIndexNow(
      { host: "example.com", key: "abc12345", urlList: ["https://example.com/a"] },
      failTwice,
    );
    expect(failTwice).toHaveBeenCalledTimes(2);
    expect(failed.ok).toBe(false);

    const recovers = fetchReturning({ ok: false, status: 503 }, { ok: true, status: 200 });
    const ok = await pingIndexNow(
      { host: "example.com", key: "abc12345", urlList: ["https://example.com/a"] },
      recovers,
    );
    expect(ok).toEqual({ ok: true, status: 200 });
  });

  it("never throws on a network error (fail-soft)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const result = await pingIndexNow(
      { host: "example.com", key: "abc12345", urlList: ["https://example.com/a"] },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBeNull();
  });

  it("pingIndexNowForUrl derives host from the URL and fails soft on an invalid URL", async () => {
    const fetchImpl = fetchReturning({ ok: true, status: 200 });
    const result = await pingIndexNowForUrl(
      { url: "https://sub.example.com/page-a", key: "abc12345" },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init?.body)).host).toBe("sub.example.com");

    const untouched = vi.fn() as unknown as typeof fetch;
    const bad = await pingIndexNowForUrl({ url: "not-a-url", key: "abc12345" }, untouched);
    expect(bad.ok).toBe(false);
    expect(untouched).not.toHaveBeenCalled();
  });
});

describe("IndexNow config store", () => {
  it("returns null when unset, on read error, and for a blank stored key (lane self-hides)", async () => {
    expect(await getIndexNowConfig()).toBeNull();
    mem.rows = [{ key: "   ", connected_at: "2026-07-02T00:00:00Z" }];
    expect(await getIndexNowConfig()).toBeNull();
    mem.failReads = true;
    expect(await getIndexNowConfig()).toBeNull();
  });

  it("round-trips the full config and throws on a blank key at save time", async () => {
    await saveIndexNowConfig({
      key: "abc12345",
      host: "example.com",
      keyLocation: "https://example.com/custom/abc12345.txt",
      connected_at: "2026-07-02T00:00:00Z",
    });
    const config = await getIndexNowConfig();
    expect(config?.key).toBe("abc12345");
    expect(config?.host).toBe("example.com");

    await expect(
      saveIndexNowConfig({ key: "   ", connected_at: "2026-07-02T00:00:00Z" }),
    ).rejects.toThrow();
  });
});

describe("IndexNow receipts store", () => {
  function receipt(partial: Partial<IndexNowReceipt> = {}): IndexNowReceipt {
    return {
      id: "indexnow-1",
      url: "https://example.com/a",
      pingedAt: "2026-07-02T00:00:00Z",
      ok: true,
      status: 200,
      detail: "accepted",
      ...partial,
    };
  }

  it("prepends newest-first and stays bounded", async () => {
    for (let i = 0; i < 120; i += 1) {
      await appendIndexNowReceipt(receipt({ id: `r${i}` }));
    }
    const rows = await getIndexNowReceipts();
    expect(rows.length).toBeLessThanOrEqual(100);
    expect(rows[0]!.id).toBe("r119");
  });

  it("fails soft: read errors return empty, write errors never throw", async () => {
    mem.failWrites = true;
    await expect(appendIndexNowReceipt(receipt())).resolves.toBeUndefined();
    mem.failWrites = false;
    mem.failReads = true;
    expect(await getIndexNowReceipts()).toEqual([]);
  });
});
