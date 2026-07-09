/**
 * ChangesListClient - operator spec 2026-07-09 W2 render pins (C-16 flat list, C-17 Watching tab).
 *
 * Pins the two structural decisions from the interview: the list renders as ONE flat,
 * opportunity-ranked list with NO goal-bucket section headers and NO strategy picker (each card
 * carries its own small type tag instead), and there is a last, lower-priority "Watching" tab
 * that surfaces the evidence-hold items with the honest hold sentence. Rendered as a pure
 * server-side string via `renderToStaticMarkup` (Node-only, no DOM) - same posture as
 * changes-list-client-measuring-badge.test.tsx.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// A mutable search-params holder so a test can open the client on the Watching tab (?status=watching).
const h = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => h.params,
  usePathname: () => "/changes",
}));

import { ChangesListClient } from "@/app/(shell)/changes-list-client";
import type { ChangesView } from "@/app/(shell)/changes-data";
import type { CanonicalChange, CanonicalStatus } from "@/domains/changes/canonical-change";
import { WATCHING_SENTENCE } from "@/domains/recommendations/abstention";

function cc(id: string, status: CanonicalStatus, over: Partial<CanonicalChange> = {}): CanonicalChange {
  return {
    id,
    tenantId: "t",
    pagePath: `/${id}`,
    pageUrl: `https://s.com/${id}`,
    pageLabel: id,
    opportunityType: "Capture clicks",
    changeType: "edit_meta",
    changeFamily: "meta",
    status,
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
    sourceIds: [],
    alternateOpportunities: [],
    ...over,
  } as CanonicalChange;
}

function view(over: Partial<ChangesView> = {}): ChangesView {
  return {
    changes: [],
    movesById: {},
    summary: { todo: 0, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 },
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
    ...over,
  } as ChangesView;
}

describe("ChangesListClient - C-16 one flat list, no bucket headers, no picker", () => {
  const titleChange = cc("cities", "suggested", { changeFamily: "title", pageLabel: "Cities of Iran" });
  const metaChange = cc("food", "suggested", { changeFamily: "meta", pageLabel: "Persian food" });
  const html = renderToStaticMarkup(
    <ChangesListClient view={view({ changes: [titleChange, metaChange], summary: { todo: 2, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 } })} />,
  );

  it("renders NO goal-bucket section headers", () => {
    // operator spec 2026-07-09 C-16 - the four bucket titles are gone; one flat ranked list remains.
    expect(html).not.toContain("Win more clicks");
    expect(html).not.toContain("Get cited by AI");
    expect(html).not.toContain("Build new pages");
    expect(html).not.toContain("Fix the experience");
    expect(html).not.toContain("Other improvements");
  });

  it("renders NO strategy picker", () => {
    // operator spec 2026-07-09 C-23 - the mode toggle is gone.
    expect(html).not.toContain("How should Beacon prioritize?");
    expect(html).not.toContain("Best opportunities");
    expect(html).not.toContain("Fastest growth");
    expect(html).not.toContain("Safest bets");
    expect(html).not.toContain("By goal");
  });

  it("gives each card its own small type tag instead of a section header", () => {
    // operator spec 2026-07-09 C-16 - the FAMILY_CHIP tag reads inline per card.
    expect(html).toContain("Title");
    expect(html).toContain("Description");
  });
});

describe("ChangesListClient - C-17 Watching tab", () => {
  it("renders a Watching tab in the tab bar", () => {
    h.params = new URLSearchParams();
    const html = renderToStaticMarkup(<ChangesListClient view={view()} />);
    expect(html).toContain("Watching");
  });

  it("on the Watching tab, shows each held item's label + the honest hold sentence", () => {
    h.params = new URLSearchParams("status=watching");
    const held = cc("nowruz", "suggested", { pageLabel: "Persian New Year", changeFamily: "answer" });
    const html = renderToStaticMarkup(<ChangesListClient view={view({ watching: [held] })} />);
    expect(html).toContain("Persian New Year");
    expect(html).toContain(WATCHING_SENTENCE);
  });

  it("on the Watching tab with nothing held, shows the honest empty line (never a bare zero)", () => {
    h.params = new URLSearchParams("status=watching");
    const html = renderToStaticMarkup(<ChangesListClient view={view({ watching: [] })} />);
    expect(html).toContain("Nothing is waiting for more evidence right now.");
  });
});
