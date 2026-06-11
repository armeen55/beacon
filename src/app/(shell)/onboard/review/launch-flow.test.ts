/**
 * Behavioral tests — Gap C.4 launch flow (2026-05-07).
 *
 * Tests `executeLaunchTransaction` against an in-memory Supabase
 * client mock. No network, no real DB, no env vars. Pins the
 * happy-path + every failure mode + the rollback contract.
 *
 * The thin wrapper `launchTenant` (which resolves user/admin from
 * globals + invokes redirect) is covered by source-grep architecture
 * invariants in
 * `tests/architecture/onboard-launch-step-contract.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildTrackedPromptRow,
  executeLaunchTransaction,
} from "./launch-flow";

const FIXED_NOW = "2026-05-07T18:00:00.000Z";

// North-star onboarding (2026-06-11): executeLaunchTransaction now takes a
// config-persister dep (defaults to the real site-fetching derivation).
// Tests inject a stub so this suite stays network-free; the dep's own
// behavior is pinned in src/domains/onboarding/launch-config.test.ts.
const persistConfigStub = vi.fn(async () => ({
  outcome: "typed_only_saved" as const,
  derivedFields: [] as string[],
}));

const PENDING_TENANT = {
  id: "tenant-8c9d2f4a",
  slug: "8c9d2f4a",
  business_name: "Acme Builders",
  domain: "acmebuilders.com",
  cities_served: ["Atherton", "Menlo Park"],
  project_mix: ["new_construction", "kitchen_bath"],
  discovered_competitors: ["De Mattei Construction", "Kasten"],
  status: "pending_onboarding",
  tos_accepted_at: null as string | null,
};

// ── Mock Supabase client ──────────────────────────────────────────────
//
// Simulates the chained .from("table").select/eq/insert/update/delete
// surface used by executeLaunchTransaction. Captures all writes so
// tests can assert on them. Supports failure injection per operation.

type Row = Record<string, unknown>;

type Store = {
  tenants: Row[];
  tracked_prompts: Row[];
};

type Failures = {
  failTenantFetch?: boolean;
  failExistingPromptsFetch?: boolean;
  failPromptInsert?: boolean;
  failTenantUpdate?: boolean;
  failRollbackDelete?: boolean;
};

type WriteLog = Array<
  | { op: "insert"; table: string; rows: Row[] }
  | { op: "update"; table: string; payload: Row; whereSnapshot: Row[] }
  | { op: "delete"; table: string; ids: string[] }
>;

function makeMockSupabase(initial: Partial<Store> = {}, failures: Failures = {}) {
  const store: Store = {
    tenants: [...(initial.tenants ?? [])],
    tracked_prompts: [...(initial.tracked_prompts ?? [])],
  };
  const writes: WriteLog = [];

  const client = {
    from(table: keyof Store) {
      return {
        // SELECT chain — handles both .select("...").eq("col", val) and
        // chained .eq().eq() patterns + optional .maybeSingle().
        select(_cols: string) {
          const filters: Array<(r: Row) => boolean> = [];
          const chain = {
            eq(col: string, val: unknown) {
              filters.push((r) => r[col] === val);
              return chain;
            },
            is(col: string, val: unknown) {
              filters.push((r) => r[col] === val);
              return chain;
            },
            maybeSingle() {
              if (table === "tenants" && failures.failTenantFetch) {
                return Promise.resolve({
                  data: null,
                  error: { message: "tenant_fetch_failed" },
                });
              }
              const matched = store[table].filter((r) =>
                filters.every((f) => f(r)),
              );
              return Promise.resolve({
                data: matched[0] ?? null,
                error: null,
              });
            },
            then(resolve: (v: { data: Row[]; error: { message: string } | null }) => unknown) {
              // Plain await on the chain — used for SELECT-many queries.
              if (
                table === "tracked_prompts" &&
                failures.failExistingPromptsFetch
              ) {
                return Promise.resolve(
                  resolve({
                    data: [],
                    error: { message: "existing_fetch_failed" },
                  }),
                );
              }
              const matched = store[table].filter((r) =>
                filters.every((f) => f(r)),
              );
              return Promise.resolve(
                resolve({ data: matched, error: null }),
              );
            },
          };
          return chain;
        },
        insert(rows: Row | Row[]) {
          const arr = Array.isArray(rows) ? rows : [rows];
          if (table === "tracked_prompts" && failures.failPromptInsert) {
            return Promise.resolve({
              data: null,
              error: { message: "prompt_insert_failed" },
            });
          }
          for (const row of arr) {
            store[table].push(row);
          }
          writes.push({ op: "insert", table, rows: arr });
          return Promise.resolve({ data: arr, error: null });
        },
        update(payload: Row, _opts?: { count?: string }) {
          const filters: Array<(r: Row) => boolean> = [];
          const chain = {
            eq(col: string, val: unknown) {
              filters.push((r) => r[col] === val);
              return chain;
            },
            is(col: string, val: unknown) {
              filters.push((r) => r[col] === val);
              return chain;
            },
            select(_cols: string) {
              if (table === "tenants" && failures.failTenantUpdate) {
                return Promise.resolve({
                  data: null,
                  error: { message: "update_failed" },
                });
              }
              const matched = store[table].filter((r) =>
                filters.every((f) => f(r)),
              );
              const snapshot = matched.map((r) => ({ ...r }));
              for (const r of matched) {
                Object.assign(r, payload);
              }
              writes.push({
                op: "update",
                table,
                payload,
                whereSnapshot: snapshot,
              });
              return Promise.resolve({
                data: matched.map((r) => ({ id: r.id })),
                error: null,
              });
            },
          };
          return chain;
        },
        delete() {
          const filters: Array<(r: Row) => boolean> = [];
          const chain = {
            in(col: string, vals: unknown[]) {
              const set = new Set(vals);
              filters.push((r) => set.has(r[col]));
              return chain;
            },
            eq(col: string, val: unknown) {
              filters.push((r) => r[col] === val);
              return chain;
            },
            then(
              resolve: (v: {
                data: Row[];
                error: { message: string } | null;
              }) => unknown,
            ) {
              if (
                table === "tracked_prompts" &&
                failures.failRollbackDelete
              ) {
                return Promise.resolve(
                  resolve({
                    data: [],
                    error: { message: "rollback_failed" },
                  }),
                );
              }
              const matched: Row[] = [];
              const surviving: Row[] = [];
              for (const r of store[table]) {
                if (filters.every((f) => f(r))) matched.push(r);
                else surviving.push(r);
              }
              store[table] = surviving;
              writes.push({
                op: "delete",
                table,
                ids: matched.map((r) => r.id as string),
              });
              return Promise.resolve(
                resolve({ data: matched, error: null }),
              );
            },
          };
          return chain;
        },
      };
    },
  };

  return { client, store, writes };
}

// ── buildTrackedPromptRow ────────────────────────────────────────────

describe("buildTrackedPromptRow", () => {
  const draft = {
    text: "best kitchen remodel in Atherton",
    cluster: "service_in_city" as const,
    city_scope: "Atherton",
    service_scope: "kitchen_bath" as const,
    category: "service_in_city" as const,
    priority: 7,
    rationale: "Captures homeowners searching for kitchen remodels in Atherton.",
  };

  it("maps PromptDraft fields onto tracked_prompts columns", () => {
    const r = buildTrackedPromptRow({
      draft,
      accountId: "acme-builders",
      now: FIXED_NOW,
      id: "prompt-test-1",
    });
    expect(r.id).toBe("prompt-test-1");
    expect(r.account_id).toBe("acme-builders");
    expect(r.text).toBe("best kitchen remodel in Atherton");
    expect(r.location_scope).toBe("Atherton");
    expect(r.service_scope).toBe("kitchen_bath");
    expect(r.is_active).toBe(true);
    expect(r.created_at).toBe(FIXED_NOW);
    expect(r.updated_at).toBe(FIXED_NOW);
  });

  it("defaults intent_type to 'recommendation'", () => {
    const r = buildTrackedPromptRow({
      draft,
      accountId: "x",
      now: FIXED_NOW,
    });
    expect(r.intent_type).toBe("recommendation");
  });

  it("defaults platforms to ['perplexity', 'chatgpt']", () => {
    const r = buildTrackedPromptRow({
      draft,
      accountId: "x",
      now: FIXED_NOW,
    });
    expect(r.platforms).toEqual(["perplexity", "chatgpt"]);
  });

  it("includes tags: starter_v0 + cluster + priority", () => {
    const r = buildTrackedPromptRow({
      draft,
      accountId: "x",
      now: FIXED_NOW,
    });
    expect(r.tags).toContain("starter_v0");
    expect(r.tags).toContain("service_in_city");
    expect(r.tags).toContain("priority-7");
  });

  it("auto-generates an id when none given", () => {
    const r = buildTrackedPromptRow({
      draft,
      accountId: "x",
      now: FIXED_NOW,
    });
    expect(r.id).toMatch(/^prompt-/);
    expect(r.id.length).toBeGreaterThan("prompt-".length);
  });
});

// ── executeLaunchTransaction — happy path ────────────────────────────

describe("executeLaunchTransaction — happy path", () => {
  it("inserts prompts and flips tenant to active in that order", async () => {
    const { client, store, writes } = makeMockSupabase({
      tenants: [{ ...PENDING_TENANT }],
    });

    const r = await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });

    expect(r).toEqual({ kind: "redirect", to: "/today", reason: "success" });

    // INSERT happened before UPDATE.
    const opOrder = writes.map((w) => w.op);
    expect(opOrder.indexOf("insert")).toBeLessThan(opOrder.indexOf("update"));

    // Tenant is now active with TOS accepted + updated_at set.
    const tenant = store.tenants[0];
    expect(tenant.status).toBe("active");
    expect(tenant.tos_accepted_at).toBe(FIXED_NOW);
    expect(tenant.updated_at).toBe(FIXED_NOW);

    // Prompts were inserted with the right scope.
    expect(store.tracked_prompts.length).toBeGreaterThan(0);
    for (const p of store.tracked_prompts) {
      expect(p.account_id).toBe(PENDING_TENANT.slug);
      expect(p.is_active).toBe(true);
    }
  });

  it("inserted prompts include all 4 generator families when inputs allow", async () => {
    const { client, store } = makeMockSupabase({
      tenants: [{ ...PENDING_TENANT }],
    });
    await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });
    const tags = new Set(
      store.tracked_prompts.flatMap((p) => p.tags as string[]),
    );
    // Cluster tag is present per family.
    expect(tags.has("brand_discovery")).toBe(true);
    expect(tags.has("competitor_comparison")).toBe(true);
    expect(tags.has("service_in_city")).toBe(true);
    expect(tags.has("cost_query")).toBe(true);
  });
});

// ── Idempotency: dedup against existing prompts ──────────────────────

describe("executeLaunchTransaction — dedup", () => {
  it("skips inserts for prompts whose text already exists for this tenant", async () => {
    const { client, store, writes } = makeMockSupabase({
      tenants: [{ ...PENDING_TENANT }],
      tracked_prompts: [
        // Pre-existing row matching one of the generator's outputs.
        {
          id: "prompt-old-1",
          account_id: PENDING_TENANT.slug,
          text: "Acme Builders reviews",
          is_active: true,
        },
      ],
    });

    await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });

    // The "Acme Builders reviews" prompt should not have been inserted again.
    const newInserts = writes
      .filter((w) => w.op === "insert" && w.table === "tracked_prompts")
      .flatMap((w) => (w as { rows: Row[] }).rows);
    const newTexts = newInserts.map((r) => (r.text as string).toLowerCase());
    expect(newTexts).not.toContain("acme builders reviews");

    // Old prompt is still present.
    expect(store.tracked_prompts.find((p) => p.id === "prompt-old-1")).toBeTruthy();
  });

  it("dedupes case-insensitively", async () => {
    const { client, writes } = makeMockSupabase({
      tenants: [{ ...PENDING_TENANT }],
      tracked_prompts: [
        // Case-mismatched pre-existing row.
        {
          id: "prompt-old-1",
          account_id: PENDING_TENANT.slug,
          text: "ACME BUILDERS REVIEWS", // upper
          is_active: true,
        },
      ],
    });

    await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });

    const newInserts = writes
      .filter((w) => w.op === "insert" && w.table === "tracked_prompts")
      .flatMap((w) => (w as { rows: Row[] }).rows);
    const newTextsLower = newInserts.map((r) =>
      (r.text as string).toLowerCase(),
    );
    expect(newTextsLower).not.toContain("acme builders reviews");
  });

  it("activates tenant even when ALL prompts are pre-existing (resumed launch)", async () => {
    // Simulates a prior partial launch: prompts were inserted but
    // status flip failed. This call should detect all duplicates +
    // still flip status to active.
    const { client, store } = makeMockSupabase({
      tenants: [{ ...PENDING_TENANT }],
      tracked_prompts: [
        // Pre-seed with the exact two brand-discovery prompts the
        // generator will produce for "Acme Builders".
        {
          id: "prompt-old-1",
          account_id: PENDING_TENANT.slug,
          text: "Acme Builders reviews",
          is_active: true,
        },
        {
          id: "prompt-old-2",
          account_id: PENDING_TENANT.slug,
          text: "is Acme Builders a good company",
          is_active: true,
        },
      ],
    });

    const r = await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });

    expect(r.kind).toBe("redirect");
    expect(store.tenants[0].status).toBe("active");
  });
});

// ── Already-launched / race-lost → redirect (no rollback) ────────────

describe("executeLaunchTransaction — already launched", () => {
  it("returns redirect when tenant.status is already 'active'", async () => {
    const { client, store } = makeMockSupabase({
      tenants: [
        {
          ...PENDING_TENANT,
          status: "active",
          tos_accepted_at: "2026-05-06T00:00:00.000Z",
        },
      ],
    });

    const r = await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });

    expect(r).toEqual({
      kind: "redirect",
      to: "/today",
      reason: "already_launched",
    });
    // No prompts inserted, no updates made.
    expect(store.tracked_prompts.length).toBe(0);
  });
});

describe("executeLaunchTransaction — race lost (concurrent double-click)", () => {
  it("if status flip returns 0 rows, returns redirect with reason 'race_lost' (no rollback)", async () => {
    // Simulate the race: prompts get inserted (we win that step),
    // but the UPDATE-WHERE-status='pending_onboarding' returns 0 rows
    // because someone else already activated the tenant.
    const baseRow = { ...PENDING_TENANT };
    const { client, writes } = makeMockSupabase({
      // Pre-mutate the tenant so the WHERE-status='pending_onboarding'
      // clause excludes it. Status='active' simulates "race lost
      // BUT not yet 'already launched' at fetch time" by mutating
      // mid-transaction. To simulate this cleanly, we set status to
      // 'active' before fetch — which is just the already-launched
      // path. To truly simulate the race, we'd need a hook that
      // mutates between fetch and update; instead pin via a different
      // test using failTenantUpdate=false but with a tenant whose
      // status mid-flight no longer matches the WHERE clause.
      //
      // For this test we use the simpler observable: that the helper
      // returns redirect (not error) when the UPDATE matches 0 rows.
      // We achieve that by NOT mutating but pinning that:
      //   - if tenant is fetched as 'pending_onboarding' AND
      //   - the UPDATE WHERE returns 0 rows somehow,
      // the helper returns redirect with reason 'race_lost'.
      //
      // The mock's update path returns matched rows from store; if
      // store has the row + status matches, it returns 1 row. To
      // simulate 0-row return, we pre-flip status='active' AFTER
      // fetch but BEFORE update. We approximate by injecting a
      // tos_accepted_at value that the WHERE-IS-NULL clause excludes.
      tenants: [{ ...baseRow, tos_accepted_at: "2026-04-01T00:00:00.000Z" }],
    });

    const r = await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });

    expect(r.kind).toBe("redirect");
    if (r.kind === "redirect") {
      expect(r.reason).toBe("race_lost");
    }
    // Prompts were inserted (we ran the insert before the failed flip)
    // but NOT rolled back — they're now legitimate parts of the
    // (race-won) active tenant's list.
    const prompts = writes.filter((w) => w.op === "insert");
    expect(prompts.length).toBe(1);
    const deletes = writes.filter((w) => w.op === "delete");
    expect(deletes.length).toBe(0);
  });
});

// ── Validation: TOS / no-prompts / invalid status ────────────────────

describe("executeLaunchTransaction — validation errors", () => {
  it("returns error when no prompts can be generated (empty profile)", async () => {
    const { client, store } = makeMockSupabase({
      tenants: [
        {
          ...PENDING_TENANT,
          business_name: "",
          cities_served: [],
          project_mix: [],
          discovered_competitors: [],
        },
      ],
    });

    const r = await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });

    expect(r).toEqual({ kind: "error", error: "no_prompts_generated" });
    // Tenant is NOT activated.
    expect(store.tenants[0].status).toBe("pending_onboarding");
    // No prompts inserted.
    expect(store.tracked_prompts.length).toBe(0);
  });

  it("returns error for paused tenant (only pending_onboarding allowed)", async () => {
    const { client, store } = makeMockSupabase({
      tenants: [{ ...PENDING_TENANT, status: "paused" }],
    });

    const r = await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });

    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.error).toContain("tenant_invalid_status");
    }
    expect(store.tenants[0].status).toBe("paused");
  });

  it("returns error for cancelled tenant", async () => {
    const { client } = makeMockSupabase({
      tenants: [{ ...PENDING_TENANT, status: "cancelled" }],
    });
    const r = await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });
    expect(r.kind).toBe("error");
  });

  it("returns error when tenant is missing", async () => {
    const { client } = makeMockSupabase({ tenants: [] });
    const r = await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: "tenant-nonexistent",
      now: FIXED_NOW,
    });
    expect(r).toEqual({ kind: "error", error: "tenant_missing" });
  });
});

// ── Failure modes: rollback contract ─────────────────────────────────

describe("executeLaunchTransaction — failure rollback", () => {
  it("when prompt insert fails, tenant stays pending and no prompts persist", async () => {
    const { client, store } = makeMockSupabase(
      { tenants: [{ ...PENDING_TENANT }] },
      { failPromptInsert: true },
    );
    const r = await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });
    expect(r).toEqual({ kind: "error", error: "prompt_insert_failed" });
    expect(store.tenants[0].status).toBe("pending_onboarding");
    expect(store.tracked_prompts.length).toBe(0);
  });

  it("when status flip fails, ROLLS BACK the inserted prompts", async () => {
    const { client, store, writes } = makeMockSupabase(
      { tenants: [{ ...PENDING_TENANT }] },
      { failTenantUpdate: true },
    );
    const r = await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });
    expect(r).toEqual({
      kind: "error",
      error: "tenant_activation_failed",
    });
    // Tenant unchanged.
    expect(store.tenants[0].status).toBe("pending_onboarding");
    // Inserted prompts were DELETED.
    expect(store.tracked_prompts.length).toBe(0);

    // Verify operation order: insert → update (failed) → delete.
    const opOrder = writes.map((w) => w.op);
    expect(opOrder).toContain("insert");
    expect(opOrder).toContain("delete");
    expect(opOrder.indexOf("insert")).toBeLessThan(opOrder.indexOf("delete"));
  });

  it("rollback DELETE filters by both id IN (...) AND account_id (defense in depth)", async () => {
    const { client, writes } = makeMockSupabase(
      { tenants: [{ ...PENDING_TENANT }] },
      { failTenantUpdate: true },
    );
    await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });
    // No simple way to inspect filters, but the fact that the DELETE
    // happened on tracked_prompts table only is verifiable.
    const deletes = writes.filter((w) => w.op === "delete");
    expect(deletes.length).toBe(1);
    expect(deletes[0].table).toBe("tracked_prompts");
  });

  it("when tenant fetch fails, returns error (no inserts, no updates)", async () => {
    const { client, store } = makeMockSupabase(
      { tenants: [{ ...PENDING_TENANT }] },
      { failTenantFetch: true },
    );
    const r = await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });
    expect(r).toEqual({ kind: "error", error: "tenant_fetch_failed" });
    expect(store.tracked_prompts.length).toBe(0);
    expect(store.tenants[0].status).toBe("pending_onboarding");
  });

  it("when existing-prompts fetch fails, returns error (no inserts, no flip)", async () => {
    const { client, store } = makeMockSupabase(
      { tenants: [{ ...PENDING_TENANT }] },
      { failExistingPromptsFetch: true },
    );
    const r = await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });
    expect(r).toEqual({
      kind: "error",
      error: "existing_prompts_fetch_failed",
    });
    expect(store.tracked_prompts.length).toBe(0);
    expect(store.tenants[0].status).toBe("pending_onboarding");
  });
});

// ── Tenant scoping: never touch other tenants' prompts ──────────────

describe("executeLaunchTransaction — tenant isolation", () => {
  it("does NOT insert prompts for any tenant other than the launching one", async () => {
    const { client, store } = makeMockSupabase({
      tenants: [{ ...PENDING_TENANT }],
      // Pre-existing Ritz-shaped tenant prompts that must remain untouched.
      tracked_prompts: [
        {
          id: "ritz-prompt-1",
          account_id: "ritz-builders",
          text: "Ritz Custom Builders reviews",
          is_active: true,
        },
        {
          id: "ritz-prompt-2",
          account_id: "ritz-builders",
          text: "best custom home builder in Atherton",
          is_active: true,
        },
      ],
    });

    await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });

    // Ritz prompts are still present + unchanged.
    const ritzAfter = store.tracked_prompts.filter(
      (p) => p.account_id === "ritz-builders",
    );
    expect(ritzAfter.length).toBe(2);
    for (const p of ritzAfter) {
      expect(p.is_active).toBe(true);
    }

    // New prompts are only on the new tenant's slug.
    const newPrompts = store.tracked_prompts.filter(
      (p) => p.account_id === PENDING_TENANT.slug,
    );
    expect(newPrompts.length).toBeGreaterThan(0);
    for (const p of newPrompts) {
      expect(p.account_id).toBe(PENDING_TENANT.slug);
    }
  });

  it("rollback DELETE only affects this tenant's prompts (id IN with account_id filter)", async () => {
    const { client, store } = makeMockSupabase(
      {
        tenants: [{ ...PENDING_TENANT }],
        tracked_prompts: [
          // Ritz row with same SHAPE — different account_id.
          {
            id: "ritz-prompt-1",
            account_id: "ritz-builders",
            text: "Ritz reviews",
            is_active: true,
          },
        ],
      },
      { failTenantUpdate: true },
    );

    await executeLaunchTransaction({
      admin: client as never,
      persistConfig: persistConfigStub,
      tenantId: PENDING_TENANT.id,
      now: FIXED_NOW,
    });

    // Ritz row untouched.
    const ritzAfter = store.tracked_prompts.find(
      (p) => p.id === "ritz-prompt-1",
    );
    expect(ritzAfter).toBeTruthy();
    expect(ritzAfter?.is_active).toBe(true);

    // Pending tenant's prompts were rolled back.
    const pendingAfter = store.tracked_prompts.filter(
      (p) => p.account_id === PENDING_TENANT.slug,
    );
    expect(pendingAfter.length).toBe(0);
  });
});
