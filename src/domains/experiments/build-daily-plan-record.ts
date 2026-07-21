/**
 * build-daily-plan-record (2026-06-30) - PURE. Freezes a planner output (selected + backup
 * BuiltCandidates) + the active-experiment topology into a reproducible DailyExperimentPlanRecord.
 * No I/O, no side effects, no reservations (preview only). The frozen hashes let acceptance detect a
 * candidate whose page text / evidence / eligibility changed since planning.
 */

import type { BuiltCandidate } from "./build-daily-candidates";
import { buildPickExpectations } from "./pick-expectations";
import { blendCaptureBand, type FamilyCaptureBand } from "./empirical-capture";
import { canonicalMoveType } from "@/domains/learning/experiment-prior";
import {
  stableHash, normalizePath, type DailyExperimentPlanRecord, type PlannedExperimentRecord,
  type ProposedControlRecord, type ExperimentLever, type ExcludedPickRecord,
} from "./daily-plan-types";

export const PLANNER_VERSION = "safe-levers-v3"; // meta + internal-link + answer-block
// A preview must survive a normal operating day (plan in the morning, apply through the evening) -
// 30 min meant a plan was dead before the operator returned to it. Acceptance ALSO re-validates the
// control topology fresh at accept time, so a longer window doesn't weaken measurement; and a stale
// plan auto-refreshes on Accept (see acceptDailyExperimentPlanAction) rather than dead-ending.
const DEFAULT_EXPIRY_MIN = 24 * 60;

function controlRecord(c: BuiltCandidate["suggestedControls"][number]): ProposedControlRecord {
  return {
    controlUrl: c.url, controlPath: normalizePath(c.url), score: c.score,
    pageFamilyMatch: c.pageFamilyMatch, impressionsRatio: c.impressionsRatio,
    positionDifference: c.positionDifference, why: c.why,
  };
}

function detailOf(c: BuiltCandidate): PlannedExperimentRecord["detail"] {
  if (c.leverField === "internal_link" && c.linkDetail) {
    return { kind: "internal_link", destinationUrl: c.linkDetail.destinationUrl, anchorText: c.linkDetail.anchorText, wixInstructions: c.linkDetail.wixInstructions, relationship: c.linkDetail.relationship };
  }
  if (c.leverField === "answer_block" && c.answerDetail) {
    return { kind: "answer_block", question: c.answerDetail.question, operation: c.answerDetail.operation, exactInstruction: c.answerDetail.exactInstruction, paragraphIndex: c.answerDetail.paragraphIndex };
  }
  if (c.leverField === "meta") return { kind: "meta", source: "page_opening_paragraph" };
  // Item 56: a refresh pick freezes its evidence brief on the record so the card can argue
  // the fade (new uncovered queries, losing queries, the winner's newer section).
  if (c.leverField === "refresh") {
    return {
      kind: "refresh_section",
      briefSentences: c.refreshDetail?.briefSentences ?? [],
      clicksLostPerMonth: c.refreshDetail?.clicksLostPerMonth ?? 0,
    };
  }
  return { kind: "edit_field", field: c.leverField === "h1" ? "h1" : "title" };
}

function placementOf(c: BuiltCandidate): string {
  if (c.leverField === "answer_block" && c.answerDetail) return c.answerDetail.proposedLocation;
  if (c.leverField === "internal_link" && c.linkDetail) return `paragraph ${c.linkDetail.paragraphIndex + 1}`;
  if (c.leverField === "refresh") return "a new section (H2) in the page body";
  return c.leverField;
}

function leaveUnchangedFor(lever: ExperimentLever): string[] {
  const all = ["title", "meta", "H1", "other body text", "internal links", "schema"];
  const touched: Record<ExperimentLever, string> = { meta: "meta", title: "title", h1: "H1", internal_link: "internal links", answer_block: "other body text", refresh: "other body text" };
  return all.filter((x) => x.toLowerCase() !== touched[lever].toLowerCase());
}

