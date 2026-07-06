/**
 * detect-service-areas — generic place detection, no city list (2026-07-06).
 *
 * Pins the service-area money-maker's INPUT layer: place names are pulled from
 * the tenant's OWN signals (declared places + the words people type into
 * Google) by PATTERN, never by matching a hardcoded gazetteer. A content query
 * with no place signal yields nothing, so the local engine no-ops on a
 * content/encyclopedia site (the content-site-safety pin).
 */

import { describe, it, expect } from "vitest";

import {
  extractPlacesFromQuery,
  detectServiceAreas,
} from "./detect-service-areas";

describe("extractPlacesFromQuery — pattern, not a city list", () => {
  it("pulls the place after 'in' for varied trades + varied cities", () => {
    // Deliberately varied verticals + places to prove it is a pattern: no
    // specific city is recognized, only the '<preposition> <place>' shape.
    expect(extractPlacesFromQuery("plumber in Austin")).toContain("austin");
    expect(extractPlacesFromQuery("dentist near Portland")).toContain(
      "portland",
    );
    expect(
      extractPlacesFromQuery("custom home builder in Fredericksburg"),
    ).toContain("fredericksburg");
    // A place name Beacon has never heard of works identically.
    expect(extractPlacesFromQuery("roofing in Zzyzx")).toContain("zzyzx");
  });

  it("handles 'near' and 'around' the same as 'in'", () => {
    expect(extractPlacesFromQuery("cafe near Boerne")).toContain("boerne");
    expect(extractPlacesFromQuery("movers around Denver")).toContain("denver");
  });

  it("captures a multi-word place after the preposition (capped at 3 words)", () => {
    expect(extractPlacesFromQuery("realtor in Palo Alto")).toContain(
      "palo alto",
    );
    expect(extractPlacesFromQuery("tacos in San Luis Obispo")).toContain(
      "san luis obispo",
    );
  });

  it("recognizes a trailing US state code and the words before it", () => {
    // Pattern B captures the state code plus the 1-2 words immediately before
    // it as one place phrase (not each word separately).
    const places = extractPlacesFromQuery("kitchen remodel fredericksburg tx");
    expect(places).toContain("tx");
    expect(places).toContain("remodel fredericksburg");
  });

  it("does NOT invent a place for a preposition-tail stopword", () => {
    // "near me" / "in stock" must never become a city. This also pins the
    // fix for the state-code collision: "me" (Maine) and "in" (Indiana) are
    // far more often the English words, so a trailing "me"/"in" must NOT read
    // as a state and drag the words before it in as a bogus place.
    expect(extractPlacesFromQuery("plumber near me")).toEqual([]);
    expect(extractPlacesFromQuery("is it in stock")).toEqual([]);
    expect(extractPlacesFromQuery("call me now")).toEqual([]);
  });

  it("a real (non-word) state code still fires from the tail", () => {
    // The fix must not disarm the legitimate feature: tx/ca/ny etc. still work.
    expect(extractPlacesFromQuery("roofing austin tx")).toContain("tx");
    expect(extractPlacesFromQuery("realtor scottsdale az")).toContain("az");
  });

  it("yields nothing for a pure content query with no place signal", () => {
    // The content-site-safety pin: an encyclopedia query has no place.
    expect(extractPlacesFromQuery("what is nowruz")).toEqual([]);
    expect(extractPlacesFromQuery("history of the safavid dynasty")).toEqual(
      [],
    );
    expect(extractPlacesFromQuery("how to boil an egg")).toEqual([]);
  });

  it("empty / whitespace query yields nothing", () => {
    expect(extractPlacesFromQuery("")).toEqual([]);
    expect(extractPlacesFromQuery("   ")).toEqual([]);
  });

  it("does not treat a bare trailing 'in' with nothing after it as a place", () => {
    // "in" is Indiana's code but also the preposition; a trailing bare "in"
    // must yield nothing rather than capturing "plumber" as a place.
    expect(extractPlacesFromQuery("plumber in")).toEqual([]);
  });
});

