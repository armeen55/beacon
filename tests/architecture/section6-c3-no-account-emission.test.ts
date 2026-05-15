/**
 * Architecture invariant — Section 6 C3 / C1.1 contract (2026-05-15).
 *
 * The Section 6 C3 backfill script
 * (`scripts/backfill-section6-primary-recommendation.ts`) MUST NOT
 * emit, insert, update, or upsert any `daily_metric_snapshots` row
 * with `scope_type = "account"`.
 *
 * The C1.1-applied column comment on
 * `daily_metric_snapshots.primary_recommendation_count` documents the
 * production contract: account-scope is NOT MATERIALIZED in C2/C3;
 * account-level primary share is derived at read time from platform
 * rows. C3 is the only operator-triggered script in Section 6's scope
 * that could potentially write account rows; this invariant pins the
 * source contract so a future drive-by edit can't silently regress.
 *
 * Companion invariant `tests/architecture/snapshot-builder-topic-null-primary-rec.test.ts`
 * pins the C2 builders' topic-NULL contract. Together they lock the
 * full Section 6 emission set.
 *
 * Coverage:
 *   1. Source contains the explicit C3AccountEmissionError class —
 *      the runtime kill-switch that aborts the backfill if the
 *      builder ever regresses to emit an account row.
 *   2. planTuple invokes that kill-switch when scope_type === "account"
 *      (source-text pin on the guard literal).
 *   3. Source contains NO literal `scope_type: "account"` outside the
 *      kill-switch's error-message context (i.e., no row construction
 *      ever sets the field to "account").
 *   4. Source does NOT call `.upsert({...account_row...})` or
 *      `.insert({...account_row...})` directly (writes go exclusively
 *      through `applyExistingUpdate` for entity/topic/platform rows
 *      and `applyPromptUpserts` for prompt rows — both type-narrowed
 *      to forbid account scope).
 *
 * Retirement: refines only if a future phase introduces a dedicated
 * cross-platform account aggregator that legitimately writes account
 * rows from a separate code path. That phase would need a new module
 * + a separate, narrower invariant; this one stays in force for the
 * backfill script forever.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SCRIPT_PATH = resolve(
  REPO_ROOT,
  "scripts/backfill-section6-primary-recommendation.ts",
);
const SCRIPT_SRC = readFileSync(SCRIPT_PATH, "utf-8");

// Strip block + line comments. Architecture invariants assert on the
// EXECUTABLE source, not on the prose that documents the constraint.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ACTIVE_SRC = stripComments(SCRIPT_SRC);

describe("Architecture — Section 6 C3 backfill: no account-scope emission (C1.1 contract)", () => {
  it("source exports the C3AccountEmissionError kill-switch class", () => {
    expect(ACTIVE_SRC).toMatch(/class\s+C3AccountEmissionError\s+extends\s+Error/);
  });

  it("planTuple body invokes C3AccountEmissionError when scope_type === 'account'", () => {
    // Pattern: inside planTuple, the guard checks scope_type and
    // throws the class.
    expect(ACTIVE_SRC).toMatch(/row\.scope_type\s*===\s*"account"/);
    expect(ACTIVE_SRC).toMatch(/throw\s+new\s+C3AccountEmissionError/);
  });

  it("no row literal sets scope_type: \"account\"", () => {
    // The only legitimate string literal "account" in the active
    // source is the guard comparison + the error class name.
    // Permit those; forbid any object-property assignment of the form
    // `scope_type: "account"` (row construction) or `scope_type: 'account'`.
    expect(ACTIVE_SRC).not.toMatch(/scope_type\s*:\s*["']account["']/);
  });

  it("source does not directly call .upsert or .insert against daily_metric_snapshots", () => {
    // All snapshot writes route through the C3Deps interface
    // (applyExistingUpdate / applyPromptUpserts) which is itself
    // type-narrowed to forbid account scope. A direct `.upsert(...)`
    // or `.insert(...)` call inside the script body would bypass that
    // gate. The DEFAULT supabase deps implementation has one .upsert
    // call inside `applyPromptUpserts` — that's allowed because the
    // input type `PromptRowUpsert` is narrowed to scope_type='prompt'.
    //
    // Therefore: count .upsert calls; assert each one is in a context
    // that types its rows as prompt-scope. Operationally: there must
    // be EXACTLY ONE .upsert call site in this file, and it must be
    // immediately preceded by the `applyPromptUpserts` function body.
    const upsertHits = [...ACTIVE_SRC.matchAll(/\.upsert\s*\(/g)];
    expect(upsertHits.length, ".upsert calls").toBe(1);

    // Pin its location: inside applyPromptUpserts.
    const promptUpsertFnIdx = ACTIVE_SRC.indexOf("async applyPromptUpserts");
    expect(promptUpsertFnIdx).toBeGreaterThan(0);
    const upsertCallIdx = upsertHits[0]!.index!;
    expect(upsertCallIdx).toBeGreaterThan(promptUpsertFnIdx);

    // No .insert call sites at all (UPSERT covers the INSERT case
    // for new prompt rows; standalone .insert is forbidden).
    const insertHits = [...ACTIVE_SRC.matchAll(/\.insert\s*\(/g)];
    expect(insertHits.length, ".insert calls").toBe(0);
  });

  it("ExistingRowUpdate.scope_type type-narrows to (entity | topic | platform), excluding account", () => {
    // Pin the type literal so a future widening would have to land
    // a change here too — making this invariant catch the regression.
    expect(ACTIVE_SRC).toMatch(
      /scope_type\s*:\s*"entity"\s*\|\s*"topic"\s*\|\s*"platform"/,
    );
  });
});
