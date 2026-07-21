/**
 * query-spikes (2026-07-02, master plan item 14) - the week-over-week spike
 * math, hard: real spike, slow drift, the absolute impression floor, weekday
 * cyclicity, emergence vs missing history, ranking, anchor alignment, the
 * operator sentence, and the no-dash hard rule over every new trend-radar file.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  anchorDateOf,
  computeQuerySpikes,
  spikeSentence,
  MAX_SPIKES,
  SPIKE_MIN_RATIO,
  SPIKE_MIN_WEEK_IMPRESSIONS,
  type QueryDailyRow,
} from "./query-spikes";

const ANCHOR = "2026-06-28";
const DAY_MS = 86_400_000;

/** ISO date `offset` days before the anchor. */
function d(offset: number): string {
  return new Date(Date.parse(`${ANCHOR}T00:00:00Z`) - offset * DAY_MS).toISOString().slice(0, 10);
}

function row(offset: number, query: string, impressions: number, over: Partial<QueryDailyRow> = {}): QueryDailyRow {
  return { date: d(offset), query, page: null, clicks: 0, impressions, ...over };
}

/** A zero-impression marker at offset 34 extends the data span so all 4
 *  trailing weeks count as fully covered (mirrors a real synced history). */
function spanMarker(query = "span-marker"): QueryDailyRow {
  return row(34, query, 0);
}

/** Steady baseline: 45 impressions in each of the 4 trailing weeks. */
function steadyTrailing(query: string, perWeek = 45): QueryDailyRow[] {
  return [row(10, query, perWeek), row(17, query, perWeek), row(24, query, perWeek), row(31, query, perWeek)];
}

