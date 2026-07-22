import { describe, it, expect } from "vitest";
import {
  topicTokens,
  scoreTopicMatch,
  isNoiseDomain,
  competitorRelevance,
  internalLinkRelevance,
  promptRelevance,
} from "@/domains/evidence/relevance-gate";

describe("topicTokens — strips generic brand terms + singularizes", () => {
  it("drops iran/persian and singularizes", () => {
    expect(topicTokens("Iranian Snacks")).toEqual(["snack"]);
    expect(topicTokens("Persian Numbers")).toEqual(["number"]);
    expect(topicTokens("Persian girl names")).toEqual(["girl", "name"]);
    expect(topicTokens("Tehran")).toEqual(["tehran"]);
  });
});

describe("BAD joins from the operator's live UI — must be SUPPRESSED", () => {
  it("Tehran does NOT link to Iranian Snacks (capital of Iran)", () => {
    const v = internalLinkRelevance("Tehran", "Iranian Snacks");
    expect(v.relevant).toBe(false);
    expect(v.reason).toBe("bad_internal_link_target");
  });

  it("Cities of Iran does NOT join 'iran city name' to an unrelated snack page", () => {
    expect(internalLinkRelevance("Cities of Iran", "Iranian Snacks").relevant).toBe(false);
  });

  it("Persian Holidays does NOT point to Iranian Snacks", () => {
    expect(internalLinkRelevance("Persian Holidays", "Iranian Snacks").relevant).toBe(false);
  });

  it("Safavid Flag 'what wins' is NOT a TasteAtlas eggplant URL", () => {
    const v = competitorRelevance("Safavid Flag", { url: "https://www.tasteatlas.com/persian-eggplant-stew" });
    expect(v.relevant).toBe(false);
    expect(v.reason).toBe("social_noise"); // tasteatlas is a noise domain
  });

  it("Safavid Flag eggplant is also a topic mismatch even off a normal domain", () => {
    const v = competitorRelevance("Safavid Flag", { url: "https://example.com/persian-eggplant-stew-recipe" });
    expect(v.relevant).toBe(false);
    expect(v.reason).toBe("competitor_topic_mismatch");
  });

  it("Central Asian Cobra is NOT a Persian-leopard ResearchGate URL", () => {
    expect(competitorRelevance("Central Asian Cobra", { url: "https://www.researchgate.net/persian-leopard-range" }).relevant).toBe(false);
  });

  it("Persian Numbers does NOT show baby-name competitor evidence", () => {
    const v = competitorRelevance("Persian Numbers 0-9", { url: "https://familyeducation.com/baby-names/persian-girl-names", title: "Persian Baby Girl Names" });
    expect(v.relevant).toBe(false);
  });

  it("Persian food competitor does NOT map to a Persian Insults move", () => {
    const v = competitorRelevance("Persian Farsi Insults", { url: "https://example.com/best-persian-food-dishes", title: "Top Persian Food Dishes" });
    expect(v.relevant).toBe(false);
  });
});

describe("VALID joins — must still PASS", () => {
  it("Persian wedding ↔ The Knot persian-wedding", () => {
    expect(competitorRelevance("Persian wedding traditions", { url: "https://www.theknot.com/content/persian-wedding-traditions" }).relevant).toBe(true);
  });

  it("Persian girl names ↔ familyeducation baby names (shared 'name')", () => {
    expect(competitorRelevance("Persian girl names", { url: "https://familyeducation.com/baby-names/persian-girl-names", title: "Persian Girl Names" }).relevant).toBe(true);
  });

  it("Nowruz activities ↔ a Nowruz activities page", () => {
    expect(competitorRelevance("Nowruz Activities USA", { url: "https://www.twinkl.com/resource/nowruz-activities", title: "Nowruz Activities" }).relevant).toBe(true);
  });

  it("Iran flag ↔ a flag history page", () => {
    expect(competitorRelevance("Iran Flag History", { url: "https://example.com/iran-flag-history-timeline", title: "Flag of Iran History" }).relevant).toBe(true);
  });

  it("Tehran ↔ a Tehran travel page", () => {
    expect(competitorRelevance("Tehran", { url: "https://example.com/things-to-do-in-tehran" }).relevant).toBe(true);
  });
});

describe("noise-domain detection", () => {
  it("flags social/forum/recipe/marketplace", () => {
    expect(isNoiseDomain("https://facebook.com/x")).toBe(true);
    expect(isNoiseDomain("https://www.tasteatlas.com/x")).toBe(true);
    expect(isNoiseDomain("https://researchgate.net/x")).toBe(true);
    expect(isNoiseDomain("https://www.theknot.com/x")).toBe(false);
  });
});

