import { describe, expect, it } from "vitest";
import {
  computeLeaderboard,
  type EntityVisibility,
} from "./visibility-score";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

/**
 * Step 1.3 (master plan) — leaderboard delta math under the new contract:
 *   - delta = avg(current N-day window) − avg(previous N-day window)
 *   - null when the previous window has < ⌈N/3⌉ sampled days (or fewer than 2)
 *   - 7d toggle vs 30d toggle on the same data must produce different deltas
 *   - chart slicing now calendar-date-based; tested implicitly via the
 *     leaderboard's sampledDays + null-delta logic.
 */

const BRAND = "Ritz Builders";
const COMPETITOR_A = "Acme Builders";

function obs(opts: {
  date: string;
  brandMentioned?: boolean;
  brandCited?: boolean;
  mentions?: string[];
  platform?: string;
}): PromptAnswerObservation {
  return {
    id: `obs-${opts.date}-${Math.random().toString(36).slice(2, 8)}`,
    prompt_id: "p-1",
    platform: opts.platform ?? "perplexity",
    observed_at: `${opts.date}T12:00:00Z`,
    answer_text: "",
    citations: [],
    citation_domains: [],
    mentions: opts.mentions ?? (opts.brandMentioned !== false ? [BRAND] : []),
    tracked_brand_mentioned: opts.brandMentioned !== false,
    tracked_brand_cited: opts.brandCited === true,
    position: 1,
    metadata: null,
  } as unknown as PromptAnswerObservation;
}

function brandRow(rows: EntityVisibility[]): EntityVisibility {
  const row = rows.find((e) => e.isOwned);
  expect(row, "tracked brand row missing").toBeDefined();
  return row!;
}

