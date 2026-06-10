/**
 * 2026-06-09 — render contracts for the customer competitor-intel
 * sections. Pins: quiet moves suppressed, tier badges, associative
 * line + evidence/forecast lines, steal CTA → /recommendations;
 * why-them gaps/prompts/descriptors render, losses flagged "not
 * cited", null states render nothing.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StealThisMoveSection } from "@/app/(shell)/competitors/steal-this-move-section";
import { WhyThemSection } from "@/app/(shell)/competitors/why-them-section";
import type { CompetitorMoveWithEvidence } from "@/domains/competitor-intel/load-moves";
import type { WhyThemReport } from "@/domains/competitor-intel/types";

function move(over: Partial<CompetitorMoveWithEvidence> = {}): CompetitorMoveWithEvidence {
  return {
    id: "supplehomesinc.com|https://supplehomesinc.com/adu-cost|2026-06-02|new_page",
    domain: "supplehomesinc.com",
    displayName: "Supple Homes",
    url: "https://supplehomesinc.com/adu-cost",
    path: "/adu-cost",
    movedAtDate: "2026-06-02",
    kind: "new_page",
    whatTheyDid: "published a adu cost page",
    tier: "proven",
    preCount: 0,
    postCount: 4,
    daysToFirstCitation: 6,
    windowDays: 14,
    line:
      "Supple Homes published a adu cost page on June 2. AI started citing it 6 days later — 4 citations in the 14 days after (none in the two weeks before).",
    action: { actionType: "expand_page_coverage", label: "Publish your own cost guide" },
    evidenceLine: "In your own history: 75% of 8 similar past actions had positive outcomes.",
    forecastLine: null,
    ...over,
  };
}

describe("StealThisMoveSection", () => {
  it("renders proven move with badge, line, evidence, CTA", () => {
    const html = renderToStaticMarkup(<StealThisMoveSection moves={[move()]} />);
    expect(html).toContain("Their winning moves");
    expect(html).toContain("Cited after");
    expect(html).toContain("AI started citing it 6 days later");
    expect(html).toContain("In your own history:");
    expect(html).toContain("Publish your own cost guide");
    expect(html).toContain('href="/recommendations"');
  });

  it("suppresses quiet moves; renders nothing when only quiet exist", () => {
    const quiet = move({ tier: "quiet", id: "q1" });
    expect(renderToStaticMarkup(<StealThisMoveSection moves={[quiet]} />)).toBe("");
    const html = renderToStaticMarkup(<StealThisMoveSection moves={[quiet, move()]} />);
    expect(html).toContain("Their winning moves");
    expect(html).not.toContain('data-move-tier="quiet"');
  });

  it("caps at 5 cards", () => {
    const moves = Array.from({ length: 8 }, (_, i) => move({ id: `m${i}` }));
    const html = renderToStaticMarkup(<StealThisMoveSection moves={moves} />);
    expect(html.match(/data-move-tier=/g)).toHaveLength(5);
  });

  it("omits evidence/forecast lines when null", () => {
    const html = renderToStaticMarkup(
      <StealThisMoveSection moves={[move({ evidenceLine: null, forecastLine: null })]} />,
    );
    expect(html).not.toContain("In your own history");
  });
});

function report(over: Partial<WhyThemReport> = {}): WhyThemReport {
  return {
    domain: "supplehomesinc.com",
    displayName: "Supple Homes",
    theirUrl: "https://supplehomesinc.com/adu-cost-guide",
    theirTitle: "ADU Cost Guide",
    theirCitationTotal: 5,
    equivalentPageUrl: "https://ritzbuilders.com/adu-construction",
    gaps: [
      {
        dimension: "faq",
        theirs: "2 answered questions",
        ours: "none",
        sentence:
          "Their page answers 2 common questions right on the page; yours answers none.",
      },
    ],
    prompts: [
      {
        promptText: "Who builds the best ADUs in Palo Alto?",
        platform: "chatgpt",
        lastSeen: "2026-06-08T10:00:00Z",
        theirRank: 1,
        ourRank: null,
        theyWereFirst: true,
      },
    ],
    descriptors: { theirs: ["luxury", "award-winning"], ours: ["reliable"] },
    ...over,
  };
}

describe("WhyThemSection", () => {
  it("renders pages, gaps, descriptors, and the loss row", () => {
    const html = renderToStaticMarkup(<WhyThemSection reports={[report()]} />);
    expect(html).toContain("Why them, not you");
    expect(html).toContain("AI cited this page 5 times");
    expect(html).toContain("https://supplehomesinc.com/adu-cost-guide");
    expect(html).toContain("https://ritzbuilders.com/adu-construction");
    expect(html).toContain("answers 2 common questions");
    expect(html).toContain("luxury, award-winning");
    expect(html).toContain("Who builds the best ADUs in Palo Alto?");
    expect(html).toContain("not cited");
  });

  it("renders 'no close match' honestly and nothing on empty reports", () => {
    expect(renderToStaticMarkup(<WhyThemSection reports={[]} />)).toBe("");
    const html = renderToStaticMarkup(
      <WhyThemSection reports={[report({ equivalentPageUrl: null })]} />,
    );
    expect(html).toContain("No close match yet.");
  });
});