describe("scoreTopicMatch basics", () => {
  it("generic-only overlap is not relevant", () => {
    // both mention 'persian' only → no distinguishing overlap
    expect(scoreTopicMatch("Persian food", "Persian insults").relevant).toBe(false);
  });
  it("prompt relevance flags generic-only as generic_only_overlap", () => {
    expect(promptRelevance("Persian Numbers", "best persian gifts").reason).toBe("generic_only_overlap");
  });
});

// ── merged from src/domains/evidence/source-contradiction.test.ts ──
import {
  detectTrafficMismatch,
  detectRankVisibilityMismatch,
  detectPageGoneButClicked,
  detectSourceContradictions,
  type GscTrafficSample,
  type Ga4TrafficSample,
  type GscQueryPositionSample,
  type SerpSnapshotSample,
  type PageStatusSample,
  type GscRecentClicksSample,
} from "@/domains/evidence/source-contradiction";

const PAGE = "Persian New Year";

describe("detectTrafficMismatch (rule a - GSC clicks vs GA4 sessions)", () => {
  it("fires when GSC shows meaningful clicks and GA4 shows ~zero sessions", () => {
    const gsc: GscTrafficSample = { clicks: 1200, impressions: 40000, windowDays: 90 };
    const ga4: Ga4TrafficSample = { sessions: 3, windowDays: 90 };
    const r = detectTrafficMismatch(gsc, ga4, PAGE);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("traffic_mismatch");
    expect(r!.detail).toContain("1,200");
    expect(r!.detail).toContain("3");
    expect(r!.severity).toBe("hard");
  });

  it("fires in the reverse direction - GA4 real sessions, GSC ~zero clicks", () => {
    const gsc: GscTrafficSample = { clicks: 1, impressions: 500, windowDays: 90 };
    const ga4: Ga4TrafficSample = { sessions: 900, windowDays: 90 };
    const r = detectTrafficMismatch(gsc, ga4, PAGE);
    expect(r).not.toBeNull();
    expect(r!.sources).toEqual(["Analytics", "Search Console"]);
  });

  it("does NOT fire below the click floor (noise, not contradiction)", () => {
    const gsc: GscTrafficSample = { clicks: 10, impressions: 200, windowDays: 90 };
    const ga4: Ga4TrafficSample = { sessions: 0, windowDays: 90 };
    expect(detectTrafficMismatch(gsc, ga4, PAGE)).toBeNull();
  });

  it("does NOT fire when GA4 has a real trickle ABOVE the near-zero tolerance", () => {
    const gsc: GscTrafficSample = { clicks: 1000, impressions: 30000, windowDays: 90 };
    const ga4: Ga4TrafficSample = { sessions: 200, windowDays: 90 }; // 20% of clicks, well over the 5% "near zero" band
    expect(detectTrafficMismatch(gsc, ga4, PAGE)).toBeNull();
  });

  it("DOES fire when GA4 is within the near-zero tolerance band (a real gap, not a trickle)", () => {
    const gsc: GscTrafficSample = { clicks: 1000, impressions: 30000, windowDays: 90 };
    const ga4: Ga4TrafficSample = { sessions: 40, windowDays: 90 }; // 4% of clicks, inside the 5% "near zero" band
    expect(detectTrafficMismatch(gsc, ga4, PAGE)).not.toBeNull();
  });

  it("does NOT fire when both sources agree (comparable magnitude)", () => {
    const gsc: GscTrafficSample = { clicks: 500, impressions: 10000, windowDays: 90 };
    const ga4: Ga4TrafficSample = { sessions: 420, windowDays: 90 };
    expect(detectTrafficMismatch(gsc, ga4, PAGE)).toBeNull();
  });

  it("ABSENCE is not contradiction - GA4 missing (null) never fires, regardless of GSC clicks", () => {
    const gsc: GscTrafficSample = { clicks: 5000, impressions: 90000, windowDays: 90 };
    expect(detectTrafficMismatch(gsc, null, PAGE)).toBeNull();
    expect(detectTrafficMismatch(gsc, undefined, PAGE)).toBeNull();
  });

  it("ABSENCE is not contradiction - GSC missing never fires, regardless of GA4 sessions", () => {
    const ga4: Ga4TrafficSample = { sessions: 5000, windowDays: 90 };
    expect(detectTrafficMismatch(null, ga4, PAGE)).toBeNull();
    expect(detectTrafficMismatch(undefined, ga4, PAGE)).toBeNull();
  });

  it("ABSENCE is not contradiction - both missing", () => {
    expect(detectTrafficMismatch(null, null, PAGE)).toBeNull();
  });
});

