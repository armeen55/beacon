/**
 * S1 (operator audit, 2026-05-05) — pin the measurement quality boundary.
 *
 * `NATIVE_REGIME_START` (the "measurement quality boundary") separates
 * the Profound-benchmark regime (pre-2026-04-22) from the native-polling
 * regime (on-or-after 2026-04-22). The verdict engine, the citation-
 * history series builder, and the recommendation evidence packet all
 * hard-code the same date. If the constant ever shifts silently, the
 * pure-split mixed-source guard fires on the wrong window and
 * `helping`/`hurting` verdicts are reported across incomparable
 * measurement systems — which is the exact bug Commit 2 + Commit 7A
 * were written to prevent.
 *
 * This file pins three contracts:
 *
 *   1. The constant `NATIVE_REGIME_START` is exported by the canonical
 *      file `src/domains/product/url-citation-history.ts`.
 *
 *   2. The hard-coded value is `2026-04-22`. Anyone editing it MUST
 *      also update the design notes + the tests covering the pure-
 *      split abstain. A blind edit fails CI.
 *
 *   3. No OTHER source file declares its own `2026-04-22` date literal.
 *      The single-canonical-source rule prevents drift between the
 *      verdict engine, the evidence packet builder, and the citation
 *      history series builder. Test fixtures and architecture tests
 *      may reference the date freely (they're scoped to test trees).
 *
 * Optional rename note: the operator audit's M3 plan suggested
 * eventually renaming `NATIVE_REGIME_START` →
 * `MEASUREMENT_QUALITY_BOUNDARY` to broaden the conceptual surface (it
 * also gates non-attribution decisions like the citation evidence
 * index regime tag). That rename is intentionally NOT done in S1 —
 * the operator brief said "Rename only if safe. Do not do broad
 * refactors." 27+ call sites across 6 domains would need to update at
 * the same time; the rename ships in a dedicated pass when the wider
 * cleanup is scoped. The constant remains canonical under its current
 * name; this invariant pins the value.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

import { NATIVE_REGIME_START } from "@/domains/product/url-citation-history";

const REPO_ROOT = resolve(__dirname, "../..");
const SRC_ROOT = join(REPO_ROOT, "src");
const CANONICAL_FILE = join(
  SRC_ROOT,
  "domains/product/url-citation-history.ts",
);

describe("S1 — measurement quality boundary is canonical and pinned", () => {
  it("NATIVE_REGIME_START exports the operator-locked value 2026-04-22", () => {
    // If you change the value, you ALSO need to:
    //   • update the design note at the top of url-citation-history.ts
    //   • update tests covering the pure-split abstain
    //     (src/domains/attribution/url-verdict.test.ts)
    //   • update tests covering denseSeries regime tagging
    //     (src/domains/product/url-citation-history.test.ts)
    //   • update tests covering evidence-packet sample-excerpt filtering
    expect(NATIVE_REGIME_START).toBe("2026-04-22");
  });

  it("the canonical file declares the constant exactly once", () => {
    const src = readFileSync(CANONICAL_FILE, "utf-8");
    const matches =
      src.match(/export const NATIVE_REGIME_START\s*=\s*"2026-04-22"/g) ?? [];
    expect(
      matches.length,
      "NATIVE_REGIME_START must be declared exactly once in url-citation-history.ts (S1 — single canonical source)",
    ).toBe(1);
  });

  it("no other src/** file declares a 2026-04-22 date literal", () => {
    const violations: Array<{ file: string; line: number; snippet: string }> = [];
    for (const file of walk(SRC_ROOT)) {
      // Allowlist the canonical file.
      if (file === CANONICAL_FILE) continue;
      // Skip test files inside src — they're allowed to use the date
      // as a fixture value.
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const src = readFileSync(file, "utf-8");
      // Look for the date in a string literal context (single or double
      // quoted). Comments are stripped to avoid false positives on
      // historical narration.
      const stripped = stripComments(src);
      if (!/['"]2026-04-22['"]/.test(stripped)) continue;
      // Find original line numbers for reporting.
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (
          /['"]2026-04-22['"]/.test(stripComments(lines[i])) &&
          !/(\/\/|\/\*|\*)\s*.*2026-04-22/.test(lines[i])
        ) {
          violations.push({
            file: file.slice(REPO_ROOT.length + 1),
            line: i + 1,
            snippet: lines[i].trim().slice(0, 140),
          });
        }
      }
    }
    expect(
      violations,
      `Found ${violations.length} non-canonical 2026-04-22 date literal(s). ` +
        `Import NATIVE_REGIME_START from "@/domains/product/url-citation-history" instead. ` +
        `Violations: ${JSON.stringify(violations, null, 2)}`,
    ).toEqual([]);
  });
});

describe("S1 — mixed-source attribution uses the boundary correctly", () => {
  // This is a SHAPE test against the verdict engine + citation history
  // builder — full math coverage lives in url-verdict.test.ts +
  // url-citation-history.test.ts. We pin here that the boundary is the
  // join key those two modules agree on.
  it("denseSeries tags points before the boundary as `benchmark`", async () => {
    const { denseSeries, NATIVE_REGIME_START: boundaryFromSeries } =
      await import("@/domains/product/url-citation-history");
    expect(boundaryFromSeries).toBe(NATIVE_REGIME_START);
    const series = denseSeries(
      {
        url: "/x",
        raw_urls: ["/x"],
        is_owned: true,
        daily: [
          { date: "2026-04-21", count: 5, by_platform: {}, source_type: "benchmark" },
          { date: "2026-04-22", count: 6, by_platform: {}, source_type: "derived" },
        ],
      },
      { first: "2026-04-21", last: "2026-04-22" },
    );
    expect(series.length).toBe(2);
    const before = series.find((p) => p.date === "2026-04-21");
    const after = series.find((p) => p.date === "2026-04-22");
    expect(before?.source_type).toBe("benchmark");
    expect(after?.source_type).toBe("derived");
  });

  it("pure-split benchmark→derived window abstains with not_enough_native_baseline", async () => {
    const { computeUrlVerdict } = await import(
      "@/domains/attribution/url-verdict"
    );
    // Baseline entirely benchmark; post entirely derived. The verdict
    // engine must abstain — Z-score across regimes is not comparable.
    const t0 = new Date("2026-04-08T00:00:00Z").getTime();
    const series = [];
    // 14 baseline days of benchmark @ 5/day (Apr 8 .. Apr 21)
    for (let i = 0; i < 14; i++) {
      const iso = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
      series.push({
        date: iso,
        count: 5,
        source_type: "benchmark" as const,
      });
    }
    // change day Apr 22
    series.push({
      date: "2026-04-22",
      count: 0,
      source_type: "derived" as const,
    });
    // 14 post-change days of derived @ 10/day (Apr 23 .. May 6)
    for (let i = 1; i <= 14; i++) {
      const iso = new Date(t0 + (14 + i) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      series.push({
        date: iso,
        count: 10,
        source_type: "derived" as const,
      });
    }
    const r = computeUrlVerdict({
      series,
      changeDate: "2026-04-22",
      asOfDate: "2026-05-06",
    });
    expect(
      r.verdict,
      "Pure-split benchmark→derived window MUST abstain (S1 — boundary is load-bearing for attribution)",
    ).toBe("not_enough_native_baseline");
  });
});

// ---------------------------------------------------------------------------
// Helpers — minimal, scoped to this invariant
// ---------------------------------------------------------------------------

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) yield full;
  }
}

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}
