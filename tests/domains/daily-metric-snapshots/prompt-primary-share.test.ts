/**
 * Section 6 C5 — Prompts detail per-prompt primary-share helper unit
 * tests. AGGREGATE-not-latest-row semantic.
 *
 * Critical invariant pinned here: the helper sums
 * `primary_recommendation_count` and `total_possible` across every
 * eligible prompt-scope row, NOT just the latest row. This pins the
 * fix for the "latest-row trap" — prompt-scope rows have
 * `total_possible = 1` per row in Ritz's daily-polling cadence, so
 * latest-row semantic would force every card into `still_learning`
 * via the ≥ 7 sample guard. Test case "latest row total=1, aggregate
 * total=14, claimable" pins the fix explicitly.
 *
 * Per Section 6 C5 §E test inventory.
 */

import { describe, expect, it, vi } from "vitest";

import {
  computePromptPlatformPrimaryShare,
  computePromptPrimaryShare,
  SECTION6_PROMPT_PRIMARY_MIN_OBS,
  type PromptPrimaryShareCard,
  type PromptPrimaryShareRepo,
} from "@/domains/daily-metric-snapshots/prompt-primary-share";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────

function promptRow(
  over: Partial<DailyMetricSnapshot> = {},
): DailyMetricSnapshot {
  return {
    id: `derived-${over.date ?? "2026-05-15"}-prompt-${over.scope_id ?? "prompt-a"}-${(over.platform ?? "Perplexity").toLowerCase()}`,
    date: "2026-05-15",
    scope_type: "prompt",
    scope_id: "prompt-a",
    platform: "Perplexity",
    source_type: "derived",
    visibility_score: null,
    mention_count: 0,
    citation_count: 0,
    share_of_voice: null,
    avg_position: null,
    total_possible: 1,
    metadata: {},
    tenant_id: "tenant-fixture",
    cited_or_mentioned_count: null,
    position_weighted_citation_count: null,
    mentioned_obs_count: null,
    primary_recommendation_count: 0,
    ...over,
  };
}

/**
 * Build N daily prompt rows, one per UTC day ending at endDate,
 * stepping back. `primaryFlags` is an array of booleans; length must
 * be N. Each flag becomes a row with primary_recommendation_count =
 * (true ? 1 : 0) and total_possible = 1 (mirrors Ritz daily-polling
 * cadence: one observation per prompt × platform × day).
 */
