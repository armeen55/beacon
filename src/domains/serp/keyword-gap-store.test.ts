import { describe, it, expect } from "vitest";
import { writeKeywordGapResults, readKeywordGapResults, type StoredKeywordGaps } from "./keyword-gap-store";
import type { KeywordGap } from "./keyword-gaps";

const gap = (keyword: string): KeywordGap => ({
  keyword,
  volume: 1900,
  cpcUsd: 0.4,
  competitorDomain: "supplehomes.com",
  competitorRank: 3,
  ownRank: null,
  alsoWonBy: [],
  score: 1900,
  evidence: `supplehomes.com ranks 3 on Google for "${keyword}" and people search it about 1,900 times a month. You do not show up for it yet.`,
});

const result = (over: Partial<StoredKeywordGaps> = {}): StoredKeywordGaps => ({
  tenant_id: "tenant-iranopedia",
  computed_at: "2026-07-02T00:00:00Z",
  own_domain: "iranopedia.com",
  competitors: ["supplehomes.com"],
  spent_usd: 0.22,
  gaps: [gap("persian wedding sofreh")],
  ...over,
});

/** In-memory store deps - the round-trip harness. */
function memory(initial: StoredKeywordGaps[] = []) {
  const state = { rows: initial };
  return {
    state,
    deps: {
      readRows: async () => state.rows,
      writeRows: async (rows: StoredKeywordGaps[]) => {
        state.rows = rows;
      },
    },
  };
}

const NOW = new Date("2026-07-10T00:00:00Z");

describe("keyword-gap-store round-trip", () => {
  it("write then read returns the run", async () => {
    const m = memory();
    await writeKeywordGapResults(result(), m.deps);
    const r = await readKeywordGapResults("tenant-iranopedia", NOW, m.deps);
    expect(r?.gaps[0].keyword).toBe("persian wedding sofreh");
    expect(r?.spent_usd).toBe(0.22);
  });

  it("one row per tenant - a new run replaces the old, other tenants untouched", async () => {
    const m = memory([result({ tenant_id: "tenant-ritz", competitors: ["other.com"] })]);
    await writeKeywordGapResults(result(), m.deps);
    await writeKeywordGapResults(result({ computed_at: "2026-07-03T00:00:00Z", gaps: [gap("qanat system")] }), m.deps);
    expect(m.state.rows).toHaveLength(2);
    const mine = await readKeywordGapResults("tenant-iranopedia", NOW, m.deps);
    expect(mine?.gaps[0].keyword).toBe("qanat system");
    const theirs = await readKeywordGapResults("tenant-ritz", NOW, m.deps);
    expect(theirs?.competitors).toEqual(["other.com"]);
  });

  it("caps stored gaps at 100", async () => {
    const m = memory();
    const gaps = Array.from({ length: 150 }, (_, i) => gap(`topic ${i}`));
    await writeKeywordGapResults(result({ gaps }), m.deps);
    expect(m.state.rows[0].gaps).toHaveLength(100);
  });

  it("a run older than 30 days reads as null (honest staleness)", async () => {
    const m = memory([result({ computed_at: "2026-05-20T00:00:00Z" })]);
    expect(await readKeywordGapResults("tenant-iranopedia", NOW, m.deps)).toBeNull();
  });

  it("fail-soft: a throwing read -> null", async () => {
    const r = await readKeywordGapResults("tenant-iranopedia", NOW, {
      readRows: async () => {
        throw new Error("store down");
      },
    });
    expect(r).toBeNull();
  });
});
