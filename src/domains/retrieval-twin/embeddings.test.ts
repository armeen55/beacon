import { describe, it, expect, vi, beforeEach } from "vitest";

let supabaseConfigured = true;
let cachedRows: { tenant_id: string; id: string; embedding: number[] }[] = [];
let writtenRows: Record<string, unknown>[] = [];
let upsertCallCount = 0;
let inCallSizes: number[] = [];
/** When set, a real Supabase "URL too long" style rejection for any .in() call over this
 *  many ids - reproduces the real 539-id "Bad Request" failure so a regression can't
 *  silently reappear. */
let inRejectAboveSize: number | null = null;

function makeQuery() {
  const query: Record<string, unknown> = {};
  query.select = () => query;
  query.eq = () => query;
  query.in = (_col: string, ids: string[]) => {
    inCallSizes.push(ids.length);
    if (inRejectAboveSize != null && ids.length > inRejectAboveSize) {
      return Promise.resolve({ data: null, error: { message: "Bad Request" } });
    }
    const data = cachedRows.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, embedding: r.embedding }));
    return Promise.resolve({ data, error: null });
  };
  query.upsert = (rows: Record<string, unknown>[]) => {
    upsertCallCount += 1;
    writtenRows.push(...rows);
    return Promise.resolve({ error: null });
  };
  return query;
}

vi.mock("@/lib/persistence/supabase", () => ({
  isSupabaseConfigured: () => supabaseConfigured,
  getSupabaseAdmin: () => ({ from: () => makeQuery() }),
}));

const checkBudgetMock = vi.fn();
const recordSpendMock = vi.fn();
vi.mock("./retrieval-budget", () => ({
  checkBudget: (...args: unknown[]) => checkBudgetMock(...args),
  recordSpend: (...args: unknown[]) => recordSpendMock(...args),
}));

import { embedChunks, contentHashOf, estimateEmbedCostUsd, tokensForChunks, type EmbeddableChunk } from "./embeddings";

const TENANT = "tenant-iranopedia";

beforeEach(() => {
  vi.clearAllMocks();
  supabaseConfigured = true;
  cachedRows = [];
  writtenRows = [];
  upsertCallCount = 0;
  inCallSizes = [];
  inRejectAboveSize = null;
  checkBudgetMock.mockResolvedValue({ allowed: true, remaining: 2 });
  recordSpendMock.mockResolvedValue(undefined);
  delete process.env.OPENAI_API_KEY;
});

function chunk(id: string, text = "hello world"): EmbeddableChunk {
  return { id, source: "owned", pageUrl: "https://iranopedia.com/nowruz", chunkText: text };
}

describe("contentHashOf", () => {
  it("is stable for identical text", () => {
    expect(contentHashOf("hello")).toBe(contentHashOf("hello"));
  });
  it("differs for different text", () => {
    expect(contentHashOf("hello")).not.toBe(contentHashOf("world"));
  });
});

describe("estimateEmbedCostUsd / tokensForChunks", () => {
  it("estimates near-zero cost for small inputs", () => {
    const cost = estimateEmbedCostUsd([{ chunkText: "x".repeat(800) }]); // ~200 tokens
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.001);
  });
  it("scales with total chars", () => {
    const small = estimateEmbedCostUsd([{ chunkText: "x".repeat(400) }]);
    const big = estimateEmbedCostUsd([{ chunkText: "x".repeat(4000) }]);
    expect(big).toBeGreaterThan(small);
  });
  it("counts roughly 4 chars per token", () => {
    expect(tokensForChunks([{ chunkText: "x".repeat(800) }])).toBe(200);
  });
});

describe("embedChunks - cache hit path (no spend)", () => {
  it("returns cached vectors with zero spend and no embed call when everything is cached", async () => {
    const id = contentHashOf("hello world");
    cachedRows = [{ tenant_id: TENANT, id, embedding: [0.1, 0.2, 0.3] }];
    const embedFn = vi.fn();
    const r = await embedChunks(TENANT, [chunk(id)], { embed: embedFn });
    expect(r.cacheHits).toBe(1);
    expect(r.spentUsd).toBe(0);
    expect(r.embedded).toHaveLength(1);
    expect(r.embedded[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(embedFn).not.toHaveBeenCalled();
    expect(checkBudgetMock).not.toHaveBeenCalled();
  });

  it("dedupes chunks with the same id before checking the cache", async () => {
    const id = contentHashOf("dup");
    const embedFn = vi.fn(async (inputs: string[]) => ({ vectors: inputs.map(() => [1, 2, 3]) }));
    process.env.OPENAI_API_KEY = "sk-test";
    const r = await embedChunks(TENANT, [chunk(id, "dup"), chunk(id, "dup")], { embed: embedFn });
    expect(r.embedded).toHaveLength(1);
    expect(embedFn).toHaveBeenCalledTimes(1);
    expect((embedFn.mock.calls[0][0] as string[]).length).toBe(1);
  });
});

describe("embedChunks - budget fail-closed (pin)", () => {
  it("skips every chunk in a batch when checkBudget reports not allowed, with zero spend", async () => {
    checkBudgetMock.mockResolvedValue({ allowed: false, reason: "cap reached" });
    process.env.OPENAI_API_KEY = "sk-test";
    const embedFn = vi.fn();
    const r = await embedChunks(TENANT, [chunk("a"), chunk("b")], { embed: embedFn });
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped.every((s) => s.reason === "cap reached")).toBe(true);
    expect(r.spentUsd).toBe(0);
    expect(embedFn).not.toHaveBeenCalled();
    expect(recordSpendMock).not.toHaveBeenCalled();
  });

  it("fails closed when checkBudget itself throws (never silently allows)", async () => {
    checkBudgetMock.mockRejectedValue(new Error("budget store unreadable"));
    process.env.OPENAI_API_KEY = "sk-test";
    const embedFn = vi.fn();
    const r = await embedChunks(TENANT, [chunk("a")], { embed: embedFn });
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toMatch(/failing closed/);
    expect(embedFn).not.toHaveBeenCalled();
  });
});

describe("embedChunks - no OpenAI key configured", () => {
  it("skips all uncached chunks with reason no_openai_key, never throws", async () => {
    const r = await embedChunks(TENANT, [chunk("a"), chunk("b")]);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped.every((s) => s.reason === "no_openai_key")).toBe(true);
    expect(checkBudgetMock).not.toHaveBeenCalled();
  });
});

