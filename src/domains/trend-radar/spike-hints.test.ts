/**
 * spike-hints + spike-move-match (2026-07-02, master plan item 14): the hint
 * feed only fires for pages that verifiably lack an answer, stays bounded, and
 * keys by normalized path; the worklist matcher prefers the owned page and
 * falls back to a distinguishing-token topic match, never a generic-word one.
 */
import { describe, expect, it } from "vitest";

import { buildSpikeHintNotes, MAX_SPIKE_HINTS_PER_NIGHT } from "./spike-hints";
import { matchSpikeToMove } from "./spike-move-match";
import type { QuerySpike } from "./query-spikes";

function spike(over: Partial<QuerySpike> = {}): QuerySpike {
  return {
    query: "chaharshanbe suri 2026",
    thisWeek: 190,
    typicalWeek: 45,
    ratio: 4.2,
    thisWeekClicks: 12,
    topPage: "https://Iranopedia.com/Chaharshanbe-Suri/",
    sentence: 'Searches for "chaharshanbe suri 2026" are 4.2x their usual this week, about 190 times shown on Google versus 45 in a typical week.',
    ...over,
  };
}

describe("buildSpikeHintNotes", () => {
  it("emits a hint keyed by the normalized page path when the page lacks an answer", () => {
    const out = buildSpikeHintNotes([spike()], () => true);
    expect(out.size).toBe(1);
    const note = out.get("/chaharshanbe-suri");
    expect(note?.query).toBe("chaharshanbe suri 2026");
    expect(note?.sentence).toContain("4.2x");
  });

  it("skips pages that already answer the spiking search", () => {
    expect(buildSpikeHintNotes([spike()], () => false).size).toBe(0);
  });

  it("skips spikes with no best page (nothing exact to strengthen)", () => {
    expect(buildSpikeHintNotes([spike({ topPage: null })], () => true).size).toBe(0);
  });

  it("is bounded and keeps the biggest movers (spikes arrive ranked)", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      spike({ query: `q${i}`, topPage: `https://x.com/p${i}` }),
    );
    const out = buildSpikeHintNotes(many, () => true);
    expect(out.size).toBe(MAX_SPIKE_HINTS_PER_NIGHT);
    expect([...out.keys()]).toEqual(["/p0", "/p1", "/p2"]);
  });

  it("keeps one hint per page (first wins)", () => {
    const out = buildSpikeHintNotes(
      [spike({ query: "first" }), spike({ query: "second" })],
      () => true,
    );
    expect(out.size).toBe(1);
    expect(out.get("/chaharshanbe-suri")?.query).toBe("first");
  });
});

describe("matchSpikeToMove", () => {
  const moves = [
    { label: "persian wedding traditions", ownedUrl: "https://iranopedia.com/persian-wedding" },
    { label: "chaharshanbe suri", ownedUrl: "https://iranopedia.com/chaharshanbe-suri" },
  ];

  it("prefers the owned-page path match and returns the path as the search term", () => {
    const m = matchSpikeToMove(spike(), moves);
    expect(m?.searchTerm).toBe("/chaharshanbe-suri");
  });

  it("topic match on the label returns the row's page path (the guaranteed search hit)", () => {
    const m = matchSpikeToMove(spike({ topPage: null, query: "chaharshanbe date" }), moves);
    expect(m?.searchTerm).toBe("/chaharshanbe-suri");
  });

  it("topic match works on the row's target search too, and falls back to the label without a page", () => {
    const rows = [{ label: "festival dates", query: "chaharshanbe suri date", ownedUrl: null }];
    const m = matchSpikeToMove(spike({ topPage: null, query: "chaharshanbe 2026" }), rows);
    expect(m?.searchTerm).toBe("festival dates");
  });

  it("returns null when no move matches", () => {
    expect(matchSpikeToMove(spike({ topPage: null, query: "unrelated gadgets" }), moves)).toBeNull();
  });

  it("never matches on generic words alone", () => {
    const generic = [{ label: "best guide list", ownedUrl: null }];
    expect(matchSpikeToMove(spike({ topPage: null, query: "best top guide" }), generic)).toBeNull();
  });

  it("returns null against an empty move list", () => {
    expect(matchSpikeToMove(spike(), [])).toBeNull();
  });
});
