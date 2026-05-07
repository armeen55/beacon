/**
 * Tests for <WhyThisNumber> + the wired /today surfaces — Trust Sprint
 * Mini-Phase T3.1 (2026-05-06).
 *
 * SSR via renderToStaticMarkup. Confirms the disclosure renders, carries
 * data attributes for downstream invariants, and shows operator-locked
 * copy.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WhyThisNumber } from "./why-this-number";
import {
  buildOverallVisibilityProvenance,
  buildPrimaryRateProvenance,
  buildCompetitorLeaderboardProvenance,
  buildPromptCategoryProvenance,
  buildShareCaptureProvenance,
} from "@/domains/today/score-provenance";

describe("<WhyThisNumber> — render surface", () => {
  it("renders the operator-locked summary 'Why this number?'", () => {
    const html = renderToStaticMarkup(
      <WhyThisNumber
        provenance={buildOverallVisibilityProvenance({
          scorePct: 50,
          windowDays: 14,
          windowTouchesPreCutover: false,
          hasPartialDays: false,
          hasProofDays: false,
        })}
      />,
    );
    expect(html).toContain("Why this number?");
  });

  it("emits data attributes (data-why-this-number, data-score-id, data-trust-level)", () => {
    const html = renderToStaticMarkup(
      <WhyThisNumber
        provenance={buildPrimaryRateProvenance({
          platformLabel: "ChatGPT",
          latestRate: 0.42,
          latestDayObsCount: 99,
          windowDays: 14,
          sampleStatus: "enough",
        })}
      />,
    );
    expect(html).toContain('data-why-this-number="true"');
    expect(html).toContain('data-score-id="primary-rate-chatgpt"');
    expect(html).toContain('data-trust-level="directional"');
  });

  it("renders 'Directional' badge for directional scores", () => {
    const html = renderToStaticMarkup(
      <WhyThisNumber
        provenance={buildOverallVisibilityProvenance({
          scorePct: 50,
          windowDays: 14,
          windowTouchesPreCutover: false,
          hasPartialDays: false,
          hasProofDays: false,
        })}
      />,
    );
    expect(html).toContain("Directional");
    expect(html).toContain('data-trust-badge="directional"');
  });

  it("renders 'Trustworthy' badge for trustworthy prompt categories", () => {
    const html = renderToStaticMarkup(
      <WhyThisNumber
        provenance={buildPromptCategoryProvenance({
          category: "winning",
          count: 5,
          lookbackDays: 7,
        })}
      />,
    );
    expect(html).toContain("Trustworthy");
    expect(html).toContain('data-trust-badge="trustworthy"');
  });

  it("renders 'Unreliable' badge for share-capture banner", () => {
    const html = renderToStaticMarkup(
      <WhyThisNumber provenance={buildShareCaptureProvenance({ visible: true })} />,
    );
    expect(html).toContain("Unreliable");
    expect(html).toContain('data-trust-badge="unreliable"');
  });

  it("operatorDetail content is rendered behind a nested 'Operator detail' disclosure (debug only)", () => {
    const html = renderToStaticMarkup(
      <WhyThisNumber
        provenance={buildOverallVisibilityProvenance({
          scorePct: 50,
          windowDays: 14,
          windowTouchesPreCutover: false,
          hasPartialDays: false,
          hasProofDays: false,
        })}
      />,
    );
    expect(html).toContain("Operator detail");
    // The raw table name lives only inside the operator-detail block.
    expect(html).toContain("prompt_answer_observations");
  });

  it("customer-facing summary line never includes raw table names or SQL", () => {
    const html = renderToStaticMarkup(
      <WhyThisNumber
        provenance={buildCompetitorLeaderboardProvenance({
          windowDays: 14,
          windowTouchesPreCutover: false,
          rowCount: 5,
        })}
      />,
    );
    // The <summary> trigger contents
    const summaryMatch = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html);
    expect(summaryMatch, "summary tag not found").not.toBeNull();
    const summaryText = summaryMatch![1];
    expect(summaryText).not.toContain("daily_metric_snapshots");
    expect(summaryText).not.toContain("prompt_answer_observations");
    expect(summaryText).not.toMatch(/\bSELECT\b/);
    expect(summaryText).not.toMatch(/\bFROM\s+/);
  });

  it("compact mode still renders the trigger and trust badge", () => {
    const html = renderToStaticMarkup(
      <WhyThisNumber
        provenance={buildPrimaryRateProvenance({
          platformLabel: "Perplexity",
          latestRate: 0.55,
          latestDayObsCount: 100,
          windowDays: 14,
          sampleStatus: "enough",
        })}
        compact
      />,
    );
    expect(html).toContain("Why this number?");
    expect(html).toContain("Directional");
  });
});

describe("<WhyThisNumber> — caveats render", () => {
  it("partial-day caveat renders as <li>", () => {
    const html = renderToStaticMarkup(
      <WhyThisNumber
        provenance={buildOverallVisibilityProvenance({
          scorePct: 30,
          windowDays: 14,
          windowTouchesPreCutover: false,
          hasPartialDays: true,
          hasProofDays: false,
        })}
      />,
    );
    expect(html).toMatch(/<li>[^<]*partial coverage/i);
  });

  it("primary-rate's '99 observations' caveat is honest about the partial day", () => {
    const html = renderToStaticMarkup(
      <WhyThisNumber
        provenance={buildPrimaryRateProvenance({
          platformLabel: "ChatGPT",
          latestRate: 0.5,
          latestDayObsCount: 99,
          windowDays: 14,
          sampleStatus: "enough",
        })}
      />,
    );
    expect(html).toContain("99");
    expect(html).toContain("80-prompt full-day threshold");
  });
});
