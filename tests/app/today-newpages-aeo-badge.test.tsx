/**
 * #4 New Pages "Profound-validated" badge — render gating (2026-06-26).
 * The badge/receipt shows ONLY when the candidate carries a strong cached
 * aeoReceipt; absent otherwise. Pure render (no live calls).
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

function opp(over: Partial<NewPageOpportunity>): NewPageOpportunity {
  return {
    id: "k",
    topic: "Persian Kebab Varieties",
    competitorCount: 3,
    topCompetitor: "garsononline.com",
    whatWins: null,
    searchVolume: null,
    // operator spec 2026-07-09 D-33: Rising/Seasonal/Stable replaced Hot/Warm/Emerging.
    signal: { kind: "stable", label: "Stable", evidence: null },
    score: 40,
    savedOpening: null,
    competitorDomains: ["garsononline.com"],
    preparedVerdict: null,
    preparedBrief: null,
    fullPageDraft: null,
    briefQuality: null,
    openingQuality: null,
    aeoReceipt: null,
    ...over,
  };
}

describe("New Pages AEO-validated badge", () => {
  it("shows the badge + receipt when aeoReceipt is present", () => {
    const html = renderToStaticMarkup(
      <NewPageCard
        o={opp({
          aeoReceipt: {
            topPrompt: "What are popular Persian kebab varieties?",
            fanoutCount: 5,
            citedDomains: ["garsononline.com", "matinabad.com"],
            ownAbsent: true,
            fanoutQueries: ["persian kebab types", "koobideh barg"],
            competitorPages: ["https://garsononline.com/kebab"],
            ownCitedUrls: [],
          },
        })}
        ownDomain="iranopedia.com"
      />,
    );
    expect(html).toContain("AI search demand confirmed"); // Wave 3C relabel (was "AI-validated")
    expect(html).toContain("What are popular Persian kebab varieties?");
    expect(html).toContain("Fans out into 5 related questions");
    expect(html).toContain("garsononline.com, matinabad.com");
    expect(html).toContain("Iranopedia not cited yet");
  });

  it("shows the 'Draft AEO brief' button when enableAeoBrief + aeoReceipt", () => {
    const html = renderToStaticMarkup(
      <NewPageCard
        o={opp({ aeoReceipt: { topPrompt: "x", fanoutCount: 2, citedDomains: ["a.com"], ownAbsent: true, fanoutQueries: ["q1"], competitorPages: ["https://a.com/p"], ownCitedUrls: [] } })}
        ownDomain="iranopedia.com"
        enableAeoBrief
      />,
    );
    expect(html).toContain("Draft AEO brief");
  });

  it("does NOT show the brief button when enableAeoBrief is false (e.g. on the cockpit /)", () => {
    const html = renderToStaticMarkup(
      <NewPageCard
        o={opp({ aeoReceipt: { topPrompt: "x", fanoutCount: 2, citedDomains: ["a.com"], ownAbsent: true, fanoutQueries: ["q1"], competitorPages: ["https://a.com/p"], ownCitedUrls: [] } })}
        ownDomain="iranopedia.com"
      />,
    );
    expect(html).toContain("AI search demand confirmed"); // Wave 3C relabel (was "AI-validated") // receipt still shows
    expect(html).not.toContain("Draft AEO brief"); // but not the paid-LLM button
  });

  it("does NOT show the badge when aeoReceipt is null", () => {
    const html = renderToStaticMarkup(<NewPageCard o={opp({ aeoReceipt: null })} ownDomain="iranopedia.com" />);
    expect(html).not.toContain("AI search demand confirmed"); // Wave 3C relabel (was "AI-validated")
  });

  it("shows 'cited' instead of 'not cited yet' when the owned page is cited", () => {
    const html = renderToStaticMarkup(
      <NewPageCard
        o={opp({ aeoReceipt: { topPrompt: "x", fanoutCount: 0, citedDomains: ["a.com"], ownAbsent: false, fanoutQueries: [], competitorPages: [], ownCitedUrls: [] } })}
        ownDomain="iranopedia.com"
      />,
    );
    expect(html).toContain("Your page: cited");
    expect(html).not.toContain("Fans out into");
  });
});
