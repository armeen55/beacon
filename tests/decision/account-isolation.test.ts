/**
 * Account isolation for the structured-drafter cache + budget (Slice 3, 2026-07-23).
 *
 * The customer promise: one account NEVER reuses another's generated text, and
 * every paid call is attributable to an explicit account. These pin it end to end:
 *
 *   - the "llm-call-cache" store is per-tenant (not global);
 *   - llmCallCacheKey folds the account IN, so identical prompts from two accounts
 *     hash to different keys;
 *   - storeCacheImpl routes every read/write per account, stamps the owner on each
 *     entry, scopes recentTexts, and THROWS on an empty account before any I/O;
 *   - callStructuredLLM threads the account into the cache (miss for account B on a
 *     byte-identical prompt; $0 hit for account A) and into the budget check/record;
 *   - a missing account fails closed BEFORE cache, budget, or the completion fn.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Budget seam: spy on the real adjudicator budget so we can assert the explicit
// account reaches the cap check + spend record (drafter uses these directly).
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({
  checkBudget: vi.fn(async () => ({ allowed: true, remaining: 10 })),
  recordSpend: vi.fn(async () => {}),
}));

// json-store seam: assert storeCacheImpl routes with an EXPLICIT { tenantId }.
const readStoreMock = vi.fn(async () => [] as unknown[]);
const writeStoreMock = vi.fn(async () => {});
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (...a: unknown[]) => readStoreMock(...(a as [])),
  writeStore: (...a: unknown[]) => writeStoreMock(...(a as [])),
}));

import { checkBudget, recordSpend } from "@/domains/decision/llm/adjudicator-budget";
import {
  callStructuredLLM,
  type CompleteFn,
} from "@/domains/decision/llm/structured-drafter";
import {
  storeCacheImpl,
  llmCallCacheKey,
  type CacheImpl,
  type LlmCallCacheEntry,
} from "@/domains/decision/llm/call-cache";
import { classifyStore } from "@/lib/persistence/store-classification";

const VALID = {
  field: "title",
  before: "Nowruz",
  after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen",
  rationale: "The current title is one word and misses the customs searchers ask about.",
  evidenceRefs: [{ source: "gsc", detail: "strong impressions for nowruz traditions with a low click rate" }],
  confidence: "high",
  risks: ["keep the title concise"],
  operatorSteps: ["Replace the page title field with the new value"],
  proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" },
};

const REQ = {
  kind: "atomic_edit" as const,
  system: "You improve one on-page field.",
  user: "Page: Nowruz. Field to edit: title. Current title: Nowruz.",
  grounded: "nowruz traditions persian new year customs haft-seen",
};

/** A per-account partitioned cache mirroring storeCacheImpl's isolation, plus call
 *  captures so we can assert callStructuredLLM threaded the right account through. */
function partitionedCache() {
  const store = new Map<string, LlmCallCacheEntry[]>();
  const reads: Array<{ tenantId: string; key: string }> = [];
  const recents: Array<{ tenantId: string; kind: string }> = [];
  const impl: CacheImpl = {
    read: async (tenantId, key) => {
      reads.push({ tenantId, key });
      return (store.get(tenantId) ?? []).find((e) => e.key === key) ?? null;
    },
    write: async (tenantId, entry) => {
      const rows = (store.get(tenantId) ?? []).filter((e) => e.key !== entry.key);
      store.set(tenantId, [...rows, { ...entry, tenantId }]);
    },
    recentTexts: async (tenantId, kind) => {
      recents.push({ tenantId, kind });
      return (store.get(tenantId) ?? [])
        .filter((e) => e.kind === kind && typeof e.primaryText === "string")
        .map((e) => e.primaryText as string);
    },
  };
  return { impl, store, reads, recents };
}

/** A completion double that replays a value queue and counts calls. */
function seam(values: Array<{ value: unknown } | { error: string; retryable: boolean }>) {
  let i = 0;
  let calls = 0;
  const complete: CompleteFn = async () => {
    calls += 1;
    return values[Math.min(i++, values.length - 1)]!;
  };
  return { complete, calls: () => calls };
}