function buildDailyRows(
  promptId: string,
  platform: "ChatGPT" | "Perplexity",
  primaryFlags: boolean[],
  endDate = "2026-05-15",
): DailyMetricSnapshot[] {
  const out: DailyMetricSnapshot[] = [];
  for (let i = 0; i < primaryFlags.length; i++) {
    const d = new Date(`${endDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(
      promptRow({
        scope_id: promptId,
        platform,
        date: d.toISOString().slice(0, 10),
        primary_recommendation_count: primaryFlags[i] ? 1 : 0,
        total_possible: 1,
      }),
    );
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// AGGREGATE semantic — pure helper
// ─────────────────────────────────────────────────────────────────────

describe("computePromptPlatformPrimaryShare — 14-day aggregate semantic", () => {
  it("aggregates across 14 daily rows", () => {
    // 14 days, 6 of them primary. total=14, count=6, pct=43, claimable.
    const flags = [
      true, true, true, false, false, false,
      true, true, true, false, false, false, false, false,
    ];
    const rows = buildDailyRows("prompt-a", "Perplexity", flags);
    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    expect(card).toEqual<PromptPrimaryShareCard>({
      count: 6,
      total: 14,
      pct: 43, // 6/14 = 0.4285... → 43
      sample_status: "claimable",
    });
  });

  it("LATEST-ROW TRAP: latest row has total=1 but aggregate total=14 is claimable", () => {
    // This is the critical fix pin. A naive "latest-row" implementation
    // would return { count: 0..1, total: 1, sample_status: "still_learning" }
    // for every Ritz prompt. The correct aggregate yields the full 14.
    const flags = new Array(14).fill(true);
    const rows = buildDailyRows("prompt-a", "Perplexity", flags);

    // Verify each individual row has total_possible = 1 (latest-row
    // semantic would see only this).
    for (const r of rows) expect(r.total_possible).toBe(1);

    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    expect(card).toEqual<PromptPrimaryShareCard>({
      count: 14,
      total: 14,
      pct: 100,
      sample_status: "claimable",
    });
  });

  it("total = 7 exactly is claimable (threshold boundary)", () => {
    const rows = buildDailyRows(
      "prompt-a",
      "Perplexity",
      [true, false, true, false, true, false, true], // 4 of 7
    );
    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    expect(card?.total).toBe(7);
    expect(card?.sample_status).toBe("claimable");
    expect(SECTION6_PROMPT_PRIMARY_MIN_OBS).toBe(7);
  });

  it("total = 6 exactly is still_learning (threshold boundary minus 1)", () => {
    const rows = buildDailyRows(
      "prompt-a",
      "Perplexity",
      [true, false, true, false, true, false],
    );
    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    expect(card?.total).toBe(6);
    expect(card?.sample_status).toBe("still_learning");
  });

  it("returns null when no eligible rows exist (hide path)", () => {
    expect(computePromptPlatformPrimaryShare([], "prompt-a", "Perplexity")).toBeNull();
  });

  it("count = 0 with total = 14 returns claimable 0%", () => {
    const rows = buildDailyRows("prompt-a", "Perplexity", new Array(14).fill(false));
    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    expect(card).toEqual<PromptPrimaryShareCard>({
      count: 0,
      total: 14,
      pct: 0,
      sample_status: "claimable",
    });
  });

  it("count = 14 with total = 14 returns 100%", () => {
    const rows = buildDailyRows("prompt-a", "Perplexity", new Array(14).fill(true));
    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    expect(card?.pct).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Filter discipline
// ─────────────────────────────────────────────────────────────────────

describe("computePromptPlatformPrimaryShare — filter discipline", () => {
  it("excludes source_type='benchmark' rows even when populated", () => {
    const rows = [
      ...buildDailyRows("prompt-a", "Perplexity", [true, true, true]),
      promptRow({
        scope_id: "prompt-a",
        platform: "Perplexity",
        date: "2026-05-15",
        source_type: "benchmark",
        primary_recommendation_count: 99,
        total_possible: 99,
      }),
    ];
    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    // Only the 3 derived rows count: 3/3 = 100%.
    expect(card?.total).toBe(3);
    expect(card?.count).toBe(3);
  });

  it("ignores rows with scope_type other than 'prompt'", () => {
    const rows = [
      ...buildDailyRows("prompt-a", "Perplexity", [true, true]),
      promptRow({
        scope_id: "prompt-a",
        scope_type: "platform",
        primary_recommendation_count: 50,
        total_possible: 100,
      }),
      promptRow({
        scope_id: "prompt-a",
        scope_type: "entity",
        primary_recommendation_count: 50,
        total_possible: 100,
      }),
      promptRow({
        scope_id: "prompt-a",
        scope_type: "topic",
        primary_recommendation_count: 50,
        total_possible: 100,
      }),
    ];
    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    expect(card?.total).toBe(2);
  });

  it("ignores rows for other prompts (wrong scope_id)", () => {
    const rows = [
      ...buildDailyRows("prompt-a", "Perplexity", [true, true]),
      ...buildDailyRows("prompt-z", "Perplexity", new Array(14).fill(true)),
    ];
    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    expect(card?.total).toBe(2);
    expect(card?.count).toBe(2);
  });

  it("ignores rows for the other platform", () => {
    const rows = [
      ...buildDailyRows("prompt-a", "Perplexity", [true, false, false]),
      ...buildDailyRows("prompt-a", "ChatGPT", new Array(14).fill(true)),
    ];
    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    expect(card?.total).toBe(3);
    expect(card?.count).toBe(1);
  });

  it("skips rows with null primary_recommendation_count", () => {
    const rows = [
      ...buildDailyRows("prompt-a", "Perplexity", [true, true]),
      promptRow({
        scope_id: "prompt-a",
        platform: "Perplexity",
        date: "2026-05-13",
        primary_recommendation_count: null,
        total_possible: 1,
      }),
    ];
    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    expect(card?.total).toBe(2); // null row skipped
  });

  it("skips rows with total_possible null / 0 / negative", () => {
    const rows = [
      ...buildDailyRows("prompt-a", "Perplexity", [true]),
      promptRow({
        scope_id: "prompt-a",
        platform: "Perplexity",
        date: "2026-05-13",
        primary_recommendation_count: 5,
        total_possible: null,
      }),
      promptRow({
        scope_id: "prompt-a",
        platform: "Perplexity",
        date: "2026-05-12",
        primary_recommendation_count: 0,
        total_possible: 0,
      }),
    ];
    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    expect(card?.total).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Per-platform independence + rounding
// ─────────────────────────────────────────────────────────────────────

describe("computePromptPlatformPrimaryShare — per-platform independence", () => {
  it("one platform is claimable, the other is still_learning", () => {
    const rows = [
      ...buildDailyRows("prompt-a", "Perplexity", new Array(14).fill(true)),
      ...buildDailyRows("prompt-a", "ChatGPT", [true, false]),
    ];
    const perp = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    const chat = computePromptPlatformPrimaryShare(rows, "prompt-a", "ChatGPT");
    expect(perp?.sample_status).toBe("claimable");
    expect(chat?.sample_status).toBe("still_learning");
  });
});

describe("computePromptPlatformPrimaryShare — rounding", () => {
  it("count=1, total=3 → 33%", () => {
    const rows = [
      promptRow({ date: "2026-05-15", primary_recommendation_count: 1, total_possible: 1 }),
      promptRow({ date: "2026-05-14", primary_recommendation_count: 0, total_possible: 1 }),
      promptRow({ date: "2026-05-13", primary_recommendation_count: 0, total_possible: 1 }),
    ];
    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    expect(card?.pct).toBe(33); // 1/3 = 0.333… → 33
  });

  it("count=2, total=3 → 67%", () => {
    const rows = [
      promptRow({ date: "2026-05-15", primary_recommendation_count: 1, total_possible: 1 }),
      promptRow({ date: "2026-05-14", primary_recommendation_count: 1, total_possible: 1 }),
      promptRow({ date: "2026-05-13", primary_recommendation_count: 0, total_possible: 1 }),
    ];
    const card = computePromptPlatformPrimaryShare(rows, "prompt-a", "Perplexity");
    expect(card?.pct).toBe(67); // 2/3 = 0.666… → 67
  });
});

// ─────────────────────────────────────────────────────────────────────
// Async wrapper
// ─────────────────────────────────────────────────────────────────────

describe("computePromptPrimaryShare — async wrapper", () => {
  it("passes the `since` option through to the repo and returns both platforms keyed correctly", async () => {
    let receivedSince: string | undefined;
    const repo: PromptPrimaryShareRepo = {
      getDailyMetricSnapshots: vi.fn(async (opts) => {
        receivedSince = opts?.since;
        return [
          ...buildDailyRows("prompt-a", "Perplexity", new Array(10).fill(true)),
          ...buildDailyRows("prompt-a", "ChatGPT", new Array(8).fill(false)),
        ];
      }),
    };
    const result = await computePromptPrimaryShare({
      repo,
      promptId: "prompt-a",
      options: { since: "2026-05-01" },
    });
    expect(receivedSince).toBe("2026-05-01");
    expect(result.perplexity).toEqual({
      count: 10,
      total: 10,
      pct: 100,
      sample_status: "claimable",
    });
    expect(result.chatgpt).toEqual({
      count: 0,
      total: 8,
      pct: 0,
      sample_status: "claimable",
    });
  });

  it("returns null for both platforms when the repo returns empty snapshots", async () => {
    const repo: PromptPrimaryShareRepo = {
      getDailyMetricSnapshots: async () => [],
    };
    const result = await computePromptPrimaryShare({
      repo,
      promptId: "prompt-a",
    });
    expect(result).toEqual({ chatgpt: null, perplexity: null });
  });
});
