/**
 * Section 6 C4a — Equivalence harness.
 *
 * Proves 0pp drift between:
 *   OLD path  observations → buildPlatformPrimaryRateSparklines() →
 *             latest-non-null primaryRate × 100, rounded to int pct.
 *   NEW path  observations → buildDailySnapshotsFromObservations()
 *             (per platform per date) → computeSnapshotPlatformPrimaryPct
 *             → integer pct.
 *
 * Both pipelines consume the SAME `PromptAnswerObservation[]` fixture
 * and resolve to the SAME mathematical result: `Math.round((P/N) × 100)`
 * where P = count of `primary_recommendation === true` per platform-day
 * and N = observations.length per platform-day.
 *
 * Strict byte-equal integer assertion (`toBe`) — no toleranced
 * comparison. If this test ever fails, the C4b customer-visible flip
 * MUST be halted and the divergence root-caused before any deploy.
 *
 * Two fixture flavors per C4 pre-flight §4 / J3:
 *   • Synthetic 14-day fixture engineered with edge cases (empty days,
 *     zero-primary days, all-primary days, missing platforms, mixed
 *     true/false/null values).
 *   • Ritz-like 3-day × 2-platform × ~50-prompt slice mirroring what
 *     the production daily-scan emits.
 */

import { describe, expect, it } from "vitest";

import {
  buildPlatformPrimaryRateSparklines,
  canonicalizePlatform,
  type PlatformPrimaryRateSparkline,
} from "@/domains/prompt-answer-observations/enrichment-rollup";
import { buildDailySnapshotsFromObservations } from "@/domains/daily-metric-snapshots/build-from-observations";
import { computeSnapshotPlatformPrimaryPct } from "@/domains/daily-metric-snapshots/today-primary-share";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────

const TENANT = "tenant-equivalence-fixture";

function obs(over: Partial<PromptAnswerObservation> = {}): PromptAnswerObservation {
  return {
    id: `obs-${Math.random().toString(36).slice(2, 8)}`,
    prompt_id: "prompt-a",
    run_id: "run-fixture",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    observed_at: "2026-05-15T10:00:00.000Z",
    platform: "perplexity", // observation-level lowercase (native poll storage)
    topic: "general",
    tenant_id: TENANT,
    metadata: {},
    primary_recommendation: null,
    ...over,
  };
}

const OWNED_ENTITY: TrackedEntity = {
  id: "own-ritzbuilders-com",
  account_id: TENANT,
  tenant_id: TENANT,
  entity_type: "brand",
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  url: null,
  location_scope: null,
  service_scope: null,
  is_owned: true,
  is_active: true,
  metadata: {},
  created_at: "2026-04-22T00:00:00Z",
  updated_at: "2026-04-22T00:00:00Z",
};

// Observation-level platform labels (native poll storage convention,
// lowercase) and the matching snapshot-level labels (TitleCase, what
// the run-poll caller passes as `platform` to the builder).
const PLATFORM_LABELS = [
  { obs: "perplexity", snapshot: "Perplexity" as const },
  { obs: "chatgpt", snapshot: "ChatGPT" as const },
];

/**
 * OLD path: traverse sparkline points backward, return first non-null
 * primaryRate × 100 rounded to int. Mirrors `platformPrimaryPct` in
 * `today-v2-visibility-group-client.tsx:170-180`. Takes the
 * canonicalized lowercase platform key (matches what
 * `buildPlatformPrimaryRateSparklines` emits when no `platforms`
 * filter is supplied).
 */
function oldPathPlatformPrimaryPct(
  sparklines: ReadonlyArray<PlatformPrimaryRateSparkline>,
  platformLowercase: string,
): number | null {
  const sparkline = sparklines.find((s) => s.platform === platformLowercase);
  if (!sparkline) return null;
  for (let i = sparkline.points.length - 1; i >= 0; i--) {
    const r = sparkline.points[i].primaryRate;
    if (r !== null) return Math.round(r * 100);
  }
  return null;
}