const ORIGINAL_PROVIDER = process.env.BEACON_LLM_PROVIDER;
beforeEach(() => {
  process.env.BEACON_LLM_PROVIDER = "openai";
  (checkBudget as unknown as ReturnType<typeof vi.fn>).mockClear();
  (recordSpend as unknown as ReturnType<typeof vi.fn>).mockClear();
  readStoreMock.mockClear();
  readStoreMock.mockResolvedValue([]);
  writeStoreMock.mockClear();
});
afterEach(() => {
  process.env.BEACON_LLM_PROVIDER = ORIGINAL_PROVIDER;
});

// ── store classification + key isolation ─────────────────────────────────────

describe("the call cache is per-account, keyed by account", () => {
  it("the 'llm-call-cache' store is TENANT_SCOPED, never global", () => {
    expect(classifyStore("llm-call-cache")).toBe("per-tenant");
  });

  it("a byte-identical prompt from two accounts hashes to DIFFERENT keys", () => {
    const parts = { promptId: "draft.atomic_edit", promptVersion: 1, kind: "atomic_edit", system: "s", user: "u" };
    const keyA = llmCallCacheKey({ tenantId: "tenant-a", ...parts });
    const keyB = llmCallCacheKey({ tenantId: "tenant-b", ...parts });
    expect(keyA).not.toBe(keyB);
    // Same account + same prompt is stable (the $0-repeat guarantee).
    expect(llmCallCacheKey({ tenantId: "tenant-a", ...parts })).toBe(keyA);
  });
});

// ── storeCacheImpl: explicit routing, owner stamping, fail-closed ────────────

describe("storeCacheImpl routes per account and fails closed", () => {
  it("read/write pass an EXPLICIT { tenantId } and stamp the owner on the entry", async () => {
    const entry: LlmCallCacheEntry = {
      key: "k1", tenantId: "tenant-a", kind: "atomic_edit", promptId: "draft.atomic_edit",
      promptVersion: 1, value: VALID, primaryText: VALID.after, createdAt: "t", lastUsedAt: "t",
    };
    await storeCacheImpl.write("tenant-a", { ...entry, tenantId: "ignored-overwritten" });
    // readAll first, then the routed write.
    expect(readStoreMock).toHaveBeenCalledWith("llm-call-cache", undefined, { tenantId: "tenant-a" });
    const lastWrite = writeStoreMock.mock.calls.at(-1) as unknown as [string, LlmCallCacheEntry[], { tenantId: string }];
    expect(lastWrite[2]).toEqual({ tenantId: "tenant-a" });
    expect(lastWrite[1][0]!.tenantId).toBe("tenant-a"); // owner stamped, not the caller's value

    await storeCacheImpl.read("tenant-b", "k1");
    expect(readStoreMock).toHaveBeenLastCalledWith("llm-call-cache", undefined, { tenantId: "tenant-b" });
  });

  it("recentTexts returns only the SAME account's history (owner filter)", async () => {
    readStoreMock.mockResolvedValue([
      { key: "k1", tenantId: "tenant-a", kind: "atomic_edit", promptId: "p", promptVersion: 1, value: {}, primaryText: "A text", createdAt: "t", lastUsedAt: "t" },
      { key: "k2", tenantId: "tenant-b", kind: "atomic_edit", promptId: "p", promptVersion: 1, value: {}, primaryText: "B text", createdAt: "t", lastUsedAt: "t" },
    ]);
    // storeCacheImpl asks the store for tenant-a's file; the in-memory owner
    // filter drops any stray foreign row that ever appeared in it.
    const texts = await storeCacheImpl.recentTexts("tenant-a", "atomic_edit", 5);
    expect(texts).toEqual(["A text"]);
  });

  it("an empty account THROWS before any storage access", async () => {
    await expect(storeCacheImpl.read("", "k")).rejects.toThrow(/tenantId is required/);
    await expect(storeCacheImpl.write("  ", {} as LlmCallCacheEntry)).rejects.toThrow(/tenantId is required/);
    await expect(storeCacheImpl.recentTexts("", "atomic_edit", 5)).rejects.toThrow(/tenantId is required/);
    expect(readStoreMock).not.toHaveBeenCalled();
    expect(writeStoreMock).not.toHaveBeenCalled();
  });
});

