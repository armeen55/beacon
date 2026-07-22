/**
 * Onboarding UI - the first-audit scorecard (Core 100K).
 * Covers onboard/done: the honest first-audit scorecard + the minimal
 * finish-setup (Start tracking) control that replaced the retired
 * business/competitors/scope/review wizard.
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
    // Skippable GSC offer + the minimal finish-setup control.
    expect(html).toContain("Connect Search Console for acme.com");
    expect(html).toContain("Start tracking");
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
    expect(html).not.toContain("Start tracking");
  });
});
