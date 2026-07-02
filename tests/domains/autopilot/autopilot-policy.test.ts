/**
 * Trust-budget autopilot policy (2026-07-01, BEACON 500 item 1).
 *
 * Pins the pure decision layer:
 *   - disarmed (config absent or disabled) ships NOTHING,
 *   - Ritz is excluded even with a perfect record,
 *   - a lever below the verdict-count or non-regression thresholds never ships,
 *   - the weekly cap is respected (including already-used budget),
 *   - one change per page per night,
 *   - the allowlist restricts levers when set,
 *   - reasons/receipts carry concrete numbers and NO em/en dashes.
 */

import { describe, it, expect } from "vitest";

import {
  AUTOPILOT_RITZ_TENANT_ID,
  DEFAULT_AUTOPILOT_CONFIG,
  computeLeverRecords,
  decideAutopilotShips,
  leverIsProven,
  leverLabel,
  normalizeAutopilotConfig,
  type AutopilotCandidate,
  type AutopilotConfig,
  type LeverRecord,
} from "@/domains/autopilot/autopilot-policy";
import { RITZ_TENANT_ID } from "@/domains/push/push-service";

const TENANT = "tenant-iranopedia";

function cfg(partial: Partial<AutopilotConfig> = {}): AutopilotConfig {
  return { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true, ...partial };
}

function candidate(partial: Partial<AutopilotCandidate> = {}): AutopilotCandidate {
  return {
    editId: "edit-1",
    recId: "rec-1",
    url: "https://example.com/page-a",
    actionType: "edit_title",
    title: "Update the page title",
    ...partial,
  };
}

/** A proven edit_title record: 12 decided, 11 did not hurt (92 percent). */
const PROVEN_TITLE: LeverRecord = { actionType: "edit_title", decided: 12, nonRegression: 11 };

describe("computeLeverRecords", () => {
  it("counts only decided verdicts and splits non-regression correctly", () => {
    const records = computeLeverRecords([
      { actionType: "edit_title", verdict: "won" },
      { actionType: "edit_title", verdict: "inconclusive" },
      { actionType: "edit_title", verdict: "lost" },
      { actionType: "edit_title", verdict: "measuring" },
      { actionType: "edit_title", verdict: "insufficient_data" },
      { actionType: "edit_meta", verdict: "won" },
      { actionType: "", verdict: "won" },
    ]);
    const title = records.find((r) => r.actionType === "edit_title");
    expect(title).toEqual({ actionType: "edit_title", decided: 3, nonRegression: 2 });
    const meta = records.find((r) => r.actionType === "edit_meta");
    expect(meta).toEqual({ actionType: "edit_meta", decided: 1, nonRegression: 1 });
    expect(records.some((r) => r.actionType === "")).toBe(false);
  });
});

describe("leverIsProven", () => {
  it("requires the verdict count AND the non-regression rate", () => {
    const c = cfg();
    expect(leverIsProven(PROVEN_TITLE, c)).toBe(true);
    expect(leverIsProven({ actionType: "x", decided: 9, nonRegression: 9 }, c)).toBe(false);
    expect(leverIsProven({ actionType: "x", decided: 10, nonRegression: 7 }, c)).toBe(false);
    expect(leverIsProven({ actionType: "x", decided: 10, nonRegression: 8 }, c)).toBe(true);
    expect(leverIsProven(undefined, c)).toBe(false);
  });
});

