/**
 * Phase A.1 Step 5 — lifecycle-stage truth-table tests.
 *
 * Locked 6-stage enum per Section 2 Decision Lock D9. All boundary
 * values reference `T2C_THRESHOLDS` directly (no hardcoded 6/18/37
 * duplicates) so a future threshold change automatically updates
 * the tests via Step 1's BORROWED DEFAULTS pin.
 */

import { describe, expect, it } from "vitest";

import {
  deriveLifecycleStage,
  type LifecycleStage,
  type LifecycleStageInput,
} from "@/domains/citation-lifecycle/lifecycle-stage";
import { T2C_THRESHOLDS } from "@/domains/citation-lifecycle/thresholds";

const FAST = T2C_THRESHOLDS.fast_days;
const MEDIAN = T2C_THRESHOLDS.median_days;
const LATE = T2C_THRESHOLDS.late_days;

/** Build an input record with sensible nullable defaults. */
function input(overrides: Partial<LifecycleStageInput> = {}): LifecycleStageInput {
  return {
    first_citation_date_iso: null,
    days_to_first_citation: null,
    days_since_live: null,
    ...overrides,
  };
}

describe("deriveLifecycleStage — Phase A.1 §2.9 / D9", () => {
  // ─────────────────────────────────────────────────────────────────
  // Ineligible / not-computable
  // ─────────────────────────────────────────────────────────────────

  it("case 1: all-null input returns null (ineligible)", () => {
    expect(deriveLifecycleStage(input())).toBeNull();
  });

  it("case 2: days_since_live=null returns null even when citation fields are set", () => {
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-05",
          days_to_first_citation: 4,
          days_since_live: null,
        }),
      ),
    ).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // No-citation branch
  // ─────────────────────────────────────────────────────────────────

  it("case 3: no citation + 0 days since live → live_not_yet_cited", () => {
    expect(deriveLifecycleStage(input({ days_since_live: 0 }))).toBe(
      "live_not_yet_cited" satisfies LifecycleStage,
    );
  });

  it("case 4: no citation + fast_days (6) since live → live_not_yet_cited", () => {
    expect(deriveLifecycleStage(input({ days_since_live: FAST }))).toBe(
      "live_not_yet_cited",
    );
  });

  it("case 5: no citation + median_days (18) since live → live_not_yet_cited", () => {
    expect(deriveLifecycleStage(input({ days_since_live: MEDIAN }))).toBe(
      "live_not_yet_cited",
    );
  });

  it("case 6: no citation + exactly late_days (37) since live → live_not_yet_cited (inclusive)", () => {
    expect(deriveLifecycleStage(input({ days_since_live: LATE }))).toBe(
      "live_not_yet_cited",
    );
  });

  it("case 7: no citation + late_days + 1 (38) since live → stuck", () => {
    expect(deriveLifecycleStage(input({ days_since_live: LATE + 1 }))).toBe(
      "stuck",
    );
  });

  it("case 8: no citation + 100 days since live → stuck", () => {
    expect(deriveLifecycleStage(input({ days_since_live: 100 }))).toBe("stuck");
  });

  // ─────────────────────────────────────────────────────────────────
  // First-citation branch — cited_fast
  // ─────────────────────────────────────────────────────────────────

  it("case 9: citation + 0 days to citation → cited_fast", () => {
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-05",
          days_to_first_citation: 0,
          days_since_live: 5,
        }),
      ),
    ).toBe("cited_fast" satisfies LifecycleStage);
  });

  it("case 10: citation + fast_days (6) days to citation → cited_fast (inclusive)", () => {
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-07",
          days_to_first_citation: FAST,
          days_since_live: 7,
        }),
      ),
    ).toBe("cited_fast");
  });

  // ─────────────────────────────────────────────────────────────────
  // First-citation branch — cited_typical
  // ─────────────────────────────────────────────────────────────────

  it("case 11: citation + fast_days + 1 (7) days to citation → cited_typical", () => {
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-08",
          days_to_first_citation: FAST + 1,
          days_since_live: 8,
        }),
      ),
    ).toBe("cited_typical" satisfies LifecycleStage);
  });

  it("case 12: citation + median_days (18) days to citation → cited_typical (inclusive)", () => {
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-19",
          days_to_first_citation: MEDIAN,
          days_since_live: 19,
        }),
      ),
    ).toBe("cited_typical");
  });

  // ─────────────────────────────────────────────────────────────────
  // First-citation branch — cited_late
  // ─────────────────────────────────────────────────────────────────

  it("case 13: citation + median_days + 1 (19) days to citation → cited_late", () => {
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-20",
          days_to_first_citation: MEDIAN + 1,
          days_since_live: 20,
        }),
      ),
    ).toBe("cited_late" satisfies LifecycleStage);
  });

  it("case 14: citation + late_days (37) days to citation → cited_late (inclusive)", () => {
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-06-07",
          days_to_first_citation: LATE,
          days_since_live: 38,
        }),
      ),
    ).toBe("cited_late");
  });

  // ─────────────────────────────────────────────────────────────────
  // First-citation branch — cited_very_late
  // ─────────────────────────────────────────────────────────────────

  it("case 15: citation + late_days + 1 (38) days to citation → cited_very_late", () => {
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-06-08",
          days_to_first_citation: LATE + 1,
          days_since_live: 39,
        }),
      ),
    ).toBe("cited_very_late" satisfies LifecycleStage);
  });

  it("case 16: citation + 100 days to citation → cited_very_late", () => {
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-08-09",
          days_to_first_citation: 100,
          days_since_live: 101,
        }),
      ),
    ).toBe("cited_very_late");
  });

  // ─────────────────────────────────────────────────────────────────
  // Negative days (before-live edge case) — clamp to cited_fast
  // ─────────────────────────────────────────────────────────────────

  it("case 17: negative days_to_first_citation (before-live) maps to cited_fast", () => {
    // compute-time-to-citation already clamps before-live citations
    // to days_to_first_citation: 0 with was_cited_before_live: true.
    // But if a future caller passes a negative value directly, this
    // module clamps semantics to cited_fast (consistent with the
    // <= fast_days check). Documented + pinned.
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-04-29",
          days_to_first_citation: -2,
          days_since_live: 1,
        }),
      ),
    ).toBe("cited_fast");
  });

  // ─────────────────────────────────────────────────────────────────
  // Inconsistent inputs — fail-closed / no-citation path
  // ─────────────────────────────────────────────────────────────────

  it("case 18: first_citation_date_iso set but days_to_first_citation null → null (fail-closed)", () => {
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-05",
          days_to_first_citation: null,
          days_since_live: 5,
        }),
      ),
    ).toBeNull();
  });

  it("case 19: first_citation_date_iso null but days_to_first_citation set → no-citation path (value ignored)", () => {
    // Inconsistent input shape — should not happen if compute is the
    // upstream, but pin the defensive behavior: the no-citation path
    // wins, and `days_to_first_citation` is ignored.
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: null,
          days_to_first_citation: 5,
          days_since_live: 10,
        }),
      ),
    ).toBe("live_not_yet_cited");

    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: null,
          days_to_first_citation: 5,
          days_since_live: LATE + 1,
        }),
      ),
    ).toBe("stuck");
  });

  // ─────────────────────────────────────────────────────────────────
  // Source-level invariant: thresholds imported, not duplicated
  // ─────────────────────────────────────────────────────────────────

  it("case 20: boundary values reference T2C_THRESHOLDS — module imports the constants rather than duplicating them", async () => {
    // Indirect proof via behavior: a boundary test at the literal
    // thresholds value sees the same classification as one expressed
    // via the imported constant. If a future change tries to inline
    // a duplicate `const FAST = 6` inside the module, the import
    // assertion below also fails-loud.
    const literalBoundary = deriveLifecycleStage(
      input({
        first_citation_date_iso: "2026-05-07",
        days_to_first_citation: 6,
        days_since_live: 7,
      }),
    );
    const constantBoundary = deriveLifecycleStage(
      input({
        first_citation_date_iso: "2026-05-07",
        days_to_first_citation: T2C_THRESHOLDS.fast_days,
        days_since_live: 7,
      }),
    );
    expect(literalBoundary).toBe(constantBoundary);
    expect(literalBoundary).toBe("cited_fast");

    // Source-level invariant: the module file imports T2C_THRESHOLDS
    // from "./thresholds" rather than inlining the 6/18/37 numbers.
    // Pinned at the source-text level so a future "cleanup" PR can't
    // silently fork the constants.
    const { readFile } = await import("node:fs/promises");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const modulePath = resolve(
      here,
      "..",
      "..",
      "..",
      "src",
      "domains",
      "citation-lifecycle",
      "lifecycle-stage.ts",
    );
    const src = await readFile(modulePath, "utf-8");
    expect(src).toMatch(/import\s*\{[^}]*T2C_THRESHOLDS[^}]*\}\s*from\s*["']\.\/thresholds["']/);
    // And no hardcoded numeric thresholds anywhere in the executable
    // body (comments may still mention "6", "18", "37" for human
    // readers — strip them before scanning).
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/[^a-zA-Z_][6][^0-9_]/);
    expect(stripped).not.toMatch(/[^a-zA-Z_][18][^0-9_]/);
    expect(stripped).not.toMatch(/[^a-zA-Z_][37][^0-9_]/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase A.2 Step 3a — custom thresholds (optional 2nd argument)
// ─────────────────────────────────────────────────────────────────────

describe("deriveLifecycleStage — custom thresholds (Phase A.2 §3.7 / E7)", () => {
  it("default no-second-arg behavior is identical to T2C_THRESHOLDS — boundary check at fast_days = 6", () => {
    // A 6-day citation is cited_fast under the default (T2C_THRESHOLDS.fast_days = 6).
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-07",
          days_to_first_citation: 6,
          days_since_live: 7,
        }),
      ),
    ).toBe("cited_fast");
    // A 7-day citation is cited_typical (just past fast_days).
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-08",
          days_to_first_citation: 7,
          days_since_live: 8,
        }),
      ),
    ).toBe("cited_typical");
  });

  it("custom thresholds { fast: 3, median: 7, late: 14 } override default classification", () => {
    const custom = { fast_days: 3, median_days: 7, late_days: 14 };
    // 4 days > custom fast (3); ≤ custom median (7) → cited_typical
    // (under default Profound thresholds this would also be
    // cited_typical, but the boundary at 3 confirms the override
    // took effect — at 3 it's cited_fast under custom, cited_fast
    // under default; checking 4 days exercises the band).
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-05",
          days_to_first_citation: 4,
          days_since_live: 5,
        }),
        custom,
      ),
    ).toBe("cited_typical");
    // 3 days <= custom fast (3) → cited_fast under custom.
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-04",
          days_to_first_citation: 3,
          days_since_live: 4,
        }),
        custom,
      ),
    ).toBe("cited_fast");
    // 15 days > custom late (14) → cited_very_late (would be
    // cited_typical under default Profound thresholds).
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-16",
          days_to_first_citation: 15,
          days_since_live: 16,
        }),
        custom,
      ),
    ).toBe("cited_very_late");
  });

  it("collapsed thresholds { fast: 5, median: 5, late: 5 } map correctly via chained <= checks", () => {
    const collapsed = { fast_days: 5, median_days: 5, late_days: 5 };
    // 4 days <= 5 → cited_fast (passes the first <= 5 check).
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-05",
          days_to_first_citation: 4,
          days_since_live: 5,
        }),
        collapsed,
      ),
    ).toBe("cited_fast");
    // 5 days <= 5 → cited_fast (boundary case).
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-06",
          days_to_first_citation: 5,
          days_since_live: 6,
        }),
        collapsed,
      ),
    ).toBe("cited_fast");
    // 6 days > 5 → falls through all three checks → cited_very_late.
    expect(
      deriveLifecycleStage(
        input({
          first_citation_date_iso: "2026-05-07",
          days_to_first_citation: 6,
          days_since_live: 7,
        }),
        collapsed,
      ),
    ).toBe("cited_very_late");
  });

  it("custom thresholds also affect the no-citation branch (stuck boundary)", () => {
    const custom = { fast_days: 3, median_days: 7, late_days: 14 };
    // 14 days_since_live with no citation → live_not_yet_cited
    // (14 <= custom late_days).
    expect(
      deriveLifecycleStage(input({ days_since_live: 14 }), custom),
    ).toBe("live_not_yet_cited");
    // 15 days_since_live with no citation → stuck (> custom late_days).
    expect(deriveLifecycleStage(input({ days_since_live: 15 }), custom)).toBe(
      "stuck",
    );
  });
});
