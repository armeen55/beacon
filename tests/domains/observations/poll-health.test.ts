import { describe, it, expect } from "vitest";

import {
  computePollHealthFromRuns,
  todayISOUtc,
  classifySampling,
  aggregateSamplingStatus,
  FULL_RUN_PROMPT_FLOOR,
  PROOF_RUN_PROMPT_CEIL,
  type PollHealthSnapshot,
} from "@/domains/observations/poll-health";
import type { ObservationRun } from "@/domains/observations/types";

function makeRun(
  overrides: Partial<ObservationRun> & {
    source: string;
    status: ObservationRun["status"];
    scope_label: string;
    started_at: string;
  },
): ObservationRun {
  return {
    run_id: `run-${Math.random().toString(36).slice(2, 8)}`,
    run_type: "citation_sample_import",
    completed_at: overrides.started_at,
    pages_scanned: 0,
    pages_changed: 0,
    pages_with_errors: 0,
    guardrail_alerts: 0,
    critical_count: 0,
    regression_count: 0,
    improvement_count: 0,
    tenant_id: "tenant-ritz-founder",
    ...overrides,
  };
}

function chunkRun(
  source: "perplexity-native-poll" | "openai-native-poll",
  offset: number,
  status: ObservationRun["status"],
  writtenCount: number,
  startedAt: string,
): ObservationRun {
  const platformLabel =
    source === "perplexity-native-poll" ? "perplexity" : "chatgpt";
  const scope = `Native ${platformLabel} poll · chunk offset=${offset} limit=25 · ${status === "completed" ? writtenCount : 0}/25 prompts`;
  return makeRun({ source, status, scope_label: scope, started_at: startedAt });
}

