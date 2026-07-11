/**
 * compute-scoreboard (2026-07-02, master plan item 38).
 *
 * Pins the settle-join (ledger -> plan pick -> teamReview), the SAME eligibility gate
 * load-experiment-outcomes.ts uses (mature + unquarantined only), and the full-recompute write.
 * Mocks every I/O edge (ledger, plans, changepoints, the store) so the join logic is pinned without
 * a real Supabase/file round-trip - the store's own round-trip is pinned separately.
 */
import { beforeEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";
// Fail-closed calibration quarantine (2026-07-11): records default to CALIBRATED
// (factory default), so the existing cases pin that a calibrated verdict still
// scores specialist reliability exactly as before. The uncalibrated block pins
// the quarantine (no votes, fresh-tenant defaults).
beforeAll(registerTestCalibratedVersion);
afterAll(clearTestCalibratedVersions);

let ledger: Array<Record<string, unknown>> = [];
vi.mock("@/domains/proof-gsc/shipped-change-store", () => ({
  loadShippedChanges: async () => ledger,
}));

let plans: Array<Record<string, unknown>> = [];
vi.mock("@/domains/experiments/daily-experiment-plan-store", () => ({
  listPlans: async () => plans,
}));

vi.mock("@/domains/proof-gsc/algorithm-weather-store", () => ({
  loadDetectedChangepoints: async () => [],
}));

let writes: Array<Record<string, unknown>> = [];
vi.mock("./team-scoreboard-store", () => ({
  writeTeamScoreboard: async (snapshot: Record<string, unknown>) => {
    writes.push(snapshot);
  },
  loadTeamScoreboard: async () => null,
}));

import {
  buildTeamScoreboardSummary,
  findPlanPickForProofId,
  votesFromTeamReview,
  convictionObservationsFromTeamReview,
  objectionObservationsFromTeamReview,
} from "./compute-scoreboard";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { DailyExperimentPlanRecord, PlannedExperimentRecord } from "@/domains/experiments/daily-plan-types";
import type { TeamReview } from "@/domains/experiments/team-review";

const NOW = new Date("2026-07-02T12:00:00.000Z");

// Ship date fixed to 2026-04-15 so the 28-day window (2026-04-15 -> 2026-05-13) falls cleanly
// between the real confirmed Google update windows baked into algorithm-weather.ts (the March
// 27-April 8 core update and the May 21-June 2 core update) - a settled fixture here must not
// accidentally get weather-quarantined by REAL calendar data.
function win28(over: Partial<ShippedChangeRecord["windows"][number]> = {}): ShippedChangeRecord["windows"][number] {
  return {
    day: 28,
    checkOn: "2026-05-13",
    ran: true,
    treatedDelta: 40,
    controlDelta: 5,
    adjustedLift: 35,
    treatedCtrDelta: 0.03,
    controlCtrDelta: 0.002,
    adjustedCtrLift: 0.028,
    treatedPosDelta: 1,
    controlPosDelta: 0,
    adjustedPosLift: 1,
    controlsUsed: 3,
    ...over,
  };
}

function record(over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "p1::2026-04-15",
    page: "https://iranopedia.com/singers",
    path: "/singers",
    actionType: "edit_title",
    before: "old",
    after: "new",
    shippedAt: "2026-04-15T00:00:00.000Z",
    baseline: { clicks: 100, impressions: 3000, ctr: 0.03, position: 10, windowDays: 28 },
    targetQueries: ["iranian singers"],
    controlPages: ["https://iranopedia.com/actors", "https://iranopedia.com/comedians"],
    windows: [win28()],
    verdict: "won",
    confidence: "high",
    measuredAt: "2026-05-13T00:00:00.000Z",
    notes: null,
    verifiedLive: true,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null, calibrationVersion: TEST_CALIBRATED_VERSION,
    createdAt: "2026-04-15T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...over,
  };
}

const REVIEW: TeamReview = {
  verdict: "Biggest opportunity the team sees on this page: a sharper title and description.",
  headline: "2 specialists weighed in, no objections",
  consensusPct: 80,
  voices: [
    { specialist: "gsc", label: "Search demand", claim: "This search gets real volume", confidencePct: 90 },
    { specialist: "dataforseo", label: "Live Google results", claim: "You can win this search", confidencePct: 70 },
  ],
  objections: [],
};

