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

function defaultCircuitBreakerState(): AutopilotState["circuitBreaker"] {
  return { tripped: false, reason: "", trippedAt: null, sinceIso: null, resumedAt: null };
}

function enabledState(partial: Partial<AutopilotState> = {}): AutopilotState {
  return {
    config: { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true },
    lastRunDay: null,
    receipts: [],
    circuitBreaker: defaultCircuitBreakerState(),
    ...partial,
  };
}

function makeDeps(overrides: Partial<AutopilotRunDeps> = {}): {
  deps: Partial<AutopilotRunDeps>;
  receipts: AutopilotReceipt[];
  markedDays: string[];
  spies: {
    loadCandidates: ReturnType<typeof vi.fn>;
    shipPick: ReturnType<typeof vi.fn>;
    runRevertPass: ReturnType<typeof vi.fn>;
  };
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
  const runRevertPass = vi.fn(async () => ({
    considered: 0,
    autoEligible: 0,
    reverted: 0,
    failed: 0,
    receiptLines: [] as string[],
  }));
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
    runRevertPass,
    today: () => "2026-07-01",
    // Item 80: default to a clean breaker (no settled records, no receipts) so
    // pre-existing ship-loop tests never trip. Tests that exercise the breaker
    // itself override these explicitly.
    loadBreakerProofRecords: async () => [],
    loadBreakerReceipts: async () => [],
    tripBreaker: vi.fn(async () => enabledState()),
    ...overrides,
  };
  return { deps, receipts, markedDays, spies: { loadCandidates, shipPick, runRevertPass } };
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
        circuitBreaker: defaultCircuitBreakerState(),
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

  // ── Item 11: the revert pass rides the nightly pass, after ships ──

  it("item 11: runs the revert pass AFTER the ship pass with the armed config", async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      shipPick: vi.fn(async () => {
        order.push("ship");
        return { ok: true, detail: "ok" };
      }),
      runRevertPass: vi.fn(async (tenantId: string, config: { enabled: boolean }) => {
        order.push("revert");
        expect(tenantId).toBe(TENANT);
        expect(config.enabled).toBe(true);
        return {
          considered: 3,
          autoEligible: 1,
          reverted: 1,
          failed: 0,
          receiptLines: ["That title change hurt the click rate, so I put the old title back on July 2. Lesson: this style of title is not working on pages like this."],
        };
      }),
    });
    const res = await runAutopilotPass(TENANT, NOW, deps);
    expect(order).toEqual(["ship", "revert"]);
    expect(res.revertsConsidered).toBe(3);
    expect(res.reverted).toBe(1);
    expect(res.revertsFailed).toBe(0);
    // Revert lesson lines join the visible receipt trail.
    expect(res.receiptLines.some((l) => l.includes("put the old title back"))).toBe(true);
  });

  it("item 11: a broken revert pass never fails the ship pass it follows", async () => {
    const { deps } = makeDeps({
      runRevertPass: vi.fn(async () => {
        throw new Error("revert pass exploded");
      }),
    });
    const res = await runAutopilotPass(TENANT, NOW, deps);
    expect(res.ran).toBe(true);
    expect(res.reason).toBe("completed");
    expect(res.shipped).toBe(1);
    expect(res.reverted).toBeUndefined();
  });

  it("item 11: the revert pass never runs when publishing is not armed", async () => {
    const { deps, spies } = makeDeps({ getPublishingModeName: async () => "staged" });
    await runAutopilotPass(TENANT, NOW, deps);
    expect(spies.runRevertPass).not.toHaveBeenCalled();
  });

  it("item 11: the revert pass never runs for Ritz", async () => {
    const { deps, spies } = makeDeps();
    await runAutopilotPass("tenant-ritz-founder", NOW, deps);
    expect(spies.runRevertPass).not.toHaveBeenCalled();
  });

  // ── Item 52: per-lever auto policies alongside the proven-lever gate ──

  describe("item 52: per-lever policies", () => {
    function metaCandidate() {
      return [
        {
          editId: "edit-meta-1",
          recId: "rec-meta-1",
          url: "https://example.com/meta-page",
          actionType: "edit_meta",
          title: "Update the search description",
        },
      ];
    }

    it("proven-only: an unproven, unpolicied lever never ships (regression guard)", async () => {
      const { deps, spies } = makeDeps({
        loadCandidates: vi.fn(async () => metaCandidate()),
        loadLeverHistory: async () => [], // no proof history for edit_meta at all
      });
      const res = await runAutopilotPass(TENANT, NOW, deps);
      expect(res.picked).toBe(0);
      expect(spies.shipPick).not.toHaveBeenCalled();
    });

    it("policy-only: an unproven lever ships when the operator turned on auto-ship for it", async () => {
      const { deps, spies } = makeDeps({
        getState: async () =>
          enabledState({
            config: {
              ...DEFAULT_AUTOPILOT_CONFIG,
              enabled: true,
              perLeverPolicies: [{ actionType: "edit_meta", mode: "auto", dailyCap: 2 }],
            },
          }),
        loadCandidates: vi.fn(async () => metaCandidate()),
        loadLeverHistory: async () => [], // still no proof history - policy carries it alone
      });
      const res = await runAutopilotPass(TENANT, NOW, deps);
      expect(res.picked).toBe(1);
      expect(res.shipped).toBe(1);
      expect(spies.shipPick).toHaveBeenCalledTimes(1);
      expect(res.receiptLines[0]).toContain("you turned on auto-ship");
    });

    it("both: a lever that is both proven AND policy-enabled still ships exactly once", async () => {
      const { deps, spies } = makeDeps({
        getState: async () =>
          enabledState({
            config: {
              ...DEFAULT_AUTOPILOT_CONFIG,
              enabled: true,
              perLeverPolicies: [{ actionType: "edit_title", mode: "auto", dailyCap: 2 }],
            },
          }),
        // default loadCandidates ships an edit_title candidate; default
        // loadLeverHistory proves edit_title (12 verdicts, 11 non-regression).
      });
      const res = await runAutopilotPass(TENANT, NOW, deps);
      expect(res.picked).toBe(1);
      expect(res.shipped).toBe(1);
      expect(spies.shipPick).toHaveBeenCalledTimes(1);
    });

    it("daily cap: the per-lever cap blocks further auto-ships of that lever today", async () => {
      const { deps, spies } = makeDeps({
        getState: async () =>
          enabledState({
            config: {
              ...DEFAULT_AUTOPILOT_CONFIG,
              enabled: true,
              weeklyCap: 10,
              perLeverPolicies: [{ actionType: "edit_meta", mode: "auto", dailyCap: 1 }],
            },
            // Already shipped edit_meta once today (Pacific date matches NOW/today()).
            receipts: [
              {
                id: "apr-earlier",
                editId: "edit-earlier",
                url: "https://example.com/other-page",
                actionType: "edit_meta",
                shippedAt: "2026-07-01T10:00:00Z",
                result: "pushed",
                receiptLine: "shipped earlier today",
                detail: "ok",
              },
            ],
          }),
        loadCandidates: vi.fn(async () => metaCandidate()),
        loadLeverHistory: async () => [],
      });
      const res = await runAutopilotPass(TENANT, NOW, deps);
      expect(res.picked).toBe(0);
      expect(spies.shipPick).not.toHaveBeenCalled();
    });

    it("Ritz never ships through a per-lever auto policy (hard-block regression)", async () => {
      const { deps, spies } = makeDeps({
        getState: async () =>
          enabledState({
            config: {
              ...DEFAULT_AUTOPILOT_CONFIG,
              enabled: true,
              perLeverPolicies: [{ actionType: "edit_meta", mode: "auto", dailyCap: 5 }],
            },
          }),
        loadCandidates: vi.fn(async () => metaCandidate()),
      });
      const res = await runAutopilotPass("tenant-ritz-founder", NOW, deps);
      expect(res.ran).toBe(false);
      expect(res.reason).toContain("advise-only");
      expect(spies.shipPick).not.toHaveBeenCalled();
    });

    it("a lever left in review mode never ships even with candidates ready", async () => {
      const { deps, spies } = makeDeps({
        getState: async () =>
          enabledState({
            config: {
              ...DEFAULT_AUTOPILOT_CONFIG,
              enabled: true,
              perLeverPolicies: [{ actionType: "edit_meta", mode: "review", dailyCap: 5 }],
            },
          }),
        loadCandidates: vi.fn(async () => metaCandidate()),
        loadLeverHistory: async () => [],
      });
      const res = await runAutopilotPass(TENANT, NOW, deps);
      expect(res.picked).toBe(0);
      expect(spies.shipPick).not.toHaveBeenCalled();
    });
  });

  // ── Item 80: portfolio circuit breaker pause enforcement ──

  describe("item 80: circuit breaker pause enforcement", () => {
    it("an already-tripped breaker pauses the run before the day marker stamps", async () => {
      const { deps, spies, markedDays } = makeDeps({
        getState: async () =>
          enabledState({
            circuitBreaker: {
              tripped: true,
              reason: "I paused myself. The last two batches measured net negative.",
              trippedAt: isoDaysAgoAP(1),
              sinceIso: isoDaysAgoAP(3),
              resumedAt: null,
            },
          }),
      });
      const res = await runAutopilotPass(TENANT, NOW, deps);
      expect(res.ran).toBe(false);
      expect(res.breakerTripped).toBe(true);
      expect(res.reason).toContain("I paused myself");
      expect(markedDays).toHaveLength(0);
      expect(spies.loadCandidates).not.toHaveBeenCalled();
      expect(spies.shipPick).not.toHaveBeenCalled();
    });

    it("a FRESH trip this run pauses before any ship AND persists the trip", async () => {
      const tripBreaker = vi.fn(async (_args: { reason: string; trippedAt: string; sinceIso: string | null }) =>
        enabledState(),
      );
      // "update_intro" is judged on clicks (not a CTR/position lever), so
      // adjustedLift is the field the breaker reads for this fixture.
      const negativeWindow = { day: 14, ran: true, adjustedLift: -25, adjustedCtrLift: 0, adjustedPosLift: 0 };
      const { deps, spies, markedDays } = makeDeps({
        loadBreakerProofRecords: async () => [
          { id: "a", path: "/a", actionType: "update_intro", shippedAt: isoDaysAgoAP(1), verdict: "lost", windows: [negativeWindow] },
          { id: "b", path: "/b", actionType: "update_intro", shippedAt: isoDaysAgoAP(3), verdict: "lost", windows: [negativeWindow] },
        ],
        tripBreaker,
      });
      const res = await runAutopilotPass(TENANT, NOW, deps);
      expect(res.ran).toBe(false);
      expect(res.breakerTripped).toBe(true);
      expect(res.reason).toContain("I paused myself");
      expect(markedDays).toHaveLength(0);
      expect(spies.loadCandidates).not.toHaveBeenCalled();
      expect(spies.shipPick).not.toHaveBeenCalled();
      expect(tripBreaker).toHaveBeenCalledTimes(1);
      expect(tripBreaker.mock.calls[0]![0].reason).toContain("I paused myself");
    });

    it("a healthy breaker (no negative batches, no rollbacks) never blocks the ship pass", async () => {
      const { deps } = makeDeps({
        loadBreakerProofRecords: async () => [
          {
            id: "a",
            path: "/a",
            actionType: "update_intro",
            shippedAt: isoDaysAgoAP(1),
            verdict: "won",
            windows: [{ day: 14, ran: true, adjustedLift: 10, adjustedCtrLift: 0, adjustedPosLift: 0 }],
          },
        ],
      });
      const res = await runAutopilotPass(TENANT, NOW, deps);
      expect(res.ran).toBe(true);
      expect(res.breakerTripped).toBeUndefined();
      expect(res.shipped).toBe(1);
    });

    it("a breaker LOAD error fails safe: the run keeps going, never pauses", async () => {
      const { deps } = makeDeps({
        loadBreakerProofRecords: async () => {
          throw new Error("boom");
        },
      });
      const res = await runAutopilotPass(TENANT, NOW, deps);
      expect(res.ran).toBe(true);
      expect(res.breakerTripped).toBeUndefined();
      expect(res.shipped).toBe(1);
    });

    it("2 rollback receipts within 7 days pause the run even with healthy ship batches", async () => {
      const { deps, spies } = makeDeps({
        loadBreakerReceipts: async () => [
          { kind: "revert", result: "pushed", shippedAt: isoDaysAgoAP(1) },
          { kind: "revert", result: "pushed", shippedAt: isoDaysAgoAP(4) },
        ],
      });
      const res = await runAutopilotPass(TENANT, NOW, deps);
      expect(res.ran).toBe(false);
      expect(res.breakerTripped).toBe(true);
      expect(res.reason).toContain("2");
      expect(spies.shipPick).not.toHaveBeenCalled();
    });
  });
});

function isoDaysAgoAP(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
