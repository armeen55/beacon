/**
 * 2026-06-10 — per-tenant publish authorization (audit #11/#12/#15).
 * Pins: operator-mode short-circuit (dogfood), per-tenant role check for
 * logged-in users, and FAIL-CLOSED on every ambiguity (no session, not a
 * member, wrong role, error).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let _operator = false;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operator,
}));

let _userId: string | null = "user-1";
let _memberRow: { role: string } | null = { role: "owner" };
let _memberError = false;
vi.mock("@/lib/auth/supabase-server", () => ({
  getSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: _userId ? { id: _userId } : null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () =>
              _memberError
                ? { data: null, error: { message: "boom" } }
                : { data: _memberRow, error: null },
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-iranopedia",
}));

import { resolvePublishAuth, canPublishForCurrentTenant } from "@/lib/auth/can-publish";

beforeEach(() => {
  _operator = false;
  _userId = "user-1";
  _memberRow = { role: "owner" };
  _memberError = false;
});

describe("resolvePublishAuth", () => {
  it("operator mode → allowed via operator_mode (dogfood path, no session needed)", async () => {
    _operator = true;
    _userId = null;
    const r = await resolvePublishAuth();
    expect(r).toEqual({ allowed: true, via: "operator_mode" });
  });

  it("logged-in owner of THIS tenant → allowed via tenant_role", async () => {
    const r = await resolvePublishAuth();
    expect(r).toEqual({ allowed: true, via: "tenant_role" });
  });

  it("admin + founder roles also publish", async () => {
    for (const role of ["admin", "founder"]) {
      _memberRow = { role };
      expect((await resolvePublishAuth()).allowed).toBe(true);
    }
  });

  it("FAIL-CLOSED: no session", async () => {
    _userId = null;
    expect(await resolvePublishAuth()).toEqual({ allowed: false, reason: "no_session" });
  });

  it("FAIL-CLOSED: not a member of this tenant", async () => {
    _memberRow = null;
    expect(await resolvePublishAuth()).toEqual({ allowed: false, reason: "not_a_member" });
  });

  it("FAIL-CLOSED: member but insufficient role (e.g. viewer)", async () => {
    _memberRow = { role: "viewer" };
    expect(await resolvePublishAuth()).toEqual({ allowed: false, reason: "insufficient_role" });
  });

  it("FAIL-CLOSED: query error", async () => {
    _memberError = true;
    expect(await resolvePublishAuth()).toEqual({ allowed: false, reason: "error" });
  });

  it("canPublishForCurrentTenant mirrors .allowed", async () => {
    expect(await canPublishForCurrentTenant()).toBe(true);
    _memberRow = null;
    expect(await canPublishForCurrentTenant()).toBe(false);
  });
});
