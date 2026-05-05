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

describe("E2 — egress observability behind BEACON_SUPABASE_EGRESS_DEBUG flag", () => {
  it("supabase-backend.ts contains a logEgress helper gated by the env var", () => {
    const src = readFileSync(SUPABASE_BACKEND, "utf-8");
    expect(src.includes("function logEgress")).toBe(true);
    expect(src.includes('BEACON_SUPABASE_EGRESS_DEBUG !== "1"')).toBe(true);
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
    expect(
      src.match(
        /getPromptAnswerObservations\(\s*\n?\s*options\?:\s*WindowedReadOptions/,
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

describe("E3 — /prompts calls loadFreshCanonicalData with a date window", () => {
  it("prompts/page.tsx passes observationsSince to loadFreshCanonicalData", () => {
    const src = readFileSync(PROMPTS_PAGE, "utf-8");
    expect(src.includes("60 * 86_400_000")).toBe(true);
    expect(src.includes("observationsSince")).toBe(true);
    // The default un-windowed call should be gone.
    expect(
      src.match(/await loadFreshCanonicalData\(\)/),
      "prompts/page.tsx must call loadFreshCanonicalData with a window option (E3)",
    ).toBeNull();
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

describe("E3 — page_snapshots read is bounded by LIMIT", () => {
  it("supabase-backend caps page_snapshots at .limit(5000)", () => {
    const src = readFileSync(SUPABASE_BACKEND, "utf-8");
    // The getPageSnapshots tenant impl must include a .limit(5000)
    // call after .order(...).
    const match = src.match(
      /from\("page_snapshots"\)[\s\S]*?\.limit\(5000\)/,
    );
    expect(
      match,
      "page_snapshots tenant query must be capped at .limit(5000) — pre-E3 it was unbounded (E3)",
    ).not.toBeNull();
  });
});
