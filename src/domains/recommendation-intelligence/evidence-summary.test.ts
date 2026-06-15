import { describe, expect, it } from "vitest";

import {
  buildGscEvidenceLines,
  pickHeadlineQuery,
} from "./evidence-summary";
import type { GscPageSignal, GscQuerySignal } from "./gsc-page-signals";

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
