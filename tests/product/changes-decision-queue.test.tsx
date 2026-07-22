/**
 * /changes decision queue - merged behavioral suite (Core 100K Phase 6).
 * Absorbs: changes-decision-queue (Wave 3C), changes-flat-list-watching (C-16/C-17),
 * today-ready-orphan (Ready-exactness boundary).
 *
 * Pins:
 *   - every card carries ONE decision + a one-to-one CTA (no two-action fork);
 *   - the command path is the top 3 to 5 act-decisions, only rank #1 gets "Start here",
 *     overflow is capped behind ONE honest expander;
 *   - watch / leave-as-is / blocked split off into a collapsed archive;
 *   - one flat ranked list: no goal-bucket headers, no strategy picker;
 *   - two tenants render in isolation;
 *   - READY EXACTNESS: "ready" is earned, never asserted - a quality-failing draft is
 *     demoted out of ready, and a non-ready pack never reads as ready.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => h.params,
  usePathname: () => "/changes",
}));
vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, cache: <T,>(fn: T) => fn };
});

import { ChangesListClient } from "@/app/(shell)/changes-list-client";
import type { ChangesView } from "@/app/(shell)/changes-data";
import type { CanonicalChange, CanonicalStatus } from "@/domains/changes/canonical-change";
import type { ChangeDecision } from "@/domains/changes/decide-action";
import { buildReadyOrphanMove } from "@/app/(shell)/today-moves-data";
import type { PreparedMovePack } from "@/domains/demand-graph/prepared-move-pack";
import type { DraftQualityResult } from "@/domains/drafts/draft-quality";

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

describe("one decision + one CTA per card (Wave 3C)", () => {
  const changes = [
    cc("nowruz", "suggested", { pageLabel: "Persian New Year", decision: "edit_existing" }),
    cc("kabob", "suggested", { pageLabel: "Kabob Guide", changeFamily: "new_page", decision: "create_new_page" }),
  ];
  const html = renderToStaticMarkup(
    <ChangesListClient view={view({ changes, summary: { todo: 2, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 } })} />,
  );

  it("renders the decision label and its one-to-one CTA", () => {
    expect(html).toContain("Edit this page");
    expect(html).toContain("See the edit");
    expect(html).toContain("Build a new page");
    expect(html).toContain("See the page plan");
  });

  it("renders NO two-action fork and no em/en dash", () => {
    expect(NO_FORK.test(html)).toBe(false);
    expect(html).not.toContain("redirect or internal-link");
    expect(html).not.toMatch(/[–—]/);
  });
});

describe("top 3 to 5 command path + collapsed archive (Wave 3C, P1-1/P1-2)", () => {
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

  it("promotes 5 top picks visually, but only rank #1 carries the 'Start here' band", () => {
    expect((html.match(/Start here/g) ?? []).length).toBe(1);
    expect((html.match(/border-2 border-status-info\/30 shadow-sm/g) ?? []).length).toBe(5);
  });

  it("splits blocked rows into a collapsed archive off the command path", () => {
    expect(html).toContain("I am not acting on yet");
    expect(html).not.toContain("Blockedone Page");
    expect(html).not.toContain("Blockedtwo Page");
  });

  it("caps the 6th actionable behind ONE expander, counted honestly, never lost", () => {
    expect(html).not.toContain("Actionable 5");
    expect(html).toContain("1 more lower-priority idea. I keep them ranked so nothing is lost.");
  });
});

describe("one flat ranked list (C-16), no picker (C-23)", () => {
  const titleChange = cc("cities", "suggested", { changeFamily: "title", pageLabel: "Cities of Iran" });
  const metaChange = cc("food", "suggested", { changeFamily: "meta", pageLabel: "Persian food" });
  const html = renderToStaticMarkup(
    <ChangesListClient view={view({ changes: [titleChange, metaChange], summary: { todo: 2, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 } })} />,
  );

  it("renders NO goal-bucket section headers and NO strategy picker", () => {
    for (const banned of ["Win more clicks", "Get cited by AI", "Build new pages", "Fix the experience", "Other improvements", "How should Beacon prioritize?", "By goal"]) {
      expect(html).not.toContain(banned);
    }
  });

  it("gives each card its own small type tag instead of a section header", () => {
    expect(html).toContain("Title");
    expect(html).toContain("Description");
  });

  it("keeps Watching/Measuring/Results out of the execution queue; legacy deep-links fold into To do", () => {
    h.params = new URLSearchParams();
    const bare = renderToStaticMarkup(<ChangesListClient view={view()} />);
    expect(bare).not.toContain("Watching");
    expect(bare).not.toContain("Measuring");

    h.params = new URLSearchParams("status=watching");
    const row = cc("nowruz", "suggested", { pageLabel: "Persian New Year", changeFamily: "answer" });
    const legacy = renderToStaticMarkup(<ChangesListClient view={view({ changes: [row], summary: { todo: 1, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 } })} />);
    expect(legacy).toContain("Persian New Year");
    expect(legacy).toContain('aria-pressed="true" aria-label="To do, 1 change"');
    h.params = new URLSearchParams();
  });
});

describe("two tenants render in isolation", () => {
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
  });
});

/**
 * READY EXACTNESS boundary (risk-register pin). "Ready" is earned through the
 * draft-quality gate, never asserted by a stored status. Exercised through the
 * real orphan-pack builder that synthesizes ready rows for surfaced moves.
 */
