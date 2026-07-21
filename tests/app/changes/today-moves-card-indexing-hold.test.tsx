/**
 * #310 — indexing-safety hold posture on the interactive §7 MoveCard.
 *
 * Sibling of changes-v2-card-indexing-hold.test.tsx, for the LIVE one-tap
 * accept surface. A crawl/index directive (robots.txt edit, meta noindex
 * removal, canonical tag, redirect/status) can DEINDEX a live site if applied
 * with a wrong value, so the MoveCard must
 *   1. show the plain-English hold notice before the owner can act, and
 *   2. NEVER offer a one-tap accept/apply affordance for it — the card
 *      SUPPRESSES "Stage in Wix" / "Ship it" / "I did it myself" / "Ship anyway"
 *      and leaves the review route ("Open in queue") as the only path.
 * Benign on-page content moves (FAQ / answer block / title) keep their normal
 * one-tap Ship affordance and carry no notice.
 *
 * SSR via renderToStaticMarkup against the real exported <MoveCard>. Type-driven,
 * never copy-driven: the raw `m.action` drives the hold.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MoveCard } from "@/app/(shell)/today-moves-card";
import type { TodayMove } from "@/app/(shell)/today-moves-data";
import { INDEXING_DIRECTIVE_CAVEAT } from "@/domains/recommendations/action-types";

/** A minimal but type-complete TodayMove. `action` tailors each scenario. */
function makeMove(action: string): TodayMove {
  return {
    id: "rec-1",
    action,
    actionLabel: "Fix indexing",
    actionTone: "page",
    query: "remove the noindex tag from the homepage",
    targetUrl: "https://example.com/",
    pageLabel: "Homepage",
    why: "This page is blocked from Google and should not be.",
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
    // Armed so the "Stage in Wix" one-tap affordance WOULD appear for a benign
    // move — the test proves an indexing directive suppresses it anyway.
    staging: { enabled: true, nudge: false },
  } as unknown as TodayMove;
}

function render(action: string): string {
  return renderToStaticMarkup(<MoveCard m={makeMove(action)} rank={1} />);
}

const INDEXING = ["fix_noindex", "fix_robots", "fix_canonical", "fix_status_code"] as const;
const CONTROL = ["add_faq", "add_answer_block"] as const;

describe("#310 — MoveCard holds an indexing directive for review, never one-tap", () => {
  for (const action of INDEXING) {
    it(`${action}: renders the hold notice and suppresses every one-tap accept affordance`, () => {
      const html = render(action);
      // The plain-English hold notice renders.
      expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
      expect(html).toContain('data-move-indexing-hold="true"');
      // None of the one-tap accept/apply affordances render.
      expect(html).not.toContain("Stage in Wix");
      expect(html).not.toContain("Ship it");
      expect(html).not.toContain("I did it myself");
      expect(html).not.toContain("Ship anyway");
      // The review route stays the only path forward.
      expect(html).toContain("Open in queue");
    });
  }

  for (const action of CONTROL) {
    it(`CONTROL ${action}: keeps the one-tap Ship affordance and shows no hold notice`, () => {
      const html = render(action);
      expect(html).not.toContain(INDEXING_DIRECTIVE_CAVEAT);
      expect(html).not.toContain('data-move-indexing-hold="true"');
      // The armed one-tap accept affordance is offered for a benign move.
      expect(html).toContain("Stage in Wix");
    });
  }
});