describe("computePollHealthFromRuns", () => {
  const date = "2026-04-24";
  const t = (hour: number, minute = 0): string =>
    new Date(Date.UTC(2026, 3, 24, hour, minute, 0)).toISOString();

  it("reports 'pending' for both platforms when no runs exist", () => {
    const snap = computePollHealthFromRuns(date, []);
    expect(snap.date).toBe(date);
    expect(snap.platforms).toHaveLength(2);
    for (const p of snap.platforms) {
      expect(p.status).toBe("pending");
      expect(p.completedChunks).toBe(0);
      expect(p.failedChunks).toBe(0);
      expect(p.observationsWritten).toBe(0);
      expect(p.expectedChunks).toBe(4);
      expect(p.latestRun).toBeUndefined();
    }
  });

  it("reports 'ok' for both platforms when 4 chunks completed with 25 prompts each", () => {
    const runs: ObservationRun[] = [];
    for (const source of [
      "perplexity-native-poll" as const,
      "openai-native-poll" as const,
    ]) {
      for (const offset of [0, 25, 50, 75]) {
        runs.push(chunkRun(source, offset, "completed", 25, t(10, offset / 25)));
      }
    }
    const snap = computePollHealthFromRuns(date, runs);
    for (const p of snap.platforms) {
      expect(p.status).toBe("ok");
      expect(p.completedChunks).toBe(4);
      expect(p.failedChunks).toBe(0);
      expect(p.observationsWritten).toBe(100);
      expect(p.latestRun).toBeDefined();
    }
  });

  it("reports 'partial' when some chunks completed and some failed", () => {
    const runs = [
      chunkRun("perplexity-native-poll", 0, "completed", 25, t(10, 0)),
      chunkRun("perplexity-native-poll", 25, "completed", 25, t(10, 3)),
      chunkRun("perplexity-native-poll", 50, "failed", 0, t(10, 6)),
      chunkRun("perplexity-native-poll", 75, "completed", 25, t(10, 9)),
    ];
    const snap = computePollHealthFromRuns(date, runs);
    const perplexity = snap.platforms.find((p) => p.platform === "perplexity")!;
    expect(perplexity.status).toBe("partial");
    expect(perplexity.completedChunks).toBe(3);
    expect(perplexity.failedChunks).toBe(1);
    expect(perplexity.observationsWritten).toBe(75);

    const chatgpt = snap.platforms.find((p) => p.platform === "chatgpt")!;
    expect(chatgpt.status).toBe("pending");
  });

  it("reports 'failed' when all chunks failed (the 2026-04-23 ChatGPT incident)", () => {
    const runs = [
      chunkRun("openai-native-poll", 0, "failed", 0, t(17, 14)),
      chunkRun("openai-native-poll", 25, "failed", 0, t(17, 14)),
      chunkRun("openai-native-poll", 50, "failed", 0, t(17, 14)),
      chunkRun("openai-native-poll", 75, "failed", 0, t(17, 14)),
    ];
    const snap = computePollHealthFromRuns(date, runs);
    const chatgpt = snap.platforms.find((p) => p.platform === "chatgpt")!;
    expect(chatgpt.status).toBe("failed");
    expect(chatgpt.completedChunks).toBe(0);
    expect(chatgpt.failedChunks).toBe(4);
    expect(chatgpt.observationsWritten).toBe(0);
  });

  it("dedupes repeated chunks for the same offset, taking the latest", () => {
    const runs = [
      // first attempt failed at 17:14
      chunkRun("perplexity-native-poll", 0, "failed", 0, t(17, 14)),
      // retry at 17:55 succeeded
      chunkRun("perplexity-native-poll", 0, "completed", 25, t(17, 55)),
      chunkRun("perplexity-native-poll", 25, "completed", 25, t(17, 20)),
      chunkRun("perplexity-native-poll", 50, "completed", 25, t(17, 22)),
      chunkRun("perplexity-native-poll", 75, "completed", 25, t(17, 25)),
    ];
    const snap = computePollHealthFromRuns(date, runs);
    const perplexity = snap.platforms.find((p) => p.platform === "perplexity")!;
    expect(perplexity.status).toBe("ok");
    expect(perplexity.completedChunks).toBe(4);
    expect(perplexity.failedChunks).toBe(0);
    expect(perplexity.observationsWritten).toBe(100);
  });

  it("handles legacy whole-mode (non-chunked) runs with expectedChunks=1", () => {
    const runs = [
      makeRun({
        source: "perplexity-native-poll",
        status: "completed",
        scope_label: "Native Perplexity poll · 100/100 prompts",
        started_at: t(10, 0),
      }),
    ];
    const snap = computePollHealthFromRuns(date, runs);
    const perplexity = snap.platforms.find((p) => p.platform === "perplexity")!;
    expect(perplexity.status).toBe("ok");
    expect(perplexity.expectedChunks).toBe(1);
    expect(perplexity.completedChunks).toBe(1);
    expect(perplexity.observationsWritten).toBe(100);
  });

  it("ignores runs from other sources (e.g. scan jobs)", () => {
    const runs = [
      makeRun({
        source: "scan-owned-pages",
        status: "completed",
        scope_label: "Website crawl · 35 pages",
        started_at: t(10, 0),
      }),
      chunkRun("perplexity-native-poll", 0, "completed", 25, t(10, 5)),
      chunkRun("perplexity-native-poll", 25, "completed", 25, t(10, 8)),
      chunkRun("perplexity-native-poll", 50, "completed", 25, t(10, 11)),
      chunkRun("perplexity-native-poll", 75, "completed", 25, t(10, 14)),
    ];
    const snap = computePollHealthFromRuns(date, runs);
    const perplexity = snap.platforms.find((p) => p.platform === "perplexity")!;
    expect(perplexity.status).toBe("ok");
    expect(perplexity.completedChunks).toBe(4);
  });

  it("reports 'failed' on legacy whole-mode run when it failed", () => {
    const runs = [
      makeRun({
        source: "openai-native-poll",
        status: "failed",
        scope_label: "Native chatgpt poll · 0/100 prompts",
        started_at: t(10, 0),
      }),
    ];
    const snap = computePollHealthFromRuns(date, runs);
    const chatgpt = snap.platforms.find((p) => p.platform === "chatgpt")!;
    expect(chatgpt.status).toBe("failed");
    expect(chatgpt.failedChunks).toBe(1);
    expect(chatgpt.observationsWritten).toBe(0);
  });
});

