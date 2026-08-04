/** Account isolation for the structured-output cache and budget: per-account store, account-keyed hashes,
 *  explicit routing with owner stamping, scoped recentTexts, and fail-closed on a missing account. */
import { describe, it, expect, vi, beforeEach } from "vitest";
// Budget seam: spy on the real adjudicator budget so we can assert the explicit
// account reaches the cap check + spend record (drafter uses these directly).
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: vi.fn(async () => ({ allowed: true, remaining: 10 })), recordSpend: vi.fn(async () => {}) }));
// json-store seam: assert storeCacheImpl routes with an EXPLICIT { tenantId }.
const readStoreMock = vi.fn(async () => [] as unknown[]);
const writeStoreMock = vi.fn(async () => {});
vi.mock("@/lib/persistence/json-store", () => ({ readStore: (...a: unknown[]) => readStoreMock(...(a as [])), writeStore: (...a: unknown[]) => writeStoreMock(...(a as [])) }));
import { checkBudget, recordSpend } from "@/domains/decision/llm/adjudicator-budget";
import { callStructuredLLM, type CompleteFn } from "@/domains/decision/llm/structured-drafter";
import { storeCacheImpl, type CacheImpl, type LlmCallCacheEntry } from "@/domains/decision/llm/call-cache";
import { classifyStore } from "@/lib/persistence/store-classification";
const VALID = {
  field: "title", before: "Nowruz", after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen",
  rationale: "The current title is one word and misses the customs searchers ask about.",
  evidenceRefs: [{ source: "gsc", detail: "strong impressions for nowruz traditions with a low click rate" }],
  confidence: "high", risks: ["keep the title concise"], operatorSteps: ["Replace the page title field with the new value"],
  proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" },
};
const REQ = {
  kind: "atomic_edit" as const, system: "You improve one on-page field.",
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
    read: async (tenantId, key) => { reads.push({ tenantId, key }); return (store.get(tenantId) ?? []).find((e) => e.key === key) ?? null; },
    write: async (tenantId, entry) => { store.set(tenantId, [...(store.get(tenantId) ?? []).filter((e) => e.key !== entry.key), { ...entry, tenantId }]); },
    recentTexts: async (tenantId, kind) => {
      recents.push({ tenantId, kind });
      return (store.get(tenantId) ?? []).filter((e) => e.kind === kind && typeof e.primaryText === "string").map((e) => e.primaryText as string);
    },
  };
  return { impl, store, reads, recents };
}
/** A completion double that replays a value queue and counts calls. */
function seam(values: Array<{ value: unknown } | { error: string; retryable: boolean }>) {
  let i = 0, calls = 0;
  const complete: CompleteFn = async () => { calls += 1; return values[Math.min(i++, values.length - 1)]!; };
  return { complete, calls: () => calls };
}
beforeEach(() => {
  (checkBudget as unknown as ReturnType<typeof vi.fn>).mockClear();
  (recordSpend as unknown as ReturnType<typeof vi.fn>).mockClear();
  readStoreMock.mockClear();
  readStoreMock.mockResolvedValue([]);
  writeStoreMock.mockClear();
});
// ── store classification + key isolation ─────────────────────────────────────
describe("the call cache is per-account, keyed by account", () => {
  // The REAL impl: an omitted tenantId falls back to AMBIENT resolution downstream, so a regression is silent.
  it("storeCacheImpl routes with an EXPLICIT { tenantId }, stamps the owner, and throws on an empty account", async () => {
    expect(classifyStore("llm-call-cache")).toBe("per-tenant"); // the store itself is per account, never global
    const entry = { key: "k1", tenantId: "ignored-overwritten", kind: "atomic_edit", promptId: "p",
      promptVersion: 1, value: VALID, primaryText: "A", createdAt: "t", lastUsedAt: "t" } as LlmCallCacheEntry;
    await storeCacheImpl.write("tenant-a", entry);
    expect(readStoreMock).toHaveBeenCalledWith("llm-call-cache", undefined, { tenantId: "tenant-a" });
    const w = writeStoreMock.mock.calls.at(-1) as unknown as [string, LlmCallCacheEntry[], { tenantId: string }];
    expect(w[2]).toEqual({ tenantId: "tenant-a" }); // explicit routing, never the ambient fallback
    expect(w[1][0]!.tenantId).toBe("tenant-a"); // owner stamped, not the caller's value
    await expect(storeCacheImpl.read("", "k")).rejects.toThrow(/tenantId is required/);
  });
});
// ── callStructuredLLM: end-to-end account isolation ──────────────────────────
describe("callStructuredLLM keeps accounts isolated end to end", () => {
  it("account B gets a MISS on account A's byte-identical prompt; A still hits at $0", async () => {
    const cache = partitionedCache();
    // Account A generates + caches (pays).
    const a1 = seam([{ value: VALID }]);
    const outA = await callStructuredLLM({ ...REQ, tenantId: "tenant-a", complete: a1.complete, cacheImpl: cache.impl });
    expect([outA.status, a1.calls()]).toEqual(["drafted", 1]);
    // Account A repeats the SAME prompt: $0 cache hit, no call.
    const a2 = seam([{ error: "must-not-run", retryable: false }]);
    const outA2 = await callStructuredLLM({ ...REQ, tenantId: "tenant-a", complete: a2.complete, cacheImpl: cache.impl });
    expect([outA2.status === "drafted" && outA2.cached, outA2.status === "drafted" && outA2.costUsd, a2.calls()]).toEqual([true, 0, 0]);
    // Account B, byte-identical prompt: MISS -> it generates its own (would pay).
    const b1 = seam([{ value: VALID }]);
    const outB = await callStructuredLLM({ ...REQ, tenantId: "tenant-b", complete: b1.complete, cacheImpl: cache.impl });
    expect([outB.status, outB.status === "drafted" && outB.cached, b1.calls()]).toEqual(["drafted", undefined, 1]);
    // The cache never crossed accounts: A's read keys are all tenant-a, B's tenant-b,
    // and every stored entry records its own owner.
    expect(cache.reads.filter((r) => r.tenantId === "tenant-a").length).toBeGreaterThan(0);
    for (const e of cache.store.get("tenant-a") ?? []) expect(e.tenantId).toBe("tenant-a");
    for (const e of cache.store.get("tenant-b") ?? []) expect(e.tenantId).toBe("tenant-b");
    // Account A's key is absent from account B's partition.
    const aKey = (cache.store.get("tenant-a") ?? [])[0]!.key;
    expect((cache.store.get("tenant-b") ?? []).some((e: LlmCallCacheEntry) => e.key === aKey)).toBe(false);
    // De-templating asked for the right account every time, and an account that generated nothing sees nothing.
    for (const r of cache.recents) expect(["tenant-a", "tenant-b"]).toContain(r.tenantId);
    expect([await cache.impl.recentTexts("tenant-c", "atomic_edit", 5), await cache.impl.recentTexts("tenant-a", "atomic_edit", 5)]).toEqual([[], [VALID.after]]);
    // And the money seams were told WHICH account, explicitly, never left to the ambient one.
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
