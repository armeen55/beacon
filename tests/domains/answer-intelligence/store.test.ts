/**
 * Phase 7.8e-4b (2026-04-26) — answer-intelligence store request-scope getter.
 *
 * Pins the lazy-load + refresh contract:
 *   - First call hydrates from disk via readDotDataJson.
 *   - Subsequent calls reuse the cached value (no re-read).
 *   - refreshAnswerIntelligenceStore() reloads from disk.
 *   - undefined sentinel = "not loaded yet"; null = "loaded, no data".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const readMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/dotdata-json", () => ({
  readDotDataJson: readMock,
}));

const stubIndex = (built_at: string) => ({
  built_at,
  brand_positioning: [],
  co_citation: {
    competitors: [],
    by_topic: [],
    total_answers_with_owned: 0,
    total_answers_without_owned: 0,
  },
  // Other AnswerIntelligenceIndex fields intentionally omitted — the getter
  // returns whatever readDotDataJson resolves with; type-safety is enforced
  // at the consumer call sites.
});

describe("answer-intelligence store — Phase 7.8e-4b request-scope getter", () => {
  beforeEach(async () => {
    vi.resetModules();
    readMock.mockReset();
  });

  it("first call hydrates from disk", async () => {
    readMock.mockResolvedValueOnce(stubIndex("2026-04-26T00:00:00Z"));
    const mod = await import("@/domains/answer-intelligence/store");
    mod._resetAnswerIntelligenceForTests();
    const idx = await mod.getAnswerIntelligenceIndex();
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(idx?.built_at).toBe("2026-04-26T00:00:00Z");
  });

  it("subsequent calls reuse the cached value (no re-read)", async () => {
    readMock.mockResolvedValueOnce(stubIndex("x"));
    const mod = await import("@/domains/answer-intelligence/store");
    mod._resetAnswerIntelligenceForTests();
    await mod.getAnswerIntelligenceIndex();
    await mod.getAnswerIntelligenceIndex();
    await mod.getAnswerIntelligenceIndex();
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when disk has no index, and caches the null result", async () => {
    readMock.mockResolvedValueOnce(null);
    const mod = await import("@/domains/answer-intelligence/store");
    mod._resetAnswerIntelligenceForTests();
    const a = await mod.getAnswerIntelligenceIndex();
    const b = await mod.getAnswerIntelligenceIndex();
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it("refreshAnswerIntelligenceStore() reloads from disk", async () => {
    readMock
      .mockResolvedValueOnce(stubIndex("first"))
      .mockResolvedValueOnce(stubIndex("second"));
    const mod = await import("@/domains/answer-intelligence/store");
    mod._resetAnswerIntelligenceForTests();
    const first = await mod.getAnswerIntelligenceIndex();
    expect(first?.built_at).toBe("first");
    await mod.refreshAnswerIntelligenceStore();
    const second = await mod.getAnswerIntelligenceIndex();
    expect(second?.built_at).toBe("second");
    expect(readMock).toHaveBeenCalledTimes(2);
  });
});
