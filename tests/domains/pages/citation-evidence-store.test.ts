/**
 * Phase 7.8e-4a (2026-04-26) — citation-evidence-store request-scope getter.
 *
 * Pins the lazy-load + refresh contract:
 *   - First call hydrates from disk via readDotDataJson.
 *   - Subsequent calls reuse the cached value (no re-read).
 *   - refreshCitationEvidenceStore() invalidates and re-reads.
 *   - undefined sentinel = "not loaded yet"; null = "loaded, no data".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const readMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/dotdata-json", () => ({
  readDotDataJson: readMock,
}));

describe("citation-evidence-store — Phase 7.8e-4a request-scope getter", () => {
  beforeEach(async () => {
    vi.resetModules();
    readMock.mockReset();
  });

  it("first call hydrates from disk", async () => {
    readMock.mockResolvedValueOnce({ built_at: "2026-04-26T00:00:00Z", by_page_and_topic: [], by_topic: [], total_citations_processed: 0 });
    const mod = await import("@/domains/pages/citation-evidence-store");
    mod._resetCitationEvidenceForTests();
    const idx = await mod.getCitationEvidenceIndex();
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(idx?.built_at).toBe("2026-04-26T00:00:00Z");
  });

  it("subsequent calls reuse the cached value (no re-read)", async () => {
    readMock.mockResolvedValueOnce({ built_at: "x", by_page_and_topic: [], by_topic: [], total_citations_processed: 0 });
    const mod = await import("@/domains/pages/citation-evidence-store");
    mod._resetCitationEvidenceForTests();
    await mod.getCitationEvidenceIndex();
    await mod.getCitationEvidenceIndex();
    await mod.getCitationEvidenceIndex();
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when disk has no index, and caches the null result", async () => {
    readMock.mockResolvedValueOnce(null);
    const mod = await import("@/domains/pages/citation-evidence-store");
    mod._resetCitationEvidenceForTests();
    const a = await mod.getCitationEvidenceIndex();
    const b = await mod.getCitationEvidenceIndex();
    expect(a).toBeNull();
    expect(b).toBeNull();
    // Important: null is a valid loaded state (sentinel is undefined for
    // not-loaded). One read, not two.
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it("refreshCitationEvidenceStore() reloads from disk", async () => {
    readMock
      .mockResolvedValueOnce({ built_at: "first", by_page_and_topic: [], by_topic: [], total_citations_processed: 0 })
      .mockResolvedValueOnce({ built_at: "second", by_page_and_topic: [], by_topic: [], total_citations_processed: 0 });
    const mod = await import("@/domains/pages/citation-evidence-store");
    mod._resetCitationEvidenceForTests();
    const first = await mod.getCitationEvidenceIndex();
    expect(first?.built_at).toBe("first");
    await mod.refreshCitationEvidenceStore();
    const second = await mod.getCitationEvidenceIndex();
    expect(second?.built_at).toBe("second");
    expect(readMock).toHaveBeenCalledTimes(2);
  });
});
