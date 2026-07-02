import { describe, it, expect } from "vitest";

import { summarizeFanouts } from "./summarize-fanouts";

describe("summarizeFanouts — Profound query-fanout summary (#Iranopedia)", () => {
  it("ranks sub-queries by summed weight and is defensive on field names", () => {
    const rows = [
      { dims: { prompt: "best persian restaurants", query: "persian food near me" }, mets: { total_fanouts: 10 } },
      { dims: { prompt: "best persian food", query: "persian food near me" }, mets: { total_fanouts: 5 } },
      // alternate field names (fanout_query / count) still picked up
      { dims: { prompt: "p", fanout_query: "authentic persian cuisine" }, mets: { count: 3 } },
      // empty sub-query → skipped even with huge weight
      { dims: { prompt: "p", query: "" }, mets: { total_fanouts: 99 } },
      // no sub-query at all → skipped
      { dims: {}, mets: {} },
    ];
    const seeds = summarizeFanouts(rows);
    expect(seeds).toHaveLength(2);
    expect(seeds[0]).toEqual({
      subQuery: "persian food near me",
      weight: 15,
      prompts: ["best persian restaurants", "best persian food"],
      source: "profound",
    });
    expect(seeds[1]).toEqual({
      subQuery: "authentic persian cuisine",
      weight: 3,
      prompts: ["p"],
      source: "profound",
    });
  });

  it("honors the limit (highest-leverage sub-questions first)", () => {
    const rows = [
      { dims: { query: "a" }, mets: { total_fanouts: 3 } },
      { dims: { query: "b" }, mets: { total_fanouts: 2 } },
      { dims: { query: "c" }, mets: { total_fanouts: 1 } },
    ];
    expect(summarizeFanouts(rows, { limit: 2 }).map((s) => s.subQuery)).toEqual(["a", "b"]);
  });

  it("returns [] on empty / malformed input", () => {
    expect(summarizeFanouts([])).toEqual([]);
    expect(
      summarizeFanouts([{ dims: undefined as never, mets: undefined as never }]),
    ).toEqual([]);
  });
});
