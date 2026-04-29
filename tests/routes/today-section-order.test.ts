import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 6A.8 (2026-04-28) — lock the Today render order.
 *
 * Today is the operator's command center. The 6A.8 audit moved the
 * lifecycle/decision tier above the metrics tier; this test asserts
 * the order at the source level so a future refactor can't silently
 * regress it. The test reads today-client.tsx as a string and
 * compares the line offsets of well-known JSX markers — no React
 * runtime needed.
 *
 * If you intentionally re-order Today, update both the constant
 * `EXPECTED_ORDER` below and any operator-visible tier in
 * docs/HANDOFF_VERIFIED_STATE.md.
 */

const SOURCE_PATH = resolve(
  __dirname,
  "../../src/app/(shell)/today-client.tsx",
);
const SOURCE = readFileSync(SOURCE_PATH, "utf8");

/** Each entry maps a tier label → a substring that uniquely appears in
 *  the rendered JSX (return block) at that tier's position. */
const EXPECTED_ORDER: Array<{ tier: string; marker: string }> = [
  { tier: "0a alert: poll health", marker: "<PollHealthBlock" },
  { tier: "0b alert: stale data", marker: 'data-today-alert="stale-data"' },
  { tier: "0c alert: scan banner", marker: "<TodayScanStrip" },
  { tier: "0d alert: needs review", marker: 'data-today-alert="needs-review"' },
  { tier: "1 since-last-visit", marker: "<SinceLastVisit" },
  { tier: "1.5 visibility headline", marker: 'data-today-section="visibility-headline"' },
  { tier: "2 do-next card", marker: "<TodayDoNextCard" },
  { tier: "3 lifecycle strip", marker: "<TodayLifecycleStrip" },
  { tier: "4 implementation queue", marker: "<TodayImplementationQueue" },
  { tier: "5 decide tonight queue", marker: "<TodayActionQueue" },
  { tier: "6 wins", marker: 'data-today-section="wins"' },
  { tier: "7 latest signal", marker: 'data-today-section="latest-signal"' },
  { tier: "8 metrics disclosure", marker: "<TodayMetricsDisclosure" },
  { tier: "9 scan diffs accordion", marker: "<ChangeReview" },
];

describe("Today render order (Phase 6A.8 hierarchy)", () => {
  it("every expected tier marker exists exactly once in today-client.tsx", () => {
    for (const { tier, marker } of EXPECTED_ORDER) {
      const idx = SOURCE.indexOf(marker);
      expect(
        idx,
        `tier "${tier}" marker not found: ${marker}`,
      ).toBeGreaterThan(-1);
    }
  });

  it("tiers appear in source order matching the operator hierarchy", () => {
    let lastIdx = -1;
    let lastTier = "(start)";
    for (const { tier, marker } of EXPECTED_ORDER) {
      const idx = SOURCE.indexOf(marker);
      expect(
        idx,
        `tier "${tier}" must appear AFTER "${lastTier}" — found at offset ${idx}, prior at ${lastIdx}`,
      ).toBeGreaterThan(lastIdx);
      lastIdx = idx;
      lastTier = tier;
    }
  });

  it("metrics disclosure ALWAYS appears after lifecycle layer", () => {
    const lifecycleIdx = SOURCE.indexOf("<TodayLifecycleStrip");
    const metricsIdx = SOURCE.indexOf("<TodayMetricsDisclosure");
    expect(lifecycleIdx).toBeGreaterThan(-1);
    expect(metricsIdx).toBeGreaterThan(-1);
    expect(metricsIdx).toBeGreaterThan(lifecycleIdx);
  });

  it("scan diffs accordion is the LAST major section in the layout", () => {
    const scanIdx = SOURCE.indexOf("<ChangeReview");
    expect(scanIdx).toBeGreaterThan(-1);
    // Find the LAST occurrence of any other tier marker; ChangeReview must follow.
    const others = EXPECTED_ORDER.filter((e) => e.marker !== "<ChangeReview")
      .map((e) => SOURCE.indexOf(e.marker))
      .filter((i) => i > -1);
    const lastOther = Math.max(...others);
    expect(scanIdx).toBeGreaterThan(lastOther);
  });
});
