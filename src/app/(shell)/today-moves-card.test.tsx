/**
 * today-moves-card.test.tsx (2026-07-07) - render pins for three trust fixes on
 * the interactive §7 MoveCard (renderToStaticMarkup, repo convention, no jsdom):
 *
 *   #17 (contradiction): a page mid-measurement must NOT render both the amber
 *        "wait, do not ship" banner AND the green "worth doing" winnability line.
 *        The non-held (success) line is suppressed while measuring; the amber
 *        held line, which agrees with "wait", still shows.
 *   #8  ("Live SERP" jargon): the source chip must read plain language ("Live
 *        Google check"), never the banned vendor acronym "SERP".
 *   #7  ("SERP rewards:" + raw slug + "(DataForSEO)"): the research line must use
 *        plain wording, map the raw format slug to plain words, and never leak
 *        "SERP" or "DataForSEO".
 *
 * Guard, not decoration: the whole card is rendered and asserted so the surface
 * a paying customer reads is what these tests protect (Beacon voice, no vendor
 * jargon, dash-free).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MoveCard } from "./today-moves-card";
import type { TodayMove } from "./today-moves-data";

const BANNED_DASH = /[‒–—―]/; // figure, en, em, horizontal bar

/** A minimal but type-complete TodayMove. Overrides tailor each scenario. */
function makeMove(overrides: Partial<TodayMove> = {}): TodayMove {
  return {
    id: "rec-1",
    action: "add_answer_block",
    actionLabel: "Win the AI citation",
    actionTone: "citation",
    query: "best persian restaurants",
    targetUrl: "https://example.com/persian-restaurants",
    pageLabel: "Persian Restaurants",
    why: "AI cites a rival here and you have the stronger page.",
    proof: "",
    confidence: "high",
    demand: null,
    demandBasis: null,
    whoCited: null,
    whatWins: null,
    competitorSteal: null,
    yourGap: "",
    topQueries: [],
    declines: [],
    cannibalization: [],
    ga4: null,
    friction: null,
    looselyMatched: false,
    also: [],
    outline: [],
    answerBrief: null,
    draftTitle: null,
    draftMeta: null,
    faqs: [],
    schema: [],
    titleVariants: [],
    rankWhy: "highest demand you do not own",
    score: 1,
    savedAnswerBlock: null,
    savedFaqJsonLd: null,
    specialists: [],
    debate: { headline: "", voices: [], objections: [] },
    routerAction: null,
    routerRationale: null,
    routerConfidence: null,
    preparedStatus: null,
    preparedChecklist: null,
    preparedDraftKind: null,
    preparedDraftText: null,
    preparedExperiment: null,
    preparedStale: false,
    preparedQuality: null,
    learnedTag: null,
    ...overrides,
  } as TodayMove;
}

describe("#17 - measuring page never shows both the amber hold and green 'worth doing' line", () => {
  it("suppresses the non-held (success) winnability line while the page is mid-measurement", () => {
    const html = renderToStaticMarkup(
      <MoveCard
        rank={1}
        m={makeMove({
          pageMeasuring: true,
          winnabilityHeld: false,
          winnabilityLine:
            "The top Google results here are real content you can beat, so this is worth doing.",
        })}
      />,
    );
    // The amber mid-measurement banner is present (agrees with "wait").
    expect(html).toContain("This page is mid-measurement");
    // The contradicting green "worth doing" line is gone.
    expect(html).not.toContain("worth doing");
  });

  it("suppresses it too when the SAME family is already measuring", () => {
    const html = renderToStaticMarkup(
      <MoveCard
        rank={1}
        m={makeMove({
          alreadyMeasuring: true,
          winnabilityHeld: false,
          winnabilityLine:
            "The top Google results here are real content you can beat, so this is worth doing.",
        })}
      />,
    );
    expect(html).toContain("This page is mid-measurement");
    expect(html).not.toContain("worth doing");
  });

  it("still shows the amber HELD line while measuring (it agrees with 'wait')", () => {
    const html = renderToStaticMarkup(
      <MoveCard
        rank={1}
        m={makeMove({
          pageMeasuring: true,
          winnabilityHeld: true,
          winnabilityLine:
            "The top results are marketplaces I cannot outrank, so I am holding this.",
        })}
      />,
    );
    expect(html).toContain("so I am holding this");
  });

  it("shows the green 'worth doing' line normally when NOT measuring", () => {
    const html = renderToStaticMarkup(
      <MoveCard
        rank={1}
        m={makeMove({
          winnabilityHeld: false,
          winnabilityLine:
            "The top Google results here are real content you can beat, so this is worth doing.",
        })}
      />,
    );
    expect(html).toContain("worth doing");
    expect(html).not.toContain("This page is mid-measurement");
  });
});

