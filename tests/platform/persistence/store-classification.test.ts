/**
 * PLATFORM — store classification + repository read windows/pagination
 * (Core 100K terminal suite; merged from tests/lib/persistence/
 * store-classification, src/lib/persistence/store-classification.leak-hardening,
 * tests/lib/persistence/repositories/supabase-backend-pagination,
 * src/lib/persistence/repositories/tenant-repo.window, and
 * tests/storage/canonical-store-getter-tenant-cache).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Mocks used ONLY by the canonical-store getter-cache describe below. The
// other suites in this file exercise real modules that do not import these.
const readStoreMock = vi.hoisted(() => vi.fn());
const tenantIdMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (name: string) => readStoreMock(name),
  writeStore: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: () => tenantIdMock() }));
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({ forTenant: () => ({}) }),
}));
vi.mock("@/lib/persistence/dual-write", () => ({
  syncDailyMetricSnapshots: vi.fn(),
  syncPromptAnswerObservations: vi.fn(),
  syncTrackedPrompts: vi.fn(),
  syncTrackedEntities: vi.fn(),
}));

// Supabase admin mock for the pagination describe.
let mockPagesRows: Array<Record<string, unknown>> = [];
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      return {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          const rows = table === "pages" ? mockPagesRows : [];
          return {
            range(from: number, to: number) {
              return Promise.resolve({
                data: rows.slice(from, to + 1),
                error: null,
                count: opts?.count === "exact" ? rows.length : null,
              });
            },
            // A non-ranged select mimics the PostgREST 1000-row cap — exactly
            // the truncation the paginated path must avoid.
            then(resolve: (v: { data: unknown[]; error: null }) => unknown): unknown {
              return resolve({ data: rows.slice(0, 1000), error: null });
            },
            order(_col: string, _opts: { ascending: boolean }) {
              return {
                range: (from: number, to: number) =>
                  Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
              };
            },
          };
        },
      };
    },
  }),
}));

import {
  GLOBAL_STORES,
  SINGLETON_STORES,
  TENANT_SCOPED_STORES,
  classifyStore,
} from "@/lib/persistence/store-classification";
import { supabaseBackend } from "@/lib/persistence/repositories/supabase-backend";
import { buildTenantRepo } from "@/lib/persistence/repositories/tenant-repo";
import type { SeedDataRepository } from "@/lib/persistence/repositories/types";

describe("store-classification module", () => {
  it("the three classification Sets are pairwise disjoint", () => {
    const all = [...TENANT_SCOPED_STORES, ...SINGLETON_STORES, ...GLOBAL_STORES];
    expect(new Set(all).size).toBe(all.length);
  });

  it("classifyStore dispatches per-tenant / singleton / global correctly", () => {
    expect(classifyStore("imported-results")).toBe("per-tenant");
    expect(classifyStore("page-snapshots")).toBe("per-tenant");
    expect(classifyStore("citation-evidence-index")).toBe("singleton");
    expect(classifyStore("robots-state")).toBe("singleton");
    expect(classifyStore("business-config")).toBe("global");
    expect(classifyStore("tenants")).toBe("global");
  });

  it("leak-hardening: answer-texts is TENANT_SCOPED, never global/flat (finding A)", () => {
    expect(classifyStore("answer-texts")).toBe("per-tenant");
  });

  it("an unregistered store name classifies as 'unknown' — the fail-loud signal (finding E)", () => {
    expect(classifyStore("this-store-does-not-exist-xyz")).toBe("unknown");
    expect(classifyStore("")).toBe("unknown");
  });
});

describe("supabase-backend pagination (PostgREST 1000-row cap)", () => {
  it("getPages returns every row when the table has > 1000 rows", async () => {
    mockPagesRows = Array.from({ length: 2001 }, (_, i) => ({
      id: `pg-${i}`,
      url: `https://competitor${i}.com/some-path-${i}`,
      tenant_id: "",
    }));
    mockPagesRows[1500] = {
      id: "pg-owned-past-cap",
      url: "https://ritzbuilders.com/locations/palo-alto",
      tenant_id: "",
    };
    const got = await supabaseBackend.getPages();
    // With a non-paginated query this would truncate to 1000.
    expect(got.length).toBe(2001);
    expect(got.some((p) => p.url === "https://ritzbuilders.com/locations/palo-alto")).toBe(true);
    mockPagesRows = [];
  });
});

describe("tenant-repo windowed reads (`since`)", () => {
  const TENANT = "tenant-test";
  const obs = (observed_at: string, tenant_id = TENANT) => ({ id: `${observed_at}_${tenant_id}`, observed_at, tenant_id });
  const snap = (date: string, tenant_id = TENANT) => ({ id: `${date}_${tenant_id}`, date, tenant_id });

  const stubRepo = (observations: unknown[], snapshots: unknown[]): SeedDataRepository =>
    ({
      getPromptAnswerObservations: async () => observations as never,
      getDailyMetricSnapshots: async () => snapshots as never,
    }) as unknown as SeedDataRepository;

  const observations = [
    obs("2026-03-01T00:00:00Z"),
    obs("2026-04-15T00:00:00Z"),
    obs("2026-05-01T00:00:00Z"),
    obs("2026-05-05T12:00:00Z"),
    obs("2026-05-01T00:00:00Z", "tenant-other"),
  ];

  it("filters observations at-or-after `since` (date-only compares lexicographically)", async () => {
    const repo = buildTenantRepo(stubRepo(observations, []), TENANT);
    expect((await repo.getPromptAnswerObservations({ since: "2026-04-15" })).length).toBe(3);
    expect((await repo.getPromptAnswerObservations()).length).toBe(4);
  });

  it("never returns cross-tenant rows even with a wide-open window", async () => {
    const repo = buildTenantRepo(stubRepo(observations, []), TENANT);
    const out = await repo.getPromptAnswerObservations({ since: "2020-01-01" });
    expect(out.length).toBe(4);
    for (const o of out) {
      expect((o as unknown as { tenant_id: string }).tenant_id).toBe(TENANT);
    }
  });

  it("filters daily metric snapshots by `since` date", async () => {
    const snaps = [snap("2026-03-01"), snap("2026-04-15"), snap("2026-05-05"), snap("2026-05-01", "tenant-other")];
    const repo = buildTenantRepo(stubRepo([], snaps), TENANT);
    const out = await repo.getDailyMetricSnapshots({ since: "2026-04-15" });
    expect(out.length).toBe(2);
    for (const s of out) {
      expect(((s as unknown as { date: string }).date >= "2026-04-15")).toBe(true);
    }
  });
});

describe("canonical-store module getters — per-tenant cache", () => {
  function setTenant(t: string) {
    tenantIdMock.mockResolvedValue(t);
    readStoreMock.mockImplementation((name: string) =>
      Promise.resolve(name === "tracked-prompts" ? [{ id: `${t}-p` }] : []),
    );
  }

  beforeEach(() => {
    vi.resetModules();
    readStoreMock.mockReset();
    tenantIdMock.mockReset();
  });

  it("TENANT ISOLATION: getTrackedPrompts returns the ACTIVE tenant's rows, not the first tenant's", async () => {
    const mod = await import("@/storage/canonical-store");
    mod._resetCanonicalStoreStateForTests();
    setTenant("tenant-a");
    const a = await mod.getTrackedPrompts();
    setTenant("tenant-b");
    const b = await mod.getTrackedPrompts();
    expect(a.map((p) => (p as { id: string }).id)).toEqual(["tenant-a-p"]);
    expect(b.map((p) => (p as { id: string }).id)).toEqual(["tenant-b-p"]);
  });

  it("same tenant reuses the cache (tracked-prompts read once across getters)", async () => {
    const mod = await import("@/storage/canonical-store");
    mod._resetCanonicalStoreStateForTests();
    setTenant("tenant-a");
    await mod.getTrackedPrompts();
    await mod.getTrackedPrompts();
    await mod.getTrackedEntities();
    expect(readStoreMock.mock.calls.filter((c) => c[0] === "tracked-prompts").length).toBe(1);
  });
});