describe("decideAutopilotShips", () => {
  it("happy path: a proven lever ships with a numbered reason and receipt", () => {
    const decision = decideAutopilotShips({
      tenantId: TENANT,
      config: cfg(),
      leverRecords: [PROVEN_TITLE],
      autoShippedThisWeek: 0,
      candidates: [candidate()],
    });
    expect(decision.mode).toBe("active");
    expect(decision.picks).toHaveLength(1);
    expect(decision.skips).toHaveLength(0);
    expect(decision.remainingBudget).toBe(2);
    const pick = decision.picks[0]!;
    expect(pick.reason).toContain("12 measured results");
    expect(pick.reason).toContain("11 of 12");
    expect(pick.reason).toContain("1 of 3 this week");
    expect(pick.receiptLine).toContain("automatically");
    expect(pick.receiptLine).toContain("11 of 12");
    expect(pick.receiptLine).toContain("reversible");
  });

  it("disarmed: a null or disabled config ships nothing", () => {
    for (const config of [null, undefined, cfg({ enabled: false })]) {
      const decision = decideAutopilotShips({
        tenantId: TENANT,
        config,
        leverRecords: [PROVEN_TITLE],
        autoShippedThisWeek: 0,
        candidates: [candidate()],
      });
      expect(decision.mode).toBe("off");
      expect(decision.picks).toHaveLength(0);
    }
  });

  it("Ritz is excluded even with a perfect record and an enabled config", () => {
    const decision = decideAutopilotShips({
      tenantId: AUTOPILOT_RITZ_TENANT_ID,
      config: cfg(),
      leverRecords: [PROVEN_TITLE],
      autoShippedThisWeek: 0,
      candidates: [candidate()],
    });
    expect(decision.mode).toBe("blocked");
    expect(decision.picks).toHaveLength(0);
  });

  it("the local Ritz constant stays aligned with the push service's", () => {
    expect(AUTOPILOT_RITZ_TENANT_ID).toBe(RITZ_TENANT_ID);
  });

  it("below-threshold lever: too few verdicts is skipped with the counts", () => {
    const decision = decideAutopilotShips({
      tenantId: TENANT,
      config: cfg(),
      leverRecords: [{ actionType: "edit_title", decided: 4, nonRegression: 4 }],
      autoShippedThisWeek: 0,
      candidates: [candidate()],
    });
    expect(decision.picks).toHaveLength(0);
    expect(decision.skips).toHaveLength(1);
    expect(decision.skips[0]!.reason).toContain("4 measured results");
    expect(decision.skips[0]!.reason).toContain("10");
  });

  it("below-threshold lever: enough verdicts but a weak record is skipped", () => {
    const decision = decideAutopilotShips({
      tenantId: TENANT,
      config: cfg(),
      leverRecords: [{ actionType: "edit_title", decided: 10, nonRegression: 7 }],
      autoShippedThisWeek: 0,
      candidates: [candidate()],
    });
    expect(decision.picks).toHaveLength(0);
    expect(decision.skips[0]!.reason).toContain("only 7 did not hurt");
    expect(decision.skips[0]!.reason).toContain("70 percent");
  });

  it("a lever with NO history at all is skipped", () => {
    const decision = decideAutopilotShips({
      tenantId: TENANT,
      config: cfg(),
      leverRecords: [],
      autoShippedThisWeek: 0,
      candidates: [candidate()],
    });
    expect(decision.picks).toHaveLength(0);
    expect(decision.skips[0]!.reason).toContain("0 measured results");
  });

  it("weekly cap already reached: everything is skipped", () => {
    const decision = decideAutopilotShips({
      tenantId: TENANT,
      config: cfg({ weeklyCap: 3 }),
      leverRecords: [PROVEN_TITLE],
      autoShippedThisWeek: 3,
      candidates: [candidate(), candidate({ editId: "edit-2", url: "https://example.com/b" })],
    });
    expect(decision.mode).toBe("active");
    expect(decision.picks).toHaveLength(0);
    expect(decision.skips).toHaveLength(2);
    expect(decision.skips[0]!.reason).toContain("weekly budget of 3");
    expect(decision.remainingBudget).toBe(0);
  });

  it("partial budget: picks stop exactly at the remaining slots", () => {
    const decision = decideAutopilotShips({
      tenantId: TENANT,
      config: cfg({ weeklyCap: 3 }),
      leverRecords: [PROVEN_TITLE],
      autoShippedThisWeek: 2,
      candidates: [
        candidate({ editId: "e1", url: "https://example.com/a" }),
        candidate({ editId: "e2", url: "https://example.com/b" }),
      ],
    });
    expect(decision.picks).toHaveLength(1);
    expect(decision.skips).toHaveLength(1);
    expect(decision.picks[0]!.reason).toContain("3 of 3 this week");
    expect(decision.remainingBudget).toBe(0);
  });

  it("one change per page per night: a second candidate on the same URL is skipped", () => {
    const decision = decideAutopilotShips({
      tenantId: TENANT,
      config: cfg(),
      leverRecords: [
        PROVEN_TITLE,
        { actionType: "edit_meta", decided: 10, nonRegression: 10 },
      ],
      autoShippedThisWeek: 0,
      candidates: [
        candidate({ editId: "e1", actionType: "edit_title", url: "https://example.com/a/" }),
        candidate({ editId: "e2", actionType: "edit_meta", url: "https://example.com/a" }),
      ],
    });
    expect(decision.picks).toHaveLength(1);
    expect(decision.skips).toHaveLength(1);
    expect(decision.skips[0]!.reason).toContain("this page");
  });

  it("allowlist: levers outside the list never ship, even when proven", () => {
    const decision = decideAutopilotShips({
      tenantId: TENANT,
      config: cfg({ leverAllowlist: ["add_answer_block"] }),
      leverRecords: [PROVEN_TITLE],
      autoShippedThisWeek: 0,
      candidates: [candidate()],
    });
    expect(decision.picks).toHaveLength(0);
    expect(decision.skips[0]!.reason).toContain("allowed list");
  });

  it("emits NO em or en dashes in any operator-facing string", () => {
    const decision = decideAutopilotShips({
      tenantId: TENANT,
      config: cfg({ weeklyCap: 1 }),
      leverRecords: [
        PROVEN_TITLE,
        { actionType: "edit_meta", decided: 10, nonRegression: 7 },
      ],
      autoShippedThisWeek: 0,
      candidates: [
        candidate({ editId: "e1", actionType: "edit_title" }),
        candidate({ editId: "e2", actionType: "edit_meta", url: "https://example.com/b" }),
        candidate({ editId: "e3", actionType: "add_faq", url: "https://example.com/c" }),
      ],
    });
    const all = [
      ...decision.picks.map((p) => `${p.reason} ${p.receiptLine}`),
      ...decision.skips.map((s) => s.reason),
    ].join(" ");
    expect(all).not.toMatch(/[\u2013\u2014]/);
    // No lab words on operator surfaces either.
    expect(all.toLowerCase()).not.toContain("experiment");
    expect(all.toLowerCase()).not.toContain("baseline");
    expect(all.toLowerCase()).not.toContain("treatment");
  });
});

