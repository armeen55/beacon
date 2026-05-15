/**
 * Phase A.1 Step 6 — lifecycle copy renderer tests.
 *
 * Every customer-facing string variant on the Changes detail Act 3
 * lifecycle line goes through `renderLifecycleCopy`. These tests pin
 * the copy at the string level so:
 *
 *   • Section 2.10 stage variants stay in lockstep with the locked
 *     D9 6-stage enum.
 *   • Section 2.16 stuck-stage bridge phrase ("next bundle will add
 *     automated sitemap + robots checks") stays present until Phase
 *     A.3 (indexability) replaces it with verdict-specific copy.
 *   • Per-platform divergence renders only when exactly one of
 *     (chatgpt, perplexity) has cited and the other has not — never
 *     redundant against the primary line.
 *   • Internal taxonomy (`live_not_yet_cited`, `cited_*`, `stuck`)
 *     NEVER leaks into a rendered string.
 */

import { describe, expect, it } from "vitest";

import {
  BORROWED_BENCHMARK_TOOLTIP,
  buildTileStrings,
  renderBenchmarkTooltip,
  renderLifecycleCopy,
  renderStuckDiagnostic,
  type LifecycleCopyInput,
  type StuckDiagnosticInput,
  type ThresholdDecisionLike,
} from "@/domains/citation-lifecycle/render-copy";
import { T2C_THRESHOLDS } from "@/domains/citation-lifecycle/thresholds";
import type { IndexabilityVerdict } from "@/domains/indexability/types";

function input(overrides: Partial<LifecycleCopyInput> = {}): LifecycleCopyInput {
  return {
    stage: "live_not_yet_cited",
    days_since_live: 0,
    days_to_first_citation: null,
    per_platform_first_citation: {
      chatgpt: null,
      perplexity: null,
      google_ai_overviews: null,
    },
    is_partial_live: false,
    was_cited_before_live: false,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Stage variants (Section 2.10)
// ─────────────────────────────────────────────────────────────────────

describe("renderLifecycleCopy — primary line per stage", () => {
  it("live_not_yet_cited renders the watching message with the fast threshold", () => {
    const copy = renderLifecycleCopy(input({ days_since_live: 3 }));
    expect(copy.primary).toBe(
      `Live 3 days ago. Beacon is watching; first citations typically appear within ${T2C_THRESHOLDS.fast_days} days.`,
    );
  });

  it("live_not_yet_cited at 1 day uses singular form", () => {
    const copy = renderLifecycleCopy(input({ days_since_live: 1 }));
    expect(copy.primary).toContain("Live 1 day ago.");
  });

  it("cited_fast renders 'This page was cited N days after the edit went live — within Beacon's fast benchmark.'", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_fast",
        days_since_live: 5,
        days_to_first_citation: 4,
      }),
    );
    expect(copy.primary).toBe(
      "This page was cited 4 days after the edit went live — within Beacon's fast benchmark.",
    );
  });

  it("cited_typical renders 'This page was cited N days after the edit went live — within Beacon's typical citation window.'", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_typical",
        days_since_live: 13,
        days_to_first_citation: 12,
      }),
    );
    expect(copy.primary).toBe(
      "This page was cited 12 days after the edit went live — within Beacon's typical citation window.",
    );
  });

  it("cited_late renders 'This page was cited N days after the edit went live — past Beacon's typical window but within the late threshold.'", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_late",
        days_since_live: 29,
        days_to_first_citation: 28,
      }),
    );
    expect(copy.primary).toBe(
      "This page was cited 28 days after the edit went live — past Beacon's typical window but within the late threshold.",
    );
  });

  it("cited_very_late renders 'This page was cited N days after the edit went live — late, but the page is in Beacon's rotation.'", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_very_late",
        days_since_live: 46,
        days_to_first_citation: 45,
      }),
    );
    expect(copy.primary).toBe(
      "This page was cited 45 days after the edit went live — late, but the page is in Beacon's rotation.",
    );
  });

  it("stuck renders the discoverability message + plural day count", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "stuck",
        days_since_live: 41,
      }),
    );
    expect(copy.primary).toBe(
      "Live 41 days ago, not yet cited. Likely a discoverability issue.",
    );
  });

  it("days_to_first_citation = 0 on cited_fast (same-day citation) renders '0 days'", () => {
    // The eligibility predicate clamps before-live citations to 0,
    // and same-day citations naturally yield 0. Both must render
    // cleanly without breaking grammar.
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_fast",
        days_since_live: 1,
        days_to_first_citation: 0,
      }),
    );
    expect(copy.primary).toBe(
      "This page was cited 0 days after the edit went live — within Beacon's fast benchmark.",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Bridge phrase (Section 2.16 — forward-compatible with Phase A.3)
// ─────────────────────────────────────────────────────────────────────

describe("renderLifecycleCopy — stuck-stage bridge phrase", () => {
  it("stuck stage carries the Phase A.3 bridge phrase verbatim", () => {
    const copy = renderLifecycleCopy(
      input({ stage: "stuck", days_since_live: 50 }),
    );
    expect(copy.bridge).toBe(
      "The next bundle will add automated sitemap + robots checks here.",
    );
  });

  it("every non-stuck stage returns null bridge — the phrase is exclusive to stuck", () => {
    const nonStuck: Array<LifecycleCopyInput["stage"]> = [
      "live_not_yet_cited",
      "cited_fast",
      "cited_typical",
      "cited_late",
      "cited_very_late",
    ];
    for (const stage of nonStuck) {
      const copy = renderLifecycleCopy(input({ stage, days_to_first_citation: 5 }));
      expect(copy.bridge).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Per-platform divergence (Section 2.6)
// ─────────────────────────────────────────────────────────────────────

describe("renderLifecycleCopy — per-platform divergence", () => {
  it("renders 'First cited on Perplexity, not yet on ChatGPT' when only Perplexity has cited", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_typical",
        days_since_live: 10,
        days_to_first_citation: 8,
        per_platform_first_citation: {
          chatgpt: null,
          perplexity: "2026-05-08",
          google_ai_overviews: null,
        },
      }),
    );
    expect(copy.per_platform).toBe(
      "First cited on Perplexity, not yet on ChatGPT.",
    );
  });

  it("renders 'First cited on ChatGPT, not yet on Perplexity' when only ChatGPT has cited", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_fast",
        days_since_live: 3,
        days_to_first_citation: 2,
        per_platform_first_citation: {
          chatgpt: "2026-05-08",
          perplexity: null,
          google_ai_overviews: null,
        },
      }),
    );
    expect(copy.per_platform).toBe(
      "First cited on ChatGPT, not yet on Perplexity.",
    );
  });

  it("returns null when BOTH platforms have cited (no divergence)", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_typical",
        days_since_live: 10,
        days_to_first_citation: 8,
        per_platform_first_citation: {
          chatgpt: "2026-05-08",
          perplexity: "2026-05-09",
          google_ai_overviews: null,
        },
      }),
    );
    expect(copy.per_platform).toBeNull();
  });

  it("returns null on live_not_yet_cited even when one platform somehow has a date (defensive)", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "live_not_yet_cited",
        days_since_live: 4,
        per_platform_first_citation: {
          chatgpt: null,
          perplexity: "2026-05-08",
          google_ai_overviews: null,
        },
      }),
    );
    expect(copy.per_platform).toBeNull();
  });

  it("returns null on stuck stage (no citations on either platform)", () => {
    const copy = renderLifecycleCopy(
      input({ stage: "stuck", days_since_live: 50 }),
    );
    expect(copy.per_platform).toBeNull();
  });

  it("GAIO is locked null per D6 and never appears in per-platform copy", () => {
    // Even if a future caller incorrectly populates GAIO, the
    // divergence math only considers chatgpt + perplexity.
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_fast",
        days_since_live: 5,
        days_to_first_citation: 4,
        per_platform_first_citation: {
          chatgpt: "2026-05-08",
          perplexity: "2026-05-08",
          // @ts-expect-error — intentionally over-typing to prove
          // the renderer ignores any non-active-platform value.
          google_ai_overviews: "2026-05-08",
        },
      }),
    );
    expect(copy.per_platform).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Operator-side fields surfaced for completeness
