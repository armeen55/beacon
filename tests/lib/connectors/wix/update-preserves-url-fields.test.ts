/**
 * 2026-06-13 — REGRESSION: Wix item update must preserve slug + generated link.
 *
 * The prior wixUpdateDataItem stripped slug/link from the payload then did a
 * full-item PUT (replace) — so the omitted slug was CLEARED, blanking
 * koobideh-kabob's slug and 404-ing the live URL. The fix: fetch the current
 * item immediately before the write and change ONLY the approved field,
 * carrying slug + the generated `link-*` PAGE_LINK through unchanged. Never
 * send stripped/partial data with a full PUT.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { wixUpdateDataItem, isProtectedUrlField } from "@/lib/connectors/wix/client";

const TOKEN = { api_key: "k", site_id: "s", disconnected_at: undefined };

function mockFetch(currentData: Record<string, unknown>) {
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

describe("wixUpdateDataItem — preserves URL/slug/link fields (koobideh-404 regression)", () => {
  it("changes ONLY the target field; slug + generated link travel through UNCHANGED", async () => {
    const current = {
      _id: "item-1",
      title: "Koobideh Kabob Recipe",
      slug: "koobideh-kabob",
      "link-persian-kabobs-title": "/persian-kabobs/koobideh-kabob",
      seoDescription: "",
      shortDescription: "real recipe content",
    };
    const { fetchImpl, calls } = mockFetch(current);
    const r = await wixUpdateDataItem(
      { dataCollectionId: "PersianKabobs", dataItemId: "item-1", field: "seoDescription", value: "NEW META" },
      { token: TOKEN, fetchImpl },
    );
    expect(r.ok).toBe(true);
    // Fetch-immediately-before-write: GET then PUT.
    expect(calls[0]!.init.method ?? "GET").toBe("GET");
    expect(calls[1]!.init.method).toBe("PUT");
    const putData = JSON.parse(calls[1]!.init.body ?? "{}").dataItem.data;
    expect(putData.slug).toBe("koobideh-kabob"); // PRESERVED (the bug cleared this)
    expect(putData["link-persian-kabobs-title"]).toBe("/persian-kabobs/koobideh-kabob"); // PRESERVED
    expect(putData.title).toBe("Koobideh Kabob Recipe"); // PRESERVED
    expect(putData.shortDescription).toBe("real recipe content"); // PRESERVED
    expect(putData.seoDescription).toBe("NEW META"); // only this changed
  });

  it("REFUSES a slug/url/link TARGET field (never fetches or writes) unless urlRepair", async () => {
    const { fetchImpl, calls } = mockFetch({ slug: "x" });
    const blocked = await wixUpdateDataItem(
      { dataCollectionId: "C", dataItemId: "i", field: "slug", value: "new-slug" },
      { token: TOKEN, fetchImpl },
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("protected_field");
    expect(calls).toHaveLength(0);
  });

  it("ALLOWS a slug write under explicit urlRepair (the restore path), preserving other fields", async () => {
    const { fetchImpl, calls } = mockFetch({ slug: "", title: "t", seoDescription: "keep" });
    const repair = await wixUpdateDataItem(
      { dataCollectionId: "C", dataItemId: "i", field: "slug", value: "koobideh-kabob", urlRepair: true },
      { token: TOKEN, fetchImpl },
    );
    expect(repair.ok).toBe(true);
    const putData = JSON.parse(calls[1]!.init.body ?? "{}").dataItem.data;
    expect(putData.slug).toBe("koobideh-kabob");
    expect(putData.title).toBe("t");
    expect(putData.seoDescription).toBe("keep");
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