describe("#8 / #7 - no vendor jargon leaks from the card", () => {
  const html = renderToStaticMarkup(
    <MoveCard
      rank={1}
      m={makeMove({
        sourceChips: ["gsc", "dataforseo", "profound"],
        researchPack: {
          primaryIntent: "restaurants",
          addressableVolume: 4200,
          serpPattern: {
            format: "table",
            titlePattern: "comparison / ranked titles",
            elementImplication: "add a comparison table near the top",
            winningDomains: ["yelp.com", "tripadvisor.com"],
          },
          own: ["best persian restaurants"],
          sibling: [],
          primaryLever: null,
          blockedLevers: [],
          elements: [],
          onPagePlan: null,
        },
      })}
    />,
  );

  it("renders no 'SERP' anywhere on the card", () => {
    expect(html).not.toContain("SERP");
  });

  it("renders no 'DataForSEO' anywhere on the card", () => {
    expect(html).not.toContain("DataForSEO");
  });

  it("labels the dataforseo source chip in plain language", () => {
    expect(html).toContain("Live Google check");
    expect(html).not.toContain("Live SERP");
  });

  it("uses plain wording for the research reward line", () => {
    expect(html).toContain("What Google is rewarding:");
    expect(html).not.toContain("SERP rewards:");
  });

  it("maps the raw format slug to plain words (never the bare slug)", () => {
    expect(html).toContain("a comparison table");
    // The bare slug "table:" must not be rendered as a label prefix.
    expect(html).not.toContain(">table:");
  });

  it("drops the vendor parenthetical from the addressable-demand line", () => {
    expect(html).toContain("searches/mo");
    expect(html).not.toContain("(DataForSEO)");
  });

  it("emits no banned dash", () => {
    expect(BANNED_DASH.test(html)).toBe(false);
  });
});

describe("plain-word mapping covers every SERP format slug", () => {
  const slugs: Array<[string, string]> = [
    ["table", "a comparison table"],
    ["list", "a scannable list"],
    ["ugc", "real user answers"],
    ["faq", "an FAQ"],
    ["guide", "a step-by-step guide"],
    ["product", "a product or shop page"],
    ["mixed", "a clear answer plus structured sections"],
  ];
  it.each(slugs)("maps '%s' to plain words", (slug, plain) => {
    const html = renderToStaticMarkup(
      <MoveCard
        rank={1}
        m={makeMove({
          researchPack: {
            primaryIntent: "x",
            addressableVolume: null,
            serpPattern: {
              format: slug,
              titlePattern: "t",
              elementImplication: "do the thing",
              winningDomains: [],
            },
            own: ["best persian restaurants"],
            sibling: [],
            primaryLever: null,
            blockedLevers: [],
            elements: [],
            onPagePlan: null,
          },
        })}
      />,
    );
    expect(html).toContain(plain);
    expect(html).not.toContain("SERP");
  });
});

