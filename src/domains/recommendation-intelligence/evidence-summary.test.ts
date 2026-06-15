import { describe, expect, it } from "vitest";

import {
  buildGscEvidenceLines,
  buildSemrushEvidenceLines,
  pickHeadlineQuery,
} from "./evidence-summary";
import type { GscPageSignal, GscQuerySignal } from "./gsc-page-signals";
import type {
  SemrushKeywordSignal,
  SemrushPageSignal,
} from "./semrush-page-signals";

function q(partial: Partial<GscQuerySignal>): GscQuerySignal {
  return {
    query: "iran flag",
    clicks: 0,
    impressions: 0,
    ctr: 0,
    position: 0,
    ...partial,
  };
}

function signal(partial: Partial<GscPageSignal>): GscPageSignal {
  return {
    page: "https://example.test/flag",
    clicks90d: 0,
    impressions90d: 0,
    ctr90d: 0,
    position90d: 0,
    topQueries: [],
    ...partial,
  };
}

describe("buildGscEvidenceLines — specific, number-rich customer copy", () => {
  it("low-CTR query: states exact volume, rank, CTR vs typical, recoverable visits", () => {
    // "iran flag": 9,137 impressions, rank 3 (expected CTR 10.2%), actual
    // CTR 1.2% → big shortfall. Recoverable ≈ (0.102 − 0.012) × 9137 ≈ 822.
    const s = signal({
      impressions90d: 9137,
      topQueries: [
        q({
          query: "iran flag",
          impressions: 9137,
          clicks: 110,
          ctr: 0.012,
          position: 3,
        }),
      ],
    });
    const lines = buildGscEvidenceLines(s);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.value).toBe("“iran flag”");
    // Exact volume with thousands separator + current rank.
    expect(line.label).toBe("9,137 times shown · you rank #3");
    // The full "why now": exact numbers, CTR vs typical, recoverable visits.
    expect(line.detail).toContain("9,137 times in the last 90 days");
    expect(line.detail).toContain("you rank #3");
    expect(line.detail).toContain("Your click-through is 1.2%");
    expect(line.detail).toContain("about 10.2% typical for spot #3");
    expect(line.detail).toMatch(/win about [\d,]+ more visits over 90 days/);
    // Never fabricates a difficulty / competitor we don't have.
    expect(line.detail).not.toMatch(/difficulty|competitor/i);
  });

  it("striking-distance query: states rank, volume, and top-3 upside", () => {
    // rank 8 is outside the 1–5 CTR-benchmark band, so it routes to the
    // striking-distance branch (4–15). impressions 2,400.
    const s = signal({
      impressions90d: 2400,
      topQueries: [
        q({
          query: "iran population",
          impressions: 2400,
          clicks: 30,
          ctr: 0.0125,
          position: 8,
        }),
      ],
    });
    const lines = buildGscEvidenceLines(s);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.value).toBe("“iran population”");
    expect(line.label).toBe(
      "2,400 times shown · you rank #8 (striking distance)",
    );
    expect(line.detail).toContain("You already rank #8");
    expect(line.detail).toContain("2,400 times in the last 90 days");
    expect(line.detail).toMatch(/top 3 could win about [\d,]+ more visits/);
  });

  it("omits clauses honestly: no recoverable-visits clause when there's no gap", () => {
    // rank 3, CTR already ABOVE the 10.2% benchmark → no low-CTR shortfall,
    // and rank 3 is outside the striking band → no headline query at all.
    const s = signal({
      impressions90d: 5000,
      topQueries: [
        q({
          query: "tehran",
          impressions: 5000,
          clicks: 1500,
          ctr: 0.3,
          position: 3,
        }),
      ],
    });
    expect(buildGscEvidenceLines(s)).toEqual([]);
  });

  it("returns [] when the page has no real demand (below impressions floor)", () => {
    const s = signal({
      impressions90d: 40,
      topQueries: [
        q({ query: "obscure", impressions: 40, clicks: 0, ctr: 0, position: 12 }),
      ],
    });
    expect(buildGscEvidenceLines(s)).toEqual([]);
  });

  it("returns [] when the signal is null/undefined (no GSC connected)", () => {
    expect(buildGscEvidenceLines(null)).toEqual([]);
    expect(buildGscEvidenceLines(undefined)).toEqual([]);
  });

  it("ignores low-impression queries below the 200 floor", () => {
    const s = signal({
      impressions90d: 600,
      topQueries: [
        // Below floor — must be ignored even though CTR looks terrible.
        q({ query: "noise", impressions: 150, clicks: 0, ctr: 0, position: 2 }),
        // Above floor — this one is quotable (rank 6, striking band).
        q({
          query: "iran map",
          impressions: 450,
          clicks: 5,
          ctr: 0.011,
          position: 6,
        }),
      ],
    });
    const lines = buildGscEvidenceLines(s);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.value).toBe("“iran map”");
  });

  it("pickHeadlineQuery prefers the worst CTR shortfall over striking distance", () => {
    const s = signal({
      impressions90d: 8000,
      topQueries: [
        // striking-distance candidate (rank 7)
        q({ query: "striker", impressions: 3000, clicks: 40, ctr: 0.013, position: 7 }),
        // low-CTR candidate (rank 2, expected 18.7%, actual 2% → huge shortfall)
        q({ query: "loser", impressions: 5000, clicks: 100, ctr: 0.02, position: 2 }),
      ],
    });
    const picked = pickHeadlineQuery(s);
    expect(picked).not.toBeNull();
    expect(picked!.kind).toBe("low_ctr");
    expect(picked!.query.query).toBe("loser");
  });
});

