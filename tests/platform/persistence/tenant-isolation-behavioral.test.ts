/** PLATFORM — tenant isolation, behavioral layer: repo facade scoping, dual-write
 *  validation before I/O, and the canonical Account/BusinessProfile + lifecycle
 *  promises. Structural pushdown lives in the foundation guard, not source scans. */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Inert supabase stub: dual-write is a no-op in every section here because
// DUAL_WRITE is unset in the vitest env; nothing may reach a real client.
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("test: no section may reach the supabase client");
  },
}));

import { buildTenantRepo } from "@/lib/persistence/repositories/tenant-repo";
import type { SeedDataRepository } from "@/lib/persistence/repositories/types";
import {
  assertRowsScopedToTenant,
  dualWriteUpsertScoped,
  GLOBAL_TABLES,
  tenantizeRows,
  syncImportRuns,
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

// ── B. dual-write validation layer ──────────────────────────────────────────

describe("dual-write tenant validation (fires before any I/O)", () => {
  it("assertRowsScopedToTenant throws on empty tenantId and on any mismatched row", () => {
    expect(() => assertRowsScopedToTenant([{ tenant_id: TENANT }], "", "results")).toThrow(/tenantId must be a non-empty string/);
    expect(() => assertRowsScopedToTenant([{ tenant_id: TENANT }, { tenant_id: OTHER }], TENANT, "results")).toThrow(/tenant mismatch/);
    expect(() => assertRowsScopedToTenant([{ tenant_id: TENANT }, { tenant_id: TENANT }], TENANT, "results")).not.toThrow();
  });

  it("dualWriteUpsertScoped rejects global tables, mismatches, and empty tenantIds", async () => {
    await expect(dualWriteUpsertScoped("tenants", [{ tenant_id: TENANT, id: "x" }], "id", TENANT)).rejects.toThrow(/is a global table/);
    await expect(dualWriteUpsertScoped("results", [{ tenant_id: OTHER, id: "r1" }], "id", TENANT)).rejects.toThrow(/tenant mismatch/);
    await expect(dualWriteUpsertScoped("results", [{ tenant_id: TENANT, id: "r1" }], "id", "")).rejects.toThrow(/tenantId must be a non-empty string/);
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
    expect(out).toEqual([{ id: "r1", tenant_id: TENANT }, { id: "r2", tenant_id: TENANT }, { id: "r3", tenant_id: TENANT }]);
    expect(original.tenant_id).toBe("");
    expect(() => tenantizeRows([{ id: "r1", tenant_id: OTHER }], TENANT, "results")).toThrow(/tenant mismatch/);
    expect(() => tenantizeRows([], "", "results")).toThrow(/tenantId must be a non-empty string/);
  });
});

describe("Tier A sync* helpers stay tenant-wired", () => {
  it("runtime: a representative Tier A helper rejects a cross-tenant row and an empty tenantId", async () => {
    await expect(syncImportRuns([{ id: "r1", tenant_id: OTHER } as unknown as Parameters<typeof syncImportRuns>[0][number]], TENANT)).rejects.toThrow(/tenant mismatch/);
    await expect(syncImportRuns([{ id: "r1", tenant_id: "" } as unknown as Parameters<typeof syncImportRuns>[0][number]], "")).rejects.toThrow(/tenantId must be a non-empty string/);
  });
});

describe("generic Account + BusinessProfile (Slice 1 closure)", () => {
  const FORBIDDEN_VOCAB =
    /(harborview|referencepedia|builder|project_mix|budget_range|cities_served|publish_target|email_frequency|profound|semrush|founder|bay area)/i;

  // Supabase stub: select("user_id") answers the collision probe with `owners`;
  // the membership idempotency probe answers empty so provisioning proceeds.
  const fakeSupabase = (inserted: Record<string, unknown>[], owners: { user_id: string }[] = []) =>
    ({ from: (table: string) => ({
      select: (cols: string) => ({ eq: () => Object.assign(Promise.resolve({ data: cols === "user_id" ? owners : [], error: null }), { order: () => Promise.resolve({ data: [], error: null }) }) }),
      upsert: async (row: Record<string, unknown>) => { inserted.push({ __table: table, ...row }); return { error: null }; },
    }) }) as never;
  const NEW_USER = { userId: "12345678-abcd-abcd-abcd-1234567890ab", email: "owner@gmail.com" };

  it("the provisioned tenants row names EXACTLY the physical columns, and never adopts another user's tenant", async () => {
    const { provisionTenantForNewUser, PROVISIONING_DEFAULTS } = await import("@/domains/account/onboarding/provision-tenant");
    expect(JSON.stringify(PROVISIONING_DEFAULTS)).not.toMatch(FORBIDDEN_VOCAB);
    const inserted: Record<string, unknown>[] = [];
    expect(await provisionTenantForNewUser(fakeSupabase(inserted), NEW_USER)).toEqual({ ok: true, tenantId: "tenant-12345678", created: true });
    const { __table: _t, ...row } = inserted.find((r) => r.__table === "tenants")!;
    // Any key that is not a real column takes EVERY signup down with PGRST204;
    // the physical set also proves no vertical vocabulary is written.
    expect(Object.keys(row).sort()).toEqual(["business_name", "created_at", "daily_budget_usd", "domain", "growth_goal", "id", "signup_date", "slug", "status", "tos_accepted_at", "updated_at"]);
    expect(typeof row.business_name === "string" && (row.business_name as string).length > 0, "business_name is NOT NULL").toBe(true);
    // A colliding id already owned by someone else is refused, never adopted.
    expect(await provisionTenantForNewUser(fakeSupabase([], [{ user_id: "other-user" }]), NEW_USER)).toEqual({ ok: false, error: "tenant id collision", phase: "tenant_collision" });
  });

  it("cold first read resolves the real account identity; no placeholder is ever cached as identity", async () => {
    const bp = await import("@/domains/account/business-profile");
    bp.__resetBusinessProfileCacheForTests();
    const row = { schemaVersion: 2, name: { value: "Real Cold Co", origin: "operator_confirmed", confidence: 1, sourceUrls: [] } };
    let loads = 0;
    bp.setBusinessProfileRepositoryForTests({
      load: async () => {
        loads++;
        // First call: the row does NOT exist yet (cold signup race)…
        if (loads === 1) return null;
        // …then the durable row lands.
        return row as never;
      },
      save: async () => ({ ok: true }),
    });
    try {
      const first = await bp.loadBusinessProfile("tenant-cold");
      expect(first.name.value).toBe(""); // honest empty, not another business
      // The miss must NOT have been memoized: the next read sees the real row.
      const second = await bp.loadBusinessProfile("tenant-cold");
      expect(second.name.value).toBe("Real Cold Co");
      // And the REAL profile is now cached (no further repo hits).
      const before = loads;
      await bp.loadBusinessProfile("tenant-cold");
      expect(loads).toBe(before);
    } finally {
      bp.setBusinessProfileRepositoryForTests(null);
      bp.__resetBusinessProfileCacheForTests();
    }
  });

  it("a transient repository failure recovers on the next read", async () => {
    const bp = await import("@/domains/account/business-profile");
    bp.__resetBusinessProfileCacheForTests();
    let calls = 0;
    bp.setBusinessProfileRepositoryForTests({
      load: async () => {
        calls++;
        if (calls === 1) throw new Error("transient network failure");
        return { schemaVersion: 2, name: { value: "Recovered Co", origin: "operator_confirmed", confidence: 1, sourceUrls: [] } } as never;
      },
      save: async () => ({ ok: true }),
    });
    try {
      const first = await bp.loadBusinessProfile("tenant-flaky");
      expect(first.name.value).toBe(""); // fail-generic now…
      const second = await bp.loadBusinessProfile("tenant-flaky");
      expect(second.name.value).toBe("Recovered Co"); // …retry succeeded
    } finally {
      bp.setBusinessProfileRepositoryForTests(null);
      bp.__resetBusinessProfileCacheForTests();
    }
  });

  it("one account's cached identity can never serve another account", async () => {
    const bp = await import("@/domains/account/business-profile");
    bp.__resetBusinessProfileCacheForTests();
    bp.setBusinessProfileRepositoryForTests({
      load: async (id) =>
        id === "tenant-a"
          ? ({ schemaVersion: 2, name: { value: "Account A", origin: "operator_confirmed", confidence: 1, sourceUrls: [] } } as never)
          : null,
      save: async () => ({ ok: true }),
    });
    try {
      const a = await bp.loadBusinessProfile("tenant-a");
      expect(a.name.value).toBe("Account A");
      const b = await bp.loadBusinessProfile("tenant-b");
      expect(b.name.value).toBe("");
      expect(b.accountId).toBe("tenant-b");
    } finally {
      bp.setBusinessProfileRepositoryForTests(null);
      bp.__resetBusinessProfileCacheForTests();
    }
  });

  it("a historical pre-canonical row maps into canonical sections with legacy provenance and preserved raw JSON", async () => {
    const bp = await import("@/domains/account/business-profile");
    const legacyRow = {
      name: "Historic Publisher", businessType: "content_publisher", contentSiteMode: true, services: ["guides"],
      serviceTerms: ["reference articles"], locations: ["US"], keyPages: ["/about"], contentRules: ["Use plain English."],
      flaggedTerms: ["cheap"], authoritativeSourceDomains: ["wikipedia.org"], primaryCompetitors: ["rival.example"],
      yelpBusinessId: "legacy-yelp", revenueModel: { kind: "rpm", rpmUsd: 5 },
    };
    const profile = bp.profileFromRow("tenant-hist", legacyRow as never);
    expect(profile.schemaVersion).toBe(2);
    expect(profile.name.value).toBe("Historic Publisher");
    expect(profile.name.origin).toBe("legacy");
    expect(profile.businessType.value).toBe("content_publisher");
    expect(profile.siteArchetype.value).toBe("content_site");
    expect(profile.offerings.value.sort()).toEqual(["guides", "reference articles"].sort());
    expect(profile.geographicScope.value).toEqual(["US"]);
    expect(profile.importantPages.value).toEqual(["/about"]);
    expect(profile.constraints.value.editorial).toEqual(["Use plain English."]);
    expect(profile.constraints.value.bannedTerms).toEqual(["cheap"]);
    expect(profile.trustedSourceDomains.value).toEqual(["wikipedia.org"]);
    expect(profile.competitors.value).toEqual([{ name: "rival.example", evidenceUrls: [] }]);
    // Raw legacy JSON preserved verbatim and inert.
    expect(profile.legacy).toEqual(legacyRow);
    // Removed contract fields do not surface as active truth.
    expect("yelpBusinessId" in profile).toBe(false);
    expect("revenueModel" in profile).toBe(false);
    expect("domain" in profile).toBe(false);
  });

  it("active customer copy uses the BusinessProfile name, never the provisional signup seed", async () => {
    vi.doMock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-copy" }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    const store = await import("@/domains/account/tenants/store");
    const bp = await import("@/domains/account/business-profile");
    bp.__resetBusinessProfileCacheForTests();
    const account = {
      id: "tenant-copy", slug: "copy", provisional_name: "seed-name-visible-nowhere", domain: "copy-co.example", status: "active" as const,
      signup_date: "2026-01-01", tos_accepted_at: null, daily_budget_usd: 5, growth_goal: null, created_at: "2026-01-01", updated_at: "2026-01-01" };
    store.setAccountRepositoryForTests({
      getAccountById: async (id) => (id === account.id ? account : null),
      getAccountBySlug: async () => null,
    });
    bp.seedBusinessProfileForTests("tenant-copy", {
      name: { value: "Confirmed Co", origin: "operator_confirmed", confidence: 1, sourceUrls: [] },
    });
    try {
      const { loadSetup } = await import("@/app/(shell)/settings/config/actions");
      const view = await loadSetup();
      expect(view.name).toBe("Confirmed Co");
      expect(view.name).not.toContain("seed-name");
      expect(view.websiteDomain).toBe("copy-co.example");
    } finally {
      store.setAccountRepositoryForTests(null);
      bp.setBusinessProfileRepositoryForTests(null);
      bp.__resetBusinessProfileCacheForTests();
      vi.doUnmock("@/lib/tenant-context");
      vi.doUnmock("next/cache");
    }
  });

  it("the account store resolves through the injected scoped repository and fails to no-account, never a default", async () => {
    const store = await import("@/domains/account/tenants/store");
    const memA = {
      id: "tenant-mem-a", slug: "mem-a", provisional_name: "Mem A", domain: "mem-a.example", status: "active" as const,
      signup_date: "2026-01-01", tos_accepted_at: null, daily_budget_usd: 5, growth_goal: null, created_at: "2026-01-01", updated_at: "2026-01-01" };
    store.setAccountRepositoryForTests({
      getAccountById: async (id) => (id === memA.id ? memA : null),
      getAccountBySlug: async (slug) => (slug === memA.slug ? memA : null),
    });
    try {
      expect((await store.getTenant("tenant-mem-a"))?.slug).toBe("mem-a");
      expect(await store.getTenant("tenant-absent")).toBeNull();
      await expect(store.getTenantOrThrow("tenant-absent")).rejects.toThrow(/Unknown account/);
      // Website is the canonical projection of the account's one domain.
      const { websiteOf } = await import("@/domains/account/tenants/types");
      expect(websiteOf(memA)).toEqual({ account_id: "tenant-mem-a", domain: "mem-a.example", canonical_url: "https://mem-a.example" });
    } finally {
      store.setAccountRepositoryForTests(null);
    }
  });

  it("lifecycle: a failed or anomalous account read resolves unavailable, never a redirect or a paused lockout", async () => {
    const store = await import("@/domains/account/tenants/store");
    const { resolveAccountAccess, requireReadyAccount, AccountUnavailableError } = await import("@/domains/account/lifecycle");
    const base = { id: "tenant-lc", slug: "lc", provisional_name: "", domain: "lc.example", signup_date: "2026-01-01",
      tos_accepted_at: null, daily_budget_usd: 5, growth_goal: null, created_at: "2026-01-01", updated_at: "2026-01-01" };
    const withStatus = (row: Record<string, unknown>) => store.mapRowToAccount({ ...base, business_name: "", ...row });
    // An unrecognized physical status is flagged by the mapper and resolved as unavailable, not paused.
    expect(withStatus({ status: "trialing" }).status_unrecognized).toBe(true);
    expect(withStatus({ status: "active" }).status_unrecognized).toBeUndefined();
    const repo = (acct: unknown) => store.setAccountRepositoryForTests({
      getAccountById: async () => { if (acct instanceof Error) throw acct; return acct as never; }, getAccountBySlug: async () => null });
    try {
      repo(new Error("supabase down"));
      expect((await resolveAccountAccess("tenant-lc")).kind).toBe("unavailable");
      await expect(requireReadyAccount("tenant-lc")).rejects.toBeInstanceOf(AccountUnavailableError);
      repo(null);
      expect((await resolveAccountAccess("tenant-lc")).kind).toBe("unavailable");
      repo(withStatus({ status: "trialing" }));
      expect((await resolveAccountAccess("tenant-lc")).kind).toBe("unavailable");
      repo(withStatus({ status: "pending_onboarding" }));
      expect((await resolveAccountAccess("tenant-lc")).kind).toBe("incomplete");
      repo(withStatus({ status: "paused" }));
      expect(await resolveAccountAccess("tenant-lc")).toMatchObject({ kind: "suspended", reason: "paused" });
      repo(withStatus({ status: "active" }));
      expect((await resolveAccountAccess("tenant-lc")).kind).toBe("ready");
    } finally {
      store.setAccountRepositoryForTests(null);
    }
  });
});
