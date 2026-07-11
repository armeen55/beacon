/**
 * today-newpages-card - Wave 3C (3F) render pins:
 *   - a WAIT verdict never LEADS with a draft CTA;
 *   - BUILD only renders with a real source pack AND a "build" Google verdict;
 *   - "AI-validated" is relabeled to the honest "AI search demand confirmed".
 * Pure render (renderToStaticMarkup, no live calls), mirroring today-newpages-card-signal.test.tsx.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("@/app/(shell)/today-moves-actions", () => ({ draftMoveAnswerBlockAction: async () => ({ status: "off" }) }));
vi.mock("@/app/(shell)/serp-actions", () => ({ validateCreatePageWithSerpAction: async () => ({ ok: false, reason: "" }) }));
vi.mock("@/app/(shell)/diagnostics/profound-intelligence/actions", () => ({ draftAeoBriefAction: async () => ({ ok: false, reason: "test" }) }));
vi.mock("@/app/(shell)/today-newpages-draft-actions", () => ({ draftFullPageAction: async () => ({ ok: false, reason: "test" }) }));

import { NewPageCard } from "@/app/(shell)/today-newpages-card";
import type { NewPageOpportunity } from "@/app/(shell)/today-newpages-data";

function opp(over: Partial<NewPageOpportunity>): NewPageOpportunity {
  return {
    id: "k",
    topic: "Iranian directors",
    competitorCount: 3,
    topCompetitor: "imdb.com",
    whatWins: null,
    searchVolume: 800,
    signal: { kind: "stable", label: "Stable", evidence: null },
    score: 40,
    savedOpening: null,
    competitorDomains: ["imdb.com", "wikipedia.org"],
    preparedVerdict: null,
    preparedBrief: null,
    fullPageDraft: null,
    briefQuality: null,
    openingQuality: null,
    aeoReceipt: null,
    ...over,
  };
}

const READY_BRIEF: NewPageOpportunity["preparedBrief"] = {
  title: "Iranian film directors",
  meta: "The most influential Iranian directors and their films.",
  opening: "Iranian cinema is shaped by directors such as Abbas Kiarostami and Asghar Farhadi.",
  outline: ["New Wave", "Award winners", "Where to watch"],
  faqQuestions: ["Who is the most famous Iranian director?"],
  schemaTypes: ["Article"],
  sources: [],
};

function verdict(v: "build" | "wait" | "reject", topDomains: string[]): NewPageOpportunity["preparedVerdict"] {
  return {
    verdict: v,
    confidence: "high",
    intent: "informational",
    contentDomainCount: 7,
    marketplaceUgcCount: 0,
    profoundOverlapCount: 0,
    ownAlreadyRanks: false,
    topDomains,
    reason: "Content pages dominate.",
    generatedAt: "2026-07-09T00:00:00.000Z",
    costUsd: 0,
  } as NewPageOpportunity["preparedVerdict"];
}

describe("Wave 3C - WAIT never leads with a draft CTA", () => {
  const html = renderToStaticMarkup(
    <NewPageCard
      o={opp({ preparedVerdict: verdict("wait", ["imdb.com"]), preparedBrief: READY_BRIEF, briefQuality: null })}
      ownDomain="iranopedia.com"
    />,
  );
  it("hides the 'Draft the opening' CTA under a WAIT verdict", () => {
    expect(html).not.toContain("Draft the opening");
  });
  it("hides the 'Draft the full page' CTA under a WAIT verdict", () => {
    expect(html).not.toContain("Draft the full page");
  });
  it("still shows the WAIT verdict itself (the card is honest about waiting)", () => {
    expect(html).toContain("WAIT");
  });
});

describe("Wave 3C - BUILD only renders with sources AND a build verdict", () => {
  it("a build verdict with NO sources never renders BUILD (downgrades to WAIT + a sources note)", () => {
    const html = renderToStaticMarkup(
      <NewPageCard
        o={opp({
          competitorCount: 0,
          competitorDomains: [],
          topCompetitor: null,
          preparedVerdict: verdict("build", []),
          preparedBrief: null,
        })}
        ownDomain="iranopedia.com"
      />,
    );
    expect(html).not.toContain("BUILD");
    expect(html).toContain("WAIT");
    expect(html).toContain("before I say build");
  });

  it("a build verdict WITH sources renders BUILD", () => {
    const html = renderToStaticMarkup(
      <NewPageCard
        o={opp({ preparedVerdict: verdict("build", ["imdb.com", "britannica.com"]) })}
        ownDomain="iranopedia.com"
      />,
    );
    expect(html).toContain("BUILD");
  });
});

describe("Wave 3C - honest AEO relabel", () => {
  it("shows 'AI search demand confirmed', never 'AI-validated'", () => {
    const html = renderToStaticMarkup(
      <NewPageCard
        o={opp({
          aeoReceipt: {
            topPrompt: "Who are the great Iranian directors?",
            fanoutCount: 3,
            citedDomains: ["imdb.com"],
            ownAbsent: true,
            fanoutQueries: ["iranian new wave"],
            competitorPages: ["https://imdb.com/x"],
            ownCitedUrls: [],
          },
        })}
        ownDomain="iranopedia.com"
      />,
    );
    expect(html).toContain("AI search demand confirmed");
    expect(html).not.toContain("AI-validated");
  });
});
