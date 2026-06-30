/**
 * execution-checklist (2026-07-01) — PURE read model that turns an ACCEPTED plan + its reservations
 * into the operator's per-item execution checklist (apply → verify → active → submit-to-Google), plus
 * an honest header summary. No I/O. The UI renders this; planning/verification never run on render.
 */
import type { DailyExperimentPlanRecord, PlannedExperimentRecord, ControlReservationRecord } from "./daily-plan-types";
import {
  itemStatus, isActiveStatus, derivePlanExecutionStatus,
  type DailyExperimentItemStatus, type DailyPlanExecutionStatus, type LiveVerificationResult,
} from "./execution-state";

export type ExecutionItemView = {
  experiment: PlannedExperimentRecord;
  status: DailyExperimentItemStatus;
  proofId?: string;
  verification?: LiveVerificationResult;
  reservedControls: number;
  activeControls: number;
  instructions: string;
};

export type ExecutionChecklist = {
  planId: string;
  planStatus: DailyPlanExecutionStatus;
  items: ExecutionItemView[];
  summary: {
    accepted: number;
    active: number;
    submitted: number;
    left: number;
    skipped: number;
    controlsProtected: number;
  };
};

/** Lever-specific, copy-exact Wix instructions (no alternatives — one precise change). */
export function wixInstructions(e: PlannedExperimentRecord): string {
  switch (e.lever) {
    case "meta":
      return `Wix → SEO Basics → Meta description.\nReplace exactly:\n  ${e.currentText || "(empty)"}\nWith:\n  ${e.proposedText}`;
    case "internal_link": {
      const d = e.detail.kind === "internal_link" ? e.detail : null;
      return `Wix CMS → page body.\nFind the exact sentence:\n  ${e.currentText}\nHighlight: ${d?.anchorText ?? ""}\nLink it to: ${d?.destinationUrl ?? ""}`;
    }
    case "answer_block": {
      const d = e.detail.kind === "answer_block" ? e.detail : null;
      const extra = d?.exactInstruction ? `\n  ${d.exactInstruction}` : "";
      return `Wix CMS → page body.\nFind the exact sentence:\n  ${e.proposedText || e.currentText}\nMove it directly below the H1. Do not rewrite it.${extra}`;
    }
    case "title":
      return `Wix → SEO Basics → Page title.\nReplace exactly:\n  ${e.currentText || "(empty)"}\nWith:\n  ${e.proposedText}`;
    case "h1":
      return `Wix CMS → page heading (H1).\nReplace exactly:\n  ${e.currentText || "(empty)"}\nWith:\n  ${e.proposedText}`;
    default:
      return e.placement || "Apply this change in Wix, then click “Applied in Wix”.";
  }
}

export function buildExecutionChecklist(plan: DailyExperimentPlanRecord, reservations: ControlReservationRecord[]): ExecutionChecklist {
  const byExperiment = new Map<string, { reserved: number; active: number }>();
  for (const r of reservations) {
    const slot = byExperiment.get(r.plannedExperimentId) ?? { reserved: 0, active: 0 };
    if (r.status === "reserved") slot.reserved += 1;
    else if (r.status === "active") slot.active += 1;
    byExperiment.set(r.plannedExperimentId, slot);
  }

  const items: ExecutionItemView[] = plan.selected.map((experiment) => {
    const status = itemStatus(plan.execution, experiment.id);
    const stored = plan.execution?.items?.[experiment.id];
    const counts = byExperiment.get(experiment.id) ?? { reserved: 0, active: 0 };
    return {
      experiment,
      status,
      proofId: stored?.proofId,
      verification: stored?.verification,
      reservedControls: counts.reserved,
      activeControls: counts.active,
      instructions: wixInstructions(experiment),
    };
  });

  const statuses = items.map((i) => i.status);
  const summary = {
    accepted: items.length,
    active: statuses.filter(isActiveStatus).length,
    submitted: statuses.filter((s) => s === "gsc_submitted").length,
    left: statuses.filter((s) => s === "ready_to_apply" || s === "verification_failed" || s === "verification_pending").length,
    skipped: statuses.filter((s) => s === "skipped").length,
    controlsProtected: reservations.filter((r) => r.status === "active").length,
  };

  return {
    planId: plan.id,
    planStatus: derivePlanExecutionStatus(plan.status, statuses),
    items,
    summary,
  };
}
