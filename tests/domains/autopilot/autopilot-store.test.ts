/**
 * Trust-budget autopilot state store (2026-07-01, BEACON 500 item 1).
 *
 * Pins the SAFETY-CRITICAL posture over a mocked json-store:
 *   - default (no record / read error) = DISABLED config (losing the store
 *     can only ever disarm autopilot, never arm it),
 *   - config round-trips with clamping (weekly cap bounded 1..10),
 *   - the daily-run marker round-trips,
 *   - receipts prepend newest-first and stay bounded,
 *   - the weekly counter counts only PUSHED receipts inside the window.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mem = vi.hoisted(() => ({
  rows: null as unknown[] | null,
  failReads: false,
}));

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(async () => {
    if (mem.failReads) throw new Error("boom");
    return mem.rows ?? [];
  }),
  writeStore: vi.fn(async (_name: string, data: unknown[]) => {
    mem.rows = data;
  }),
}));

import {
  appendAutopilotReceipt,
  countAutoShippedInLastDays,
  countAutoShippedTodayByLever,
  getAutopilotConfig,
  getAutopilotState,
  markAutopilotRunDay,
  updateAutopilotConfig,
  type AutopilotReceipt,
} from "@/domains/autopilot/autopilot-store";
import { DEFAULT_AUTOPILOT_CONFIG } from "@/domains/autopilot/autopilot-policy";

const NOW = new Date("2026-07-01T12:00:00Z");

function receipt(partial: Partial<AutopilotReceipt> = {}): AutopilotReceipt {
  return {
    id: "apr-1",
    editId: "edit-1",
    url: "https://example.com/a",
    actionType: "edit_title",
    shippedAt: NOW.toISOString(),
    result: "pushed",
    receiptLine: "I shipped this automatically under your proven-change budget.",
    detail: "ok",
    ...partial,
  };
}

beforeEach(() => {
  mem.rows = null;
  mem.failReads = false;
});

describe("autopilot-store", () => {
  it("defaults to the DISABLED config when nothing is stored", async () => {
    const state = await getAutopilotState();
    expect(state.config).toEqual(DEFAULT_AUTOPILOT_CONFIG);
    expect(state.config.enabled).toBe(false);
    expect(state.lastRunDay).toBeNull();
    expect(state.receipts).toEqual([]);
  });

  it("fails SOFT to disabled on a read error (never arms by accident)", async () => {
    mem.failReads = true;
    const config = await getAutopilotConfig();
    expect(config.enabled).toBe(false);
  });

  it("round-trips a config update with clamping", async () => {
    const updated = await updateAutopilotConfig({ enabled: true, weeklyCap: 99 });
    expect(updated.enabled).toBe(true);
    expect(updated.weeklyCap).toBe(10);
    const readBack = await getAutopilotConfig();
    expect(readBack.enabled).toBe(true);
    expect(readBack.weeklyCap).toBe(10);
    // Untouched thresholds keep their defaults.
    expect(readBack.minVerdicts).toBe(10);
    expect(readBack.minNonRegressionRate).toBe(0.8);
  });

  it("a partial update preserves the rest of the config and the receipts", async () => {
    await updateAutopilotConfig({ enabled: true, weeklyCap: 5 });
    await appendAutopilotReceipt(receipt());
    const after = await updateAutopilotConfig({ weeklyCap: 2 });
    expect(after.enabled).toBe(true);
    expect(after.weeklyCap).toBe(2);
    const state = await getAutopilotState();
    expect(state.receipts).toHaveLength(1);
  });

  it("stamps and round-trips the daily-run marker", async () => {
    await markAutopilotRunDay("2026-07-01");
    const state = await getAutopilotState();
    expect(state.lastRunDay).toBe("2026-07-01");
  });

  it("prepends receipts newest-first", async () => {
    await appendAutopilotReceipt(receipt({ id: "apr-old" }));
    await appendAutopilotReceipt(receipt({ id: "apr-new" }));
    const state = await getAutopilotState();
    expect(state.receipts.map((r) => r.id)).toEqual(["apr-new", "apr-old"]);
  });

  it("counts only pushed receipts inside the trailing 7 days", () => {
    const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const state = {
      receipts: [
        receipt({ id: "a", shippedAt: twoDaysAgo, result: "pushed" as const }),
        receipt({ id: "b", shippedAt: twoDaysAgo, result: "failed" as const }),
        receipt({ id: "c", shippedAt: eightDaysAgo, result: "pushed" as const }),
        receipt({ id: "d", shippedAt: "not-a-date", result: "pushed" as const }),
      ],
    };
    expect(countAutoShippedInLastDays(state, NOW)).toBe(1);
  });

  it("item 11: revert receipts never consume the weekly SHIP budget", () => {
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const state = {
      receipts: [
        receipt({ id: "ship", shippedAt: twoDaysAgo, result: "pushed" as const }),
        receipt({ id: "legacy-no-kind", shippedAt: twoDaysAgo, result: "pushed" as const }),
        receipt({
          id: "revert",
          shippedAt: twoDaysAgo,
          result: "pushed" as const,
          kind: "revert" as const,
          actionType: "revert_edit_title",
        }),
      ],
    };
    // Legacy receipts (no kind) still count as ships; reverts never do.
    expect(countAutoShippedInLastDays(state, NOW)).toBe(2);
  });

  // ── Item 52: per-lever daily counter ──

  describe("countAutoShippedTodayByLever", () => {
    it("counts pushed receipts by lever for the given Pacific day only", () => {
      const state = {
        receipts: [
          receipt({ id: "a", actionType: "edit_meta", shippedAt: "2026-07-01T12:00:00Z" }),
          receipt({ id: "b", actionType: "edit_meta", shippedAt: "2026-07-01T18:00:00Z" }),
          receipt({ id: "c", actionType: "edit_title", shippedAt: "2026-07-01T12:00:00Z" }),
          receipt({ id: "d", actionType: "edit_meta", shippedAt: "2026-06-30T12:00:00Z" }),
        ],
      };
      expect(countAutoShippedTodayByLever(state, "2026-07-01")).toEqual({
        edit_meta: 2,
        edit_title: 1,
      });
    });

    it("excludes failed receipts and revert receipts", () => {
      const state = {
        receipts: [
          receipt({ id: "a", actionType: "edit_meta", result: "failed" as const }),
          receipt({ id: "b", actionType: "edit_meta", kind: "revert" as const }),
        ],
      };
      expect(countAutoShippedTodayByLever(state, "2026-07-01")).toEqual({});
    });

    it("a Pacific-boundary timestamp is bucketed by Pacific date, not UTC date", () => {
      // 2026-07-02T06:30:00Z is still 2026-07-01 in Los Angeles (UTC-7 in July).
      const state = {
        receipts: [receipt({ id: "a", actionType: "edit_meta", shippedAt: "2026-07-02T06:30:00Z" })],
      };
      expect(countAutoShippedTodayByLever(state, "2026-07-01")).toEqual({ edit_meta: 1 });
      expect(countAutoShippedTodayByLever(state, "2026-07-02")).toEqual({});
    });

    it("returns an empty object for no receipts", () => {
      expect(countAutoShippedTodayByLever({ receipts: [] }, "2026-07-01")).toEqual({});
    });
  });
});
