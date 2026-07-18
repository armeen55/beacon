import { beforeEach, describe, expect, it, vi } from "vitest";

const { readStoreMock, writeStoreMock } = vi.hoisted(() => ({
  readStoreMock: vi.fn(async (_name: string, _fallback: unknown[], opts?: { tenantId?: string }) => [{
    url: `https://${opts?.tenantId}.example/winner`,
    domain: `${opts?.tenantId}.example`,
    fetchStatus: "ok",
    facts: null,
  }]),
  writeStoreMock: vi.fn(async (..._args: unknown[]) => {}),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (...args: unknown[]) => readStoreMock(...(args as [string, unknown[], { tenantId?: string }])),
  writeStore: (...args: unknown[]) => writeStoreMock(...args),
}));

import { auditCompetitorUrls, getCompetitorAuditsForTenantId } from "./competitor-page-audit";

describe("competitor teardown cache tenant isolation", () => {
  beforeEach(() => {
    readStoreMock.mockClear();
    writeStoreMock.mockClear();
  });

  it("reads A and B through their explicit scope instead of the ambient tenant", async () => {
    const a = await getCompetitorAuditsForTenantId("tenant-iranopedia");
    const b = await getCompetitorAuditsForTenantId("tenant-ritz-founder");

    expect(readStoreMock).toHaveBeenNthCalledWith(1, "competitor-page-audit", [], { tenantId: "tenant-iranopedia" });
    expect(readStoreMock).toHaveBeenNthCalledWith(2, "competitor-page-audit", [], { tenantId: "tenant-ritz-founder" });
    expect([...a.keys()]).toEqual(["https://tenant-iranopedia.example/winner"]);
    expect([...b.keys()]).toEqual(["https://tenant-ritz-founder.example/winner"]);
  });

  it("writes refreshed audits only through the explicit tenant scope", async () => {
    await auditCompetitorUrls(
      "tenant-iranopedia-write",
      ["https://winner.example/guide"],
      {
        now: () => "2026-07-17T12:00:00.000Z",
        fetchHtml: async () => ({
          ok: true,
          status: 200,
          html: "<html><head><title>Winner guide</title></head><body><h1>Winner guide</h1><p>This is a complete competitor answer with enough useful content for the deterministic extractor to audit and persist safely.</p></body></html>",
        }),
      },
    );

    expect(writeStoreMock).toHaveBeenCalledTimes(1);
    expect(writeStoreMock.mock.calls[0]?.[0]).toBe("competitor-page-audit");
    expect(writeStoreMock.mock.calls[0]?.[2]).toEqual({ tenantId: "tenant-iranopedia-write" });
  });
});