function pick(over: Partial<PlannedExperimentRecord> = {}): PlannedExperimentRecord {
  return {
    id: "plan1::/singers",
    candidateId: "c1",
    url: "https://iranopedia.com/singers",
    canonicalUrl: "https://iranopedia.com/singers",
    pageLabel: "Singers",
    pageFamily: "people",
    lever: "title",
    targetQuery: "iranian singers",
    whyNow: "real demand",
    currentText: "old",
    proposedText: "new",
    placement: "title",
    leaveUnchanged: [],
    rollbackText: "old",
    effortMinutes: 2,
    risk: "low",
    controls: [],
    influencedUrls: [],
    evidenceHash: "h1",
    currentTextHash: "h2",
    eligibilityHash: "h3",
    detail: { kind: "edit_field", field: "title" },
    teamReview: REVIEW,
    ...over,
  } as PlannedExperimentRecord;
}

function plan(over: Partial<DailyExperimentPlanRecord> = {}): DailyExperimentPlanRecord {
  return {
    version: 1,
    id: "plan1",
    tenantId: "iranopedia",
    date: "2026-05-19",
    status: "completed",
    createdAt: "2026-05-19T00:00:00.000Z",
    expiresAt: "2026-05-20T00:00:00.000Z",
    activeExperimentSnapshot: { proofIds: [], treatedUrls: [], controlUrls: [], influencedUrls: [], capturedAt: "2026-05-19T00:00:00.000Z" },
    selected: [pick()],
    backups: [],
    distribution: { byLever: {}, byPageFamily: {} },
    estimatedMinutes: 2,
    execution: {
      items: { "plan1::/singers": { experimentId: "plan1::/singers", status: "gsc_submitted", proofId: "p1::2026-04-15" } },
      updatedAt: "2026-05-20T00:00:00.000Z",
    },
    ...over,
  } as DailyExperimentPlanRecord;
}

beforeEach(() => {
  ledger = [];
  plans = [];
  writes = [];
});

describe("findPlanPickForProofId", () => {
  it("joins a proof id to the plan pick that activated into it", () => {
    const found = findPlanPickForProofId([plan()], "p1::2026-04-15");
    expect(found?.id).toBe("plan1::/singers");
    expect(found?.teamReview).toBe(REVIEW);
  });

  it("returns null when no plan recorded this proofId (old/manual ledger row)", () => {
    expect(findPlanPickForProofId([plan()], "some-other-id")).toBeNull();
    expect(findPlanPickForProofId([], "p1::2026-04-15")).toBeNull();
  });
});

describe("votesFromTeamReview", () => {
  it("emits one supporting vote per voice, probability = conviction / 100", () => {
    const votes = votesFromTeamReview(REVIEW, "title", 1);
    expect(votes).toHaveLength(2);
    expect(votes.find((v) => v.specialist === "gsc")?.probability).toBeCloseTo(0.9);
    expect(votes.find((v) => v.specialist === "dataforseo")?.probability).toBeCloseTo(0.7);
    expect(votes.every((v) => v.outcome === 1)).toBe(true);
    expect(votes.every((v) => v.actionFamily === "title")).toBe(true);
  });

  it("emits a dissenting vote for an objecting specialist, keyed by its plain label", () => {
    const review: TeamReview = {
      ...REVIEW,
      voices: [{ specialist: "gsc", label: "Search demand", claim: "demand exists", confidencePct: 90 }],
      objections: [{ label: "Visitor behavior", reason: "Fix the page experience first", severity: "veto", detail: "high bounce" }],
    };
    const votes = votesFromTeamReview(review, "title", 0);
    expect(votes).toHaveLength(2);
    const dissent = votes.find((v) => v.specialist === "Visitor behavior");
    expect(dissent?.probability).toBeCloseTo(0.2); // veto -> 1 - 0.8
    expect(dissent?.outcome).toBe(0);
  });

  it("a specialist that both supports and objects is scored once via its supporting claim", () => {
    const review: TeamReview = {
      ...REVIEW,
      voices: [{ specialist: "gsc", label: "Search demand", claim: "demand exists", confidencePct: 85 }],
      objections: [{ label: "Search demand", reason: "already ranks", severity: "downgrade", detail: "x" }],
    };
    const votes = votesFromTeamReview(review, "title", 1);
    expect(votes).toHaveLength(1);
    expect(votes[0]!.probability).toBeCloseTo(0.85);
  });
});

