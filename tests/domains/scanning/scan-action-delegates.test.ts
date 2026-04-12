import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const runMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    ok: true,
    phase: "success",
    payload: {
      schemaVersion: 1,
      finishedAt: "2026-01-15T12:00:00.000Z",
      exit: "success",
      trigger: "pages",
      observationRunId: "obs-delegation-test",
      pagesScanned: 4,
      pagesChanged: 2,
      pagesWithErrors: 0,
      guardrailAlertCount: 1,
    },
    findingsAdded: 0,
  }),
);

vi.mock("@/domains/scanning/orchestrate-scan", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/domains/scanning/orchestrate-scan")>();
  return { ...actual, runWebsiteScan: runMock };
});

describe("triggerPageScan", () => {
  beforeEach(() => {
    runMock.mockClear();
  });

  it("delegates to runWebsiteScan with trigger pages", async () => {
    const { triggerPageScan } = await import("@/app/(shell)/pages/scan-action");
    const r = await triggerPageScan();
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith({ trigger: "pages" });
    expect(r.success).toBe(true);
    expect(r.pagesScanned).toBe(4);
    expect(r.pagesChanged).toBe(2);
    expect(r.alertCount).toBe(1);
  });
});
