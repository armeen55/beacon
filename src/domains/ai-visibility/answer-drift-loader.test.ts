import { describe, it, expect } from "vitest";
import { scanAnswerDrift, loadRecentDriftEvents } from "./answer-drift-loader";

/**
 * These tests run without Supabase credentials configured (the CI-equivalent clean
 * shell per project convention), so isSupabaseConfigured() is false and every read
 * fails soft to []. This exercises exactly the "poll history too shallow to compare
 * yet" honesty contract: no tenant, no config, no crash, no fabricated events.
 */
describe("scanAnswerDrift (fail-soft, no Supabase configured in this test env)", () => {
  it("returns an empty result with zeroed coverage for an unknown tenant", async () => {
    const result = await scanAnswerDrift("tenant-does-not-exist");
    expect(result.events).toEqual([]);
    expect(result.coverage).toEqual({ pairsWithHistory: 0, pairsComparable: 0, observationsConsidered: 0 });
  });

  it("returns an empty result for an empty tenantId (never throws)", async () => {
    const result = await scanAnswerDrift("");
    expect(result.events).toEqual([]);
  });

  it("never throws even when called concurrently", async () => {
    await expect(Promise.all([scanAnswerDrift("tenant-a"), scanAnswerDrift("tenant-b")])).resolves.toBeDefined();
  });
});

describe("loadRecentDriftEvents", () => {
  it("returns [] when nothing is comparable yet", async () => {
    const events = await loadRecentDriftEvents("tenant-does-not-exist");
    expect(events).toEqual([]);
  });

  it("respects the limit parameter shape (no crash on a small limit)", async () => {
    const events = await loadRecentDriftEvents("tenant-does-not-exist", 1);
    expect(events.length).toBeLessThanOrEqual(1);
  });
});
