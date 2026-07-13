import { describe, expect, it } from "vitest";

import {
  AUTONOMOUS_RETRY_COOLDOWN_MS,
  shouldRunAutonomousResearch,
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
    expect(shouldRunAutonomousResearch(receipt({ ok: false }), NOW)).toBe(false);
    const old = new Date(NOW.getTime() - AUTONOMOUS_RETRY_COOLDOWN_MS - 1).toISOString();
    expect(shouldRunAutonomousResearch(receipt({ ok: false, ran_at: old }), NOW)).toBe(true);
  });

  it("fails open for an unreadable attempt stamp", () => {
    expect(shouldRunAutonomousResearch(receipt({ ok: false, ran_at: "not-a-date" }), NOW)).toBe(true);
  });
});