describe("normalizeAutopilotConfig", () => {
  it("defaults to DISABLED and clamps every numeric field", () => {
    expect(normalizeAutopilotConfig(null)).toEqual(DEFAULT_AUTOPILOT_CONFIG);
    const clamped = normalizeAutopilotConfig({
      enabled: true,
      weeklyCap: 999,
      minVerdicts: -5,
      minNonRegressionRate: 7,
      leverAllowlist: ["edit_title", "", "  "],
    });
    expect(clamped.enabled).toBe(true);
    expect(clamped.weeklyCap).toBe(10);
    expect(clamped.minVerdicts).toBe(1);
    expect(clamped.minNonRegressionRate).toBe(1);
    expect(clamped.leverAllowlist).toEqual(["edit_title"]);
  });

  it("anything not explicitly enabled stays off", () => {
    expect(normalizeAutopilotConfig({ enabled: undefined }).enabled).toBe(false);
    expect(normalizeAutopilotConfig({}).enabled).toBe(false);
  });
});

describe("leverLabel", () => {
  it("maps known levers to plain language and humanizes unknowns", () => {
    expect(leverLabel("edit_title")).toBe("Page title updates");
    expect(leverLabel("add_answer_block")).toBe("Direct answer sections");
    expect(leverLabel("some_new_lever")).toBe("Some new lever");
  });
});
