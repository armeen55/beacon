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
