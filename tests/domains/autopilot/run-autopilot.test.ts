/**
 * Trust-budget autopilot runner (2026-07-01, BEACON 500 item 1).
 *
 * Pins the guard order and the ship loop with injected deps (no real push,
 * no Supabase, no filesystem):
 *   - Ritz is refused before ANYTHING loads,
 *   - an ambient-tenant mismatch skips (cross-tenant safety),
 *   - disabled config = instant no-op (no candidate load),
 *   - the daily marker makes the pass idempotent per day,
 *   - one-click publishing must be armed and the target must be wix_cms,
 *   - a successful run stamps the day BEFORE shipping and writes a receipt
 *     per pick (pushed AND failed).
 */

import { describe, it, expect, vi } from "vitest";

import {
  runAutopilotPass,
  type AutopilotRunDeps,
} from "@/domains/autopilot/run-autopilot";
import { DEFAULT_AUTOPILOT_CONFIG } from "@/domains/autopilot/autopilot-policy";
import type { AutopilotState, AutopilotReceipt } from "@/domains/autopilot/autopilot-store";

const TENANT = "tenant-iranopedia";
const NOW = new Date("2026-07-01T09:00:00Z");

function enabledState(partial: Partial<AutopilotState> = {}): AutopilotState {
  return {
    config: { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true },
    lastRunDay: null,
    receipts: [],
    ...partial,
  };
}

function makeDeps(overrides: Partial<AutopilotRunDeps> = {}): {
  deps: Partial<AutopilotRunDeps>;
  receipts: AutopilotReceipt[];
  markedDays: string[];
  spies: { loadCandidates: ReturnType<typeof vi.fn>; shipPick: ReturnType<typeof vi.fn> };
} {
  const receipts: AutopilotReceipt[] = [];
  const markedDays: string[] = [];
  const loadCandidates = vi.fn(async () => [
    {
      editId: "edit-1",
      recId: "rec-1",
      url: "https://example.com/a",
      actionType: "edit_title",
      title: "Update the title",
    },
  ]);
  const shipPick = vi.fn(async () => ({ ok: true, detail: "updated field title" }));
  const deps: Partial<AutopilotRunDeps> = {
    ambientTenantId: async () => TENANT,
    getState: async () => enabledState(),
    markRunDay: async (day: string) => {
      markedDays.push(day);
      return enabledState({ lastRunDay: day });
    },
    appendReceipt: async (r: AutopilotReceipt) => {
      receipts.push(r);
    },
    getPublishingModeName: async () => "armed",
    getPublishTarget: async () => "wix_cms",
    loadLeverHistory: async () =>
      Array.from({ length: 12 }, (_, i) => ({
        actionType: "edit_title",
        verdict: i === 0 ? "lost" : "won",
      })),
    loadCandidates,
    shipPick,
    today: () => "2026-07-01",
    ...overrides,
  };
  return { deps, receipts, markedDays, spies: { loadCandidates, shipPick } };
}

