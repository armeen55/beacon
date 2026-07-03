import { describe, it, expect } from "vitest";
import {
  llmCallCacheKey,
  upsertAndPrune,
  resolveCacheImpl,
  LLM_CALL_CACHE_MAX_ENTRIES,
  type LlmCallCacheEntry,
  type CacheImpl,
} from "./call-cache";

function entry(key: string, lastUsedAt: string, kind = "answer_block"): LlmCallCacheEntry {
  return {
    key,
    kind,
    promptId: "draft.answer_block",
    promptVersion: 1,
    value: { answer: key },
    primaryText: key,
    createdAt: lastUsedAt,
    lastUsedAt,
  };
}

describe("call-cache - content hashing", () => {
  it("is deterministic for identical inputs", () => {
    const parts = { promptId: "draft.answer_block", promptVersion: 1, kind: "answer_block", system: "s", user: "u" };
    expect(llmCallCacheKey(parts)).toBe(llmCallCacheKey({ ...parts }));
  });

  it("changes when ANY input changes - including the prompt VERSION (a bumped prompt never serves stale output)", () => {
    const base = { promptId: "draft.answer_block", promptVersion: 1, kind: "answer_block", system: "s", user: "u" };
    const baseKey = llmCallCacheKey(base);
    expect(llmCallCacheKey({ ...base, promptVersion: 2 })).not.toBe(baseKey);
    expect(llmCallCacheKey({ ...base, system: "s2" })).not.toBe(baseKey);
    expect(llmCallCacheKey({ ...base, user: "u2" })).not.toBe(baseKey);
    expect(llmCallCacheKey({ ...base, kind: "atomic_edit" })).not.toBe(baseKey);
  });
});

describe("call-cache - LRU-ish prune", () => {
  it("replaces an existing key in place (no duplicates)", () => {
    const rows = [entry("a", "2026-07-01T00:00:00Z"), entry("b", "2026-07-02T00:00:00Z")];
    const out = upsertAndPrune(rows, entry("a", "2026-07-03T00:00:00Z"));
    expect(out).toHaveLength(2);
    expect(out.filter((r) => r.key === "a")).toHaveLength(1);
    expect(out[0]!.key).toBe("a"); // newest lastUsedAt first
  });

  it("caps at the max by last-used time, evicting the coldest entries", () => {
    const rows = Array.from({ length: LLM_CALL_CACHE_MAX_ENTRIES }, (_, i) =>
      entry(`k${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()),
    );
    const fresh = entry("fresh", "2026-07-03T00:00:00Z");
    const out = upsertAndPrune(rows, fresh);
    expect(out).toHaveLength(LLM_CALL_CACHE_MAX_ENTRIES);
    expect(out[0]!.key).toBe("fresh");
    // The coldest row (k0) fell off.
    expect(out.some((r) => r.key === "k0")).toBe(false);
  });
});

describe("call-cache - vitest hermetics", () => {
  it("returns NO cache under vitest without injection (pinned suites never touch the store)", () => {
    expect(resolveCacheImpl()).toBeNull();
  });

  it("returns the injected impl verbatim", () => {
    const impl: CacheImpl = {
      read: async () => null,
      write: async () => {},
      recentTexts: async () => [],
    };
    expect(resolveCacheImpl(impl)).toBe(impl);
  });
});
