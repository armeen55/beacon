import { describe, it, expect } from "vitest";
import { validateCandidateDemand, DEMAND_FLOOR_VOLUME, DEMAND_FLOOR_GRAPH } from "./validate-demand";
import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";

function kw(overrides: Partial<KeywordDemand> = {}): KeywordDemand {
  return {
    keyword: "persian wedding traditions",
    searchVolume: 200,
    cpcUsd: null,
    competition: null,
    competitionLevel: null,
    monthlySearches: [],
    locationCode: 2840,
    languageCode: "en",
    source: "dataforseo",
    fetchedAt: new Date().toISOString(),
    confidence: "high",
    evidenceRef: "dataforseo:keywords_data/google_ads/search_volume",
    ...overrides,
  };
}

describe("validateCandidateDemand", () => {
  it("passes on a strong/exact cached keyword match at or above the volume floor", () => {
    const v = validateCandidateDemand(
      { title: "Persian Wedding Traditions", entity: "wedding" },
      [kw({ keyword: "persian wedding traditions", searchVolume: DEMAND_FLOOR_VOLUME })],
      [],
    );
    expect(v.status).toBe("pass");
    if (v.status === "pass") {
      expect(v.source).toBe("cached_keyword");
    }
  });

  it("rejects a matched keyword under the volume floor with no graph backup, naming the volume in the reason", () => {
    const v = validateCandidateDemand(
      { title: "Persian Wedding Traditions", entity: "wedding" },
      [kw({ keyword: "persian wedding traditions", searchVolume: DEMAND_FLOOR_VOLUME - 1 })],
      [],
    );
    expect(v.status).toBe("rejected");
    if (v.status === "rejected") expect(v.reason).toContain("floor");
  });

  it("rejects a WEAK confidence match even when its volume clears the floor, and says so honestly (not a false volume-floor miss)", () => {
    // "nowruz gifts kids toys" only partially covers "nowruz gifts kids activities" -
    // the keyword's "activities" token is missing from the topic, so matchKeywordDemand
    // returns "weak" (shared distinguishing tokens, not full coverage), not "strong".
    const v = validateCandidateDemand(
      { title: "Nowruz Gifts Kids Toys", entity: "nowruz" },
      [kw({ keyword: "nowruz gifts kids activities", searchVolume: 5000 })],
      [],
    );
    expect(v.status).toBe("rejected");
    if (v.status === "rejected") {
      expect(v.reason).not.toContain("floor");
      expect(v.reason).toContain("weak");
    }
  });

  it("falls back to graph demand when no cached keyword clears the floor", () => {
    const v = validateCandidateDemand(
      { title: "Nowruz Meaning", entity: "nowruz" },
      [kw({ keyword: "persian wedding traditions", searchVolume: 10 })], // unrelated + weak
      [{ label: "Nowruz Persian New Year", demand: DEMAND_FLOOR_GRAPH }],
    );
    expect(v.status).toBe("pass");
    if (v.status === "pass") {
      expect(v.source).toBe("graph_demand");
    }
  });

  it("queues a candidate with no cached keyword data and no graph demand", () => {
    const v = validateCandidateDemand({ title: "Chaharshanbe Suri Meaning", entity: "chaharshanbe" }, [], []);
    expect(v.status).toBe("queued");
  });

  it("queues (not rejects) when the cache has data but nothing matches this topic at all", () => {
    const v = validateCandidateDemand(
      { title: "Totally Unrelated Topic Xyz", entity: "xyz" },
      [kw({ keyword: "persian wedding traditions", searchVolume: 500 })],
      [],
    );
    expect(v.status).toBe("queued");
  });

  it("never triggers a fresh spend - reads only the pre-loaded arrays it's given", () => {
    // Pure function contract: no network/IO import surface exists to spy on;
    // this test documents the contract (no fetch, no cache write params exist).
    const v = validateCandidateDemand({ title: "X", entity: "x" }, [], []);
    expect(v.status).toBe("queued");
  });

  it("graph demand below the floor does not pass", () => {
    const v = validateCandidateDemand(
      { title: "Nowruz Meaning", entity: "nowruz" },
      [],
      [{ label: "Nowruz Persian New Year", demand: DEMAND_FLOOR_GRAPH - 1 }],
    );
    expect(v.status).toBe("queued");
  });

  it("picks the highest-demand graph signal when multiple entity labels match", () => {
    const v = validateCandidateDemand(
      { title: "Nowruz Meaning", entity: "nowruz" },
      [],
      [
        { label: "Nowruz Gifts", demand: DEMAND_FLOOR_GRAPH },
        { label: "Nowruz Persian New Year", demand: DEMAND_FLOOR_GRAPH + 500 },
      ],
    );
    expect(v.status).toBe("pass");
    if (v.status === "pass" && v.source === "graph_demand") {
      expect(v.demand).toBe(DEMAND_FLOOR_GRAPH + 500);
    }
  });
});
