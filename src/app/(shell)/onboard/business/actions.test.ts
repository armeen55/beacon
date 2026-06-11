/**
 * /onboard/business — saveBusinessProfile behavioral pins (2026-06-11).
 *
 * First dedicated test for this action, added with the cities-prefill
 * step. Pins the new contract:
 *   - prefill fires ONLY when the tenant has no typed cities
 *     (typed beats derived),
 *   - prefill is homepage-only (maxPages: 1 — fast submit),
 *   - a fetch failure or throw NEVER blocks the step (redirect fires),
 *   - region codes are filtered from the suggestion,
 *   - the status guard still returns already_launched on 0 rows.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getUserMock = vi.hoisted(() => vi.fn());
const membershipMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const fetchPagesMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirectMock(to);
    throw new Error(`REDIRECT:${to}`); // next's redirect throws
  },
}));
vi.mock("@/lib/auth/supabase-server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser: getUserMock } }),
}));
vi.mock("@/domains/onboarding/provision-tenant", () => ({
  lookupExistingMembership: membershipMock,
}));
vi.mock("@/domains/onboarding/fetch-site-profile", () => ({
  fetchSiteProfilePages: fetchPagesMock,
}));

type UpdateCall = { payload: Record<string, unknown> };

function makeAdmin(opts: { citiesAfterFirstUpdate: string[] }) {
  const updates: UpdateCall[] = [];
  const admin = {
    from: (_table: string) => ({
      update(payload: Record<string, unknown>) {
        updates.push({ payload });
        const chain = {
          eq: () => chain,
          select: () =>
            Promise.resolve({
              data: [{ cities_served: opts.citiesAfterFirstUpdate }],
              error: null,
            }),
          then: (
            resolve: (v: { data: null; error: null }) => unknown,
          ) => Promise.resolve(resolve({ data: null, error: null })),
        };
        return chain;
      },
    }),
  };
  return { admin, updates };
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => currentAdmin,
}));

let currentAdmin: unknown;

import { saveBusinessProfile } from "./actions";

const TUCSON_HTML = `<html><head><script type="application/ld+json">
{"@type":"Restaurant","name":"La Palma","address":{"@type":"PostalAddress","addressLocality":"Tucson","addressRegion":"AZ"},"areaServed":["Oro Valley"]}
</script></head><body></body></html>`;

beforeEach(() => {
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } } });
  membershipMock.mockReset().mockResolvedValue({ tenantId: "tenant-x", error: null });
  redirectMock.mockReset();
  fetchPagesMock.mockReset();
});

async function run(input: { businessName: string; domain: string }) {
  try {
    return await saveBusinessProfile(input);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("REDIRECT:")) {
      return { redirected: e.message.slice("REDIRECT:".length) };
    }
    throw e;
  }
}

describe("saveBusinessProfile — cities prefill", () => {
  it("no typed cities → derives from the homepage ONLY and prefills (region codes filtered)", async () => {
    const { admin, updates } = makeAdmin({ citiesAfterFirstUpdate: [] });
    currentAdmin = admin;
    fetchPagesMock.mockResolvedValue({
      ok: true,
      pages: [{ url: "https://lapalma.com/", html: TUCSON_HTML }],
      homepageUrl: "https://lapalma.com/",
      domain: "lapalma.com",
    });

    const r = await run({ businessName: "La Palma", domain: "lapalma.com" });
    expect(r).toEqual({ redirected: "/onboard/scope" });
    expect(fetchPagesMock).toHaveBeenCalledWith(
      "lapalma.com",
      expect.objectContaining({ maxPages: 1 }),
    );
    const prefill = updates.find((u) => "cities_served" in u.payload);
    expect(prefill).toBeDefined();
    expect(prefill!.payload.cities_served).toEqual(["Tucson", "Oro Valley"]); // "AZ" filtered
  });

  it("typed cities already present → prefill NEVER fires (typed beats derived)", async () => {
    const { admin, updates } = makeAdmin({
      citiesAfterFirstUpdate: ["Marana"],
    });
    currentAdmin = admin;
    const r = await run({ businessName: "La Palma", domain: "lapalma.com" });
    expect(r).toEqual({ redirected: "/onboard/scope" });
    expect(fetchPagesMock).not.toHaveBeenCalled();
    expect(updates.filter((u) => "cities_served" in u.payload)).toHaveLength(0);
  });

  it("site fetch FAILING never blocks the step (redirect still fires)", async () => {
    const { admin } = makeAdmin({ citiesAfterFirstUpdate: [] });
    currentAdmin = admin;
    fetchPagesMock.mockRejectedValue(new Error("network down"));
    const r = await run({ businessName: "La Palma", domain: "lapalma.com" });
    expect(r).toEqual({ redirected: "/onboard/scope" });
  });

  it("unreachable site (ok:false) → no prefill write, step proceeds", async () => {
    const { admin, updates } = makeAdmin({ citiesAfterFirstUpdate: [] });
    currentAdmin = admin;
    fetchPagesMock.mockResolvedValue({ ok: false, reason: "homepage_unreachable" });
    const r = await run({ businessName: "La Palma", domain: "lapalma.com" });
    expect(r).toEqual({ redirected: "/onboard/scope" });
    expect(updates.filter((u) => "cities_served" in u.payload)).toHaveLength(0);
  });
});

describe("saveBusinessProfile — status guard unchanged", () => {
  it("0 updated rows → already_launched (no prefill, no redirect)", async () => {
    currentAdmin = {
      from: () => ({
        update: () => {
          const chain = {
            eq: () => chain,
            select: () => Promise.resolve({ data: [], error: null }),
          };
          return chain;
        },
      }),
    };
    const r = await run({ businessName: "La Palma", domain: "lapalma.com" });
    expect(r).toEqual({ ok: false, error: "already_launched" });
    expect(fetchPagesMock).not.toHaveBeenCalled();
  });
});