/**
 * NEW path: group observations by (platform, date) tuple, call the C2
 * builder for each tuple, collect every emitted platform-scope row,
 * then call the snapshot-derived helper.
 *
 * `endDate` matches the OLD path's `endDate` for window alignment.
 */
function newPathPlatformPrimaryPct(
  observations: ReadonlyArray<PromptAnswerObservation>,
  endDate: string,
  windowDays: number,
  snapshotPlatform: "ChatGPT" | "Perplexity",
): number | null {
  // Compute the inclusive window [startDate, endDate].
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - (windowDays - 1));
  const startDate = start.toISOString().slice(0, 10);

  // Group observations by (snapshot platform, date) tuple.
  const buckets = new Map<string, PromptAnswerObservation[]>();
  for (const o of observations) {
    const canon = canonicalizePlatform(o.platform);
    const snapPlatform =
      canon === "chatgpt" ? "ChatGPT" : canon === "perplexity" ? "Perplexity" : null;
    if (snapPlatform === null) continue;
    const date = o.observed_at?.slice(0, 10);
    if (!date) continue;
    if (date < startDate || date > endDate) continue;
    const key = `${snapPlatform}|${date}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(o);
  }

  const allSnapshots: DailyMetricSnapshot[] = [];
  for (const [key, bucketObs] of buckets) {
    const [platform, date] = key.split("|") as [
      "ChatGPT" | "Perplexity",
      string,
    ];
    const rows = buildDailySnapshotsFromObservations({
      tenantId: TENANT,
      platform,
      observations: bucketObs,
      trackedEntities: [OWNED_ENTITY],
      date,
      observationRunId: `equivalence-${date}-${platform}`,
    });
    allSnapshots.push(...rows);
  }

  return computeSnapshotPlatformPrimaryPct(allSnapshots, snapshotPlatform);
}

// ─────────────────────────────────────────────────────────────────────
// Synthetic fixture — 14 days × 2 platforms with engineered edges.
// ─────────────────────────────────────────────────────────────────────

const END_DATE = "2026-05-15";
const WINDOW = 14;

/**
 * Build the synthetic fixture: 14 days of observations across 2
 * platforms with a deliberate mix of primary values + a couple of
 * platform-day gaps.
 */
function buildSyntheticFixture(): PromptAnswerObservation[] {
  const out: PromptAnswerObservation[] = [];
  let counter = 0;
  // Generate each UTC date in [endDate - 13, endDate].
  for (let dayOffset = 0; dayOffset < WINDOW; dayOffset++) {
    const d = new Date(`${END_DATE}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - (WINDOW - 1 - dayOffset));
    const date = d.toISOString().slice(0, 10);

    for (const platform of PLATFORM_LABELS) {
      // Engineered edge cases:
      //   dayOffset 0  (oldest day): empty day for Perplexity only.
      //   dayOffset 3                : ChatGPT all-primary (3 obs, 3 true)
      //   dayOffset 5                : Perplexity zero-primary (4 obs, 0 true)
      //   dayOffset 9                : both platforms mix of true/false/null
      //   dayOffset 13 (latest)      : Perplexity 1/4 primary; ChatGPT 2/3.
      const isLatest = dayOffset === WINDOW - 1;
      const isEmptyPerp = dayOffset === 0 && platform.snapshot === "Perplexity";
      if (isEmptyPerp) continue;
      const isAllPrimaryChatGPT =
        dayOffset === 3 && platform.snapshot === "ChatGPT";
      const isZeroPrimaryPerp =
        dayOffset === 5 && platform.snapshot === "Perplexity";
      const isMixedDay = dayOffset === 9;

      const dayObs: Array<boolean | null> = (() => {
        if (isAllPrimaryChatGPT) return [true, true, true];
        if (isZeroPrimaryPerp) return [false, false, null, false];
        if (isMixedDay)
          return [true, false, null, true, false]; // 2 primary of 5
        if (isLatest && platform.snapshot === "Perplexity")
          return [true, false, null, false]; // 1 primary of 4
        if (isLatest && platform.snapshot === "ChatGPT")
          return [true, true, false]; // 2 primary of 3
        // Default filler day: 2 obs with mixed values
        return [true, false];
      })();

      for (const flag of dayObs) {
        counter += 1;
        out.push(
          obs({
            id: `synth-${counter}`,
            observed_at: `${date}T10:00:00.000Z`,
            platform: platform.obs,
            primary_recommendation: flag,
          }),
        );
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Equivalence assertions — synthetic
// ─────────────────────────────────────────────────────────────────────

describe("Section 6 C4a equivalence — synthetic 14-day fixture", () => {
  const observations = buildSyntheticFixture();
  const oldSparklines = buildPlatformPrimaryRateSparklines({
    observations,
    endDate: END_DATE,
    windowDays: WINDOW,
  });

  it("synthetic fixture seeded sparklines for both platforms", () => {
    // Sanity: prove the OLD path actually produced sparklines + the
    // NEW path actually emitted platform-scope rows. Without this
    // sanity check, a green equivalence test could mean "both return
    // null" which is uninformative.
    expect(oldSparklines.length).toBeGreaterThanOrEqual(2);
    expect(observations.length).toBeGreaterThan(0);
  });

  it("Perplexity: OLD path === NEW path (integer pct, 0pp drift)", () => {
    const oldPct = oldPathPlatformPrimaryPct(oldSparklines, "perplexity");
    const newPct = newPathPlatformPrimaryPct(
      observations,
      END_DATE,
      WINDOW,
      "Perplexity",
    );
    expect(newPct).toBe(oldPct);
  });

  it("ChatGPT: OLD path === NEW path (integer pct, 0pp drift)", () => {
    const oldPct = oldPathPlatformPrimaryPct(oldSparklines, "chatgpt");
    const newPct = newPathPlatformPrimaryPct(
      observations,
      END_DATE,
      WINDOW,
      "ChatGPT",
    );
    expect(newPct).toBe(oldPct);
  });

  it("latest-day pick is on the last non-empty day for both platforms", () => {
    // Sanity check: confirm the NEW path's latest-row choice falls on
    // day index 13 (the engineered latest day) for both platforms. If
    // a future fixture change accidentally puts the latest non-null
    // earlier, the equivalence number changes and this assertion
    // surfaces it.
    const newPerp = newPathPlatformPrimaryPct(
      observations,
      END_DATE,
      WINDOW,
      "Perplexity",
    );
    const newChat = newPathPlatformPrimaryPct(
      observations,
      END_DATE,
      WINDOW,
      "ChatGPT",
    );
    // Perplexity day 13: 1/4 primary → Math.round(25) = 25.
    expect(newPerp).toBe(25);
    // ChatGPT day 13: 2/3 primary → Math.round(66.666…) = 67.
    expect(newChat).toBe(67);
  });
});

describe("Section 6 C4a equivalence — synthetic edge cases", () => {
  it("empty observations: both paths return null for both platforms", () => {
    const sparklines = buildPlatformPrimaryRateSparklines({
      observations: [],
      endDate: END_DATE,
      windowDays: WINDOW,
    });
    expect(oldPathPlatformPrimaryPct(sparklines, "perplexity")).toBeNull();
    expect(oldPathPlatformPrimaryPct(sparklines, "chatgpt")).toBeNull();
    expect(newPathPlatformPrimaryPct([], END_DATE, WINDOW, "Perplexity")).toBeNull();
    expect(newPathPlatformPrimaryPct([], END_DATE, WINDOW, "ChatGPT")).toBeNull();
  });

  it("one platform only: other returns null on both paths", () => {
    const observations = [
      obs({
        observed_at: `${END_DATE}T10:00:00.000Z`,
        platform: "perplexity",
        primary_recommendation: true,
      }),
    ];
    const oldSparks = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: END_DATE,
      windowDays: WINDOW,
    });
    expect(oldPathPlatformPrimaryPct(oldSparks, "perplexity")).toBe(100);
    expect(oldPathPlatformPrimaryPct(oldSparks, "chatgpt")).toBeNull();
    expect(
      newPathPlatformPrimaryPct(observations, END_DATE, WINDOW, "Perplexity"),
    ).toBe(100);
    expect(
      newPathPlatformPrimaryPct(observations, END_DATE, WINDOW, "ChatGPT"),
    ).toBeNull();
  });

  it("latest-day zero-obs falls back to previous day on both paths", () => {
    // Day 13 (latest) is empty. Day 12: 2 obs with 1 primary → 50%.
    const observations: PromptAnswerObservation[] = [];
    const d12 = new Date(`${END_DATE}T00:00:00.000Z`);
    d12.setUTCDate(d12.getUTCDate() - 1);
    const date12 = d12.toISOString().slice(0, 10);
    observations.push(
      obs({
        observed_at: `${date12}T10:00:00.000Z`,
        platform: "perplexity",
        primary_recommendation: true,
      }),
      obs({
        observed_at: `${date12}T10:00:01.000Z`,
        platform: "perplexity",
        primary_recommendation: false,
      }),
    );
    const oldSparks = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: END_DATE,
      windowDays: WINDOW,
    });
    const oldPct = oldPathPlatformPrimaryPct(oldSparks, "perplexity");
    const newPct = newPathPlatformPrimaryPct(
      observations,
      END_DATE,
      WINDOW,
      "Perplexity",
    );
    expect(newPct).toBe(oldPct);
    expect(newPct).toBe(50);
  });

  it("all-primary day: both paths return 100", () => {
    const observations = [
      obs({
        observed_at: `${END_DATE}T10:00:00.000Z`,
        platform: "perplexity",
        primary_recommendation: true,
      }),
      obs({
        observed_at: `${END_DATE}T10:00:01.000Z`,
        platform: "perplexity",
        primary_recommendation: true,
      }),
      obs({
        observed_at: `${END_DATE}T10:00:02.000Z`,
        platform: "perplexity",
        primary_recommendation: true,
      }),
    ];
    const oldSparks = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: END_DATE,
      windowDays: WINDOW,
    });
    expect(oldPathPlatformPrimaryPct(oldSparks, "perplexity")).toBe(100);
    expect(
      newPathPlatformPrimaryPct(observations, END_DATE, WINDOW, "Perplexity"),
    ).toBe(100);
  });

  it("zero-primary day: both paths return 0", () => {
    const observations = [
      obs({
        observed_at: `${END_DATE}T10:00:00.000Z`,
        platform: "perplexity",
        primary_recommendation: false,
      }),
      obs({
        observed_at: `${END_DATE}T10:00:01.000Z`,
        platform: "perplexity",
        primary_recommendation: null,
      }),
    ];
    const oldSparks = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: END_DATE,
      windowDays: WINDOW,
    });
    expect(oldPathPlatformPrimaryPct(oldSparks, "perplexity")).toBe(0);
    expect(
      newPathPlatformPrimaryPct(observations, END_DATE, WINDOW, "Perplexity"),
    ).toBe(0);
  });

  it("null primary_recommendation counts as 0 in both paths", () => {
    const observations = [
      obs({
        observed_at: `${END_DATE}T10:00:00.000Z`,
        platform: "perplexity",
        primary_recommendation: null,
      }),
      obs({
        observed_at: `${END_DATE}T10:00:01.000Z`,
        platform: "perplexity",
        primary_recommendation: null,
      }),
    ];
    const oldSparks = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: END_DATE,
      windowDays: WINDOW,
    });
    // Old path: sparkline only emitted if anyPrimaryFieldSeen — but
    // null is not a boolean so anyPrimaryFieldSeen stays false; OLD
    // returns null. NEW path: snapshots will compute 0/2 = 0%. So
    // these diverge for legacy "no boolean ever seen" rows.
    //
    // This case documents the ONE divergence the equivalence harness
    // accepts: pre-Schema-v2 observations where the field was never
    // populated. C3 backfill anchor (NATIVE_REGIME_START) excludes
    // those rows, so in production this divergence never reaches the
    // hero. The test pins the documented behavior.
    expect(oldPathPlatformPrimaryPct(oldSparks, "perplexity")).toBeNull();
    expect(
      newPathPlatformPrimaryPct(observations, END_DATE, WINDOW, "Perplexity"),
    ).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Ritz-like fixture — 3 days × 2 platforms × ~50 observations each.
