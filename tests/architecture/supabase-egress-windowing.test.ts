/**
 * E1-E5 (operator audit, 2026-05-05) — Supabase egress windowing.
 *
 * Beacon hit Supabase Free Plan egress (5.7/5 GB, 114%) while DB is
 * only 213 MB. Root cause: `/today`, `/prompts`, `/diagnostics` all
 * called `loadFreshCanonicalData()` which paged the FULL ~14k-row
 * `prompt_answer_observations` table on every render. With ~3KB/row
 * payload that's ~42 MB per page load.
 *
 * Post-E3:
 *   • `TenantRepository.getPromptAnswerObservations(options?)` and
 *     `getDailyMetricSnapshots(options?)` accept `{ since }` window.
 *   • `loadFreshCanonicalData(options?)` accepts `observationsSince`
 *     and `snapshotsSince` and threads them down.
 *   • `/today` (`today-data.ts`) passes a 60-day observation window
 *     and 120-day snapshot window.
 *   • `/prompts` passes a 60-day observation window.
 *   • Default behavior (no options) loads full history — scripts
 *     keep working.
 *   • `/diagnostics` does NOT pull observations directly (no leak).
 *
 * These tests pin source-level contracts. The runtime data filter
 * is exercised separately in domain tests; here we guarantee the
 * call sites use the windowed API.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const TODAY_DATA = join(REPO_ROOT, "src/app/(shell)/today-data.ts");
const PROMPTS_PAGE = join(REPO_ROOT, "src/app/(shell)/prompts/page.tsx");
const DIAGNOSTICS_PAGE = join(
  REPO_ROOT,
  "src/app/(shell)/diagnostics/page.tsx",
);
const CANONICAL_STORE = join(REPO_ROOT, "src/storage/canonical-store.ts");
const SUPABASE_BACKEND = join(
  REPO_ROOT,
  "src/lib/persistence/repositories/supabase-backend.ts",
);
const TENANT_REPO = join(
  REPO_ROOT,
  "src/lib/persistence/repositories/tenant-repo.ts",
);
const REPO_TYPES = join(REPO_ROOT, "src/lib/persistence/repositories/types.ts");

describe("E2 — egress observability: always-on large-read alarm + opt-in debug trace", () => {
  it("supabase-backend.ts has a logEgress helper: always-on LARGE READ alarm, full trace behind the env var", () => {
    const src = readFileSync(SUPABASE_BACKEND, "utf-8");
    expect(src.includes("function logEgress")).toBe(true);
    // quota-waste pass #8 (commit 1468830) made the large-read alarm ALWAYS-ON
    // (it fires regardless of the flag); the env var now only opts INTO the full
    // per-read byte trace. Pin both: the flag gate (=== "1") + the always-on alarm.
    expect(src.includes('BEACON_SUPABASE_EGRESS_DEBUG === "1"')).toBe(true);
    expect(src.includes("[LARGE READ]")).toBe(true);
    expect(src.includes("[supabase-egress]")).toBe(true);
  });

  it("logEgress is called from the four shared query helpers", () => {
    const src = readFileSync(SUPABASE_BACKEND, "utf-8");
    // Each wrapper should call logEgress at least once.
    const callCount = (src.match(/logEgress\(/g) ?? []).length;
    expect(callCount).toBeGreaterThanOrEqual(4);
  });
});

describe("E3 — TenantRepository accepts a windowed-read option", () => {
  it("types.ts declares WindowedReadOptions and threads it through", () => {
    const src = readFileSync(REPO_TYPES, "utf-8");
    expect(src.includes("WindowedReadOptions")).toBe(true);
    // Emergency P0 fix (2026-05-12) — `getPromptAnswerObservations`
    // now accepts `ScopedObservationReadOptions` which is a superset
    // of `WindowedReadOptions` (adds optional `promptId`). Accept
    // either name in the type position.
    expect(
      src.match(
        /getPromptAnswerObservations\(\s*\n?\s*options\?:\s*(WindowedReadOptions|ScopedObservationReadOptions)/,
      ),
    ).not.toBeNull();
    expect(
      src.match(
        /getDailyMetricSnapshots\(\s*\n?\s*options\?:\s*WindowedReadOptions/,
      ),
    ).not.toBeNull();
  });

  it("supabase-backend uses the window option to push `since` down to Postgres", () => {
    const src = readFileSync(SUPABASE_BACKEND, "utf-8");
    // The tenant impl must thread `since` into queryAllPagedScoped.
    // Pin the shape: getPromptAnswerObservations branches on options?.since.
    expect(
      src.includes('sinceColumn: "observed_at"'),
      "supabase backend must use observed_at as the since column for prompt_answer_observations (E3)",
    ).toBe(true);
    expect(
      src.includes('sinceColumn: "date"'),
      "supabase backend must use `date` as the since column for daily_metric_snapshots (E3 — column name is `date`, not `for_date`)",
    ).toBe(true);
  });

  it("file-backend tenant-repo also honors the since option (in-memory filter)", () => {
    const src = readFileSync(TENANT_REPO, "utf-8");
    // The file backend filters in-memory after disk read; the option
    // must still be respected so the API is symmetric.
    expect(
      src.match(/getPromptAnswerObservations:\s*async\s*\(options\)/),
      "tenant-repo getPromptAnswerObservations must accept an options arg (E3)",
    ).not.toBeNull();
    expect(
      src.match(/getDailyMetricSnapshots:\s*async\s*\(options\)/),
      "tenant-repo getDailyMetricSnapshots must accept an options arg (E3)",
    ).not.toBeNull();
  });
});

describe("E3 — loadFreshCanonicalData threads observation/snapshot windows", () => {
  it("canonical-store exports FreshCanonicalDataOptions with observationsSince/snapshotsSince", () => {
    const src = readFileSync(CANONICAL_STORE, "utf-8");
    expect(src.includes("FreshCanonicalDataOptions")).toBe(true);
    expect(src.includes("observationsSince?: string")).toBe(true);
    expect(src.includes("snapshotsSince?: string")).toBe(true);
  });

  it("loadFreshCanonicalData accepts the options arg and threads to tenantRepo", () => {
    const src = readFileSync(CANONICAL_STORE, "utf-8");
    expect(
      src.match(
        /loadFreshCanonicalData\(\s*\n?\s*options\?:\s*FreshCanonicalDataOptions/,
      ),
    ).not.toBeNull();
    expect(src.includes("tenantRepo.getPromptAnswerObservations(observationsOpt)")).toBe(true);
    expect(src.includes("tenantRepo.getDailyMetricSnapshots(snapshotsOpt)")).toBe(true);
  });
});

describe("E3 — /today calls loadFreshCanonicalData with date windows", () => {
  it("today-data.ts computes a 60-day observation window", () => {
    const src = readFileSync(TODAY_DATA, "utf-8");
    expect(src.includes("60 * 86_400_000")).toBe(true);
    expect(
      src.match(/loadFreshCanonicalData\(\s*\{\s*\n?\s*observationsSince/),
    ).not.toBeNull();
  });

  it("today-data.ts computes a 120-day snapshot window", () => {
    const src = readFileSync(TODAY_DATA, "utf-8");
    expect(src.includes("120 * 86_400_000")).toBe(true);
    expect(src.includes("snapshotsSince")).toBe(true);
  });
});

describe("E3 — /prompts uses a bounded, direct tenant-repo observation read", () => {
  it("prompts/page.tsx reads observations via tenantRepo with a since window (emergency P0 2026-05-12)", () => {
    const src = readFileSync(PROMPTS_PAGE, "utf-8");
    // Now a 14-day window (post-emergency-P0 narrowing — classifier
    // lookback default is 7 days). The route no longer calls
    // `loadFreshCanonicalData`; it issues direct tenant-repo reads
    // in parallel.
    expect(src.includes("14 * 86_400_000")).toBe(true);
    expect(src.includes("observationsSince")).toBe(true);
    expect(
      src.match(/tenantRepo\.getPromptAnswerObservations\(\s*\{\s*since:/),
      "prompts/page.tsx must read observations via tenantRepo with a since window",
    ).not.toBeNull();
    const stripped = src
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(/loadFreshCanonicalData\s*\(/);
  });
});

describe("E4 — /diagnostics does NOT add a heavy observation read", () => {
  it("diagnostics page does NOT call loadFreshCanonicalData (would add 14k-row egress)", () => {
    const src = readFileSync(DIAGNOSTICS_PAGE, "utf-8");
    expect(
      src.includes("loadFreshCanonicalData"),
      "/diagnostics must NOT call loadFreshCanonicalData — would re-pull the full observation table on top of /today's load (E4)",
    ).toBe(false);
  });

  it("diagnostics page does NOT call getPromptAnswerObservations directly", () => {
    const src = readFileSync(DIAGNOSTICS_PAGE, "utf-8");
    // Comments are allowed (historical narration); strip and check.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(
      stripped.match(/\.getPromptAnswerObservations\(/),
      "/diagnostics must NOT pull prompt_answer_observations directly (E4)",
    ).toBeNull();
  });
});

describe("E3 / EGRESS-P0 — page_snapshots read is bounded by LIMIT", () => {
  it("supabase-backend caps page_snapshots at LIMIT ≤ 5000 (EGRESS-P0 dropped to 500)", () => {
    const src = readFileSync(SUPABASE_BACKEND, "utf-8");
    // EGRESS-P0 (2026-05-07) — the cap was lowered from 5000 → 500
    // after the Supabase egress incident. The page_snapshots query
    // must still have an explicit .limit(N) where N is small enough
    // to bound egress; pin both the existence of a limit and that
    // it's ≤ 5000. (Negative pin against any future regression that
    // removes the limit entirely.)
    const limitMatches = [
      ...src.matchAll(/from\("page_snapshots"\)[\s\S]*?\.limit\((\d+)\)/g),
    ];
    expect(
      limitMatches.length,
      "page_snapshots tenant query must have a .limit(N) cap — pre-E3 it was unbounded",
    ).toBeGreaterThan(0);
    for (const m of limitMatches) {
      const n = parseInt(m[1], 10);
      expect(
        n,
        `page_snapshots .limit(${n}) exceeds the EGRESS-P0 cap of 5000`,
      ).toBeLessThanOrEqual(5000);
    }
  });
});

describe("EGRESS lean projection — /today's snapshot read pulls date-only columns", () => {
  // 2026-06-14 — /today's ONLY daily_metric_snapshots consumer is the
  // Command Center Brain derivation (`deriveBrainFromTodayInputs`), which
  // reads just `date` (a 7-day count) + `.length` (a total count). The
  // windowed (120-day) read could be thousands of rows; pulling the full
  // ~497-byte JSONB-carrying rows for two counts was ~90% wasted egress.
  // The lean `columns` projection (threaded types → backend → store →
  // page) drops every row to ~50 bytes. These source-text pins stop the
  // projection from silently regressing back to `*`.
  it("WindowedReadOptions declares an optional lean `columns` projection", () => {
    const src = readFileSync(REPO_TYPES, "utf-8");
    expect(
      src.match(/columns\?:\s*string/),
      "WindowedReadOptions must expose an optional `columns` projection (lean egress)",
    ).not.toBeNull();
  });

  it("supabase-backend threads `columns` into the daily_metric_snapshots query", () => {
    const src = readFileSync(SUPABASE_BACKEND, "utf-8");
    // getDailyMetricSnapshots must forward options.columns into the
    // paged-scoped query opts (queryAllPagedScoped honors `columns`).
    expect(
      src.match(/options\?\.columns\s*\?\s*\{\s*columns:\s*options\.columns/),
      "supabase getDailyMetricSnapshots must thread options.columns into queryAllPagedScoped",
    ).not.toBeNull();
  });

  it("canonical-store exposes snapshotsColumns and threads it to the snapshot read", () => {
    const src = readFileSync(CANONICAL_STORE, "utf-8");
    expect(src.includes("snapshotsColumns?: string")).toBe(true);
    // The snapshotsOpt builder must forward snapshotsColumns as `columns`.
    expect(
      src.match(/columns:\s*options\.snapshotsColumns/),
      "loadFreshCanonicalData must thread snapshotsColumns into the daily_metric_snapshots read",
    ).not.toBeNull();
  });

  it("today-data.ts requests a date-only snapshot projection (not the full row)", () => {
    const src = readFileSync(TODAY_DATA, "utf-8");
    // The lean projection must include `date` (the only consumed column)
    // and MUST NOT pull the heavy JSONB/metric payload (i.e. not `*`).
    const m = src.match(/snapshotsColumns:\s*"([^"]+)"/);
    expect(
      m,
      "today-data.ts must pass an explicit lean snapshotsColumns projection",
    ).not.toBeNull();
    const cols = (m?.[1] ?? "").toLowerCase();
    expect(cols.includes("date"), "projection must include `date`").toBe(true);
    expect(cols.includes("*"), "projection must not be the full row").toBe(
      false,
    );
    expect(
      cols.includes("metadata"),
      "projection must not pull the heavy JSONB metadata column",
    ).toBe(false);
  });
});
