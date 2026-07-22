/**
 * EVIDENCE-AREA TENANT ISOLATION (Core 100K Phase 6 merged pin).
 * Carries the cross-tenant boundary cases from the retired files:
 *   tests/domains/pages/owned-url-tenant-isolation.test.ts
 *   tests/domains/pages/competitor-evidence-tenant-isolation.test.ts
 *   tests/domains/pages/evidence-tier-tenant-isolation.test.ts
 *   src/domains/demand-graph/competitor-page-audit-tenant.test.ts
 * Invariant (risk register): no evidence read or write may leak across
 * tenants via ambient state, process-global caches, or implicit domains.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type {
  CompetitorPageEvidence,
  SourcePatternEvidence,
} from "@/domains/pages/competitor-evidence";

vi.mock("server-only", () => ({}));

const { readStoreMock, writeStoreMock } = vi.hoisted(() => ({
  readStoreMock: vi.fn(
    async (_name: string, _fallback: unknown[], opts?: { tenantId?: string }) => [
      {
        url: `https://${opts?.tenantId}.example/winner`,
        domain: `${opts?.tenantId}.example`,
        fetchStatus: "ok",
        facts: null,
      },
    ],
  ),
  writeStoreMock: vi.fn(async (..._args: unknown[]) => {}),
}));
const cpMock = vi.hoisted(() => vi.fn());
const spMock = vi.hoisted(() => vi.fn());
const tenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (...args: unknown[]) =>
    readStoreMock(...(args as [string, unknown[], { tenantId?: string }])),
  writeStore: (...args: unknown[]) => writeStoreMock(...args),
}));
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    getCompetitorPageEvidence: () => cpMock(),
    getSourcePatternEvidence: () => spMock(),
  }),
}));
vi.mock("@/lib/tenant-context", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  currentTenantId: () => tenantIdMock(),
}));

import {
  canonicalizeOwnedUrl,
  normalizePageUrl,
} from "@/domains/pages/classify";
import { classifyEvidenceTier } from "@/domains/pages/evidence-tier";
import {
  auditCompetitorUrls,
  getCompetitorAuditsForTenantId,
} from "@/domains/demand-graph/competitor-page-audit";

describe("owned URL canonicalization is explicit and tenant-isolated", () => {
  it("is stable across A > B > A calls in one process", () => {
    const parsed = normalizePageUrl("https://rfritz.com/palo-alto");
    expect(parsed).not.toBeNull();

    const a1 = canonicalizeOwnedUrl(parsed!, "ritzbuilders.com", ["rfritz.com"]);
    const b = canonicalizeOwnedUrl(parsed!, "iranopedia.com");
    const a2 = canonicalizeOwnedUrl(parsed!, "ritzbuilders.com", ["rfritz.com"]);

    expect(a1).toEqual({
      url: "https://ritzbuilders.com/palo-alto",
      domain: "ritzbuilders.com",
      path: "/palo-alto",
    });
    expect(b).toEqual(parsed);
    expect(b.url).not.toContain("iranopedia.com");
    expect(a2).toEqual(a1);
  });

  it("never treats a legacy domain as owned unless that tenant supplies it", () => {
    const parsed = normalizePageUrl("https://legacy.example/topic")!;
    expect(canonicalizeOwnedUrl(parsed, "tenant-a.example")).toEqual(parsed);
    expect(
      canonicalizeOwnedUrl(parsed, "tenant-b.example", ["legacy.example"]),
    ).toMatchObject({
      url: "https://tenant-b.example/topic",
      domain: "tenant-b.example",
    });
  });
});

describe("evidence tier site identity is explicit", () => {
  const change = {
    id: "change-relative",
    tenant_id: "tenant-fixture",
    timestamp: "2026-07-12T00:00:00.000Z",
    signal_type: "content",
    asset_type: "service_page",
    url: "/history/construction",
    asset_name: "Construction history",
    change_description: "Published a new topic page",
    topic_targeted: "construction history",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:00:00.000Z",
  } as ChangelogEntry;

  it("is stable across A > B > A and fails closed without a domain", () => {
    const a1 = classifyEvidenceTier(change, undefined, "ritzbuilders.com");
    const b = classifyEvidenceTier(change, undefined, "iranopedia.com");
    const noContext = classifyEvidenceTier(change);
    const a2 = classifyEvidenceTier(change, undefined, "ritzbuilders.com");

    expect(a1.has_structural_url).toBe(true);
    expect(b.has_structural_url).toBe(true);
    expect(noContext.has_structural_url).toBe(false);
    expect(noContext.flags).toContain("opaque_url");
    expect(a2).toEqual(a1);
  });
});

describe("competitor-evidence store: per-tenant cache, no warm-process leak", () => {
  const cp = (id: string) =>
    ({ competitorEvidenceId: id }) as unknown as CompetitorPageEvidence;
  const sp = (id: string) => ({ marker: id }) as unknown as SourcePatternEvidence;

  beforeEach(() => {
    vi.resetModules();
    cpMock.mockReset();
    spMock.mockReset();
    tenantIdMock.mockReset();
    tenantIdMock.mockResolvedValue("tenant-a");
  });

  it("hydrates once, reuses for the same tenant", async () => {
    cpMock.mockResolvedValueOnce([cp("a1")]);
    spMock.mockResolvedValueOnce([sp("s1")]);
    const mod = await import("@/domains/pages/competitor-evidence");
    mod._resetCompetitorEvidenceForTests();
    await mod.getCompetitorPages();
    await mod.getSourcePatterns();
    await mod.getCompetitorPages();
    expect(cpMock).toHaveBeenCalledTimes(1);
    expect(spMock).toHaveBeenCalledTimes(1);
  });

  it("TENANT ISOLATION: tenant B gets its own evidence, not A's", async () => {
    cpMock.mockResolvedValueOnce([cp("a1")]).mockResolvedValueOnce([cp("b1")]);
    spMock.mockResolvedValueOnce([sp("sa")]).mockResolvedValueOnce([sp("sb")]);
    const mod = await import("@/domains/pages/competitor-evidence");
    mod._resetCompetitorEvidenceForTests();

    tenantIdMock.mockResolvedValue("tenant-a");
    const aCp = await mod.getCompetitorPages();
    const aSp = await mod.getSourcePatterns();
    tenantIdMock.mockResolvedValue("tenant-b");
    const bCp = await mod.getCompetitorPages();
    const bSp = await mod.getSourcePatterns();

    expect(aCp.map((p) => p.competitorEvidenceId)).toEqual(["a1"]);
    expect(bCp.map((p) => p.competitorEvidenceId)).toEqual(["b1"]);
    expect((aSp[0] as unknown as { marker: string }).marker).toBe("sa");
    expect((bSp[0] as unknown as { marker: string }).marker).toBe("sb");
  });
});

describe("competitor teardown cache tenant isolation", () => {
  beforeEach(() => {
    readStoreMock.mockClear();
    writeStoreMock.mockClear();
  });

  it("reads A and B through their explicit scope instead of the ambient tenant", async () => {
    const a = await getCompetitorAuditsForTenantId("tenant-iranopedia");
    const b = await getCompetitorAuditsForTenantId("tenant-ritz-founder");

    expect(readStoreMock).toHaveBeenNthCalledWith(1, "competitor-page-audit", [], {
      tenantId: "tenant-iranopedia",
    });
    expect(readStoreMock).toHaveBeenNthCalledWith(2, "competitor-page-audit", [], {
      tenantId: "tenant-ritz-founder",
    });
    expect([...a.keys()]).toEqual(["https://tenant-iranopedia.example/winner"]);
    expect([...b.keys()]).toEqual(["https://tenant-ritz-founder.example/winner"]);
  });

  it("writes refreshed audits only through the explicit tenant scope", async () => {
    await auditCompetitorUrls("tenant-iranopedia-write", ["https://winner.example/guide"], {
      now: () => "2026-07-17T12:00:00.000Z",
      fetchHtml: async () => ({
        ok: true,
        status: 200,
        html: "<html><head><title>Winner guide</title></head><body><h1>Winner guide</h1><p>This is a complete competitor answer with enough useful content for the deterministic extractor to audit and persist safely.</p></body></html>",
      }),
    });

    expect(writeStoreMock).toHaveBeenCalledTimes(1);
    expect(writeStoreMock.mock.calls[0]?.[0]).toBe("competitor-page-audit");
    expect(writeStoreMock.mock.calls[0]?.[2]).toEqual({
      tenantId: "tenant-iranopedia-write",
    });
  });
});