function toExperimentRecord(
  planId: string,
  c: BuiltCandidate,
  controls: ProposedControlRecord[],
  correctionFactor: number,
  captureDistribution: ReadonlyMap<string, FamilyCaptureBand>,
): PlannedExperimentRecord {
  const path = normalizePath(c.url);
  const lever = c.leverField as ExperimentLever;
  const currentTextHash = stableHash(c.currentText ?? "");
  const evidenceHash = stableHash([c.targetQuery, c.proposedText, c.ownership.toFixed(3), c.position.toFixed(2)].join("|"));
  const eligibilityHash = stableHash([JSON.stringify(c.eligibility), controls.map((s) => s.controlPath).sort().join(",")].join("|"));
  // Item 64: resolve this pick's actionFamily capture band (empty distribution -> every family
  // falls through to blendCaptureBand's n < MIN_SAMPLES branch, the untouched static 25/75 band -
  // byte-identical to pre-item-64 output for a fresh tenant or an empty map passed by an older
  // caller/test).
  const band = blendCaptureBand(captureDistribution.get(canonicalMoveType(c.actionFamily)));
  return {
    id: `${planId}::${path}`,
    candidateId: path,
    url: c.url,
    canonicalUrl: c.url,
    pageLabel: c.pageLabel,
    pageFamily: c.pageFamily ?? "",
    lever,
    targetQuery: c.targetQuery,
    whyNow: c.whyNow,
    draftSource: c.draftSource ?? "deterministic",
    llmRationale: c.llmRationale,
    evidenceBrief: c.evidenceBrief,
    teamReview: c.teamReview,
    currentText: c.currentText,
    proposedText: c.proposedText,
    placement: placementOf(c),
    leaveUnchanged: leaveUnchangedFor(lever),
    rollbackText: c.rollbackText,
    effortMinutes: c.effortMinutes,
    risk: "low",
    expectations: buildPickExpectations({
      lever,
      ctrOpportunityClicks: c.ctrOpportunityClicks,
      effortMinutes: c.effortMinutes,
      correctionFactor,
      captureBand: { low: band.low, high: band.high, n: band.n, isEmpirical: band.isEmpirical },
    }),
    learnedPrior: c.learnedPrior,
    effectPrior: c.effectPrior,
    controls,
    influencedUrls: (c.influencedUrls ?? []).map(normalizePath),
    evidenceHash,
    currentTextHash,
    eligibilityHash,
    detail: detailOf(c),
  };
}

/**
 * Assign clean controls per experiment. A control is a diff-in-diff BASELINE, so the same untreated
 * page may baseline multiple experiments (shared controls are compatible - none of them changes it).
 * The one hard rule: a control must NOT be a page that is itself TREATED in this plan (a changed
 * page is not a clean baseline). So we exclude in-plan treated paths and keep up to 5 per experiment.
 * (The reservation id is keyed by experiment, so shared controls are distinct rows; acceptance
 * blocks only a control that is or becomes a TREATMENT, never a shared baseline.)
 */
function assignCleanControls(
  planId: string,
  selected: BuiltCandidate[],
  correctionFactor: number,
  captureDistribution: ReadonlyMap<string, FamilyCaptureBand>,
): PlannedExperimentRecord[] {
  const treatedPaths = new Set(selected.map((c) => normalizePath(c.url)));
  return selected.map((c) => {
    const clean: ProposedControlRecord[] = [];
    for (const ctrl of c.suggestedControls) {
      if (treatedPaths.has(normalizePath(ctrl.url))) continue; // never a treated page
      clean.push(controlRecord(ctrl));
      if (clean.length >= 5) break;
    }
    return toExperimentRecord(planId, c, clean, correctionFactor, captureDistribution);
  });
}

/** R14a: cap on the exclusions frozen onto a plan record (the "Why not the others?"
 *  expander renders exactly this many). Plain-sentence holds first - they carry the
 *  planner's own richest explanations - then the rest in planner order. PURE. */
const MAX_EXCLUDED_ON_RECORD = 8;
export function capExcludedForRecord(
  excluded: ReadonlyArray<ExcludedPickRecord>,
): ExcludedPickRecord[] {
  const withSentence = excluded.filter((e) => e.plainReason);
  const rest = excluded.filter((e) => !e.plainReason);
  return [...withSentence, ...rest]
    .slice(0, MAX_EXCLUDED_ON_RECORD)
    .map((e) => ({
      url: e.url,
      actionFamily: e.actionFamily,
      reason: e.reason,
      ...(e.plainReason ? { plainReason: e.plainReason } : {}),
    }));
}