// ── SEMrush evidence ──────────────────────────────────────────────────

function kw(partial: Partial<SemrushKeywordSignal>): SemrushKeywordSignal {
  return {
    keyword: "persian rugs",
    position: 12,
    volume: 0,
    difficulty: null,
    intent: null,
    ...partial,
  };
}

function semrush(partial: Partial<SemrushPageSignal>): SemrushPageSignal {
  return {
    page: "https://example.test/rugs",
    keywords: [],
    strikingDistance: [],
    ...partial,
  };
}

describe("buildSemrushEvidenceLines — volume + difficulty + rank in the why", () => {
  it("states exact volume, difficulty with a plain band, and current rank", () => {
    // The owner's example: "‘persian rugs’ — search volume 2,400,
    // difficulty 31 (low/winnable); you rank #12, one content pass from
    // page one." KD 31 sits in 30–60 medium per the bands; pick KD 28 to
    // exercise the "low/winnable" band the owner named.
    const s = semrush({
      strikingDistance: [
        kw({ keyword: "persian rugs", position: 12, volume: 2400, difficulty: 28 }),
      ],
    });
    const lines = buildSemrushEvidenceLines(s);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.value).toBe("“persian rugs”");
    // Compact stat strip: volume (toLocaleString) + difficulty band + rank.
    expect(line.label).toBe(
      "search volume 2,400 · difficulty 28 (low/winnable) · you rank #12",
    );
    // Full "why now" sentence carries the same real numbers.
    expect(line.detail).toContain("about 2,400 searches a month");
    expect(line.detail).toContain("you rank #12");
    expect(line.detail).toContain("Keyword difficulty is 28 (low/winnable)");
    expect(line.detail).toContain("page one");
  });

  it("medium / hard difficulty bands map honestly", () => {
    const med = buildSemrushEvidenceLines(
      semrush({
        strikingDistance: [kw({ keyword: "luxury rugs", volume: 900, difficulty: 45 })],
      }),
    )[0]!;
    expect(med.label).toContain("difficulty 45 (medium)");

    const hard = buildSemrushEvidenceLines(
      semrush({
        strikingDistance: [kw({ keyword: "rugs", volume: 12000, difficulty: 78 })],
      }),
    )[0]!;
    expect(hard.label).toContain("difficulty 78 (hard)");
  });

  it("OMITS the difficulty clause honestly when KD is absent (null)", () => {
    // semrush-striking-distance's trigger evidence carries volume + position
    // but no KD; the per-page signal can likewise return difficulty=null.
    // Surface what IS available (volume + rank) and never invent a band.
    const s = semrush({
      strikingDistance: [
        kw({ keyword: "antique rugs", position: 9, volume: 1500, difficulty: null }),
      ],
    });
    const line = buildSemrushEvidenceLines(s)[0]!;
    expect(line.label).toBe("search volume 1,500 · you rank #9");
    expect(line.label).not.toMatch(/difficulty/i);
    expect(line.detail).toContain("about 1,500 searches a month");
    expect(line.detail).toContain("you rank #9");
    expect(line.detail).not.toMatch(/difficulty/i);
  });

  it("quotes the highest-volume striking keyword (list is volume-desc)", () => {
    const s = semrush({
      strikingDistance: [
        kw({ keyword: "big", position: 11, volume: 5000, difficulty: 40 }),
        kw({ keyword: "small", position: 6, volume: 200, difficulty: 20 }),
      ],
    });
    const line = buildSemrushEvidenceLines(s)[0]!;
    expect(line.value).toBe("“big”");
  });

  it("returns [] when there is no striking-distance keyword", () => {
    expect(buildSemrushEvidenceLines(semrush({ strikingDistance: [] }))).toEqual([]);
  });

  it("returns [] when the signal is null/undefined (no SEMrush connected)", () => {
    expect(buildSemrushEvidenceLines(null)).toEqual([]);
    expect(buildSemrushEvidenceLines(undefined)).toEqual([]);
  });
});
