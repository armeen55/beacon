import { describe, it, expect } from "vitest";
import { buildTrendRadar, analyzeSeries } from "./trend-radar";
import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";

function series(vols: number[]): KeywordDemand["monthlySearches"] {
  // map to 12 months ending at Dec; month index = i+1 (Jan..)
  return vols.map((v, i) => ({ year: 2026, month: (i % 12) + 1, volume: v }));
}
function kw(keyword: string, searchVolume: number | null, monthly: KeywordDemand["monthlySearches"]): KeywordDemand {
  return {
    keyword,
    searchVolume,
    cpcUsd: 0,
    competition: 0,
    competitionLevel: "low",
    monthlySearches: monthly,
    locationCode: 2840,
    languageCode: "en",
    source: "dataforseo",
    fetchedAt: "2026-06-25T00:00:00Z",
    confidence: "high",
    evidenceRef: `kw:${keyword}`,
  };
}

const RISING = series([100, 100, 100, 100, 100, 100, 100, 200, 300, 400, 500, 600]); // recent ≫ prior
const DECLINING = series([600, 500, 400, 300, 200, 100, 100, 100, 100, 80, 60, 40]);
const FLAT = series([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
const SEASONAL = series([50, 50, 1000, 50, 50, 50, 50, 50, 50, 50, 50, 50]); // sharp March peak

describe("analyzeSeries", () => {
  it("rising when recent 3mo ≫ prior 3mo", () => {
    expect(analyzeSeries(RISING).trend).toBe("rising");
  });
  it("declining when recent 3mo ≪ prior 3mo", () => {
    expect(analyzeSeries(DECLINING).trend).toBe("declining");
  });
  it("UNKNOWN (never guessed) when <6 months of data", () => {
    const r = analyzeSeries(series([100, 200, 300]));
    expect(r.trend).toBe("unknown");
    expect(r.confident).toBe(false);
  });
  it("detects a seasonal peak month", () => {
    const r = analyzeSeries(SEASONAL);
    expect(r.seasonal).toBe(true);
    expect(r.peakMonths).toContain(3);
  });
});

describe("buildTrendRadar", () => {
  it("rising keyword with no page → create_page + Today Move", () => {
    const out = buildTrendRadar({ keywords: [kw("persian rugs", 2000, RISING)], ownedPages: [], currentMonth: 6 });
    const t = out.find((x) => x.query === "persian rugs")!;
    expect(t.trend).toBe("rising");
    expect(t.recommendedAction).toBe("create_page");
    expect(t.shouldBeTodayMove).toBe(true);
    expect(t.evidenceSource).toBe("dataforseo_volume_trend");
  });

  it("declining keyword matched to an owned page → content_refresh", () => {
    const out = buildTrendRadar({
      keywords: [kw("persian history", 1500, DECLINING)],
      ownedPages: [{ url: "https://x.com/persian-history" }],
      currentMonth: 6,
    });
    const t = out.find((x) => x.query === "persian history")!;
    expect(t.trend).toBe("declining");
    expect(t.recommendedAction).toBe("content_refresh");
    expect(t.matchStrength).toBe("strong");
  });

  it("NO fake trend: short series + real volume → unknown + monitor (not rising)", () => {
    const out = buildTrendRadar({ keywords: [kw("nowruz facts", 800, series([100, 200, 300]))], ownedPages: [], currentMonth: 6 });
    const t = out.find((x) => x.query === "nowruz facts")!;
    expect(t.trend).toBe("unknown");
    expect(t.recommendedAction).toBe("monitor");
    expect(t.shouldBeTodayMove).toBe(false);
  });

  it("no trend data + below min volume → dropped (no noise, no fake claim)", () => {
    const out = buildTrendRadar({ keywords: [kw("obscure thing", 10, [])], ownedPages: [], currentMonth: 6 });
    expect(out.find((x) => x.query === "obscure thing")).toBeUndefined();
  });

  it("flat non-seasonal with no GSC movement → dropped (not a trend)", () => {
    const out = buildTrendRadar({ keywords: [kw("steady topic", 900, FLAT)], ownedPages: [], currentMonth: 6 });
    expect(out.find((x) => x.query === "steady topic")).toBeUndefined();
  });

  it("seasonal peak ~now → Today Move with seasonal whyNow", () => {
    const out = buildTrendRadar({ keywords: [kw("nowruz gifts", 1200, SEASONAL)], ownedPages: [], currentMonth: 2 });
    const t = out.find((x) => x.query === "nowruz gifts")!;
    expect(t.seasonal).toBe(true);
    expect(t.whyNow.toLowerCase()).toContain("seasonal");
    expect(t.shouldBeTodayMove).toBe(true);
    // commerce token → concept-only product action + risk
    expect(t.recommendedAction).toBe("create_product");
    expect(t.risk).toMatch(/concept only/i);
  });

  it("GSC delta hook overrides direction with measured evidence", () => {
    const out = buildTrendRadar({
      keywords: [kw("iranian movies", 1600, FLAT)],
      ownedPages: [],
      currentMonth: 6,
      gscDeltas: [{ query: "iranian movies", clickDeltaPct: 0.5, impressions: 9000 }],
    });
    const t = out.find((x) => x.query === "iranian movies")!;
    expect(t.trend).toBe("rising");
    expect(t.evidenceSource).toBe("gsc_query_delta");
    expect(t.confidence).toBe("high");
  });
});
