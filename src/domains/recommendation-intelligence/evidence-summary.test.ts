import { describe, expect, it } from "vitest";

import {
  buildAeoEvidenceLines,
  buildClarityEvidenceLines,
  buildGscEvidenceLines,
  buildSemrushEvidenceLines,
  pickHeadlineQuery,
} from "./evidence-summary";
import type { GscPageSignal, GscQuerySignal } from "./gsc-page-signals";
import type {
  SemrushKeywordSignal,
  SemrushPageSignal,
} from "./semrush-page-signals";
import type { ClarityPageSignal } from "./clarity-page-signals";

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

// ── Microsoft Clarity evidence ────────────────────────────────────────

function clarity(partial: Partial<ClarityPageSignal>): ClarityPageSignal {
  return {
    url: "https://example.test/page",
    sessions: 0,
    rageClicks: 0,
    deadClicks: 0,
    quickbacks: 0,
    excessiveScroll: 0,
    scriptErrors: 0,
    rageRate: 0,
    deadRate: 0,
    quickbackRate: 0,
    ...partial,
  };
}

describe("buildClarityEvidenceLines — on-page friction in the why", () => {
  it("rage clicks: states the percent of sessions + session count", () => {
    // 120 rage-click sessions out of 1,500 → 8% (above the 7% band).
    const s = clarity({
      sessions: 1500,
      rageClicks: 120,
      rageRate: 0.08,
    });
    const lines = buildClarityEvidenceLines(s);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.key).toBe("clarity_rage_clicks");
    // Whole-number percent, thousands separator on the session count.
    expect(line.value).toBe("8%");
    expect(line.label).toBe("of sessions rage-click this page (1,500 sessions)");
    expect(line.detail).toContain("rage-click on this page in 8% of sessions");
    expect(line.detail).toContain("1,500 sessions tracked");
    expect(line.detail).toContain("lifts conversions");
  });

  it("script errors lead (worst-first) and name the AI-crawler impact", () => {
    // 5% of sessions hit a JS error (at the 0.05 threshold) — beats rage.
    const s = clarity({
      sessions: 2000,
      scriptErrors: 100,
      rageClicks: 400,
      rageRate: 0.2, // rage would also fire, but script errors outrank
    });
    const line = buildClarityEvidenceLines(s)[0]!;
    expect(line.key).toBe("clarity_script_errors");
    expect(line.value).toBe("5%");
    expect(line.label).toBe("of sessions hit a page error (2,000 sessions)");
    expect(line.detail).toContain("throws an error in 5% of visits");
    expect(line.detail).toContain("AI assistants can't read a page that fails to load");
  });

  it("honest omission: below the session floor → []", () => {
    // 49 sessions is under the 50-session floor — a tiny denominator must
    // never quote a rate even when the rage rate looks alarming.
    const s = clarity({ sessions: 49, rageClicks: 20, rageRate: 0.4 });
    expect(buildClarityEvidenceLines(s)).toEqual([]);
  });

  it("honest omission: friction below the sourced thresholds → []", () => {
    // Enough sessions, but rage 5% < 7% band and script errors 1% < 5%.
    const s = clarity({
      sessions: 1000,
      rageClicks: 50,
      rageRate: 0.05,
      scriptErrors: 10, // 1% — under 5%
    });
    expect(buildClarityEvidenceLines(s)).toEqual([]);
  });

  it("returns [] when the signal is null/undefined (no Clarity connected)", () => {
    expect(buildClarityEvidenceLines(null)).toEqual([]);
    expect(buildClarityEvidenceLines(undefined)).toEqual([]);
  });
});

// ── AI-answer (answer-engine) evidence ────────────────────────────────

describe("buildAeoEvidenceLines — white-label answer-engine gap", () => {
  /** The exact detail-string shape the profound_aeo_gap trigger writes. */
  const aeoDetail =
    "profound_aeo_gap category=cat-123; ai_answers=37; models=4; " +
    "own_mentions=0; competitor=Supple Homes; competitor_mentions=12; " +
    "competitor_sov=41.0%";

  it("emits ONE line naming the competitor + answer count; never the vendor name", () => {
    const lines = buildAeoEvidenceLines([
      { type: "owned_page", url: "https://example.test/" },
      { kind: "prompt_answer_observation", ref: "profound:cat-123", detail: aeoDetail },
    ]);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.key).toBe("aeo_answer_gap");
    expect(line.value).toBe("Not cited yet");
    // Answer count with thousands separator; "AI answers" not the vendor.
    expect(line.label).toBe("37 AI answers cite a rival, not you");
    expect(line.detail).toContain("AI assistants answer this topic citing Supple Homes");
    expect(line.detail).toContain("across about 37 answers");
    expect(line.detail).toContain("Add a clear, quotable answer block");
    // WHITE-LABEL hard rail: the vendor name must never appear.
    const all = [line.value, line.label, line.detail].join(" ");
    expect(all).not.toMatch(/profound/i);
  });

  it("formats the answer count with toLocaleString (thousands separator)", () => {
    const detail =
      "profound_aeo_gap category=c; ai_answers=1234; models=5; own_mentions=0; " +
      "competitor=Rival Co; competitor_mentions=20; competitor_sov=33.0%";
    const line = buildAeoEvidenceLines([
      { kind: "prompt_answer_observation", ref: "profound:c", detail },
    ])[0]!;
    expect(line.label).toBe("1,234 AI answers cite a rival, not you");
    expect(line.detail).toContain("across about 1,234 answers");
  });

  it("honest omission: no profound_aeo_gap entry in the evidence array → []", () => {
    // Only strict persisted refs (the dormant state — answer-engine not
    // connected, so no gap detail string rides the rec).
    expect(
      buildAeoEvidenceLines([
        { type: "owned_page", url: "https://example.test/" },
        { type: "prompt", promptId: "p1" },
      ]),
    ).toEqual([]);
  });

  it("returns [] for an empty / null / undefined evidence array", () => {
    expect(buildAeoEvidenceLines([])).toEqual([]);
    expect(buildAeoEvidenceLines(null)).toEqual([]);
    expect(buildAeoEvidenceLines(undefined)).toEqual([]);
  });
});
