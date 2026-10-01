import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({})); vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "8.8.8.8", family: 4 }] }));
const mem = vi.hoisted(() => ({ upsert: null as null | ((table: string, rows: unknown[]) => { data: unknown[] | null; error: { message: string } | null }), read: null as null | ((table: string, column: string, value: string) => { data: unknown[]; error: null }) }));
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    const handler = mem.upsert;
    if (!handler && !mem.read) throw new Error("test: no section may reach the supabase client");
    return { from: (table: string) => ({ upsert: (rows: unknown[]) => ({ select: async () => handler!(table, rows) }), select: () => ({ eq: async (column: string, value: string) => mem.read!(table, column, value) }) }) };},}));
import { getRepository, usesSupabase } from "@/lib/persistence/repositories";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import type { CrawlFrontierState } from "@/domains/evidence/scanning/crawl-frontier";
import { dualWriteUpsertScoped, syncPageSnapshots } from "@/lib/persistence/dual-write";
const TENANT = "tenant-fixture-local";
const OTHER = "tenant-other";
describe("canonical repository behavioral isolation", () => {
  const ALL_PROMPTS = [{ id: "p-a-1", tenant_id: "tenant-a" }, { id: "p-a-2", tenant_id: "tenant-a" }, { id: "p-c-1", tenant_id: "tenant-c" }];
  const ALL_ENTITIES = [{ id: "e-a-1", tenant_id: "tenant-a" }, { id: "e-c-1", tenant_id: "tenant-c" }];
  it.each([
    ["tenant-a", ["p-a-1", "p-a-2"], ["e-a-1"]],
    ["tenant-c", ["p-c-1"], ["e-c-1"]],
    ["tenant-b-empty", [], []],
  ].flatMap(row => [undefined, "file", "supabase"].map(setting => [...row, setting] as const)))("%s receives its own prompts and entities through canonical SQL", async (tenant, prompts, entities, setting) => {
    const held = process.env.DATA_SOURCE; mem.read = (table, column, value) => { expect([column, value]).toEqual(["tenant_id", tenant]); return { data: (table === "tracked_prompts" ? ALL_PROMPTS : table === "tracked_entities" ? ALL_ENTITIES : []).filter(row => row.tenant_id === value), error: null }; };
    try {
      if (setting === undefined) delete process.env.DATA_SOURCE; else process.env.DATA_SOURCE = setting as string;
      const repo = getRepository().forTenant(tenant as string);
      expect((await repo.getTrackedPrompts()).map(p => p.id).sort()).toEqual(prompts); expect((await repo.getTrackedEntities()).map(e => e.id).sort()).toEqual(entities);
    } finally { mem.read = null; if (held === undefined) delete process.env.DATA_SOURCE; else process.env.DATA_SOURCE = held; }
  });
});
describe("dual-write tenant validation (fires before any I/O)", () => { // ── B. dual-write validation layer ──────────────────────────────────────────
  it("dualWriteUpsertScoped rejects global tables, mismatches, and empty tenantIds", async () => {
    await expect(dualWriteUpsertScoped("tenants", [{ tenant_id: TENANT, id: "x" }], "id", TENANT)).rejects.toThrow(/is a global table/);
    for (const tenant_id of [OTHER, null, undefined]) await expect(dualWriteUpsertScoped("results", [{ tenant_id, id: "r1" }], "id", TENANT)).rejects.toThrow(/tenant mismatch/);
    await expect(dualWriteUpsertScoped("results", [{ tenant_id: TENANT, id: "r1" }], "id", "")).rejects.toThrow(/tenantId must be a non-empty string/);
    await expect(dualWriteUpsertScoped("results", [{ tenant_id: TENANT, id: "r1" }], "id", TENANT)).rejects.toThrow(/no section may reach the supabase client/);});
  it("validates every complete capture before writing and preserves partial and legacy evidence", async () => {
    const snapshot = extractPageSnapshot("<main><h1>Owned page</h1><p>Useful original words stay on file.</p></main>", "https://own.example/page", "page", TENANT), original = JSON.stringify(snapshot); let calls = 0;
    try { mem.upsert = (_table, rows) => { calls++; return { data: rows, error: null }; };
      for (const field of ["h1", "word_count", "content_hash", "headings_hash", "body_text"] as const) await expect(syncPageSnapshots([snapshot, { ...snapshot, id: `${snapshot.id}::local-malformed`, [field]: field === "word_count" ? -1 : "Wrong projection" }], TENANT)).rejects.toThrow(/derived content fields/);
      expect(calls).toBe(0); await expect(syncPageSnapshots([{ ...snapshot, tenant_id: OTHER }], TENANT)).rejects.toThrow(/tenant mismatch/); await expect(syncPageSnapshots([], "")).rejects.toThrow(/tenantId must be a non-empty string/);
      await syncPageSnapshots([{ ...snapshot, content_capture: undefined }], TENANT);
      for (const complete of [true, false]) {
        const { tenant_id: _scope, ...unscoped } = snapshot;
        const rows = Array.from({ length: 501 }, (_, index) => ({ ...unscoped, id: `${snapshot.id}::local-${index}`, ...(index === 0 ? {} : { tenant_id: index < 4 ? [undefined, null, "", TENANT][index] : TENANT }), h1: index === 500 && !complete ? "Partial projection" : snapshot.h1, content_capture: { ...snapshot.content_capture!, complete: index === 500 ? complete : true, jsonLd: [...snapshot.content_capture!.jsonLd] } } as typeof snapshot));
        const capture = rows[500].content_capture!;
        mem.upsert = (_table, chunk) => {
          if (chunk.length === 500) Object.assign(capture, { mainHtml: "<main><h1>Caller mutation</h1></main>", complete: true });
          if (chunk.length === 500) capture.jsonLd.push('{"callerMutation":true}');
          expect(chunk.map(row => [(row as typeof snapshot).tenant_id, (row as typeof snapshot).content_capture])).toEqual(chunk.map(row => [TENANT, { ...snapshot.content_capture!, complete: (row as typeof snapshot).id.endsWith("-500") ? complete : true }]));
          return { data: chunk, error: null };
        };
        await syncPageSnapshots(rows, TENANT);
        expect([Object.hasOwn(rows[0], "tenant_id"), rows.slice(0, 4).map(row => row.tenant_id), JSON.stringify(snapshot)]).toEqual([false, [undefined, null, "", TENANT], original]);
      }
    } finally { mem.upsert = null; } });});
