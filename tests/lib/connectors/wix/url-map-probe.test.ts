/**
 * 2026-06-11 (night shift, #73) — url-map sync verifies derived URLs.
 * Pins: sampled probe (first/mid/last per collection), warn-only
 * semantics (ok stays true; failures listed), and entries persisting
 * regardless of probe outcome.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const _stores = new Map<string, unknown[]>();
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => _stores.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    _stores.set(name, data);
  },
}));

let _items: Array<{ id: string; dataCollectionId: string; data: Record<string, unknown> }> = [];
vi.mock("@/lib/connectors/wix/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/wix/client")>();
  return {
    ...actual,
    // syncWixUrlMap reads a full collection via wixQueryAllDataItems (paged);
    // stub it to the fixture so the probe path is what's under test here.
    wixQueryAllDataItems: async () => ({ ok: true, value: _items }),
  };
});

import { syncWixUrlMap } from "@/lib/connectors/wix/url-map";

beforeEach(() => {
  _stores.clear();
  _stores.set("wix-collection-config", [
    { dataCollectionId: "Foods", slugField: "slug", urlPrefix: "/persian-food", labelField: null },
  ]);
  _items = Array.from({ length: 5 }, (_, i) => ({
    id: `item-${i}`,
    dataCollectionId: "Foods",
    data: { slug: `dish-${i}` },
  }));
});

describe("syncWixUrlMap — sampled URL verification (#73)", () => {
  it("probes up to 3 deterministic samples per collection and reports ok counts", async () => {
    const probed: string[] = [];
    const r = await syncWixUrlMap(
      { siteBaseUrl: "https://www.iranopedia.com" },
      {
        fetchImpl: (async (url: RequestInfo | URL) => {
          probed.push(String(url));
          return new Response("ok", { status: 200 });
        }) as typeof fetch,
      },
    );
    expect(r.ok).toBe(true);
    expect(r.itemsMapped).toBe(5);
    expect(r.probe.checked).toBe(3); // first / middle / last
    expect(r.probe.ok).toBe(3);
    expect(r.probe.failures).toEqual([]);
    // The map stores CANONICALIZED urls (www-stripped) — the probe hits
    // exactly what pushes will match on.
    expect(probed.every((u) => u.includes("iranopedia.com/persian-food/dish-"))).toBe(true);
  });

  it("a 404 sample lands in failures but the sync stays usable (warn-only)", async () => {
    const r = await syncWixUrlMap(
      { siteBaseUrl: "https://www.iranopedia.com" },
      {
        fetchImpl: (async () => new Response("nope", { status: 404 })) as typeof fetch,
      },
    );
    expect(r.ok).toBe(true); // entries still written
    expect(r.probe.checked).toBe(3);
    expect(r.probe.ok).toBe(0);
    expect(r.probe.failures[0]).toContain("HTTP 404");
    expect((_stores.get("wix-url-map") ?? []).length).toBe(5);
  });

  it("network errors during probing are failures, never throws", async () => {
    const r = await syncWixUrlMap(
      { siteBaseUrl: "https://www.iranopedia.com" },
      {
        fetchImpl: (async () => {
          throw new Error("ECONNRESET");
        }) as typeof fetch,
      },
    );
    expect(r.ok).toBe(true);
    expect(r.probe.failures.some((f) => f.includes("ECONNRESET"))).toBe(true);
  });
});
