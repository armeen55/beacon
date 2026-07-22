/**
 * SOURCES — Wix client boundaries (Core 100K lane S merge).
 *
 * Merged from tests/lib/connectors/wix/{client-backoff, query-all-pagination,
 * list-collections, update-preserves-url-fields}.
 *
 * Pinned boundaries:
 *   • Rate-limit safety: 429 backoff with Retry-After, bounded give-up,
 *     no retry on client errors (ban avoidance).
 *   • Full-collection pagination past the 1000-item cap (no silent truncation),
 *     MAX_PAGES ceiling, partial-beats-zero on later-page failure.
 *   • Collection discovery narrows loose JSON defensively, read-only GET,
 *     fail-soft (no_key / api_error).
 *   • wixUpdateDataItem preserves slug + generated link fields (koobideh-404
 *     regression) and REFUSES protected URL fields outside urlRepair.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  wixQueryDataItems,
  wixQueryAllDataItems,
  wixListDataCollections,
  wixUpdateDataItem,
  isProtectedUrlField,
  WIX_QUERY_PAGE_SIZE,
  WIX_QUERY_MAX_PAGES,
} from "@/lib/connectors/wix/client";

const token = { api_key: "k", site_id: "s" };

// ─────────────────────────────────────────────────────────────────────
// Rate-limit backoff
// ─────────────────────────────────────────────────────────────────────

type FakeRes = { ok: boolean; status: number; retryAfter?: string; body?: unknown };

function res(r: FakeRes): Response {
  return {
    ok: r.ok,
    status: r.status,
    headers: { get: (k: string) => (k.toLowerCase() === "retry-after" ? r.retryAfter ?? null : null) },
    text: async () => "rate limited",
    json: async () => r.body ?? { dataItems: [] },
  } as unknown as Response;
}

function fetchSeq(sequence: FakeRes[]) {
  let i = 0;
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const next = sequence[Math.min(i, sequence.length - 1)]!;
    i++;
    return res(next);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

describe("wix rate-limit backoff", () => {
  it("retries through 429s (exponential) and succeeds when the limit clears", async () => {
    const slept: number[] = [];
    const { fetchImpl, calls } = fetchSeq([
      { ok: false, status: 429 },
      { ok: false, status: 429 },
      { ok: true, status: 200, body: { dataItems: [{ id: "i1", data: { x: 1 } }] } },
    ]);
    const r = await wixQueryDataItems(
      { dataCollectionId: "Col" },
      { token, fetchImpl, sleepImpl: async (ms) => { slept.push(ms); } },
    );
    expect(r.ok).toBe(true);
    expect(calls()).toHaveLength(3);
    expect(slept).toEqual([1000, 2000]);
  });

  it("honors a Retry-After header for the backoff delay", async () => {
    const slept: number[] = [];
    const { fetchImpl } = fetchSeq([
      { ok: false, status: 429, retryAfter: "5" },
      { ok: true, status: 200, body: { dataItems: [] } },
    ]);
    const r = await wixQueryDataItems(
      { dataCollectionId: "Col" },
      { token, fetchImpl, sleepImpl: async (ms) => { slept.push(ms); } },
    );
    expect(r.ok).toBe(true);
    expect(slept).toEqual([5000]);
  });

  it("gives up after the bounded retry budget; never retries a 400", async () => {
    const slept: number[] = [];
    const always429 = fetchSeq([{ ok: false, status: 429 }]);
    const r = await wixQueryDataItems(
      { dataCollectionId: "Col" },
      { token, fetchImpl: always429.fetchImpl, sleepImpl: async (ms) => { slept.push(ms); } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain("http_429");
    expect(always429.calls()).toHaveLength(4); // initial + 3 retries, bounded

    const bad = fetchSeq([{ ok: false, status: 400 }]);
    const r2 = await wixQueryDataItems(
      { dataCollectionId: "Col" },
      { token, fetchImpl: bad.fetchImpl, sleepImpl: async () => {} },
    );
    expect(r2.ok).toBe(false);
    expect(bad.calls()).toHaveLength(1); // no retry on a client error
  });
});

// ─────────────────────────────────────────────────────────────────────
// Full-collection pagination
// ─────────────────────────────────────────────────────────────────────

function pageOf(n: number) {
  return { dataItems: Array.from({ length: n }, (_, i) => ({ id: `i${i}`, data: {} })) };
}

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

  it("MAX_PAGES ceiling → stops, returns partial, does not loop forever", async () => {
    const { fetchImpl, calls } = pagedFetch([{ ok: true, body: pageOf(WIX_QUERY_PAGE_SIZE) }]);
    const r = await wixQueryAllDataItems({ dataCollectionId: "Huge" }, { token, fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(WIX_QUERY_MAX_PAGES * WIX_QUERY_PAGE_SIZE);
    expect(calls()).toBe(WIX_QUERY_MAX_PAGES);
  });

  it("first-page error surfaces the error; later-page error returns partial (partial beats zero)", async () => {
    const first = pagedFetch([{ ok: false, status: 500 }]);
    const r1 = await wixQueryAllDataItems({ dataCollectionId: "X" }, { token, fetchImpl: first.fetchImpl });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe("api_error");

    const later = pagedFetch([
      { ok: true, body: pageOf(WIX_QUERY_PAGE_SIZE) },
      { ok: false, status: 500 },
    ]);
    const r2 = await wixQueryAllDataItems({ dataCollectionId: "Y" }, { token, fetchImpl: later.fetchImpl });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value).toHaveLength(WIX_QUERY_PAGE_SIZE);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Collection discovery (read-only)
// ─────────────────────────────────────────────────────────────────────

function discoveryRes(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: () => null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response;
}

describe("wixListDataCollections", () => {
  it("GETs the v2 collections endpoint and narrows fields (type ?? fieldType ?? UNKNOWN)", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchImpl = (async (url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method });
      return discoveryRes({
        collections: [
          {
            id: "Recipes",
            displayName: "Persian Recipes",
            fields: [
              { key: "title", displayName: "Title", type: "TEXT" },
              { key: "slug", displayName: "Slug", fieldType: "URL" },
              { key: "count", displayName: "Count" },
            ],
          },
        ],
      });
    }) as unknown as typeof fetch;
    const r = await wixListDataCollections({ token, fetchImpl });
    expect(calls[0]!.url).toContain("/wix-data/v2/collections");
    expect(calls[0]!.method).toBe("GET");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value[0]!.fields).toEqual([
      { key: "title", displayName: "Title", type: "TEXT" },
      { key: "slug", displayName: "Slug", type: "URL" },
      { key: "count", displayName: "Count", type: "UNKNOWN" },
    ]);
  });

  it("skips malformed collections + fields without throwing", async () => {
    const fetchImpl = (async () =>
      discoveryRes({
        collections: [
          null,
          42,
          { id: 123 },
          { id: "", fields: [] },
          { id: "Good", fields: [null, { displayName: "no key" }, { key: 7 }, { key: "ok", type: "TEXT" }] },
        ],
      })) as unknown as typeof fetch;
    const r = await wixListDataCollections({ token, fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(1);
    expect(r.value[0]!.fields).toEqual([{ key: "ok", displayName: "ok", type: "TEXT" }]);
  });

  it("fails soft: no_key when not connected, api_error verbatim on 500", async () => {
    const noKey = await wixListDataCollections({ token: null });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.reason).toBe("no_key");

    const fetchImpl = (async () => discoveryRes("boom", false, 500)) as unknown as typeof fetch;
    const err = await wixListDataCollections({ token, fetchImpl });
    expect(err.ok).toBe(false);
    if (!err.ok) {
      expect(err.reason).toBe("api_error");
      expect(err.detail).toContain("http_500");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// wixUpdateDataItem — koobideh-404 regression (URL-field preservation)
// ─────────────────────────────────────────────────────────────────────

const UPDATE_TOKEN = { api_key: "k", site_id: "s", disconnected_at: undefined };

function updateFetch(currentData: Record<string, unknown>) {
  const calls: Array<{ url: string; init: { method?: string; body?: string } }> = [];
  const ok = (obj: unknown) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  });
  const fetchImpl = (async (url: string, init: { method?: string; body?: string }) => {
    calls.push({ url, init });
    if ((init?.method ?? "GET") === "GET") {
      return ok({ dataItem: { id: "item-1", data: currentData } });
    }
    const body = JSON.parse(init.body ?? "{}");
    return ok({ dataItem: { id: "item-1", data: body.dataItem.data } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("wixUpdateDataItem — preserves URL/slug/link fields", () => {
  it("changes ONLY the target field; slug + generated link travel through UNCHANGED", async () => {
    const { fetchImpl, calls } = updateFetch({
      _id: "item-1",
      title: "Koobideh Kabob Recipe",
      slug: "koobideh-kabob",
      "link-persian-kabobs-title": "/persian-kabobs/koobideh-kabob",
      seoDescription: "",
      shortDescription: "real recipe content",
    });
    const r = await wixUpdateDataItem(
      { dataCollectionId: "PersianKabobs", dataItemId: "item-1", field: "seoDescription", value: "NEW META" },
      { token: UPDATE_TOKEN, fetchImpl },
    );
    expect(r.ok).toBe(true);
    expect(calls[0]!.init.method ?? "GET").toBe("GET"); // fetch-before-write
    expect(calls[1]!.init.method).toBe("PUT");
    const putData = JSON.parse(calls[1]!.init.body ?? "{}").dataItem.data;
    expect(putData.slug).toBe("koobideh-kabob");
    expect(putData["link-persian-kabobs-title"]).toBe("/persian-kabobs/koobideh-kabob");
    expect(putData.seoDescription).toBe("NEW META");
  });

  it("REFUSES a slug/url/link TARGET field (never fetches or writes) unless urlRepair", async () => {
    const { fetchImpl, calls } = updateFetch({ slug: "x" });
    const blocked = await wixUpdateDataItem(
      { dataCollectionId: "C", dataItemId: "i", field: "slug", value: "new-slug" },
      { token: UPDATE_TOKEN, fetchImpl },
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("protected_field");
    expect(calls).toHaveLength(0);
  });

  it("ALLOWS a slug write under explicit urlRepair (the restore path), preserving other fields", async () => {
    const { fetchImpl, calls } = updateFetch({ slug: "", title: "t", seoDescription: "keep" });
    const repair = await wixUpdateDataItem(
      { dataCollectionId: "C", dataItemId: "i", field: "slug", value: "koobideh-kabob", urlRepair: true },
      { token: UPDATE_TOKEN, fetchImpl },
    );
    expect(repair.ok).toBe(true);
    const putData = JSON.parse(calls[1]!.init.body ?? "{}").dataItem.data;
    expect(putData.slug).toBe("koobideh-kabob");
    expect(putData.title).toBe("t");
  });

  it("isProtectedUrlField flags slug/url/link variants, not content fields", () => {
    for (const k of ["slug", "customSlug", "url", "pageUrl", "link", "link-persian-kabobs-title", "_id"]) {
      expect(isProtectedUrlField(k), k).toBe(true);
    }
    for (const k of ["seoDescription", "title", "h1Text", "shortDescription", "description"]) {
      expect(isProtectedUrlField(k), k).toBe(false);
    }
  });
});
