/**
 * WhyRankedHere — narrow tests for the customer-facing "why ranked"
 * disclosure. Audit Correction #2 (2026-05-08).
 *
 * Test contract:
 *   1. Renders explanation when reasoning fields exist (multi-prompt
 *      with strong competitor pressure → 4 sentences).
 *   2. Falls back gracefully when optional fields are missing
 *      (no top competitor + 1 prompt + 0 observations → still renders
 *      priority + prompts + confidence sentences).
 *   3. Operator-only details stay hidden — the rendered HTML must NOT
 *      contain debug fields like prioritizerScore, raw reason codes,
 *      stable keys, or UUID strings.
 *   4. Honesty contract: never claims the rec is validated/proven/
 *      confirmed/winning. The `needs_review` row uses the honest,
 *      non-monitoring "Lower confidence — optional" microcopy.
 *   5. The component is pure — no engine math is invoked. Same row
 *      input → same HTML output (deterministic).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  WhyRankedHere,
  composeWhyRankedReasons,
  type WhyRankedHereRow,
} from "./why-ranked-here";

function buildRow(over: Partial<WhyRankedHereRow> = {}): WhyRankedHereRow {
  return {
    priority: "high",
    derivedConfidence: "moderate_evidence",
    detail: {
      affectedPromptCount: 4,
      observationCount: 12,
      topCompetitor: { name: "De Mattei Construction", primaryPct: 75 },
    },
    ...over,
  };
}

describe("WhyRankedHere — composition", () => {
  it("renders all four sentences when every signal is present", () => {
    const reasons = composeWhyRankedReasons(
      buildRow({
        priority: "high",
        derivedConfidence: "moderate_evidence",
        detail: {
          affectedPromptCount: 4,
          observationCount: 12,
          topCompetitor: { name: "De Mattei Construction", primaryPct: 75 },
        },
      }),
    );
    expect(reasons).toHaveLength(4);
    expect(reasons[0]).toContain("High priority");
    expect(reasons[1]).toContain("4 tracked prompts");
    expect(reasons[1]).toContain("12 observations");
    expect(reasons[2]).toContain("De Mattei Construction");
    expect(reasons[2]).toContain("75%");
    expect(reasons[3]).toContain("Moderate evidence");
  });

  it("falls back gracefully when optional fields are absent", () => {
    // No top competitor, 0 prompts, 0 observations — still emits the
    // priority + confidence sentences (the two always-available rails).
    const reasons = composeWhyRankedReasons(
      buildRow({
        priority: "low",
        derivedConfidence: "needs_review",
        detail: {
          affectedPromptCount: 0,
          observationCount: 0,
          topCompetitor: null,
        },
      }),
    );
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toContain("Lower priority");
    // 2026-06-14 — reworded off the false-monitoring "Beacon is watching".
    expect(reasons[1]).toContain("Lower confidence — based on limited data so far");
  });

  it("emits a single-prompt sentence and no competitor sentence when applicable", () => {
    const reasons = composeWhyRankedReasons(
      buildRow({
        priority: "medium",
        derivedConfidence: "moderate_evidence",
        detail: {
          affectedPromptCount: 1,
          observationCount: 3,
          topCompetitor: null,
        },
      }),
    );
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toContain("Medium priority");
    expect(reasons[1]).toBe("Affects 1 tracked prompt across 3 observations.");
    // No competitor sentence between prompts and confidence.
    expect(reasons[2]).toContain("Moderate evidence");
  });

  it("differentiates ≥50% competitor primacy from <50%", () => {
    const strong = composeWhyRankedReasons(
      buildRow({
        detail: {
          affectedPromptCount: 4,
          observationCount: 8,
          topCompetitor: { name: "Acme", primaryPct: 75 },
        },
      }),
    );
    expect(strong[2]).toBe("Acme is primary on 75% of those prompts.");

    const fragmented = composeWhyRankedReasons(
      buildRow({
        detail: {
          affectedPromptCount: 4,
          observationCount: 8,
          topCompetitor: { name: "Acme", primaryPct: 25 },
        },
      }),
    );
    expect(fragmented[2]).toBe(
      "Acme is competing for those prompts (primary on 25%).",
    );
  });
});

describe("WhyRankedHere — rendering", () => {
  it("renders the customer-facing summary label and all reasons", () => {
    const html = renderToStaticMarkup(<WhyRankedHere row={buildRow()} />);
    expect(html).toContain("Why ranked here?");
    expect(html).toContain("High priority");
    expect(html).toContain("4 tracked prompts");
    expect(html).toContain("De Mattei Construction");
    expect(html).toContain("Moderate evidence");
    expect(html).toContain('data-rec-why-ranked="true"');
  });

  it("renders even when only the always-on signals are available", () => {
    const html = renderToStaticMarkup(
      <WhyRankedHere
        row={buildRow({
          priority: "low",
          derivedConfidence: "needs_review",
          detail: {
            affectedPromptCount: 0,
            observationCount: 0,
            topCompetitor: null,
          },
        })}
      />,
    );
    expect(html).toContain("Why ranked here?");
    expect(html).toContain("Lower priority");
    // 2026-06-14 — needs_review sentence reworded off the false-monitoring
    // "Beacon is watching" claim to an honest "Lower confidence — optional".
    expect(html).toContain("Lower confidence — based on limited data so far");
    expect(html).not.toContain("tracked prompts");
    expect(html).not.toContain("observations");
  });

  it("never leaks operator-only debug fields or internal IDs", () => {
    const html = renderToStaticMarkup(
      <WhyRankedHere
        row={buildRow({
          priority: "high",
          derivedConfidence: "strong_evidence",
        })}
      />,
    );
    // None of these debug-only fields or token shapes should appear in
    // the rendered HTML.
    expect(html).not.toContain("prioritizerScore");
    expect(html).not.toContain("prioritizer_tier");
    expect(html).not.toContain("engineConfidence.reasons");
    expect(html).not.toMatch(/[a-f0-9-]{8}-[a-f0-9-]{4}-[a-f0-9-]{4}/i); // UUID-like
    expect(html).not.toMatch(/multi_prompt_signal/);
    expect(html).not.toMatch(/all_edits_high_confidence/);
    expect(html).not.toContain("now → this_week → later");
  });

  it("honesty contract — no claim that the rec is validated / proven / confirmed", () => {
    const all = (["high", "medium", "low"] as const).flatMap((priority) =>
      (
        [
          "strong_evidence",
          "moderate_evidence",
          "needs_review",
        ] as const
      ).map((dc) =>
        renderToStaticMarkup(
          <WhyRankedHere
            row={buildRow({ priority, derivedConfidence: dc })}
          />,
        ),
      ),
    );
    for (const html of all) {
      const lower = html.toLowerCase();
      expect(lower).not.toContain("validated");
      expect(lower).not.toContain("proven");
      expect(lower).not.toContain("confirmed");
      expect(lower).not.toContain("winning");
      // Word-boundary check on "win" — the substring is fine inside
      // unrelated tokens, but the word itself shouldn't appear.
      expect(lower).not.toMatch(/\bwin\b/);
      expect(lower).not.toMatch(/\bwon\b/);
    }
  });
});

describe("WhyRankedHere — purity / determinism", () => {
  it("produces identical output for identical input", () => {
    const a = renderToStaticMarkup(<WhyRankedHere row={buildRow()} />);
    const b = renderToStaticMarkup(<WhyRankedHere row={buildRow()} />);
    expect(a).toBe(b);
  });
});