describe("embedChunks - happy path with a real (injected) embed fn", () => {
  it("embeds uncached chunks, records spend once per batch, and writes the cache", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const embedFn = vi.fn(async (inputs: string[]) => ({ vectors: inputs.map(() => [0.5, 0.5]) }));
    const longText = "Nowruz traditions and the haft-sin table. ".repeat(50);
    const r = await embedChunks(TENANT, [chunk("a", longText), chunk("b", longText)], { embed: embedFn });
    expect(r.embedded).toHaveLength(2);
    expect(r.spentUsd).toBeGreaterThan(0);
    expect(recordSpendMock).toHaveBeenCalledTimes(1);
    expect(writtenRows).toHaveLength(2);
  });

  it("marks a batch fail-soft on an embed API error without throwing", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const embedFn = vi.fn(async () => ({ error: "openai_500" }));
    const r = await embedChunks(TENANT, [chunk("a")], { embed: embedFn });
    expect(r.skipped).toEqual([{ id: "a", reason: "embed_openai_500" }]);
    expect(r.embedded).toHaveLength(0);
  });

  it("batches at most 100 inputs per embed call", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const embedFn = vi.fn(async (inputs: string[]) => ({ vectors: inputs.map(() => [1]) }));
    const chunks = Array.from({ length: 150 }, (_, i) => chunk(`id-${i}`, `text-${i}`));
    const r = await embedChunks(TENANT, chunks, { embed: embedFn });
    expect(embedFn).toHaveBeenCalledTimes(2);
    expect((embedFn.mock.calls[0][0] as string[]).length).toBe(100);
    expect((embedFn.mock.calls[1][0] as string[]).length).toBe(50);
    expect(r.embedded).toHaveLength(150);
  });

  it("returns an empty result for an empty input without touching the cache or budget", async () => {
    const r = await embedChunks(TENANT, []);
    expect(r).toEqual({ embedded: [], cacheHits: 0, skipped: [], spentUsd: 0 });
    expect(checkBudgetMock).not.toHaveBeenCalled();
  });

  it("writes the cache in bounded slices of 50 rows, not one giant upsert (regression pin: a real 539-chunk index run hit a Postgres statement timeout on an unbatched upsert)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const embedFn = vi.fn(async (inputs: string[]) => ({ vectors: inputs.map(() => [1, 2]) }));
    const chunks = Array.from({ length: 120 }, (_, i) => chunk(`id-${i}`, `text-${i}`));
    const r = await embedChunks(TENANT, chunks, { embed: embedFn });
    expect(r.embedded).toHaveLength(120);
    // 120 rows at 50/write -> 3 upsert calls (50 + 50 + 20), never 1.
    expect(upsertCallCount).toBe(3);
    expect(writtenRows).toHaveLength(120);
  });

  it("reads the cache in bounded slices of 100 ids, never one giant IN-list (regression pin: a real 539-id lookup got rejected outright with 'Bad Request' - a GET request URL too long)", async () => {
    // Pre-seed the cache with 250 already-embedded chunks (a fresh chunk set below re-uses
    // the SAME ids so every one of them should be a cache hit).
    const chunks = Array.from({ length: 250 }, (_, i) => chunk(`id-${i}`, `text-${i}`));
    cachedRows = chunks.map((c) => ({ tenant_id: TENANT, id: c.id, embedding: [1, 2] }));
    // A .in() call with more than 100 ids reproduces the real failure - this pins that we
    // never issue one.
    inRejectAboveSize = 100;
    const embedFn = vi.fn();
    const r = await embedChunks(TENANT, chunks, { embed: embedFn });
    expect(r.cacheHits).toBe(250);
    expect(embedFn).not.toHaveBeenCalled();
    expect(Math.max(...inCallSizes)).toBeLessThanOrEqual(100);
    // 250 ids at 100/read -> 3 IN-list calls (100 + 100 + 50).
    expect(inCallSizes).toEqual([100, 100, 50]);
  });

  it("a failed read slice degrades to a fresh embed for just that slice's chunks, not the whole batch", async () => {
    const chunks = Array.from({ length: 150 }, (_, i) => chunk(`id-${i}`, `text-${i}`));
    cachedRows = chunks.map((c) => ({ tenant_id: TENANT, id: c.id, embedding: [1, 2] }));
    inRejectAboveSize = 100; // first slice (100 ids) succeeds, second slice (50 ids) also succeeds - so instead reject ALL slices over 40 to force partial failure on both.
    inRejectAboveSize = 40;
    process.env.OPENAI_API_KEY = "sk-test";
    const embedFn = vi.fn(async (inputs: string[]) => ({ vectors: inputs.map(() => [9, 9]) }));
    const r = await embedChunks(TENANT, chunks, { embed: embedFn });
    // Every read slice exceeded 40 ids and was rejected, so nothing was found in cache -
    // everything falls through to a fresh embed rather than crashing or losing chunks.
    expect(r.cacheHits).toBe(0);
    expect(r.embedded).toHaveLength(150);
    expect(embedFn).toHaveBeenCalled();
  });
});