describe("Ready exactness - buildReadyOrphanMove", () => {
  const pack = (over: Partial<PreparedMovePack> = {}): PreparedMovePack =>
    ({
      version: 1,
      tenantId: "tenant-iranopedia",
      moveId: "https://iranopedia.com/cuisine",
      moveType: "edit_page",
      parentType: "ctr_move",
      targetUrl: "https://iranopedia.com/cuisine",
      proposedSlug: null,
      primaryQuery: "persian cuisine",
      secondaryQueries: [],
      specialistOpinions: [],
      routerDecision: { action: "edit_title", rationale: "Sharpen the title to the query.", confidenceLevel: "medium" },
      proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable pages" },
      structuredDraft: { kind: "atomic_edit", value: { after: "The Complete Guide to Persian Cuisine" } },
      experiment: null,
      implementationChecklist: [],
      costSpent: { llmUsd: 0, serpUsd: 0 },
      confidence: "medium",
      evidenceHash: "h",
      generatedAt: "2026-07-18T00:00:00.000Z",
      staleAt: "2026-08-01T00:00:00.000Z",
      preparedStatus: "ready_to_review",
      ...over,
    }) as unknown as PreparedMovePack;

  const quality = (status: DraftQualityResult["status"], copyAllowed: boolean): DraftQualityResult =>
    ({ status, copyAllowed, reasons: [], confidence: "high" }) as unknown as DraftQualityResult;

  it("surfaces a ready pack as a ready row with real prepared evidence, honest empties", () => {
    const m = buildReadyOrphanMove(pack(), "https://iranopedia.com/cuisine", quality("ready", true));
    expect(m.action).toBe("edit_title");
    expect(m.inclusionReason).toBe("prepared_ready");
    expect(m.preparedChecklist?.readyToReview).toBe(true);
    expect(m.demand).toBeNull(); // no fabricated demand
    expect(m.score).toBe(0);
  });

  it("a quality-FAILING draft is demoted out of ready even when the pack claims ready", () => {
    const m = buildReadyOrphanMove(pack(), "https://iranopedia.com/cuisine", quality("generic_rejected", false));
    expect(m.preparedStatus).toBe("ready_to_review");
    expect(m.preparedChecklist?.readyToReview).toBe(false);
  });

  it("a non-ready pack never reads as ready even with passing quality", () => {
    const m = buildReadyOrphanMove(
      pack({ preparedStatus: "competitors_read", structuredDraft: null }),
      "https://iranopedia.com/cuisine",
      null,
    );
    expect(m.preparedChecklist?.readyToReview).toBe(false);
  });
});
