import { describe, it, expect } from "vitest";

import { buildDailyCandidates, MIN_CONTROLS, type GscPageInput, type PageFacts } from "./build-daily-candidates";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

const NOW = new Date("2026-07-01T00:00:00Z");
const gsc = (over: Partial<GscPageInput> & { url: string }): GscPageInput => ({
  pageLabel: "x", impressions: 2000, clicks: 5, ctr: 0.0025, position: 6,
  topQuery: "umayyad caliphate flag", topQueryImpressions: 1200, topQueryPosition: 4, topQueryCtr: 0.002, ownership: 0.5, ...over,
});
const facts = (m: Record<string, PageFacts>) => new Map(Object.entries(m));

describe("buildDailyCandidates — deterministic proposers (no generic templates)", () => {
  it("proposes a query-first TITLE reorder when the title leads with filler", () => {
    const pages = [gsc({ url: "/iran-flags/umayyad-caliphate-flag", topQuery: "umayyad caliphate flag" })];
    const f = facts({ "/iran-flags/umayyad-caliphate-flag": { title: "Meet the Umayyad Caliphate Flag | History", meta: "x", h1: "Umayyad Caliphate Flag" } });
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW });
    expect(c.leverField).toBe("title");
    expect(c.proposedText.toLowerCase().startsWith("umayyad")).toBe(true);
    expect(/^meet the/i.test(c.proposedText)).toBe(false);
    expect(c.proposedText).toContain("| History"); // keeps the page's own brand/category tail
  });

  it("yields NO candidate when title is already query-first + meta present + H1 carries the query", () => {
    const pages = [gsc({ url: "/iran-flags/parthian-empire-flag", topQuery: "parthian empire flag" })];
    const f = facts({ "/iran-flags/parthian-empire-flag": { title: "Parthian Empire Flag (247 BC) - Persian Flags History", meta: "Learn about the Parthian Empire Flag.", h1: "Parthian Empire Flag" } });
    expect(buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW })).toHaveLength(0);
  });

  it("H1 lever only drops a filler lead (never chases a synonym/rewrites a clean H1)", () => {
    const pages = [gsc({ url: "/x", topQuery: "kerman rug" })];
    const f = facts({ "/x": { title: "Kerman Rug Buying Guide", meta: "present", h1: "Discover Kerman Rugs" } });
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW });
    expect(c.leverField).toBe("h1");
    expect(c.proposedText).toBe("Kerman Rugs");
  });

  it("REGRESSION: never replaces a good bespoke title with a synonym query (no degenerate proposals)", () => {
    const pages = [
      gsc({ url: "/iran-flags/mongol-empire-flag", topQuery: "genghis khan flag" }),
      gsc({ url: "/famous-iranian-directors", topQuery: "iranian directors" }),
      gsc({ url: "/iran-flags/safavid-lion-sun", topQuery: "lion and sun flag" }),
    ];
    const f = facts({
      "/iran-flags/mongol-empire-flag": { title: "Mongol Empire Flag (1219–1335) - Persian Flags History", meta: "present", h1: "Mongol Empire Flag" },
      "/famous-iranian-directors": { title: "Top 20 Most Famous Iranian Filmmakers and Directors Ever", meta: "present", h1: "Famous Iranian Directors" },
      "/iran-flags/safavid-lion-sun": { title: "Safavid Lion and Sun Flag (1576–1732) - Persian Flags History", meta: "present", h1: "Safavid Lion and Sun Flag" },
    });
    // None have a filler lead or a missing meta → NO candidates (honest: don't force weak work).
    expect(buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW })).toHaveLength(0);
  });

  it("fills a MISSING meta (factual, from the on-page H1) — never rewrites an existing meta", () => {
    const pages = [gsc({ url: "/y", topQuery: "kerman rug" })];
    const f = facts({ "/y": { title: "Kerman Rug Guide", meta: null, h1: "Kerman Rugs" } });
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW });
    expect(c.leverField).toBe("meta");
    expect(c.proposedText.toLowerCase()).toContain("kerman");
  });

  it("attaches eligibility — an active control page comes back ineligible (active_control)", () => {
    const ctrl = "https://iranopedia.com/iran-animals/persian-cat";
    const ledger: ShippedChangeRecord[] = [{
      id: "/iran-animals/persian-wolf::2026-06-30", page: "https://iranopedia.com/iran-animals/persian-wolf", path: "/iran-animals/persian-wolf",
      actionType: "edit_title", before: null, after: null, shippedAt: "2026-06-30T00:00:00.000Z",
      baseline: { clicks: 0, impressions: 100, ctr: 0, position: 5, windowDays: 28 }, targetQueries: ["persian wolf"],
      controlPages: [ctrl], windows: [], verdict: "measuring", confidence: "low", measuredAt: null, notes: null,
      verifiedLive: true, liveSourceUrl: null, recrawlRequestedAt: null, operatorVerdictOverride: null,
      createdAt: "2026-06-30T00:00:00.000Z", updatedAt: "2026-06-30T00:00:00.000Z",
    }];
    const pages = [gsc({ url: ctrl, topQuery: "persian cat" })];
    const f = facts({ [ctrl]: { title: "Meet the Persian Cat | Iran Animals & Wildlife", meta: "x", h1: "Persian Cat" } });
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: ledger, now: NOW });
    expect(c.eligibility.eligible).toBe(false);
    if (!c.eligibility.eligible) expect(c.eligibility.reason).toBe("active_control");
  });

  it("selects same-family controls + flags enoughControls", () => {
    const pages = [
      gsc({ url: "/iran-flags/umayyad-caliphate-flag", topQuery: "umayyad caliphate flag", impressions: 2000, topQueryPosition: 4 }),
      gsc({ url: "/iran-flags/c1", impressions: 1900, topQueryPosition: 5 }),
      gsc({ url: "/iran-flags/c2", impressions: 2100, topQueryPosition: 4 }),
      gsc({ url: "/iran-flags/c3", impressions: 1800, topQueryPosition: 6 }),
    ];
    const f = facts({ "/iran-flags/umayyad-caliphate-flag": { title: "Meet the Umayyad Caliphate Flag", meta: "x", h1: "Umayyad Caliphate Flag" } });
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW });
    expect(c.suggestedControls.length).toBeGreaterThanOrEqual(MIN_CONTROLS);
    expect(c.suggestedControls.every((s) => s.pageFamilyMatch)).toBe(true);
    expect(c.enoughControls).toBe(true);
  });
});
