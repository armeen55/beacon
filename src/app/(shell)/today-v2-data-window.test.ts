/**
 * Phase 1 loader-window contract tests (2026-05-12).
 *
 * Static-analysis pins for two Phase 1 changes:
 *
 *   1. The descriptors loader uses a 14-day observation window (not 60d).
 *      Implemented by switching from `loadCachedFreshCanonical` (60d) to
 *      a separate `loadCachedFreshCanonical14d` cache (14d).
 *
 *   2. The gate loader stops pulling the full 60-day canonical bundle just
 *      to read `observations.length`. It now reads a tenant-scoped 7-day
 *      observation slice + tracked_prompts directly from the repo.
 *
 * These pieces matter because: a) they reduce wire payload on the cold
 * `/today` load, and b) they decouple the descriptors + gate sections
 * from the visibility loader's 60d pull. When Phase 2 lands the
 * snapshot-backed visibility read model, the 60d pull goes away and
 * these narrow paths become the only ones left.
 *
 * Tests are intentionally string-grep against the source — full
 * integration tests require mocking the repo layer, server-only seeds,
 * and business config, all for low marginal signal. Phase 2 will replace
 * these with integration tests against the snapshot read model.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(
  __dirname,
  "today-v2-data.ts",
);
const SOURCE = readFileSync(SOURCE_PATH, "utf8");

describe("Phase 1 loader window contracts", () => {
  it("exports `loadCachedFreshCanonical14d` — the narrow 14d cache used by descriptors", () => {
    expect(SOURCE).toMatch(/export const loadCachedFreshCanonical14d\s*=\s*cache\(/);
  });

  it("14d cache uses a 14-day observation window (not 60d)", () => {
    // Split on the export statement so we land in the function body, not
    // the docstring that precedes it (the name appears in both).
    const afterExport = SOURCE.split(
      "export const loadCachedFreshCanonical14d",
    )[1] ?? "";
    // The cache body ends at the first `});` after the export.
    const body = afterExport.split("});")[0] ?? "";
    expect(body).toMatch(/14\s*\*\s*86_400_000/);
    // And NOT 60 inside that same cache body (would indicate the wrong
    // window was used).
    expect(body).not.toMatch(/60\s*\*\s*86_400_000/);
  });

  it("`loadTodayV2DescriptorsData` calls `loadCachedFreshCanonical14d` (the narrow variant)", () => {
    const fn = SOURCE.split("export async function loadTodayV2DescriptorsData")[1] ?? "";
    expect(fn).toMatch(/loadCachedFreshCanonical14d\(/);
  });

  it("`loadTodayV2DescriptorsData` does NOT call the full 60d `loadCachedFreshCanonical` directly", () => {
    const fn = SOURCE.split("export async function loadTodayV2DescriptorsData")[1] ?? "";
    const end = fn.split("export async function")[0] ?? fn;
    // Match the bare 60d cache name only (not the 14d one).
    const matches = end.match(/loadCachedFreshCanonical(?!14d)\s*\(/g);
    expect(matches).toBeNull();
  });

  it("`loadTodayV2GateData` does NOT call `loadCachedFreshCanonical` (no 60d obs pull on the gate path)", () => {
    const fn = SOURCE.split("export async function loadTodayV2GateData")[1] ?? "";
    // Both the 60d and 14d caches must be absent on the gate path.
    expect(fn).not.toMatch(/loadCachedFreshCanonical(?:14d)?\s*\(/);
  });

  it("`loadTodayV2GateData` uses a narrow 7-day observation window via the repo", () => {
    const fn = SOURCE.split("export async function loadTodayV2GateData")[1] ?? "";
    expect(fn).toMatch(/getPromptAnswerObservations/);
    expect(fn).toMatch(/7\s*\*\s*86_400_000/);
  });

  it("`loadTodayV2VisibilityData` still depends on the 60d canonical (Phase 1 deliberately unchanged)", () => {
    // Phase 1 does NOT swap the visibility loader. Snapshots cannot
    // reproduce position-weighted leaderboard citation_rate, the per-
    // platform cited-or-mentioned formula, or competitor citation_rate
    // (which the chart treats as mention_count for competitors) without
    // Phase 2 read-model schema extensions. This test pins that the
    // visibility loader stays on the 60d obs path until those land —
    // protecting against an accidental partial swap that would
    // silently change customer-visible numbers.
    const fn = SOURCE.split("export async function loadTodayV2VisibilityData")[1] ?? "";
    expect(fn).toMatch(/loadCachedFreshCanonical\(/);
  });
});

describe("Do Today fallback is wired into the action-cards loader", () => {
  it("imports `loadPersistedRecommendationQueueForPage` from the recommendations domain", () => {
    expect(SOURCE).toMatch(
      /from "@\/domains\/recommendations\/load-queue"/,
    );
    expect(SOURCE).toMatch(/loadPersistedRecommendationQueueForPage/);
  });

  it("calls the persisted queue loader inside `loadTodayV2ActionCardsData`", () => {
    const fn = SOURCE.split("export async function loadTodayV2ActionCardsData")[1] ?? "";
    expect(fn).toMatch(/loadPersistedRecommendationQueueForPage\(/);
  });

  it("falls back to persisted recommendations ONLY when there is no hurting verdict", () => {
    const fn = SOURCE.split("export async function loadTodayV2ActionCardsData")[1] ?? "";
    // The fallback must be inside `if (!primaryAction) { ... }` so a
    // hurting verdict always wins.
    expect(fn).toMatch(/if\s*\(\s*!\s*primaryAction\s*\)/);
  });

  it("filters out dismissed persisted recommendations from the fallback", () => {
    const fn = SOURCE.split("export async function loadTodayV2ActionCardsData")[1] ?? "";
    expect(fn).toMatch(/dismissed/);
  });

  it("does NOT call `generateRecommendations` (live generation forbidden in Phase 1)", () => {
    expect(SOURCE).not.toMatch(/\bgenerateRecommendations\b/);
  });
});