describe("convictionObservationsFromTeamReview (item 43)", () => {
  it("emits one observation per supporting voice, carrying the RAW conviction (not a probability)", () => {
    const observations = convictionObservationsFromTeamReview(REVIEW, 1);
    expect(observations).toHaveLength(2);
    expect(observations.find((o) => o.specialist === "gsc")?.conviction).toBe(90);
    expect(observations.find((o) => o.specialist === "dataforseo")?.conviction).toBe(70);
    expect(observations.every((o) => o.outcome === 1)).toBe(true);
  });

  it("dissenting-only voices are never included (an objection carries no stated conviction)", () => {
    const review: TeamReview = {
      ...REVIEW,
      voices: [],
      objections: [{ label: "Visitor behavior", reason: "concern", severity: "veto", detail: "x" }],
    };
    expect(convictionObservationsFromTeamReview(review, 0)).toEqual([]);
  });
});

describe("objectionObservationsFromTeamReview (item 43)", () => {
  it("emits one observation per objector, keyed by the plain label", () => {
    const review: TeamReview = {
      ...REVIEW,
      objections: [
        { label: "Visitor behavior", reason: "high bounce", severity: "veto", detail: "x" },
        { label: "Revenue", reason: "no conversion signal", severity: "downgrade", detail: "y" },
      ],
    };
    const observations = objectionObservationsFromTeamReview(review, 0);
    expect(observations).toHaveLength(2);
    expect(observations.find((o) => o.objectorLabel === "Visitor behavior")?.severity).toBe("veto");
    expect(observations.every((o) => o.outcome === 0)).toBe(true);
  });

  it("no objections on the review yields no observations", () => {
    expect(objectionObservationsFromTeamReview(REVIEW, 1)).toEqual([]);
  });
});

describe("buildTeamScoreboardSummary - eligibility gate (mirrors load-experiment-outcomes.ts)", () => {
  it("a mature won record joins and produces votes", async () => {
    ledger = [record()];
    plans = [plan()];
    const summary = await buildTeamScoreboardSummary("iranopedia", NOW);
    expect(summary.totalSettled).toBe(1);
    expect(summary.settledJoined).toBe(1);
    const gsc = summary.rows.find((r) => r.specialist === "gsc");
    expect(gsc?.overall.n).toBe(1);
    expect(gsc?.overall.won).toBe(1);
  });

  it("fail-closed quarantine (2026-07-11): an UNCALIBRATED mature won carries NO vote (fresh-tenant defaults)", async () => {
    ledger = [record({ calibrationVersion: null })]; // otherwise a clean mature win joined to a plan
    plans = [plan()];
    const summary = await buildTeamScoreboardSummary("iranopedia", NOW);
    expect(summary.totalSettled).toBe(0);
    expect(summary.settledJoined).toBe(0);
    expect(summary.rows).toEqual([]);
  });

  it("an early (7-day only) checkpoint never counts as settled, even if verdict says won", async () => {
    ledger = [record({ windows: [win28({ day: 7, ran: true, checkOn: "2026-04-22", controlsUsed: 3 })], verdict: "won" })];
    plans = [plan()];
    const summary = await buildTeamScoreboardSummary("iranopedia", NOW);
    expect(summary.totalSettled).toBe(0);
    expect(summary.rows).toEqual([]);
  });

  it("insufficient controls/baseline at day 28 reads inconclusive, not settled", async () => {
    ledger = [record({ windows: [win28({ controlsUsed: 0 })] })];
    plans = [plan()];
    const summary = await buildTeamScoreboardSummary("iranopedia", NOW);
    expect(summary.totalSettled).toBe(0);
  });

  it("a settled record with no plan/teamReview behind it is counted settled but not joined", async () => {
    ledger = [record()];
    plans = []; // no plan recorded this ship
    const summary = await buildTeamScoreboardSummary("iranopedia", NOW);
    expect(summary.totalSettled).toBe(1);
    expect(summary.settledJoined).toBe(0);
    expect(summary.rows).toEqual([]);
  });

  it("a lost verdict joins too and scores the supporting voices as a loss", async () => {
    ledger = [record({ verdict: "lost" })];
    plans = [plan()];
    const summary = await buildTeamScoreboardSummary("iranopedia", NOW);
    const gsc = summary.rows.find((r) => r.specialist === "gsc");
    expect(gsc?.overall.lost).toBe(1);
    expect(gsc?.overall.won).toBe(0);
  });

  it("groups the settled vote under the ledger row's own actionFamily (edit_title -> title)", async () => {
    ledger = [record({ actionType: "edit_title" })];
    plans = [plan()];
    const summary = await buildTeamScoreboardSummary("iranopedia", NOW);
    const gsc = summary.rows.find((r) => r.specialist === "gsc");
    expect(Object.keys(gsc?.byFamily ?? {})).toEqual(["title"]);
  });
});

