import type { Brief } from "./types";
import type { Priority, EffortLevel } from "@/lib/constants";

export type StallLevel = "none" | "warning" | "stalled" | "critical";

export type StallStatus = {
  level: StallLevel;
  reason: string;
  days_inactive: number;
  recommended_action: string | null;
};

const PRIORITY_MULTIPLIER: Record<Priority, number> = {
  critical: 0.5,
  high: 0.75,
  medium: 1.0,
  low: 1.5,
};

const EFFORT_RUNWAY_DAYS: Record<EffortLevel, number> = {
  trivial: 0,
  small: 1,
  medium: 2,
  large: 4,
  epic: 7,
};

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function getLastActivity(brief: Brief): Date {
  const candidates: Date[] = [];

  for (const item of brief.checklist) {
    if (item.completed_at) candidates.push(new Date(item.completed_at));
  }

  for (const outcome of brief.expected_outcomes) {
    if (outcome.judged_at) candidates.push(new Date(outcome.judged_at));
  }

  if (brief.started_at) candidates.push(new Date(brief.started_at));

  if (candidates.length === 0) return new Date(brief.updated_at);

  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

export function getStallStatus(
  brief: Brief,
  now: Date = new Date()
): StallStatus {
  const none: StallStatus = {
    level: "none",
    reason: "",
    days_inactive: 0,
    recommended_action: null,
  };

  if (brief.status === "completed") return none;

  const pm = PRIORITY_MULTIPLIER[brief.priority];
  const isOverdue = brief.due_date
    ? new Date(brief.due_date) < now
    : false;

  if (brief.status === "draft") {
    if (!brief.due_date) return none;
    const daysUntilDue = daysBetween(now, new Date(brief.due_date));
    if (daysUntilDue <= 0) {
      return {
        level: brief.priority === "critical" ? "critical" : "stalled",
        reason: `Due date passed ${Math.abs(daysUntilDue)}d ago while still in draft`,
        days_inactive: Math.abs(daysUntilDue),
        recommended_action:
          "Approve and begin execution, or extend the due date",
      };
    }
    if (daysUntilDue <= 10) {
      return {
        level: "warning",
        reason: `Due in ${daysUntilDue}d but still in draft`,
        days_inactive: daysUntilDue,
        recommended_action: "Review and approve to begin execution",
      };
    }
    return none;
  }

  if (brief.status === "approved") {
    const anchor = brief.approved_at
      ? new Date(brief.approved_at)
      : new Date(brief.updated_at);
    const daysSince = daysBetween(anchor, now);
    const warnAt = Math.round(3 * pm);
    const stallAt = Math.round(5 * pm);

    if (daysSince >= stallAt) {
      return {
        level:
          isOverdue || brief.priority === "critical" ? "critical" : "stalled",
        reason: `Approved ${daysSince}d ago with no execution started`,
        days_inactive: daysSince,
        recommended_action: "Start execution or re-prioritize",
      };
    }
    if (daysSince >= warnAt) {
      return {
        level: "warning",
        reason: `Approved ${daysSince}d ago — execution should begin soon`,
        days_inactive: daysSince,
        recommended_action: "Start execution or re-prioritize",
      };
    }
    return none;
  }

  if (brief.status === "blocked") {
    const anchor = brief.blocked_at
      ? new Date(brief.blocked_at)
      : new Date(brief.updated_at);
    const daysSince = daysBetween(anchor, now);
    const warnAt = Math.round(5 * pm);
    const stallAt = Math.round(7 * pm);

    if (daysSince >= stallAt) {
      return {
        level:
          isOverdue || brief.priority === "critical" || daysSince >= 14
            ? "critical"
            : "stalled",
        reason: `Blocked for ${daysSince}d${brief.blocked_reason ? `: ${brief.blocked_reason}` : ""}`,
        days_inactive: daysSince,
        recommended_action: "Resolve the blocker or cancel",
      };
    }
    if (daysSince >= warnAt) {
      return {
        level: "warning",
        reason: `Blocked for ${daysSince}d — approaching stall`,
        days_inactive: daysSince,
        recommended_action: "Resolve the blocker or escalate",
      };
    }
    return none;
  }

  if (brief.status === "in_progress") {
    const lastActivity = getLastActivity(brief);
    const daysSince = daysBetween(lastActivity, now);
    const runway = EFFORT_RUNWAY_DAYS[brief.effort];
    const warnAt = Math.round(5 * pm) + runway;
    const stallAt = Math.round(7 * pm) + runway;

    if (daysSince >= stallAt) {
      return {
        level:
          isOverdue || brief.priority === "critical" ? "critical" : "stalled",
        reason: `No activity in ${daysSince}d`,
        days_inactive: daysSince,
        recommended_action:
          "Update the checklist, link new changes, or mark as blocked",
      };
    }
    if (daysSince >= warnAt) {
      return {
        level: "warning",
        reason: `No activity in ${daysSince}d — approaching stall`,
        days_inactive: daysSince,
        recommended_action: "Update the checklist or link new changes",
      };
    }
    if (isOverdue) {
      const daysOverdue = daysBetween(new Date(brief.due_date!), now);
      return {
        level: brief.priority === "critical" ? "critical" : "warning",
        reason: `Overdue by ${daysOverdue}d`,
        days_inactive: daysSince,
        recommended_action: "Complete remaining work or extend the due date",
      };
    }
    return none;
  }

  return none;
}