describe("todayISOUtc", () => {
  it("returns YYYY-MM-DD for the UTC date of the given clock", () => {
    expect(todayISOUtc(new Date(Date.UTC(2026, 3, 24, 0, 0, 0)))).toBe(
      "2026-04-24",
    );
    expect(todayISOUtc(new Date(Date.UTC(2026, 3, 24, 23, 59, 59)))).toBe(
      "2026-04-24",
    );
    // Crosses UTC midnight
    expect(todayISOUtc(new Date(Date.UTC(2026, 3, 25, 0, 0, 1)))).toBe(
      "2026-04-25",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────
// Bug-1 fix (2026-05-04): persistence cross-check
// ──────────────────────────────────────────────────────────────────────
//
// Operator-reported (post-W4 publish):
//   /today says "Poll (May 4): complete · 4/4 · 100 prompts"
//   but also "Visibility data is 3d stale · Last observation: 2026-05-01"
//
// Root cause: between May 1 ~22:00 UTC and May 4 ~20:08 UTC, the shared
// poll-adapter wrote `competitor_descriptor_windows` into every observation.
// The target Supabase table didn't have that column. dual-write.ts
// silently swallowed the PGRST204 error (because DATA_SOURCE wasn't set
// to "supabase"), so observation_runs stamped as `completed` with
// "25/25 prompts" in scope_label even though ZERO rows persisted.
//
// The fix has two parts:
//   1. dual-write.ts now always throws on persistent error (covered in
//      tests/persistence/dual-write-tenant.test.ts).
//   2. poll-health.ts cross-checks the actual `prompt_answer_observations`
//      row count for the day-platform-tenant. When the chunk total said
//      `ok` with non-zero scope_label totals but DB has zero, downgrade
//      to "failed". (Pinned below.)

describe("Bug-1 — persistence cross-check downgrades silent-failure 'ok' to 'failed'", () => {
  const date = "2026-05-02";
  const t = (hour: number, minute = 0): string =>
    new Date(Date.UTC(2026, 4, 2, hour, minute, 0)).toISOString();

  function fourCompletedChatGptChunks(): ObservationRun[] {
    return [
      chunkRun("openai-native-poll", 0, "completed", 25, t(10, 12)),
      chunkRun("openai-native-poll", 25, "completed", 25, t(10, 16)),
      chunkRun("openai-native-poll", 50, "completed", 25, t(10, 20)),
      chunkRun("openai-native-poll", 75, "completed", 25, t(10, 24)),
    ];
  }

  it("legacy callers (no actual count) keep scope_label totals + status", () => {
    const runs = fourCompletedChatGptChunks();
    const snap = computePollHealthFromRuns(date, runs);
    const chatgpt = snap.platforms.find((p) => p.platform === "chatgpt")!;
    expect(chatgpt.status).toBe("ok");
    expect(chatgpt.observationsWritten).toBe(100);
  });

  it("when DB persistence === 0 despite 'ok' chunks, status downgrades to 'failed' AND observationsWritten reflects DB truth", () => {
    const runs = fourCompletedChatGptChunks();
    const snap = computePollHealthFromRuns(date, runs, {
      chatgpt: 0,
      perplexity: 0,
    });
    const chatgpt = snap.platforms.find((p) => p.platform === "chatgpt")!;
    // The May 2-4 silent-failure signature.
    expect(chatgpt.status).toBe("failed");
    expect(chatgpt.observationsWritten).toBe(0);
    // Chunk counts still reflect what the runs reported (informational).
    expect(chatgpt.completedChunks).toBe(4);
    expect(chatgpt.failedChunks).toBe(0);
  });

  it("when DB persistence equals scope_label totals, status stays 'ok' (no false downgrade)", () => {
    const runs = fourCompletedChatGptChunks();
    const snap = computePollHealthFromRuns(date, runs, {
      chatgpt: 100,
      perplexity: 0,
    });
    const chatgpt = snap.platforms.find((p) => p.platform === "chatgpt")!;
    expect(chatgpt.status).toBe("ok");
    expect(chatgpt.observationsWritten).toBe(100);
  });

  it("when DB persistence is partial (e.g. one chunk truncated), keep run-level status but report DB count", () => {
    // Operator-known: May 1 ChatGPT had 75/100 obs landed (one chunk
    // truncated). The chunk reports "ok" because all 4 ran; the
    // downgrade logic only fires for FULL silence (persisted === 0
    // with reported > 0). Partial shortfalls remain "ok" with the
    // DB count surfaced as truth.
    const runs = fourCompletedChatGptChunks();
    const snap = computePollHealthFromRuns(date, runs, {
      chatgpt: 75,
      perplexity: 0,
    });
    const chatgpt = snap.platforms.find((p) => p.platform === "chatgpt")!;
    expect(chatgpt.status).toBe("ok");
    expect(chatgpt.observationsWritten).toBe(75);
  });

  it("legacy whole-mode runs ALSO downgrade when persistence is missing", () => {
    const runs: ObservationRun[] = [
      makeRun({
        source: "perplexity-native-poll",
        status: "completed",
        scope_label: "Native perplexity poll · 100/100 prompts",
        started_at: t(10, 0),
      }),
    ];
    // Legacy call path: no third arg → preserves old behavior.
    const legacy = computePollHealthFromRuns(date, runs);
    const legacyPerp = legacy.platforms.find((p) => p.platform === "perplexity")!;
    expect(legacyPerp.status).toBe("ok");
    expect(legacyPerp.observationsWritten).toBe(100);

    // New call path with actual=0 → downgrade.
    const truth = computePollHealthFromRuns(date, runs, {
      chatgpt: 0,
      perplexity: 0,
    });
    const truthPerp = truth.platforms.find((p) => p.platform === "perplexity")!;
    expect(truthPerp.status).toBe("failed");
    expect(truthPerp.observationsWritten).toBe(0);
  });

  it("zero runs + zero persistence stays 'pending' (no spurious downgrade)", () => {
    const snap = computePollHealthFromRuns(date, [], {
      chatgpt: 0,
      perplexity: 0,
    });
    for (const p of snap.platforms) {
      expect(p.status).toBe("pending");
      expect(p.observationsWritten).toBe(0);
    }
  });

  it("partial-persistence on one platform doesn't bleed into the other platform's status", () => {
    const runs = [
      ...fourCompletedChatGptChunks(),
      chunkRun("perplexity-native-poll", 0, "completed", 25, t(10, 14)),
      chunkRun("perplexity-native-poll", 25, "completed", 25, t(10, 18)),
      chunkRun("perplexity-native-poll", 50, "completed", 25, t(10, 22)),
      chunkRun("perplexity-native-poll", 75, "completed", 25, t(10, 26)),
    ];
    const snap = computePollHealthFromRuns(date, runs, {
      chatgpt: 0, // silently failed
      perplexity: 100, // persisted cleanly
    });
    const chatgpt = snap.platforms.find((p) => p.platform === "chatgpt")!;
    const perplexity = snap.platforms.find((p) => p.platform === "perplexity")!;
    expect(chatgpt.status).toBe("failed");
    expect(perplexity.status).toBe("ok");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Partial-day patch (2026-05-04, post-W4 audit) — samplingStatus signal
// ──────────────────────────────────────────────────────────────────────
//
// Operator-reported (post-write-proof): May 4 has only a 5-prompt manual
// proof run. Without a partial-day signal, /today's headline KPIs +
// sparklines treat 5 obs the same as 100, distorting deltas.
//
// The new field `samplingStatus: "full" | "partial" | "proof" | "empty"`
// surfaces sample size class on every PlatformPollHealth so downstream
// surfaces (KPI tiles, sparklines, copy) can mute or warn.
//
// Operator-locked thresholds:
//   ≥ 80 obs       → "full"
//   10–79 obs      → "partial"
//   1–9 obs        → "proof"
//   0 obs          → "empty"

describe("Partial-day — classifySampling thresholds (operator-locked)", () => {
  it("0 observations → 'empty'", () => {
    expect(classifySampling(0)).toBe("empty");
  });

  it("1–9 observations → 'proof' (manual-proof-style runs)", () => {
    expect(classifySampling(1)).toBe("proof");
    expect(classifySampling(5)).toBe("proof"); // operator's exact case
    expect(classifySampling(PROOF_RUN_PROMPT_CEIL)).toBe("proof");
  });

  it("10–79 observations → 'partial' (some chunks missed)", () => {
    expect(classifySampling(PROOF_RUN_PROMPT_CEIL + 1)).toBe("partial");
    expect(classifySampling(50)).toBe("partial");
    expect(classifySampling(FULL_RUN_PROMPT_FLOOR - 1)).toBe("partial");
  });

  it("≥ 80 observations → 'full' (normal-sized day)", () => {
    expect(classifySampling(FULL_RUN_PROMPT_FLOOR)).toBe("full");
    expect(classifySampling(100)).toBe("full");
    expect(classifySampling(150)).toBe("full");
  });

  it("operator-locked thresholds match the master plan (80/9)", () => {
    expect(FULL_RUN_PROMPT_FLOOR).toBe(80);
    expect(PROOF_RUN_PROMPT_CEIL).toBe(9);
  });
});

describe("Partial-day — samplingStatus on PlatformPollHealth", () => {
  const date = "2026-05-04";
  const t = (hour: number, minute = 0): string =>
    new Date(Date.UTC(2026, 4, 4, hour, minute, 0)).toISOString();

  it("operator's exact May 4 case: 1 manual chunk of 5 prompts → samplingStatus='proof'", () => {
    // The May 4 manual proof: 1 chunk, 5 prompts persisted.
    const runs = [
      chunkRun("perplexity-native-poll", 0, "completed", 5, t(20, 59)),
    ];
    const snap = computePollHealthFromRuns(date, runs, {
      chatgpt: 0,
      perplexity: 5, // truthful DB count
    });
    const perp = snap.platforms.find((p) => p.platform === "perplexity")!;
    expect(perp.samplingStatus).toBe("proof");
    expect(perp.observationsWritten).toBe(5);
    // Status is "partial" — only 1 of 4 expected chunks completed.
    // samplingStatus is an INDEPENDENT axis from run-level pass/fail
    // and surfaces the sample SIZE separately from chunk completeness.
    expect(perp.status).toBe("partial");
  });

  it("100-obs full daily run → samplingStatus='full'", () => {
    const runs = [
      chunkRun("perplexity-native-poll", 0, "completed", 25, t(10, 0)),
      chunkRun("perplexity-native-poll", 25, "completed", 25, t(10, 4)),
      chunkRun("perplexity-native-poll", 50, "completed", 25, t(10, 8)),
      chunkRun("perplexity-native-poll", 75, "completed", 25, t(10, 12)),
    ];
    const snap = computePollHealthFromRuns(date, runs, {
      chatgpt: 0,
      perplexity: 100,
    });
    const perp = snap.platforms.find((p) => p.platform === "perplexity")!;
    expect(perp.samplingStatus).toBe("full");
  });

  it("50-obs partial day (e.g. 2 chunks landed) → samplingStatus='partial'", () => {
    const runs = [
      chunkRun("perplexity-native-poll", 0, "completed", 25, t(10, 0)),
      chunkRun("perplexity-native-poll", 25, "completed", 25, t(10, 4)),
      chunkRun("perplexity-native-poll", 50, "failed", 0, t(10, 8)),
      chunkRun("perplexity-native-poll", 75, "failed", 0, t(10, 12)),
    ];
    const snap = computePollHealthFromRuns(date, runs, {
      chatgpt: 0,
      perplexity: 50,
    });
    const perp = snap.platforms.find((p) => p.platform === "perplexity")!;
    expect(perp.samplingStatus).toBe("partial");
  });

  it("0 obs (silent-failure pre-fix May 2-4 pattern) → samplingStatus='empty' AND status='failed'", () => {
    const runs = [
      chunkRun("perplexity-native-poll", 0, "completed", 25, t(10, 0)),
      chunkRun("perplexity-native-poll", 25, "completed", 25, t(10, 4)),
      chunkRun("perplexity-native-poll", 50, "completed", 25, t(10, 8)),
      chunkRun("perplexity-native-poll", 75, "completed", 25, t(10, 12)),
    ];
    const snap = computePollHealthFromRuns(date, runs, {
      chatgpt: 0,
      perplexity: 0, // silent failure: chunks reported "completed" but DB has zero
    });
    const perp = snap.platforms.find((p) => p.platform === "perplexity")!;
    expect(perp.samplingStatus).toBe("empty");
    expect(perp.status).toBe("failed");
  });

  it("zero runs (cron not yet fired) → samplingStatus='empty' AND status='pending'", () => {
    const snap = computePollHealthFromRuns(date, [], {
      chatgpt: 0,
      perplexity: 0,
    });
    for (const p of snap.platforms) {
      expect(p.samplingStatus).toBe("empty");
      expect(p.status).toBe("pending");
    }
  });

  it("legacy callers (no actual count provided) get samplingStatus computed from scope_label totals", () => {
    // Backwards compatibility: when actualCount isn't supplied,
    // observationsWritten falls back to scope_label parsing.
    // samplingStatus is then derived from that fallback. A normal
    // 4-chunk completed run reports 100 → "full".
    const runs = [
      chunkRun("perplexity-native-poll", 0, "completed", 25, t(10, 0)),
      chunkRun("perplexity-native-poll", 25, "completed", 25, t(10, 4)),
      chunkRun("perplexity-native-poll", 50, "completed", 25, t(10, 8)),
      chunkRun("perplexity-native-poll", 75, "completed", 25, t(10, 12)),
    ];
    const snap = computePollHealthFromRuns(date, runs);
    const perp = snap.platforms.find((p) => p.platform === "perplexity")!;
    expect(perp.observationsWritten).toBe(100);
    expect(perp.samplingStatus).toBe("full");
  });

  it("mixed: chatgpt full, perplexity proof (asymmetric — operator's actual May 4 state)", () => {
    // Operator's actual May 4 state: a perplexity proof run (5) and a
    // chatgpt proof run (5) are the only writes — the rest of the day
    // was silent-failure obs that didn't land.
    const runs = [
      chunkRun("perplexity-native-poll", 0, "completed", 5, t(20, 59)),
      chunkRun("openai-native-poll", 0, "completed", 5, t(21, 0)),
    ];
    const snap = computePollHealthFromRuns(date, runs, {
      chatgpt: 5,
      perplexity: 5,
    });
    const chatgpt = snap.platforms.find((p) => p.platform === "chatgpt")!;
    const perp = snap.platforms.find((p) => p.platform === "perplexity")!;
    expect(chatgpt.samplingStatus).toBe("proof");
    expect(perp.samplingStatus).toBe("proof");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Operator R7 — aggregateSamplingStatus for headline KPI tile
// ──────────────────────────────────────────────────────────────────────
//
// Worst-case wins (over-warning is safer than silently rendering a
// 5-obs day as a full day in headline KPI tiles).
// Order: empty > proof > partial > full

function snap(
  perp: PollHealthSnapshot["platforms"][number]["samplingStatus"],
  cgpt: PollHealthSnapshot["platforms"][number]["samplingStatus"],
): PollHealthSnapshot {
  return {
    date: "2026-05-04",
    platforms: [
      {
        platform: "perplexity",
        expectedChunks: 4,
        completedChunks: 1,
        failedChunks: 0,
        observationsWritten: 5,
        status: "ok",
        samplingStatus: perp,
      },
      {
        platform: "chatgpt",
        expectedChunks: 4,
        completedChunks: 1,
        failedChunks: 0,
        observationsWritten: 5,
        status: "ok",
        samplingStatus: cgpt,
      },
    ],
  };
}

describe("aggregateSamplingStatus (Operator R7 — worst-case wins)", () => {
  it("both 'full' → 'full'", () => {
    expect(aggregateSamplingStatus(snap("full", "full"))).toBe("full");
  });
  it("one 'proof' + one 'full' → 'proof' (the operator's exact May 4 case)", () => {
    expect(aggregateSamplingStatus(snap("proof", "full"))).toBe("proof");
    expect(aggregateSamplingStatus(snap("full", "proof"))).toBe("proof");
  });
  it("one 'partial' + one 'full' → 'partial'", () => {
    expect(aggregateSamplingStatus(snap("partial", "full"))).toBe("partial");
  });
  it("'empty' beats everything (silent-failure pattern)", () => {
    expect(aggregateSamplingStatus(snap("empty", "full"))).toBe("empty");
    expect(aggregateSamplingStatus(snap("empty", "proof"))).toBe("empty");
    expect(aggregateSamplingStatus(snap("empty", "partial"))).toBe("empty");
  });
  it("both 'proof' → 'proof'", () => {
    expect(aggregateSamplingStatus(snap("proof", "proof"))).toBe("proof");
  });
  it("'partial' + 'proof' → 'proof' (proof is worse than partial)", () => {
    expect(aggregateSamplingStatus(snap("partial", "proof"))).toBe("proof");
  });
});