describe("buildTeamScoreboardSummary - accountability layer wiring (item 43)", () => {
  it("persists per-specialist calibration bands from settled supporting votes", async () => {
    ledger = [record()];
    plans = [plan()];
    await buildTeamScoreboardSummary("iranopedia", NOW);
    const gsc = (writes[0]!.specialists as Array<Record<string, unknown>>).find((s) => s.specialist === "gsc")!;
    expect(gsc.calibration_bands).toBeDefined();
    const bands = gsc.calibration_bands as Array<{ band: string; n: number; won: number }>;
    expect(bands.map((b) => b.band)).toEqual(["60-70", "70-80", "80-90", "90+"]);
    // REVIEW's gsc voice argues at 90 confidencePct on a won record -> lands in the 90+ band.
    const band90 = bands.find((b) => b.band === "90+")!;
    expect(band90.n).toBe(1);
    expect(band90.won).toBe(1);
  });

  it("persists the tenant-wide objection track record when a pick ships over an objection", async () => {
    const objectingReview: TeamReview = {
      ...REVIEW,
      voices: [{ specialist: "gsc", label: "Search demand", claim: "demand exists", confidencePct: 90 }],
      objections: [{ label: "Visitor behavior", reason: "high bounce risk", severity: "downgrade", detail: "x" }],
    };
    ledger = [record({ verdict: "lost" })]; // the objector's concern held up: pick shipped and lost
    plans = [plan({ selected: [pick({ teamReview: objectingReview })] })];
    await buildTeamScoreboardSummary("iranopedia", NOW);
    const objections = writes[0]!.objections as Array<{ objectorLabel: string; objected: number; right: number; wrong: number }>;
    expect(objections).toHaveLength(1);
    expect(objections[0]).toEqual({ objectorLabel: "Visitor behavior", objected: 1, right: 1, wrong: 0 });
  });

  it("an objection on a pick that WON anyway is scored wrong", async () => {
    const objectingReview: TeamReview = {
      ...REVIEW,
      voices: [{ specialist: "gsc", label: "Search demand", claim: "demand exists", confidencePct: 90 }],
      objections: [{ label: "Visitor behavior", reason: "high bounce risk", severity: "downgrade", detail: "x" }],
    };
    ledger = [record({ verdict: "won" })]; // shipped over the objection and won -> the objection was wrong
    plans = [plan({ selected: [pick({ teamReview: objectingReview })] })];
    await buildTeamScoreboardSummary("iranopedia", NOW);
    const objections = writes[0]!.objections as Array<{ objectorLabel: string; objected: number; right: number; wrong: number }>;
    expect(objections[0]).toEqual({ objectorLabel: "Visitor behavior", objected: 1, right: 0, wrong: 1 });
  });

  it("no objections anywhere in history persists an empty (not undefined) objections array", async () => {
    ledger = [record()];
    plans = [plan()];
    await buildTeamScoreboardSummary("iranopedia", NOW);
    expect(writes[0]!.objections).toEqual([]);
  });
});

describe("buildTeamScoreboardSummary - idempotent recompute", () => {
  it("recomputing twice from the same ledger/plans yields byte-identical scoreboard rows", async () => {
    ledger = [record()];
    plans = [plan()];
    const first = await buildTeamScoreboardSummary("iranopedia", NOW);
    const second = await buildTeamScoreboardSummary("iranopedia", NOW);
    expect(JSON.stringify(second.rows)).toBe(JSON.stringify(first.rows));
    expect(second.settledJoined).toBe(first.settledJoined);
    expect(second.totalSettled).toBe(first.totalSettled);
  });

  it("persists a full snapshot via writeTeamScoreboard on every call", async () => {
    ledger = [record()];
    plans = [plan()];
    await buildTeamScoreboardSummary("iranopedia", NOW);
    await buildTeamScoreboardSummary("iranopedia", NOW);
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(writes[1]);
  });
});

describe("buildTeamScoreboardSummary - fail-soft", () => {
  it("a ledger read failure yields an empty scoreboard, never throws", async () => {
    const mod = await import("@/domains/proof-gsc/shipped-change-store");
    const spy = vi.spyOn(mod, "loadShippedChanges").mockRejectedValueOnce(new Error("down"));
    const summary = await buildTeamScoreboardSummary("iranopedia", NOW);
    expect(summary.rows).toEqual([]);
    expect(summary.totalSettled).toBe(0);
    spy.mockRestore();
  });
});
