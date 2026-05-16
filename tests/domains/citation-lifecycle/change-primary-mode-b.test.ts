/**
 * Section 6 C6a — Mode B pure compute tests.
 *
 * Covers:
 *   • Hard silence subset (eligibility / live_match_kind / affected
 *     prompts empty). target_url=null and "needs_new_page" do NOT
 *     silence Mode B (Mode B is anchored to prompt IDs + live_at).
 *   • Evaluation order: days_since_live < 14 short-circuits BEFORE
 *     sample compute.
 *   • Sample-insufficient still_learning.
 *   • Pass boundary (raw delta 5.0pp).
 *   • Raw-delta TRAP: pre 4/10, post 449/1000 → rounded delta 5, raw
 *     4.9pp → silent.
 *   • Negative-direction silence.
 *   • Multi-platform.
 *   • Multi-prompt aggregation.
 *   • Defensive dedup of affectedPromptIds.
 *   • Snapshot-row filtering (null primary_recommendation_count,
 *     total_possible = 0).
 *   • Display fields returned even when status === "silent".
 */

import { describe, it, expect } from "vitest";
import { computeChangePrimaryModeB } from "@/domains/citation-lifecycle/change-primary-mode-b";
import type { RecommendedEditRow, ImplementationStatus } from "@/domains/recommendations/recommended-edits-persistence";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

const NOW = "2026-05-15T12:00:00Z";
const LIVE_AT = "2026-04-15T14:30:00Z"; // 30 UTC days before NOW (>= 14)
const PROMPT_A = "p-a";
const PROMPT_B = "p-b";

function edit(
  over: Partial<RecommendedEditRow> = {},
): Pick<
  RecommendedEditRow,
  "implementation_status" | "live_at" | "live_match_kind" | "target_url"
> {
  return {
    implementation_status: "verified_live",
    live_at: LIVE_AT,
    live_match_kind: "exact",
    target_url: "https://ritzbuilders.com/p",
    ...over,
  };
}

function snap(
  over: Partial<DailyMetricSnapshot> = {},
): DailyMetricSnapshot {
  return {
    id: "s-" + Math.random().toString(36).slice(2, 9),
    date: "2026-04-01",
    scope_type: "prompt",
    scope_id: PROMPT_A,
    platform: "ChatGPT",
    source_type: "derived",
    visibility_score: null,
    mention_count: 0,
    citation_count: 0,
    share_of_voice: null,
    avg_position: null,
    total_possible: 1,
    metadata: {},
    tenant_id: "tenant-test",
    primary_recommendation_count: 0,
    ...over,
  };
}

/** Build N snapshot rows on consecutive dates starting from `startDate`. */
function buildSnapshots(opts: {
  startDate: string; // YYYY-MM-DD UTC
  days: number;
  promptId: string;
  platform: "ChatGPT" | "Perplexity";
  primaryPerDay: number; // primary_recommendation_count per row
  totalPerDay: number; // total_possible per row
}): DailyMetricSnapshot[] {
  const out: DailyMetricSnapshot[] = [];
  const startMs = Date.UTC(
    Number(opts.startDate.slice(0, 4)),
    Number(opts.startDate.slice(5, 7)) - 1,
    Number(opts.startDate.slice(8, 10)),
  );
  for (let i = 0; i < opts.days; i++) {
    const d = new Date(startMs + i * 86_400_000).toISOString().slice(0, 10);
    out.push(
      snap({
        date: d,
        scope_id: opts.promptId,
        platform: opts.platform,
        primary_recommendation_count: opts.primaryPerDay,
        total_possible: opts.totalPerDay,
      }),
    );
  }
  return out;
}

describe("Section 6 C6a — Mode B hard silence", () => {
  const hardSilentStatuses: ImplementationStatus[] = [
    "recommended",
    "accepted",
    "needs_review",
    "not_found_after_7d",
    "dismissed",
    "wrong_page",
  ];
  for (const s of hardSilentStatuses) {
    it(`silences both platforms when status === "${s}"`, () => {
      const r = computeChangePrimaryModeB({
        recommendedEdit: edit({ implementation_status: s }),
        affectedPromptIds: [PROMPT_A],
        snapshots: [],
        now: NOW,
      });
      expect(r.per_platform.chatgpt.status).toBe("silent");
      expect(r.per_platform.perplexity.status).toBe("silent");
    });
  }

  it("silences both platforms when live_at is null", () => {
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit({ live_at: null }),
      affectedPromptIds: [PROMPT_A],
      snapshots: [],
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("silent");
    expect(r.per_platform.perplexity.status).toBe("silent");
  });

  it("silences both platforms when live_match_kind === 'wrong_page'", () => {
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit({ live_match_kind: "wrong_page" }),
      affectedPromptIds: [PROMPT_A],
      snapshots: [],
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("silent");
    expect(r.per_platform.perplexity.status).toBe("silent");
  });

  it("silences both platforms when affectedPromptIds is empty", () => {
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [],
      snapshots: [],
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("silent");
    expect(r.per_platform.perplexity.status).toBe("silent");
  });
});

