/**
 * S4 (operator audit, 2026-05-05) — sampling-status attribution tests.
 *
 * The M3 guard in `computeUrlVerdict` already demotes `helping` /
 * `hurting` to `nothing_yet` when the post-window contains any
 * `proof` day OR has zero `full` days. The guard was a no-op until
 * S4 wired sampling tags onto the dense series.
 *
 * These tests pin the wire-up:
 *
 *   1. `buildSamplingStatusByDate(observations)` correctly classifies
 *      per-date observation counts using the operator-locked thresholds
 *      (full ≥ 80, partial 10–79, proof 1–9, empty 0).
 *
 *   2. `stampSamplingStatus(series, map)` stamps tags on matching dates
 *      and leaves untagged dates untouched (back-compat path).
 *
 *   3. `computeChangeVerdict` honors the new option:
 *      • Proof day in post-window → demoted (no measured win).
 *      • Partial-only post-window → demoted (no full days).
 *      • Full-only post-window → measured win allowed.
 *      • No samplingStatusByDate option → engine behaves as before
 *        (back-compat — the M3 guard is a no-op).
 *      • Historical-recovered FULL samples → still produce measured
 *        wins (pre-NATIVE_REGIME_START dates carry full-status counts
 *        when extracted at backfill).
 */

import { describe, expect, it } from "vitest";
import {
  buildSamplingStatusByDate,
  stampSamplingStatus,
  computeChangeVerdict,
} from "./url-change-outcome";
import type { DailyPoint } from "./url-verdict";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { UrlCitationHistory } from "@/domains/product/url-citation-history";
import type { ChangelogEntry } from "@/domains/changelog/types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function obs(date: string, n: number): PromptAnswerObservation[] {
  // Build N synthetic observations all stamped at the same date. We
  // only need observed_at + a couple of fields the type insists on; the
  // rest are placeholder.
  return Array.from({ length: n }, (_, i) => ({
    id: `obs-${date}-${i}`,
    prompt_id: `p-${i}`,
    run_id: "run-x",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: null,
    tracked_brand_cited: null,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    observed_at: `${date}T00:00:00.000Z`,
    platform: "perplexity",
    topic: "",
  })) as unknown as PromptAnswerObservation[];
}

function denseFixture(
  start: string,
  counts: number[],
): DailyPoint[] {
  const out: DailyPoint[] = [];
  const t0 = new Date(start + "T00:00:00Z").getTime();
  for (let i = 0; i < counts.length; i++) {
    const iso = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: iso, count: counts[i] });
  }
  return out;
}

function buildHistoryForDense(
  url: string,
  series: DailyPoint[],
): UrlCitationHistory {
  return {
    built_at: new Date().toISOString(),
    date_range: {
      first: series[0]?.date ?? null,
      last: series[series.length - 1]?.date ?? null,
    },
    distinct_urls: 1,
    series: [
      {
        url,
        raw_urls: [url],
        is_owned: true,
        daily: series.map((p) => ({
          date: p.date,
          count: p.count,
          by_platform: {},
          source_type: "derived" as const,
        })),
      },
    ],
  };
}

function changeFixture(url: string, changeDate: string): ChangelogEntry {
  return {
    id: "ch-test",
    url,
    timestamp: `${changeDate}T00:00:00.000Z`,
    asset_type: "page",
    change_description: "test change",
  } as unknown as ChangelogEntry;
}

// ---------------------------------------------------------------------------
// 1. buildSamplingStatusByDate
// ---------------------------------------------------------------------------

