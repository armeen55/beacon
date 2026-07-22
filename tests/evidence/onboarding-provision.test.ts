/**
 * Behavioral tests — Gap B (2026-05-07).
 *
 * Tests the provisionTenantForNewUser pipeline against an in-memory
 * mock of the Supabase client. No network, no real DB, no env vars.
 * Pins the idempotency contract + the operator-locked defaults.
 */

import { describe, expect, it, vi } from "vitest";
import {
  PROVISIONING_DEFAULTS,
  derivePlaceholderBusinessName,
  deriveTenantId,
  lookupExistingMembership,
  provisionTenantForNewUser,
} from "@/domains/onboarding/provision-tenant";

// ── Minimal Supabase client mock ──────────────────────────────────────
//
// Captures all writes so tests can assert on them. Implements just the
// chained `.from(table).select().eq()` and `.from(table).upsert()`
// surface that provision-tenant uses. Insufficient for real Supabase
// queries, sufficient for this contract.

type Row = Record<string, unknown>;

type Store = {
  tenants: Row[];
  tenant_members: Row[];
};

function makeMockSupabase(initial: Partial<Store> = {}, opts: {
  failLookup?: boolean;
  failTenantInsert?: boolean;
  failMemberInsert?: boolean;
} = {}) {
  const store: Store = {
    tenants: [...(initial.tenants ?? [])],
    tenant_members: [...(initial.tenant_members ?? [])],
  };

  const writes: Array<{ table: string; rows: Row[] }> = [];

  const client = {
    from(table: keyof Store) {
      return {
        select(_cols: string) {
          return {
            eq(col: string, val: unknown) {
              if (table === "tenant_members" && opts.failLookup) {
                return Promise.resolve({ data: null, error: { message: "lookup_failed" } });
              }
              const data = store[table].filter((r) => r[col] === val);
              return Promise.resolve({ data, error: null });
            },
          };
        },
        upsert(rows: Row | Row[], _opts: { onConflict?: string; ignoreDuplicates?: boolean }) {
          const arr = Array.isArray(rows) ? rows : [rows];
          if (table === "tenants" && opts.failTenantInsert) {
            return Promise.resolve({ error: { message: "tenants_insert_failed" } });
          }
          if (table === "tenant_members" && opts.failMemberInsert) {
            return Promise.resolve({ error: { message: "members_insert_failed" } });
          }
          // Simulate idempotent upsert by id (tenants) or by composite (tenant_members).
          for (const row of arr) {
            const dedupKey = table === "tenants" ? "id" : "user_id";
            const exists = store[table].find((r) => r[dedupKey] === row[dedupKey]);
            if (!exists) store[table].push(row);
          }
          writes.push({ table, rows: arr });
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  return { client, store, writes };
}

const FIXED_NOW = "2026-05-07T18:00:00.000Z";
const NOW_FN = () => FIXED_NOW;

const USER = {
  userId: "8c9d2f4a-1b3e-4567-89ab-cdef01234567",
  email: "joe@acme-builders.com",
};

// ── Pure helpers ──────────────────────────────────────────────────────

describe("deriveTenantId", () => {
  it("produces a deterministic id from the auth user UUID", () => {
    expect(deriveTenantId(USER.userId)).toBe("tenant-8c9d2f4a");
  });

  it("strips dashes and lowercases (UUIDs may arrive uppercase)", () => {
    expect(deriveTenantId("ABCD1234-EF56-7890-AB12-CD34EF567890")).toBe(
      "tenant-abcd1234",
    );
  });

  it("same userId → same tenantId (idempotency at the id level)", () => {
    expect(deriveTenantId(USER.userId)).toBe(deriveTenantId(USER.userId));
  });
});

describe("derivePlaceholderBusinessName", () => {
  it("title-cases the domain prefix", () => {
    expect(derivePlaceholderBusinessName("joe@acmebuilders.com")).toBe(
      "Acmebuilders",
    );
  });

  it("splits on dashes/underscores", () => {
    expect(derivePlaceholderBusinessName("joe@acme-custom-builders.com")).toBe(
      "Acme Custom Builders",
    );
    expect(derivePlaceholderBusinessName("joe@acme_builders.com")).toBe(
      "Acme Builders",
    );
  });

  it("falls back to 'New Beacon Account' on weird email", () => {
    expect(derivePlaceholderBusinessName("noatsign")).toBe("New Beacon Account");
    expect(derivePlaceholderBusinessName("trailing@")).toBe("New Beacon Account");
    expect(derivePlaceholderBusinessName("@nodomain.com")).toBe("Nodomain");
  });

  it("does NOT name the tenant after a personal email provider (gmail/yahoo/…)", () => {
    // Regression: aminarmeen@gmail.com used to provision a tenant named "Gmail".
    expect(derivePlaceholderBusinessName("aminarmeen@gmail.com")).toBe(
      "New Beacon Account",
    );
    expect(derivePlaceholderBusinessName("someone@yahoo.com")).toBe(
      "New Beacon Account",
    );
    expect(derivePlaceholderBusinessName("x@outlook.com")).toBe(
      "New Beacon Account",
    );
  });
});

describe("PROVISIONING_DEFAULTS — operator-locked", () => {
  it("status is pending_onboarding (NEVER active on signup)", () => {
    expect(PROVISIONING_DEFAULTS.status).toBe("pending_onboarding");
    // Pin against accidental flip to 'active' which would auto-include
    // the new tenant in cron polling (Gap A's lister filters status='active').
    expect(PROVISIONING_DEFAULTS.status as string).not.toBe("active");
  });

  it("role is beta_customer (NOT founder, NOT paid_customer)", () => {
    expect(PROVISIONING_DEFAULTS.role).toBe("beta_customer");
  });

  it("daily_budget_usd defaults to 5", () => {
    expect(PROVISIONING_DEFAULTS.daily_budget_usd).toBe(5);
  });

  it("member_role is owner (first user owns their tenant)", () => {
    expect(PROVISIONING_DEFAULTS.member_role).toBe("owner");
  });
});

// ── lookupExistingMembership ──────────────────────────────────────────

describe("lookupExistingMembership", () => {
  it("returns null when no membership row exists", async () => {
    const { client } = makeMockSupabase();
    const r = await lookupExistingMembership(client as never, USER.userId);
    expect(r).toEqual({ tenantId: null, error: null });
  });

  it("returns the tenantId when one membership row exists", async () => {
    const { client } = makeMockSupabase({
      tenant_members: [{ user_id: USER.userId, tenant_id: "tenant-existing", role: "owner" }],
    });
    const r = await lookupExistingMembership(client as never, USER.userId);
    expect(r).toEqual({ tenantId: "tenant-existing", error: null });
  });

  it("surfaces lookup errors", async () => {
    const { client } = makeMockSupabase({}, { failLookup: true });
    const r = await lookupExistingMembership(client as never, USER.userId);
    expect(r.tenantId).toBeNull();
    expect(r.error).toBe("lookup_failed");
  });
});

// ── provisionTenantForNewUser ─────────────────────────────────────────

describe("provisionTenantForNewUser — happy path", () => {
  it("creates tenants + tenant_members rows when none exist (created: true)", async () => {
    const { client, store } = makeMockSupabase();
    const r = await provisionTenantForNewUser(client as never, USER, NOW_FN);
    expect(r).toEqual({ ok: true, tenantId: "tenant-8c9d2f4a", created: true });
    expect(store.tenants.length).toBe(1);
    expect(store.tenant_members.length).toBe(1);
  });

  it("inserted tenant has all operator-locked defaults", async () => {
    const { client, store } = makeMockSupabase();
    await provisionTenantForNewUser(client as never, USER, NOW_FN);
    const t = store.tenants[0];
    expect(t.id).toBe("tenant-8c9d2f4a");
    expect(t.slug).toBe("8c9d2f4a");
    expect(t.business_name).toBe("Acme Builders");
    expect(t.domain).toBe("");
    // Audit #17 (2026-06-10): neutral default segment (all local-service
    // features off) so a stranger isn't born a builder. Onboarding sets
    // the real segment.
    expect(t.segment).toBe("content_publisher");
    expect(t.budget_range).toBe("mixed");
    expect(t.role).toBe("beta_customer");
    expect(t.daily_budget_usd).toBe(5);
    expect(t.status).toBe("pending_onboarding");
    expect(t.email_frequency).toBe("off");
    expect(t.tos_accepted_at).toBeNull();
    expect(t.project_mix).toEqual([]);
    expect(t.cities_served).toEqual([]);
    expect(t.discovered_competitors).toEqual([]);
    expect(t.signup_date).toBe(FIXED_NOW);
    expect(t.created_at).toBe(FIXED_NOW);
  });

  it("inserted tenant_members has owner role + correct ids", async () => {
    const { client, store } = makeMockSupabase();
    await provisionTenantForNewUser(client as never, USER, NOW_FN);
    const m = store.tenant_members[0];
    expect(m.user_id).toBe(USER.userId);
    expect(m.tenant_id).toBe("tenant-8c9d2f4a");
    expect(m.role).toBe("owner");
  });
});

describe("provisionTenantForNewUser — idempotency", () => {
  it("repeat invocation returns existing tenant (created: false); no duplicate writes", async () => {
    const { client, store } = makeMockSupabase();
    const first = await provisionTenantForNewUser(client as never, USER, NOW_FN);
    expect(first.ok && first.created).toBe(true);
    const second = await provisionTenantForNewUser(client as never, USER, NOW_FN);
    expect(second).toEqual({ ok: true, tenantId: "tenant-8c9d2f4a", created: false });
    expect(store.tenants.length).toBe(1);
    expect(store.tenant_members.length).toBe(1);
  });

  it("when tenant_members already exists for the user, returns existing tenantId without touching tenants table", async () => {
    const { client, store, writes } = makeMockSupabase({
      tenant_members: [{ user_id: USER.userId, tenant_id: "tenant-prior", role: "owner" }],
    });
    const r = await provisionTenantForNewUser(client as never, USER, NOW_FN);
    expect(r).toEqual({ ok: true, tenantId: "tenant-prior", created: false });
    expect(store.tenants.length).toBe(0); // never tried to insert
    expect(writes).toEqual([]); // no upserts at all
  });

  it("orphaned tenant row (no tenant_members) → second call still creates the membership", async () => {
    // Simulates a partial failure where tenants insert succeeded but
    // tenant_members insert failed on the previous attempt. Repeat
    // call must complete the missing membership.
    const { client, store } = makeMockSupabase({
      tenants: [
        {
          id: "tenant-8c9d2f4a",
          slug: "8c9d2f4a",
          status: "pending_onboarding",
        },
      ],
    });
    const r = await provisionTenantForNewUser(client as never, USER, NOW_FN);
    expect(r.ok && r.created).toBe(true);
    expect(store.tenants.length).toBe(1); // upsert was idempotent — no dup
    expect(store.tenant_members.length).toBe(1); // membership created
  });
});

describe("provisionTenantForNewUser — failure modes", () => {
  it("surfaces lookup failure cleanly (phase=lookup)", async () => {
    const { client } = makeMockSupabase({}, { failLookup: true });
    const r = await provisionTenantForNewUser(client as never, USER, NOW_FN);
    expect(r).toEqual({
      ok: false,
      error: "lookup_failed",
      phase: "lookup",
    });
  });

  it("surfaces tenant insert failure cleanly (phase=tenant_insert)", async () => {
    const { client, store } = makeMockSupabase({}, { failTenantInsert: true });
    const r = await provisionTenantForNewUser(client as never, USER, NOW_FN);
    expect(r).toEqual({
      ok: false,
      error: "tenants_insert_failed",
      phase: "tenant_insert",
    });
    expect(store.tenant_members.length).toBe(0); // never reached members insert
  });

  it("surfaces member insert failure cleanly (phase=member_insert); tenant row may be orphaned", async () => {
    const { client, store } = makeMockSupabase({}, { failMemberInsert: true });
    const r = await provisionTenantForNewUser(client as never, USER, NOW_FN);
    expect(r).toEqual({
      ok: false,
      error: "members_insert_failed",
      phase: "member_insert",
    });
    expect(store.tenants.length).toBe(1); // tenant landed
    expect(store.tenant_members.length).toBe(0); // membership did not
    // Next provision attempt for the same user should heal the orphan
    // (verified by the orphan-recovery test above).
  });
});

// ── first-scan dispatch boundary (from retired first-scan-dispatch.test.ts) ──
import { dispatchFirstScanForTenant } from "@/domains/onboarding/first-scan-dispatch";

describe("dispatchFirstScanForTenant (safety contract)", () => {
  it("PAT absent: skipped_pat_not_configured and NEVER fetches", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await dispatchFirstScanForTenant("tenant-x", { fetchImpl, env: {} });
    expect(r).toEqual({ status: "skipped_pat_not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("dispatches scoped to ONLY the tenant (204 dispatched); a thrown fetch never throws", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ ref: "main", inputs: { only_tenant: "tenant-new" } });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const r = await dispatchFirstScanForTenant("tenant-new", {
      fetchImpl,
      env: { BEACON_GH_WORKFLOW_DISPATCH_PAT: "pat-123" },
    });
    expect(r).toEqual({ status: "dispatched", httpStatus: 204 });

    const thrown = await dispatchFirstScanForTenant("tenant-x", {
      fetchImpl: vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch,
      env: { BEACON_GH_WORKFLOW_DISPATCH_PAT: "pat" },
    });
    expect(thrown.status).toBe("dispatch_failed");
  });
});