describe("a canonical write that did not land never reads as done", () => {
  const ROW = [{ tenant_id: TENANT, id: "r1" }, { tenant_id: TENANT, id: "r2" }];
  it("requires every scoped submitted key exactly once, preserving errors and empty batches", async () => {
    const [a, b] = ROW, malformed = [[], [a], [a, { ...b, id: "foreign" }], [a, { ...b, tenant_id: OTHER }], [a, a], [a, { tenant_id: TENANT }]];
    let calls = 0;
    try {
      mem.upsert = () => ({ data: null, error: { message: 'column "id" does not exist' } });
      await expect(dualWriteUpsertScoped("results", ROW, "id", TENANT)).rejects.toThrow(/does not exist/);
      for (const data of malformed) { mem.upsert = () => { calls++; return { data, error: null }; }; await expect(dualWriteUpsertScoped("results", ROW, "id", TENANT)).rejects.toThrow(/2 row\(s\) sent/); }
      expect(calls).toBe(malformed.length);
      mem.upsert = () => ({ data: [b, a], error: null });
      await expect(dualWriteUpsertScoped("results", ROW, "id", TENANT)).resolves.toBeUndefined();
      mem.upsert = () => { throw new Error("empty batch reached transport"); }; await expect(dualWriteUpsertScoped("results", [], "id", TENANT)).resolves.toBeUndefined();
    } finally { mem.upsert = null; } });
  it("refills and retries a page until registry, snapshot, and inventory writes all land", async () => {
    const { runCrawlBatch } = await import("@/domains/evidence/scanning/crawl-frontier"); const url = "https://own.example/a", ISO = "2026-07-31T00:00:00.000Z", html = "<html><body><main><h1>A page</h1><p>Some words on the page.</p></main></body></html>";
    let phase: "registry" | "snapshot" | "inventory" | "ok" = "registry", inventoried = false, fetches = 0; const writes: string[] = [];
    const fetchImpl = (async (u: string) => { if (!String(u).endsWith("robots.txt")) fetches++; return new Response(String(u).endsWith("robots.txt") ? "" : html, { status: String(u).endsWith("robots.txt") ? 404 : 200, headers: { "content-type": "text/html" } }); }) as typeof fetch;
    const initial = { tenant_id: TENANT, domain: "own.example", status: "in_progress", frontier: [], visited: [], pages_crawled: 0,
      pages_failed: 0, page_cap: 10, source: "homepage", started_at: ISO, updated_at: ISO, last_batch_at: null, batches_run: 0, page_facts: [] } as CrawlFrontierState; let saved = initial;
    const deps = { fetchImpl, sleep: async () => {}, now: () => Date.parse(ISO), loadState: async () => saved, saveState: async (s: CrawlFrontierState) => { saved = s; },
      pickCandidates: async () => inventoried ? [] : [url], readInventoryImpl: async () => [], syncPagesImpl: async () => { writes.push("registry"); if (phase === "registry") throw new Error("registry rejected"); },
      syncPageSnapshotsImpl: async () => { writes.push("snapshot"); if (phase === "snapshot") throw new Error("snapshot rejected"); }, recordCrawled: async (tenant: string, readUrl: string) => { expect([tenant, readUrl]).toEqual([TENANT, url]); writes.push("inventory"); if (phase === "inventory") return false; inventoried = true; return true; } };
    for (const [failure, expected] of [["registry", ["registry"]], ["snapshot", ["registry", "snapshot"]], ["inventory", ["registry", "snapshot", "inventory"]]] as const) {
      phase = failure; writes.length = 0; const out = await runCrawlBatch({ tenantId: TENANT, deps }); expect([out.status, out.crawled, out.complete, inventoried, saved, writes]).toEqual(["in_progress", 0, false, false, initial, expected]); }
    phase = "ok"; writes.length = 0; const done = await runCrawlBatch({ tenantId: TENANT, deps }); expect([done.status, done.crawled, done.complete, inventoried, saved.pages_crawled, fetches, writes]).toEqual(["complete", 1, true, true, 1, 4, ["registry", "snapshot", "inventory"]]); });});