describe("detectRankVisibilityMismatch (rule b - GSC position vs live SERP snapshot)", () => {
  it("fires when GSC says top-5 with real impressions but the SERP snapshot shows absent from top 10", () => {
    const gscQuery: GscQueryPositionSample = { query: "nowruz 2026", position: 3.2, impressions: 500 };
    const serp: SerpSnapshotSample = { query: "nowruz 2026", capturedAt: "2026-07-01", ownDomainInTop10: false };
    const r = detectRankVisibilityMismatch(gscQuery, serp, PAGE);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("rank_visibility_mismatch");
    expect(r!.detail).toContain("nowruz 2026");
    expect(r!.detail).toContain("3.2");
  });

  it("does NOT fire when the SERP snapshot confirms the domain IS in the top 10", () => {
    const gscQuery: GscQueryPositionSample = { query: "nowruz 2026", position: 3, impressions: 500 };
    const serp: SerpSnapshotSample = { query: "nowruz 2026", capturedAt: "2026-07-01", ownDomainInTop10: true };
    expect(detectRankVisibilityMismatch(gscQuery, serp, PAGE)).toBeNull();
  });

  it("does NOT fire below the position floor (position 8 is not a confident top-5 claim)", () => {
    const gscQuery: GscQueryPositionSample = { query: "nowruz 2026", position: 8, impressions: 500 };
    const serp: SerpSnapshotSample = { query: "nowruz 2026", capturedAt: "2026-07-01", ownDomainInTop10: false };
    expect(detectRankVisibilityMismatch(gscQuery, serp, PAGE)).toBeNull();
  });

  it("does NOT fire below the impressions floor (one stray impression is too noisy)", () => {
    const gscQuery: GscQueryPositionSample = { query: "nowruz 2026", position: 2, impressions: 3 };
    const serp: SerpSnapshotSample = { query: "nowruz 2026", capturedAt: "2026-07-01", ownDomainInTop10: false };
    expect(detectRankVisibilityMismatch(gscQuery, serp, PAGE)).toBeNull();
  });

  it("does NOT fire when the SERP snapshot is for a DIFFERENT query", () => {
    const gscQuery: GscQueryPositionSample = { query: "nowruz 2026", position: 2, impressions: 500 };
    const serp: SerpSnapshotSample = { query: "some other query", capturedAt: "2026-07-01", ownDomainInTop10: false };
    expect(detectRankVisibilityMismatch(gscQuery, serp, PAGE)).toBeNull();
  });

  it("query match is case/whitespace insensitive", () => {
    const gscQuery: GscQueryPositionSample = { query: "  Nowruz 2026  ", position: 2, impressions: 500 };
    const serp: SerpSnapshotSample = { query: "nowruz 2026", capturedAt: "2026-07-01", ownDomainInTop10: false };
    expect(detectRankVisibilityMismatch(gscQuery, serp, PAGE)).not.toBeNull();
  });

  it("ABSENCE is not contradiction - no stored SERP snapshot at all", () => {
    const gscQuery: GscQueryPositionSample = { query: "nowruz 2026", position: 1, impressions: 5000 };
    expect(detectRankVisibilityMismatch(gscQuery, null, PAGE)).toBeNull();
    expect(detectRankVisibilityMismatch(gscQuery, undefined, PAGE)).toBeNull();
  });

  it("ABSENCE is not contradiction - no GSC query sample", () => {
    const serp: SerpSnapshotSample = { query: "nowruz 2026", capturedAt: "2026-07-01", ownDomainInTop10: false };
    expect(detectRankVisibilityMismatch(null, serp, PAGE)).toBeNull();
  });
});

