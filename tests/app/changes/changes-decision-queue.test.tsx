/**
 * ChangesListClient - Wave 3C decision queue render pins.
 *
 * Rendered as a pure server-side string via renderToStaticMarkup (this repo's convention - no
 * jsdom/@testing-library configured), same posture as changes-flat-list-watching.test.tsx.
 *
 * Pins:
 *   - every card carries ONE decision + a one-to-one CTA (no two-action " or " fork in the copy);
 *   - the command path is the top 3 to 5 act-decisions (Start here), the rest capped;
 *   - watch / leave-as-is / blocked are split OFF the command path into a collapsed archive;
 *   - two tenants render in isolation.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/changes",
}));

import { ChangesListClient } from "@/app/(shell)/changes-list-client";
import type { ChangesView } from "@/app/(shell)/changes-data";
import type { CanonicalChange, CanonicalStatus } from "@/domains/changes/canonical-change";
import type { ChangeDecision } from "@/domains/changes/decide-action";

function cc(id: string, status: CanonicalStatus, over: Partial<CanonicalChange> = {}): CanonicalChange {
  return {
    id, tenantId: "t", pagePath: `/${id}`, pageUrl: `https://s.com/${id}`, pageLabel: id,
    opportunityType: "Capture clicks", changeType: "edit_meta", changeFamily: "meta", status,
    recommendation: `Rewrite the title on ${id}`, exactInstructions: null, before: null, after: null,
    rationale: "This page has real demand and a cheap fix.", estimatedEffortMinutes: 2, impactScore: 100,
    upside: 20, expectedOutcome: "usually adds 10 to 30 clicks a month", riskLevel: "low",
    evidenceStrength: "strong", measurementMethod: "diff-in-diff", selectedForToday: false,
    activeExperiment: false, protectedControl: false, blockedReason: null, result: null,
    measurementHeadline: null, measurementDetail: null, nextCheckpoint: null, attributionLimited: false,
    decision: "edit_existing", sourceIds: [], alternateOpportunities: [], ...over,
  } as CanonicalChange;
}

function view(over: Partial<ChangesView> = {}): ChangesView {
  return {
    changes: [], movesById: {},
    summary: { todo: 0, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 },
    hasPlan: false, planAccepted: false, readyZeroHint: null, measuringCountCanonical: 0,
    decidedCountCanonical: 0, suppressedRowsNote: null, expiredSubline: null, receiptLine: null,
    readyCount: 0, shippedThisWeekCount: 0, watching: [],
    ...over,
  } as ChangesView;
}

const NO_FORK = /\b(redirect|edit|create|merge|link|differentiate|update|fold|consolidate|build)\s+or\s+(a|an|the|internal|redirect|update|differentiate|link|edit|create|build|merge)\b/i;

describe("ChangesListClient - Wave 3C one decision + one CTA per card", () => {
  const changes = [
    cc("nowruz", "suggested", { pageLabel: "Persian New Year", decision: "edit_existing" }),
    cc("kabob", "suggested", { pageLabel: "Kabob Guide", changeFamily: "new_page", decision: "create_new_page" }),
  ];
  const html = renderToStaticMarkup(
    <ChangesListClient view={view({ changes, summary: { todo: 2, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 } })} />,
  );

  it("renders the decision label and its one-to-one CTA (no bare 'See draft')", () => {
    expect(html).toContain("Edit this page");
    expect(html).toContain("See the edit");
    expect(html).toContain("Build a new page");
    expect(html).toContain("See the page plan");
  });

  it("renders NO two-action fork anywhere in the card copy", () => {
    expect(NO_FORK.test(html)).toBe(false);
    expect(html).not.toContain("redirect or internal-link");
    expect(html).not.toContain("or differentiate");
  });

  it("emits no em or en dash", () => {
    expect(html).not.toMatch(/[–—]/);
  });
});

describe("ChangesListClient - Wave 3C top 3 to 5 command path + archive split", () => {
  // Six strong act-decisions (the command path) + two blocked rows (the archive, off the path).
  const actionable = Array.from({ length: 6 }, (_, i) =>
    cc(`act${i}`, "suggested", { pageLabel: `Actionable ${i}`, evidenceStrength: "strong", decision: "edit_existing", impactScore: 100 - i }),
  );
  const archived = [
    cc("blockedone", "blocked", { pageLabel: "Blockedone Page", blockedReason: "mid-measurement", decision: "do_nothing" }),
    cc("blockedtwo", "blocked", { pageLabel: "Blockedtwo Page", blockedReason: "control page", decision: "do_nothing" }),
  ];
  const html = renderToStaticMarkup(
    <ChangesListClient
      view={view({ changes: [...actionable, ...archived], summary: { todo: 8, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 } })}
    />,
  );

  it("promotes at most 5 top picks (Start here), never all of them", () => {
    const starts = (html.match(/Start here/g) ?? []).length;
    expect(starts).toBe(5);
  });

  it("splits watch / leave-as-is / blocked into a collapsed archive off the command path", () => {
    expect(html).toContain("I am not acting on yet");
    // The blocked rows are behind the collapsed archive, so their labels are NOT in the default markup.
    expect(html).not.toContain("Blockedone Page");
    expect(html).not.toContain("Blockedtwo Page");
  });

  it("keeps the command path honest - the 6th actionable is still on the list (capped, not lost)", () => {
    expect(html).toContain("Actionable 5");
  });
});

describe("ChangesListClient - Wave 3C two tenants render in isolation", () => {
  function tenantHtml(tenantId: string, label: string, decision: ChangeDecision) {
    const change = cc(`${tenantId}-row`, "suggested", { tenantId, pageLabel: label, decision });
    return renderToStaticMarkup(
      <ChangesListClient view={view({ changes: [change], summary: { todo: 1, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 } })} />,
    );
  }
  it("each tenant's board shows only its own page and its own decision", () => {
    const a = tenantHtml("iranopedia", "Cities Of Iran", "edit_existing");
    const b = tenantHtml("ritz", "Bay Area Builder", "create_new_page");
    expect(a).toContain("Cities Of Iran");
    expect(a).not.toContain("Bay Area Builder");
    expect(b).toContain("Bay Area Builder");
    expect(b).not.toContain("Cities Of Iran");
    expect(a).toContain("Edit this page");
    expect(b).toContain("Build a new page");
  });
});
