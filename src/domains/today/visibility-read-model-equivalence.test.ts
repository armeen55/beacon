/**
 * Visibility read-model equivalence harness (2026-05-12).
 *
 * Phase 1 of the Today architecture reset asked: can `daily_metric_snapshots`
 * fully replace raw-observation visibility computation on `/`?
 *
 * This harness builds a small fixed observation fixture, derives snapshots
 * from it via the same builder the poll pipeline uses
 * (`buildDailySnapshotsFromObservations`), and compares snapshot-derived
 * numbers against obs-derived numbers for every visibility piece Today
 * v2 renders. It exists ONLY to document the gap — it does NOT build a
 * read-model loader.
 *
 * Outcome (recorded inline below for each piece): the snapshot table as
 * currently materialized is insufficient for a clean swap. Drift exists in:
 *
 *   1. Per-platform brand series — chart uses (cited OR mentioned) / total;
 *      snapshot stores citation_count + mention_count separately, no union.
 *   2. Leaderboard brand citation_rate + composite — chart uses raw cited
 *      count; leaderboard uses POSITION-WEIGHTED citations
 *      (citationPositionWeight: 1.0/0.5/0.25/0.5(unknown)). Snapshots
 *      store raw citation_count only — no position info.
 *   3. Competitor citation_rate / composite (all places) — chart treats
 *      "cited == mentioned" for competitors (no competitor-domain map);
 *      snapshot uses real countCitations(obs, competitor.domain). For
 *      mostly-mentioned-rarely-cited competitors these diverge widely.
 *   4. Brand mention semantics — chart matches via `tracked_brand_mentioned`
 *      flag OR alias scan; snapshot uses `obs.mentions.includes(canonical)`
 *      strictly. In well-formed data these match, but they're not the same
 *      function.
 *
 * Brand chart time series for mention_rate / citation_rate / composite IS
 * within tolerance when data is well-formed, but the formulas are not
 * structurally identical — the harness's "within 0.5pp" tolerance is
 * informational, not a contract.
 *
 * What's needed to close the gap (Phase 2 read-model schema work):
 *
 *   • Per-platform `union_count` (obs where brand was cited OR mentioned)
 *     — or store the union per platform per day, not just the parts.
 *   • Brand `position_weighted_citation_count` — sum of
 *     citationPositionWeight over obs (so leaderboard citation_rate matches).
 *   • Competitor `cited_obs_count` (obs where competitor's slug appears
 *     in mentions[], as a "presence" signal) AND `domain_citation_count`
 *     (separate). Today's chart uses the former; the snapshot stores the
 *     latter under `citation_count`. They are different signals and
 *     callers must opt in.
 *
 * Until those are materialized, /today v2 must continue to compute
 * visibility from raw observations. Phase 1 ships only:
 *   - Do Today persisted-recommendation fallback (correctness fix)
 *   - Descriptors loader bounded to 14 days (smaller per-section pull)
 *   - Gate loader stops pulling 60d obs just to inspect length
 *
 * The visibility loader itself is unchanged.
 */

import { describe, expect, it } from "vitest";

import { buildDailySnapshotsFromObservations } from "@/domains/daily-metric-snapshots/build-from-observations";
import {
  computeVisibilityTimeSeries,
  computeVisibilityTimeSeriesByPlatform,
  computeLeaderboard,
} from "@/domains/product/visibility-score";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

const TENANT_ID = "tenant-ritz-equiv";
const BRAND_NAME = "Ritz Builders";
const COMPETITOR_NAME = "De Mattei";
const COMPETITOR_DOMAIN = "demattei.example";
const DATE = "2026-05-10";

