/**
 * Architecture invariants — /today headline KPI tile honors `samplingStatus`.
 *
 * Pure source-scan; no DB / render. Pins the operator's Task-1 contract
 * (Poll Integrity Hardening follow-up, 2026-05-04):
 *
 *   • A 5-prompt proof day must NOT create a misleading headline delta
 *   • Tile meta copy must say "small sample" / "proof run" when relevant
 *   • Full days drive default KPI comparisons; partial/proof days do not
 *
 * Pinned wiring:
 *   1. ScoreboardData carries `derivedKpiSamplingStatus`.
 *   2. today-data.ts computes it via `aggregateSamplingStatus(pollHealth)`.
 *   3. today-scoreboard.tsx renders a sampling tag in tile meta when
 *      status is proof/partial/empty (full gets no tag).
 *   4. The week-over-week delta pill is suppressed when `derivedKpiAsOfDate`
 *      is set — so a 5-obs proof day cannot drive headline deltas.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCOREBOARD_SRC = readFileSync(
  resolve(__dirname, "../../src/components/today/today-scoreboard.tsx"),
  "utf-8",
);
const TODAY_DATA_SRC = readFileSync(
  resolve(__dirname, "../../src/app/(shell)/today-data.ts"),
  "utf-8",
);
const POLL_HEALTH_SRC = readFileSync(
  resolve(__dirname, "../../src/domains/observations/poll-health.ts"),
  "utf-8",
);

describe("Task 1 — ScoreboardData carries the samplingStatus signal", () => {
  it("ScoreboardData type declares derivedKpiSamplingStatus: SamplingStatus | null", () => {
    expect(SCOREBOARD_SRC).toMatch(
      /derivedKpiSamplingStatus\?\s*:\s*SamplingStatus\s*\|\s*null/,
    );
  });

  it("today-scoreboard imports SamplingStatus type from poll-health", () => {
    expect(SCOREBOARD_SRC).toMatch(
      /import\s+type\s+\{\s*SamplingStatus\s*\}\s+from\s+["']@\/domains\/observations\/poll-health["']/,
    );
  });
});

describe("Task 1 — tile meta renders sampling tag when status is proof/partial/empty", () => {
  it("samplingStatusTag function maps the 4 status values to operator-readable copy", () => {
    expect(SCOREBOARD_SRC).toMatch(/function samplingStatusTag/);
    // proof → "small sample (proof run)"
    expect(SCOREBOARD_SRC).toMatch(
      /case\s*"proof":\s*\n\s*return\s*"small sample \(proof run\)"/,
    );
    // partial → "partial day (below 80-prompt floor)"
    expect(SCOREBOARD_SRC).toMatch(
      /case\s*"partial":\s*\n\s*return\s*"partial day \(below 80-prompt floor\)"/,
    );
    // empty → "no observations today"
    expect(SCOREBOARD_SRC).toMatch(
      /case\s*"empty":\s*\n\s*return\s*"no observations today"/,
    );
    // full → empty string (no tag)
    expect(SCOREBOARD_SRC).toMatch(/case\s*"full":/);
  });

  it("asOfLabel string composition appends the samplingTag onto the meta line", () => {
    // The tile reads `${asOfLabel}` in meta; asOfLabel must include
    // samplingTag when present.
    expect(SCOREBOARD_SRC).toMatch(
      /samplingTag\s*\?\s*` · \$\{samplingTag\}`/,
    );
  });
});

describe("Task 1 — week-over-week delta pill suppressed when asOfDate is set", () => {
  it("Times-AI-recommended-you tile sets delta to null when asOfDate is non-null", () => {
    // Pre-existing behavior: line uses ternary `asOfDate ? null : wowCit`.
    expect(SCOREBOARD_SRC).toMatch(/delta=\{asOfDate \? null : wowCit\}/);
  });

  it("How-often-AI-mentions-you tile also suppresses delta when asOfDate is set", () => {
    expect(SCOREBOARD_SRC).toMatch(/delta=\{asOfDate \? null : wowMen\}/);
  });
});

describe("Task 1 — today-data.ts computes derivedKpiSamplingStatus from pollHealth", () => {
  it("imports aggregateSamplingStatus from poll-health", () => {
    expect(TODAY_DATA_SRC).toMatch(/aggregateSamplingStatus/);
  });

  it("scoreboard payload sets derivedKpiSamplingStatus only when derived KPIs are in use", () => {
    // useDerivedKpis ? aggregateSamplingStatus(pollHealth) : null
    expect(TODAY_DATA_SRC).toMatch(
      /derivedKpiSamplingStatus:[\s\S]*?aggregateSamplingStatus\(pollHealth\)/,
    );
  });
});

describe("Task 1 — aggregateSamplingStatus contract (worst-case wins)", () => {
  it("exported from poll-health.ts", () => {
    expect(POLL_HEALTH_SRC).toMatch(
      /export function aggregateSamplingStatus/,
    );
  });

  it("uses an explicit empty > proof > partial > full ordering (worst-case wins)", () => {
    // The ordering array is operator-locked.
    expect(POLL_HEALTH_SRC).toMatch(
      /const order:\s*SamplingStatus\[\]\s*=\s*\[\s*"empty"\s*,\s*"proof"\s*,\s*"partial"\s*,\s*"full"\s*\]/,
    );
  });
});

describe("Task 1 — operator-mandated test invariants", () => {
  it("5-prompt proof day → samplingStatus 'proof' → tile copy includes 'small sample'", () => {
    // The mapping is in samplingStatusTag.
    expect(SCOREBOARD_SRC).toMatch(/"small sample \(proof run\)"/);
  });

  it("partial-day (10–79 obs) → samplingStatus 'partial' → tile copy includes 'partial day'", () => {
    expect(SCOREBOARD_SRC).toMatch(/"partial day \(below 80-prompt floor\)"/);
  });

  it("full day (≥80 obs) → samplingStatus 'full' → no sampling tag rendered (legacy meta only)", () => {
    // The "full" branch returns the empty string. No tag → no extra copy.
    expect(SCOREBOARD_SRC).toMatch(
      /case\s*"full":[\s\S]*?case\s*null:[\s\S]*?case\s*undefined:[\s\S]*?return\s*""/,
    );
  });

  it("the proof-run delta-suppression chain is intact: asOfDate set → delta null → no misleading WoW pill", () => {
    // Existing behavior: when useDerivedKpis is true (today's tile),
    // the WoW pill is null. Operator's contract: a 5-obs proof day
    // cannot drive a misleading headline delta because the delta is
    // suppressed entirely when asOfDate is set. The samplingTag in
    // meta makes the small-sample status visible to the user.
    expect(SCOREBOARD_SRC).toMatch(/asOfDate \? null : wowCit/);
    expect(SCOREBOARD_SRC).toMatch(/asOfDate \? null : wowMen/);
  });
});
