import { describe, expect, it } from "vitest";

import {
  AUTONOMOUS_RUN_DEADLINE_MS,
  AUTONOMOUS_RETRY_COOLDOWN_MS,
  shouldRunAutonomousResearch,
  startedReceipt,
  timedOutReceipt,
} from "./on-visit-refresh";
import type { WarmRunReceipt } from "./warm-receipt-store";

const NOW = new Date("2026-07-09T12:00:00.000Z");

function receipt(partial: Partial<WarmRunReceipt> = {}): WarmRunReceipt {
  return {
    tenant_id: "tenant-iranopedia",
    date: "2026-07-09",
    ran_at: "2026-07-09T11:00:00.000Z",
    ok: true,
    totalMs: 100,
    trigger: "visit",
    steps: [],
    ...partial,
  };
}

describe("shouldRunAutonomousResearch", () => {
  it("runs on the first visit and once on a new Pacific day", () => {
    expect(shouldRunAutonomousResearch(null, NOW)).toBe(true);
    expect(shouldRunAutonomousResearch(receipt({ date: "2026-07-08" }), NOW)).toBe(true);
  });

  it("does not repeat a successful same-day research cycle", () => {
    expect(shouldRunAutonomousResearch(receipt(), NOW)).toBe(false);
  });

  it("throttles a running or failed attempt, then permits a safe retry", () => {
    const recent = new Date(NOW.getTime() - AUTONOMOUS_RETRY_COOLDOWN_MS / 2).toISOString();
    expect(shouldRunAutonomousResearch(receipt({ ok: false, ran_at: recent }), NOW)).toBe(false);
    const old = new Date(NOW.getTime() - AUTONOMOUS_RETRY_COOLDOWN_MS - 1).toISOString();
    expect(shouldRunAutonomousResearch(receipt({ ok: false, ran_at: old }), NOW)).toBe(true);
  });

  it("fails open for an unreadable attempt stamp", () => {
    expect(shouldRunAutonomousResearch(receipt({ ok: false, ran_at: "not-a-date" }), NOW)).toBe(true);
  });

  it("turns a continuation deadline into a terminal retryable receipt", () => {
    const result = timedOutReceipt("tenant-iranopedia", NOW);
    expect(result.ok).toBe(false);
    expect(result.totalMs).toBe(AUTONOMOUS_RUN_DEADLINE_MS);
    expect(result.steps[0]?.note).toContain("continue from cached work automatically");
    expect(result.steps[0]?.note).not.toContain("next navigation");
    expect(result.steps[0]?.note).not.toContain("running");
  });

  it("keeps the last completed outcome visible while refreshing or after a timeout", () => {
    const prior = receipt({
      summary: { readyToReview: 7 } as WarmRunReceipt["summary"],
      pipeline: {
        version: 1,
        completedStages: ["baseline", "graph"],
        nextStage: "competitors",
        updatedAt: NOW.toISOString(),
      },
    });
    expect(startedReceipt("tenant-iranopedia", NOW, prior).summary?.readyToReview).toBe(7);
    expect(timedOutReceipt("tenant-iranopedia", NOW, prior).summary?.readyToReview).toBe(7);
    expect(timedOutReceipt("tenant-iranopedia", NOW, prior).pipeline?.nextStage).toBe("competitors");
  });
});