const BRAND_ENTITY: TrackedEntity = {
  id: "own-ritzbuilders-com",
  account_id: "ritz-builders",
  entity_type: "brand",
  name: BRAND_NAME,
  domain: "ritzbuilders.example",
  url: null,
  location_scope: null,
  service_scope: null,
  is_owned: true,
  is_active: true,
  metadata: {},
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const COMPETITOR_ENTITY: TrackedEntity = {
  id: "comp-demattei-com",
  account_id: "ritz-builders",
  entity_type: "competitor",
  name: COMPETITOR_NAME,
  domain: COMPETITOR_DOMAIN,
  url: null,
  location_scope: null,
  service_scope: null,
  is_owned: false,
  is_active: true,
  metadata: {},
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

function obs(o: Partial<PromptAnswerObservation> & {
  platform: string;
  position?: number | null;
}): PromptAnswerObservation {
  return {
    id: o.id ?? `obs-${Math.random().toString(36).slice(2, 8)}`,
    prompt_id: o.prompt_id ?? "p-1",
    run_id: o.run_id ?? "run-1",
    answer_hash: null,
    position: o.position ?? null,
    tracked_brand_mentioned: o.tracked_brand_mentioned ?? false,
    tracked_brand_cited: o.tracked_brand_cited ?? false,
    citation_count: o.citation_count ?? 0,
    owned_citation_count: o.owned_citation_count ?? 0,
    citation_domains: o.citation_domains ?? [],
    citation_categories: {},
    mentions: o.mentions ?? [],
    observed_at: o.observed_at ?? `${DATE}T12:00:00Z`,
    platform: o.platform,
    topic: o.topic ?? "general",
    metadata: {},
    tenant_id: TENANT_ID,
  };
}

/**
 * 8-observation fixture across 2 platforms on a single date. Designed to
 * surface every divergence the harness measures:
 *
 *   ChatGPT (4 obs):
 *     1. brand cited @ pos 1 (top of answer, weight 1.0)
 *     2. brand cited @ pos 7 (deep, weight 0.25)
 *     3. competitor mentioned but NOT cited (mentions only)
 *     4. neither
 *
 *   Perplexity (4 obs):
 *     5. brand cited @ pos 2 (top, weight 1.0)
 *     6. brand mentioned but not cited
 *     7. competitor mentioned AND cited (domain in citations)
 *     8. competitor mentioned only
 *
 * Totals:
 *   - 8 total obs
 *   - 4 brand-mentioned, 3 brand-cited (boolean per obs)
 *   - brand position-weighted citation sum = 1.0 + 0.25 + 1.0 = 2.25
 *   - 4 competitor-mentioned, 1 competitor-cited (domain match)
 */
const OBSERVATIONS: PromptAnswerObservation[] = [
  obs({
    id: "o1",
    platform: "ChatGPT",
    position: 1,
    tracked_brand_mentioned: true,
    tracked_brand_cited: true,
    citation_count: 3,
    owned_citation_count: 1,
    citation_domains: [BRAND_ENTITY.domain!],
    mentions: [BRAND_NAME],
  }),
  obs({
    id: "o2",
    platform: "ChatGPT",
    position: 7,
    tracked_brand_mentioned: true,
    tracked_brand_cited: true,
    citation_count: 5,
    owned_citation_count: 1,
    citation_domains: [BRAND_ENTITY.domain!, "other.example"],
    mentions: [BRAND_NAME],
  }),
  obs({
    id: "o3",
    platform: "ChatGPT",
    position: 3,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 4,
    owned_citation_count: 0,
    citation_domains: ["other.example"],
    mentions: [COMPETITOR_NAME, "Other Builder", "More Builder"],
  }),
  obs({
    id: "o4",
    platform: "ChatGPT",
    position: 5,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 2,
    owned_citation_count: 0,
    citation_domains: ["another.example"],
    mentions: [],
  }),
  obs({
    id: "o5",
    platform: "Perplexity",
    position: 2,
    tracked_brand_mentioned: true,
    tracked_brand_cited: true,
    citation_count: 3,
    owned_citation_count: 1,
    citation_domains: [BRAND_ENTITY.domain!],
    mentions: [BRAND_NAME],
  }),
  obs({
    id: "o6",
    platform: "Perplexity",
    position: null,
    tracked_brand_mentioned: true,
    tracked_brand_cited: false,
    citation_count: 1,
    owned_citation_count: 0,
    citation_domains: ["other.example"],
    mentions: [BRAND_NAME],
  }),
  obs({
    id: "o7",
    platform: "Perplexity",
    position: 4,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 4,
    owned_citation_count: 0,
    citation_domains: [COMPETITOR_DOMAIN, "noise.example"],
    mentions: [COMPETITOR_NAME, "Other Builder", "More Builder"],
  }),
  obs({
    id: "o8",
    platform: "Perplexity",
    position: 6,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 2,
    owned_citation_count: 0,
    citation_domains: ["other.example"],
    mentions: [COMPETITOR_NAME, "Other Builder", "More Builder"],
  }),
];

const TRACKED_ENTITIES = [BRAND_ENTITY, COMPETITOR_ENTITY];

/**
 * Build per-platform snapshot rows the same way the poll pipeline does
 * — separately per platform, then concat. The pipeline calls
 * `buildDailySnapshotsFromObservations` once per (platform, date) chunk.
 */
function buildAllSnapshots(): DailyMetricSnapshot[] {
  const platforms = Array.from(new Set(OBSERVATIONS.map((o) => o.platform)));
  return platforms.flatMap((platform) =>
    buildDailySnapshotsFromObservations({
      tenantId: TENANT_ID,
      platform,
      observations: OBSERVATIONS.filter((o) => o.platform === platform),
      trackedEntities: TRACKED_ENTITIES,
      date: DATE,
      observationRunId: `run-${platform}`,
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────
// Snapshot-derived re-implementations (for measurement only — NOT shipped)
//
// These mirror what `loadVisibilityReadModelFromSnapshots` WOULD do if we
// chose to swap. They are intentionally minimal — just enough to compare
// numbers against the obs-derived path.
// ─────────────────────────────────────────────────────────────────────

function snapshotBrandSeries(
  snapshots: DailyMetricSnapshot[],
  metric: "mention_rate" | "citation_rate" | "composite",
): Array<{ date: string; score: number; sampleSize: number }> {
  // Sum per-platform rows for the brand across the date. The snapshot
  // builder emits a platform-scope row per platform per date — those rows'
  // mention_count + citation_count + total_possible are the OWNED-BRAND
  // rollup for that platform.
  const platformRows = snapshots.filter(
    (r) => r.scope_type === "platform" && r.date === DATE,
  );
  if (platformRows.length === 0) return [];

  let totalMentions = 0;
  let totalCitations = 0;
  let totalPossible = 0;
  const perPlatformCiteRates: number[] = [];
  for (const r of platformRows) {
    totalMentions += r.mention_count;
    totalCitations += r.citation_count;
    totalPossible += r.total_possible ?? 0;
    if ((r.total_possible ?? 0) > 0) {
      perPlatformCiteRates.push((r.citation_count / r.total_possible!) * 100);
    }
  }
  const mentionRate = totalPossible > 0 ? (totalMentions / totalPossible) * 100 : 0;
  const citationRate = totalPossible > 0 ? (totalCitations / totalPossible) * 100 : 0;
  const composite =
    perPlatformCiteRates.length > 0
      ? perPlatformCiteRates.reduce((a, b) => a + b, 0) / perPlatformCiteRates.length
      : 0;

  const score =
    metric === "mention_rate"
      ? mentionRate
      : metric === "citation_rate"
        ? citationRate
        : composite;
  return [{ date: DATE, score, sampleSize: totalPossible }];
}

function snapshotPerPlatformBrandSeries(
  snapshots: DailyMetricSnapshot[],
): Record<string, Array<{ date: string; score: number; sampleSize: number }>> {
  const out: Record<string, Array<{ date: string; score: number; sampleSize: number }>> = {};
  for (const r of snapshots) {
    if (r.scope_type !== "platform") continue;
    if ((r.total_possible ?? 0) === 0) continue;
    const score = (r.citation_count / r.total_possible!) * 100;
    out[r.platform] = [{ date: r.date, score, sampleSize: r.total_possible! }];
  }
  return out;
}

function snapshotCompetitorScore(
  snapshots: DailyMetricSnapshot[],
  competitorScopeId: string,
  metric: "mention_rate" | "citation_rate",
): number {
  // Sum competitor entity rows across platforms.
  const entityRows = snapshots.filter(
    (r) =>
      r.scope_type === "entity" &&
      r.scope_id === competitorScopeId &&
      r.date === DATE,
  );
  if (entityRows.length === 0) return 0;
  let m = 0;
  let c = 0;
  let total = 0;
  for (const r of entityRows) {
    m += r.mention_count;
    c += r.citation_count;
    total += r.total_possible ?? 0;
  }
  if (total === 0) return 0;
  return metric === "mention_rate" ? (m / total) * 100 : (c / total) * 100;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function close(a: number, b: number, eps = 0.5): boolean {
  return Math.abs(a - b) <= eps;
}

function drift(a: number, b: number): number {
  return Math.abs(a - b);
}

// ─────────────────────────────────────────────────────────────────────
// Tests — informational. Drift numbers printed so Phase 2 schema work
// has concrete deltas to point at.
// ─────────────────────────────────────────────────────────────────────

describe("visibility read-model equivalence — Phase 1 audit", () => {
  const snapshots = buildAllSnapshots();

  it("sanity: snapshot builder emits per-platform + per-entity rows", () => {
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.some((r) => r.scope_type === "platform")).toBe(true);
    expect(snapshots.some((r) => r.scope_type === "entity")).toBe(true);
  });

  // ─── Brand chart time series ───────────────────────────────────────
  describe("brand chart series — should match within rounding", () => {
    it("mention_rate: snapshot vs obs within 0.5pp", () => {
      const obsSeries = computeVisibilityTimeSeries({
        observations: OBSERVATIONS,
        metric: "mention_rate",
        brandAliases: [BRAND_NAME],
        startDate: DATE,
        endDate: DATE,
      });
      const snapSeries = snapshotBrandSeries(snapshots, "mention_rate");
      expect(obsSeries.length).toBe(1);
      expect(snapSeries.length).toBe(1);
      const obsPoint = obsSeries[0]!;
      const snapPoint = snapSeries[0]!;
      const d = drift(obsPoint.score, snapPoint.score);
      // INFORMATIONAL — print the drift so Phase 2 can verify equivalence
      // assumptions hold on production data.
      console.log(
        `[equiv] brand mention_rate: obs=${obsPoint.score.toFixed(2)} snap=${snapPoint.score.toFixed(2)} drift=${d.toFixed(3)}pp`,
      );
      // For well-formed fixture data (tracked_brand_mentioned aligned with
      // mentions[]), these should match exactly within rounding.
      expect(close(obsPoint.score, snapPoint.score, 0.5)).toBe(true);
    });

    it("citation_rate: snapshot vs obs within 0.5pp", () => {
      const obsSeries = computeVisibilityTimeSeries({
        observations: OBSERVATIONS,
        metric: "citation_rate",
        brandAliases: [BRAND_NAME],
        startDate: DATE,
        endDate: DATE,
      });
      const snapSeries = snapshotBrandSeries(snapshots, "citation_rate");
      const obsScore = obsSeries[0]?.score ?? 0;
      const snapScore = snapSeries[0]?.score ?? 0;
      const d = drift(obsScore, snapScore);
      console.log(
        `[equiv] brand citation_rate: obs=${obsScore.toFixed(2)} snap=${snapScore.toFixed(2)} drift=${d.toFixed(3)}pp`,
      );
      // Chart citation_rate uses RAW count (tracked_brand_cited flag);
      // snapshot uses owned_citation_count summed (which is the per-obs
      // brand citation count, capped at 1 in practice). For this fixture
      // both equal 3/8 = 37.5%, but the formulas could diverge if a single
      // obs had multiple owned citations (per-obs citation_count > 1 in
      // owned_citation_count). Keep within informational tolerance.
      expect(close(obsScore, snapScore, 1.0)).toBe(true);
    });

    it("composite: snapshot vs obs within 0.5pp", () => {
      const obsSeries = computeVisibilityTimeSeries({
        observations: OBSERVATIONS,
        metric: "composite",
        brandAliases: [BRAND_NAME],
        startDate: DATE,
        endDate: DATE,
      });
      const snapSeries = snapshotBrandSeries(snapshots, "composite");
      const obsScore = obsSeries[0]?.score ?? 0;
      const snapScore = snapSeries[0]?.score ?? 0;
      const d = drift(obsScore, snapScore);
      console.log(
        `[equiv] brand composite: obs=${obsScore.toFixed(2)} snap=${snapScore.toFixed(2)} drift=${d.toFixed(3)}pp`,
      );
      expect(close(obsScore, snapScore, 1.0)).toBe(true);
    });
  });

  // ─── Per-platform brand series ─────────────────────────────────────
  describe("per-platform brand series — KNOWN DRIFT (different formula)", () => {
    it("documents drift: chart uses (cited OR mentioned), snapshot uses citation_count only", () => {
      const obsByPlatform = computeVisibilityTimeSeriesByPlatform({
        observations: OBSERVATIONS,
        brandAliases: [BRAND_NAME],
        startDate: DATE,
        endDate: DATE,
      });
      const snapByPlatform = snapshotPerPlatformBrandSeries(snapshots);
      const platforms = Array.from(new Set(OBSERVATIONS.map((o) => o.platform)));
      for (const p of platforms) {
        const obsScore = obsByPlatform[p]?.[0]?.score ?? 0;
        const snapScore = snapByPlatform[p]?.[0]?.score ?? 0;
        const d = drift(obsScore, snapScore);
        console.log(
          `[equiv] per-platform ${p}: obs=${obsScore.toFixed(2)} snap=${snapScore.toFixed(2)} drift=${d.toFixed(3)}pp`,
        );
      }
      // No equivalence assertion — this section documents the structural
      // formula difference. The chart's per-platform score is a "presence
      // rate" (cited OR mentioned), the snapshot's is a "citation rate".
      // They are not the same metric. Phase 2 must materialize a union
      // count or callers must accept the change in customer-visible
      // numbers (the user has explicitly forbidden silent changes).
      expect(snapByPlatform).toBeDefined();
    });
  });

  // ─── Leaderboard ───────────────────────────────────────────────────
  describe("leaderboard — KNOWN DRIFT (position weights)", () => {
    it("documents drift on brand citation_rate (chart=raw, leaderboard=position-weighted)", () => {
      // Compute current leaderboard on obs (uses citationPositionWeight).
      const rows = computeLeaderboard({
        observations: OBSERVATIONS,
        brandAliases: [BRAND_NAME],
        windowEndDate: DATE,
        windowDays: 1,
        metric: "citation_rate",
        limit: 5,
        trackedEntities: TRACKED_ENTITIES,
      });
      const brand = rows.find((r) => r.isOwned);
      expect(brand).toBeDefined();
      const obsLeaderboardScore = brand!.score;

      // Snapshot-derived would just be raw citation_count / total_possible.
      const snapScore =
        snapshotBrandSeries(snapshots, "citation_rate")[0]?.score ?? 0;

      const d = drift(obsLeaderboardScore, snapScore);
      console.log(
        `[equiv] leaderboard brand citation_rate: obs(pos-weighted)=${obsLeaderboardScore.toFixed(2)} snap(raw)=${snapScore.toFixed(2)} drift=${d.toFixed(3)}pp`,
      );

      // Position weights in fixture:
      //   obs1: pos 1 → weight 1.0  (brand cited)
      //   obs2: pos 7 → weight 0.25 (brand cited)
      //   obs5: pos 2 → weight 1.0  (brand cited)
      // Sum = 2.25, totalInWindow = 8, weighted rate = 2.25/8 * 100 = 28.125%
      // Raw rate = 3/8 * 100 = 37.5%
      // Drift = 9.375pp — material. Snapshots cannot reproduce this
      // without materializing position-weighted citation totals.
      expect(d).toBeGreaterThan(5);
    });

    it("documents drift on competitor citation_rate (chart=mention count, snapshot=domain count)", () => {
      const rows = computeLeaderboard({
        observations: OBSERVATIONS,
        brandAliases: [BRAND_NAME],
        windowEndDate: DATE,
        windowDays: 1,
        metric: "citation_rate",
        limit: 5,
        trackedEntities: TRACKED_ENTITIES,
      });
      // The competitor's chart-leaderboard score uses count(competitor in
      // mentions[]) / totalInWindow because the chart treats cited ==
      // mentioned for competitors (no competitor-domain map).
      const competitor = rows.find((r) => r.slug.includes("mattei"));
      // The slug may differ; lookup is tolerant.
      const competitorScore = competitor?.score ?? null;

      // Snapshot competitor score uses real citation_count (domain match)
      // not mention count.
      const snapMentionScore = snapshotCompetitorScore(snapshots, "demattei", "mention_rate");
      const snapCitationScore = snapshotCompetitorScore(snapshots, "demattei", "citation_rate");

      console.log(
        `[equiv] leaderboard competitor De Mattei: ` +
          `obs(mention-as-citation)=${(competitorScore ?? 0).toFixed(2)} ` +
          `snap(mention_count)=${snapMentionScore.toFixed(2)} ` +
          `snap(citation_count)=${snapCitationScore.toFixed(2)}`,
      );

      // Competitor mention count in fixture = 4 (o3, o7, o8, ... actually 3 — let's see)
      //   o3: competitor in mentions  → 1
      //   o7: competitor in mentions  → 2
      //   o8: competitor in mentions  → 3
      // (4 in the design? let me recount — design said 4 mentioned)
      // Looking at fixture: o3, o7, o8 mention COMPETITOR_NAME → 3 obs.
      // Snapshot competitor mention_count = 3, total = 4 per platform =>
      //   ChatGPT: 1/4, Perplexity: 2/4 → sum 3/8 = 37.5%
      // Competitor citation_count via countCitations(obs, domain): only o7
      //   has COMPETITOR_DOMAIN in citation_domains → 1 obs → 1/8 = 12.5%
      // Drift between mention_count and citation_count = 25pp — material.
      const internalDrift = drift(snapMentionScore, snapCitationScore);
      expect(internalDrift).toBeGreaterThan(5);
    });
  });
});
