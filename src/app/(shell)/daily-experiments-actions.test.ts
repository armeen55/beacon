import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getPlan: vi.fn(),
  updateItemExecution: vi.fn(),
  listActiveReservations: vi.fn(),
  activateItemViaRpc: vi.fn(),
  verifyExperimentLive: vi.fn(),
  recordShippedChange: vi.fn(),
  recordToRow: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./today-surface-store", () => ({
  invalidateTodaySurface: vi.fn(async () => undefined),
}));
vi.mock("@/lib/operator-mode", () => ({ isOperatorModeServer: vi.fn(async () => true) }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: vi.fn(async () => "tenant-1") }));
vi.mock("@/domains/proof-gsc/load-ledger", () => ({ loadProofLedger: vi.fn(async () => []) }));
vi.mock("@/domains/experiments/experiment-eligibility", () => ({
  GSC_LAG_DAYS: 3,
  deriveExperimentStates: vi.fn(() => new Map()),
}));
vi.mock("@/domains/experiments/build-today-preview", () => ({ buildTodayExperimentPreview: vi.fn() }));
vi.mock("@/domains/experiments/validate-plan-acceptance", () => ({ validatePlanAcceptance: vi.fn() }));
vi.mock("@/domains/experiments/daily-experiment-plan-store", () => ({
  createPreviewPlan: vi.fn(),
  getPlan: h.getPlan,
  expirePlans: vi.fn(),
  abandonPreviewPlan: vi.fn(),
  acceptPlanViaRpc: vi.fn(),
  listActiveReservations: h.listActiveReservations,
  activateItemViaRpc: h.activateItemViaRpc,
  skipItemViaRpc: vi.fn(),
  updateItemExecution: h.updateItemExecution,
  completePlan: vi.fn(),
  listReservationsForPlan: vi.fn(),
}));
vi.mock("@/domains/proof-gsc/run-measurement", () => ({ recordShippedChange: h.recordShippedChange }));
vi.mock("@/domains/proof-gsc/shipped-change-store", () => ({
  recordToRow: h.recordToRow,
  markRecrawlRequestedById: vi.fn(),
}));
vi.mock("@/domains/experiments/live-verification", () => ({ verifyExperimentLive: h.verifyExperimentLive }));
vi.mock("@/domains/experiments/execution-checklist", () => ({ buildExecutionChecklist: vi.fn() }));

import { markDailyExperimentAppliedAction } from "./daily-experiments-actions";

describe("markDailyExperimentAppliedAction edited-text parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getPlan.mockResolvedValue({
      id: "plan-1",
      tenantId: "tenant-1",
      status: "accepted",
      selected: [
        {
          id: "experiment-1",
          lever: "title",
          url: "https://example.com/page",
          canonicalUrl: "https://example.com/page",
          currentText: "Old title",
          proposedText: "Frozen proposal",
          targetQuery: "example query",
          controls: [
            { controlPath: "/control-a", controlUrl: "https://example.com/control-a" },
            { controlPath: "/control-b", controlUrl: "https://example.com/control-b" },
          ],
        },
      ],
    });
    h.updateItemExecution.mockResolvedValue(undefined);
    h.listActiveReservations.mockResolvedValue([]);
    h.verifyExperimentLive.mockResolvedValue({
      verified: true,
      observedAt: "2026-07-16T19:00:00.000Z",
      observedValue: "Operator wording",
      unchangedChecks: [],
      receipt: {
        verifiedAt: "2026-07-16T19:00:00.000Z",
        method: "title_exact",
        observedValue: "Operator wording",
        source: "https://example.com/page",
      },
    });
    h.recordShippedChange.mockResolvedValue({ id: "proof-1" });
    h.recordToRow.mockReturnValue({ id: "proof-1" });
    h.activateItemViaRpc.mockResolvedValue({
      ok: true,
      idempotent: false,
      proofId: "proof-1",
      reservationIds: ["r1", "r2"],
    });
  });

  it("verifies and records the same edited wording that staging receives", async () => {
    const result = await markDailyExperimentAppliedAction({
      planId: "plan-1",
      experimentId: "experiment-1",
      idempotencyKey: "apply-1",
      editedText: "  Operator wording  ",
    });

    expect(result).toMatchObject({ ok: true });
    expect(h.verifyExperimentLive).toHaveBeenCalledWith(
      expect.objectContaining({ proposedText: "Operator wording" }),
    );
    expect(h.recordShippedChange).toHaveBeenCalledWith(
      expect.objectContaining({ after: "Operator wording" }),
    );
  });
});
