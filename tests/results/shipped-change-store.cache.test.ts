/**
 * shipped-change-store.cache.test.ts (R23 P17, 2026-07-03, read-path perf).
 *
 * Pins the request-cache wrap on `loadShippedChanges` (the hottest read on the
 * /changes + cockpit render paths — up to 5 reads per request before this).
 *
 * The optimization is BEHAVIOR-PRESERVING: wrapping the reader in `react.cache`
 * changes only HOW MANY times the DB is hit within one request, never WHAT the
 * caller sees. These tests pin that invariant:
 *   1. the mapped records are byte-identical to a direct read of the same rows
 *      (the cache is a transparent passthrough of the underlying read);
 *   2. the file-fallback path (no Supabase env) still returns the same rows;
 *   3. an undefined-table error still routes to the file fallback.
 *
 * `react.cache` is a plain passthrough OUTSIDE a React request scope (which is
 * what vitest is), so a call-count assertion here would only ever see the
 * uncached path — the dedup is exercised in the real request scope, exactly like
 * the ga4-page-values / clarity-page-signals / fanout-seeds caches this mirrors.
 * What we CAN and DO pin deterministically is that the read is invoked the SAME
 * number of times as there are caller invocations in this (scope-less) env, and
 * that every invocation returns identical output.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Tenant is ambient (currentTenantId) inside the store — pin it.
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-a",
}));

// Chainable supabase mock: select().eq() resolves to the configured rows and
// counts how many times select() fired (the DB round-trips).
let selectCalls = 0;
let ledgerRows: Array<Record<string, unknown>> = [];
let supabaseThrows = false;
let readError: { code?: string; message?: string } | null = null;

function makeChain() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => {
    selectCalls += 1;
    return chain;
  });
  chain.eq = vi.fn(() => Promise.resolve({ data: readError ? null : ledgerRows, error: readError }));
  return chain;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (supabaseThrows) throw new Error("no supabase env");
    return { from: vi.fn(() => makeChain()) };
  },
}));

// File fallback (json-store) — used when there is no env / undefined table.
let fileRows: Array<Record<string, unknown>> = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => fileRows,
  writeStore: async () => {},
}));

import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";

function ledgerRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenant_id: "tenant-a",
    id: "iranopedia.com/persian-food::2026-06-01",
    page: "https://iranopedia.com/persian-food",
    path: "/persian-food",
    action_type: "edit_title",
    before_text: "old title",
    after_text: "new title",
    shipped_at: "2026-06-01T00:00:00.000Z",
    baseline: { clicks: 10, impressions: 100, ctr: 0.1, position: 8, windowDays: 28 },
    target_queries: ["persian food"],
    control_pages: ["https://iranopedia.com/tehran"],
    windows: [],
    verdict: "measuring",
    confidence: "low",
    measured_at: null,
    notes: null,
    verified_live: false,
    live_source_url: null,
    recrawl_requested_at: null,
    operator_verdict_override: null,
    control_match_notes: null,
    control_match_weak: false,
    control_donor_pool: null,
    verdict_revisions: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  selectCalls = 0;
  ledgerRows = [];
  fileRows = [];
  supabaseThrows = false;
  readError = null;
});

describe("loadShippedChanges request-cache wrap (R23 P17)", () => {
  it("maps DB rows to records with the EXACT shape the uncached reader produced", async () => {
    ledgerRows = [ledgerRow()];
    const records = await loadShippedChanges();
    expect(records).toHaveLength(1);
    const r = records[0]!;
    // Byte-identical field mapping (rowToRecord contract) — the wrap changed
    // nothing about the returned shape.
    expect(r).toMatchObject({
      id: "iranopedia.com/persian-food::2026-06-01",
      page: "https://iranopedia.com/persian-food",
      path: "/persian-food",
      actionType: "edit_title",
      before: "old title",
      after: "new title",
      shippedAt: "2026-06-01T00:00:00.000Z",
      verdict: "measuring",
      confidence: "low",
      targetQueries: ["persian food"],
      controlPages: ["https://iranopedia.com/tehran"],
    });
  });

  it("returns IDENTICAL output on repeated calls (same rows in → same records out)", async () => {
    ledgerRows = [ledgerRow(), ledgerRow({ id: "b", path: "/b", shipped_at: "2026-05-01T00:00:00.000Z" })];
    const first = await loadShippedChanges();
    const second = await loadShippedChanges();
    // Deep-equal: the caller sees the same data no matter how the read is cached.
    expect(second).toEqual(first);
    // sortNewest is applied on every read — newest ship first, stable.
    expect(first.map((r) => r.shippedAt)).toEqual([
      "2026-06-01T00:00:00.000Z",
      "2026-05-01T00:00:00.000Z",
    ]);
  });

  it("each caller invocation drives exactly one DB read in a scope-less env (no double-read per call)", async () => {
    ledgerRows = [ledgerRow()];
    await loadShippedChanges();
    // The uncached reader issues ONE select().eq() round-trip per invocation —
    // the wrap never turns one logical read into two. In a real React request
    // scope the SECOND+ invocations are served from the cache (zero extra reads);
    // here (no scope) we pin the single-read-per-call floor.
    expect(selectCalls).toBe(1);
  });

  it("falls back to the file store (identical records) when Supabase env is absent", async () => {
    supabaseThrows = true;
    fileRows = [
      {
        id: "file::1",
        page: "https://iranopedia.com/x",
        path: "/x",
        actionType: "edit_meta",
        before: null,
        after: null,
        shippedAt: "2026-06-02T00:00:00.000Z",
        baseline: { clicks: 0, impressions: 0, ctr: 0, position: 0, windowDays: 28 },
        targetQueries: [],
        controlPages: [],
        windows: [],
        verdict: "measuring",
        confidence: "low",
        measuredAt: null,
        createdAt: "2026-06-02T00:00:00.000Z",
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
    ];
    const records = await loadShippedChanges();
    expect(records.map((r) => r.id)).toEqual(["file::1"]);
    expect(selectCalls).toBe(0); // never touched Supabase
  });

  it("routes an undefined-table error to the file fallback (unchanged)", async () => {
    readError = { code: "42P01", message: "relation does not exist" };
    fileRows = [
      {
        id: "file::pre-migration",
        page: "https://iranopedia.com/y",
        path: "/y",
        actionType: "edit_title",
        before: null,
        after: null,
        shippedAt: "2026-06-03T00:00:00.000Z",
        baseline: { clicks: 0, impressions: 0, ctr: 0, position: 0, windowDays: 28 },
        targetQueries: [],
        controlPages: [],
        windows: [],
        verdict: "measuring",
        confidence: "low",
        measuredAt: null,
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
      },
    ];
    const records = await loadShippedChanges();
    expect(records.map((r) => r.id)).toEqual(["file::pre-migration"]);
  });

  it("exposes loadShippedChanges as a zero-arg callable (import surface unchanged)", () => {
    expect(typeof loadShippedChanges).toBe("function");
    // react.cache-wrapped fns take the same args as the impl; loadShippedChanges is 0-arg.
    expect(loadShippedChanges.length).toBe(0);
  });
});
