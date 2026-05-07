/**
 * Tests for <WhyThisVerdict> render — Trust Sprint Mini-Phase T3.2
 * (2026-05-06).
 *
 * SSR via renderToStaticMarkup. Confirms the disclosure renders, carries
 * data attributes for downstream invariants, and shows operator-locked
 * copy. Customer-safe summary line must never include Z-score / Greek
 * notation / SQL / UUIDs.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WhyThisVerdict } from "./why-this-verdict";
import { buildVerdictProvenance } from "@/domains/attribution/verdict-provenance";

function helping(): ReturnType<typeof buildVerdictProvenance> {
  return buildVerdictProvenance({
    id: "verdict-test",
    verdict: "helping",
    anchorDate: "2026-05-01",
    anchorSource: "live_at",
    preStartISO: "2026-04-17",
    preEndISO: "2026-04-30",
    postStartISO: "2026-05-02",
    postEndISO: "2026-05-04",
    preDays: 14,
    postDays: 3,
    preFullPollDays: 10,
    postFullPollDays: 3,
    muPre: 5,
    muPost: 11,
    zScore: 3.5,
    sustainUp: 3,
    sustainDown: 0,
    confidence: "high",
  });
}

describe("<WhyThisVerdict> — render surface", () => {
  it("renders the operator-locked summary 'Why this verdict?'", () => {
    const html = renderToStaticMarkup(<WhyThisVerdict provenance={helping()} />);
    expect(html).toContain("Why this verdict?");
  });

  it("emits data attributes (data-why-this-verdict, data-verdict-id, data-trust-level)", () => {
    const html = renderToStaticMarkup(<WhyThisVerdict provenance={helping()} />);
    expect(html).toContain('data-why-this-verdict="true"');
    expect(html).toContain('data-verdict-id="verdict-test"');
    expect(html).toContain('data-trust-level="directional"');
  });

  it("renders 'Directional' badge for clean helping verdict", () => {
    const html = renderToStaticMarkup(<WhyThisVerdict provenance={helping()} />);
    expect(html).toContain("Directional");
    expect(html).toContain('data-trust-badge="directional"');
  });

  it("renders 'Trustworthy' badge for not_enough_data abstain", () => {
    const p = buildVerdictProvenance({
      id: "verdict-x",
      verdict: "not_enough_data",
      anchorDate: null,
      anchorSource: "unknown",
      preStartISO: null,
      preEndISO: null,
      postStartISO: null,
      postEndISO: null,
      preDays: 0,
      postDays: 0,
    });
    const html = renderToStaticMarkup(<WhyThisVerdict provenance={p} />);
    expect(html).toContain("Trustworthy");
    expect(html).toContain('data-trust-badge="trustworthy"');
  });

  it("renders 'Unreliable' badge for helping with sparse pre-window", () => {
    const p = buildVerdictProvenance({
      id: "verdict-x",
      verdict: "helping",
      anchorDate: "2026-05-02",
      anchorSource: "live_at",
      // Clean dates window so the only unreliable trigger is sparse-pre.
      preStartISO: "2026-04-27",
      preEndISO: "2026-05-01",
      postStartISO: "2026-05-03",
      postEndISO: "2026-05-05",
      preDays: 5,
      postDays: 3,
      preFullPollDays: 2, // sparse → unreliable
      muPre: 0.2,
      muPost: 1,
      zScore: 2.5,
      sustainUp: 3,
      sustainDown: 0,
    });
    const html = renderToStaticMarkup(<WhyThisVerdict provenance={p} />);
    expect(html).toContain("Unreliable");
    expect(html).toContain('data-trust-badge="unreliable"');
    expect(html).toMatch(/sparse/i);
  });

  it("renders 'Directional' badge with strong caveat for helping touching contaminated date (T2 cleaned data)", () => {
    const p = buildVerdictProvenance({
      id: "verdict-x",
      verdict: "helping",
      anchorDate: "2026-04-30",
      anchorSource: "live_at",
      preStartISO: "2026-04-16",
      preEndISO: "2026-04-29",
      postStartISO: "2026-05-01",
      postEndISO: "2026-05-04",
      preDays: 14,
      postDays: 4,
      preFullPollDays: 10,
      muPre: 5,
      muPost: 11,
      zScore: 3.0,
      sustainUp: 4,
      sustainDown: 0,
    });
    const html = renderToStaticMarkup(<WhyThisVerdict provenance={p} />);
    // Trust label is directional, caveat surfaces the contaminated date.
    expect(html).toContain('data-trust-level="directional"');
    expect(html).toContain("2026-04-23");
    expect(html).toMatch(/partial polling|duplicate observations/i);
  });

  it("operatorDetail content (Z-score) is rendered inside the nested 'Operator detail' disclosure", () => {
    const html = renderToStaticMarkup(<WhyThisVerdict provenance={helping()} />);
    expect(html).toContain("Operator detail");
    expect(html).toContain("Z-score");
    expect(html).toContain("mu_pre");
  });

  it("customer summary line never includes raw Z-score / Greek / SQL / table names", () => {
    const html = renderToStaticMarkup(<WhyThisVerdict provenance={helping()} />);
    const summaryMatch = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html);
    expect(summaryMatch, "summary tag not found").not.toBeNull();
    const summaryText = summaryMatch![1];
    expect(summaryText).not.toMatch(/[Zz][ -]?score/);
    expect(summaryText).not.toContain("μ");
    expect(summaryText).not.toContain("σ");
    expect(summaryText).not.toContain("daily_metric_snapshots");
    expect(summaryText).not.toContain("prompt_answer_observations");
    expect(summaryText).not.toMatch(/\bSELECT\b/);
    expect(summaryText).not.toMatch(/\bFROM\s+/);
  });

  it("missing live_at surfaces a customer-safe caveat (no jargon)", () => {
    const p = buildVerdictProvenance({
      id: "verdict-x",
      verdict: "helping",
      anchorDate: "2026-05-01",
      anchorSource: "timestamp",
      preStartISO: "2026-04-17",
      preEndISO: "2026-04-30",
      postStartISO: "2026-05-02",
      postEndISO: "2026-05-04",
      preDays: 14,
      postDays: 3,
      preFullPollDays: 10,
      muPre: 5,
      muPost: 11,
      zScore: 3.5,
      sustainUp: 3,
      sustainDown: 0,
    });
    const html = renderToStaticMarkup(<WhyThisVerdict provenance={p} />);
    expect(html).toContain("changelog timestamp");
    expect(html).toContain("no live-at scan timestamp");
  });

  it("contaminated-date caveat lists the specific dates", () => {
    const p = buildVerdictProvenance({
      id: "verdict-x",
      verdict: "helping",
      anchorDate: "2026-05-02",
      anchorSource: "live_at",
      preStartISO: "2026-04-18",
      preEndISO: "2026-05-01",
      postStartISO: "2026-05-03",
      postEndISO: "2026-05-06",
      preDays: 14,
      postDays: 4,
      preFullPollDays: 10,
      muPre: 8,
      muPost: 2,
      zScore: -2.5,
      sustainUp: 0,
      sustainDown: 4,
    });
    const html = renderToStaticMarkup(<WhyThisVerdict provenance={p} />);
    expect(html).toContain("2026-05-06");
    expect(html).toContain("partial polling");
  });

  it("sparse pre-window caveat surfaces the day count", () => {
    const p = buildVerdictProvenance({
      id: "verdict-x",
      verdict: "helping",
      anchorDate: "2026-05-01",
      anchorSource: "live_at",
      preStartISO: "2026-04-17",
      preEndISO: "2026-04-30",
      postStartISO: "2026-05-02",
      postEndISO: "2026-05-04",
      preDays: 14,
      postDays: 3,
      preFullPollDays: 2,
      muPre: 0.2,
      muPost: 1,
      zScore: 2.5,
      sustainUp: 3,
      sustainDown: 0,
    });
    const html = renderToStaticMarkup(<WhyThisVerdict provenance={p} />);
    expect(html).toContain("2 day");
    expect(html).toMatch(/sparse/i);
  });
});