describe("G3 (Wave 4) - winners panel: 'Who wins this topic now'", () => {
  const overlapWinner = {
    domain: "theknot.com",
    overlap: true,
    sources: ["ai", "google"] as ("ai" | "google")[],
    whyPlain: "a direct answer at the top, an FAQ section (4 questions), updated recently",
    collectedLabel: "read Jul 10",
  };
  const aiOnlyWinner = {
    domain: "aionly.com",
    overlap: false,
    sources: ["ai"] as ("ai" | "google")[],
    whyPlain: null,
    collectedLabel: null,
  };
  const googleOnlyWinner = {
    domain: "googleonly.com",
    overlap: false,
    sources: ["google"] as ("ai" | "google")[],
    whyPlain: null,
    collectedLabel: null,
  };

  it("renders the deduped winner list from a fixture evidence pack: domain, plain-word why, cached date, and the overlap badge", () => {
    const html = renderToStaticMarkup(
      <MoveCard rank={1} m={makeMove({ winners: [overlapWinner, aiOnlyWinner, googleOnlyWinner] })} />,
    );
    expect(html).toContain("Who wins this topic now");
    expect(html).toContain("theknot.com");
    expect(html).toContain("Google AND AI pick this one");
    expect(html).toContain("a direct answer at the top, an FAQ section (4 questions), updated recently");
    expect(html).toContain("read Jul 10");
    expect(html).toContain("aionly.com");
    expect(html).toContain("AI cites this page");
    expect(html).toContain("googleonly.com");
    expect(html).toContain("Ranks in Google results");
    // Never fabricate a "why" for a winner Beacon has not audited yet.
    expect(html).toContain("I have not read this page yet");
    // Never leak lab/vendor jargon.
    expect(html).not.toContain("SERP");
  });

  it("caps at 5 winners even when more are supplied", () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      domain: `rival${i}.com`,
      overlap: false,
      sources: ["ai"] as ("ai" | "google")[],
      whyPlain: null,
      collectedLabel: null,
    }));
    const html = renderToStaticMarkup(<MoveCard rank={1} m={makeMove({ winners: seven })} />);
    for (let i = 0; i < 5; i++) expect(html).toContain(`rival${i}.com`);
    for (let i = 5; i < 7; i++) expect(html).not.toContain(`rival${i}.com`);
  });

  it("renders no winners panel at all when the move has no competitor/Google evidence", () => {
    const htmlNull = renderToStaticMarkup(<MoveCard rank={1} m={makeMove({ winners: null })} />);
    expect(htmlNull).not.toContain("Who wins this topic now");
    const htmlEmpty = renderToStaticMarkup(<MoveCard rank={1} m={makeMove({ winners: [] })} />);
    expect(htmlEmpty).not.toContain("Who wins this topic now");
    const htmlUndefined = renderToStaticMarkup(<MoveCard rank={1} m={makeMove({})} />);
    expect(htmlUndefined).not.toContain("Who wins this topic now");
  });

  it("emits no banned dash in the winners panel copy", () => {
    const html = renderToStaticMarkup(
      <MoveCard rank={1} m={makeMove({ winners: [overlapWinner, aiOnlyWinner, googleOnlyWinner] })} />,
    );
    expect(BANNED_DASH.test(html)).toBe(false);
  });
});

describe("G3 (Wave 4) - honest absence for 'Your gap' when no comparison has run", () => {
  it("shows the honest absence line + the existing refresh CTA when there is no teardown at all (whatWins null, yourGap empty)", () => {
    const html = renderToStaticMarkup(
      <MoveCard rank={1} m={makeMove({ whatWins: null, yourGap: "" })} />,
    );
    expect(html).toContain("I have not compared this page against the winners yet.");
    expect(html).toContain("Compare against the winners");
  });

  it("stays silent (no fabricated absence line) when a teardown ran and simply found nothing notable", () => {
    const html = renderToStaticMarkup(
      <MoveCard rank={1} m={makeMove({ whatWins: "FAQ schema", yourGap: "" })} />,
    );
    expect(html).not.toContain("I have not compared this page against the winners yet.");
  });

  it("still shows the real gap line, not the absence line, when a gap was actually found", () => {
    const html = renderToStaticMarkup(
      <MoveCard rank={1} m={makeMove({ whatWins: "FAQ schema", yourGap: "No FAQ section" })} />,
    );
    expect(html).toContain("No FAQ section");
    expect(html).not.toContain("I have not compared this page against the winners yet.");
  });
});
