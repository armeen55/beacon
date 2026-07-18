/**
 * P0 fix (2026-05-13) — pin the active-provider scope filter inside
 * the Today v2 visibility read-model.
 *
 * Background: `daily_metric_snapshots` retains rows from the pre-pivot
 * Profound import era, including `platform = "Google AI Overviews"`.
 * The native poll pipeline no longer refreshes that data, but the
 * Phase 2B loader's snapshot read returned all platform rows in the
 * window — Today v2 was mixing dead historical metrics into the
 * chart + leaderboard.
 *
 * Fix: `indexSnapshots` now drops any row whose `platform` is not in
 * the active-provider set defined by
 * `canonicalizePollPlatform` (poll-health.ts:194). That helper is the
 * single source of truth — currently "perplexity" + "chatgpt" — and
 * picks up future provider additions automatically.
 *
 * These tests pin:
 *
 *   1. `isActiveSnapshotPlatform` accepts ChatGPT + Perplexity in
 *      every casing the data layer emits.
 *   2. `isActiveSnapshotPlatform` rejects "Google AI Overviews" (the
 *      historical-only platform).
 *   3. `indexSnapshots` drops Google AI Overviews rows from the
 *      platform map AND the entity map — neither chart nor leaderboard
 *      can see them downstream.
 *   4. `indexSnapshots` keeps ChatGPT + Perplexity rows in both maps.
 *   5. `sampledDates` excludes dates whose ONLY rows were on a dead
 *      historical platform.
 */

import { describe, expect, it } from "vitest";

import {
  citedObservationCount,
  indexSnapshots,
  isActiveSnapshotPlatform,
} from "./visibility-read-model";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

function snap(over: Partial<DailyMetricSnapshot>): DailyMetricSnapshot {
  return {
    id: over.id ?? `id-${Math.random().toString(36).slice(2, 8)}`,
    date: over.date ?? "2026-05-13",
    scope_type: over.scope_type ?? "platform",
    scope_id: over.scope_id ?? "perplexity",
    platform: over.platform ?? "Perplexity",
    source_type: over.source_type ?? "derived",
    visibility_score: over.visibility_score ?? null,
    mention_count: over.mention_count ?? 0,
    citation_count: over.citation_count ?? 0,
    share_of_voice: over.share_of_voice ?? null,
    avg_position: over.avg_position ?? null,
    total_possible: over.total_possible ?? 100,
    metadata: over.metadata ?? {},
    tenant_id: over.tenant_id ?? "tenant-test",
    cited_or_mentioned_count: over.cited_or_mentioned_count ?? null,
    cited_obs_count: over.cited_obs_count ?? null,
    position_weighted_citation_count:
      over.position_weighted_citation_count ?? null,
    mentioned_obs_count: over.mentioned_obs_count ?? null,
  };
}

describe("citedObservationCount — honest citation-rate numerator", () => {
  it("uses the observation count even when one answer cites many owned URLs", () => {
    const row = snap({
      total_possible: 2,
      citation_count: 7,
      cited_obs_count: 1,
      metadata: { cited_obs_count: 1 },
    });
    expect(citedObservationCount(row)).toBe(1);
  });

  it("reads the production-safe metadata value and bounds historical fallback", () => {
    expect(
      citedObservationCount(
        snap({
          total_possible: 4,
          citation_count: 9,
          cited_obs_count: null,
          metadata: { cited_obs_count: 3 },
        }),
      ),
    ).toBe(3);
    expect(
      citedObservationCount(
        snap({
          total_possible: 4,
          citation_count: 9,
          cited_obs_count: null,
          metadata: {},
        }),
      ),
    ).toBe(4);
  });
});

describe("isActiveSnapshotPlatform — active-provider scope predicate", () => {
  it("returns true for ChatGPT (TitleCase, as written to snapshots)", () => {
    expect(isActiveSnapshotPlatform("ChatGPT")).toBe(true);
  });

  it("returns true for Perplexity (TitleCase)", () => {
    expect(isActiveSnapshotPlatform("Perplexity")).toBe(true);
  });

  it("returns true for lowercase variants (some historical rows)", () => {
    expect(isActiveSnapshotPlatform("chatgpt")).toBe(true);
    expect(isActiveSnapshotPlatform("perplexity")).toBe(true);
  });

  it("returns true for the alternative ChatGPT key 'openai'", () => {
    // The native poll uses NativePollPlatform = "openai" → snapshot
    // label "ChatGPT". `canonicalizePollPlatform` accepts both so
    // legacy backfill paths that may have stored "openai" still pass.
    expect(isActiveSnapshotPlatform("openai")).toBe(true);
  });

  it("returns FALSE for Google AI Overviews (historical-only, never polled natively)", () => {
    expect(isActiveSnapshotPlatform("Google AI Overviews")).toBe(false);
  });

  it("returns FALSE for any case/format variant of google_aio", () => {
    expect(isActiveSnapshotPlatform("google ai overviews")).toBe(false);
    expect(isActiveSnapshotPlatform("Google_AI_Overviews")).toBe(false);
    expect(isActiveSnapshotPlatform("google-ai-overviews")).toBe(false);
  });

  it("returns FALSE for unknown / unrelated strings", () => {
    expect(isActiveSnapshotPlatform("Claude")).toBe(false);
    expect(isActiveSnapshotPlatform("")).toBe(false);
    expect(isActiveSnapshotPlatform("Bing")).toBe(false);
  });
});

