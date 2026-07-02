/**
 * content-excerpt-backfill tests (N19, 2026-07-02).
 *
 * Pins:
 *   - candidate detection: only the LATEST snapshot per page_id is checked;
 *     a page whose latest snapshot already has body_paragraph_sample is
 *     never re-fetched
 *   - cap discipline: `limit` bounds how many candidates are attempted THIS
 *     call, and MAX_LIMIT hard-caps a caller passing something unreasonable
 *   - PGRST204/PGRST205/42P01 (missing table/column) degrades to an empty
 *     candidate list, never throws
 *   - per-page fail-soft: a fetch failure for one URL is recorded and does
 *     not stop the rest of the batch or throw
 *   - the persisted row keeps the ORIGINAL id/fetched_at (enriching the
 *     existing row, not creating a new observation)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── chainable supabase mock (same shape as mine-answer-patterns.test.ts) ──
type Row = Record<string, unknown>;
let snapshotRows: Row[] = [];
let readError: { code?: string; message?: string } | null = null;
let supabaseConfigured = true;

function chainFor() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.range = vi.fn((from: number, to: number) => {
    if (readError) return Promise.resolve({ data: null, error: readError });
    const page = snapshotRows.slice(from, to + 1);
    return Promise.resolve({ data: page, error: null });
  });
  return chain;
}

vi.mock("@/lib/persistence/supabase", () => ({
  isSupabaseConfigured: () => supabaseConfigured,
  getSupabaseAdmin: () => ({ from: () => chainFor() }),
}));

// ── polite-fetch mock ──
type FetchOutcome =
  | { ok: true; html: string; status: number }
  | { ok: false; reason: "robots_blocked" | "fetch_failed"; detail?: string };
const fetchOutcomes = new Map<string, FetchOutcome>();
const fetchCalls: string[] = [];

vi.mock("@/domains/competitor-intel/polite-fetch", () => ({
  fetchPageHtml: vi.fn((url: string) => {
    fetchCalls.push(url);
    const outcome = fetchOutcomes.get(url);
    return Promise.resolve(outcome ?? { ok: false, reason: "fetch_failed", detail: "no_fixture" });
  }),
}));

// ── dual-write mock ──
const syncCalls: Array<{ rows: Row[]; tenantId: string }> = [];
vi.mock("@/lib/persistence/dual-write", () => ({
  syncPageSnapshots: vi.fn((rows: Row[], tenantId: string) => {
    syncCalls.push({ rows, tenantId });
    return Promise.resolve();
  }),
}));

import { runContentExcerptBackfill } from "./content-excerpt-backfill";

const TENANT = "tenant-test";

function htmlWithParagraph(text: string): string {
  return `<!doctype html><html><head><title>T</title></head><body><main><p>${text}</p></main></body></html>`;
}

const EMPTY_HTML = `<!doctype html><html><head><title>T</title></head><body><main></main></body></html>`;

beforeEach(() => {
  snapshotRows = [];
  readError = null;
  supabaseConfigured = true;
  fetchOutcomes.clear();
  fetchCalls.length = 0;
  syncCalls.length = 0;
});

describe("runContentExcerptBackfill - candidate detection", () => {
  it("finds pages whose latest snapshot has no body_paragraph_sample", async () => {
    snapshotRows = [
      { id: "s1", page_id: "p1", url: "https://example.com/a", http_status: 200, body_paragraph_sample: null, fetched_at: "2026-07-01T00:00:00Z" },
    ];
    fetchOutcomes.set(
      "https://example.com/a",
      { ok: true, html: htmlWithParagraph("This is a real paragraph with more than eight words in it."), status: 200 },
    );
    const result = await runContentExcerptBackfill(TENANT, { limit: 5 });
    expect(result.candidatesFound).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.filled).toBe(1);
    expect(fetchCalls).toEqual(["https://example.com/a"]);
  });

  it("skips a page whose latest snapshot already has a body_paragraph_sample", async () => {
    snapshotRows = [
      { id: "s1", page_id: "p1", url: "https://example.com/a", http_status: 200, body_paragraph_sample: ["already here"], fetched_at: "2026-07-01T00:00:00Z" },
    ];
    const result = await runContentExcerptBackfill(TENANT, { limit: 5 });
    expect(result.candidatesFound).toBe(0);
    expect(result.attempted).toBe(0);
    expect(fetchCalls).toEqual([]);
  });

  it("only checks the LATEST snapshot per page_id, not older ones", async () => {
    // Two rows for the same page_id - the newer one (later fetched_at,
    // appears first because callers order fetched_at DESC in the real
    // query; here the mock just returns rows in array order) already has
    // an excerpt, so the page should NOT be a candidate even though an
    // older row for the same page lacks one.
    snapshotRows = [
      { id: "s-new", page_id: "p1", url: "https://example.com/a", http_status: 200, body_paragraph_sample: ["fresh content"], fetched_at: "2026-07-01T00:00:00Z" },
      { id: "s-old", page_id: "p1", url: "https://example.com/a", http_status: 200, body_paragraph_sample: null, fetched_at: "2026-06-01T00:00:00Z" },
    ];
    const result = await runContentExcerptBackfill(TENANT, { limit: 5 });
    expect(result.candidatesFound).toBe(0);
  });

  it("treats an empty array (not just null/undefined) as missing", async () => {
    snapshotRows = [
      { id: "s1", page_id: "p1", url: "https://example.com/a", http_status: 200, body_paragraph_sample: [], fetched_at: "2026-07-01T00:00:00Z" },
    ];
    fetchOutcomes.set("https://example.com/a", { ok: true, html: EMPTY_HTML, status: 200 });
    const result = await runContentExcerptBackfill(TENANT, { limit: 5 });
    expect(result.candidatesFound).toBe(1);
  });
});

describe("runContentExcerptBackfill - cap discipline", () => {
  it("only attempts up to `limit` candidates even when more exist", async () => {
    snapshotRows = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      page_id: `p${i}`,
      url: `https://example.com/${i}`,
      http_status: 200,
      body_paragraph_sample: null,
      fetched_at: "2026-07-01T00:00:00Z",
    }));
    for (const row of snapshotRows) {
      fetchOutcomes.set(row.url as string, { ok: true, html: EMPTY_HTML, status: 200 });
    }
    const result = await runContentExcerptBackfill(TENANT, { limit: 3 });
    expect(result.candidatesFound).toBe(10);
    expect(result.attempted).toBe(3);
    expect(fetchCalls).toHaveLength(3);
  });

  it("hard-caps at MAX_LIMIT even when a caller requests more", async () => {
    snapshotRows = Array.from({ length: 150 }, (_, i) => ({
      id: `s${i}`,
      page_id: `p${i}`,
      url: `https://example.com/${i}`,
      http_status: 200,
      body_paragraph_sample: null,
      fetched_at: "2026-07-01T00:00:00Z",
    }));
    for (const row of snapshotRows) {
      fetchOutcomes.set(row.url as string, { ok: true, html: EMPTY_HTML, status: 200 });
    }
    const result = await runContentExcerptBackfill(TENANT, { limit: 10_000 });
    expect(result.attempted).toBeLessThanOrEqual(100);
  });

  it("returns an all-zero result for limit 0 without reading candidates", async () => {
    snapshotRows = [
      { id: "s1", page_id: "p1", url: "https://example.com/a", http_status: 200, body_paragraph_sample: null, fetched_at: "2026-07-01T00:00:00Z" },
    ];
    const result = await runContentExcerptBackfill(TENANT, { limit: 0 });
    expect(result.attempted).toBe(0);
    expect(fetchCalls).toEqual([]);
  });
});

describe("runContentExcerptBackfill - fail-soft", () => {
  it("degrades to an empty candidate list on a missing-table/column error (PGRST204)", async () => {
    readError = { code: "PGRST204", message: "column not in schema cache" };
    const result = await runContentExcerptBackfill(TENANT, { limit: 5 });
    expect(result.candidatesFound).toBe(0);
    expect(result.pages).toEqual([]);
  });

  it("degrades to an empty candidate list on PGRST205", async () => {
    readError = { code: "PGRST205", message: "table not in schema cache" };
    const result = await runContentExcerptBackfill(TENANT, { limit: 5 });
    expect(result.candidatesFound).toBe(0);
  });

  it("degrades to an empty candidate list on 42P01", async () => {
    readError = { code: "42P01", message: "relation does not exist" };
    const result = await runContentExcerptBackfill(TENANT, { limit: 5 });
    expect(result.candidatesFound).toBe(0);
  });

  it("records a fetch failure for one page without throwing or stopping the batch", async () => {
    snapshotRows = [
      { id: "s1", page_id: "p1", url: "https://example.com/bad", http_status: 200, body_paragraph_sample: null, fetched_at: "2026-07-01T00:00:00Z" },
      { id: "s2", page_id: "p2", url: "https://example.com/good", http_status: 200, body_paragraph_sample: null, fetched_at: "2026-07-01T00:00:00Z" },
    ];
    fetchOutcomes.set("https://example.com/bad", { ok: false, reason: "fetch_failed", detail: "http_500" });
    fetchOutcomes.set("https://example.com/good", { ok: true, html: htmlWithParagraph("This paragraph definitely has more than eight real words present."), status: 200 });

    const r = await runContentExcerptBackfill(TENANT, { limit: 5 });
    expect(r.fetchFailed).toBe(1);
    expect(r.filled).toBe(1);
    expect(r.pages.find((p) => p.url === "https://example.com/bad")?.status).toBe("fetch_failed");
    expect(r.pages.find((p) => p.url === "https://example.com/good")?.status).toBe("filled");
  });

  it("returns still_empty (not a crash) for a page that fetches ok but has no extractable body", async () => {
    snapshotRows = [
      { id: "s1", page_id: "p1", url: "https://example.com/empty", http_status: 200, body_paragraph_sample: null, fetched_at: "2026-07-01T00:00:00Z" },
    ];
    fetchOutcomes.set("https://example.com/empty", { ok: true, html: EMPTY_HTML, status: 200 });
    const result = await runContentExcerptBackfill(TENANT, { limit: 5 });
    expect(result.stillEmpty).toBe(1);
    expect(result.filled).toBe(0);
  });

  it("skips a non-http(s) URL without attempting a fetch", async () => {
    snapshotRows = [
      { id: "s1", page_id: "p1", url: "ftp://example.com/a", http_status: 200, body_paragraph_sample: null, fetched_at: "2026-07-01T00:00:00Z" },
    ];
    const result = await runContentExcerptBackfill(TENANT, { limit: 5 });
    expect(result.pages[0].status).toBe("skipped");
    expect(fetchCalls).toEqual([]);
  });
});

describe("runContentExcerptBackfill - persistence identity", () => {
  it("preserves the original snapshot id and fetched_at when persisting a filled row", async () => {
    snapshotRows = [
      { id: "original-id-123", page_id: "p1", url: "https://example.com/a", http_status: 200, body_paragraph_sample: null, fetched_at: "2026-01-01T00:00:00Z" },
    ];
    fetchOutcomes.set(
      "https://example.com/a",
      { ok: true, html: htmlWithParagraph("This paragraph definitely has more than eight real words present."), status: 200 },
    );
    await runContentExcerptBackfill(TENANT, { limit: 5 });
    expect(syncCalls).toHaveLength(1);
    const persisted = syncCalls[0].rows[0];
    expect(persisted.id).toBe("original-id-123");
    expect(persisted.fetched_at).toBe("2026-01-01T00:00:00Z");
    expect(syncCalls[0].tenantId).toBe(TENANT);
  });

  it("never calls syncPageSnapshots when nothing was filled", async () => {
    snapshotRows = [
      { id: "s1", page_id: "p1", url: "https://example.com/empty", http_status: 200, body_paragraph_sample: null, fetched_at: "2026-07-01T00:00:00Z" },
    ];
    fetchOutcomes.set("https://example.com/empty", { ok: true, html: EMPTY_HTML, status: 200 });
    await runContentExcerptBackfill(TENANT, { limit: 5 });
    expect(syncCalls).toHaveLength(0);
  });
});

describe("runContentExcerptBackfill - guard rails", () => {
  it("returns an empty result for an empty tenantId without touching supabase", async () => {
    const result = await runContentExcerptBackfill("", { limit: 5 });
    expect(result.candidatesFound).toBe(0);
    expect(fetchCalls).toEqual([]);
  });

  it("returns an empty result when Supabase is not configured", async () => {
    supabaseConfigured = false;
    snapshotRows = [
      { id: "s1", page_id: "p1", url: "https://example.com/a", http_status: 200, body_paragraph_sample: null, fetched_at: "2026-07-01T00:00:00Z" },
    ];
    const result = await runContentExcerptBackfill(TENANT, { limit: 5 });
    expect(result.candidatesFound).toBe(0);
  });
});
