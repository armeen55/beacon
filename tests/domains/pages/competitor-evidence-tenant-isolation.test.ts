/**
 * 2026-06-11 (night shift) — competitor-evidence store TENANT ISOLATION.
 * competitor-page-evidence + source-pattern-evidence are TENANT_SCOPED, but
 * the module held ONE process-global `const _state` object keyed by NOTHING:
 * first tenant's evidence pinned for every later tenant in a warm process.
 * Per-tenant Map now. Pins: hydrate-once, cross-tenant non-leak (both arrays).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CompetitorPageEvidence, SourcePatternEvidence } from "@/domains/pages/competitor-evidence";

vi.mock("server-only", () => ({}));
const cpMock = vi.hoisted(() => vi.fn());
const spMock = vi.hoisted(() => vi.fn());
const tenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/json-store", () => ({ writeStore: vi.fn() }));
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    getCompetitorPageEvidence: () => cpMock(),
    getSourcePatternEvidence: () => spMock(),
  }),
}));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: () => tenantIdMock() }));

const cp = (id: string) => ({ competitorEvidenceId: id }) as unknown as CompetitorPageEvidence;
const sp = (id: string) => ({ marker: id }) as unknown as SourcePatternEvidence;

describe("competitor-evidence — per-tenant cache", () => {
  beforeEach(() => {
    vi.resetModules();
    cpMock.mockReset(); spMock.mockReset(); tenantIdMock.mockReset();
    tenantIdMock.mockResolvedValue("tenant-a");
  });

  it("hydrates once, reuses for same tenant", async () => {
    cpMock.mockResolvedValueOnce([cp("a1")]); spMock.mockResolvedValueOnce([sp("s1")]);
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
    expect(bCp.map((p) => p.competitorEvidenceId)).toEqual(["b1"]); // pre-fix: ["a1"]
    expect((aSp[0] as unknown as { marker: string }).marker).toBe("sa");
    expect((bSp[0] as unknown as { marker: string }).marker).toBe("sb"); // pre-fix: "sa"
  });
});
