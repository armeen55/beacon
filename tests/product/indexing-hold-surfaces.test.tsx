/**
 * #310 / Constitution §6 — indexing-safety hold posture, all live accept
 * surfaces in ONE behavioral test.
 *
 * CONSOLIDATED (2026-07-21) from three sibling files that each looped the
 * full directive set against one surface:
 *   changes-list-client-indexing-hold.test.tsx
 *   today-moves-card-indexing-hold.test.tsx
 *   changes-v2-card-indexing-hold.test.tsx
 *
 * A crawl/index directive (robots.txt edit, meta noindex removal, canonical
 * tag, redirect/status) can DEINDEX a live site if applied with a wrong
 * value, so a wrong value must never be one tap away. The split of duty:
 *   - The full directive-type set is pinned ONCE on the shared guard
 *     (isIndexingDirectiveActionType) — the single source of truth every
 *     surface imports (enforced by tests/architecture/
 *     18-destructive-indexability-hold.test.ts as a source-level scan).
 *   - Each LIVE surface keeps one representative hold rendering + one
 *     benign control, proving the guard is actually wired to the
 *     surface's one-tap affordance. Never drop a surface block without
 *     dropping the surface itself.
 *
 * Live surfaces: ChangesListClient (/changes), MoveCard (Today),
 * ChangesV2Card (/results via ResultsTimeline). Type-driven, never
 * copy-driven. SSR via renderToStaticMarkup against the real exports.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => h.params,
  usePathname: () => "/changes",
}));

import { ChangesListClient } from "@/app/(shell)/changes-list-client";
import type { ChangesView } from "@/app/(shell)/changes-data";
import type { CanonicalChange, CanonicalStatus } from "@/domains/changes/canonical-change";
import { MoveCard } from "@/app/(shell)/today-moves-card";
import type { TodayMove } from "@/app/(shell)/today-moves-data";
import {
  ChangesV2Card,
  type ChangesV2CardRow,
} from "@/components/changes/v2/changes-v2-card";
import {
  INDEXING_DIRECTIVE_CAVEAT,
  isIndexingDirectiveActionType,
  type ActionType,
} from "@/domains/recommendations/action-types";
import type { ProofPill } from "@/domains/changes/proof-timeline/result-pill";

const INDEXING = ["fix_noindex", "fix_robots", "fix_canonical", "fix_status_code"] as const;
const BENIGN = ["add_faq", "add_answer_block", "edit_title", "add_schema"] as const;

// ── The guard itself: full type set pinned once ─────────────────────────────

describe("#310 — isIndexingDirectiveActionType covers every crawl/index directive", () => {
  it("holds all four indexing directive types", () => {
    for (const t of INDEXING) {
      expect(isIndexingDirectiveActionType(t)).toBe(true);
    }
  });

  it("never holds benign on-page content types", () => {
    for (const t of BENIGN) {
      expect(isIndexingDirectiveActionType(t)).toBe(false);
    }
  });
});

// ── Surface 1: ChangesListClient (/changes dense inbox list) ────────────────
// The list row must render the plain-English hold notice and suppress the
// multi-select checkbox (the feeder for the bulk "Mark done" one-tap accept);
// its own CTA stays the review route.

function cc(id: string, status: CanonicalStatus, over: Partial<CanonicalChange> = {}): CanonicalChange {
  return {
    id,
    tenantId: "t",
    pagePath: `/${id}`,
    pageUrl: `https://s.com/${id}`,
    pageLabel: id,
    opportunityType: "Fix indexing",
    changeType: "fix_noindex",
    changeFamily: "other",
    status,
    // Force an act-decision so the row lands in the actionable top picks (and is
    // rendered by default), not the collapsed "watching" archive.
    decision: "edit_existing",
    recommendation: `Fix ${id}`,
    exactInstructions: null,
    before: null,
    after: null,
    rationale: "why",
    estimatedEffortMinutes: 2,
    impactScore: 10,
    upside: 20,
    expectedOutcome: "usually adds 10 to 30 clicks a month",
    riskLevel: "low",
    evidenceStrength: "directional",
    measurementMethod: "diff-in-diff",
    selectedForToday: false,
    activeExperiment: false,
    protectedControl: false,
    blockedReason: null,
    result: null,
    measurementHeadline: null,
    measurementDetail: null,
    nextCheckpoint: null,
    attributionLimited: false,
    sourceIds: ["m1"],
    alternateOpportunities: [],
    ...over,
  } as CanonicalChange;
}

function listView(action: string): ChangesView {
  const change = cc("homepage", "suggested", { pageLabel: "Homepage" });
  return {
    changes: [change],
    movesById: {
      m1: {
        id: "m1",
        action,
        query: "remove the noindex tag",
        targetUrl: "https://s.com/homepage",
        why: "blocked from Google",
        rankWhy: "highest demand you do not own",
        demand: null,
        demandBasis: null,
      },
    },
    summary: { todo: 1, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 },
    hasPlan: false,
    planAccepted: false,
    readyZeroHint: null,
    measuringCountCanonical: 0,
    decidedCountCanonical: 0,
    suppressedRowsNote: null,
    expiredSubline: null,
    receiptLine: null,
    readyCount: 0,
    shippedThisWeekCount: 0,
    watching: [],
  } as unknown as ChangesView;
}

function renderList(action: string): string {
  h.params = new URLSearchParams();
  return renderToStaticMarkup(<ChangesListClient view={listView(action)} />);
}

describe("#310 — Changes list holds an indexing directive, never one-tap accept", () => {
  it("fix_noindex: renders the hold notice and suppresses the select checkbox", () => {
    const html = renderList("fix_noindex");
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
    expect(html).toContain('data-change-row-indexing-hold="true"');
    // The multi-select checkbox (the feeder for the bulk one-tap accept) is gone.
    expect(html).not.toContain('aria-label="Select Homepage"');
  });

  it("CONTROL add_faq: keeps the select checkbox and shows no hold notice", () => {
    const html = renderList("add_faq");
    expect(html).not.toContain(INDEXING_DIRECTIVE_CAVEAT);
    expect(html).not.toContain('data-change-row-indexing-hold="true"');
    expect(html).toContain('aria-label="Select Homepage"');
  });
});

// ── Surface 2: MoveCard (Today, interactive §7 card) ────────────────────────
// The card must show the hold notice and suppress every one-tap accept/apply
// affordance ("Stage in Wix" / "Ship it" / "I did it myself" / "Ship anyway"),
// leaving the review route ("Open in queue") as the only path.

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
  } as unknown as TodayMove;
}

function renderMoveCard(action: string): string {
  return renderToStaticMarkup(<MoveCard m={makeMove(action)} rank={1} />);
}

describe("#310 — MoveCard holds an indexing directive for review, never one-tap", () => {
  it("fix_robots: renders the hold notice and suppresses every one-tap accept affordance", () => {
    const html = renderMoveCard("fix_robots");
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

  it("CONTROL add_answer_block: keeps the one-tap Ship affordance and shows no hold notice", () => {
    const html = renderMoveCard("add_answer_block");
    expect(html).not.toContain(INDEXING_DIRECTIVE_CAVEAT);
    expect(html).not.toContain('data-move-indexing-hold="true"');
    // The one-tap Ship affordance is offered for a benign move.
    expect(html).toContain("Ship it");
  });
});

// ── Surface 3: ChangesV2Card (/results proof timeline) ──────────────────────
// An `accepted`-linked edit is the ONLY state that offers the one-tap
// "I made this change" live-confirm affordance. An indexing directive must
// SUPPRESS even that and route to the change's review surface instead.

const PILL: ProofPill = {
  kind: "live",
  label: "Live",
  tone: "info",
  blurb: "This change is live on your site.",
};

function makeRow(editActionType: ActionType | null): ChangesV2CardRow {
  return {
    id: "change-1",
    title: "Remove the noindex tag from the Homepage",
    targetUrl: "https://example.com/",
    shippedAt: "2026-05-04T00:00:00Z",
    pill: PILL,
    patternTimingNarrative: null,
    editActionType,
  };
}

function renderCard(row: ChangesV2CardRow): string {
  return renderToStaticMarkup(
    <ChangesV2Card
      row={row}
      markShipped={{
        canMarkShipped: true,
        pending: false,
        feedback: null,
        onMarkShipped: () => {},
      }}
    />,
  );
}

describe("#310 — Changes card holds an indexing directive, never one-tap live-confirm", () => {
  it("fix_canonical: renders the caveat and suppresses the one-tap live-confirm affordance", () => {
    const html = renderCard(makeRow("fix_canonical"));
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
    expect(html).toContain("data-changes-card-indexing-caveat");
    // The one-tap "I made this change" button must NOT render for an
    // indexing directive, even though the linked edit is `accepted`.
    expect(html).not.toContain('data-changes-card-mark-shipped="true"');
    // The review route ("Open change") stays available so the owner is
    // routed to the confirm surface.
    expect(html).toContain('data-changes-card-cta="open-change"');
  });

  it("CONTROL: a benign accepted change DOES render the one-tap live-confirm affordance", () => {
    const html = renderCard(makeRow("add_faq"));
    expect(html).toContain('data-changes-card-mark-shipped="true"');
    expect(html).not.toContain(INDEXING_DIRECTIVE_CAVEAT);
  });

  it("CONTROL: a change with no editActionType keeps its one-tap affordance", () => {
    const html = renderCard(makeRow(null));
    expect(html).toContain('data-changes-card-mark-shipped="true"');
    expect(html).not.toContain("data-changes-card-indexing-caveat");
  });
});
