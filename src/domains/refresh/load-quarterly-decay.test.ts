/**
 * load-quarterly-decay.test.ts (BEACON_500 item 56).
 *
 * Pins: (1) the pure quarter-boundary math (equal-length prior/current windows), (2) the RPC
 * read pages gsc_decay_v1 with .range() in 1000-row chunks exactly like the sibling
 * loadGscDecaySignalsForTenant, (3) fail-soft to [] on an RPC error or thrown exception.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/domains/proof-gsc/gsc-window", () => ({
  readLastFinalizedDate: vi.fn(async () => "2026-07-01"),
}));

type Row = Record<string, unknown>;
const rpcPages: Row[][] = [];
const rangeCalls: Array<{ from: number; to: number }> = [];
let rpcThrow: Error | null = null;

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    rpc: () => ({
      order: () => ({
        range: (from: number, to: number) => {
          rangeCalls.push({ from, to });
          if (rpcThrow) return Promise.resolve({ data: null, error: { message: rpcThrow.message } });
          const pageIndex = Math.floor(from / 1000);
          return Promise.resolve({ data: rpcPages[pageIndex] ?? [], error: null });
        },
      }),
    }),
  }),
}));

import { loadQuarterlyDecayForTenant, quarterlyWindowBounds } from "./load-quarterly-decay";

beforeEach(() => {
  rpcPages.length = 0;
  rangeCalls.length = 0;
  rpcThrow = null;
});

describe("quarterlyWindowBounds", () => {
  it("produces two equal-length windows (91 days each) ending at the anchor", () => {
    const anchor = Date.parse("2026-07-01T00:00:00.000Z");
    const { since, split } = quarterlyWindowBounds(anchor);
    const splitMs = Date.parse(`${split}T00:00:00.000Z`);
    const sinceMs = Date.parse(`${since}T00:00:00.000Z`);
    const currentWindowDays = Math.round((anchor - splitMs) / 86_400_000);
    const priorWindowDays = Math.round((splitMs - sinceMs) / 86_400_000);
    expect(currentWindowDays).toBe(priorWindowDays);
    expect(currentWindowDays).toBe(91);
  });
});

describe("loadQuarterlyDecayForTenant", () => {
  it("pages gsc_decay_v1 with .range() in 1000-row chunks until a short page", async () => {
    rpcPages[0] = Array.from({ length: 1000 }, (_, i) => ({
      page: `/p${i}`,
      clicks_now: 1,
      impressions_now: 10,
      pos_w_now: 50,
      clicks_prior: 2,
      impressions_prior: 20,
      pos_w_prior: 80,
    }));
    rpcPages[1] = [{ page: "/last", clicks_now: 5, impressions_now: 50, pos_w_now: 250, clicks_prior: 10, impressions_prior: 100, pos_w_prior: 500 }];

    const out = await loadQuarterlyDecayForTenant("tenant-x");
    expect(rangeCalls).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ]);
    expect(out.length).toBe(1001);
    const last = out.find((r) => r.page === "/last");
    expect(last?.current.clicks).toBe(5);
    expect(last?.prior.clicks).toBe(10);
  });

  it("computes impression-weighted position correctly from pos_w sums", async () => {
    rpcPages[0] = [{ page: "/x", clicks_now: 10, impressions_now: 100, pos_w_now: 500, clicks_prior: 20, impressions_prior: 200, pos_w_prior: 800 }];
    const out = await loadQuarterlyDecayForTenant("tenant-x");
    const row = out.find((r) => r.page === "/x")!;
    expect(row.current.position).toBeCloseTo(5, 5); // 500/100
    expect(row.prior.position).toBeCloseTo(4, 5); // 800/200
  });

  it("fails soft to [] on an RPC error", async () => {
    rpcThrow = new Error("boom");
    const out = await loadQuarterlyDecayForTenant("tenant-x");
    expect(out).toEqual([]);
  });

  it("returns [] for an empty tenantId without calling the RPC", async () => {
    const out = await loadQuarterlyDecayForTenant("");
    expect(out).toEqual([]);
    expect(rangeCalls).toEqual([]);
  });
});
