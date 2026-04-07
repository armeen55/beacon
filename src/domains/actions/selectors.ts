import type { ActionItem, ActionBucket, OperatorState } from "./types";

export function actionsByBucket(
  actions: ActionItem[],
  bucket: ActionBucket
): ActionItem[] {
  return actions.filter((a) => a.bucket === bucket);
}

export function activeActions(actions: ActionItem[]): ActionItem[] {
  return actions.filter((a) => a.status !== "done" && a.status !== "dismissed");
}

export function completedActions(actions: ActionItem[]): ActionItem[] {
  return actions.filter((a) => a.status === "done");
}

export function doNowActions(actions: ActionItem[]): ActionItem[] {
  return activeActions(actions).filter((a) => a.bucket === "do_now");
}

export function systemFixActions(actions: ActionItem[]): ActionItem[] {
  return activeActions(actions).filter((a) => a.bucket === "system_fix");
}

export type ActionQueueSummary = {
  total: number;
  active: number;
  doNow: number;
  doThisWeek: number;
  systemFix: number;
  monitor: number;
  deprioritized: number;
  completed: number;
  dismissed: number;
  withFollowThrough: number;
  evidencePositive: number;
};

export function summarizeQueue(actions: ActionItem[]): ActionQueueSummary {
  let active = 0;
  let doNow = 0;
  let doThisWeek = 0;
  let systemFix = 0;
  let monitor = 0;
  let deprioritized = 0;
  let completed = 0;
  let dismissed = 0;
  let withFollowThrough = 0;
  let evidencePositive = 0;

  for (const a of actions) {
    if (a.status === "done") {
      completed++;
      if (a.followThrough) {
        withFollowThrough++;
        if (a.followThrough === "evidence_positive") evidencePositive++;
      }
      continue;
    }
    if (a.status === "dismissed") { dismissed++; continue; }

    active++;
    switch (a.bucket) {
      case "do_now": doNow++; break;
      case "do_this_week": doThisWeek++; break;
      case "system_fix": systemFix++; break;
      case "monitor": monitor++; break;
      case "deprioritized": deprioritized++; break;
    }
  }

  return {
    total: actions.length,
    active,
    doNow,
    doThisWeek,
    systemFix,
    monitor,
    deprioritized,
    completed,
    dismissed,
    withFollowThrough,
    evidencePositive,
  };
}
