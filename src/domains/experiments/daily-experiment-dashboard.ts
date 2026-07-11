/**
 * daily-experiment-dashboard (2026-06-30) — PURE read model for the native "Daily experiments"
 * section. Surfaces the ACTIVE experiment batch + its protected controls (so the operator sees what
 * must not be touched), plus any preview/accepted plan and protected counts. No I/O — the loader
 * assembles the inputs; this just shapes them. Renders the active-batch protection warning the
 * mission centers on.
 */

import { GSC_LAG_DAYS } from "./experiment-eligibility";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { normalizePath, type ControlReservationRecord, type DailyExperimentPlanRecord } from "./daily-plan-types";
import { splitLedgerLifecycle } from "@/domains/changes/lifecycle-counts";
import { verdictSchedule } from "@/domains/proof-gsc/verdict-schedule";

const CHECKPOINT_DAYS = 7;
const FINAL_DAYS = 28;
const addDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * 86_400_000);

export type DailyExperimentDashboard = {
  activeProofBatch?: {
    label: string;
    experimentCount: number;
    controlCount: number;
    /** Soonest FUTURE first-read date (verdictSchedule.firstReadOn), YYYY-MM-DD or null. */
    nextCheckpoint: string | null;
    /** When Google's data for the final window is reliably in (verdictSchedule.reliableDataOn). */
    reliableDataDate: string | null;
    treatedUrls: string[];
    controlUrls: string[];
  };
  previewPlan?: DailyExperimentPlanRecord;
  acceptedPlan?: DailyExperimentPlanRecord;
  protectedCounts: { treatments: number; controls: number; reservations: number; influenced: number };
  dueMeasurements: number;
  availableCandidates: number;
};

function familyLabel(paths: string[]): string {
  const fams = new Map<string, number>();
  for (const p of paths) { const f = p.split("/").filter(Boolean)[0] ?? "other"; fams.set(f, (fams.get(f) ?? 0) + 1); }
  const top = [...fams.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "experiments";
  return `${top.replace(/[-_]+/g, " ")} batch`;
}

export function buildDailyExperimentDashboard(input: {
  ledger: ShippedChangeRecord[];
  now: Date;
  previewPlan?: DailyExperimentPlanRecord;
  acceptedPlan?: DailyExperimentPlanRecord;
  reservations?: ControlReservationRecord[];
  availableCandidates?: number;
}): DailyExperimentDashboard {
  // Wave 3A: "measuring" is the canonical lifecycle set (splitLedgerLifecycle), never a raw
  // raw stored-verdict filter - so the batch count matches Results, Today, and the
  // Changes list exactly. The batch dates come from the one verdictSchedule.
  const measuring = splitLedgerLifecycle(input.ledger, input.now).measuring;
  const treated = [...new Set(measuring.map((r) => normalizePath(r.path)))];
  const controls = [...new Set(measuring.flatMap((r) => (r.controlPages ?? []).map(normalizePath)))];

  let activeProofBatch: DailyExperimentDashboard["activeProofBatch"];
  if (measuring.length > 0) {
    const schedule = verdictSchedule(measuring, input.now);
    activeProofBatch = {
      label: familyLabel(treated),
      experimentCount: measuring.length,
      controlCount: controls.length,
      nextCheckpoint: schedule.firstReadOn,
      reliableDataDate: schedule.reliableDataOn,
      treatedUrls: treated,
      controlUrls: controls,
    };
  }

  const activeReservations = (input.reservations ?? []).filter((r) => r.status === "reserved" || r.status === "active");
  const influenced = [...new Set(measuring.flatMap((r) => /* internal-link experiments record influenced pages in notes-free future; none today */[] as string[]))];

  // due = measuring rows whose 7-day checkpoint has passed (+GSC lag) and aren't settled yet.
  const dueMeasurements = measuring.filter((r) => input.now.getTime() >= addDays(r.shippedAt, CHECKPOINT_DAYS + GSC_LAG_DAYS).getTime()).length;
  void FINAL_DAYS;

  return {
    activeProofBatch,
    previewPlan: input.previewPlan,
    acceptedPlan: input.acceptedPlan,
    protectedCounts: {
      treatments: treated.length,
      controls: controls.length,
      reservations: activeReservations.length,
      influenced: influenced.length,
    },
    dueMeasurements,
    availableCandidates: input.availableCandidates ?? 0,
  };
}

/** The operator-facing protected-control warning (only when there are active controls). */
export function protectedControlWarning(dash: DailyExperimentDashboard): string | null {
  const n = dash.protectedCounts.controls;
  if (n <= 0) return null;
  return `${n} similar pages are being used as before/after comparisons this month. Leave them unchanged so the results stay trustworthy.`;
}
