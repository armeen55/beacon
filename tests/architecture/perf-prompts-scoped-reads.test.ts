/**
 * Emergency P0 fix (2026-05-12) — source-level pins for the
 * /prompts + /prompts/[id] scoped repo reads.
 *
 * Production trace measured:
 *   • `/prompts/[id]` total = 11–12.5 s, with `loadFreshCanonicalData`
 *     alone at ~11 s pulling ALL 15,125 observations only to filter
 *     to ONE prompt.
 *   • `/prompts` total = 8.8 s, with `loadFreshCanonicalData` at
 *     ~8.6 s on a 60-day window (the classifier only uses a 7-day
 *     lookback).
 *
 * Fix:
 *   • `/prompts/[id]`: replaced `loadFreshCanonicalData` with three
 *     direct tenant-repo reads. The observations read pushes
 *     `prompt_id = $1` down to Postgres so the row count drops from
 *     ~15k to <500.
 *   • `/prompts`: replaced `loadFreshCanonicalData` with three direct
 *     parallel reads on a narrowed 14-day window (2× the 7-day
 *     classifier lookback). Drops the unused `daily_metric_snapshots`
 *     read entirely.
 *
 * These pins prevent regression to `loadFreshCanonicalData`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Emergency P0: /prompts/[id] prompt-scoped reads", () => {
  const src = read("src/app/(shell)/prompts/[id]/page.tsx");
  const stripped = stripComments(src);

  it("does NOT call loadFreshCanonicalData or ensureCanonicalStoresSeeded", () => {
    expect(stripped).not.toMatch(/loadFreshCanonicalData\s*\(/);
    expect(stripped).not.toMatch(/ensureCanonicalStoresSeeded\s*\(/);
  });

  it("uses tenant-repo direct reads", () => {
    expect(stripped).toMatch(/getRepository\(\)\.forTenant\(\s*tenantId\s*\)/);
    expect(stripped).toMatch(/tenantRepo\.getTrackedPrompts\(\s*\)/);
    expect(stripped).toMatch(/tenantRepo\.getTrackedEntities\(\s*\)/);
    expect(stripped).toMatch(
      /tenantRepo\.getPromptAnswerObservations\(\s*\{[\s\S]*?promptId\s*[:,]/,
    );
  });

  it("pushes the prompt_id filter to the database via the repo option", () => {
    expect(stripped).toMatch(
      /tenantRepo\.getPromptAnswerObservations\(\s*\{[\s\S]*?promptId\s*,/,
    );
  });

  it("runs the three reads in parallel via Promise.all", () => {
    expect(stripped).toMatch(/Promise\.all\(\s*\[/);
  });
});

describe("Emergency P0: /prompts list page narrowed window + parallel reads", () => {
  const src = read("src/app/(shell)/prompts/page.tsx");
  const stripped = stripComments(src);

  it("does NOT call loadFreshCanonicalData or ensureCanonicalStoresSeeded", () => {
    expect(stripped).not.toMatch(/loadFreshCanonicalData\s*\(/);
    expect(stripped).not.toMatch(/ensureCanonicalStoresSeeded\s*\(/);
  });

  it("uses tenant-repo direct reads (3 of them, no daily_metric_snapshots)", () => {
    expect(stripped).toMatch(/getRepository\(\)\.forTenant\(\s*tenantId\s*\)/);
    expect(stripped).toMatch(/tenantRepo\.getTrackedPrompts\(\s*\)/);
    expect(stripped).toMatch(/tenantRepo\.getTrackedEntities\(\s*\)/);
    expect(stripped).toMatch(
      /tenantRepo\.getPromptAnswerObservations\(\s*\{\s*since/,
    );
    // Negative pin: daily_metric_snapshots NOT read on this route.
    expect(stripped).not.toMatch(/getDailyMetricSnapshots/);
  });

  it("uses a 14-day observation window (was 60 days; classifier lookback is 7 days)", () => {
    expect(stripped).toMatch(/14\s*\*\s*86_400_000/);
  });

  it("runs the three reads in parallel via Promise.all", () => {
    expect(stripped).toMatch(/Promise\.all\(\s*\[/);
  });
});

describe("Repo interface: getPromptAnswerObservations accepts promptId option", () => {
  it("base SeedDataRepository signature includes optional promptId", () => {
    const src = read("src/lib/persistence/repositories/types.ts");
    // Multi-line signature: `getPromptAnswerObservations(\n  options?: { promptId?: string },\n): Promise<...>`
    expect(src).toMatch(
      /getPromptAnswerObservations\(\s*options\?:\s*\{[\s\S]*?promptId\?:\s*string[\s\S]*?\}[\s\S]*?\)\s*:\s*Promise<PromptAnswerObservation\[\]>/,
    );
  });

  it("tenant-repo wrapper passes promptId through to the base read", () => {
    const src = read("src/lib/persistence/repositories/tenant-repo.ts");
    expect(src).toMatch(
      /base\.getPromptAnswerObservations\(\s*options\?\.promptId\s*\?\s*\{\s*promptId:\s*options\.promptId\s*\}/,
    );
  });

  it("Supabase backend forwards eqColumn=prompt_id when promptId is set", () => {
    const src = read("src/lib/persistence/repositories/supabase-backend.ts");
    expect(src).toMatch(
      /options\?\.promptId\s*\?\s*\{\s*eqColumn:\s*["']prompt_id["']\s*,\s*eqValue:\s*options\.promptId\s*\}/,
    );
  });

  it("queryAllPagedScoped passes eqColumn/eqValue to Supabase .eq()", () => {
    const src = read("src/lib/persistence/repositories/supabase-backend.ts");
    expect(src).toMatch(
      /query\s*=\s*query\.eq\(\s*options\.eqColumn\s*,\s*options\.eqValue\s*\)/,
    );
  });
});
