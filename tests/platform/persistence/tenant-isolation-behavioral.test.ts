/**
 * PLATFORM — tenant isolation, behavioral layer (Core 100K terminal suite).
 *
 * The §4 risk-register pin for "tenant isolation": the architecture suite
 * (tests/architecture/01-08) proves the SOURCE shape; this file proves the
 * RUNTIME shape across every persistence layer that touches tenant rows.
 * Merged from tests/persistence/{tenant-isolation-behavioral,
 * tenant-repository-pushdown, dual-write-tenant, dual-write-pao-same-day-repoll,
 * dual-write-observation-runs-dedup} and tests/tenants/isolation.
 *
 *   A. buildTenantRepo facade returns only the calling tenant's rows.
 *   B. supabase-backend forTenant static invariant: every select is scoped.
 *   C. dual-write validation fires BEFORE any I/O (scoped upserts, stamping,
 *      global-table membership, Tier A helper wiring, scoped deletes).
 *   D. same-day re-poll recovery writes only the missing rows.
 *   E. tenant-data adapters never leak across tenants.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("server-only", () => ({}));

// Scripted supabase admin used ONLY by section D (dual-write is a no-op for
// every other section because DUAL_WRITE is unset in the vitest env).
const DUP_MSG = 'duplicate key value violates unique constraint "ux_pao_tenant_prompt_platform_day"';
const _upsertResults: Array<{ error: { message: string } | null }> = [];
const _upsertCalls: Array<Array<Record<string, unknown>>> = [];
let _existingPromptIds: string[] = [];
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (_table: string) => ({
      upsert: async (rows: Array<Record<string, unknown>>) => {
        _upsertCalls.push(rows);
        return _upsertResults.shift() ?? { error: null };
      },
      select: (_cols: string) => {
        const terminator = {
          eq: () => terminator,
          gte: () => terminator,
          lt: async () => ({ data: _existingPromptIds.map((prompt_id) => ({ prompt_id })), error: null }),
        };
        return terminator;
      },
    }),
  }),
}));

import { buildTenantRepo } from "@/lib/persistence/repositories/tenant-repo";
import type { SeedDataRepository } from "@/lib/persistence/repositories/types";
import {
  assertRowsScopedToTenant,
  dualWriteUpsertScoped,
  GLOBAL_TABLES,
  tenantizeRows,
  syncImportRuns,
  syncPromptAnswerObservations,
} from "@/lib/persistence/dual-write";

const TENANT = "tenant-ritz-founder";
const OTHER = "tenant-other";

// ── A. buildTenantRepo facade ───────────────────────────────────────────────

describe("buildTenantRepo behavioral isolation", () => {
  const prompt = (id: string, tenant_id: string) =>
    ({ id, tenant_id, account_id: tenant_id, text: id, is_active: true }) as unknown as never;
  const entity = (id: string, tenant_id: string) =>
    ({ id, tenant_id, account_id: tenant_id, name: id, entity_type: "competitor", is_owned: false, is_active: true }) as unknown as never;

  const ALL_PROMPTS = [prompt("p-a-1", "tenant-a"), prompt("p-a-2", "tenant-a"), prompt("p-c-1", "tenant-c")];
  const ALL_ENTITIES = [entity("e-a-1", "tenant-a"), entity("e-c-1", "tenant-c")];

  function fakeBase(): SeedDataRepository {
    const fake = {
      getTrackedPrompts: async () => ALL_PROMPTS,
      getTrackedEntities: async () => ALL_ENTITIES,
      forTenant: (tenantId: string) => buildTenantRepo(fake as SeedDataRepository, tenantId),
    } as unknown as SeedDataRepository;
    return fake;
  }

  it("a populated tenant gets ONLY its own tracked prompts + entities", async () => {
    const repoA = buildTenantRepo(fakeBase(), "tenant-a");
    const prompts = await repoA.getTrackedPrompts();
    const entities = await repoA.getTrackedEntities();
    expect(prompts.map((p) => p.id).sort()).toEqual(["p-a-1", "p-a-2"]);
    expect(entities.map((e) => e.id)).toEqual(["e-a-1"]);
  });

  it("an empty tenant gets [] even though the base holds other tenants' rows", async () => {
    const repoB = buildTenantRepo(fakeBase(), "tenant-b-empty");
    expect(await repoB.getTrackedPrompts()).toEqual([]);
    expect(await repoB.getTrackedEntities()).toEqual([]);
  });

  it("two populated tenants are mutually isolated (disjoint id sets)", async () => {
    const base = fakeBase();
    const [promptsA, promptsC] = await Promise.all([
      buildTenantRepo(base, "tenant-a").getTrackedPrompts(),
      buildTenantRepo(base, "tenant-c").getTrackedPrompts(),
    ]);
    const aIds = new Set(promptsA.map((p) => p.id));
    for (const p of promptsC) expect(aIds.has(p.id)).toBe(false);
    expect(promptsA.length).toBe(2);
    expect(promptsC.length).toBe(1);
  });
});

// ── B. supabase-backend forTenant pushdown (static invariant) ───────────────

describe("supabase-backend forTenant pushdown invariant", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../../../src/lib/persistence/repositories/supabase-backend.ts"),
    "utf8",
  );

  it("every .select( in the forTenant block carries a tenant predicate (or the account-slug exception)", () => {
    const fnStart = SRC.indexOf("forTenant(tenantId");
    expect(fnStart).toBeGreaterThan(0);
    const fnEnd = SRC.indexOf("\n  },", fnStart);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = SRC.slice(fnStart, fnEnd);

    const selects = [...body.matchAll(/\.select\(/g)];
    expect(selects.length).toBeGreaterThan(0);
    for (const m of selects) {
      const window = body.slice(m.index ?? 0, (m.index ?? 0) + 1200);
      const scoped =
        window.includes('.eq("tenant_id", tenantId)') ||
        window.includes(".eq('tenant_id', tenantId)") ||
        window.includes('.eq("account_id", tenant.slug)') ||
        window.includes(".eq('account_id', tenant.slug)");
      expect(scoped, `unscoped .select( in forTenant at offset ${m.index}: ${window.slice(0, 120)}`).toBe(true);
    }
    expect(SRC).toMatch(/async function selectScoped[\s\S]*?\.eq\("tenant_id", tenantId\)/);
    expect(SRC).toMatch(/async function queryAllPagedScoped[\s\S]*?\.eq\("tenant_id", tenantId\)/);
  });
});

// ── C. dual-write validation layer ──────────────────────────────────────────

describe("dual-write tenant validation (fires before any I/O)", () => {
  it("assertRowsScopedToTenant throws on empty tenantId and on any mismatched row", () => {
    expect(() => assertRowsScopedToTenant([{ tenant_id: TENANT }], "", "results")).toThrow(
      /tenantId must be a non-empty string/,
    );
    expect(() => assertRowsScopedToTenant([{ tenant_id: TENANT }, { tenant_id: OTHER }], TENANT, "results")).toThrow(
      /tenant mismatch/,
    );
    expect(() =>
      assertRowsScopedToTenant([{ tenant_id: TENANT }, { tenant_id: TENANT }], TENANT, "results"),
    ).not.toThrow();
  });

  it("dualWriteUpsertScoped rejects global tables, mismatches, and empty tenantIds", async () => {
    await expect(dualWriteUpsertScoped("tenants", [{ tenant_id: TENANT, id: "x" }], "id", TENANT)).rejects.toThrow(
      /is a global table/,
    );
    await expect(dualWriteUpsertScoped("results", [{ tenant_id: OTHER, id: "r1" }], "id", TENANT)).rejects.toThrow(
      /tenant mismatch/,
    );
    await expect(dualWriteUpsertScoped("results", [{ tenant_id: TENANT, id: "r1" }], "id", "")).rejects.toThrow(
      /tenantId must be a non-empty string/,
    );
    // Valid input with DUAL_WRITE off is a silent no-op success.
    await expect(dualWriteUpsertScoped("results", [{ tenant_id: TENANT, id: "r1" }], "id", TENANT)).resolves.toBeUndefined();
  });

  it("GLOBAL_TABLES holds the registry + shared config, never per-tenant data tables", () => {
    expect(GLOBAL_TABLES.has("tenants")).toBe(true);
    expect(GLOBAL_TABLES.has("business_config")).toBe(true);
    for (const t of ["results", "page_snapshots", "recommended_edits", "observation_runs", "pages"]) {
      expect(GLOBAL_TABLES.has(t), `${t} must be tenant-scoped`).toBe(false);
    }
    // Night-shift 2026-06-11: the two index tables LEFT the global set.
    expect(GLOBAL_TABLES.has("citation_evidence_index")).toBe(false);
    expect(GLOBAL_TABLES.has("answer_intelligence_index")).toBe(false);
  });

  it("tenantizeRows stamps missing tenant_id, throws on a real mismatch, never mutates input", () => {
    const original = { id: "r1", tenant_id: "" };
    const out = tenantizeRows([original, { id: "r2", tenant_id: TENANT }, { id: "r3" }], TENANT, "results");
    expect(out).toEqual([
      { id: "r1", tenant_id: TENANT },
      { id: "r2", tenant_id: TENANT },
      { id: "r3", tenant_id: TENANT },
    ]);
    expect(original.tenant_id).toBe("");
    expect(() => tenantizeRows([{ id: "r1", tenant_id: OTHER }], TENANT, "results")).toThrow(/tenant mismatch/);
    expect(() => tenantizeRows([], "", "results")).toThrow(/tenantId must be a non-empty string/);
  });
});

const DUAL_WRITE_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/lib/persistence/dual-write.ts"),
  "utf8",
);

/** Slice a helper body from `export async function NAME(` to the next export. */
function sliceHelperBody(source: string, name: string): string {
  const startIdx = source.indexOf(`export async function ${name}(`);
  if (startIdx < 0) return "";
  const nextExportIdx = source.indexOf("\nexport ", startIdx + 1);
  return nextExportIdx > 0 ? source.slice(startIdx, nextExportIdx) : source.slice(startIdx);
}

