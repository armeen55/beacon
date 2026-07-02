/**
 * BEACON_500 item 15 (2026-07-02): server-action gating for "Stage in Wix".
 * The actions are THIN: operator gate -> delegate to stageChangeForRecord ->
 * revalidate on success. These tests pin the gate, the delegation payload
 * (tenant NEVER from client input), and the fail-closed error shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const _revalidated: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    _revalidated.push(p);
  },
}));

let _operator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: async () => _operator,
}));

const _stageCalls: unknown[] = [];
let _stageResult: { staged: boolean; receiptLine: string; reason?: string } = {
  staged: true,
  receiptLine: "Staged in Wix at 2:14am. I saved the old version first; one click restores it.",
};
let _stageThrows = false;
vi.mock("@/domains/push/stage-change", () => ({
  stageChangeForRecord: async (input: unknown) => {
    _stageCalls.push(input);
    if (_stageThrows) throw new Error("substrate down");
    return _stageResult;
  },
}));

import { stageDailyPickInWixAction, stageMoveInWixAction } from "./stage-in-wix-actions";

beforeEach(() => {
  _operator = true;
  _stageCalls.length = 0;
  _revalidated.length = 0;
  _stageThrows = false;
  _stageResult = {
    staged: true,
    receiptLine: "Staged in Wix at 2:14am. I saved the old version first; one click restores it.",
  };
});

describe("stage-in-wix actions - operator gate", () => {
  it("daily: refuses without operator mode and NEVER reaches the staging entry point", async () => {
    _operator = false;
    const r = await stageDailyPickInWixAction({ planId: "p", experimentId: "e" });
    expect(r.staged).toBe(false);
    expect(r.receiptLine).toContain("copy and paste");
    expect(_stageCalls).toHaveLength(0);
    expect(_revalidated).toHaveLength(0);
  });

  it("move: refuses without operator mode and NEVER reaches the staging entry point", async () => {
    _operator = false;
    const r = await stageMoveInWixAction({ moveId: "rec-1" });
    expect(r.staged).toBe(false);
    expect(_stageCalls).toHaveLength(0);
  });
});

describe("stage-in-wix actions - delegation + receipts", () => {
  it("daily: delegates ids + the operator's edited text (tenant never from the client)", async () => {
    const r = await stageDailyPickInWixAction({ planId: "p1", experimentId: "e1", editedText: "tweak" });
    expect(r.staged).toBe(true);
    expect(_stageCalls[0]).toEqual({ kind: "daily_pick", planId: "p1", experimentId: "e1", editedText: "tweak" });
    expect(JSON.stringify(_stageCalls[0])).not.toContain("tenant");
    expect(_revalidated).toContain("/worklist");
  });

  it("move: delegates the move id and revalidates the queue surfaces on success", async () => {
    const r = await stageMoveInWixAction({ moveId: "rec-9" });
    expect(r.staged).toBe(true);
    expect(_stageCalls[0]).toEqual({ kind: "move", moveId: "rec-9" });
    expect(_revalidated).toEqual(expect.arrayContaining(["/worklist", "/recommendations"]));
  });

  it("a not-staged receipt passes through untouched and revalidates NOTHING", async () => {
    _stageResult = { staged: false, receiptLine: "I could not stage this one in Wix, so copy and paste it yourself.", reason: "not_armed" };
    const r = await stageDailyPickInWixAction({ planId: "p1", experimentId: "e1" });
    expect(r).toEqual(_stageResult);
    expect(_revalidated).toHaveLength(0);
  });

  it("a thrown error fails closed to the paste instruction (never an unhandled rejection)", async () => {
    _stageThrows = true;
    const r = await stageMoveInWixAction({ moveId: "rec-1" });
    expect(r.staged).toBe(false);
    expect(r.receiptLine).toContain("copy and paste it yourself");
    expect(r.reason).toContain("substrate down");
  });
});
