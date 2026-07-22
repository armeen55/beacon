/**
 * Gate-loader contracts (ported 2026-07-21, Lane S, from the deleted
 * today-v2-data-window.test.ts when the dead section loaders were removed
 * and `loadTodayV2GateData` moved to its own module).
 *
 * The gate blocks Today's first useful paint, so these pins keep it on the
 * narrow, index-fast path:
 *
 *   1. No canonical-store pull on the gate path (the old 60d bundle read
 *      caused a statement-timeout that hung the whole page).
 *   2. A 7-day tenant-scoped observation window with a lean `observed_at`
 *      projection.
 *   3. The three independent gate reads start together (no serialization).
 *
 * String-grep against the source is intentional; full integration tests
 * would require mocking the repo layer, server-only seeds, and tenant
 * context for low marginal signal.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(resolve(__dirname, "today-gate-data.ts"), "utf8");

describe("Today gate loader contracts", () => {
  it("`loadTodayV2GateData` does NOT pull the canonical bundle (no loadFreshCanonicalData / loadCachedFreshCanonical on the gate path)", () => {
    // Call-site / import matches only; the doc comment inside the gate
    // legitimately narrates the history of the removed 60d pull.
    expect(SOURCE).not.toMatch(/loadFreshCanonicalData\s*\(/);
    expect(SOURCE).not.toMatch(/loadCachedFreshCanonical(?:14d)?\s*\(/);
    expect(SOURCE).not.toMatch(/@\/storage\/canonical-store/);
  });

  it("`loadTodayV2GateData` uses a narrow 7-day observation window via the repo, with a lean projection", () => {
    const fn = SOURCE.split("export async function loadTodayV2GateData")[1] ?? "";
    expect(fn).toMatch(/getPromptAnswerObservations/);
    expect(fn).toMatch(/7\s*\*\s*86_400_000/);
    expect(fn).toContain('columns: "observed_at"');
  });

  it("starts the gate's independent import, connector, and tenant reads together", () => {
    const fn = SOURCE.split("export async function loadTodayV2GateData")[1] ?? "";
    const gateHead = fn.split("const repo =")[0] ?? fn;
    expect(gateHead).toMatch(/Promise\.all\(\s*\[/);
    expect(gateHead).toMatch(/hasActiveExperiment\(\)/);
    expect(gateHead).toMatch(/hasAnyConnectedDataSource\(\)/);
    expect(gateHead).toMatch(/currentTenantId\(\)/);
    expect(gateHead).not.toMatch(/await\s+hasActiveExperiment\(\)/);
    expect(gateHead).not.toMatch(/await\s+hasAnyConnectedDataSource\(\)/);
  });
});
