/**
 * today-newpages-card-signal (operator spec 2026-07-09, D-26/D-27/D-33) - pins the
 * rendered New Pages card copy for the four board fixes: the Rising/Seasonal/Stable
 * label renders WITH its evidence (D-33), a merged card shows "Also covers … (dedup-
 * licated demand N/mo)" (D-27), the source pack renders under a "Sources" mini-list
 * (D-26), and the full-page-draft button is disabled with "Add 1-2 sources first" when
 * a brief has no sources (D-26). Pure render (renderToStaticMarkup, no live calls).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("@/app/(shell)/today-moves-actions", () => ({ draftMoveAnswerBlockAction: async () => ({ status: "off" }) }));
vi.mock("@/app/(shell)/serp-actions", () => ({ validateCreatePageWithSerpAction: async () => ({ ok: false, reason: "" }) }));
vi.mock("@/app/(shell)/aeo-brief-actions", () => ({ draftAeoBriefAction: async () => ({ ok: false, reason: "test" }) }));
vi.mock("@/app/(shell)/today-newpages-draft-actions", () => ({ draftFullPageAction: async () => ({ ok: false, reason: "test" }) }));

import { NewPageCard } from "@/app/(shell)/today-newpages-card";
import type { NewPageOpportunity } from "@/app/(shell)/today-newpages-data";

const BANNED_DASH = /[‒–—―]/;

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

describe("D-33 Rising label renders with its evidence", () => {
  const html = renderToStaticMarkup(
    <NewPageCard
      o={opp({ signal: { kind: "rising", label: "Rising", evidence: "searches 3.7x usual this month" } })}
      ownDomain="iranopedia.com"
    />,
  );
  it("shows the label and its evidence line, not Hot/Warm/Emerging", () => {
    expect(html).toContain("Rising: searches 3.7x usual this month");
    expect(html).not.toContain("Hot");
    expect(html).not.toContain("Warm");
    expect(html).not.toContain("Emerging");
  });
  it("emits no banned dash", () => {
    expect(BANNED_DASH.test(html)).toBe(false);
  });
});

describe("D-27 merged card shows deduplicated demand", () => {
  it("appends the deduplicated-demand phrasing to the Also covers line", () => {
    const html = renderToStaticMarkup(
      <NewPageCard
        o={opp({ alsoCovers: ["Iranian director"], clusterVolume: 860 })}
        ownDomain="iranopedia.com"
      />,
    );
    expect(html).toContain("Also covers: Iranian director (deduplicated demand 860/mo)");
  });
});

describe("D-26 source pack + full-draft gating", () => {
  it("renders the Sources mini-list grouping competitor pages and top Google results", () => {
    const html = renderToStaticMarkup(
      <NewPageCard
        o={opp({
          preparedVerdict: {
            verdict: "build",
            confidence: "high",
            intent: "informational",
            contentDomainCount: 7,
            marketplaceUgcCount: 0,
            profoundOverlapCount: 0,
            ownAlreadyRanks: false,
            topDomains: ["imdb.com", "britannica.com"],
            reason: "Content pages dominate.",
            generatedAt: "2026-07-09T00:00:00.000Z",
            costUsd: 0,
          },
        })}
        ownDomain="iranopedia.com"
      />,
    );
    expect(html).toContain("Sources");
    expect(html).toContain("Competitor pages AI cites: imdb.com, wikipedia.org");
    expect(html).toContain("Top Google results: imdb.com, britannica.com");
  });

  it("disables the full-page draft button with 'Add 1-2 sources first' when a brief has no sources", () => {
    const html = renderToStaticMarkup(
      <NewPageCard
        o={opp({
          competitorCount: 0,
          competitorDomains: [],
          topCompetitor: null,
          preparedBrief: READY_BRIEF,
          briefQuality: null,
        })}
        ownDomain="iranopedia.com"
      />,
    );
    expect(html).toContain('title="Add 1-2 sources first"');
    // The draft button still renders (it is present, just disabled).
    expect(html).toContain("Draft the full page");
    expect(html).toContain("disabled");
  });

  it("enables the full-page draft button when the brief has sources", () => {
    const html = renderToStaticMarkup(
      <NewPageCard
        o={opp({ preparedBrief: READY_BRIEF, briefQuality: null })}
        ownDomain="iranopedia.com"
      />,
    );
    expect(html).not.toContain('title="Add 1-2 sources first"');
    expect(html).toContain("Draft the full page");
  });
});