describe("Section 6 C6a — Mode B NOT silenced by missing/needs_new_page target_url", () => {
  it("target_url=null + valid affected prompts + live_at → NOT hard-silent (can pass)", () => {
    const snaps = [
      ...buildSnapshots({
        startDate: "2026-04-01", // pre window: 2026-04-01..14
        days: 14,
        promptId: PROMPT_A,
        platform: "ChatGPT",
        primaryPerDay: 5,
        totalPerDay: 10,
      }),
      ...buildSnapshots({
        startDate: "2026-04-15", // post window: 2026-04-15..28
        days: 14,
        promptId: PROMPT_A,
        platform: "ChatGPT",
        primaryPerDay: 7,
        totalPerDay: 10,
      }),
    ];
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit({ target_url: null as unknown as string }),
      affectedPromptIds: [PROMPT_A],
      snapshots: snaps,
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("pass");
  });

  it("target_url='needs_new_page' + valid affected prompts → NOT hard-silent", () => {
    const snaps = [
      ...buildSnapshots({
        startDate: "2026-04-01",
        days: 14,
        promptId: PROMPT_A,
        platform: "ChatGPT",
        primaryPerDay: 5,
        totalPerDay: 10,
      }),
      ...buildSnapshots({
        startDate: "2026-04-15",
        days: 14,
        promptId: PROMPT_A,
        platform: "ChatGPT",
        primaryPerDay: 7,
        totalPerDay: 10,
      }),
    ];
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit({ target_url: "needs_new_page" }),
      affectedPromptIds: [PROMPT_A],
      snapshots: snaps,
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("pass");
  });
});

describe("Section 6 C6a — Mode B evaluation order", () => {
  it("days_since_live=10 with FULL pre/post sample → still_learning (Step 2 short-circuit)", () => {
    const liveAt10d = "2026-05-05T12:00:00Z";
    const snaps = [
      ...buildSnapshots({
        startDate: "2026-04-21", // pre window: live_at - 14
        days: 14,
        promptId: PROMPT_A,
        platform: "ChatGPT",
        primaryPerDay: 2,
        totalPerDay: 10,
      }),
      ...buildSnapshots({
        startDate: "2026-05-05",
        days: 14,
        promptId: PROMPT_A,
        platform: "ChatGPT",
        primaryPerDay: 9,
        totalPerDay: 10,
      }),
    ];
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit({ live_at: liveAt10d }),
      affectedPromptIds: [PROMPT_A],
      snapshots: snaps,
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("still_learning");
    // Short-circuited before sample compute — counts are zeroed.
    expect(r.per_platform.chatgpt.pre_total).toBe(0);
    expect(r.per_platform.chatgpt.post_total).toBe(0);
  });

  it("days_since_live=30 with pre_total=5 → still_learning (post sufficient, pre short)", () => {
    // 5 single-obs days in pre + 14 in post
    const snaps = [
      ...buildSnapshots({
        startDate: "2026-04-01",
        days: 5,
        promptId: PROMPT_A,
        platform: "ChatGPT",
        primaryPerDay: 1,
        totalPerDay: 1,
      }),
      ...buildSnapshots({
        startDate: "2026-04-15",
        days: 14,
        promptId: PROMPT_A,
        platform: "ChatGPT",
        primaryPerDay: 1,
        totalPerDay: 1,
      }),
    ];
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: snaps,
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("still_learning");
    expect(r.per_platform.chatgpt.pre_total).toBe(5);
    expect(r.per_platform.chatgpt.post_total).toBe(14);
  });

  it("days_since_live=30 with post_total=6 → still_learning (pre sufficient, post short)", () => {
    const snaps = [
      ...buildSnapshots({
        startDate: "2026-04-01",
        days: 14,
        promptId: PROMPT_A,
        platform: "ChatGPT",
        primaryPerDay: 1,
        totalPerDay: 1,
      }),
      ...buildSnapshots({
        startDate: "2026-04-15",
        days: 6,
        promptId: PROMPT_A,
        platform: "ChatGPT",
        primaryPerDay: 1,
        totalPerDay: 1,
      }),
    ];
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: snaps,
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("still_learning");
  });
});

