import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/operator-mode", () => ({ isOperatorModeServer: vi.fn(async () => true) }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: vi.fn(async () => "tenant-iranopedia") }));
vi.mock("@/domains/proof-gsc/auto-record-on-ship", () => ({
  autoRecordShippedChangeForRec: vi.fn(async () => ({ recorded: true, reason: "recorded" })),
}));
vi.mock("@/domains/demand-graph/move-draft-store", () => ({ saveMoveDraft: vi.fn(async () => {}) }));

import { markPlanAppliedAction, captureProofAction } from "./execution-actions";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { autoRecordShippedChangeForRec } from "@/domains/proof-gsc/auto-record-on-ship";
import { saveMoveDraft } from "@/domains/demand-graph/move-draft-store";

const base = {
  implementationPlanId: "m1:edit_title",
  moveId: "m1",
  targetUrl: "https://iranopedia.com/iran-flags",
  actionType: "edit_title",
  query: "iran flag",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isOperatorModeServer).mockResolvedValue(true);
});

describe("markPlanAppliedAction — operator confirmation is REQUIRED (fail closed)", () => {
  it("rejects when confirmedApplied is false — never assumes applied", async () => {
    const r = await markPlanAppliedAction({ ...base, confirmedApplied: false });
    expect(r.ok).toBe(false);
    expect(autoRecordShippedChangeForRec).not.toHaveBeenCalled(); // measurement NOT started
  });

  it("rejects when not in operator mode", async () => {
    vi.mocked(isOperatorModeServer).mockResolvedValue(false);
    const r = await markPlanAppliedAction({ ...base, confirmedApplied: true });
    expect(r.ok).toBe(false);
    expect(autoRecordShippedChangeForRec).not.toHaveBeenCalled();
  });

  it("rejects when target URL is missing", async () => {
    const r = await markPlanAppliedAction({ ...base, targetUrl: "", confirmedApplied: true });
    expect(r.ok).toBe(false);
    expect(autoRecordShippedChangeForRec).not.toHaveBeenCalled();
  });

  it("on explicit confirmation → records proof (starts measurement) + returns appliedAt", async () => {
    const r = await markPlanAppliedAction({ ...base, confirmedApplied: true, notes: "tightened title" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recorded).toBe(true);
      expect(typeof r.appliedAt).toBe("string");
    }
    expect(autoRecordShippedChangeForRec).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(autoRecordShippedChangeForRec).mock.calls[0][0];
    // J-73/C-25 (2026-07-09): "confirmed applied" no longer asserts verified —
    // only a real crawl of arg.pageUrl (run inside autoRecordShippedChangeForRec,
    // with this SAME explicit tenantId) may mark the record verified live.
    expect(arg.verifiedLive).toBeUndefined();
    expect(arg.tenantId).toBe("tenant-iranopedia");
    expect(arg.pageUrl).toBe(base.targetUrl);
    // durable audit of the applied plan
    expect(saveMoveDraft).toHaveBeenCalled();
  });
});

describe("captureProofAction — manual proof note persists (5F)", () => {
  it("persists a typed proof note (rollback/visibility fields)", async () => {
    const r = await captureProofAction({
      moveId: "m1",
      targetUrl: base.targetUrl,
      liveUrlChecked: base.targetUrl,
      visibleLive: true,
      rollbackNeeded: false,
      beforeText: "old title",
      afterText: "new title",
      notes: "looks good",
    });
    expect(r.ok).toBe(true);
    expect(saveMoveDraft).toHaveBeenCalledTimes(1);
    const [, , kind, content] = vi.mocked(saveMoveDraft).mock.calls[0];
    expect(kind).toBe("proof_capture");
    const parsed = JSON.parse(content as string);
    expect(parsed.rollbackNeeded).toBe(false);
    expect(parsed.visibleLive).toBe(true);
    expect(parsed.beforeText).toBe("old title");
  });
});

describe("no Wix publish / no live-CMS path (structural)", () => {
  it("execution modules do not import the Wix push/publish path", () => {
    const root = join(__dirname, "../../..");
    const files = [
      "src/app/(shell)/execution-actions.ts",
      "src/domains/execution/implementation-plan.ts",
      "src/domains/execution/location-resolver.ts",
      "src/app/(shell)/execution-data.ts",
    ];
    for (const f of files) {
      const src = readFileSync(join(root, f), "utf-8");
      expect(src).not.toMatch(/push-service|wixUpdate|publishApproved|executePush|wix\/client/);
    }
  });
});