describe("detectPageGoneButClicked (rule c - page snapshot gone/error vs current GSC clicks)", () => {
  const now = new Date("2026-07-02T00:00:00Z");

  it("fires when a fresh crawl recorded a 404 but GSC still shows recent clicks", () => {
    const status: PageStatusSample = { httpStatus: 404, fetchedAt: "2026-06-28T00:00:00Z" }; // 4 days old
    const clicks: GscRecentClicksSample = { clicks: 40, recencyDays: 28 };
    const r = detectPageGoneButClicked(status, clicks, PAGE, now);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("page_gone_but_clicked");
    expect(r!.detail).toContain("404");
    expect(r!.detail).toContain("40");
  });

  it("fires on a 500 the same way as a 404", () => {
    const status: PageStatusSample = { httpStatus: 503, fetchedAt: "2026-06-30T00:00:00Z" };
    const clicks: GscRecentClicksSample = { clicks: 12, recencyDays: 28 };
    expect(detectPageGoneButClicked(status, clicks, PAGE, now)).not.toBeNull();
  });

  it("does NOT fire on a 3xx redirect (not gone, just moved)", () => {
    const status: PageStatusSample = { httpStatus: 301, fetchedAt: "2026-06-30T00:00:00Z" };
    const clicks: GscRecentClicksSample = { clicks: 40, recencyDays: 28 };
    expect(detectPageGoneButClicked(status, clicks, PAGE, now)).toBeNull();
  });

  it("does NOT fire on a 200 (page is fine)", () => {
    const status: PageStatusSample = { httpStatus: 200, fetchedAt: "2026-06-30T00:00:00Z" };
    const clicks: GscRecentClicksSample = { clicks: 40, recencyDays: 28 };
    expect(detectPageGoneButClicked(status, clicks, PAGE, now)).toBeNull();
  });

  it("does NOT fire below the recent-clicks floor (a 404 with 1 click is not worth flagging)", () => {
    const status: PageStatusSample = { httpStatus: 404, fetchedAt: "2026-06-30T00:00:00Z" };
    const clicks: GscRecentClicksSample = { clicks: 1, recencyDays: 28 };
    expect(detectPageGoneButClicked(status, clicks, PAGE, now)).toBeNull();
  });

  it("does NOT fire when the error snapshot is stale (>30 days old) - an old read isn't evidence it's gone TODAY", () => {
    const status: PageStatusSample = { httpStatus: 404, fetchedAt: "2026-04-01T00:00:00Z" }; // ~92 days old
    const clicks: GscRecentClicksSample = { clicks: 40, recencyDays: 28 };
    expect(detectPageGoneButClicked(status, clicks, PAGE, now)).toBeNull();
  });

  it("ABSENCE is not contradiction - no page snapshot at all", () => {
    const clicks: GscRecentClicksSample = { clicks: 40, recencyDays: 28 };
    expect(detectPageGoneButClicked(null, clicks, PAGE, now)).toBeNull();
  });

  it("ABSENCE is not contradiction - no GSC recent-clicks sample", () => {
    const status: PageStatusSample = { httpStatus: 404, fetchedAt: "2026-06-30T00:00:00Z" };
    expect(detectPageGoneButClicked(status, null, PAGE, now)).toBeNull();
  });
});

describe("detectSourceContradictions (aggregate entry point)", () => {
  it("returns [] when every source is absent (never fires on missing data alone)", () => {
    const out = detectSourceContradictions({ pageLabel: PAGE });
    expect(out).toEqual([]);
  });

  it("returns [] when sources are present but agree", () => {
    const out = detectSourceContradictions({
      pageLabel: PAGE,
      gscTraffic: { clicks: 500, impressions: 10000, windowDays: 90 },
      ga4Traffic: { sessions: 420, windowDays: 90 },
      pageStatus: { httpStatus: 200, fetchedAt: "2026-07-01" },
      gscRecentClicks: { clicks: 40, recencyDays: 90 },
    });
    expect(out).toEqual([]);
  });

  it("returns exactly one contradiction when only rule (a) fires", () => {
    const out = detectSourceContradictions({
      pageLabel: PAGE,
      gscTraffic: { clicks: 1200, impressions: 40000, windowDays: 90 },
      ga4Traffic: { sessions: 0, windowDays: 90 },
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("traffic_mismatch");
  });

  it("can return multiple contradictions when more than one rule fires", () => {
    const now = new Date("2026-07-02T00:00:00Z");
    const out = detectSourceContradictions({
      pageLabel: PAGE,
      now,
      gscTraffic: { clicks: 1200, impressions: 40000, windowDays: 90 },
      ga4Traffic: { sessions: 0, windowDays: 90 },
      pageStatus: { httpStatus: 404, fetchedAt: "2026-06-30T00:00:00Z" },
      gscRecentClicks: { clicks: 40, recencyDays: 90 },
    });
    expect(out.length).toBe(2);
    expect(out.map((c) => c.kind).sort()).toEqual(["page_gone_but_clicked", "traffic_mismatch"]);
  });
});
