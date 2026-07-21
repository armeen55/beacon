/**
 * Wave 3B (2026-07-10; Phase 4D surgery 2026-07-21) - Today is MISSION CONTROL. This suite pins
 * the stripped-down spine and the contradiction kills that give the operator ONE command in
 * under five seconds:
 *
 *   - slot 1 (CircuitBreaker + the investigation conclusion) is self-hiding, never a hard banner
 *   - the redundant ops-pipeline banner is gone; its defect signal feeds the ONE command instead
 *   - slot 2 (the ONE command) is always rendered, and the killed lead cards are gone
 *   - the whole "More on today" drawer and every war-room band are removed
 *   - the "No action is required" reassurance is OWNED by the observe command, suppressed on the
 *     greeting brief for every other kind
 *   - the 7-day clicks number renders ONCE on Today (the header bar dropped its duplicate)
 *
 * Full-page render is infeasible here (the route is an async server component with many bounded
 * loaders), so the structural kills are pinned as source invariants - the same convention the rest
 * of the Today architecture suite uses (see measuring-count-single-source, today-action-card-copy).
 * The behavioral suppression is pinned through buildTodayView directly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { buildTodayView } from "@/domains/changes/today-view";
import type { CanonicalChange } from "@/domains/changes/canonical-change";

const ROOT = resolve(__dirname, "../../..");
const PAGE = readFileSync(join(ROOT, "src/app/(shell)/page.tsx"), "utf8");
const TODAY_VIEW = readFileSync(join(ROOT, "src/domains/changes/today-view.ts"), "utf8");
const COCKPIT_BAR = readFileSync(join(ROOT, "src/components/shell/cockpit-bar.tsx"), "utf8");

function change(overrides: Partial<CanonicalChange> = {}): CanonicalChange {
  return {
    id: "tenant-a::/nowruz::title",
    tenantId: "tenant-a",
    pagePath: "/nowruz",
    pageUrl: "https://example.com/nowruz",
    pageLabel: "/nowruz",
    opportunityType: "title",
    changeType: "edit_title",
    changeFamily: "title",
    status: "measuring",
    recommendation: "Rewrite the title.",
    exactInstructions: null,
    before: null,
    after: null,
    rationale: "",
    estimatedEffortMinutes: 5,
    impactScore: 10,
    upside: null,
    expectedOutcome: null,
    riskLevel: "low",
    evidenceStrength: "directional",
    measurementMethod: "diff",
    selectedForToday: false,
    activeExperiment: true,
    protectedControl: false,
    blockedReason: null,
    result: null,
    measurementHeadline: "Collecting data",
    measurementDetail: null,
    nextCheckpoint: "2026-07-18",
    attributionLimited: false,
    sourceIds: [],
    alternateOpportunities: [],
    ...overrides,
  };
}

describe("Today stripped-spine structure (source invariants)", () => {
  it("slot 2: the ONE command card is always rendered (not behind a condition)", () => {
    expect(PAGE).toContain("<TodayCommandCard command={command} />");
  });

  it("the whole 'More on today' drawer is removed", () => {
    expect(PAGE).not.toContain('data-more-on-today="true"');
    expect(PAGE).not.toMatch(/<details\b/);
    expect(PAGE).not.toContain("<summary");
  });

  it("slot 1: the truth warnings are self-hiding (Suspense fallback null), never a hard banner", () => {
    expect(PAGE).toContain("<Suspense fallback={null}><CircuitBreakerSection /></Suspense>");
    expect(PAGE).toContain("<Suspense fallback={null}><InvestigationAlertLine tenantId={tenantId} /></Suspense>");
  });

  it("the redundant ops-pipeline banner is gone (its defect signal feeds the command)", () => {
    // the banner is neither imported nor mounted (a comment may still name it)
    expect(PAGE).not.toContain("<OpsPipelineSection");
    expect(PAGE).not.toContain('from "./ops-pipeline-section"');
    // the command still consumes the same inputs the banner used to
    expect(PAGE).toContain("deriveDefectSignal");
  });

  it("the war-room bands and the north-star line are removed from Today", () => {
    expect(PAGE).not.toContain("FrictionFixesSection");
    expect(PAGE).not.toContain("DemandOpportunitiesSection");
    expect(PAGE).not.toContain("WarRoomQuietLine");
    expect(PAGE).not.toContain("TodayNewPagesSummaryLine");
    expect(PAGE).not.toContain("MonthlyNorthStar");
    expect(PAGE).not.toContain("AutonomousResearchStatus");
    expect(PAGE).not.toContain("DataSourcesStrip");
  });

  it("the subsumed lead cards and the opportunities list are KILLED from Today", () => {
    expect(PAGE).not.toContain("TodaySmokeAlarmCard");
    expect(PAGE).not.toContain("TodayLeadHeadlineCard");
    expect(PAGE).not.toContain("CumulativeOutcomeSection");
    expect(PAGE).not.toContain("<OpportunitiesSection");
    expect(PAGE).not.toContain("function OpportunitiesSection");
    expect(PAGE).not.toContain("<MeasuringSection");
    expect(PAGE).not.toContain("<AttentionSection");
  });
});

describe('the "No action is required" reassurance is owned by the observe command', () => {
  it("the greeting brief (today-view headerSentence) never says it, on any kind", () => {
    // FP3 - the canonical ledger pair is threaded in (never re-derived from status).
    // FP3 - counts no longer exposes the raw ledger measuring number (2026-07-20); the
    // sentence still derives off the SAME canonical ledgerCounts.measuring internally.
    const view = buildTodayView({ changes: [change()], strategy: "balanced", plan: null, ledgerCounts: { measuring: 1, decided: 0 } });
    expect(view.counts.readyToday).toBe(0);
    expect(view.headerSentence).not.toContain("No action is required");
    expect(view.headerSentence).toBe("Your recent changes are collecting data.");
  });

  it("the phrase is fully removed from the Today read model and page", () => {
    expect(TODAY_VIEW).not.toContain("No action is required");
    expect(PAGE).not.toContain("No action is required");
  });
});

describe("the 731 / -14% duplicate is killed (one render on Today)", () => {
  it("the header cockpit bar no longer renders the 7-day clicks number or the delta", () => {
    // The delta/number formatters it used are gone, and no clicks-per-7d label remains.
    expect(COCKPIT_BAR).not.toContain("clicks/7d");
    expect(COCKPIT_BAR).not.toContain("formatDeltaPct");
    expect(COCKPIT_BAR).not.toContain("formatMetricCompact");
    // The at-a-glance freshness dot stays (a stale connection is still visible everywhere).
    expect(COCKPIT_BAR).toContain("Search data");
  });

  it("the scoreboard section remains the single owner of last7Clicks + deltaPct", () => {
    const SCOREBOARD = readFileSync(join(ROOT, "src/app/(shell)/scoreboard-section.tsx"), "utf8");
    expect(SCOREBOARD).toContain("s.last7Clicks");
    expect(SCOREBOARD).toContain("s.deltaPct");
  });
});
