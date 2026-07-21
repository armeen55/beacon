/**
 * #310 — indexing-safety hold posture on the LIVE Changes list one-tap accept.
 *
 * Sibling of changes-v2-card-indexing-hold.test.tsx, for the dense inbox list.
 * A crawl/index directive (robots.txt edit, meta noindex removal, canonical
 * tag, redirect/status) can DEINDEX a live site if applied with a wrong value,
 * so the list row must
 *   1. render the plain-English hold notice, and
 *   2. NEVER expose the one-tap accept path: the multi-select checkbox is
 *      suppressed (so the row can never feed the bulk "Mark done" one-tap
 *      accept), and the row's own "See the edit" CTA stays the review route.
 * Benign on-page content changes keep their checkbox and carry no notice.
 *
 * SSR via renderToStaticMarkup against the real exported <ChangesListClient>,
 * same posture as changes-flat-list-watching.test.tsx. Type-driven, never
 * copy-driven: the linked move's raw `action` drives the hold.
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
import { INDEXING_DIRECTIVE_CAVEAT } from "@/domains/recommendations/action-types";

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

function view(action: string): ChangesView {
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

function render(action: string): string {
  h.params = new URLSearchParams();
  return renderToStaticMarkup(<ChangesListClient view={view(action)} />);
}

const INDEXING = ["fix_noindex", "fix_robots", "fix_canonical", "fix_status_code"] as const;
const CONTROL = ["add_faq", "edit_title"] as const;

describe("#310 — Changes list holds an indexing directive, never one-tap accept", () => {
  for (const action of INDEXING) {
    it(`${action}: renders the hold notice and suppresses the select checkbox`, () => {
      const html = render(action);
      expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
      expect(html).toContain('data-change-row-indexing-hold="true"');
      // The multi-select checkbox (the feeder for the bulk one-tap accept) is gone.
      expect(html).not.toContain('aria-label="Select Homepage"');
    });
  }

  for (const action of CONTROL) {
    it(`CONTROL ${action}: keeps the select checkbox and shows no hold notice`, () => {
      const html = render(action);
      expect(html).not.toContain(INDEXING_DIRECTIVE_CAVEAT);
      expect(html).not.toContain('data-change-row-indexing-hold="true"');
      expect(html).toContain('aria-label="Select Homepage"');
    });
  }
});