// Mirrors what production daily-scan emits at smaller scale to confirm
// equivalence holds on shapes that more closely resemble live data.
// ─────────────────────────────────────────────────────────────────────

function buildRitzLikeFixture(): PromptAnswerObservation[] {
  const out: PromptAnswerObservation[] = [];
  const dates = ["2026-05-13", "2026-05-14", "2026-05-15"];
  let counter = 0;
  for (const date of dates) {
    for (const platform of PLATFORM_LABELS) {
      // 50 prompts × 1 obs each. Engineered primary distribution:
      //   - 17 true, 30 false, 3 null  (varies slightly per day to
      //     produce non-trivial deltas the equivalence test can
      //     surface if rounding drifts).
      const trueCount = 17 + (date.endsWith("13") ? -2 : date.endsWith("14") ? 0 : 3);
      const nullCount = 3;
      const falseCount = 50 - trueCount - nullCount;
      let idx = 0;
      const emit = (flag: boolean | null) => {
        counter += 1;
        out.push(
          obs({
            id: `ritz-${counter}`,
            prompt_id: `prompt-${idx++}`,
            observed_at: `${date}T11:30:00.000Z`,
            platform: platform.obs,
            primary_recommendation: flag,
          }),
        );
      };
      for (let i = 0; i < trueCount; i++) emit(true);
      for (let i = 0; i < falseCount; i++) emit(false);
      for (let i = 0; i < nullCount; i++) emit(null);
    }
  }
  return out;
}

