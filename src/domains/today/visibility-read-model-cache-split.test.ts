/**
 * P1 audit follow-up (2026-05-13) — pin the cache split + earliest-
 * date-floor contracts inside the visibility read-model loader.
 *
 * The audit found two slow-burn issues:
 *
 *   1. Freshness was bundled inside the `unstable_cache`-wrapped
 *      inner. A poll starting after a cache warm-up couldn't surface
 *      "Refreshing…" until the 300s TTL expired (or the poll
 *      completed and invalidated the tag).
 *
 *   2. `SNAPSHOT_WINDOW_DAYS = 365` silently capped "All time" at
 *      one calendar year. After ~12 months of data accumulation the
 *      toggle would truncate without warning.
 *
 * This refactor:
 *   • Extracted `loadVisibilityReadModelCoreInner` — the heavy
 *     snapshot + leaderboard + chart-series + chartEvents path —
 *     and wrapped ONLY that in `unstable_cache` (tag + 30-min idle TTL).
 *   • Pulled `fetchFreshnessSignal` OUT of the cached path; it runs
 *     uncached every request via `Promise.all([cachedCore(), freshness])`.
 *   • Replaced the 365-day cap with `fetchEarliestActivePlatformDate`
 *     — a `SELECT date … LIMIT 1` against the active-platform set.
 *     A 5-year backstop remains for empty-tenant / query-failure
 *     scenarios.
 *
 * Static-analysis pins on the loader source are appropriate here:
 * the surface is a server-only module; full integration tests
 * would require deep Supabase + repo mocking with low signal value.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "visibility-read-model.ts"),
  "utf8",
);

describe("read-model cache split — freshness is NOT inside the cached entry", () => {
  it("loadVisibilityReadModelCoreInner is the cached function — and it does NOT call fetchFreshnessSignal", () => {
    // The cached inner returns the CORE payload (snapshots, leaderboard,
    // chart series). If freshness ever gets re-bundled in there, the
    // "Refreshing…" lag will reappear silently.
    const coreBlock =
      SRC.split("async function loadVisibilityReadModelCoreInner")[1] ?? "";
    expect(coreBlock.length).toBeGreaterThan(0);
    // The boundary of the inner is the next top-level `async function`
    // or `const`/`export`. Scope to that.
    const coreEndsAt = coreBlock.search(/\n(async function|const|export)\b/);
    const coreBody =
      coreEndsAt > 0 ? coreBlock.slice(0, coreEndsAt) : coreBlock;
    expect(coreBody).not.toMatch(/fetchFreshnessSignal\(/);
    expect(coreBody).not.toMatch(/computeFreshness\(/);
  });

  it("the public loader calls cachedCore() and fetchFreshnessSignal() in parallel via Promise.all", () => {
    const pub = SRC.split("export const loadVisibilityReadModelFromSnapshots")[1] ?? "";
    // Promise.all is the structural shape we expect; either order is
    // acceptable.
    expect(pub).toMatch(/Promise\.all\(\s*\[/);
    expect(pub).toMatch(/cachedCore\(\)/);
    expect(pub).toMatch(/fetchFreshnessSignal\(\s*tenantId\s*\)/);
  });

  it("computeFreshness runs in the public loader (uncached path), not inside the cached core", () => {
    const pub = SRC.split("export const loadVisibilityReadModelFromSnapshots")[1] ?? "";
    expect(pub).toMatch(/computeFreshness\(/);
  });

  it("cached core's tag is still tenant-scoped (today-readmodel:<tenantId>)", () => {
    const pub = SRC.split("export const loadVisibilityReadModelFromSnapshots")[1] ?? "";
    expect(pub).toMatch(/buildTodayReadModelCacheTag\(tenantId\)/);
  });

  it("cached core's TTL is the 30-minute idle safety-net value (quota-waste pass #2)", () => {
    // Raised 300s → 1800s (30 min) in the quota-waste pass to cut idle Supabase
    // re-reads; the cache is still tag-invalidated on a poll, so freshness is
    // immediate — the TTL is only the idle backstop.
    expect(SRC).toMatch(/TODAY_READMODEL_CACHE_TTL_SECONDS\s*=\s*1800\b/);
  });

  it("cache key still includes both tenantId and endDate (no shared slot across distinct tenants/dates)", () => {
    expect(SRC).toMatch(
      /\[\s*["']today-readmodel:[^"']*["']\s*,\s*tenantId\s*,\s*endDate\s*\]/,
    );
  });
});

describe("All-time floor — earliest active-provider snapshot, not 365d cap", () => {
  it("fetchEarliestActivePlatformDate query selects min(date) over active-provider rows only", () => {
    const block = SRC.split("async function fetchEarliestActivePlatformDate")[1] ?? "";
    expect(block.length).toBeGreaterThan(0);
    // Tenant-scoped:
    expect(block).toMatch(/\.eq\(\s*["']tenant_id["']/);
    // source_type = 'derived' (not 'benchmark'):
    expect(block).toMatch(/\.eq\(\s*["']source_type["']\s*,\s*["']derived["']/);
    // Active providers only (any casing) — never returns a GAIO date:
    expect(block).toMatch(/\.in\(\s*["']platform["']/);
    expect(block).toMatch(/ChatGPT/);
    expect(block).toMatch(/Perplexity/);
    expect(block).toMatch(/chatgpt/);
    expect(block).toMatch(/perplexity/);
    // Ascending order + LIMIT 1 = earliest row:
    expect(block).toMatch(/\.order\(\s*["']date["']\s*,\s*\{\s*ascending:\s*true/);
    expect(block).toMatch(/\.limit\(\s*1\s*\)/);
    // Returns null on failure / empty (caller relies on this):
    expect(block).toMatch(/return null/);
  });

  it("loader uses earliestActive ?? backstop as the since floor", () => {
    const coreBlock =
      SRC.split("async function loadVisibilityReadModelCoreInner")[1] ?? "";
    expect(coreBlock).toMatch(/fetchEarliestActivePlatformDate\(tenantId\)/);
    expect(coreBlock).toMatch(
      /earliestActive\s*\?\?\s*subtractDays\(\s*endDate\s*,\s*SNAPSHOT_READ_FLOOR_BACKSTOP_DAYS\s*-\s*1\s*\)/,
    );
  });

  it("backstop is at least 1825 days (5 years), covers any realistic single-tenant lifetime", () => {
    const m = SRC.match(/SNAPSHOT_READ_FLOOR_BACKSTOP_DAYS\s*=\s*(\d+)/);
    expect(m).toBeTruthy();
    const days = Number(m![1]);
    expect(days).toBeGreaterThanOrEqual(1825);
  });

  it("old SNAPSHOT_WINDOW_DAYS constant is fully gone (regression guard)", () => {
    expect(SRC).not.toMatch(/^const SNAPSHOT_WINDOW_DAYS\s*=/m);
    // The only remaining textual reference should be the explanatory
    // comment in the new backstop constant's doc — that's fine.
  });
});

describe("GAIO exclusion preserved on the earliest-date path", () => {
  it("earliest-date query never includes Google AI Overviews", () => {
    const block =
      SRC.split("async function fetchEarliestActivePlatformDate")[1] ?? "";
    // The .in() list literally enumerates only ChatGPT + Perplexity
    // (both casings). A future maintainer adding "Google AI Overviews"
    // here would re-introduce historical data into All time.
    const inMatch = block.match(/\.in\(\s*["']platform["']\s*,\s*\[([^\]]+)\]/);
    expect(inMatch).toBeTruthy();
    const platformList = inMatch![1];
    expect(platformList.toLowerCase()).not.toContain("google");
    expect(platformList.toLowerCase()).not.toContain("aio");
  });
});