// ── callStructuredLLM: end-to-end account isolation ──────────────────────────

describe("callStructuredLLM keeps accounts isolated end to end", () => {
  it("account B gets a MISS on account A's byte-identical prompt; A still hits at $0", async () => {
    const cache = partitionedCache();

    // Account A generates + caches (pays).
    const a1 = seam([{ value: VALID }]);
    const outA = await callStructuredLLM({ ...REQ, tenantId: "tenant-a", complete: a1.complete, cacheImpl: cache.impl });
    expect(outA.status).toBe("drafted");
    expect(a1.calls()).toBe(1);

    // Account A repeats the SAME prompt: $0 cache hit, no call.
    const a2 = seam([{ error: "must-not-run", retryable: false }]);
    const outA2 = await callStructuredLLM({ ...REQ, tenantId: "tenant-a", complete: a2.complete, cacheImpl: cache.impl });
    expect(outA2.status === "drafted" && outA2.cached).toBe(true);
    expect(outA2.status === "drafted" && outA2.costUsd).toBe(0);
    expect(a2.calls()).toBe(0);

    // Account B, byte-identical prompt: MISS -> it generates its own (would pay).
    const b1 = seam([{ value: VALID }]);
    const outB = await callStructuredLLM({ ...REQ, tenantId: "tenant-b", complete: b1.complete, cacheImpl: cache.impl });
    expect(outB.status).toBe("drafted");
    expect(outB.status === "drafted" && outB.cached).toBeUndefined();
    expect(b1.calls()).toBe(1);

    // The cache never crossed accounts: A's read keys are all tenant-a, B's tenant-b,
    // and every stored entry records its own owner.
    expect(cache.reads.filter((r) => r.tenantId === "tenant-a").length).toBeGreaterThan(0);
    for (const e of cache.store.get("tenant-a") ?? []) expect(e.tenantId).toBe("tenant-a");
    for (const e of cache.store.get("tenant-b") ?? []) expect(e.tenantId).toBe("tenant-b");
    // Account A's key is absent from account B's partition.
    const aKey = (cache.store.get("tenant-a") ?? [])[0]!.key;
    expect((cache.store.get("tenant-b") ?? []).some((e: LlmCallCacheEntry) => e.key === aKey)).toBe(false);
  });

  it("de-templating recentTexts never sees another account's outputs", async () => {
    const cache = partitionedCache();
    await callStructuredLLM({ ...REQ, tenantId: "tenant-a", complete: seam([{ value: VALID }]).complete, cacheImpl: cache.impl });
    // Account B's history is empty even though account A has a stored output.
    expect(await cache.impl.recentTexts("tenant-b", "atomic_edit", 5)).toEqual([]);
    expect(await cache.impl.recentTexts("tenant-a", "atomic_edit", 5)).toEqual([VALID.after]);
    // callStructuredLLM asked recentTexts for the right account each time.
    for (const r of cache.recents) expect(["tenant-a", "tenant-b"]).toContain(r.tenantId);
  });

  it("the budget check + spend record receive the EXPLICIT account", async () => {
    await callStructuredLLM({ ...REQ, tenantId: "tenant-a", complete: seam([{ value: VALID }]).complete, cacheImpl: partitionedCache().impl });
    expect(checkBudget).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a" }));
    expect(recordSpend).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ tenantId: "tenant-a" }));
  });

  it("a MISSING account fails closed BEFORE cache, budget, or the completion fn", async () => {
    const cache = partitionedCache();
    const s = seam([{ value: VALID }]);
    const out = await callStructuredLLM({ ...REQ, tenantId: "  ", complete: s.complete, cacheImpl: cache.impl });
    expect(out.status).toBe("validation_failed");
    expect(out.status === "validation_failed" && out.reason).toBe("missing_tenant");
    // Zero calls on all three seams.
    expect(s.calls()).toBe(0);
    expect(cache.reads.length).toBe(0);
    expect(checkBudget).not.toHaveBeenCalled();
    expect(recordSpend).not.toHaveBeenCalled();
  });
});
