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

const TENANT = "tenant-fixture-local";
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
  // syncChangelogEntries + syncObservationRuns removed 2026-07-22 (CORE 100K
  // persistence collapse): both writers were dead (zero live callers) and were
  // deleted from dual-write.ts. The tenant-isolation INVARIANT stays proven by
  // the surviving Tier A helpers below (every one still requires tenantId and
  // routes rows through tenantizeRows before any I/O).
  const TIER_A_SYNC_HELPERS = [
    "syncImportRuns",
    "syncPages",
    "syncDailyMetricSnapshots",
    "syncPromptAnswerObservations",
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

// ───────────────────────────────────────────────────────────────────────────
// F. Generic Account + BusinessProfile (Slice 1 acceptance).
//    A freshly provisioned account is fully generic; missing configuration
//    fails generically at every former leak site; no Account/Profile read
//    depends on files, env blobs, founder fallbacks, or implicit tenants.
// ───────────────────────────────────────────────────────────────────────────

describe("generic Account + BusinessProfile (Slice 1)", () => {
  const FORBIDDEN_VOCAB =
    /(ritz|iranopedia|builder|project_mix|budget_range|cities_served|publish_target|email_frequency|profound|semrush|founder|bay area)/i;

  it("a freshly provisioned account row carries no vertical, customer, publishing, or provider vocabulary", async () => {
    const { provisionTenantForNewUser, PROVISIONING_DEFAULTS } = await import(
      "@/domains/account/onboarding/provision-tenant"
    );
    expect(JSON.stringify(PROVISIONING_DEFAULTS)).not.toMatch(FORBIDDEN_VOCAB);

    const inserted: Record<string, unknown>[] = [];
    const fakeSupabase = {
      from: (table: string) => ({
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        upsert: async (row: Record<string, unknown>) => {
          inserted.push({ __table: table, ...row });
          return { error: null };
        },
      }),
    } as never;
    const out = await provisionTenantForNewUser(fakeSupabase, {
      userId: "12345678-abcd-abcd-abcd-1234567890ab",
      email: "owner@gmail.com",
    });
    expect(out.ok).toBe(true);
    const tenantRow = inserted.find((r) => r.__table === "tenants")!;
    expect(tenantRow).toBeTruthy();
    expect(JSON.stringify(tenantRow)).not.toMatch(FORBIDDEN_VOCAB);
    // Legacy vertical columns are OMITTED entirely (DB supplies neutral defaults).
    for (const k of ["segment", "project_mix", "cities_served", "budget_range", "publish_target", "role", "email_frequency"]) {
      expect(k in tenantRow).toBe(false);
    }
  });

  it("an unknown account resolves the neutral placeholder profile, never another business", async () => {
    const cfg = await import("@/lib/business-config");
    cfg.__resetBusinessProfileCacheForTests();
    const profile = cfg.getBusinessProfile("tenant-never-configured");
    expect(cfg.isPlaceholderProfile(profile)).toBe(true);
    expect(profile.name).toBe("");
    expect(profile.domain).toBe("");
    expect(profile.locations).toEqual([]);
    expect(JSON.stringify(profile)).not.toMatch(FORBIDDEN_VOCAB);
    // Former leak sites: term matchers never-match on the placeholder.
    expect(cfg.getLocationRegex(profile).test("palo alto custom homes")).toBe(false);
    expect(cfg.getServiceRegex(profile).test("whole home remodel")).toBe(false);
  });

  it("profile resolution ignores legacy env blobs (no env/file/founder fallback layers remain)", async () => {
    const cfg = await import("@/lib/business-config");
    cfg.__resetBusinessProfileCacheForTests();
    const prevEnv = process.env.BEACON_BUSINESS_CONFIG_JSON;
    process.env.BEACON_BUSINESS_CONFIG_JSON = JSON.stringify({ name: "Env Leak Co", domain: "leak.example" });
    try {
      const profile = cfg.getBusinessProfile("tenant-env-probe");
      expect(cfg.isPlaceholderProfile(profile)).toBe(true);
      expect(profile.name).toBe("");
    } finally {
      if (prevEnv === undefined) delete process.env.BEACON_BUSINESS_CONFIG_JSON;
      else process.env.BEACON_BUSINESS_CONFIG_JSON = prevEnv;
      cfg.__resetBusinessProfileCacheForTests();
    }
  });

  it("the injected in-memory profile repository is the only durable channel tests touch", async () => {
    const cfg = await import("@/lib/business-config");
    cfg.__resetBusinessProfileCacheForTests();
    const rows = new Map<string, Record<string, unknown>>();
    cfg.setBusinessProfileRepositoryForTests({
      load: async (id) => (rows.get(id) as never) ?? null,
      save: async (id, profile) => {
        rows.set(id, profile as never);
        return { ok: true };
      },
    });
    try {
      const saved = await cfg.saveBusinessProfile("tenant-mem-a", { name: "Mem A", domain: "mem-a.example" });
      expect(saved.persisted).toBe(true);
      cfg.__resetBusinessProfileCacheForTests();
      const hydrated = await cfg.hydrateBusinessProfile("tenant-mem-a");
      expect(hydrated?.name).toBe("Mem A");
      // Isolation: a different account sees the placeholder, not Mem A.
      const other = cfg.getBusinessProfile("tenant-mem-b");
      expect(cfg.isPlaceholderProfile(other)).toBe(true);
    } finally {
      cfg.setBusinessProfileRepositoryForTests(null);
      cfg.__resetBusinessProfileCacheForTests();
    }
  });

  it("the account store resolves through the injected repository and fails to no-account, never a default", async () => {
    const store = await import("@/domains/account/tenants/store");
    store.setAccountRepositoryForTests({
      listAccounts: async () => [
        {
          id: "tenant-mem-a", slug: "mem-a", business_name: "Mem A", domain: "mem-a.example",
          status: "active", signup_date: "2026-01-01", tos_accepted_at: null,
          daily_budget_usd: 5, created_at: "2026-01-01", updated_at: "2026-01-01",
        },
      ],
    });
    try {
      expect((await store.getTenant("tenant-mem-a"))?.slug).toBe("mem-a");
      expect(await store.getTenant("tenant-absent")).toBeNull();
      await expect(store.getTenantOrThrow("tenant-absent")).rejects.toThrow(/Unknown account/);
    } finally {
      store.setAccountRepositoryForTests(null);
    }
  });
});
