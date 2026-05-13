/**
 * Perf+egress bundle (2026-05-12) — source-level guardrails.
 *
 * Pins five fixes that drop steady-state Supabase egress + cold-
 * lambda wire payload across v2 customer routes:
 *
 *   1. Canonical-store seed (`loadFromDiskAndMerge`) windows both
 *      `prompt_answer_observations` (60d) and
 *      `daily_metric_snapshots` (120d) by default — pre-window the
 *      seed pulled the full ~12k obs + ~24k snapshots on every cold
 *      lambda.
 *   2. `getOwnedPages` wrapped in `React.cache` — pre-cache /today
 *      called it twice per render (top-level + top-pick branch).
 *   3. `getTenantScanFindingsCached` exists as the cached entry
 *      point for `scan_findings` reads, and today-data routes its
 *      single hot consumer through it.
 *   4. /prompts passes `snapshotsSince` so it never pulls the full
 *      `daily_metric_snapshots` table (~24k rows, unused on that
 *      route).
 *   5. /changes passes `sinceDate` to `buildUrlCitationHistory` so
 *      the per-render history walk operates on a bounded window.
 *
 * Source-level checks — they survive JSX refactors and don't need
 * to run with Supabase credentials.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

describe("Canonical-store seed: windowed DB merge", () => {
  const src = read("src/storage/canonical-store.ts");

  it("exports CANONICAL_SEED_WINDOWS with 60d obs / 120d snaps defaults", () => {
    // The defaults are stored as named constants then referenced
    // from the exported `CANONICAL_SEED_WINDOWS` table; pin both.
    expect(src).toMatch(/SEED_OBSERVATIONS_WINDOW_DAYS\s*=\s*60\b/);
    expect(src).toMatch(/SEED_SNAPSHOTS_WINDOW_DAYS\s*=\s*120\b/);
    expect(src).toMatch(
      /export\s+const\s+CANONICAL_SEED_WINDOWS\s*=\s*\{[\s\S]*?observationsDays:\s*SEED_OBSERVATIONS_WINDOW_DAYS[\s\S]*?snapshotsDays:\s*SEED_SNAPSHOTS_WINDOW_DAYS/,
    );
  });

  it("seed passes { since: ... } to getPromptAnswerObservations", () => {
    expect(src).toMatch(
      /tenantRepo\.getPromptAnswerObservations\(\s*\{\s*since:\s*observationsSince\s*\}\s*\)/,
    );
  });

  it("seed passes { since: ... } to getDailyMetricSnapshots", () => {
    expect(src).toMatch(
      /tenantRepo\.getDailyMetricSnapshots\(\s*\{\s*since:\s*snapshotsSince\s*\}\s*\)/,
    );
  });

  it("seed no longer calls getPromptAnswerObservations() with no args", () => {
    // Pre-bundle the seed read was unbounded; regression would be a
    // bare call without options. Strip comments first so the doc
    // block in this same file doesn't trip the negative pin.
    const stripped = src
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(/tenantRepo\.getPromptAnswerObservations\(\)/);
    expect(stripped).not.toMatch(/tenantRepo\.getDailyMetricSnapshots\(\)/);
  });
});

describe("Per-request cache: getOwnedPages", () => {
  const src = read("src/domains/pages/page-store.ts");

  it("imports React's `cache` API", () => {
    expect(src).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*["']react["']/);
  });

  it("getOwnedPages export is wrapped in cache(...)", () => {
    expect(src).toMatch(
      /export\s+const\s+getOwnedPages\s*=\s*cache\(\s*async\s*\(\s*\)\s*:\s*Promise<PageEntity\[\]>\s*=>/,
    );
  });

  it("no longer declares the plain async function form (regression guard)", () => {
    const stripped = src
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(
      /export\s+async\s+function\s+getOwnedPages\b/,
    );
  });
});

describe("Per-request cache: scan_findings reader", () => {
  const helper = read("src/domains/scanning/scan-findings-cached.ts");
  const todayData = read("src/app/(shell)/today-data.ts");

  it("getTenantScanFindingsCached is wrapped in React.cache", () => {
    expect(helper).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*["']react["']/);
    expect(helper).toMatch(
      /export\s+const\s+getTenantScanFindingsCached\s*=\s*cache\(/,
    );
  });

  it("cached helper resolves tenantId INSIDE the cached body (tenant-safe)", () => {
    // `React.cache` is per-request. The cached function must read
    // `currentTenantId()` inside its body so each request sees
    // its own tenant rather than baking the first request's value
    // into the module.
    expect(helper).toMatch(
      /cache\(\s*async[\s\S]*?currentTenantId\(\)[\s\S]*?\)\s*;/,
    );
    // No module-level top-level await of currentTenantId — that
    // would freeze the first-import tenant into a global.
    const stripped = helper
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(
      /^const\s+\w+\s*=\s*await\s+currentTenantId/m,
    );
  });

  it("today-data routes its scan_findings read through the cached helper", () => {
    expect(todayData).toContain("getTenantScanFindingsCached");
    // Negative pin: the old unwrapped call shape is gone.
    const stripped = todayData
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(/\brepo\.getScanFindings\(\)/);
  });
});

describe("/prompts: observation window narrowed + parallel reads (emergency P0 2026-05-12)", () => {
  const src = read("src/app/(shell)/prompts/page.tsx");

  it("computes an observationsSince ISO string (14-day window for the classifier)", () => {
    expect(src).toMatch(
      /const\s+observationsSince\s*=\s*new Date\(\s*Date\.now\(\)\s*-\s*14\s*\*\s*86_400_000\s*\)\s*\.toISOString\(\)/,
    );
  });

  it("uses direct tenant-repo parallel reads instead of loadFreshCanonicalData", () => {
    const stripped = src
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).toMatch(/getRepository\(\)\.forTenant\(\s*tenantId\s*\)/);
    expect(stripped).toMatch(/tenantRepo\.getTrackedPrompts\(\)/);
    expect(stripped).toMatch(
      /tenantRepo\.getPromptAnswerObservations\(\s*\{\s*since:\s*observationsSince\s*\}\s*\)/,
    );
    expect(stripped).toMatch(/tenantRepo\.getTrackedEntities\(\)/);
    expect(stripped).not.toMatch(/loadFreshCanonicalData\s*\(/);
    // `daily_metric_snapshots` is no longer read on this route.
    expect(stripped).not.toMatch(/snapshotsSince/);
  });
});

describe("/changes: buildUrlCitationHistory sinceDate window passed", () => {
  const src = read("src/app/(shell)/changes/page.tsx");

  it("computes a YYYY-MM-DD sinceDate (Date.now() - WINDOW * 86_400_000)", () => {
    // Two facts pinned separately so the regex doesn't have to span
    // the source's multi-line `new Date(\n  Date.now() - … ,\n)`.
    expect(src).toMatch(/const\s+urlHistorySinceDate\s*=\s*new Date\(/);
    expect(src).toMatch(
      /Date\.now\(\)\s*-\s*URL_HISTORY_WINDOW_DAYS\s*\*\s*86_400_000/,
    );
    expect(src).toMatch(/\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/);
  });

  it("passes sinceDate (not just ownedOnly) to buildUrlCitationHistory", () => {
    expect(src).toMatch(
      /buildUrlCitationHistory\(\s*\{\s*ownedOnly:\s*true,\s*sinceDate:\s*urlHistorySinceDate\s*,?\s*\}\s*\)/,
    );
  });

  it("URL_HISTORY_WINDOW_DAYS default is 60 (matches attribution baseline+post window with buffer)", () => {
    expect(src).toMatch(/const\s+URL_HISTORY_WINDOW_DAYS\s*=\s*60/);
  });
});
