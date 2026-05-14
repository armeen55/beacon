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
  renderLifecycleCopy,
  type LifecycleCopyInput,
} from "@/domains/citation-lifecycle/render-copy";
import { T2C_THRESHOLDS } from "@/domains/citation-lifecycle/thresholds";

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
