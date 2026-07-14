import { beforeEach, describe, expect, it, vi } from "vitest";

const { readStoreMock } = vi.hoisted(() => ({
  readStoreMock: vi.fn(async (_name: string, _fallback: unknown[], opts?: { tenantId?: string }) => [{
    url: `https://${opts?.tenantId}.example/winner`,
    domain: `${opts?.tenantId}.example`,
    fetchStatus: "ok",
    facts: null,
  }]),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (...args: unknown[]) => readStoreMock(...(args as [string, unknown[], { tenantId?: string }])),
  writeStore: vi.fn(async () => {}),
}));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: vi.fn(async () => "ambient-ritz") }));

import { getCompetitorAuditsForTenantId } from "./competitor-page-audit";

describe("competitor teardown cache tenant isolation", () => {
  beforeEach(() => readStoreMock.mockClear());

  it("reads A and B through their explicit scope instead of the ambient tenant", async () => {
    const a = await getCompetitorAuditsForTenantId("tenant-iranopedia");
    const b = await getCompetitorAuditsForTenantId("tenant-ritz-founder");

    expect(readStoreMock).toHaveBeenNthCalledWith(1, "competitor-page-audit", [], { tenantId: "tenant-iranopedia" });
    expect(readStoreMock).toHaveBeenNthCalledWith(2, "competitor-page-audit", [], { tenantId: "tenant-ritz-founder" });
    expect([...a.keys()]).toEqual(["https://tenant-iranopedia.example/winner"]);
    expect([...b.keys()]).toEqual(["https://tenant-ritz-founder.example/winner"]);
  });
});
