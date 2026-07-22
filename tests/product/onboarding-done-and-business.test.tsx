/**
 * Onboarding UI - merged suite (Core 100K Phase 6).
 * Absorbs: onboard/done/done-page (R12/T0e honest first-audit scorecard) and
 * onboard/business/actions (cities prefill: typed beats derived, fail-open).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { CrawlFrontierState } from "@/domains/scanning/crawl-frontier";

let tenantStatus: "pending_onboarding" | "active" = "pending_onboarding";
let frontierState: CrawlFrontierState | null = null;

vi.mock("@/domains/onboarding/access", () => ({
  requireOnboardingTenant: async () => ({
    user: { id: "u1", email: "u@example.com" },
    tenantId: "tenant-x",
    tenant: {
      id: "tenant-x",
      slug: "acme",
      business_name: "Acme Co",
      domain: "acme.com",
      cities_served: [],
      project_mix: [],
      discovered_competitors: [],
      status: tenantStatus,
      tos_accepted_at: null,
    },
  }),
}));

vi.mock("@/domains/scanning/crawl-frontier", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/domains/scanning/crawl-frontier")>();
  return { ...real, loadCrawlFrontier: async () => frontierState };
});

vi.mock("@/app/(shell)/settings/finish-setup-card", () => ({
  FinishSetupCard: () => null,
}));

vi.mock("@/app/(shell)/onboard/done/connect-gsc-card", () => ({
  ConnectGscCard: ({ domain }: { domain: string }) => (
    <div data-testid="connect-gsc">Connect Search Console for {domain}</div>
  ),
}));

vi.mock("@/app/(shell)/onboard/done/actions", () => ({
  keepScanningAction: async () => {},
  retryFirstLookAction: async () => {},
}));

import OnboardDonePage from "@/app/(shell)/onboard/done/page";

function scorecardState(over: Partial<CrawlFrontierState> = {}): CrawlFrontierState {
  return {
    tenant_id: "tenant-x",
    domain: "acme.com",
    status: "in_progress",
    frontier: Array.from({ length: 75 }, (_, i) => `https://acme.com/q${i}`),
    visited: Array.from({ length: 45 }, (_, i) => `acme.com/p${i}`),
    pages_crawled: 45,
    pages_failed: 2,
    page_cap: 150,
    source: "sitemap",
    started_at: "2026-07-03T00:00:00.000Z",
    updated_at: "2026-07-03T01:00:00.000Z",
    last_batch_at: "2026-07-03T01:00:00.000Z",
    batches_run: 3,
    page_facts: [
      {
        url: "https://acme.com/",
        path: "/",
        title: "Acme Co",
        h1: "Acme Co",
        has_meta_description: false,
        word_count: 500,
        faq_count: 0,
        questions: ["What does Acme Co make"],
      },
    ],
    day0: {
      question_seeding: "seeded",
      serp_terms: [{ term: "acme widgets", status: "dry_run" }],
    },
    ...over,
  };
}

beforeEach(() => {
  tenantStatus = "pending_onboarding";
  frontierState = null;
});

describe("/onboard/done", () => {
  it("renders the honest scorecard: progress, numbers, first win, continuation, GSC offer", async () => {
    frontierState = scorecardState();
    const html = renderToStaticMarkup(await OnboardDonePage());

    expect(html).toContain("Here is what I found on acme.com");
    expect(html).toContain(
      "I have read 45 of about 120 pages so far. I keep going in the background.",
    );
    expect(html).toContain("Pages I read");
    expect(html).toContain("Missing search descriptions");
    // The first win: homepage missing its description.
    expect(html).toContain("Your first win");
    expect(html).toContain("Add a search description");
    expect(html).toContain(
      "Your homepage has no search description, so Google writes its own snippet for your most-seen page.",
    );
    // Day-0 receipts.
    expect(html).toContain("I saved the questions your site answers");
    expect(html).toContain("a Google check for 1 of your strongest topics");
    // Continuation + honest bounds.
    expect(html).toContain("Keep scanning now");
    expect(html).toContain("Each click reads up to 15 more pages.");
    // Skippable GSC offer + the pre-launch next steps.
    expect(html).toContain("Connect Search Console for acme.com");
    expect(html).toContain("Review and launch");
    expect(html).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
  });

  it("an unreachable site gets a clear sentence and a retry, never a blank screen", async () => {
    frontierState = scorecardState({
      status: "unreachable",
      pages_crawled: 0,
      frontier: [],
      visited: [],
      page_facts: [],
      detail: "no_reachable_pages",
    });
    const html = renderToStaticMarkup(await OnboardDonePage());
    expect(html).toContain("I could not read acme.com");
    expect(html).toContain("Your site did not answer when I tried to read its pages.");
    expect(html).toContain("Try again");
    expect(html).toContain("Enter a different one");
    expect(html).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
  });

  it("no first look yet points back to the URL entry", async () => {
    frontierState = null;
    const html = renderToStaticMarkup(await OnboardDonePage());
    expect(html).toContain("I have not read your site yet");
    expect(html).toContain('href="/onboard"');
    expect(html).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
  });


  it("an already-launched tenant sees the dashboard pointer instead of launch steps", async () => {
    tenantStatus = "active";
    frontierState = scorecardState();
    const html = renderToStaticMarkup(await OnboardDonePage());
    expect(html).toContain("You are live.");
    expect(html).not.toContain("Review and launch");
  });
});

// ── /onboard/business - saveBusinessProfile behavioral pins ──

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

import { saveBusinessProfile } from "@/app/(shell)/onboard/business/actions";

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
