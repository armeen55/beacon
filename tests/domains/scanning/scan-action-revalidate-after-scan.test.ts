import { describe, it, expect, vi, beforeEach } from "vitest";

const runWebsiteScanMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    ok: true,
    phase: "success",
    payload: {
      schemaVersion: 1,
      finishedAt: "2026-01-15T12:00:00.000Z",
      exit: "success",
      trigger: "pages",
      observationRunId: "obs-1",
      pagesScanned: 2,
      pagesChanged: 1,
      pagesWithErrors: 0,
      guardrailAlertCount: 0,
    },
    findingsAdded: 0,
  }),
);

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/domains/scanning/orchestrate-scan", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/domains/scanning/orchestrate-scan")>();
  return {
    ...actual,
    runWebsiteScan: runWebsiteScanMock,
  };
});

describe("triggerPageScan mutation boundary", () => {
  beforeEach(async () => {
    runWebsiteScanMock.mockClear();
    const { revalidatePath } = await import("next/cache");
    vi.mocked(revalidatePath).mockClear();
  });

  it("revalidates / and /pages after a successful scan", async () => {
    const { revalidatePath } = await import("next/cache");
    const { triggerPageScan } = await import("@/app/(shell)/pages/scan-action");

    await triggerPageScan();

    expect(runWebsiteScanMock).toHaveBeenCalledWith({ trigger: "pages" });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/pages", "layout");
  });
});