describe("canonical feedback persistence", () => {
  it("reads canonical responses when the disk cache is empty", async () => {
    const responses = [{ recId: "reader-task", status: "dismissed", respondedAt: "2026-09-30T00:00:00Z", deferUntil: null }];
    vi.doMock("@/lib/persistence/repositories", () => ({ usesSupabase,
      getRepository: () => ({ forTenant: () => ({ getRecommendationResponses: async () => responses }) }) }));
    vi.resetModules();
    try { const store = await import("@/domains/evidence/product/recommendation-response-store"); expect(await store.getRecommendationResponses()).toEqual(responses); }
    finally { vi.doUnmock("@/lib/persistence/repositories"); vi.resetModules(); }
  });
});
describe("generic Account + BusinessProfile (Slice 1 closure)", () => {
  const NEW_USER = { userId: "12345678-abcd-abcd-abcd-1234567890ab", email: "owner@gmail.com" };
  it("provisions through one guarded RPC and refuses an unexpected owner receipt", async () => {
    const { provisionTenantForNewUser } = await import("@/domains/account/onboarding/provision-tenant");
    const rpc = vi.fn(async () => ({ data: [{ tenant_id: "tenant-12345678abcdabcdabcd1234567890ab", created: true }], error: null }));
    const client = { rpc, from: () => { throw new Error("split write"); } } as never;
    expect(await provisionTenantForNewUser(client, NEW_USER)).toEqual({ ok: true, tenantId: "tenant-12345678abcdabcdabcd1234567890ab", created: true });
    expect(rpc).toHaveBeenCalledWith("provision_account_owner", { p_user_id: NEW_USER.userId, p_business_name: "New Beacon Account" });
    rpc.mockResolvedValueOnce({ data: [{ tenant_id: "tenant-12345678", created: true }], error: null }); expect((await provisionTenantForNewUser(client, NEW_USER)).ok).toBe(false);});
  it("cold first read resolves the real account identity; no placeholder is ever cached as identity", async () => {
    const bp = await import("@/domains/account/business-profile");
    bp.__resetBusinessProfileCacheForTests();
    const row = { schemaVersion: 2, name: { value: "Real Cold Co", origin: "operator_confirmed", confidence: 1, sourceUrls: [] } }; let loads = 0;
    bp.setBusinessProfileRepositoryForTests({
      load: async () => {
        loads++;
        if (loads === 1) return null; // First call: the row does NOT exist yet (cold signup race)…
        return row as never;}, // …then the durable row lands.
      save: async () => ({ ok: true }),});
    try {
      const first = await bp.loadBusinessProfile("tenant-cold");
      expect(first.name.value).toBe(""); // honest empty, not another business
      const second = await bp.loadBusinessProfile("tenant-cold"); expect(second.name.value).toBe("Real Cold Co"); // The miss must NOT have been memoized: the next read sees the real row.
      const before = loads; await bp.loadBusinessProfile("tenant-cold"); // And the REAL profile is now cached (no further repo hits).
      expect(loads).toBe(before);
    } finally {
      bp.setBusinessProfileRepositoryForTests(null);
      bp.__resetBusinessProfileCacheForTests();}});
  it("a transient repository failure recovers on the next read", async () => {
    const bp = await import("@/domains/account/business-profile");
    bp.__resetBusinessProfileCacheForTests();
    let calls = 0;
    bp.setBusinessProfileRepositoryForTests({
      load: async () => {
        calls++;
        if (calls === 1) throw new Error("transient network failure");
        return { schemaVersion: 2, name: { value: "Recovered Co", origin: "operator_confirmed", confidence: 1, sourceUrls: [] } } as never;},
      save: async () => ({ ok: true }),});
    try {
      const first = await bp.loadBusinessProfile("tenant-flaky");
      expect(first.name.value).toBe(""); // fail-generic now…
      const second = await bp.loadBusinessProfile("tenant-flaky");
      expect(second.name.value).toBe("Recovered Co"); // …retry succeeded
    } finally {
      bp.setBusinessProfileRepositoryForTests(null);
      bp.__resetBusinessProfileCacheForTests();}});
  it("one account's cached identity can never serve another account", async () => {
    const bp = await import("@/domains/account/business-profile");
    bp.__resetBusinessProfileCacheForTests();
    bp.setBusinessProfileRepositoryForTests({
      load: async (id) =>
        id === "tenant-a"
          ? ({ schemaVersion: 2, name: { value: "Account A", origin: "operator_confirmed", confidence: 1, sourceUrls: [] } } as never)
          : null,
      save: async () => ({ ok: true }),});
    try {
      const a = await bp.loadBusinessProfile("tenant-a"); expect(a.name.value).toBe("Account A");
      const b = await bp.loadBusinessProfile("tenant-b"); expect(b.name.value).toBe("");
      expect(b.accountId).toBe("tenant-b");
    } finally {
      bp.setBusinessProfileRepositoryForTests(null);
      bp.__resetBusinessProfileCacheForTests();}});
  it("a historical pre-canonical row maps into canonical sections with legacy provenance and preserved raw JSON", async () => {
    const bp = await import("@/domains/account/business-profile");
    const legacyRow = {
      name: "Historic Publisher", businessType: "content_publisher", contentSiteMode: true, services: ["guides"],
      serviceTerms: ["reference articles"], locations: ["US"], keyPages: ["/about"], contentRules: ["Use plain English."],
      flaggedTerms: ["cheap"], authoritativeSourceDomains: ["wikipedia.org"], primaryCompetitors: ["rival.example"],
      yelpBusinessId: "legacy-yelp", revenueModel: { kind: "rpm", rpmUsd: 5 },};
    const profile = bp.profileFromRow("tenant-hist", legacyRow as never); expect(profile.schemaVersion).toBe(2);
    expect(profile.name.value).toBe("Historic Publisher"); expect(profile.name.origin).toBe("legacy");
    expect(profile.businessType.value).toBe("content_publisher"); expect(profile.siteArchetype.value).toBe("content_site");
    expect(profile.offerings.value.sort()).toEqual(["guides", "reference articles"].sort()); expect(profile.geographicScope.value).toEqual(["US"]);
    expect(profile.importantPages.value).toEqual(["/about"]); expect(profile.constraints.value.editorial).toEqual(["Use plain English."]);
    expect(profile.constraints.value.bannedTerms).toEqual(["cheap"]); expect(profile.trustedSourceDomains.value).toEqual(["wikipedia.org"]);
    expect(profile.competitors.value).toEqual([{ name: "rival.example", evidenceUrls: [] }]);
    expect(profile.legacy).toEqual(legacyRow); // Raw legacy JSON preserved verbatim and inert.
    expect("yelpBusinessId" in profile).toBe(false); expect("revenueModel" in profile).toBe(false); // Removed contract fields do not surface as active truth.
    expect("domain" in profile).toBe(false);});
  it("active customer copy uses the BusinessProfile name, never the provisional signup seed", async () => {
    vi.doMock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-copy" }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    const store = await import("@/domains/account/tenants/store"); const bp = await import("@/domains/account/business-profile");
    bp.__resetBusinessProfileCacheForTests();
    const account = {
      id: "tenant-copy", slug: "copy", provisional_name: "seed-name-visible-nowhere", domain: "copy-co.example", status: "active" as const,
      signup_date: "2026-01-01", tos_accepted_at: null, daily_budget_usd: 5, growth_goal: null, created_at: "2026-01-01", updated_at: "2026-01-01" };
    store.setAccountRepositoryForTests({
      getAccountById: async (id) => (id === account.id ? account : null),
      getAccountBySlug: async () => null,});
    bp.seedBusinessProfileForTests("tenant-copy", {
      name: { value: "Confirmed Co", origin: "operator_confirmed", confidence: 1, sourceUrls: [] },});
    try {
      const { loadSetup } = await import("@/app/(shell)/settings/config/actions"); const view = await loadSetup();
      expect(view.name).toBe("Confirmed Co"); expect(view.name).not.toContain("seed-name");
      expect(view.websiteDomain).toBe("copy-co.example");
    } finally {
      store.setAccountRepositoryForTests(null);
      bp.setBusinessProfileRepositoryForTests(null);
      bp.__resetBusinessProfileCacheForTests();
      vi.doUnmock("@/lib/tenant-context");
      vi.doUnmock("next/cache");}});
  it("the account store resolves through the injected scoped repository and fails to no-account, never a default", async () => {
    const store = await import("@/domains/account/tenants/store");
    const memA = {
      id: "tenant-mem-a", slug: "mem-a", provisional_name: "Mem A", domain: "mem-a.example", status: "active" as const,
      signup_date: "2026-01-01", tos_accepted_at: null, daily_budget_usd: 5, growth_goal: null, created_at: "2026-01-01", updated_at: "2026-01-01" };
    store.setAccountRepositoryForTests({
      getAccountById: async (id) => (id === memA.id ? memA : null),
      getAccountBySlug: async (slug) => (slug === memA.slug ? memA : null),});
    try {
      expect((await store.getTenant("tenant-mem-a"))?.slug).toBe("mem-a"); expect(await store.getTenant("tenant-absent")).toBeNull();
      await expect(store.getTenantOrThrow("tenant-absent")).rejects.toThrow(/Unknown account/);
      const { websiteOf } = await import("@/domains/account/tenants/types"); expect(websiteOf(memA)).toEqual({ account_id: "tenant-mem-a", domain: "mem-a.example", canonical_url: "https://mem-a.example" }); // Website is the canonical projection of the account's one domain.
    } finally {
      store.setAccountRepositoryForTests(null);}});
  it("lifecycle: a failed or anomalous account read resolves unavailable, never a redirect or a paused lockout", async () => {
    const store = await import("@/domains/account/tenants/store"); const { resolveAccountAccess, requireReadyAccount, AccountUnavailableError } = await import("@/domains/account/lifecycle");
    const base = { id: "tenant-lc", slug: "lc", provisional_name: "", domain: "lc.example", signup_date: "2026-01-01",
      tos_accepted_at: null, daily_budget_usd: 5, growth_goal: null, created_at: "2026-01-01", updated_at: "2026-01-01" };
    const withStatus = (row: Record<string, unknown>) => store.mapRowToAccount({ ...base, business_name: "", ...row });
    expect(withStatus({ status: "trialing" }).status_unrecognized).toBe(true); expect(withStatus({ status: "active" }).status_unrecognized).toBeUndefined(); // An unrecognized physical status is flagged by the mapper and resolved as unavailable, not paused.
    const repo = (acct: unknown) => store.setAccountRepositoryForTests({
      getAccountById: async () => { if (acct instanceof Error) throw acct; return acct as never; }, getAccountBySlug: async () => null });
    try {
      repo(new Error("supabase down"));
      expect(await resolveAccountAccess("tenant-lc")).toMatchObject({ kind: "unavailable", reason: "unreadable" }); // a read that never came back
      await expect(requireReadyAccount("tenant-lc")).rejects.toBeInstanceOf(AccountUnavailableError);
      repo(null);
      expect(await resolveAccountAccess("tenant-lc")).toMatchObject({ kind: "unavailable", reason: "missing" }); // NOT the same fact
      repo(withStatus({ status: "trialing" }));
      expect((await resolveAccountAccess("tenant-lc")).kind).toBe("unavailable");
      repo(withStatus({ status: "pending_onboarding" }));
      expect((await resolveAccountAccess("tenant-lc")).kind).toBe("incomplete");
      await expect(requireReadyAccount("tenant-lc")).rejects.toMatchObject({ digest: expect.stringContaining("/onboard") }); // every product path resumes setup
      repo(withStatus({ status: "paused" }));
      expect(await resolveAccountAccess("tenant-lc")).toMatchObject({ kind: "suspended", reason: "paused" });
      repo(withStatus({ status: "active" })); // ACTIVE IS A STATUS, NOT PROOF OF SETUP, and AN OUTAGE IS NOT INCOMPLETENESS: with no database here the setup truth cannot be read at all, so the one verdict is the bounded retry surface and never a bounce back into setup for a customer who finished it months ago, while an account with no website at all resumes at the step that asks for one.
      expect(await resolveAccountAccess("tenant-lc")).toMatchObject({ kind: "unavailable", reason: "unreadable" });
      repo(withStatus({ status: "active", domain: "" }));
      await expect(requireReadyAccount("tenant-lc")).rejects.toMatchObject({ digest: expect.stringContaining("/onboard?step=1") });
    } finally {
      store.setAccountRepositoryForTests(null);}});});