describe("computeQuerySpikes", () => {
  it("flags a 4x week as a spike with ratio, numbers, and a plain sentence", () => {
    const q = "chaharshanbe suri 2026";
    const rows = [
      spanMarker(),
      ...steadyTrailing(q),
      row(0, q, 100, { clicks: 6, page: "https://iranopedia.com/chaharshanbe-suri" }),
      row(3, q, 80, { clicks: 4, page: "https://iranopedia.com/chaharshanbe-suri" }),
    ];
    const out = computeQuerySpikes(rows);
    expect(out).toHaveLength(1);
    const s = out[0]!;
    expect(s.query).toBe(q);
    expect(s.thisWeek).toBe(180);
    expect(s.typicalWeek).toBe(45);
    expect(s.ratio).toBe(4);
    expect(s.thisWeekClicks).toBe(10);
    expect(s.topPage).toBe("https://iranopedia.com/chaharshanbe-suri");
    expect(s.sentence).toContain("4x");
    expect(s.sentence).toContain("180");
    expect(s.sentence).toContain("45");
    expect(s.sentence).toContain(q);
  });

  it("stays silent on slow drift below the 2x ratio", () => {
    const q = "persian names";
    const rows = [spanMarker(), ...steadyTrailing(q, 100), row(0, q, 70), row(2, q, 60)]; // 130 vs 100 = 1.3x
    expect(computeQuerySpikes(rows)).toHaveLength(0);
  });

  it("enforces the absolute floor: 3x on tiny numbers is noise, not news", () => {
    const q = "obscure recipe";
    // typical 8/week, this week 25: ratio 3.1x but under SPIKE_MIN_WEEK_IMPRESSIONS.
    expect(25).toBeLessThan(SPIKE_MIN_WEEK_IMPRESSIONS);
    const rows = [spanMarker(), ...steadyTrailing(q, 8), row(0, q, 25)];
    expect(computeQuerySpikes(rows)).toHaveLength(0);
  });

  it("weekday cyclicity cannot fake a spike (weekend-heavy but weekly-flat)", () => {
    const q = "weekend query";
    const rows: QueryDailyRow[] = [spanMarker()];
    for (let w = 0; w <= 4; w += 1) {
      rows.push(row(7 * w + 1, q, 50), row(7 * w + 2, q, 50), row(7 * w + 4, q, 5));
    }
    expect(computeQuerySpikes(rows)).toHaveLength(0);
  });

  it("flags brand-new demand as a spike with a null ratio (no divide-by-zero guess)", () => {
    const q = "new festival date";
    const rows = [spanMarker(), row(0, q, 40, { page: "https://iranopedia.com/festivals" }), row(1, q, 10)];
    const out = computeQuerySpikes(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.ratio).toBeNull();
    expect(out[0]!.thisWeek).toBe(50);
    expect(out[0]!.sentence).toMatch(/new this week/);
  });

  it("a near-zero baseline reads as new demand, not a silly 80x claim", () => {
    const q = "barely seen before";
    const rows = [spanMarker(), row(20, q, 2), row(0, q, 40)]; // typical 0.5/week
    const out = computeQuerySpikes(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.sentence).toMatch(/new this week/);
  });

  it("fails closed on short history: 10 days of data can never spike", () => {
    const q = "young site query";
    const rows = [row(9, q, 5), row(0, q, 500)];
    expect(computeQuerySpikes(rows)).toHaveLength(0);
  });

  it("keeps the emerging floor: under 30 impressions this week is silence", () => {
    const rows = [spanMarker(), row(0, "tiny new", 20)];
    expect(computeQuerySpikes(rows)).toHaveLength(0);
  });

  it("ranks the bigger jump first", () => {
    const rows = [
      spanMarker(),
      ...steadyTrailing("modest", 50),
      row(0, "modest", 125), // 2.5x
      ...steadyTrailing("huge", 50),
      row(0, "huge", 300), // 6x
    ];
    const out = computeQuerySpikes(rows);
    expect(out.map((s) => s.query)).toEqual(["huge", "modest"]);
  });

  it("respects the minimum ratio exactly (2x passes, just under does not)", () => {
    expect(SPIKE_MIN_RATIO).toBe(2);
    const pass = [spanMarker(), ...steadyTrailing("at-2x", 50), row(0, "at-2x", 100)];
    expect(computeQuerySpikes(pass)).toHaveLength(1);
    const fail = [spanMarker(), ...steadyTrailing("under-2x", 50), row(0, "under-2x", 99)];
    expect(computeQuerySpikes(fail)).toHaveLength(0);
  });

  it("anchors weeks to the last finalized day: 7 days before the anchor is baseline, not this week", () => {
    const q = "anchor test";
    // Day at offset 7 sits in trailing week 1; only offsets 0..6 are this week.
    const rows = [spanMarker(), row(7, q, 60), ...steadyTrailing(q, 60).slice(1), row(0, q, 200)];
    const out = computeQuerySpikes(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.thisWeek).toBe(200);
  });

  it("picks the top page by THIS week's impressions over older pages", () => {
    const q = "page pick";
    const rows = [
      spanMarker(),
      row(10, q, 45, { page: "https://x.com/old-page" }),
      row(17, q, 45, { page: "https://x.com/old-page" }),
      row(24, q, 45, { page: "https://x.com/old-page" }),
      row(31, q, 45, { page: "https://x.com/old-page" }),
      row(0, q, 150, { page: "https://x.com/fresh-page" }),
      row(1, q, 40, { page: "https://x.com/old-page" }),
    ];
    const out = computeQuerySpikes(rows);
    expect(out[0]!.topPage).toBe("https://x.com/fresh-page");
  });

  it("bounds the ranked output at MAX_SPIKES", () => {
    const rows: QueryDailyRow[] = [spanMarker()];
    for (let i = 0; i < MAX_SPIKES + 5; i += 1) {
      const q = `spiker ${i}`;
      rows.push(...steadyTrailing(q, 40), row(0, q, 200 + i));
    }
    expect(computeQuerySpikes(rows)).toHaveLength(MAX_SPIKES);
  });

  it("returns [] on empty or unusable rows", () => {
    expect(computeQuerySpikes([])).toHaveLength(0);
    expect(computeQuerySpikes([{ date: "", query: "x", clicks: 0, impressions: 5 }])).toHaveLength(0);
  });
});

describe("anchorDateOf", () => {
  it("returns the newest finalized day present", () => {
    expect(anchorDateOf([row(3, "a", 1), row(0, "b", 1), row(10, "c", 1)])).toBe(ANCHOR);
  });
  it("returns null when nothing is usable", () => {
    expect(anchorDateOf([])).toBeNull();
  });
});

describe("spikeSentence + dash guard", () => {
  it("speaks plain business copy with real numbers", () => {
    const s = spikeSentence("nowruz table", 190, 45, 4.2);
    expect(s).toContain("4.2x");
    expect(s).toContain("times shown on Google");
  });

  it("emits no em or en dashes in any sentence", () => {
    const spiky = computeQuerySpikes([spanMarker(), ...steadyTrailing("q", 45), row(0, "q", 180)]);
    const fresh = computeQuerySpikes([spanMarker(), row(0, "brand new", 50)]);
    for (const s of [...spiky, ...fresh]) {
      expect(s.sentence).not.toMatch(/[–—]/);
    }
  });

  it("keeps every new trend-radar module free of em and en dashes (hard rule)", () => {
    const files = ["query-spikes.ts", "spike-hints.ts", "spike-store.ts", "load-query-spikes.ts"];
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, f), "utf8");
      expect(src, `${f} must not contain em or en dashes`).not.toMatch(/[–—]/);
    }
  });
});
