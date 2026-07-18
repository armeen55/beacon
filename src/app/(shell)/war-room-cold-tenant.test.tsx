/**
 * Cold-tenant war-room render pins (2026-07-07).
 *
 * FIX 3 - the FrictionFixesSection "clean day" reassurance must NOT fire on a cold
 *   tenant whose pages are all below the ~20-session router floor (Ritz's case).
 *   Below the floor it says "Not enough visits yet to judge page experience"; only
 *   when a page actually cleared the floor and stayed clean does it claim a clean day.
 *
 * FIX 4 - the DemandOpportunitiesSection must not leak the "(DataForSEO)" vendor
 *   parenthetical; it reuses the plain "keyword research" phrasing.
 *
 * Rendered for real via renderToStaticMarkup so we assert on the exact operator copy,
 * not on props.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ClarityPageSignal } from "@/domains/recommendation-intelligence/clarity-page-signals";

let claritySignals = new Map<string, ClarityPageSignal>();

vi.mock("@/domains/recommendation-intelligence/clarity-page-signals", () => ({
  loadClarityPageSignalsForTenant: async () => claritySignals,
}));
// loadWithDeadline just needs to return the resolved data here (no timeout).
vi.mock("@/lib/load-with-deadline", () => ({
  loadWithDeadline: async (p: Promise<unknown>) => ({ timedOut: false, data: await p }),
}));

// Demand section loaders - FIX 4 renders the research-gap subtitle (the exact line
// that used to leak "(DataForSEO)"). Keyword research ran (keywordsConsidered > 0)
// with one gap and NO spikes, so the section takes the else branch that carried the
// vendor parenthetical.
vi.mock("@/domains/demand/load-demand-opportunities", () => ({
  loadDemandOpportunities: async () => ({
    opportunities: [{ id: "o1", primaryKeyword: "persian rugs", estDemand: 1200, action: "create_page" }],
    trends: [], products: [], keywordsConsidered: 500,
  }),
}));
vi.mock("@/domains/trend-radar/spike-store", () => ({ loadQuerySpikes: async () => [] }));
vi.mock("@/domains/seasonal/seasonal-store", () => ({ loadSeasonalQueries: async () => [] }));
vi.mock("@/domains/language-gap/language-gap-store", () => ({ loadLanguageGaps: async () => [] }));
vi.mock("@/domains/refresh/refresh-store", () => ({ loadRefreshQueue: async () => [] }));
vi.mock("@/domains/gsc/load-striking-portfolio", () => ({ loadStrikingPortfolio: async () => null }));
vi.mock("./worklist-surface-store", () => ({ readWorklistSurface: async () => null }));

import { FrictionFixesSection, DemandOpportunitiesSection } from "./war-room-sections";

function signal(over: Partial<ClarityPageSignal> & { url: string; sessions: number }): ClarityPageSignal {
  return {
    rageClicks: 0, deadClicks: 0, quickbacks: 0, excessiveScroll: 0, scriptErrors: 0,
    rageRate: 0, deadRate: 0, quickbackRate: 0,
    ...over,
  };
}

async function renderSection(node: Promise<React.ReactElement | null> | React.ReactElement | null): Promise<string> {
  const el = await node;
  return el ? renderToStaticMarkup(el) : "";
}

describe("FrictionFixesSection - cold-tenant traffic floor (FIX 3)", () => {
  beforeEach(() => {
    claritySignals = new Map();
  });

  it("does NOT claim a clean day when every page is below the session floor", async () => {
    // Ritz's real shape: a few pages, all with a handful of visits, none evaluable.
    claritySignals.set("/a", signal({ url: "/a", sessions: 4 }));
    claritySignals.set("/b", signal({ url: "/b", sessions: 11 }));
    claritySignals.set("/c", signal({ url: "/c", sessions: 19 }));
    const html = await renderSection(FrictionFixesSection({ tenantId: "t" }));
    expect(html).toContain("Not enough visits yet to judge page experience.");
    expect(html).not.toContain("No friction found this week. Clean pages.");
    // Still honest about what was watched.
    expect(html).toContain("I watched sessions on 3 pages");
  });

  it("DOES claim a clean day only when a page cleared the floor and stayed clean", async () => {
    // One page with real traffic and no friction pattern = a genuine clean day.
    claritySignals.set("/big", signal({ url: "/big", sessions: 120 }));
    claritySignals.set("/small", signal({ url: "/small", sessions: 3 }));
    const html = await renderSection(FrictionFixesSection({ tenantId: "t" }));
    expect(html).toContain("No friction found this week. Clean pages.");
    expect(html).not.toContain("Not enough visits yet to judge");
    expect(html).toContain("1 with enough traffic to judge");
  });

  it("self-hides entirely when Clarity has no page data at all", async () => {
    const html = await renderSection(FrictionFixesSection({ tenantId: "t" }));
    expect(html).toBe("");
  });
});

describe("DemandOpportunitiesSection - no vendor leak (FIX 4)", () => {
  beforeEach(() => {
    claritySignals = new Map();
  });

  it("uses plain 'keyword research' phrasing, never the '(DataForSEO)' vendor name", async () => {
    const html = await renderSection(DemandOpportunitiesSection({ tenantId: "t" }));
    expect(html).not.toContain("DataForSEO");
    // The rendered subtitle reuses the plain phrasing from the line above it.
    expect(html).toContain("keyword research");
  });
});

describe("war-room-sections - no scheduled/overnight timing claims", () => {
  it("never claims tonight/last night/overnight/nightly timing (Beacon has no scheduler)", () => {
    const SRC = readFileSync(resolve(__dirname, "war-room-sections.tsx"), "utf8");
    expect(SRC).not.toMatch(/tonight|last night|overnight|nightly/i);
  });
});
