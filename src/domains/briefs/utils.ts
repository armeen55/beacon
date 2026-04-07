import type { ChecklistItem, ExpectedOutcome } from "./types";
import type { MetricType } from "@/lib/constants";
import { METRIC_DIRECTION, METRIC_UNITS } from "@/lib/constants";

export type ChecklistProgress = {
  total: number;
  done: number;
  skipped: number;
  in_progress: number;
  pending: number;
  percentage: number;
};

export function getBriefProgress(checklist: ChecklistItem[]): ChecklistProgress {
  const total = checklist.length;
  if (total === 0) {
    return {
      total: 0,
      done: 0,
      skipped: 0,
      in_progress: 0,
      pending: 0,
      percentage: 0,
    };
  }
  const done = checklist.filter((i) => i.status === "done").length;
  const skipped = checklist.filter((i) => i.status === "skipped").length;
  const in_progress = checklist.filter((i) => i.status === "in_progress").length;
  const pending = checklist.filter((i) => i.status === "pending").length;
  const percentage = Math.round(((done + skipped) / total) * 100);
  return { total, done, skipped, in_progress, pending, percentage };
}

export type OutcomeSummary = {
  total: number;
  hit: number;
  partial: number;
  missed: number;
  pending: number;
};

export function getOutcomeSummary(
  outcomes: ExpectedOutcome[]
): OutcomeSummary {
  const s: OutcomeSummary = {
    total: 0,
    hit: 0,
    partial: 0,
    missed: 0,
    pending: 0,
  };
  for (const o of outcomes) {
    s.total++;
    s[o.verdict]++;
  }
  return s;
}

export function getDueDelta(
  dueDate: string | null,
  now: Date = new Date()
): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatTarget(
  metricType: MetricType,
  targetValue: number | null
): string {
  if (targetValue === null) return "Any improvement";
  const unit = METRIC_UNITS[metricType];
  const dir = METRIC_DIRECTION[metricType];
  const prefix = dir === "lower_is_better" ? "≤" : "≥";
  return `${prefix}\u00A0${targetValue}${unit}`;
}

export function isInvertedMetric(metricType: MetricType): boolean {
  return METRIC_DIRECTION[metricType] === "lower_is_better";
}