// ─────────────────────────────────────────────────────────────────────

describe("renderLifecycleCopy — operator-side fields", () => {
  it("before_live_note is always null in v1 (operator-only, surfaced later)", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_fast",
        days_since_live: 1,
        days_to_first_citation: 0,
        was_cited_before_live: true,
      }),
    );
    expect(copy.before_live_note).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Internal taxonomy never leaks (locked architecture rule)
// ─────────────────────────────────────────────────────────────────────

describe("renderLifecycleCopy — no internal taxonomy in rendered strings", () => {
  it("none of the 6 stage enum values appear verbatim in any rendered copy", () => {
    const stages: Array<LifecycleCopyInput["stage"]> = [
      "live_not_yet_cited",
      "cited_fast",
      "cited_typical",
      "cited_late",
      "cited_very_late",
      "stuck",
    ];
    for (const stage of stages) {
      const copy = renderLifecycleCopy(
        input({
          stage,
          days_since_live: 10,
          days_to_first_citation: 8,
        }),
      );
      const rendered = [copy.primary, copy.per_platform, copy.bridge]
        .filter((s): s is string => typeof s === "string")
        .join(" | ");
      for (const enumValue of stages) {
        expect(rendered).not.toContain(enumValue);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Causality safety — time-to-citation MUST NOT imply that the edit
// caused the citation. Phrasing audit (2026-05-14): the subject of
// every cited-* primary line is "this page", and the relationship
// to the edit is the temporal anchor "after the edit went live",
// not a causal claim.
// ─────────────────────────────────────────────────────────────────────

describe("renderLifecycleCopy — no single-edit causal overclaim", () => {
  const FORBIDDEN_CAUSAL_FRAGMENTS = [
    " caused ",
    " drove ",
    " generated ",
    "because of this edit",
    "because of the edit",
    "the edit caused",
    "the change caused",
    "the edit drove",
    "the change drove",
    "this edit caused",
    "this change caused",
    "this edit drove",
    "this change drove",
    "this edit worked",
    "the edit worked because",
  ];

  it("none of the 6 stage primary lines contain causal verbs implying the edit caused the citation", () => {
    const stages: Array<LifecycleCopyInput["stage"]> = [
      "live_not_yet_cited",
      "cited_fast",
      "cited_typical",
      "cited_late",
      "cited_very_late",
      "stuck",
    ];
    for (const stage of stages) {
      const copy = renderLifecycleCopy(
        input({
          stage,
          days_since_live: 10,
          days_to_first_citation:
            stage === "live_not_yet_cited" || stage === "stuck" ? null : 8,
        }),
      );
      const text = [copy.primary, copy.per_platform, copy.bridge]
        .filter((s): s is string => typeof s === "string")
        .join(" | ")
        .toLowerCase();
      for (const phrase of FORBIDDEN_CAUSAL_FRAGMENTS) {
        expect(
          text,
          `stage '${stage}' rendered phrase contains forbidden causal fragment '${phrase.trim()}'`,
        ).not.toContain(phrase);
      }
    }
  });

  it("cited-* primary lines explicitly name 'this page' as the subject", () => {
    const citedStages: Array<LifecycleCopyInput["stage"]> = [
      "cited_fast",
      "cited_typical",
      "cited_late",
      "cited_very_late",
    ];
    for (const stage of citedStages) {
      const copy = renderLifecycleCopy(
        input({
          stage,
          days_since_live: 10,
          days_to_first_citation: 8,
        }),
      );
      expect(
        copy.primary.toLowerCase(),
        `stage '${stage}' should explicitly name 'this page' as subject`,
      ).toContain("this page was cited");
    }
  });

  it("cited-* primary lines anchor temporally to 'after the edit went live'", () => {
    const citedStages: Array<LifecycleCopyInput["stage"]> = [
      "cited_fast",
      "cited_typical",
      "cited_late",
      "cited_very_late",
    ];
    for (const stage of citedStages) {
      const copy = renderLifecycleCopy(
        input({
          stage,
          days_since_live: 10,
          days_to_first_citation: 8,
        }),
      );
      expect(
        copy.primary,
        `stage '${stage}' should use the temporal 'after the edit went live' anchor`,
      ).toContain("after the edit went live");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Borrowed-benchmark tooltip — D15 locked phrasing
// ─────────────────────────────────────────────────────────────────────

describe("BORROWED_BENCHMARK_TOOLTIP — D15 locked phrasing", () => {
  it("explains the borrowed-benchmark provenance honestly", () => {
    expect(BORROWED_BENCHMARK_TOOLTIP).toContain("6, 18, and 37 days");
    expect(BORROWED_BENCHMARK_TOOLTIP).toContain("starter benchmarks");
    expect(BORROWED_BENCHMARK_TOOLTIP).toContain("Beacon will replace them");
  });

  it("never claims the numbers are Beacon-owned today", () => {
    // Forbidden phrasing — Phase A.2 swaps the constant; until then,
    // any wording that implies the values are computed-from-your-data
    // would be dishonest.
    expect(BORROWED_BENCHMARK_TOOLTIP).not.toMatch(/from your data/i);
    expect(BORROWED_BENCHMARK_TOOLTIP).not.toMatch(/observed in your account/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase A.2 Step 3a — per-source variants + tooltip helper
// ─────────────────────────────────────────────────────────────────────

/**
 * Helper: build a `ThresholdDecisionLike` for tests. Defaults to
 * Profound source so a test that wants per-tenant explicitly opts
 * in by overriding `source` + `thresholds` + `sample_size`.
 */
function decision(
  overrides: Partial<ThresholdDecisionLike> = {},
): ThresholdDecisionLike {
  return {
    source: "profound_default",
    thresholds: T2C_THRESHOLDS,
    sample_size: 0,
    excluded_count: 0,
    percentile_used: { fast: 0.5, median: 0.75, late: 0.9 },
    ...overrides,
  };
}

// Backward-compatibility: existing callers do NOT pass
// threshold_decision. The renderer must default to Profound and
// produce byte-identical Phase A.1 strings.
describe("renderLifecycleCopy — backward compatibility (Phase A.2 §3.7)", () => {
  it("missing threshold_decision (Phase A.1 callers) produces identical output to explicit profound_default", () => {
    const stages: Array<LifecycleCopyInput["stage"]> = [
      "live_not_yet_cited",
      "cited_fast",
      "cited_typical",
      "cited_late",
      "cited_very_late",
      "stuck",
    ];
    for (const stage of stages) {
      const days =
        stage === "live_not_yet_cited" || stage === "stuck" ? null : 8;
      const baseline = renderLifecycleCopy(
        input({ stage, days_since_live: 10, days_to_first_citation: days }),
      );
      const explicit = renderLifecycleCopy(
        input({
          stage,
          days_since_live: 10,
          days_to_first_citation: days,
          threshold_decision: decision({ source: "profound_default" }),
        }),
      );
      expect(explicit).toEqual(baseline);
    }
  });

  it("missing threshold_decision uses Profound defaults verbatim (live_not_yet_cited mentions 6 days)", () => {
    const copy = renderLifecycleCopy(
      input({ stage: "live_not_yet_cited", days_since_live: 3 }),
    );
    expect(copy.primary).toBe(
      "Live 3 days ago. Beacon is watching; first citations typically appear within 6 days.",
    );
  });
});

// Per-tenant variants for every cited-* + live_not_yet_cited stage,
// plus an explicit assertion that `stuck` does NOT vary by source.
describe("renderLifecycleCopy — per-tenant variants (Phase A.2 §3.7)", () => {
  const perTenant = (
    overrides: Partial<ThresholdDecisionLike["thresholds"]> = {},
    sample = 22,
  ): ThresholdDecisionLike =>
    decision({
      source: "per_tenant",
      thresholds: {
        fast_days: 4,
        median_days: 12,
        late_days: 24,
        ...overrides,
      },
      sample_size: sample,
    });

  it("cited_fast per_tenant renders 'within Beacon's fast benchmark for this site'", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_fast",
        days_since_live: 5,
        days_to_first_citation: 4,
        threshold_decision: perTenant(),
      }),
    );
    expect(copy.primary).toBe(
      "This page was cited 4 days after the edit went live — within Beacon's fast benchmark for this site.",
    );
  });

  it("cited_typical per_tenant renders 'within Beacon's typical citation window for this site'", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_typical",
        days_since_live: 11,
        days_to_first_citation: 10,
        threshold_decision: perTenant(),
      }),
    );
    expect(copy.primary).toBe(
      "This page was cited 10 days after the edit went live — within Beacon's typical citation window for this site.",
    );
  });

  it("cited_late per_tenant renders 'within the late threshold for this site'", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_late",
        days_since_live: 22,
        days_to_first_citation: 20,
        threshold_decision: perTenant(),
      }),
    );
    expect(copy.primary).toBe(
      "This page was cited 20 days after the edit went live — past Beacon's typical window but within the late threshold for this site.",
    );
  });

  it("cited_very_late per_tenant renders 'in Beacon's rotation for this site'", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "cited_very_late",
        days_since_live: 35,
        days_to_first_citation: 33,
        threshold_decision: perTenant(),
      }),
    );
    expect(copy.primary).toBe(
      "This page was cited 33 days after the edit went live — late, but the page is in Beacon's rotation for this site.",
    );
  });

  it("live_not_yet_cited per_tenant names the cited subpopulation + uses dynamic fast_days", () => {
    const copy = renderLifecycleCopy(
      input({
        stage: "live_not_yet_cited",
        days_since_live: 2,
        threshold_decision: perTenant({ fast_days: 4 }),
      }),
    );
    expect(copy.primary).toBe(
      "Live 2 days ago. Beacon is watching; on cited pages from this site, first citations arrived within 4 days.",
    );
  });

  it("stuck primary copy is UNCHANGED across both threshold sources", () => {
    const profound = renderLifecycleCopy(
      input({
        stage: "stuck",
        days_since_live: 41,
        threshold_decision: decision({ source: "profound_default" }),
      }),
    );
    const perT = renderLifecycleCopy(
      input({
        stage: "stuck",
        days_since_live: 41,
        threshold_decision: perTenant(),
      }),
    );
    expect(profound.primary).toBe(perT.primary);
    expect(perT.primary).toBe(
      "Live 41 days ago, not yet cited. Likely a discoverability issue.",
    );
    // Bridge phrase still rendered on stuck regardless of source.
    expect(perT.bridge).toBe(
      "The next bundle will add automated sitemap + robots checks here.",
    );
  });

  it("per-tenant variants contain the 'for this site' marker (cited stages only)", () => {
    const citedStages: Array<LifecycleCopyInput["stage"]> = [
      "cited_fast",
      "cited_typical",
      "cited_late",
      "cited_very_late",
    ];
    for (const stage of citedStages) {
      const copy = renderLifecycleCopy(
        input({
          stage,
          days_since_live: 10,
          days_to_first_citation: 8,
          threshold_decision: perTenant(),
        }),
      );
      expect(
        copy.primary,
        `stage '${stage}' per_tenant variant should include 'for this site'`,
      ).toContain("for this site");
    }
  });

  it("per-tenant variants honor the causality-safety contract (no causal verbs)", () => {
    const FORBIDDEN_CAUSAL_FRAGMENTS = [
      " caused ",
      " drove ",
      " generated ",
      "because of this edit",
      "because of the edit",
      "the edit caused",
      "the change caused",
      "this edit caused",
      "this change caused",
      "this edit worked",
    ];
    const stages: Array<LifecycleCopyInput["stage"]> = [
      "live_not_yet_cited",
      "cited_fast",
      "cited_typical",
      "cited_late",
      "cited_very_late",
      "stuck",
    ];
    for (const stage of stages) {
      const copy = renderLifecycleCopy(
        input({
          stage,
          days_since_live: 10,
          days_to_first_citation:
            stage === "live_not_yet_cited" || stage === "stuck" ? null : 8,
          threshold_decision: perTenant(),
        }),
      );
      const text = [copy.primary, copy.per_platform, copy.bridge]
        .filter((s): s is string => typeof s === "string")
        .join(" | ")
        .toLowerCase();
      for (const phrase of FORBIDDEN_CAUSAL_FRAGMENTS) {
        expect(
          text,
          `per_tenant stage '${stage}' rendered text contains forbidden causal fragment '${phrase.trim()}'`,
        ).not.toContain(phrase);
      }
    }
  });

  it("per-tenant variants still use 'this page was cited' as the cited-stage subject", () => {
    const citedStages: Array<LifecycleCopyInput["stage"]> = [
      "cited_fast",
      "cited_typical",
      "cited_late",
      "cited_very_late",
    ];
    for (const stage of citedStages) {
      const copy = renderLifecycleCopy(
        input({
          stage,
          days_since_live: 10,
          days_to_first_citation: 8,
          threshold_decision: perTenant(),
        }),
      );
      expect(copy.primary.toLowerCase()).toContain("this page was cited");
      expect(copy.primary).toContain("after the edit went live");
    }
  });
});