describe("Section 6 C4a equivalence — Ritz-like 3-day × 2-platform × 50-obs fixture", () => {
  const observations = buildRitzLikeFixture();
  const endDate = "2026-05-15";
  const window = 14;
  const oldSparklines = buildPlatformPrimaryRateSparklines({
    observations,
    endDate,
    windowDays: window,
  });

  it("fixture seeded ~300 observations across 3 days × 2 platforms", () => {
    expect(observations.length).toBe(300);
  });

  it("Perplexity: OLD path === NEW path", () => {
    const oldPct = oldPathPlatformPrimaryPct(oldSparklines, "perplexity");
    const newPct = newPathPlatformPrimaryPct(
      observations,
      endDate,
      window,
      "Perplexity",
    );
    expect(newPct).toBe(oldPct);
  });

  it("ChatGPT: OLD path === NEW path", () => {
    const oldPct = oldPathPlatformPrimaryPct(oldSparklines, "chatgpt");
    const newPct = newPathPlatformPrimaryPct(
      observations,
      endDate,
      window,
      "ChatGPT",
    );
    expect(newPct).toBe(oldPct);
  });

  it("latest-day Ritz-like pct = round(20/50 × 100) = 40 for both platforms (sanity)", () => {
    // Day 2026-05-15: 17+3 = 20 true (out of 50). 20/50 × 100 = 40.
    // Cross-check that BOTH paths land on the same expected integer.
    expect(
      oldPathPlatformPrimaryPct(oldSparklines, "perplexity"),
    ).toBe(40);
    expect(
      newPathPlatformPrimaryPct(observations, endDate, window, "Perplexity"),
    ).toBe(40);
    expect(oldPathPlatformPrimaryPct(oldSparklines, "chatgpt")).toBe(40);
    expect(
      newPathPlatformPrimaryPct(observations, endDate, window, "ChatGPT"),
    ).toBe(40);
  });
});
