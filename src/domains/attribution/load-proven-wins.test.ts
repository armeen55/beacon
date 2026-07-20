/**
 * load-proven-wins — the home-screen causal wedge.
 *
 * Pins: ONLY computed + HIGH-confidence (placebo-significant) + at-or-above
 * the flat-move bar (lift >= FLAT_LIFT_THRESHOLD) outcomes become wins —
 * weak/flat/hurting AND placebo-FAILED (medium) AND sub-flat computed
 * results are excluded (the home screen states cause-and-effect or stays
 * quiet); ranked by lift; limit respected; failure-soft → [].
 */

import { describe, it, expect, vi } from "vitest";

const outcomesRef = { current: [] as StoredChangeOutcome[], throws: false };
vi.mock("./change-outcome-store", () => ({
  loadAllChangeOutcomes: async () => {
    if (outcomesRef.throws) throw new Error("store down");
    return outcomesRef.current;
  },
}));

import { loadProvenWins } from "./load-proven-wins";
import type { StoredChangeOutcome } from "./change-outcome-store";
import { log } from "@/lib/logger";

function outcome(
  source_id: string,
  status: StoredChangeOutcome["status"],
  lift: number,
  confidence: StoredChangeOutcome["confidence"] = "high",
): StoredChangeOutcome {
  const isComputed = status === "computed";
  return {
    source_id,
    classifier_version: "test",
    stored_at: "2026-05-30T00:00:00.000Z",
    taxonomy_layer: "change",
    primary_bucket: "content.faq.add",
    child_tags: [],
    paired_with: [],
    bundle_parent_id: null,
    bundle_size: 1,
    url: `/p/${source_id}`,
    url_type: "service",
    treatment_date: "2026-05-15",
    pre_window: { start: "2026-05-01", end: "2026-05-14" },
    post_window: { start: "2026-05-16", end: "2026-05-29" },
    status,
    confidence,
    warnings: [],
    rationale: "test",
    computed: isComputed
      ? {
          kind: "computed",
          overall: {
            platform: "all",
            treated_pre_avg: 1,
            treated_post_avg: 1 + lift,
            control_pre_avg: 1,
            control_post_avg: 1,
            treated_delta: lift,
            control_delta: 0,
            adjusted_lift: lift,
            relative_lift: 0.5,
            controls_used: 3,
            pre_days_observed: 14,
            post_days_observed: 14,
          },
          per_platform: [],
        }
      : null,
    raw: null,
    matched_control_count: 3,
    matched_control_urls: [],
    excluded_control_count: 0,
    excluded_reasons: {},
    excluded_reasons_by_platform: {},
    sparklines: null,
    computed_at: "2026-05-30T00:00:00.000Z",
  };
}

describe("loadProvenWins", () => {
  it("returns ONLY computed + positive-lift wins, ranked by lift", async () => {
    outcomesRef.current = [
      outcome("small", "computed", 1),
      outcome("big", "computed", 4),
      outcome("flat", "computed", 0), // no move — excluded
      outcome("hurt", "computed", -2), // hurting — excluded
      outcome("weak", "weak_estimate", 5), // not causal — excluded
    ];
    outcomesRef.throws = false;
    const wins = await loadProvenWins();
    expect(wins.map((w) => w.sourceId)).toEqual(["big", "small"]);
    expect(wins[0]!.liftPerDay).toBe(4);
    expect(wins[0]!.relativeLiftPct).toBe(50);
    expect(wins[0]!.headline.toLowerCase()).toContain("more ai citation");
  });

  it("excludes placebo-FAILED (medium) and sub-flat computed results — chance-level/no-move never reaches the 'Proven' rail", async () => {
    outcomesRef.current = [
      outcome("real", "computed", 3, "high"), // placebo-significant, real move → win
      outcome("placebo_failed", "computed", 9, "medium"), // huge lift but engine capped to medium (moved by chance) → excluded
      outcome("subflat", "computed", 0.3, "high"), // high but below the flat-move bar → excluded
    ];
    outcomesRef.throws = false;
    const wins = await loadProvenWins();
    expect(wins.map((w) => w.sourceId)).toEqual(["real"]);
  });

  it("respects the limit", async () => {
    outcomesRef.current = [
      outcome("a", "computed", 5),
      outcome("b", "computed", 4),
      outcome("c", "computed", 3),
    ];
    const wins = await loadProvenWins({ limit: 2 });
    expect(wins).toHaveLength(2);
    expect(wins.map((w) => w.sourceId)).toEqual(["a", "b"]);
  });

  it("failure-soft: a store read error returns [] (section self-hides) AND logs the failure", async () => {
    outcomesRef.throws = true;
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const wins = await loadProvenWins();
    expect(wins).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("load-proven-wins");
    warn.mockRestore();
  });

  it("no proven wins → [] (e.g. only weak outcomes)", async () => {
    outcomesRef.current = [outcome("w", "weak_estimate", 3)];
    outcomesRef.throws = false;
    expect(await loadProvenWins()).toEqual([]);
  });
});
