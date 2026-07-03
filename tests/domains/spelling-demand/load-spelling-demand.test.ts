/**
 * load-spelling-demand tests (P20, v1 129).
 *
 * Pins the server assembly: the byte-identical NO-OP when the tenant has no
 * configured spelling_variants, end-to-end consolidation from GSC signals, and
 * suppression when an owned page already captures the variants.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { BeaconTenant } from "@/domains/tenants/types";
import type { GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";

let _tenant: Partial<BeaconTenant> | null = null;
let _storeThrows = false;
vi.mock("@/domains/tenants/store", () => ({
  getTenant: async () => {
    if (_storeThrows) throw new Error("registry down");
    return _tenant;
  },
}));

import { loadSpellingDemandMoveItems } from "@/domains/spelling-demand/load-spelling-demand";

function pageSignal(page: string, queries: Array<[string, number]>): GscPageSignal {
  return {
    page,
    clicks90d: 0,
    impressions90d: queries.reduce((s, [, i]) => s + i, 0),
    ctr90d: 0,
    position90d: 10,
    topQueries: queries.map(([query, impressions]) => ({
      query,
      clicks: 0,
      impressions,
      ctr: 0,
      position: 10,
    })),
  };
}

beforeEach(() => {
  _tenant = null;
  _storeThrows = false;
});

describe("loadSpellingDemandMoveItems — no-op when unconfigured", () => {
  it("returns [] when the tenant has no spelling_variants (byte-identical no-op)", async () => {
    _tenant = { id: "tenant-plain" };
    const gsc = new Map([
      ["https://x.com/a", pageSignal("https://x.com/a", [["saffron", 600], ["safron", 500]])],
    ]);
    const items = await loadSpellingDemandMoveItems({ tenantId: "tenant-plain", gscSignals: gsc });
    expect(items).toEqual([]);
  });

  it("returns [] when spelling_variants is an empty array", async () => {
    _tenant = { id: "t", spelling_variants: [] };
    const gsc = new Map([
      ["https://x.com/a", pageSignal("https://x.com/a", [["saffron", 600], ["safron", 500]])],
    ]);
    expect(await loadSpellingDemandMoveItems({ tenantId: "t", gscSignals: gsc })).toEqual([]);
  });

  it("returns [] on any store failure (fail-soft)", async () => {
    _storeThrows = true;
    const gsc = new Map([
      ["https://x.com/a", pageSignal("https://x.com/a", [["saffron", 600]])],
    ]);
    expect(await loadSpellingDemandMoveItems({ tenantId: "t", gscSignals: gsc })).toEqual([]);
  });

  it("returns [] when no GSC demand exists at all", async () => {
    _tenant = { id: "t", spelling_variants: [{ canonical: "saffron", variants: ["safron"] }] };
    expect(
      await loadSpellingDemandMoveItems({ tenantId: "t", gscSignals: new Map() }),
    ).toEqual([]);
  });
});

describe("loadSpellingDemandMoveItems — end-to-end with config", () => {
  it("consolidates GSC demand across spellings and emits a Move item", async () => {
    _tenant = {
      id: "t",
      spelling_variants: [{ canonical: "saffron", variants: ["safron", "zafran"] }],
    };
    // Demand split across three different pages -> no single page owns 2+.
    const gsc = new Map([
      ["https://x.com/a", pageSignal("https://x.com/a", [["saffron", 620]])],
      ["https://x.com/b", pageSignal("https://x.com/b", [["safron", 480]])],
      ["https://x.com/c", pageSignal("https://x.com/c", [["zafran", 300]])],
    ]);
    const items = await loadSpellingDemandMoveItems({ tenantId: "t", gscSignals: gsc });
    expect(items).toHaveLength(1);
    expect(items[0]!.canonical).toBe("saffron");
    expect(items[0]!.combinedDemand).toBe(620 + 480 + 300);
    expect(items[0]!.spellingCount).toBe(3);
  });

  it("suppresses when one owned page already ranks for 2+ spellings", async () => {
    _tenant = {
      id: "t",
      spelling_variants: [{ canonical: "saffron", variants: ["safron"] }],
    };
    const gsc = new Map([
      ["https://x.com/spices", pageSignal("https://x.com/spices", [["saffron", 600], ["safron", 500]])],
    ]);
    const items = await loadSpellingDemandMoveItems({ tenantId: "t", gscSignals: gsc });
    expect(items).toEqual([]);
  });

  it("suppresses a group below the demand floor", async () => {
    _tenant = {
      id: "t",
      spelling_variants: [{ canonical: "saffron", variants: ["safron"] }],
    };
    const gsc = new Map([
      ["https://x.com/a", pageSignal("https://x.com/a", [["saffron", 30]])],
      ["https://x.com/b", pageSignal("https://x.com/b", [["safron", 20]])],
    ]);
    const items = await loadSpellingDemandMoveItems({ tenantId: "t", gscSignals: gsc });
    expect(items).toEqual([]);
  });
});