describe("Section 6 C6a — Mode B pass / silent thresholds", () => {
  function preTen(c: number, t: number): DailyMetricSnapshot[] {
    return [
      snap({
        date: "2026-04-01",
        scope_id: PROMPT_A,
        platform: "ChatGPT",
        primary_recommendation_count: c,
        total_possible: t,
      }),
    ];
  }
  function postTen(c: number, t: number): DailyMetricSnapshot[] {
    return [
      snap({
        date: "2026-04-15",
        scope_id: PROMPT_A,
        platform: "ChatGPT",
        primary_recommendation_count: c,
        total_possible: t,
      }),
    ];
  }

  it("pre 10/20 (50%), post 14/20 (70%), raw_delta 20 → pass", () => {
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: [...preTen(10, 20), ...postTen(14, 20)],
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("pass");
    expect(r.per_platform.chatgpt.pre_share_pct).toBe(50);
    expect(r.per_platform.chatgpt.post_share_pct).toBe(70);
    expect(r.per_platform.chatgpt.delta_pp).toBe(20);
  });

  it("pre 10/20 (50%), post 11/20 (55%), raw_delta 5.0 → pass (boundary)", () => {
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: [...preTen(10, 20), ...postTen(11, 20)],
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("pass");
  });

  it("pre 10/20 (50%), post 10/20 (50%), raw_delta 0 → silent", () => {
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: [...preTen(10, 20), ...postTen(10, 20)],
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("silent");
  });

  it("pre 12/20 (60%), post 10/20 (50%), raw_delta -10 → silent (negative direction)", () => {
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: [...preTen(12, 20), ...postTen(10, 20)],
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("silent");
    expect(r.per_platform.chatgpt.delta_pp).toBe(-10);
  });

  it("RAW-DELTA TRAP: pre 4/10 (40%), post 449/1000 (44.9%) → rounded delta 5 BUT raw 4.9pp → SILENT", () => {
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: [...preTen(4, 10), ...postTen(449, 1000)],
      now: NOW,
    });
    expect(r.per_platform.chatgpt.pre_share_pct).toBe(40);
    expect(r.per_platform.chatgpt.post_share_pct).toBe(45);
    // Display rounds to 5 — but status MUST remain silent because raw < 5.
    expect(r.per_platform.chatgpt.delta_pp).toBe(5);
    expect(r.per_platform.chatgpt.status).toBe("silent");
  });
});

describe("Section 6 C6a — Mode B multi-platform + multi-prompt", () => {
  it("one platform passes, other silent", () => {
    const snaps: DailyMetricSnapshot[] = [
      // ChatGPT: passing
      snap({
        date: "2026-04-01",
        scope_id: PROMPT_A,
        platform: "ChatGPT",
        primary_recommendation_count: 10,
        total_possible: 20,
      }),
      snap({
        date: "2026-04-15",
        scope_id: PROMPT_A,
        platform: "ChatGPT",
        primary_recommendation_count: 14,
        total_possible: 20,
      }),
      // Perplexity: pre 12, post 10 (negative)
      snap({
        date: "2026-04-01",
        scope_id: PROMPT_A,
        platform: "Perplexity",
        primary_recommendation_count: 12,
        total_possible: 20,
      }),
      snap({
        date: "2026-04-15",
        scope_id: PROMPT_A,
        platform: "Perplexity",
        primary_recommendation_count: 10,
        total_possible: 20,
      }),
    ];
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: snaps,
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("pass");
    expect(r.per_platform.perplexity.status).toBe("silent");
  });

  it("both platforms pass", () => {
    const snaps: DailyMetricSnapshot[] = [
      snap({ date: "2026-04-01", scope_id: PROMPT_A, platform: "ChatGPT", primary_recommendation_count: 10, total_possible: 20 }),
      snap({ date: "2026-04-15", scope_id: PROMPT_A, platform: "ChatGPT", primary_recommendation_count: 14, total_possible: 20 }),
      snap({ date: "2026-04-01", scope_id: PROMPT_A, platform: "Perplexity", primary_recommendation_count: 8, total_possible: 20 }),
      snap({ date: "2026-04-15", scope_id: PROMPT_A, platform: "Perplexity", primary_recommendation_count: 14, total_possible: 20 }),
    ];
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: snaps,
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("pass");
    expect(r.per_platform.perplexity.status).toBe("pass");
  });

  it("aggregates correctly across multiple distinct affected prompts", () => {
    const snaps: DailyMetricSnapshot[] = [
      // PROMPT_A pre 4/10, post 7/10
      snap({ date: "2026-04-01", scope_id: PROMPT_A, platform: "ChatGPT", primary_recommendation_count: 4, total_possible: 10 }),
      snap({ date: "2026-04-15", scope_id: PROMPT_A, platform: "ChatGPT", primary_recommendation_count: 7, total_possible: 10 }),
      // PROMPT_B pre 6/10, post 8/10
      snap({ date: "2026-04-01", scope_id: PROMPT_B, platform: "ChatGPT", primary_recommendation_count: 6, total_possible: 10 }),
      snap({ date: "2026-04-15", scope_id: PROMPT_B, platform: "ChatGPT", primary_recommendation_count: 8, total_possible: 10 }),
    ];
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A, PROMPT_B],
      snapshots: snaps,
      now: NOW,
    });
    // pre_count=10, pre_total=20 (50%); post_count=15, post_total=20 (75%); raw delta=25
    expect(r.per_platform.chatgpt.pre_count).toBe(10);
    expect(r.per_platform.chatgpt.pre_total).toBe(20);
    expect(r.per_platform.chatgpt.post_count).toBe(15);
    expect(r.per_platform.chatgpt.post_total).toBe(20);
    expect(r.per_platform.chatgpt.status).toBe("pass");
  });
});