describe("Tier A sync* helpers stay tenant-wired (static invariant)", () => {
  const TIER_A_SYNC_HELPERS = [
    "syncImportRuns",
    "syncChangelogEntries",
    "syncPages",
    "syncDailyMetricSnapshots",
    "syncPromptAnswerObservations",
    "syncObservationRuns",
    "syncPageSnapshots",
    "syncScanFindings",
    "syncRecommendationResponses",
    "syncUrlChangeOutcomes",
    "syncPageElementInventory",
  ] as const;

  for (const helper of TIER_A_SYNC_HELPERS) {
    it(`${helper}: requires tenantId and routes rows through tenantizeRows`, () => {
      const body = sliceHelperBody(DUAL_WRITE_SOURCE, helper);
      expect(body, `${helper} not found in dual-write.ts`).not.toBe("");
      const headerEnd = body.indexOf("Promise<void>");
      expect(headerEnd).toBeGreaterThan(0);
      expect(body.slice(0, headerEnd)).toMatch(/tenantId:\s*string/);
      expect(body).toMatch(/tenantizeRows\(/);
    });
  }

  it("syncObservationRuns dedupes by run_id before upserting (the 2026-04-27 ON CONFLICT fix)", () => {
    const body = sliceHelperBody(DUAL_WRITE_SOURCE, "syncObservationRuns");
    expect(body).toMatch(/dedupedByRunId\s*=\s*new Map/);
    expect(body).toMatch(/dualWriteUpsert\(\s*["']observation_runs["'][^)]*dedupedRows/);
  });

  it("syncRecommendedEdits uses STRICT dualWriteUpsertScoped with the tenant-leading compound key", () => {
    const body = sliceHelperBody(DUAL_WRITE_SOURCE, "syncRecommendedEdits");
    expect(body).not.toBe("");
    expect(body).toMatch(/dualWriteUpsertScoped\(/);
    expect(body).not.toMatch(/tenantizeRows\(/);
    expect(body).toMatch(/["']tenant_id,rec_id,action_type,target_element_key["']/);
  });

  it("deleteRecommendationResponseByRecId filters by BOTH rec_id AND tenant_id and fails loud on empty tenantId", () => {
    const body = sliceHelperBody(DUAL_WRITE_SOURCE, "deleteRecommendationResponseByRecId");
    expect(body).toMatch(/\.eq\(\s*["']rec_id["']\s*,\s*recId\s*\)/);
    expect(body).toMatch(/\.eq\(\s*["']tenant_id["']\s*,\s*tenantId\s*\)/);
    expect(body).toMatch(/tenantId must be a non-empty string/);
  });

  it("runtime: a representative Tier A helper rejects a cross-tenant row and an empty tenantId", async () => {
    await expect(
      syncImportRuns([{ id: "r1", tenant_id: OTHER } as unknown as Parameters<typeof syncImportRuns>[0][number]], TENANT),
    ).rejects.toThrow(/tenant mismatch/);
    await expect(
      syncImportRuns([{ id: "r1", tenant_id: "" } as unknown as Parameters<typeof syncImportRuns>[0][number]], ""),
    ).rejects.toThrow(/tenantId must be a non-empty string/);
  });
});

// ── D. same-day re-poll recovery (the June 3 outage class) ─────────────────

describe("syncPromptAnswerObservations same-day re-poll recovery", () => {
  function obs(promptId: string) {
    return {
      id: `obs-${promptId}`,
      prompt_id: promptId,
      answer_hash: "h",
      platform: "chatgpt",
      observed_at: "2026-06-03T12:01:31Z",
      citation_domains: [],
    } as unknown as Parameters<typeof syncPromptAnswerObservations>[0][number];
  }

  beforeEach(() => {
    vi.stubEnv("DUAL_WRITE", "true");
    _upsertResults.length = 0;
    _upsertCalls.length = 0;
    _existingPromptIds = [];
  });

  it("day-collision: writes ONLY the missing rows (rescues a partial run's gap)", async () => {
    _upsertResults.push({ error: { message: DUP_MSG } });
    _upsertResults.push({ error: null });
    _existingPromptIds = ["p1"];
    await syncPromptAnswerObservations([obs("p1"), obs("p2")], "tenant-test");
    expect(_upsertCalls).toHaveLength(2);
    expect(_upsertCalls[1]).toHaveLength(1);
    expect(_upsertCalls[1]![0]!.prompt_id).toBe("p2");
  });

  it("all-duplicates: no second write, no throw (the June 3 shape)", async () => {
    _upsertResults.push({ error: { message: DUP_MSG } });
    _existingPromptIds = ["p1", "p2"];
    await syncPromptAnswerObservations([obs("p1"), obs("p2")], "tenant-test");
    expect(_upsertCalls).toHaveLength(1);
  });

  it("other constraint errors still throw (the paid-poll gate keeps its job)", async () => {
    _upsertResults.push({ error: { message: 'violates unique constraint "something_else"' } });
    await expect(syncPromptAnswerObservations([obs("p1")], "tenant-test")).rejects.toThrow(/something_else/);
  });
});