describe("detectServiceAreas — rank, dedupe, empty-safe", () => {
  it("returns site-declared places first (ground truth), source=site", () => {
    const areas = detectServiceAreas({
      configuredPlaces: ["austin", "round rock"],
      queries: [{ query: "plumber in Georgetown", impressions: 5000 }],
    });
    // Site places rank ahead of a high-impression search-only place.
    expect(areas[0]!.source).toBe("site");
    const sitePlaces = areas
      .filter((a) => a.source === "site")
      .map((a) => a.place);
    expect(sitePlaces).toEqual(
      expect.arrayContaining(["Austin", "Round Rock"]),
    );
    // The query-only market still appears, marked "search".
    const georgetown = areas.find((a) => a.place === "Georgetown");
    expect(georgetown?.source).toBe("search");
    expect(georgetown?.impressions).toBe(5000);
  });

  it("dedupes a place that appears in both config and queries (stays 'site')", () => {
    const areas = detectServiceAreas({
      configuredPlaces: ["austin"],
      queries: [
        { query: "plumber in Austin", impressions: 300 },
        { query: "emergency plumber in austin", impressions: 200 },
      ],
    });
    const austin = areas.filter((a) => a.place.toLowerCase() === "austin");
    expect(austin).toHaveLength(1);
    // Declared → source stays "site" even though queries reinforced it.
    expect(austin[0]!.source).toBe("site");
    // Impressions from both queries accumulate onto the one entry.
    expect(austin[0]!.impressions).toBe(500);
  });

  it("ranks search-only markets by accumulated impressions", () => {
    const areas = detectServiceAreas({
      queries: [
        { query: "dentist in Portland", impressions: 100 },
        { query: "dentist in Salem", impressions: 900 },
        { query: "dentist in Eugene", impressions: 400 },
      ],
    });
    expect(areas.map((a) => a.place)).toEqual(["Salem", "Eugene", "Portland"]);
  });

  it("upper-cases a 2-letter state code in the display name", () => {
    const areas = detectServiceAreas({
      queries: [{ query: "roofing austin tx", impressions: 50 }],
    });
    const tx = areas.find((a) => a.place === "TX");
    expect(tx).toBeDefined();
  });

  it("respects the max cap", () => {
    // Use real-shaped multi-word place names (a bare "cityN" cleans to the
    // stopword "city" and would be dropped).
    const names = [
      "Alpha Springs",
      "Beta Hills",
      "Gamma Valley",
      "Delta Park",
      "Epsilon Ridge",
      "Zeta Grove",
      "Eta Falls",
    ];
    const queries = names.map((n, i) => ({
      query: `plumber in ${n}`,
      impressions: i,
    }));
    const areas = detectServiceAreas({ queries, max: 5 });
    expect(areas).toHaveLength(5);
  });

  it("empty input → [] (a content site is a byte-identical no-op)", () => {
    expect(detectServiceAreas({})).toEqual([]);
    expect(
      detectServiceAreas({ configuredPlaces: [], queries: [] }),
    ).toEqual([]);
  });

  it("content-only queries with no place signal → [] (content-site safety)", () => {
    const areas = detectServiceAreas({
      queries: [
        { query: "what is nowruz", impressions: 9000 },
        { query: "persian new year date", impressions: 8000 },
        { query: "haft sin table meaning", impressions: 7000 },
      ],
    });
    expect(areas).toEqual([]);
  });

  it("ignores non-finite/negative impressions without crashing", () => {
    const areas = detectServiceAreas({
      queries: [
        { query: "plumber in Austin", impressions: Number.NaN },
        { query: "plumber in Austin", impressions: -50 },
      ],
    });
    const austin = areas.find((a) => a.place === "Austin");
    expect(austin?.impressions).toBe(0);
  });

  it("drops configured places that are stopwords or too short", () => {
    const areas = detectServiceAreas({
      configuredPlaces: ["us", "a", "home", "austin"],
    });
    expect(areas.map((a) => a.place)).toEqual(["Austin"]);
  });
});