describe("computeLeaderboard — Step 1.3 delta math", () => {
  // ───────────────────────────────────────────────────────────────────
  // Case 1 — dense daily data: every day in current + previous windows
  // has observations, score rises in current → positive delta in points.
  // ───────────────────────────────────────────────────────────────────
  it("dense daily data: returns current avg − previous avg (in pts)", () => {
    const observations: PromptAnswerObservation[] = [];
    // Previous 7d (2026-04-15 .. 2026-04-21): 3 obs/day, brand cited 1/3 each
    // day → score = mention_rate (3/3) since metric is 'mention_rate'.
    // Use mention_rate so the math is trivial: brand mentioned every obs.
    for (let i = 0; i < 7; i++) {
      const date = `2026-04-${String(15 + i).padStart(2, "0")}`;
      observations.push(obs({ date, brandMentioned: true }));
      observations.push(
        obs({ date, brandMentioned: false, mentions: [COMPETITOR_A] }),
      );
      observations.push(
        obs({ date, brandMentioned: false, mentions: [COMPETITOR_A] }),
      );
    }
    // Current 7d (2026-04-22 .. 2026-04-28): brand mentioned in 2/3 obs
    for (let i = 0; i < 7; i++) {
      const date = `2026-04-${String(22 + i).padStart(2, "0")}`;
      observations.push(obs({ date, brandMentioned: true }));
      observations.push(obs({ date, brandMentioned: true }));
      observations.push(
        obs({ date, brandMentioned: false, mentions: [COMPETITOR_A] }),
      );
    }
    const rows = computeLeaderboard({
      observations,
      brandAliases: [BRAND],
      windowEndDate: "2026-04-28",
      windowDays: 7,
      metric: "mention_rate",
    });
    const brand = brandRow(rows);
    // current = 2/3 = 66.67%; previous = 1/3 = 33.33% → delta ≈ +33.33 pt
    expect(brand.score).toBeCloseTo((2 / 3) * 100, 1);
    expect(brand.delta).not.toBeNull();
    expect(brand.delta!).toBeCloseTo((1 / 3) * 100, 1);
    expect(brand.deltaWindowDays).toBe(7);
    expect(brand.currentSampledDays).toBe(7);
    expect(brand.previousSampledDays).toBe(7);
  });

  // ───────────────────────────────────────────────────────────────────
  // Case 2 — sparse / non-contiguous: only some days inside each window
  // have observations. Delta still computes (above the min threshold);
  // sampled-day count reflects reality, not window length.
  // ───────────────────────────────────────────────────────────────────
  it("sparse non-contiguous dates: sampledDays reflects reality, delta still honest", () => {
    const observations: PromptAnswerObservation[] = [
      // Previous 14d (2026-04-08..21): only 5 sampled days (above ⌈14/3⌉=5).
      obs({ date: "2026-04-09", brandMentioned: true }),
      obs({ date: "2026-04-09", brandMentioned: false, mentions: [COMPETITOR_A] }),
      obs({ date: "2026-04-12", brandMentioned: true }),
      obs({ date: "2026-04-15", brandMentioned: false, mentions: [COMPETITOR_A] }),
      obs({ date: "2026-04-15", brandMentioned: false, mentions: [COMPETITOR_A] }),
      obs({ date: "2026-04-18", brandMentioned: true }),
      obs({ date: "2026-04-20", brandMentioned: true }),
      // Current 14d (2026-04-22..2026-05-05): 7 sampled days, brand-heavy.
      obs({ date: "2026-04-22", brandMentioned: true }),
      obs({ date: "2026-04-23", brandMentioned: true }),
      obs({ date: "2026-04-25", brandMentioned: true }),
      obs({ date: "2026-04-27", brandMentioned: true }),
      obs({ date: "2026-04-29", brandMentioned: true }),
      obs({ date: "2026-05-02", brandMentioned: true }),
      obs({ date: "2026-05-04", brandMentioned: true }),
    ];
    const rows = computeLeaderboard({
      observations,
      brandAliases: [BRAND],
      windowEndDate: "2026-05-05",
      windowDays: 14,
      metric: "mention_rate",
    });
    const brand = brandRow(rows);
    expect(brand.currentSampledDays).toBe(7);
    expect(brand.previousSampledDays).toBe(5);
    // Previous window passes the ⌈14/3⌉=5 threshold → delta computed.
    expect(brand.delta).not.toBeNull();
    expect(brand.delta!).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────
  // Case 3 — insufficient previous-window data: returns null/limited-data,
  // never fakes a 0 delta.
  // ───────────────────────────────────────────────────────────────────
  it("insufficient previous-window data: delta is null (never faked 0)", () => {
    const observations: PromptAnswerObservation[] = [
      // Previous 14d window: only ONE sampled day → far below ⌈14/3⌉=5.
      obs({ date: "2026-04-12", brandMentioned: true }),
      // Current 14d window: dense.
      ...Array.from({ length: 7 }, (_, i) =>
        obs({
          date: `2026-04-${String(22 + i).padStart(2, "0")}`,
          brandMentioned: true,
        }),
      ),
    ];
    const rows = computeLeaderboard({
      observations,
      brandAliases: [BRAND],
      windowEndDate: "2026-05-05",
      windowDays: 14,
      metric: "mention_rate",
    });
    const brand = brandRow(rows);
    expect(brand.delta).toBeNull();
    expect(brand.previousSampledDays).toBe(1);
  });

  it("zero-sample previous window: delta is null", () => {
    const observations: PromptAnswerObservation[] = [
      // Only current window has samples; previous is empty.
      ...Array.from({ length: 7 }, (_, i) =>
        obs({
          date: `2026-04-${String(22 + i).padStart(2, "0")}`,
          brandMentioned: true,
        }),
      ),
    ];
    const rows = computeLeaderboard({
      observations,
      brandAliases: [BRAND],
      windowEndDate: "2026-04-28",
      windowDays: 7,
      metric: "mention_rate",
    });
    const brand = brandRow(rows);
    expect(brand.delta).toBeNull();
    expect(brand.previousSampledDays).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────
  // Case 4 — 7d toggle vs 30d toggle: different windows → different deltas
  // (the whole point of the lifted-state refactor).
  // ───────────────────────────────────────────────────────────────────
  it("7d vs 30d toggle on same data produces different deltas", () => {
    const observations: PromptAnswerObservation[] = [];
    // 60 days of data ending 2026-04-28.
    // Days -59..-30 → brand mentioned in EVERY obs (high baseline)
    // Days -29..-7 → brand mentioned in HALF of obs (mid)
    // Days -6..0   → brand mentioned in NO obs (sharp drop in last week)
    const end = new Date("2026-04-28T00:00:00Z");
    for (let i = -59; i <= 0; i++) {
      const d = new Date(end);
      d.setUTCDate(end.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      const offset = i; // -59..0
      const brandMentions = offset < -29 ? 3 : offset < -6 ? 2 : 0;
      for (let j = 0; j < 3; j++) {
        observations.push(
          obs({
            date,
            brandMentioned: j < brandMentions,
            mentions: j < brandMentions ? [BRAND] : [COMPETITOR_A],
          }),
        );
      }
    }
    const sevenDay = computeLeaderboard({
      observations,
      brandAliases: [BRAND],
      windowEndDate: "2026-04-28",
      windowDays: 7,
      metric: "mention_rate",
    });
    const thirtyDay = computeLeaderboard({
      observations,
      brandAliases: [BRAND],
      windowEndDate: "2026-04-28",
      windowDays: 30,
      metric: "mention_rate",
    });
    const brand7 = brandRow(sevenDay);
    const brand30 = brandRow(thirtyDay);
    // 7d: current = days -6..0 → 0% brand. previous = -13..-7 → ~67% brand.
    //     delta ≈ 0 − 67 = -67 pt
    // 30d: current = -29..0 includes both mid + zero blocks; previous mostly
    //      high block. delta is clearly different from 7d.
    expect(brand7.delta).not.toBeNull();
    expect(brand30.delta).not.toBeNull();
    expect(Math.abs(brand7.delta! - brand30.delta!)).toBeGreaterThan(5);
    expect(brand7.deltaWindowDays).toBe(7);
    expect(brand30.deltaWindowDays).toBe(30);
  });
});
