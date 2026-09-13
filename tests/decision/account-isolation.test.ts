/** Account isolation for the structured-output cache and budget: per-account store, account-keyed hashes, explicit routing with owner stamping, scoped recentTexts, and fail-closed on a missing account. */
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: vi.fn(async () => ({ allowed: true, remaining: 10 })), recordSpend: vi.fn(async () => {}) })); // Budget seam: spy on the real adjudicator budget so we can assert the explicit account reaches the cap check + spend record (drafter uses these directly).
const db = vi.hoisted(() => ({ rows: new Map<string, { scope_key: string; store_name: string; content: unknown; updated_at: string }>(), unavailable: false, unacknowledged: false, writes: 0 }));
vi.mock("@/domains/account", async (original) => ({ ...await original<object>(), getTenant: async (id: string) => ({ id, slug: id }) }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => ({ from: () => ({
  select: () => { const filters: Array<[string, string]> = []; const rows = () => [...db.rows.values()].filter((r) => filters.every(([k, v]) => k === "content->0->>kind" ? (r.content as Array<{ kind: string }>)[0]?.kind === v : r[k as keyof typeof r] === v));
    const query = { eq: (k: string, v: string) => { filters.push([k, v]); return query; }, order: () => query,
      maybeSingle: async () => ({ data: db.unavailable ? null : rows()[0] ?? null, error: db.unavailable ? { message: "outage" } : null }),
      limit: async (n: number) => ({ data: rows().slice(0, n), error: db.unavailable ? { message: "outage" } : null }) }; return query; },
  upsert: (row: { scope_key: string; store_name: string; content: unknown; updated_at: string }) => ({ select: async () => { db.writes++; if (!db.unavailable && !db.unacknowledged) db.rows.set(row.scope_key, JSON.parse(JSON.stringify(row))); return { data: db.unacknowledged ? [] : [{ scope_key: row.scope_key }], error: db.unavailable ? { message: "outage" } : null }; } }),
}) }) }));
import { checkBudget, recordSpend } from "@/domains/decision/llm/adjudicator-budget";
import { callStructuredLLM, type CompleteFn } from "@/domains/decision/llm/structured-drafter";
import { storeCacheImpl, llmCallCacheKey, type CacheImpl, type LlmCallCacheEntry } from "@/domains/decision/llm/call-cache";
import { classifyStore } from "@/lib/persistence/store-classification";
const VALID = { field: "title", before: "Nowruz", after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen",
  rationale: "The current title is one word and misses the customs searchers ask about.",
  evidenceRefs: [{ source: "gsc", detail: "strong impressions for nowruz traditions with a low click rate" }],
  confidence: "high", risks: ["keep the title concise"], operatorSteps: ["Replace the page title field with the new value"],
  proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" },};
const REQ = { kind: "atomic_edit" as const, system: "You improve one on-page field.",
  user: "Page: Nowruz. Field to edit: title. Current title: Nowruz.", grounded: "nowruz traditions persian new year customs haft-seen" };
/** A per-account partitioned cache mirroring storeCacheImpl's isolation, plus call captures so we can assert callStructuredLLM threaded the right account through. */
function partitionedCache() {
  const store = new Map<string, LlmCallCacheEntry[]>();
  const reads: Array<{ tenantId: string; key: string }> = [], recents: Array<{ tenantId: string; kind: string }> = [];
  const impl: CacheImpl = {
    read: async (tenantId, key) => { reads.push({ tenantId, key }); return (store.get(tenantId) ?? []).find((e) => e.key === key) ?? null; },
    write: async (tenantId, entry) => { store.set(tenantId, [...(store.get(tenantId) ?? []).filter((e) => e.key !== entry.key), { ...entry, tenantId }]); },
    recentTexts: async (tenantId, kind) => { recents.push({ tenantId, kind });
      return (store.get(tenantId) ?? []).filter((e) => e.kind === kind && typeof e.primaryText === "string").map((e) => e.primaryText as string); },};
  return { impl, store, reads, recents };}
/** A completion double that replays a value queue and counts calls. A value may carry the provider's usage RECEIPT, which is the only thing that is ever billed. */
const RECEIPT = { tenantId: "provider", responseId: "resp_1", requestedModel: "gpt-5-mini", servedModel: "gpt-5-mini", status: "completed", createdAt: 1, inputTokens: 900, outputTokens: 120, costUsd: 0.0031, retryCount: 0 };
function seam(values: Array<{ value: unknown; provenance?: typeof RECEIPT } | { error: string; retryable: boolean }>) {
  let i = 0, calls = 0;
  const complete: CompleteFn = async () => { calls += 1; return values[Math.min(i++, values.length - 1)]!; };
  return { complete, calls: () => calls }; }
beforeEach(() => {
  (checkBudget as unknown as ReturnType<typeof vi.fn>).mockClear();
  (recordSpend as unknown as ReturnType<typeof vi.fn>).mockClear();
  db.rows.clear(); db.unavailable = false; db.unacknowledged = false; db.writes = 0; });
describe("the call cache is per-account, keyed by account", () => { // ── store classification + key isolation ─────────────────────────────────────
  it("independent durable entries survive concurrent writes, outage and failed acknowledgments without crossing accounts", async () => {
    expect(classifyStore("llm-call-cache")).toBe("per-tenant"); // the store itself is per account, never global
    const entry = { key: "k1", tenantId: "ignored-overwritten", kind: "atomic_edit", promptId: "p",
      promptVersion: 1, value: VALID, primaryText: "A", createdAt: "t", lastUsedAt: "t" } as LlmCallCacheEntry;
    await Promise.all([storeCacheImpl.write("tenant-a", entry), storeCacheImpl.write("tenant-a", { ...entry, key: "k2", primaryText: "B" }), storeCacheImpl.write("tenant-b", entry)]);
    await storeCacheImpl.write("tenant-a", entry); expect(db.rows.size).toBe(3);
    expect((await storeCacheImpl.read("tenant-a", "k1"))?.tenantId).toBe("tenant-a"); expect((await storeCacheImpl.read("tenant-a", "k2"))?.primaryText).toBe("B");
    expect((await storeCacheImpl.read("tenant-b", "k1"))?.tenantId).toBe("tenant-b"); expect(await storeCacheImpl.recentTexts("tenant-a", "atomic_edit", 2)).toEqual(["A", "B"]);
    await expect(storeCacheImpl.read("", "k")).rejects.toThrow(/tenantId is required/); expect(db.writes).toBe(4);
    db.unavailable = true; await expect(storeCacheImpl.read("tenant-a", "k1")).rejects.toThrow(/unavailable/);
    const complete = vi.fn(); const out = await callStructuredLLM({ ...REQ, tenantId: "tenant-a", cacheImpl: storeCacheImpl, complete });
    expect([out.status, out.status === "validation_failed" && out.costUsd, complete.mock.calls.length]).toEqual(["validation_failed", 0, 0]);
    db.unavailable = false; db.unacknowledged = true; await expect(storeCacheImpl.write("tenant-a", entry)).rejects.toThrow(/unacknowledged/); expect(db.rows.size).toBe(3);
    expect((await storeCacheImpl.read("tenant-a", "k2"))?.primaryText).toBe("B"); });
  it("keeps historical blobs read-only while new requests use independent records", async () => {
    const old = { key: "old", tenantId: "historical", kind: "atomic_edit", lastUsedAt: "2026-09-01", primaryText: "Banked words" };
    db.rows.set("llm-call-cache::tenant:historical", { scope_key: "llm-call-cache::tenant:historical", store_name: "llm-call-cache", content: [old], updated_at: old.lastUsedAt });
    expect(await storeCacheImpl.read("historical", "old")).toEqual(old); expect(await storeCacheImpl.recentTexts("historical", "atomic_edit", 2)).toEqual(["Banked words"]); expect(db.writes).toBe(0); expect(db.rows.size).toBe(1); });
  it("request identity changes with tenant, requested model, or server schema", () => {
    const parts = { tenantId: "a", promptId: "p", promptVersion: 1, kind: "atomic_edit", system: "s", user: "u", model: "m1", schema: { minLength: 1 } };
    expect(new Set([llmCallCacheKey(parts), llmCallCacheKey({ ...parts, tenantId: "b" }), llmCallCacheKey({ ...parts, model: "m2" }), llmCallCacheKey({ ...parts, schema: { minLength: 2 } })]).size).toBe(4); expect(llmCallCacheKey(parts)).toBe(llmCallCacheKey({ ...parts })); }); });
describe("callStructuredLLM keeps accounts isolated end to end", () => { // ── callStructuredLLM: end-to-end account isolation ──────────────────────────
  it.each([{}, { ...VALID, after: "[INSERT TITLE]" }, { ...VALID, after: "Nowruz Traditions: 999 Persian New Year Customs" }, { ...VALID, evidenceRefs: [{ source: "clarity", detail: "clicks" }] }])("revalidates banked outputs without deleting or repurchasing invalid work: %j", async (value) => {
    const cache = partitionedCache(); await callStructuredLLM({ ...REQ, tenantId: "revalidation", complete: seam([{ value: VALID }]).complete, cacheImpl: cache.impl });
    const entry = cache.store.get("revalidation")![0]!; entry.value = value; const complete = vi.fn();
    const out = await callStructuredLLM({ ...REQ, tenantId: "revalidation", complete, cacheImpl: cache.impl });
    expect([out.status, out.status === "validation_failed" && out.costUsd, out.status === "validation_failed" && out.attempts, complete.mock.calls.length]).toEqual(["validation_failed", 0, 0, 0]); expect(cache.store.get("revalidation")![0]).toBe(entry); });
  it("reuses validated work with billing credentials off, and refuses a wrong owner without calling a provider", async () => {
    const cache = partitionedCache(); await callStructuredLLM({ ...REQ, tenantId: "off-reuse", complete: seam([{ value: VALID }]).complete, cacheImpl: cache.impl });
    const entry = cache.store.get("off-reuse")![0]!; entry.repeatFlag = "style-caveat"; vi.stubEnv("OPENAI_API_KEY", "");
    try { const out = await callStructuredLLM({ ...REQ, tenantId: "off-reuse", cacheImpl: cache.impl }); expect(out.status === "drafted" && [out.cached, out.costUsd, out.repeatFlag]).toEqual([true, 0, "style-caveat"]);
      entry.tenantId = "other"; const complete = vi.fn(); const refused = await callStructuredLLM({ ...REQ, tenantId: "off-reuse", cacheImpl: cache.impl, complete }); expect(refused.status === "validation_failed" && refused.reason).toBe("cache_identity_mismatch"); expect(complete).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); } });
  it("refuses unavailable history rather than buying with silently reduced context", async () => {
    const complete = vi.fn(), cache = partitionedCache().impl; cache.recentTexts = async () => { throw new Error("outage"); };
    const out = await callStructuredLLM({ ...REQ, tenantId: "history-outage", complete, cacheImpl: cache }); expect(out.status === "validation_failed" && out.reason).toBe("cache_history_unavailable"); expect(complete).not.toHaveBeenCalled(); });
  it("applies the existing answer-completeness check to banked answers without a paid retry", async () => {
    const answer = "Ceremonialcelebrationsandcustomspracticedbyparticipants ".repeat(10).trim(), complete = vi.fn(), cache = partitionedCache().impl; cache.read = async (tenantId, key) => ({ tenantId, key, kind: "answer_block", promptId: "draft.answer_block", promptVersion: 1, createdAt: "2026-09-12", lastUsedAt: "2026-09-12", primaryText: null, value: { ...VALID, answer } });
    const out = await callStructuredLLM({ ...REQ, kind: "answer_block", grounded: answer, tenantId: "thin-bank", complete, cacheImpl: cache }); expect(out.status === "validation_failed" && out.reason).toBe("too_thin_answer"); expect(complete).not.toHaveBeenCalled(); });
  it("account B gets a MISS on account A's byte-identical prompt; A still hits at $0", async () => {
    const cache = partitionedCache();
    const a1 = seam([{ value: VALID, provenance: RECEIPT }]); const outA = await callStructuredLLM({ ...REQ, tenantId: "tenant-a", complete: a1.complete, cacheImpl: cache.impl }); // Account A generates + caches (pays).
    expect([outA.status, a1.calls()]).toEqual(["drafted", 1]);
    const a2 = seam([{ error: "must-not-run", retryable: false }]); const outA2 = await callStructuredLLM({ ...REQ, tenantId: "tenant-a", complete: a2.complete, cacheImpl: cache.impl }); // Account A repeats the SAME prompt: $0 cache hit, no call.
    expect([outA2.status === "drafted" && outA2.cached, outA2.status === "drafted" && outA2.costUsd, a2.calls()]).toEqual([true, 0, 0]);
    const b1 = seam([{ value: VALID }]); const outB = await callStructuredLLM({ ...REQ, tenantId: "tenant-b", complete: b1.complete, cacheImpl: cache.impl }); // Account B, byte-identical prompt: MISS -> it generates its own (would pay).
    expect([outB.status, outB.status === "drafted" && outB.cached, b1.calls()]).toEqual(["drafted", undefined, 1]);
    expect(cache.reads.filter((r) => r.tenantId === "tenant-a").length).toBeGreaterThan(0); // The cache never crossed accounts: A's read keys are all tenant-a, B's tenant-b, and every stored entry records its own owner.
    for (const e of cache.store.get("tenant-a") ?? []) expect(e.tenantId).toBe("tenant-a");
    for (const e of cache.store.get("tenant-b") ?? []) expect(e.tenantId).toBe("tenant-b");
    const aKey = (cache.store.get("tenant-a") ?? [])[0]!.key; expect((cache.store.get("tenant-b") ?? []).some((e: LlmCallCacheEntry) => e.key === aKey)).toBe(false); // Account A's key is absent from account B's partition.
    for (const r of cache.recents) expect(["tenant-a", "tenant-b"]).toContain(r.tenantId); // De-templating asked for the right account every time, and an account that generated nothing sees nothing.
    expect([await cache.impl.recentTexts("tenant-c", "atomic_edit", 5), await cache.impl.recentTexts("tenant-a", "atomic_edit", 5)]).toEqual([[], [VALID.after]]);
    expect(checkBudget).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a" })); // And the money seams were told WHICH account, explicitly, never left to the ambient one.
    expect(recordSpend).toHaveBeenCalledWith(0.0031, expect.objectContaining({ tenantId: "tenant-a" })); expect(recordSpend).toHaveBeenCalledTimes(1); }); // A RECEIPT IS BILLED TO ITS OWN ACCOUNT, and account B's receipt-less attempt is billed to nobody at all: no estimate stands in for a purchase that never happened.
  it("a MISSING account fails closed BEFORE cache, budget, or the completion fn", async () => {
    const cache = partitionedCache(); const s = seam([{ value: VALID }]);
    const out = await callStructuredLLM({ ...REQ, tenantId: "  ", complete: s.complete, cacheImpl: cache.impl });
    expect(out.status).toBe("validation_failed"); // zero calls on all three seams
    expect(out.status === "validation_failed" && out.reason).toBe("missing_tenant"); expect([s.calls(), cache.reads.length]).toEqual([0, 0]);
    expect(checkBudget).not.toHaveBeenCalled(); expect(recordSpend).not.toHaveBeenCalled(); }); });