describe("S4 — buildSamplingStatusByDate", () => {
  it("classifies counts using operator-locked thresholds (full / partial / proof)", () => {
    const observations: PromptAnswerObservation[] = [
      ...obs("2026-04-22", 100), // full (≥80)
      ...obs("2026-04-23", 80), //  full (boundary)
      ...obs("2026-04-24", 79), //  partial
      ...obs("2026-04-25", 10), //  partial (boundary)
      ...obs("2026-04-26", 9), //   proof (boundary)
      ...obs("2026-04-27", 1), //   proof
    ];
    const map = buildSamplingStatusByDate(observations);
    expect(map.get("2026-04-22")).toBe("full");
    expect(map.get("2026-04-23")).toBe("full");
    expect(map.get("2026-04-24")).toBe("partial");
    expect(map.get("2026-04-25")).toBe("partial");
    expect(map.get("2026-04-26")).toBe("proof");
    expect(map.get("2026-04-27")).toBe("proof");
  });

  it("dates with zero observations are absent from the map (not 'empty')", () => {
    const map = buildSamplingStatusByDate(obs("2026-04-22", 5));
    // Map only contains dates that had observations; an unobserved
    // date is undefined in the map (the verdict engine treats undefined
    // as 'no info' and leaves the point untouched).
    expect(map.get("2026-04-22")).toBe("proof");
    expect(map.get("2026-04-23")).toBeUndefined();
  });

  it("returns an empty map for empty input", () => {
    const map = buildSamplingStatusByDate([]);
    expect(map.size).toBe(0);
  });

  it("ignores rows with malformed observed_at", () => {
    const observations = [
      ...obs("2026-04-22", 5),
      // invalid observed_at — must be skipped, not crash
      {
        ...obs("2026-04-22", 1)[0],
        id: "bad",
        observed_at: "" as unknown as string,
      },
    ] as PromptAnswerObservation[];
    const map = buildSamplingStatusByDate(observations);
    expect(map.get("2026-04-22")).toBe("proof"); // 5 valid → proof, the bad row didn't bump the count
  });
});

// ---------------------------------------------------------------------------
// 2. stampSamplingStatus
// ---------------------------------------------------------------------------

describe("S4 — stampSamplingStatus", () => {
  it("stamps the tag on matching dates and leaves untagged dates alone", () => {
    const series = denseFixture("2026-04-22", [5, 5, 5]);
    const map = new Map<string, "full" | "partial" | "proof" | "empty">([
      ["2026-04-22", "full"],
      ["2026-04-24", "proof"],
    ]);
    const stamped = stampSamplingStatus(series, map);
    expect(stamped[0].sampling_status).toBe("full");
    expect(stamped[1].sampling_status).toBeUndefined(); // untagged
    expect(stamped[2].sampling_status).toBe("proof");
  });

  it("returns a copy without mutating the input series", () => {
    const series = denseFixture("2026-04-22", [5, 5]);
    const map = new Map<string, "full" | "partial" | "proof" | "empty">([
      ["2026-04-22", "full"],
    ]);
    const stamped = stampSamplingStatus(series, map);
    expect(series[0].sampling_status).toBeUndefined(); // not mutated
    expect(stamped[0].sampling_status).toBe("full");
    expect(stamped).not.toBe(series);
  });

  it("returns a shallow copy when map is undefined or empty (no-op)", () => {
    const series = denseFixture("2026-04-22", [5]);
    const fromUndefined = stampSamplingStatus(series, undefined);
    const fromEmpty = stampSamplingStatus(series, new Map());
    expect(fromUndefined).toEqual(series);
    expect(fromEmpty).toEqual(series);
  });
});

// ---------------------------------------------------------------------------
// 3. computeChangeVerdict integration with samplingStatusByDate
// ---------------------------------------------------------------------------