// renderBenchmarkTooltip — single entry point for the tooltip body.
describe("renderBenchmarkTooltip (Phase A.2 §3.7)", () => {
  it("missing decision returns BORROWED_BENCHMARK_TOOLTIP verbatim (default = Profound)", () => {
    expect(renderBenchmarkTooltip()).toBe(BORROWED_BENCHMARK_TOOLTIP);
  });

  it("profound_default source returns BORROWED_BENCHMARK_TOOLTIP verbatim", () => {
    expect(
      renderBenchmarkTooltip(decision({ source: "profound_default" })),
    ).toBe(BORROWED_BENCHMARK_TOOLTIP);
  });

  it("per_tenant source returns the cited-shipped-edits wording with sample_size substituted", () => {
    const body = renderBenchmarkTooltip(
      decision({
        source: "per_tenant",
        thresholds: { fast_days: 4, median_days: 12, late_days: 24 },
        sample_size: 22,
      }),
    );
    expect(body).toBe(
      "Computed from 22 cited shipped edits on this site. " +
        "Bands describe pages that got cited — still-waiting and stuck " +
        "edits are tracked above.",
    );
  });

  it("per_tenant tooltip discloses the cited subpopulation contract", () => {
    // The honesty requirement from the operator-locked product
    // principle: per-tenant tooltip must say the bands describe
    // cited pages only, and the still-waiting/stuck rows are
    // tracked separately.
    const body = renderBenchmarkTooltip(
      decision({
        source: "per_tenant",
        sample_size: 30,
      }),
    );
    expect(body).toContain("cited shipped edits");
    expect(body).toContain("got cited");
    expect(body).toMatch(/still-waiting/i);
    expect(body).toMatch(/stuck/i);
  });

  it("per_tenant tooltip never overclaims that all pages get cited", () => {
    // The pre-flight risk-checklist called out cited-only sampling
    // bias. Tooltip phrasing must not say "your edits get cited
    // within X days" — only "pages that got cited."
    const body = renderBenchmarkTooltip(
      decision({ source: "per_tenant", sample_size: 22 }),
    );
    expect(body).not.toMatch(/all (your )?(edits|pages)/i);
    expect(body).not.toMatch(/(your )?edits (get|are) cited within/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase A.2 Step 3c — buildTileStrings
// ─────────────────────────────────────────────────────────────────────

describe("buildTileStrings — Profound default source (Phase A.2 §3c)", () => {
  it("returns the locked Phase A.1 stage labels for profound_default", () => {
    const strings = buildTileStrings(decision({ source: "profound_default" }));
    expect(strings.stage_labels.cited_fast).toBe(
      `cited fast (within ${T2C_THRESHOLDS.fast_days} days)`,
    );
    expect(strings.stage_labels.cited_typical).toBe(
      `cited typical (within ${T2C_THRESHOLDS.median_days} days)`,
    );
    expect(strings.stage_labels.cited_late).toBe(
      `cited late (within ${T2C_THRESHOLDS.late_days} days)`,
    );
    expect(strings.stage_labels.cited_very_late).toBe(
      `cited late (past ${T2C_THRESHOLDS.late_days} days)`,
    );
    expect(strings.stage_labels.live_not_yet_cited).toBe("still waiting");
    expect(strings.stage_labels.stuck).toBe(
      `stuck (past ${T2C_THRESHOLDS.late_days} days)`,
    );
  });

  it("returns the locked D15 BORROWED_BENCHMARK_TOOLTIP body for profound_default", () => {
    const strings = buildTileStrings(decision({ source: "profound_default" }));
    expect(strings.tooltip_body).toBe(BORROWED_BENCHMARK_TOOLTIP);
  });

  it("empty_state_body retains the {windowDays} placeholder for tile substitution", () => {
    const strings = buildTileStrings(decision({ source: "profound_default" }));
    expect(strings.empty_state_body).toContain("{windowDays}");
    expect(strings.empty_state_body).toContain(
      `within ${T2C_THRESHOLDS.fast_days} days`,
    );
  });
});

describe("buildTileStrings — per-tenant source (Phase A.2 §3c)", () => {
  it("substitutes per-tenant thresholds into the stage labels", () => {
    const strings = buildTileStrings(
      decision({
        source: "per_tenant",
        thresholds: { fast_days: 4, median_days: 11, late_days: 22 },
        sample_size: 24,
      }),
    );
    expect(strings.stage_labels.cited_fast).toBe("cited fast (within 4 days)");
    expect(strings.stage_labels.cited_typical).toBe(
      "cited typical (within 11 days)",
    );
    expect(strings.stage_labels.cited_late).toBe(
      "cited late (within 22 days)",
    );
    expect(strings.stage_labels.cited_very_late).toBe(
      "cited late (past 22 days)",
    );
    expect(strings.stage_labels.live_not_yet_cited).toBe("still waiting");
    expect(strings.stage_labels.stuck).toBe("stuck (past 22 days)");
  });

  it("returns the per-tenant cited-subpopulation tooltip body", () => {
    const strings = buildTileStrings(
      decision({ source: "per_tenant", sample_size: 33 }),
    );
    expect(strings.tooltip_body).toContain("Computed from 33 cited shipped edits");
    expect(strings.tooltip_body).toContain("got cited");
    expect(strings.tooltip_body).not.toBe(BORROWED_BENCHMARK_TOOLTIP);
  });

  it("empty_state_body falls back to Profound defaults defensively (per-tenant numbers meaningless on empty set)", () => {
    const strings = buildTileStrings(
      decision({
        source: "per_tenant",
        thresholds: { fast_days: 4, median_days: 11, late_days: 22 },
        sample_size: 24,
      }),
    );
    // The empty state always reads the Profound fast_days because
    // when total = 0 the per-tenant numbers would be a confusing
    // claim — Beacon hasn't actually observed anything yet.
    expect(strings.empty_state_body).toContain(
      `within ${T2C_THRESHOLDS.fast_days} days`,
    );
    expect(strings.empty_state_body).not.toContain("within 4 days");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase A.3 Step 4 — renderLifecycleCopy with stuck_diagnostic input
// ─────────────────────────────────────────────────────────────────────

describe("renderLifecycleCopy — stuck_diagnostic wiring (Phase A.3 §4)", () => {
  function stuckInput(
    stuckDiagnostic?: StuckDiagnosticInput | null,
  ): LifecycleCopyInput {
    return {
      stage: "stuck",
      days_since_live: 41,
      days_to_first_citation: null,
      per_platform_first_citation: {
        chatgpt: null,
        perplexity: null,
        google_ai_overviews: null,
      },
      is_partial_live: false,
      was_cited_before_live: false,
      stuck_diagnostic: stuckDiagnostic,
    };
  }

  it("stuck + ok verdict populates diagnostic with the ok line", () => {
    const copy = renderLifecycleCopy(stuckInput({ verdict: "ok" }));
    expect(copy.diagnostic).toBe(
      "This page appears discoverable. Beacon is watching for AI to pick it up.",
    );
    // Bridge stays populated in the data model — the client decides
    // which to render (mutually exclusive at the visible-sub-line
    // level, NOT at the data-model level).
    expect(copy.bridge).not.toBeNull();
  });

  it("stuck + not_in_sitemap verdict populates diagnostic with the sitemap line", () => {
    const copy = renderLifecycleCopy(
      stuckInput({ verdict: "not_in_sitemap" }),
    );
    expect(copy.diagnostic).toBe(
      "Beacon did not find this page in your sitemap.xml.",
    );
  });

  it("stuck + bad_status_code with http_status context substitutes the status", () => {
    const copy = renderLifecycleCopy(
      stuckInput({
        verdict: "bad_status_code",
        context: { http_status: 404 },
      }),
    );
    expect(copy.diagnostic).toBe(
      "This page returns HTTP 404 — it may no longer serve content.",
    );
  });

  it("stuck + canonical_elsewhere with canonical_url context substitutes the URL", () => {
    const copy = renderLifecycleCopy(
      stuckInput({
        verdict: "canonical_elsewhere",
        context: { canonical_url: "https://example.com/other" },
      }),
    );
    expect(copy.diagnostic).toBe(
      "This page declares a canonical to https://example.com/other — citations may credit that page instead.",
    );
  });

  it("stuck + blocked_by_robots_for_ai with blocked_ai_bots names the bots", () => {
    const copy = renderLifecycleCopy(
      stuckInput({
        verdict: "blocked_by_robots_for_ai",
        context: { blocked_ai_bots: ["GPTBot", "PerplexityBot"] },
      }),
    );
    expect(copy.diagnostic).toBe(
      "Your robots.txt appears to block GPTBot, PerplexityBot from this page.",
    );
  });

  it("stuck + null stuck_diagnostic leaves diagnostic null (bridge fallback path)", () => {
    const copy = renderLifecycleCopy(stuckInput(null));
    expect(copy.diagnostic).toBeNull();
    // Bridge phrase still populated for the fallback render path.
    expect(copy.bridge).toContain(
      "next bundle will add automated sitemap + robots checks",
    );
  });

  it("stuck + undefined stuck_diagnostic (omitted from input) leaves diagnostic null", () => {
    const copy = renderLifecycleCopy(stuckInput());
    expect(copy.diagnostic).toBeNull();
  });

  it("non-stuck stage + stuck_diagnostic input is IGNORED (diagnostic stays null)", () => {
    // Defense — even if a caller forgets the stage gate and passes
    // a stuck_diagnostic on a cited row, the renderer suppresses it.
    const copy = renderLifecycleCopy({
      stage: "cited_typical",
      days_since_live: 10,
      days_to_first_citation: 8,
      per_platform_first_citation: {
        chatgpt: null,
        perplexity: null,
        google_ai_overviews: null,
      },
      is_partial_live: false,
      was_cited_before_live: false,
      stuck_diagnostic: { verdict: "not_in_sitemap" },
    });
    expect(copy.diagnostic).toBeNull();
    expect(copy.bridge).toBeNull();
  });

  it("diagnostic copy carries no snake_case enum leakage across every verdict", () => {
    const verdicts = [
      "ok",
      "not_in_sitemap",
      "blocked_by_robots_for_ai",
      "blocked_by_robots_for_googlebot",
      "noindex_meta",
      "bad_status_code",
      "canonical_elsewhere",
      "unknown",
      "not_indexed_in_gsc",
      "indexed_but_not_cited",
    ] as const;
    const enums = [
      "not_in_sitemap",
      "blocked_by_robots_for_ai",
      "blocked_by_robots_for_googlebot",
      "noindex_meta",
      "bad_status_code",
      "canonical_elsewhere",
      "not_indexed_in_gsc",
      "indexed_but_not_cited",
    ] as const;
    for (const v of verdicts) {
      const copy = renderLifecycleCopy(stuckInput({ verdict: v }));
      expect(copy.diagnostic).not.toBeNull();
      for (const e of enums) {
        expect(
          copy.diagnostic,
          `verdict '${v}' diagnostic leaked enum '${e}': ${copy.diagnostic}`,
        ).not.toContain(e);
      }
    }
  });

  it("diagnostic copy carries no causal-overclaim wording across every verdict", () => {
    const verdicts = [
      "ok",
      "not_in_sitemap",
      "blocked_by_robots_for_ai",
      "blocked_by_robots_for_googlebot",
      "noindex_meta",
      "bad_status_code",
      "canonical_elsewhere",
      "unknown",
      "not_indexed_in_gsc",
      "indexed_but_not_cited",
    ] as const;
    const causal = ["caused", "drove", "generated", "because", "this is why"];
    for (const v of verdicts) {
      const copy = renderLifecycleCopy(stuckInput({ verdict: v }));
      const lower = (copy.diagnostic ?? "").toLowerCase();
      for (const c of causal) {
        expect(
          lower,
          `verdict '${v}' diagnostic contains causal token '${c}': ${copy.diagnostic}`,
        ).not.toContain(c);
      }
    }
  });
});

describe("buildTileStrings — customer-vocabulary contract", () => {
  it("no snake_case stage enum value appears in any returned string", () => {
    const sources = [
      buildTileStrings(decision({ source: "profound_default" })),
      buildTileStrings(
        decision({
          source: "per_tenant",
          thresholds: { fast_days: 5, median_days: 14, late_days: 28 },
          sample_size: 25,
        }),
      ),
    ];
    const snakeEnums = [
      "live_not_yet_cited",
      "cited_fast",
      "cited_typical",
      "cited_late",
      "cited_very_late",
    ] as const;
    for (const strings of sources) {
      const allText = [
        ...Object.values(strings.stage_labels),
        strings.tooltip_body,
        strings.empty_state_body,
      ].join("\n");
      for (const v of snakeEnums) {
        expect(allText, `enum '${v}' leaked into tile strings`).not.toContain(
          v,
        );
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase A.3 Step 2 — renderStuckDiagnostic (pure copy helper)
// ─────────────────────────────────────────────────────────────────────

const ALL_VERDICTS: ReadonlyArray<IndexabilityVerdict> = [
  "ok",
  "not_in_sitemap",
  "blocked_by_robots_for_ai",
  "blocked_by_robots_for_googlebot",
  "noindex_meta",
  "bad_status_code",
  "canonical_elsewhere",
  "unknown",
  "not_indexed_in_gsc",
  "indexed_but_not_cited",
];

describe("renderStuckDiagnostic — per-verdict copy (Phase A.3 §3)", () => {
  it("ok returns the watching-positive line", () => {
    expect(renderStuckDiagnostic({ verdict: "ok" })).toBe(
      "This page appears discoverable. Beacon is watching for AI to pick it up.",
    );
  });

  it("not_in_sitemap returns the sitemap-missing line", () => {
    expect(renderStuckDiagnostic({ verdict: "not_in_sitemap" })).toBe(
      "Beacon did not find this page in your sitemap.xml.",
    );
  });

  it("blocked_by_robots_for_googlebot returns the Googlebot-block line", () => {
    expect(
      renderStuckDiagnostic({ verdict: "blocked_by_robots_for_googlebot" }),
    ).toBe("Your robots.txt appears to block Googlebot from this page.");
  });

  it("noindex_meta returns the noindex line", () => {
    expect(renderStuckDiagnostic({ verdict: "noindex_meta" })).toBe(
      "This page declares noindex in its meta robots tag — AI crawlers will skip it.",
    );
  });

  it("unknown returns the watchful fallback line", () => {
    expect(renderStuckDiagnostic({ verdict: "unknown" })).toBe(
      "Beacon has not yet confirmed whether this page is discoverable.",
    );
  });

  it("not_indexed_in_gsc returns the GSC-not-confirmed line (reserved verdict)", () => {
    expect(renderStuckDiagnostic({ verdict: "not_indexed_in_gsc" })).toBe(
      "Google Search Console does not confirm this page is indexed.",
    );
  });

  it("indexed_but_not_cited returns the indexed-but-watching line (reserved verdict)", () => {
    expect(renderStuckDiagnostic({ verdict: "indexed_but_not_cited" })).toBe(
      "This page is indexed in Google. Beacon is still watching for AI to pick it up.",
    );
  });
});

describe("renderStuckDiagnostic — blocked_by_robots_for_ai with context", () => {
  it("single blocked bot is named in the copy", () => {
    const out = renderStuckDiagnostic({
      verdict: "blocked_by_robots_for_ai",
      context: { blocked_ai_bots: ["GPTBot"] },
    });
    expect(out).toBe(
      "Your robots.txt appears to block GPTBot from this page.",
    );
  });

  it("multiple blocked bots are comma-joined in the copy", () => {
    const out = renderStuckDiagnostic({
      verdict: "blocked_by_robots_for_ai",
      context: { blocked_ai_bots: ["GPTBot", "PerplexityBot"] },
    });
    expect(out).toBe(
      "Your robots.txt appears to block GPTBot, PerplexityBot from this page.",
    );
  });

  it("three blocked bots comma-join cleanly", () => {
    const out = renderStuckDiagnostic({
      verdict: "blocked_by_robots_for_ai",
      context: {
        blocked_ai_bots: ["GPTBot", "PerplexityBot", "ClaudeBot"],
      },
    });
    expect(out).toBe(
      "Your robots.txt appears to block GPTBot, PerplexityBot, ClaudeBot from this page.",
    );
  });

  it("empty bot list falls back to the generic AI-crawlers phrasing", () => {
    const out = renderStuckDiagnostic({
      verdict: "blocked_by_robots_for_ai",
      context: { blocked_ai_bots: [] },
    });
    expect(out).toBe(
      "Your robots.txt appears to block one or more AI crawlers from this page.",
    );
  });

  it("null bot list falls back to the generic AI-crawlers phrasing", () => {
    const out = renderStuckDiagnostic({
      verdict: "blocked_by_robots_for_ai",
      context: { blocked_ai_bots: null },
    });
    expect(out).toBe(
      "Your robots.txt appears to block one or more AI crawlers from this page.",
    );
  });

  it("missing context entirely falls back to the generic AI-crawlers phrasing", () => {
    const out = renderStuckDiagnostic({
      verdict: "blocked_by_robots_for_ai",
    });
    expect(out).toBe(
      "Your robots.txt appears to block one or more AI crawlers from this page.",
    );
  });
});

describe("renderStuckDiagnostic — bad_status_code with context", () => {
  it("includes the status number when supplied", () => {
    expect(
      renderStuckDiagnostic({
        verdict: "bad_status_code",
        context: { http_status: 404 },
      }),
    ).toBe("This page returns HTTP 404 — it may no longer serve content.");
  });

  it("includes a redirect status when supplied", () => {
    expect(
      renderStuckDiagnostic({
        verdict: "bad_status_code",
        context: { http_status: 301 },
      }),
    ).toBe("This page returns HTTP 301 — it may no longer serve content.");
  });

  it("missing status falls back to the generic error-or-redirect phrasing", () => {
    expect(renderStuckDiagnostic({ verdict: "bad_status_code" })).toBe(
      "This page returns an error or redirect status.",
    );
  });

  it("null status falls back to the generic error-or-redirect phrasing", () => {
    expect(
      renderStuckDiagnostic({
        verdict: "bad_status_code",
        context: { http_status: null },
      }),
    ).toBe("This page returns an error or redirect status.");
  });
});

describe("renderStuckDiagnostic — canonical_elsewhere with context", () => {
  it("includes the canonical URL verbatim when supplied", () => {
    expect(
      renderStuckDiagnostic({
        verdict: "canonical_elsewhere",
        context: { canonical_url: "https://example.com/other" },
      }),
    ).toBe(
      "This page declares a canonical to https://example.com/other — citations may credit that page instead.",
    );
  });

  it("missing canonical falls back to the generic 'different URL' phrasing", () => {
    expect(renderStuckDiagnostic({ verdict: "canonical_elsewhere" })).toBe(
      "This page declares a canonical to a different URL — citations may credit that page instead.",
    );
  });

  it("empty-string canonical falls back to the generic 'different URL' phrasing", () => {
    expect(
      renderStuckDiagnostic({
        verdict: "canonical_elsewhere",
        context: { canonical_url: "" },
      }),
    ).toBe(
      "This page declares a canonical to a different URL — citations may credit that page instead.",
    );
  });

  it("null canonical falls back to the generic 'different URL' phrasing", () => {
    expect(
      renderStuckDiagnostic({
        verdict: "canonical_elsewhere",
        context: { canonical_url: null },
      }),
    ).toBe(
      "This page declares a canonical to a different URL — citations may credit that page instead.",
    );
  });
});

describe("renderStuckDiagnostic — customer-vocabulary contract", () => {
  // Forbidden tokens per the operator-locked customer copy
  // guardrails. Snake_case enum identifiers (the verdict values
  // themselves) MUST NOT appear in rendered copy; causal-overclaim
  // verbs MUST NOT appear either.
  const SNAKE_ENUMS: ReadonlyArray<IndexabilityVerdict> = [
    "not_in_sitemap",
    "blocked_by_robots_for_ai",
    "blocked_by_robots_for_googlebot",
    "noindex_meta",
    "bad_status_code",
    "canonical_elsewhere",
    "not_indexed_in_gsc",
    "indexed_but_not_cited",
  ];

  const CAUSAL_TOKENS = [
    "caused",
    "drove",
    "generated",
    "because",
    "this is why",
  ] as const;

  it("no verdict's rendered copy contains a snake_case enum identifier", () => {
    for (const verdict of ALL_VERDICTS) {
      // Cover every fallback + context path for the verdicts that
      // have variant copy, so the assertion runs against every
      // string the helper can produce.
      const copies: string[] = [];
      copies.push(renderStuckDiagnostic({ verdict }));
      if (verdict === "blocked_by_robots_for_ai") {
        copies.push(
          renderStuckDiagnostic({
            verdict,
            context: {
              blocked_ai_bots: [
                "GPTBot",
                "PerplexityBot",
                "ClaudeBot",
                "Google-Extended",
              ],
            },
          }),
        );
      }
      if (verdict === "bad_status_code") {
        copies.push(
          renderStuckDiagnostic({ verdict, context: { http_status: 404 } }),
        );
      }
      if (verdict === "canonical_elsewhere") {
        copies.push(
          renderStuckDiagnostic({
            verdict,
            context: { canonical_url: "https://example.com/other" },
          }),
        );
      }
      for (const copy of copies) {
        for (const enumName of SNAKE_ENUMS) {
          expect(
            copy,
            `verdict '${verdict}' rendered copy leaked enum '${enumName}': ${copy}`,
          ).not.toContain(enumName);
        }
      }
    }
  });

  it("no verdict's rendered copy contains causal-overclaim language", () => {
    for (const verdict of ALL_VERDICTS) {
      const copies: string[] = [
        renderStuckDiagnostic({ verdict }),
        // Exercise context-bearing variants too.
        ...(verdict === "blocked_by_robots_for_ai"
          ? [
              renderStuckDiagnostic({
                verdict,
                context: { blocked_ai_bots: ["GPTBot"] },
              }),
            ]
          : []),
        ...(verdict === "bad_status_code"
          ? [
              renderStuckDiagnostic({
                verdict,
                context: { http_status: 500 },
              }),
            ]
          : []),
        ...(verdict === "canonical_elsewhere"
          ? [
              renderStuckDiagnostic({
                verdict,
                context: { canonical_url: "https://example.com/other" },
              }),
            ]
          : []),
      ];
      for (const copy of copies) {
        const lower = copy.toLowerCase();
        for (const token of CAUSAL_TOKENS) {
          expect(
            lower,
            `verdict '${verdict}' rendered copy contains causal token '${token}': ${copy}`,
          ).not.toContain(token);
        }
      }
    }
  });
});

describe("renderStuckDiagnostic — determinism", () => {
  it("same input returns byte-identical output across two calls", () => {
    const input: StuckDiagnosticInput = {
      verdict: "blocked_by_robots_for_ai",
      context: { blocked_ai_bots: ["GPTBot", "PerplexityBot"] },
    };
    expect(renderStuckDiagnostic(input)).toBe(renderStuckDiagnostic(input));
  });

  it("returns a non-empty string for every verdict", () => {
    for (const verdict of ALL_VERDICTS) {
      const copy = renderStuckDiagnostic({ verdict });
      expect(copy.length).toBeGreaterThan(0);
    }
  });
});
