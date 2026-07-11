/**
 * recommendation-actions (P2-e, 2026-07-10 visual audit) - respondToRecommendation must
 * invalidate the /changes SWR snapshot (changes-surface-store.ts) on every response
 * (accepted/dismissed/deferred), the same fire-and-forget pattern opportunity-actions.ts and
 * today-moves-actions.ts already use. Before this fix, revalidatePath("/", "layout") only busted
 * Next's route cache; the app-level SWR snapshot could keep serving a dismissed/accepted change
 * for up to its own 15-minute staleness window (CHANGES_SURFACE_FRESH_MS).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const recordResponse = vi.fn();
const persistResponses = vi.fn().mockResolvedValue(undefined);
const ensureRecommendationResponsesSeeded = vi.fn().mockResolvedValue(undefined);
const currentTenantId = vi.fn().mockResolvedValue("tenant-x");
const autoRecordShippedChangeForRec = vi.fn().mockResolvedValue({ recorded: false, reason: "no_target" });
const invalidateChangesSurface = vi.fn().mockResolvedValue(undefined);
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("@/domains/product/recommendation-response-store", () => ({
  recordResponse: (...args: unknown[]) => recordResponse(...args),
  persistResponses: (...args: unknown[]) => persistResponses(...args),
  ensureRecommendationResponsesSeeded: () => ensureRecommendationResponsesSeeded(),
}));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: () => currentTenantId() }));
vi.mock("@/domains/proof-gsc/auto-record-on-ship", () => ({
  autoRecordShippedChangeForRec: (...args: unknown[]) => autoRecordShippedChangeForRec(...args),
}));
vi.mock("./changes-surface-store", () => ({
  invalidateChangesSurface: () => invalidateChangesSurface(),
}));

import { respondToRecommendation } from "./recommendation-actions";

describe("respondToRecommendation - P2-e invalidates the /changes SWR surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistResponses.mockResolvedValue(undefined);
    ensureRecommendationResponsesSeeded.mockResolvedValue(undefined);
    currentTenantId.mockResolvedValue("tenant-x");
    autoRecordShippedChangeForRec.mockResolvedValue({ recorded: false, reason: "no_target" });
    invalidateChangesSurface.mockResolvedValue(undefined);
  });

  it("invalidates the changes surface on dismiss (dismissed)", async () => {
    await respondToRecommendation("rec-1", "dismissed");
    expect(invalidateChangesSurface).toHaveBeenCalledTimes(1);
  });

  it("invalidates the changes surface on defer (deferred)", async () => {
    await respondToRecommendation("rec-1", "deferred");
    expect(invalidateChangesSurface).toHaveBeenCalledTimes(1);
  });

  it("invalidates the changes surface on accept (accepted), alongside the existing ship->proof bridge", async () => {
    await respondToRecommendation("rec-1", "accepted", { targetPageUrl: "https://s.com/p", actionType: "edit_meta", query: "q" });
    expect(invalidateChangesSurface).toHaveBeenCalledTimes(1);
    expect(autoRecordShippedChangeForRec).toHaveBeenCalledTimes(1);
  });

  it("still persists the response and revalidates the layout regardless (no regression to the existing write path)", async () => {
    await respondToRecommendation("rec-1", "accepted");
    expect(persistResponses).toHaveBeenCalledWith("tenant-x");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("a failed invalidation never breaks the response (fail-soft, matches the .catch(() => {}) convention)", async () => {
    invalidateChangesSurface.mockRejectedValueOnce(new Error("store down"));
    const result = await respondToRecommendation("rec-1", "dismissed");
    expect(result.success).toBe(true);
  });
});
