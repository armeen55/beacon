/**
 * 2026-06-16 — Wix full-collection pagination (audit P0 #5-class: silent
 * truncation). `wixQueryAllDataItems` must page past the 1000-item Wix cap
 * until a short page, so a content site's pages beyond row 1000 are NOT
 * silently dropped from the URL map (→ unmatchable / unpushable).
 */

import { describe, it, expect } from "vitest";

import {
  wixQueryAllDataItems,
  WIX_QUERY_PAGE_SIZE,
  WIX_QUERY_MAX_PAGES,
} from "@/lib/connectors/wix/client";

const token = { api_key: "k", site_id: "s" };

function pageOf(n: number): { dataItems: Array<{ id: string; data: Record<string, unknown> }> } {
  return { dataItems: Array.from({ length: n }, (_, i) => ({ id: `i${i}`, data: {} })) };
}

/** fetch mock that serves a fixed sequence of pages + records each request's
 *  paging.offset so we can assert the loop advanced correctly. */
function pagedFetch(pages: Array<{ ok: boolean; status?: number; body?: unknown }>) {
  let i = 0;
  const offsets: number[] = [];
  const fetchImpl = (async (_url: string, opts: { body?: string }) => {
    try {
      const parsed = JSON.parse(opts?.body ?? "{}");
      offsets.push(parsed?.query?.paging?.offset ?? -1);
    } catch {
      offsets.push(-2);
    }
    const p = pages[Math.min(i, pages.length - 1)]!;
    i++;
    return {
      ok: p.ok,
      status: p.status ?? (p.ok ? 200 : 500),
      headers: { get: () => null },
      text: async () => "err",
      json: async () => p.body ?? { dataItems: [] },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, offsets: () => offsets, calls: () => i };
}

describe("wixQueryAllDataItems — pagination past the 1000-item cap", () => {
  it("single short page → one fetch, all items", async () => {
    const { fetchImpl, calls } = pagedFetch([{ ok: true, body: pageOf(42) }]);
    const r = await wixQueryAllDataItems({ dataCollectionId: "Recipes" }, { token, fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(42);
    expect(calls()).toBe(1);
  });

  it("multi-page collection (2500) → 3 pages concatenated with advancing offsets", async () => {
    const { fetchImpl, offsets, calls } = pagedFetch([
      { ok: true, body: pageOf(WIX_QUERY_PAGE_SIZE) },
      { ok: true, body: pageOf(WIX_QUERY_PAGE_SIZE) },
      { ok: true, body: pageOf(500) },
    ]);
    const r = await wixQueryAllDataItems({ dataCollectionId: "Names" }, { token, fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(2500);
    expect(calls()).toBe(3);
    expect(offsets()).toEqual([0, WIX_QUERY_PAGE_SIZE, 2 * WIX_QUERY_PAGE_SIZE]);
  });

  it("exact multiple (2000) → stops after the trailing short/empty page", async () => {
    const { fetchImpl, calls } = pagedFetch([
      { ok: true, body: pageOf(WIX_QUERY_PAGE_SIZE) },
      { ok: true, body: pageOf(WIX_QUERY_PAGE_SIZE) },
      { ok: true, body: pageOf(0) },
    ]);
    const r = await wixQueryAllDataItems({ dataCollectionId: "Cities" }, { token, fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(2000);
    expect(calls()).toBe(3);
  });

  it("MAX_PAGES ceiling → stops, returns partial, does not loop forever", async () => {
    // Always-full pages would loop forever without the cap.
    const { fetchImpl, calls } = pagedFetch([{ ok: true, body: pageOf(WIX_QUERY_PAGE_SIZE) }]);
    const r = await wixQueryAllDataItems({ dataCollectionId: "Huge" }, { token, fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(WIX_QUERY_MAX_PAGES * WIX_QUERY_PAGE_SIZE);
    expect(calls()).toBe(WIX_QUERY_MAX_PAGES);
  });

  it("first-page error → surfaces the error (caller's !ok handling unchanged)", async () => {
    const { fetchImpl, calls } = pagedFetch([{ ok: false, status: 500 }]);
    const r = await wixQueryAllDataItems({ dataCollectionId: "X" }, { token, fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("api_error");
    expect(calls()).toBe(1);
  });

  it("later-page error → returns the partial rows already gathered (partial beats zero)", async () => {
    const { fetchImpl, calls } = pagedFetch([
      { ok: true, body: pageOf(WIX_QUERY_PAGE_SIZE) },
      { ok: false, status: 500 },
    ]);
    const r = await wixQueryAllDataItems({ dataCollectionId: "Y" }, { token, fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(WIX_QUERY_PAGE_SIZE);
    expect(calls()).toBe(2);
  });
});