export function buildDailyPlanRecord(input: {
  tenantId: string;
  date: string;
  now: Date;
  selected: BuiltCandidate[];
  backups: BuiltCandidate[];
  activeSnapshot: { proofIds: string[]; treatedUrls: string[]; controlUrls: string[]; influencedUrls: string[] };
  expiresInMinutes?: number;
  /** Item 27: the measured bias-correction factor from past forecasts vs actuals (default 1.0,
   *  meaning no correction yet - either no calibration history, or it is too thin to trust). The
   *  caller (build-today-preview.ts) reads this fail-soft from forecast-calibration.ts; this
   *  function just threads it through to every pick's expectations. */
  correctionFactor?: number;
  /** Item 64: the per-actionFamily empirical capture distribution (empirical-capture.ts), derived
   *  by the caller from the SAME calibration ledger read as correctionFactor. Omitted (or an empty
   *  map, e.g. a fresh tenant or an older test) resolves every family to the untouched static 25/75
   *  band - byte-identical to pre-item-64 output. */
  captureDistribution?: ReadonlyMap<string, FamilyCaptureBand>;
  /** R14a: the planner's own exclusion list (ExcludedExperiment rows, adapted by the caller),
   *  frozen on the record capped at 8 so "Why not the others?" renders at $0. Omitted (or empty,
   *  e.g. every older caller/test) leaves the record byte-identical to before R14a. */
  excluded?: ReadonlyArray<ExcludedPickRecord>;
}): DailyExperimentPlanRecord {
  const nowIso = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + (input.expiresInMinutes ?? DEFAULT_EXPIRY_MIN) * 60_000).toISOString();
  const correctionFactor = input.correctionFactor ?? 1;
  const captureDistribution = input.captureDistribution ?? new Map<string, FamilyCaptureBand>();

  // inputHash is content-addressed over the selected set + the active topology, so re-planning with
  // identical inputs yields the same plan id (idempotent preview), and any change → a new plan.
  const selectedKey = input.selected
    .map((c) => `${normalizePath(c.url)}:${c.leverField}:${stableHash(c.proposedText)}`)
    .sort()
    .join("|");
  const snapKey = [...input.activeSnapshot.treatedUrls, ...input.activeSnapshot.controlUrls].map(normalizePath).sort().join(",");
  const inputHash = stableHash(`${input.tenantId}|${input.date}|${selectedKey}|${snapKey}`);
  const id = `${input.tenantId}::${input.date}::${inputHash.slice(0, 12)}`;

  const selected = assignCleanControls(id, input.selected, correctionFactor, captureDistribution);
  const backups = assignCleanControls(id, input.backups, correctionFactor, captureDistribution);

  const byLever: Record<string, number> = {};
  const byPageFamily: Record<string, number> = {};
  for (const e of selected) {
    byLever[e.lever] = (byLever[e.lever] ?? 0) + 1;
    byPageFamily[e.pageFamily] = (byPageFamily[e.pageFamily] ?? 0) + 1;
  }
  const estimatedMinutes = selected.reduce((s, e) => s + e.effortMinutes, 0);

  // R14a: freeze the planner's exclusions (capped, plain-sentence holds first) so the
  // "Why not the others?" expander is pure surfacing. Omitted entirely when empty so
  // an exclusion-free plan (and every pre-R14a fixture) stays byte-identical.
  const excluded = capExcludedForRecord(input.excluded ?? []);

  return {
    version: 1,
    id,
    tenantId: input.tenantId,
    date: input.date,
    status: "preview",
    createdAt: nowIso,
    expiresAt,
    inputHash,
    plannerVersion: PLANNER_VERSION,
    activeExperimentSnapshot: { ...input.activeSnapshot, capturedAt: nowIso },
    selected,
    backups,
    ...(excluded.length > 0 ? { excluded } : {}),
    distribution: { byLever, byPageFamily },
    estimatedMinutes,
  };
}
