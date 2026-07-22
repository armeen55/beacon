/**
 * W2 (2026-07-10) - item 15: EVERY writer that changes the visible /changes list must
 * invalidate the tenant-scoped SWR snapshot. markChangelogEditShipped flips a change to
 * shipped but previously only called revalidatePath("/changes") (Next route cache), NOT
 * invalidateChangesSurface - so the ranked list served the pre-ship state for up to the
 * 15-min TTL. This pins that a successful ship invalidates the changes surface, matching
 * the changes-surface-store contract and every other ship path (the shipped-change choke
 * point). A no-op flip (nothing accepted) must NOT invalidate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-a" }));
const _canPublish = vi.fn(async () => true);
vi.mock("@/lib/auth/can-publish", () => ({
  canPublishForCurrentTenant: () => _canPublish(),
}));

const _repo = {
  getChangelogEntries: vi.fn(async () => [{ id: "cl1" }]),
  getRecommendedEdits: vi.fn(async () => [{ id: "e1" }]),
};
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({ forTenant: () => _repo }),
}));

vi.mock("@/domains/attribution/lifecycle-classification", () => ({
  changelogJoinKey: () => "join-key-1",
  indexEditsByJoinKey: () => new Map([["join-key-1", { id: "e1" }]]),
}));

let _status = "accepted";
const _markShipped = vi.fn(async (..._a: unknown[]) => ({ flipped: 1, skipped: 0 }));
vi.mock("@/domains/recommendations/recommended-edits-persistence", () => ({
  editLifecycleStatus: () => _status,
  markRecommendedEditsAsShipped: (...a: unknown[]) => _markShipped(...a),
}));

// Imported by the actions module but not exercised here.
vi.mock("@/app/(shell)/changes-data", () => ({ loadChangesView: async () => ({ movesById: {} }) }));

const _invalidate = vi.fn(async () => {});
vi.mock("@/app/(shell)/surface-release", () => ({
  invalidateCoreSurfaces: () => _invalidate(),
}));

import { markChangelogEditShipped } from "@/app/(shell)/changes/actions";

beforeEach(() => {
  _status = "accepted";
  _markShipped.mockReset();
  _markShipped.mockResolvedValue({ flipped: 1, skipped: 0 });
  _invalidate.mockClear();
  _canPublish.mockReset();
  _canPublish.mockResolvedValue(true);
});

describe("markChangelogEditShipped - invalidates the /changes snapshot (item 15)", () => {
  it("a successful ship invalidates the changes surface snapshot", async () => {
    const r = await markChangelogEditShipped({ changelogId: "cl1" });
    expect(r.success).toBe(true);
    expect(r.flipped).toBe(1);
    expect(_invalidate).toHaveBeenCalledTimes(1);
  });

  it("does NOT invalidate when nothing actually flipped (already past accepted)", async () => {
    _status = "verified_live"; // not "accepted" -> early return, no flip
    const r = await markChangelogEditShipped({ changelogId: "cl1" });
    expect(r.success).toBe(true);
    expect(r.flipped ?? 0).toBe(0);
    expect(_invalidate).not.toHaveBeenCalled();
  });

  it("refuses before any lifecycle read or write when tenant publish authority is absent", async () => {
    _canPublish.mockResolvedValue(false);
    _repo.getChangelogEntries.mockClear();
    _repo.getRecommendedEdits.mockClear();
    const r = await markChangelogEditShipped({ changelogId: "cl1" });
    expect(r).toEqual({
      success: false,
      error: "You do not have permission to mark this change live.",
    });
    expect(_repo.getChangelogEntries).not.toHaveBeenCalled();
    expect(_repo.getRecommendedEdits).not.toHaveBeenCalled();
    expect(_markShipped).not.toHaveBeenCalled();
  });
});