describe("indexSnapshots — scope filter cascades through every downstream piece", () => {
  it("drops Google AI Overviews platform rows from the platform map", () => {
    const rows = [
      snap({ scope_type: "platform", scope_id: "perplexity", platform: "Perplexity", date: "2026-05-12" }),
      snap({ scope_type: "platform", scope_id: "chatgpt", platform: "ChatGPT", date: "2026-05-12" }),
      snap({ scope_type: "platform", scope_id: "google_aio", platform: "Google AI Overviews", date: "2026-05-12" }),
    ];
    const idx = indexSnapshots(rows);
    const may12 = idx.platformByDate.get("2026-05-12") ?? [];
    const platforms = may12.map((r) => r.platform).sort();
    expect(platforms).toEqual(["ChatGPT", "Perplexity"]);
    expect(platforms).not.toContain("Google AI Overviews");
  });

  it("drops Google AI Overviews entity rows from the entity map", () => {
    const rows = [
      snap({
        scope_type: "entity",
        scope_id: "ritzbuilders",
        platform: "Perplexity",
        date: "2026-05-12",
        mentioned_obs_count: 60,
      }),
      snap({
        scope_type: "entity",
        scope_id: "ritzbuilders",
        platform: "ChatGPT",
        date: "2026-05-12",
        mentioned_obs_count: 55,
      }),
      // Historical GAIO entity row — must be excluded.
      snap({
        scope_type: "entity",
        scope_id: "ritzbuilders",
        platform: "Google AI Overviews",
        date: "2026-05-12",
        mentioned_obs_count: 7,
      }),
    ];
    const idx = indexSnapshots(rows);
    const brandRows = idx.entityByIdDate.get("ritzbuilders")?.get("2026-05-12") ?? [];
    const platforms = brandRows.map((r) => r.platform).sort();
    expect(platforms).toEqual(["ChatGPT", "Perplexity"]);
    expect(platforms).not.toContain("Google AI Overviews");
  });

  it("keeps ChatGPT + Perplexity rows in both maps with no other side effects", () => {
    const rows = [
      snap({ scope_type: "platform", platform: "ChatGPT", date: "2026-05-12" }),
      snap({ scope_type: "platform", platform: "Perplexity", date: "2026-05-12" }),
      snap({
        scope_type: "entity",
        scope_id: "demattei",
        platform: "ChatGPT",
        date: "2026-05-12",
      }),
      snap({
        scope_type: "entity",
        scope_id: "demattei",
        platform: "Perplexity",
        date: "2026-05-12",
      }),
    ];
    const idx = indexSnapshots(rows);
    expect(idx.platformByDate.get("2026-05-12")?.length).toBe(2);
    expect(idx.entityByIdDate.get("demattei")?.get("2026-05-12")?.length).toBe(
      2,
    );
  });

  it("excludes dates whose ONLY rows were on a dead historical platform", () => {
    const rows = [
      // 2026-05-11 has both ChatGPT + Perplexity AND a GAIO row.
      snap({ scope_type: "platform", platform: "ChatGPT", date: "2026-05-11" }),
      snap({ scope_type: "platform", platform: "Perplexity", date: "2026-05-11" }),
      snap({
        scope_type: "platform",
        platform: "Google AI Overviews",
        date: "2026-05-11",
      }),
      // 2026-05-10 has ONLY a GAIO row (historical-only day). After
      // the filter the date should not appear in sampledDates.
      snap({
        scope_type: "platform",
        platform: "Google AI Overviews",
        date: "2026-05-10",
      }),
    ];
    const idx = indexSnapshots(rows);
    expect(idx.sampledDates).toEqual(["2026-05-11"]);
    expect(idx.sampledDates).not.toContain("2026-05-10");
  });

  it("never lets a Google AI Overviews row leak into ANY index value", () => {
    const rows = [
      snap({ scope_type: "platform", platform: "Google AI Overviews" }),
      snap({
        scope_type: "entity",
        scope_id: "ritzbuilders",
        platform: "Google AI Overviews",
      }),
      snap({
        scope_type: "entity",
        scope_id: "demattei",
        platform: "Google AI Overviews",
      }),
    ];
    const idx = indexSnapshots(rows);
    // Every map must be empty.
    expect(idx.platformByDate.size).toBe(0);
    expect(idx.entityByIdDate.size).toBe(0);
    expect(idx.sampledDates).toEqual([]);
  });

  it("preserves non-derived (benchmark / Profound-era) rows are dropped regardless of platform", () => {
    // The existing `source_type !== 'derived'` filter still applies.
    const rows = [
      snap({
        scope_type: "platform",
        platform: "ChatGPT",
        source_type: "benchmark",
      }),
      snap({
        scope_type: "platform",
        platform: "Perplexity",
        source_type: "derived",
      }),
    ];
    const idx = indexSnapshots(rows);
    const may13 = idx.platformByDate.get("2026-05-13") ?? [];
    expect(may13.length).toBe(1);
    expect(may13[0].platform).toBe("Perplexity");
  });
});
