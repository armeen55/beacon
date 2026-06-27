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
    tier: "warm",
    score: 40,
    savedOpening: null,
    competitorDomains: ["garsononline.com"],
    preparedVerdict: null,
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
          },
        })}
        ownDomain="iranopedia.com"
      />,
    );
    expect(html).toContain("AI-validated");
    expect(html).toContain("What are popular Persian kebab varieties?");
    expect(html).toContain("Fans out into 5 related questions");
    expect(html).toContain("garsononline.com, matinabad.com");
    expect(html).toContain("Iranopedia not cited yet");
  });

  it("does NOT show the badge when aeoReceipt is null", () => {
    const html = renderToStaticMarkup(<NewPageCard o={opp({ aeoReceipt: null })} ownDomain="iranopedia.com" />);
    expect(html).not.toContain("AI-validated");
  });

  it("shows 'cited' instead of 'not cited yet' when the owned page is cited", () => {
    const html = renderToStaticMarkup(
      <NewPageCard
        o={opp({ aeoReceipt: { topPrompt: "x", fanoutCount: 0, citedDomains: ["a.com"], ownAbsent: false } })}
        ownDomain="iranopedia.com"
      />,
    );
    expect(html).toContain("Your page: cited");
    expect(html).not.toContain("Fans out into");
  });
});