describe("runAutopilotPass", () => {
  it("refuses Ritz before loading anything", async () => {
    const { deps, spies } = makeDeps();
    const getState = vi.fn(async () => enabledState());
    const res = await runAutopilotPass("tenant-ritz-founder", NOW, { ...deps, getState });
    expect(res.ran).toBe(false);
    expect(res.reason).toContain("advise-only");
    expect(getState).not.toHaveBeenCalled();
    expect(spies.loadCandidates).not.toHaveBeenCalled();
  });

  it("skips when the ambient tenant does not match (cross-tenant safety)", async () => {
    const { deps, spies } = makeDeps({ ambientTenantId: async () => "tenant-other" });
    const res = await runAutopilotPass(TENANT, NOW, deps);
    expect(res.ran).toBe(false);
    expect(res.reason).toContain("skipped");
    expect(spies.loadCandidates).not.toHaveBeenCalled();
  });

  it("disabled config is an instant no-op (default OFF posture)", async () => {
    const { deps, spies, markedDays } = makeDeps({
      getState: async () => ({
        config: { ...DEFAULT_AUTOPILOT_CONFIG },
        lastRunDay: null,
        receipts: [],
      }),
    });
    const res = await runAutopilotPass(TENANT, NOW, deps);
    expect(res.ran).toBe(false);
    expect(res.reason).toContain("off");
    expect(spies.loadCandidates).not.toHaveBeenCalled();
    expect(markedDays).toHaveLength(0);
  });

  it("is idempotent per day: an already-stamped day no-ops", async () => {
    const { deps, spies } = makeDeps({
      getState: async () => enabledState({ lastRunDay: "2026-07-01" }),
    });
    const res = await runAutopilotPass(TENANT, NOW, deps);
    expect(res.ran).toBe(false);
    expect(res.reason).toContain("already ran today");
    expect(spies.shipPick).not.toHaveBeenCalled();
  });

  it("requires one-click publishing to be armed", async () => {
    const { deps, spies } = makeDeps({ getPublishingModeName: async () => "staged" });
    const res = await runAutopilotPass(TENANT, NOW, deps);
    expect(res.ran).toBe(false);
    expect(res.reason).toContain("one-click publishing is off");
    expect(spies.loadCandidates).not.toHaveBeenCalled();
  });

  it("requires a live wix_cms publish target", async () => {
    const { deps, spies } = makeDeps({ getPublishTarget: async () => "dev_note" });
    const res = await runAutopilotPass(TENANT, NOW, deps);
    expect(res.ran).toBe(false);
    expect(res.reason).toContain("no live publishing connection");
    expect(spies.shipPick).not.toHaveBeenCalled();
  });

  it("happy path: stamps the day, ships the pick, writes a pushed receipt", async () => {
    const { deps, receipts, markedDays, spies } = makeDeps();
    const res = await runAutopilotPass(TENANT, NOW, deps);
    expect(res.ran).toBe(true);
    expect(res.reason).toBe("completed");
    expect(res.considered).toBe(1);
    expect(res.picked).toBe(1);
    expect(res.shipped).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.receiptLines).toHaveLength(1);
    expect(res.receiptLines[0]).toContain("automatically");
    expect(markedDays).toEqual(["2026-07-01"]);
    expect(spies.shipPick).toHaveBeenCalledTimes(1);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.result).toBe("pushed");
    expect(receipts[0]!.editId).toBe("edit-1");
    expect(receipts[0]!.receiptLine).not.toMatch(/[\u2013\u2014]/);
  });

  it("weekly budget already used: runs, picks nothing, ships nothing", async () => {
    const old = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const used: AutopilotReceipt[] = Array.from({ length: 3 }, (_, i) => ({
      id: `apr-${i}`,
      editId: `e-${i}`,
      url: "https://example.com/x",
      actionType: "edit_title",
      shippedAt: old,
      result: "pushed",
      receiptLine: "shipped",
      detail: "ok",
    }));
    const { deps, spies } = makeDeps({
      getState: async () => enabledState({ receipts: used }),
    });
    const res = await runAutopilotPass(TENANT, NOW, deps);
    expect(res.ran).toBe(true);
    expect(res.picked).toBe(0);
    expect(res.shipped).toBe(0);
    expect(spies.shipPick).not.toHaveBeenCalled();
  });

  it("a refused push records a FAILED receipt and never counts as shipped", async () => {
    const { deps, receipts } = makeDeps({
      shipPick: vi.fn(async () => ({ ok: false, detail: "daily cap reached" })),
    });
    const res = await runAutopilotPass(TENANT, NOW, deps);
    expect(res.ran).toBe(true);
    expect(res.picked).toBe(1);
    expect(res.shipped).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.receiptLines).toHaveLength(0);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.result).toBe("failed");
    expect(receipts[0]!.receiptLine).toContain("stopped");
    expect(receipts[0]!.detail).toContain("daily cap reached");
  });

  it("an unproven lever is considered but not picked", async () => {
    const { deps, spies } = makeDeps({
      loadLeverHistory: async () => [
        { actionType: "edit_title", verdict: "won" },
        { actionType: "edit_title", verdict: "won" },
      ],
    });
    const res = await runAutopilotPass(TENANT, NOW, deps);
    expect(res.ran).toBe(true);
    expect(res.considered).toBe(1);
    expect(res.picked).toBe(0);
    expect(spies.shipPick).not.toHaveBeenCalled();
  });
});
