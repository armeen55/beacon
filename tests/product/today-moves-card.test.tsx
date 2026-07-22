/**
 * MoveCard behavior pins - trimmed suite (Core 100K Phase 6, from the 2026-07-07
 * trust-fix batch + Wave 4 G3/G9). Rendered for real via renderToStaticMarkup.
 *
 * Pins:
 *   #17 a mid-measurement page never shows both the amber hold and the green
 *       "worth doing" line (the contradiction kill);
 *   #7/#8 no vendor jargon leaks (SERP / DataForSEO / raw format slugs);
 *   G3 winners panel renders real evidence only, honest absence otherwise;
 *   G9 "What else I considered" renders the router's rejected alternatives in
 *       plain words, never raw action keys, honest absence otherwise.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MoveCard } from "@/app/(shell)/today-moves-card";
import type { TodayMove } from "@/app/(shell)/today-moves-data";

const BANNED_DASH = /[‒–—―]/;

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

describe("#17 - measuring page never shows both the amber hold and the green line", () => {
  it("suppresses the non-held (success) winnability line while mid-measurement", () => {
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
          winnabilityLine: "The top results are marketplaces I cannot outrank, so I am holding this.",
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

  it("renders no 'SERP' or 'DataForSEO' anywhere on the card", () => {
    expect(html).not.toContain("SERP");
    expect(html).not.toContain("DataForSEO");
  });

  it("labels sources and research lines in plain language", () => {
    expect(html).toContain("Live Google check");
    expect(html).toContain("What Google is rewarding:");
    expect(html).not.toContain("SERP rewards:");
  });

  it("maps the raw format slug to plain words and drops the vendor parenthetical", () => {
    expect(html).toContain("a comparison table");
    expect(html).not.toContain(">table:");
    expect(html).toContain("searches/mo");
    expect(html).not.toContain("(DataForSEO)");
  });

  it("emits no banned dash", () => {
    expect(BANNED_DASH.test(html)).toBe(false);
  });
});

describe("G3 - winners panel renders real evidence only", () => {
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

  it("renders the deduped winner list: domain, plain why, cached date, overlap badge, honest unread line", () => {
    const html = renderToStaticMarkup(
      <MoveCard rank={1} m={makeMove({ winners: [overlapWinner, aiOnlyWinner] })} />,
    );
    expect(html).toContain("Who wins this topic now");
    expect(html).toContain("theknot.com");
    expect(html).toContain("Google AND AI pick this one");
    expect(html).toContain("read Jul 10");
    expect(html).toContain("AI cites this page");
    // Never fabricate a "why" for a winner Beacon has not audited yet.
    expect(html).toContain("I have not read this page yet");
    expect(html).not.toContain("SERP");
    expect(BANNED_DASH.test(html)).toBe(false);
  });

  it("renders no winners panel at all when the move has no competitor/Google evidence", () => {
    for (const winners of [null, [], undefined]) {
      const html = renderToStaticMarkup(<MoveCard rank={1} m={makeMove({ winners } as Partial<TodayMove>)} />);
      expect(html).not.toContain("Who wins this topic now");
    }
  });
});

describe("G3 - honest absence for 'Your gap' when no comparison has run", () => {
  it("shows the honest absence line + refresh CTA when there is no teardown at all", () => {
    const html = renderToStaticMarkup(<MoveCard rank={1} m={makeMove({ whatWins: null, yourGap: "" })} />);
    expect(html).toContain("I have not compared this page against the winners yet.");
    expect(html).toContain("Compare against the winners");
  });

  it("shows the real gap line, not the absence line, when a gap was found", () => {
    const html = renderToStaticMarkup(
      <MoveCard rank={1} m={makeMove({ whatWins: "FAQ schema", yourGap: "No FAQ section" })} />,
    );
    expect(html).toContain("No FAQ section");
    expect(html).not.toContain("I have not compared this page against the winners yet.");
  });
});

describe("G9 - 'What else I considered' renders plain alternatives, never raw keys", () => {
  it("renders rejected alternatives + dissent line from a fixture pack, no raw MoveRouterAction key", () => {
    const html = renderToStaticMarkup(
      <MoveCard
        rank={1}
        m={makeMove({
          whatElseIConsidered: {
            alternatives: [
              "A new page instead: rejected. You already rank - improve the page, don't make a new one.",
              "A title change instead: rejected. This move would answer the wrong question.",
            ],
            dissentLine: "The AI citations disagreed: AI cites 3 competitor pages for this topic, never you.",
          },
        })}
      />,
    );
    expect(html).toContain("What else I considered");
    expect(html).toContain("A title change instead: rejected. This move would answer the wrong question.");
    expect(html).toContain("The AI citations disagreed: AI cites 3 competitor pages for this topic, never you.");
    expect(html).not.toContain("create_page");
    expect(html).not.toContain("change_title_meta");
    expect(BANNED_DASH.test(html)).toBe(false);
  });

  it("honest absence: renders no panel when the move has no stored alternatives reasoning", () => {
    for (const pack of [undefined, null, { alternatives: [], dissentLine: null }]) {
      const html = renderToStaticMarkup(
        <MoveCard rank={1} m={makeMove({ whatElseIConsidered: pack } as Partial<TodayMove>)} />,
      );
      expect(html).not.toContain("What else I considered");
    }
  });
});
