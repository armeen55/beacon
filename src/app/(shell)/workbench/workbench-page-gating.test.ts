/**
 * Workbench route gating (operator-OS rebuild, Phase 2).
 *
 * The Workbench is an OPERATOR-ONLY surface — a non-operator (customer) must get
 * a 404, and the data loader must never run for them. We mock the gate + the
 * heavy server loader so this is a fast, real behavioral test of the route's
 * control flow (not a source-text pin).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { operatorFlag, loadWorkbenchMock, currentTenantMock } = vi.hoisted(() => ({
  operatorFlag: { value: true },
  loadWorkbenchMock: vi.fn(),
  currentTenantMock: vi.fn(),
}));

vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => operatorFlag.value,
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: currentTenantMock,
}));
vi.mock("./workbench-data", () => ({ loadWorkbench: loadWorkbenchMock }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import Page from "./[encodedPagePath]/page";

beforeEach(() => {
  operatorFlag.value = true;
  loadWorkbenchMock.mockReset().mockResolvedValue({ found: false, path: "/cities" });
  currentTenantMock.mockReset().mockResolvedValue("tenant-test");
});

const params = (encodedPagePath: string) => Promise.resolve({ encodedPagePath });

describe("Workbench route — operator gating", () => {
  it("non-operator (customer) ⇒ 404 and the loader never runs", async () => {
    operatorFlag.value = false;
    await expect(Page({ params: params("%2Fcities") })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadWorkbenchMock).not.toHaveBeenCalled();
  });

  it("operator ⇒ decodes the path + loads the page (no throw)", async () => {
    await expect(Page({ params: params("%2Fcities") })).resolves.toBeDefined();
    expect(loadWorkbenchMock).toHaveBeenCalledWith("tenant-test", "/cities");
  });

  it("invalid/empty encoded path ⇒ 404 (loader never runs)", async () => {
    await expect(Page({ params: params("") })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadWorkbenchMock).not.toHaveBeenCalled();
  });
});
