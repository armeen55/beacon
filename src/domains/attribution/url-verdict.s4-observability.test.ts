/**
 * D4 (operator audit, 2026-05-05) — sampling-status guard observability.
 *
 * The M3+S4 guard in `computeUrlVerdict` demotes `helping`/`hurting`
 * verdicts to `nothing_yet` when the post-window contains any `proof`
 * day or has zero `full` days. The demotion was effective but silent
 * — operator wanted a structured log to prove the guard is firing in
 * production.
 *
 * D4 wires this in two layers:
 *
 *   • `UrlVerdict.sampling_guard_demoted` (this file) — set by
 *     `computeUrlVerdict` when the guard fires; carries `from`, `to`,
 *     and `reason` ("proof_day_in_post_window" |
 *     "no_full_days_in_post_window").
 *
 *   • Materializer log emit (covered by integration test in
 *     url-change-outcome.s4-observability.test.ts) — `materializeUrlOutcomes`
 *     reads the field and emits `log.warn` with tenantId / changeId /
 *     url / window / reason.
 *
 * These tests pin the engine-side metadata.
 */

import { describe, expect, it } from "vitest";
import { computeUrlVerdict, type DailyPoint } from "./url-verdict";

function seriesWithSampling(
  start: string,
  points: Array<{ count: number; sampling_status?: DailyPoint["sampling_status"] }>,
): DailyPoint[] {
  const out: DailyPoint[] = [];
  const t0 = new Date(start + "T00:00:00Z").getTime();
  for (let i = 0; i < points.length; i++) {
    const iso = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
    out.push({
      date: iso,
      count: points[i].count,
      sampling_status: points[i].sampling_status,
    });
  }
  return out;
}

function plainSeries(start: string, counts: number[]): DailyPoint[] {
  const out: DailyPoint[] = [];
  const t0 = new Date(start + "T00:00:00Z").getTime();
  for (let i = 0; i < counts.length; i++) {
    const iso = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: iso, count: counts[i] });
  }
  return out;
}

describe("D4 — sampling_guard_demoted is set when the guard demotes a verdict", () => {
  it("proof day in post-window: helping → nothing_yet, reason=proof_day_in_post_window", () => {
    // 14 baseline @ 5/day (full), change day, 13 post @ 20/day (full),
    // last post day @ 1 (proof). Without the guard this would be
    // overwhelmingly `helping`; with the guard it demotes.
    const points: Array<{ count: number; sampling_status?: DailyPoint["sampling_status"] }> = [
      ...Array.from({ length: 14 }, () => ({
        count: 5,
        sampling_status: "full" as const,
      })),
      { count: 0, sampling_status: "full" },
      ...Array.from({ length: 13 }, () => ({
        count: 20,
        sampling_status: "full" as const,
      })),
      { count: 1, sampling_status: "proof" as const },
    ];
    const r = computeUrlVerdict({
      series: seriesWithSampling("2026-03-01", points),
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("nothing_yet");
    expect(r.sampling_guard_demoted).toBeDefined();
    expect(r.sampling_guard_demoted!.from).toBe("helping");
    expect(r.sampling_guard_demoted!.to).toBe("nothing_yet");
    expect(r.sampling_guard_demoted!.reason).toBe("proof_day_in_post_window");
  });

  it("partial-only post-window: hurting → nothing_yet, reason=no_full_days_in_post_window", () => {
    // 14 baseline @ 10/day (full), 14 post @ 1/day (partial). z is
    // strongly negative; without the guard this would be `hurting`.
    const points: Array<{ count: number; sampling_status?: DailyPoint["sampling_status"] }> = [
      ...Array.from({ length: 14 }, () => ({
        count: 10,
        sampling_status: "full" as const,
      })),
      { count: 0, sampling_status: "full" },
      ...Array.from({ length: 14 }, () => ({
        count: 1,
        sampling_status: "partial" as const,
      })),
    ];
    const r = computeUrlVerdict({
      series: seriesWithSampling("2026-03-01", points),
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("nothing_yet");
    expect(r.sampling_guard_demoted).toBeDefined();
    expect(r.sampling_guard_demoted!.from).toBe("hurting");
    expect(r.sampling_guard_demoted!.reason).toBe("no_full_days_in_post_window");
  });

  it("clean helping verdict (full-only post-window) leaves sampling_guard_demoted undefined", () => {
    const points: Array<{ count: number; sampling_status?: DailyPoint["sampling_status"] }> = [
      ...Array.from({ length: 14 }, () => ({
        count: 5,
        sampling_status: "full" as const,
      })),
      { count: 0, sampling_status: "full" },
      ...Array.from({ length: 14 }, () => ({
        count: 20,
        sampling_status: "full" as const,
      })),
    ];
    const r = computeUrlVerdict({
      series: seriesWithSampling("2026-03-01", points),
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("helping");
    expect(r.sampling_guard_demoted).toBeUndefined();
  });

  it("untagged series (back-compat): no demotion, no observability stamp", () => {
    const r = computeUrlVerdict({
      series: plainSeries(
        "2026-03-01",
        [
          5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
          0,
          20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20,
        ],
      ),
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("helping");
    expect(r.sampling_guard_demoted).toBeUndefined();
  });

  it("nothing_yet verdict (z below threshold) does NOT trigger demotion stamp", () => {
    // No movement → nothing_yet. The guard only fires on helping/hurting.
    const points: Array<{ count: number; sampling_status?: DailyPoint["sampling_status"] }> = [
      ...Array.from({ length: 14 }, () => ({
        count: 5,
        sampling_status: "full" as const,
      })),
      { count: 0, sampling_status: "full" },
      ...Array.from({ length: 14 }, () => ({
        count: 5,
        sampling_status: "proof" as const,
      })),
    ];
    const r = computeUrlVerdict({
      series: seriesWithSampling("2026-03-01", points),
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("nothing_yet");
    expect(r.sampling_guard_demoted).toBeUndefined();
  });
});
