/**
 * Autopilot settings server actions (2026-07-02, BEACON 500 item 52 additions).
 *
 * Pins the per-lever policy actions on top of the item 1 baseline:
 *   - loadAutopilotSettings surfaces per-lever policy rows + triage suggestions,
 *   - setLeverPolicy is the ONLY path that turns a lever's mode to "auto" and
 *     is permission-gated + Ritz-blocked the same way setAutopilotEnabled is,
 *   - enableTriageSuggestion is a thin wrapper - a suggestion never enables
 *     itself; only this explicit call does,
 *   - setLeverPolicyToReview always succeeds in putting a lever back to review,
 *   - setLeverPolicyDailyCap refuses a lever with no policy row yet,
 *   - no operator-facing string here uses an em or en dash.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AutopilotConfig } from "@/domains/autopilot/autopilot-policy";

const mem = vi.hoisted(() => ({
  canPublish: true,
  tenantId: "tenant-iranopedia",
  publishingMode: "armed" as string,
  config: {
    enabled: true,
    weeklyCap: 3,
    minVerdicts: 10,
    minNonRegressionRate: 0.8,
    leverAllowlist: null,
    perLeverPolicies: null,
  } as AutopilotConfig,
  receipts: [] as Array<{
    id: string;
    editId: string;
    url: string;
    actionType: string;
    shippedAt: string;
    result: "pushed" | "failed";
    receiptLine: string;
    detail: string;
    kind?: "ship" | "revert";
  }>,
  triageSuggestions: [] as Array<{ actionType: string; label: string; evidenceLine: string }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => mem.tenantId),
}));
vi.mock("@/lib/auth/can-publish", () => ({
  canPublishForCurrentTenant: vi.fn(async () => mem.canPublish),
}));
vi.mock("@/domains/push/publishing-mode-store", () => ({
  getPublishingMode: vi.fn(async () => ({ mode: mem.publishingMode })),
}));
vi.mock("@/domains/proof-gsc/shipped-change-store", () => ({
  loadShippedChanges: vi.fn(async () => []),
}));
vi.mock("@/domains/autopilot/triage-feed", () => ({
  loadTriageSuggestions: vi.fn(async () => mem.triageSuggestions),
}));

// The real autopilot-store module, but backed by an in-memory state instead
// of json-store, so config mutations round-trip exactly like production.
vi.mock("@/domains/autopilot/autopilot-store", async () => {
  const policyMod = await vi.importActual<typeof import("@/domains/autopilot/autopilot-policy")>(
    "@/domains/autopilot/autopilot-policy",
  );
  return {
    getAutopilotState: vi.fn(async () => ({
      config: policyMod.normalizeAutopilotConfig(mem.config),
      lastRunDay: null,
      receipts: mem.receipts,
    })),
    updateAutopilotConfig: vi.fn(async (patch: Partial<typeof mem.config>) => {
      mem.config = policyMod.normalizeAutopilotConfig({ ...mem.config, ...patch });
      return mem.config;
    }),
    countAutoShippedInLastDays: vi.fn(() => 0),
    countAutoShippedTodayByLever: vi.fn(() => ({}) as Record<string, number>),
  };
});

import {
  enableTriageSuggestion,
  loadAutopilotSettings,
  setLeverPolicy,
  setLeverPolicyDailyCap,
  setLeverPolicyToReview,
  setPrepareAheadOvernight,
} from "@/app/(shell)/settings/connectors/autopilot-actions";

beforeEach(() => {
  mem.canPublish = true;
  mem.tenantId = "tenant-iranopedia";
  mem.publishingMode = "armed";
  mem.config = {
    enabled: true,
    weeklyCap: 3,
    minVerdicts: 10,
    minNonRegressionRate: 0.8,
    leverAllowlist: null,
    perLeverPolicies: null,
  };
  mem.receipts = [];
  mem.triageSuggestions = [];
});

describe("loadAutopilotSettings - item 52 fields", () => {
  it("surfaces per-lever policy rows with plain labels", async () => {
    mem.config.perLeverPolicies = [{ actionType: "edit_meta", mode: "auto", dailyCap: 2 }];
    const view = await loadAutopilotSettings();
    expect(view.perLeverPolicies).toHaveLength(1);
    expect(view.perLeverPolicies[0]).toMatchObject({
      actionType: "edit_meta",
      mode: "auto",
      dailyCap: 2,
      shippedToday: 0,
    });
    expect(view.perLeverPolicies[0]!.label).not.toBe("");
  });

  it("surfaces triage suggestions from the bridge untouched", async () => {
    mem.triageSuggestions = [
      { actionType: "edit_meta", label: "Search description updates", evidenceLine: "test" },
    ];
    const view = await loadAutopilotSettings();
    expect(view.triageSuggestions).toEqual(mem.triageSuggestions);
  });

  it("no per-lever policy is the default (additive, old state parses)", async () => {
    const view = await loadAutopilotSettings();
    expect(view.perLeverPolicies).toEqual([]);
  });
});

describe("setLeverPolicy", () => {
  it("refuses without publish permission", async () => {
    mem.canPublish = false;
    const res = await setLeverPolicy({ actionType: "edit_meta", mode: "auto" });
    expect(res.ok).toBe(false);
  });

  it("refuses to arm auto mode for the Ritz tenant", async () => {
    mem.tenantId = "tenant-ritz-founder";
    const res = await setLeverPolicy({ actionType: "edit_meta", mode: "auto" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("advice only");
  });

  it("still allows setting Ritz to review (never blocks the safer direction)", async () => {
    mem.tenantId = "tenant-ritz-founder";
    const res = await setLeverPolicy({ actionType: "edit_meta", mode: "review" });
    expect(res.ok).toBe(true);
  });

  it("sets a lever to auto with a daily cap and it round-trips", async () => {
    const res = await setLeverPolicy({ actionType: "edit_meta", mode: "auto", dailyCap: 4 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config.perLeverPolicies).toEqual([{ actionType: "edit_meta", mode: "auto", dailyCap: 4 }]);
    }
  });

  it("updating one lever never disturbs another lever's policy", async () => {
    mem.config.perLeverPolicies = [{ actionType: "edit_title", mode: "auto", dailyCap: 1 }];
    const res = await setLeverPolicy({ actionType: "edit_meta", mode: "auto", dailyCap: 2 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config.perLeverPolicies).toEqual(
        expect.arrayContaining([
          { actionType: "edit_title", mode: "auto", dailyCap: 1 },
          { actionType: "edit_meta", mode: "auto", dailyCap: 2 },
        ]),
      );
    }
  });
});

describe("enableTriageSuggestion", () => {
  it("is the single click that turns a suggestion into an auto policy", async () => {
    const res = await enableTriageSuggestion({ actionType: "edit_meta", dailyCap: 1 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config.perLeverPolicies).toEqual([{ actionType: "edit_meta", mode: "auto", dailyCap: 1 }]);
    }
  });

  it("never runs on its own - loading settings alone never enables anything", async () => {
    mem.triageSuggestions = [
      { actionType: "edit_meta", label: "Search description updates", evidenceLine: "evidence" },
    ];
    await loadAutopilotSettings();
    expect(mem.config.perLeverPolicies).toBeNull();
  });
});

describe("setLeverPolicyToReview", () => {
  it("puts an auto lever back to review, keeping its daily cap", async () => {
    mem.config.perLeverPolicies = [{ actionType: "edit_meta", mode: "auto", dailyCap: 3 }];
    const res = await setLeverPolicyToReview({ actionType: "edit_meta" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config.perLeverPolicies).toEqual([{ actionType: "edit_meta", mode: "review", dailyCap: 3 }]);
    }
  });
});

describe("setLeverPolicyDailyCap", () => {
  it("refuses a lever with no existing policy row", async () => {
    const res = await setLeverPolicyDailyCap({ actionType: "edit_meta", dailyCap: 5 });
    expect(res.ok).toBe(false);
  });

  it("updates the cap for an existing policy row", async () => {
    mem.config.perLeverPolicies = [{ actionType: "edit_meta", mode: "auto", dailyCap: 1 }];
    const res = await setLeverPolicyDailyCap({ actionType: "edit_meta", dailyCap: 5 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config.perLeverPolicies).toEqual([{ actionType: "edit_meta", mode: "auto", dailyCap: 5 }]);
    }
  });

  it("rejects a non-finite cap with a plain message", async () => {
    const res = await setLeverPolicyDailyCap({ actionType: "edit_meta", dailyCap: NaN });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("setPrepareAheadOvernight (R20 - prepare-ahead, distinct from publish autopilot)", () => {
  it("refuses without publish permission", async () => {
    mem.canPublish = false;
    const res = await setPrepareAheadOvernight({ enabled: true });
    expect(res.ok).toBe(false);
  });

  it("turns prepare-ahead ON without requiring publishing to be armed (it never publishes)", async () => {
    mem.publishingMode = "staged"; // one-click publishing is NOT armed
    const res = await setPrepareAheadOvernight({ enabled: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.prepareAheadOvernight).toBe(true);
    // Publish-autopilot's own switch is untouched by prepare-ahead - they never couple.
    expect(mem.config.enabled).toBe(true);
  });

  it("is allowed on the advise-only Ritz tenant (prepare-ahead can never write to the site)", async () => {
    mem.tenantId = "tenant-ritz-founder";
    const res = await setPrepareAheadOvernight({ enabled: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.prepareAheadOvernight).toBe(true);
  });

  it("turns prepare-ahead back off in one click and it round-trips", async () => {
    mem.config.prepareAheadOvernight = true;
    const res = await setPrepareAheadOvernight({ enabled: false });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.prepareAheadOvernight).toBe(false);
  });

  it("loadAutopilotSettings surfaces the prepare-ahead flag", async () => {
    mem.config.prepareAheadOvernight = true;
    const view = await loadAutopilotSettings();
    expect(view.prepareAheadOvernight).toBe(true);
  });
});

describe("dash guard - no em or en dash in any operator-facing reason", () => {
  it("checks every failure/refusal reason across the item 52 actions", async () => {
    mem.canPublish = false;
    const r1 = await setLeverPolicy({ actionType: "edit_meta", mode: "auto" });
    const r2 = await setLeverPolicyDailyCap({ actionType: "edit_meta", dailyCap: 1 });
    mem.canPublish = true;
    mem.tenantId = "tenant-ritz-founder";
    const r3 = await setLeverPolicy({ actionType: "edit_meta", mode: "auto" });
    const reasons = [r1, r2, r3].filter((r) => !r.ok).map((r) => (r as { reason: string }).reason);
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(reason).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
