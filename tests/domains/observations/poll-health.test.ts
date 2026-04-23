import { describe, it, expect } from "vitest";

import {
  computePollHealthFromRuns,
  todayISOUtc,
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
