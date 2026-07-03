/**
 * TeamRoundtable (P5 - team-deliberation pack) - render pins for the VISIBLE debate on the daily
 * card. The roundtable must read like a real team argued the decision: how much they agreed
 * (item 387), the strongest case AGAINST (item 231/314), the falsifiable auto-retract commitment
 * (item 312), and a lone-weak-opinion demotion to "worth a look" (item 163). These pins render the
 * REAL component via renderToStaticMarkup off a real TeamReview built by reviewCandidateWithTeam,
 * and assert the rendered COPY - a feature whose surface would embarrass us is not done.
 *
 * Byte-identical self-hide pins: an empty/absent teamReview and a single-opinion review render
 * without the agreement line (one voice is not a team agreeing).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TeamRoundtable } from "./daily-experiments-section";
import type { PlannedExperimentRecord } from "@/domains/experiments/daily-plan-types";
import type { TeamReview } from "@/domains/experiments/team-review";

/** TeamRoundtable reads only e.teamReview; the rest of the record can be a minimal stub. */
function recordWith(teamReview: TeamReview | undefined): PlannedExperimentRecord {
  return { teamReview } as unknown as PlannedExperimentRecord;
}

const baseReview = (over: Partial<TeamReview>): TeamReview => ({
  verdict: "Biggest opportunity the team sees on this page: a sharper title and description.",
  headline: "3 specialists weighed in",
  consensusPct: 72,
  voices: [
    { specialist: "gsc", label: "Search demand", claim: "Ranks #8 with 0.9% CTR on 4,000 impressions.", confidencePct: 78 },
    { specialist: "profound", label: "AI citations", claim: "AI cites 2 competitor pages for this topic, never you.", confidencePct: 65 },
  ],
  objections: [],
  ...over,
});

describe("TeamRoundtable self-hide pins (byte-identical when inputs absent)", () => {
  it("renders nothing with no teamReview at all", () => {
    expect(renderToStaticMarkup(<TeamRoundtable e={recordWith(undefined)} />)).toBe("");
  });

  it("renders nothing when the team had no voices", () => {
    expect(renderToStaticMarkup(<TeamRoundtable e={recordWith(baseReview({ voices: [] }))} />)).toBe("");
  });

  it("omits the agreement line when it self-hid (single opinion / no agreement field)", () => {
    const html = renderToStaticMarkup(<TeamRoundtable e={recordWith(baseReview({ agreement: undefined }))} />);
    expect(html).not.toContain("teammates agreed");
    expect(html).not.toContain("Worth a look");
  });

  it("omits the devil's advocate line when nobody argued against", () => {
    const html = renderToStaticMarkup(<TeamRoundtable e={recordWith(baseReview({ devilsAdvocate: undefined }))} />);
    expect(html).not.toContain("The skeptic&#x27;s take");
  });

  it("omits the falsifier line when there is no proof plan", () => {
    const html = renderToStaticMarkup(<TeamRoundtable e={recordWith(baseReview({ falsifier: undefined }))} />);
    expect(html).not.toContain("What would prove this wrong");
  });
});

describe("TeamRoundtable renders the deliberation lines (P5)", () => {
  const full = baseReview({
    agreement: "2 of 3 teammates agreed on this. The odd one out (Live Google results) worried about how hard this search is to win.",
    devilsAdvocate: "The skeptic's take: You already rank in the top 10, this is an edit, not a new page.",
    falsifier: "What would prove this wrong: if clicks do not rise within 4 weeks, this was the wrong call and I will retract it.",
    objections: [{ label: "Live Google results", reason: "This search looks hard to win right now", severity: "downgrade", detail: "marketplace search results dominate" }],
  });
  const html = renderToStaticMarkup(<TeamRoundtable e={recordWith(full)} />);

  it("shows the agreement score line with the odd one out's worry", () => {
    expect(html).toContain("2 of 3 teammates agreed on this.");
    expect(html).toContain("The odd one out (Live Google results) worried about how hard this search is to win.");
  });

  it("shows the devil's advocate counter-argument", () => {
    expect(html).toContain("The skeptic&#x27;s take: You already rank in the top 10, this is an edit, not a new page.");
  });

  it("shows the falsifiable auto-retract commitment", () => {
    expect(html).toContain("What would prove this wrong: if clicks do not rise within 4 weeks, this was the wrong call and I will retract it.");
  });

  it("never renders an em or en dash", () => {
    expect(/[–—]/.test(html)).toBe(false);
  });
});

describe("TeamRoundtable quorum gate (item 163)", () => {
  const lone = baseReview({
    worthALook: true,
    agreement: undefined,
    voices: [{ specialist: "gsc", label: "Search demand", claim: "Real search demand for this topic.", confidencePct: 45 }],
    consensusPct: 45,
  });
  const html = renderToStaticMarkup(<TeamRoundtable e={recordWith(lone)} />);

  it("shows the 'Worth a look' chip and the lead-not-a-sure-thing line for a lone weak pick", () => {
    expect(html).toContain("Worth a look");
    expect(html).toContain("Only one teammate had the data to weigh in here, so treat this as a lead to check, not a sure thing.");
  });

  it("a corroborated Move (worthALook falsey) shows no 'Worth a look' chip", () => {
    const corroborated = baseReview({ worthALook: undefined, agreement: "All 2 teammates who could weigh in agreed on this." });
    const cHtml = renderToStaticMarkup(<TeamRoundtable e={recordWith(corroborated)} />);
    expect(cHtml).not.toContain("Worth a look");
    expect(cHtml).toContain("All 2 teammates who could weigh in agreed on this.");
  });
});