describe("S4 — computeChangeVerdict honors samplingStatusByDate", () => {
  // 14 baseline days @ 5/day, change on day 15, 14 post days @ 20/day:
  // strong helping signal in the absence of any sampling guard.
  const baselineDays = 14;
  const postDays = 14;
  const baselineCount = 5;
  const postCount = 20;
  const baselineStart = "2026-04-08";
  const changeDate = "2026-04-22";

  function buildStandardCase(
    postSamplingByDate?: ReadonlyMap<
      string,
      "full" | "partial" | "proof" | "empty"
    >,
  ): ReturnType<typeof computeChangeVerdict> {
    const counts: number[] = [
      ...Array(baselineDays).fill(baselineCount),
      0, // change day
      ...Array(postDays).fill(postCount),
    ];
    const dense = denseFixture(baselineStart, counts);
    const history = buildHistoryForDense("/x", dense);
    const change = changeFixture("/x", changeDate);
    return computeChangeVerdict(
      change,
      history,
      undefined,
      undefined,
      postSamplingByDate
        ? { samplingStatusByDate: postSamplingByDate }
        : undefined,
    );
  }

  it("[BASELINE] without samplingStatusByDate, strong post-window stays helping", () => {
    const r = buildStandardCase();
    expect(r).not.toBeNull();
    expect(r!.verdict.verdict).toBe("helping");
  });

  it("proof day in post-window demotes helping → nothing_yet", () => {
    // Tag every post-window day as full EXCEPT the last one as proof.
    const map = new Map<string, "full" | "partial" | "proof" | "empty">();
    const t0 = new Date(baselineStart + "T00:00:00Z").getTime();
    for (let i = 0; i <= baselineDays; i++) {
      const d = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
      map.set(d, "full");
    }
    for (let i = 1; i <= postDays - 1; i++) {
      const d = new Date(t0 + (baselineDays + i) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      map.set(d, "full");
    }
    const lastPost = new Date(t0 + (baselineDays + postDays) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    map.set(lastPost, "proof");
    const r = buildStandardCase(map);
    expect(r).not.toBeNull();
    expect(r!.verdict.verdict).toBe("nothing_yet");
  });

  it("partial-only post-window demotes helping → nothing_yet (no full days)", () => {
    const map = new Map<string, "full" | "partial" | "proof" | "empty">();
    const t0 = new Date(baselineStart + "T00:00:00Z").getTime();
    for (let i = 0; i <= baselineDays; i++) {
      const d = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
      map.set(d, "full");
    }
    for (let i = 1; i <= postDays; i++) {
      const d = new Date(t0 + (baselineDays + i) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      map.set(d, "partial");
    }
    const r = buildStandardCase(map);
    expect(r).not.toBeNull();
    expect(r!.verdict.verdict).toBe("nothing_yet");
  });

  it("full-only post-window keeps helping (the operator's daily-poll case)", () => {
    const map = new Map<string, "full" | "partial" | "proof" | "empty">();
    const t0 = new Date(baselineStart + "T00:00:00Z").getTime();
    for (let i = 0; i <= baselineDays + postDays; i++) {
      const d = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
      map.set(d, "full");
    }
    const r = buildStandardCase(map);
    expect(r).not.toBeNull();
    expect(r!.verdict.verdict).toBe("helping");
  });

  it("historical_recovered full samples (pre-NATIVE_REGIME_START dates) still produce wins when tagged full", () => {
    // Backfilled observations from before the boundary: the W4 backfill
    // stamps full sample sizes on recovered days. The S4 guard is
    // status-based, NOT date-based, so a recovered FULL day on
    // 2026-04-15 looks identical to a native FULL day on 2026-04-30.
    const baselineStartHistorical = "2026-03-25";
    const counts: number[] = [
      ...Array(baselineDays).fill(baselineCount),
      0,
      ...Array(postDays).fill(postCount),
    ];
    const dense = denseFixture(baselineStartHistorical, counts);
    const history = buildHistoryForDense("/x", dense);
    const change = changeFixture("/x", "2026-04-08");
    const map = new Map<string, "full" | "partial" | "proof" | "empty">();
    const t0 = new Date(baselineStartHistorical + "T00:00:00Z").getTime();
    for (let i = 0; i <= baselineDays + postDays; i++) {
      const d = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
      map.set(d, "full");
    }
    const r = computeChangeVerdict(change, history, undefined, undefined, {
      samplingStatusByDate: map,
    });
    expect(r).not.toBeNull();
    expect(r!.verdict.verdict).toBe("helping");
  });

  it("returned series carries the stamped sampling_status (shape check)", () => {
    const map = new Map<string, "full" | "partial" | "proof" | "empty">([
      [changeDate, "full"],
    ]);
    const r = buildStandardCase(map);
    const stampedPoint = r!.series.find((p) => p.date === changeDate);
    expect(stampedPoint).toBeDefined();
    expect(stampedPoint!.sampling_status).toBe("full");
  });
});
