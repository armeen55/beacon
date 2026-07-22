/**
 * auto-measure-pass --- P0-B Wave 1 pin: a pass fired from a page GET's after()
 * (allowPaidRankRecheck=false) must run the bounded GSC-only re-measure with ZERO
 * paid live-SERP rank re-check, while an explicit action (default) may still spend.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadShippedChangesMock = vi.fn(async (): Promise<unknown[]> => []);
const readLastFinalizedDateMock = vi.fn(async (): Promise<string | null> => "2026-07-01");
const upsertShippedChangeMock = vi.fn(async (): Promise<void> => {});
const isDueForMeasureMock = vi.fn((): boolean => true);
const measureRecordMock = vi.fn(async (...args: unknown[]): Promise<unknown> => args[1]);

vi.mock("server-only", () => ({}));
vi.mock("@/domains/proof-gsc/run-measurement", () => ({
  measureRecord: (...args: unknown[]) => measureRecordMock(...args),
}));
vi.mock("@/domains/proof-gsc/gsc-window", () => ({
  readLastFinalizedDate: () => readLastFinalizedDateMock(),
}));
vi.mock("@/domains/proof-gsc/shipped-change-store", () => ({
  loadShippedChanges: () => loadShippedChangesMock(),
  upsertShippedChange: () => upsertShippedChangeMock(),
}));
vi.mock("@/domains/proof-gsc/measure-lifecycle", () => ({
  isDueForMeasure: () => isDueForMeasureMock(),
  outcomeStateOf: () => "measuring",
}));

import { autoMeasureDuePass } from "@/domains/proof-gsc/auto-measure-pass";

const rec = (id: string) => ({ id, path: `/${id}`, actionType: "edit_title", verdict: "measuring" });

beforeEach(() => {
  loadShippedChangesMock.mockReset();
  loadShippedChangesMock.mockResolvedValue([rec("a"), rec("b")]);
  measureRecordMock.mockReset();
  measureRecordMock.mockImplementation(async (...args: unknown[]) => ({ ...(args[1] as object), verdict: "measuring" }));
  upsertShippedChangeMock.mockClear();
  isDueForMeasureMock.mockReturnValue(true);
});

describe("autoMeasureDuePass --- allowPaidRankRecheck gate", () => {
  it("GET-triggered pass (allowPaidRankRecheck=false): measureRecord is called with allowRankRecheck=false for every record (no paid SERP)", async () => {
    await autoMeasureDuePass("tenant-a", { maxRecords: 15, allowPaidRankRecheck: false });
    expect(measureRecordMock).toHaveBeenCalledTimes(2);
    for (const call of measureRecordMock.mock.calls) {
      // signature: measureRecord(tenantId, record, now, lastFinal, excludeControls, allowRankRecheck)
      expect(call[5]).toBe(false);
    }
  });

  it("explicit-action pass (default): may allow the bounded paid rank re-check", async () => {
    await autoMeasureDuePass("tenant-a", { maxRecords: 15 });
    expect(measureRecordMock).toHaveBeenCalledTimes(2);
    // Default preserves the pre-P0-B behavior: the first records are allowed to spend.
    expect(measureRecordMock.mock.calls[0][5]).toBe(true);
  });
});
