/**
 * 2026-06-16 — Wix read-only collection discovery (§Phase 2 mapper).
 *
 * Pins wixListDataCollections: a GET to /wix-data/v2/collections, defensive
 * narrowing of Wix's loose JSON (string id/key required; type ?? fieldType ??
 * "UNKNOWN"; malformed rows skipped, never thrown), and the not-connected /
 * api-error fail-soft paths. NO Wix writes anywhere in this path.
 */

import { describe, it, expect } from "vitest";

import { wixListDataCollections } from "@/lib/connectors/wix/client";

function res(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: () => null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response;
}

function capturingFetch(body: unknown) {
  const calls: Array<{ url: string; method?: string }> = [];
  const fetchImpl = (async (url: string, init?: { method?: string }) => {
    calls.push({ url, method: init?.method });
    return res(body);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const token = { api_key: "k", site_id: "s" };

describe("wixListDataCollections", () => {
  it("GETs the v2 collections endpoint (read-only)", async () => {
    const { fetchImpl, calls } = capturingFetch({ collections: [] });
    const r = await wixListDataCollections({ token, fetchImpl });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/wix-data/v2/collections");
    expect(calls[0]!.method).toBe("GET");
  });

  it("narrows collections + fields, reading type ?? fieldType ?? UNKNOWN", () => {
    const { fetchImpl } = capturingFetch({
      collections: [
        {
          id: "Recipes",
          displayName: "Persian Recipes",
          fields: [
            { key: "title", displayName: "Title", type: "TEXT" },
            { key: "slug", displayName: "Slug", fieldType: "URL" }, // fieldType fallback
            { key: "count", displayName: "Count" }, // → UNKNOWN
          ],
        },
      ],
    });
    return wixListDataCollections({ token, fetchImpl }).then((r) => {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value).toHaveLength(1);
      const c = r.value[0]!;
      expect(c.id).toBe("Recipes");
      expect(c.displayName).toBe("Persian Recipes");
      expect(c.fields).toEqual([
        { key: "title", displayName: "Title", type: "TEXT" },
        { key: "slug", displayName: "Slug", type: "URL" },
        { key: "count", displayName: "Count", type: "UNKNOWN" },
      ]);
    });
  });

  it("falls displayName back to id, and field displayName back to key", async () => {
    const { fetchImpl } = capturingFetch({
      collections: [{ id: "Bare", fields: [{ key: "x", type: "TEXT" }] }],
    });
    const r = await wixListDataCollections({ token, fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value[0]!.displayName).toBe("Bare");
    expect(r.value[0]!.fields[0]).toEqual({ key: "x", displayName: "x", type: "TEXT" });
  });

  it("skips malformed collections + fields without throwing", async () => {
    const { fetchImpl } = capturingFetch({
      collections: [
        null,
        42,
        { id: 123 }, // non-string id → skipped
        { id: "", fields: [] }, // empty id → skipped
        {
          id: "Good",
          fields: [
            null,
            { displayName: "no key" }, // missing key → skipped
            { key: 7 }, // non-string key → skipped
            { key: "ok", type: "TEXT" },
            "garbage",
          ],
        },
      ],
    });
    const r = await wixListDataCollections({ token, fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(1);
    expect(r.value[0]!.id).toBe("Good");
    expect(r.value[0]!.fields).toEqual([{ key: "ok", displayName: "ok", type: "TEXT" }]);
  });

  it("tolerates a missing collections array (returns empty)", async () => {
    const { fetchImpl } = capturingFetch({});
    const r = await wixListDataCollections({ token, fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });

  it("fails soft when not connected (no_key)", async () => {
    const r = await wixListDataCollections({ token: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_key");
  });

  it("surfaces an API error verbatim (never throws)", async () => {
    const fetchImpl = (async () => res("boom", false, 500)) as unknown as typeof fetch;
    const r = await wixListDataCollections({ token, fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("api_error");
      expect(r.detail).toContain("http_500");
    }
  });
});