describe("Section 6 C6a — Mode B defensive dedup + filtering", () => {
  it('affectedPromptIds=["p-a","p-a"] yields same result as ["p-a"]', () => {
    const snaps: DailyMetricSnapshot[] = [
      snap({ date: "2026-04-01", scope_id: PROMPT_A, platform: "ChatGPT", primary_recommendation_count: 10, total_possible: 20 }),
      snap({ date: "2026-04-15", scope_id: PROMPT_A, platform: "ChatGPT", primary_recommendation_count: 14, total_possible: 20 }),
    ];
    const r1 = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: snaps,
      now: NOW,
    });
    const r2 = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A, PROMPT_A],
      snapshots: snaps,
      now: NOW,
    });
    expect(r2.per_platform.chatgpt.pre_count).toBe(r1.per_platform.chatgpt.pre_count);
    expect(r2.per_platform.chatgpt.pre_total).toBe(r1.per_platform.chatgpt.pre_total);
    expect(r2.per_platform.chatgpt.post_count).toBe(r1.per_platform.chatgpt.post_count);
    expect(r2.per_platform.chatgpt.post_total).toBe(r1.per_platform.chatgpt.post_total);
  });

  it("filters snapshot rows with primary_recommendation_count === null", () => {
    const snaps: DailyMetricSnapshot[] = [
      snap({ date: "2026-04-01", scope_id: PROMPT_A, platform: "ChatGPT", primary_recommendation_count: null, total_possible: 20 }),
      snap({ date: "2026-04-15", scope_id: PROMPT_A, platform: "ChatGPT", primary_recommendation_count: null, total_possible: 20 }),
    ];
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: snaps,
      now: NOW,
    });
    expect(r.per_platform.chatgpt.pre_total).toBe(0);
    expect(r.per_platform.chatgpt.post_total).toBe(0);
    expect(r.per_platform.chatgpt.status).toBe("still_learning");
  });

  it("filters snapshot rows with total_possible === 0", () => {
    const snaps: DailyMetricSnapshot[] = [
      snap({ date: "2026-04-01", scope_id: PROMPT_A, platform: "ChatGPT", primary_recommendation_count: 5, total_possible: 0 }),
      snap({ date: "2026-04-15", scope_id: PROMPT_A, platform: "ChatGPT", primary_recommendation_count: 5, total_possible: 0 }),
    ];
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: snaps,
      now: NOW,
    });
    expect(r.per_platform.chatgpt.pre_total).toBe(0);
    expect(r.per_platform.chatgpt.post_total).toBe(0);
  });

  it("display fields returned even when status === 'silent'", () => {
    const snaps: DailyMetricSnapshot[] = [
      snap({ date: "2026-04-01", scope_id: PROMPT_A, platform: "ChatGPT", primary_recommendation_count: 12, total_possible: 20 }),
      snap({ date: "2026-04-15", scope_id: PROMPT_A, platform: "ChatGPT", primary_recommendation_count: 10, total_possible: 20 }),
    ];
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: snaps,
      now: NOW,
    });
    expect(r.per_platform.chatgpt.status).toBe("silent");
    expect(r.per_platform.chatgpt.pre_share_pct).toBe(60);
    expect(r.per_platform.chatgpt.post_share_pct).toBe(50);
    expect(r.per_platform.chatgpt.delta_pp).toBe(-10);
  });

  it("display fields null when total === 0", () => {
    const r = computeChangePrimaryModeB({
      recommendedEdit: edit(),
      affectedPromptIds: [PROMPT_A],
      snapshots: [],
      now: NOW,
    });
    expect(r.per_platform.chatgpt.pre_share_pct).toBeNull();
    expect(r.per_platform.chatgpt.post_share_pct).toBeNull();
    expect(r.per_platform.chatgpt.delta_pp).toBeNull();
  });
});
