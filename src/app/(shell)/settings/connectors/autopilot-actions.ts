"use server";

/**
 * Trust-budget autopilot - settings server actions (2026-07-01, item 1).
 *
 * The operator arms/disarms the proven-change budget for the current site
 * and sets the weekly cap. Gated exactly like the armed-publishing actions
 * (canPublishForCurrentTenant, fail-closed). Arming autopilot additionally
 * requires one-click publishing to already be armed (the same consent the
 * armed accept path rests on) and refuses the advise-only site.
 */

import { revalidatePath } from "next/cache";

import { currentTenantId } from "@/lib/tenant-context";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import {
  AUTOPILOT_RITZ_TENANT_ID,
  LEVER_DAILY_CAP_MAX,
  LEVER_DAILY_CAP_MIN,
  computeLeverRecords,
  getLeverPolicy,
  leverHistoryFromLedger,
  leverIsProven,
  leverLabel,
  normalizeAutopilotConfig,
  normalizePerLeverPolicy,
  type AutopilotConfig,
  type LeverPolicyMode,
  type PerLeverPolicy,
} from "@/domains/autopilot/autopilot-policy";
import {
  countAutoShippedInLastDays,
  countAutoShippedTodayByLever,
  getAutopilotState,
  updateAutopilotConfig,
} from "@/domains/autopilot/autopilot-store";
import { loadTriageSuggestions, type TriagePolicySuggestion } from "@/domains/autopilot/triage-feed";
import { getPublishingMode } from "@/domains/push/publishing-mode-store";
import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";

export type AutopilotLeverView = {
  actionType: string;
  label: string;
  decided: number;
  nonRegression: number;
  ratePct: number;
  proven: boolean;
};

export type AutopilotReceiptView = {
  shippedAt: string;
  line: string;
  result: "pushed" | "failed";
};

/** Item 52: one operator-visible per-lever policy row, with today's usage. */
export type PerLeverPolicyView = {
  actionType: string;
  label: string;
  mode: LeverPolicyMode;
  dailyCap: number;
  shippedToday: number;
};

export type AutopilotSettingsView = {
  canPublish: boolean;
  /** One-click publishing is armed for this site (autopilot's precondition). */
  publishingArmed: boolean;
  /** The advise-only site can never arm autopilot. */
  adviseOnly: boolean;
  config: AutopilotConfig;
  /** R20 - "prepare tomorrow's top picks overnight" is on. Prepare-ahead only, never publish. */
  prepareAheadOvernight: boolean;
  usedThisWeek: number;
  levers: AutopilotLeverView[];
  recentReceipts: AutopilotReceiptView[];
  /** Item 52: the operator's explicit per-lever auto/review policies. */
  perLeverPolicies: PerLeverPolicyView[];
  /** Item 52: triage-fed suggestions for levers with no policy yet. Never auto-enabled. */
  triageSuggestions: TriagePolicySuggestion[];
};

export async function loadAutopilotSettings(): Promise<AutopilotSettingsView> {
  const tenantId = await currentTenantId();
  const [canPublish, modeState, state, ledger] = await Promise.all([
    canPublishForCurrentTenant(),
    getPublishingMode(),
    getAutopilotState(),
    loadShippedChanges().catch(() => []),
  ]);

  // Fail-closed calibration quarantine, review fix 5 (2026-07-11): the settings
  // page must never show a lever as "proven" off quarantined wins - same shared
  // gate the runner uses (leverHistoryFromLedger), so display and ship rights
  // can never disagree.
  const records = computeLeverRecords(leverHistoryFromLedger(ledger));
  const levers: AutopilotLeverView[] = records.map((r) => ({
    actionType: r.actionType,
    label: leverLabel(r.actionType),
    decided: r.decided,
    nonRegression: r.nonRegression,
    ratePct: r.decided > 0 ? Math.round((r.nonRegression / r.decided) * 100) : 0,
    proven: leverIsProven(r, state.config),
  }));

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const shippedTodayByLever = countAutoShippedTodayByLever(state, today);
  const perLeverPolicies: PerLeverPolicyView[] = (state.config.perLeverPolicies ?? []).map((p) => ({
    actionType: p.actionType,
    label: leverLabel(p.actionType),
    mode: p.mode,
    dailyCap: p.dailyCap,
    shippedToday: shippedTodayByLever[p.actionType] ?? 0,
  }));

  const triageSuggestions = await loadTriageSuggestions(state.config).catch(
    () => [] as TriagePolicySuggestion[],
  );

  return {
    canPublish,
    publishingArmed: modeState.mode === "armed",
    adviseOnly: tenantId === AUTOPILOT_RITZ_TENANT_ID,
    config: state.config,
    prepareAheadOvernight: state.config.prepareAheadOvernight === true,
    usedThisWeek: countAutoShippedInLastDays(state, new Date()),
    levers,
    recentReceipts: state.receipts.slice(0, 5).map((r) => ({
      shippedAt: r.shippedAt,
      line: r.receiptLine,
      result: r.result,
    })),
    perLeverPolicies,
    triageSuggestions,
  };
}

export type AutopilotUpdateResult =
  | { ok: true; config: AutopilotConfig }
  | { ok: false; reason: string };

export async function setAutopilotEnabled(args: {
  enabled: boolean;
}): Promise<AutopilotUpdateResult> {
  if (!(await canPublishForCurrentTenant())) {
    return { ok: false, reason: "You don't have permission to change publishing for this site." };
  }

  if (args.enabled === true) {
    const tenantId = await currentTenantId();
    if (tenantId === AUTOPILOT_RITZ_TENANT_ID) {
      return {
        ok: false,
        reason: "This site is set up for advice only. Nothing ever publishes automatically here.",
      };
    }
    const modeState = await getPublishingMode();
    if (modeState.mode !== "armed") {
      return {
        ok: false,
        reason:
          "Turn on one-click publishing first. Autopilot uses the same safe publishing path, so it needs that switch on before it can ship anything.",
      };
    }
  }

  const config = await updateAutopilotConfig({ enabled: args.enabled === true });
  revalidatePath("/settings/connectors");
  return { ok: true, config };
}

/**
 * R20 (D6 dynamic auto-mode) - turn "prepare tomorrow's top picks overnight" on/off. This is a
 * DISTINCT switch from publish-autopilot (`setAutopilotEnabled`): it is PREPARE-ahead only.
 * When on, the nightly warm pass drafts + SERP-checks the top Moves so the morning queue is
 * already prepared - it NEVER publishes anything. Because it can never write to the site, it does
 * NOT require one-click publishing to be armed and is allowed on the advise-only site too;
 * publishing always waits for the operator (or the separate publish-autopilot switch). Gated only
 * on operator permission, fail-closed.
 */
export async function setPrepareAheadOvernight(args: {
  enabled: boolean;
}): Promise<AutopilotUpdateResult> {
  if (!(await canPublishForCurrentTenant())) {
    return { ok: false, reason: "You don't have permission to change publishing for this site." };
  }
  const config = await updateAutopilotConfig({ prepareAheadOvernight: args.enabled === true });
  revalidatePath("/settings/connectors");
  return { ok: true, config };
}

export async function setAutopilotWeeklyCap(args: {
  weeklyCap: number;
}): Promise<AutopilotUpdateResult> {
  if (!(await canPublishForCurrentTenant())) {
    return { ok: false, reason: "You don't have permission to change publishing for this site." };
  }
  const normalized = normalizeAutopilotConfig({ weeklyCap: args.weeklyCap });
  const config = await updateAutopilotConfig({ weeklyCap: normalized.weeklyCap });
  revalidatePath("/settings/connectors");
  return { ok: true, config };
}

// ---------------------------------------------------------------------------
// Item 52: per-lever policies (the operator pre-approves a class of change)
// ---------------------------------------------------------------------------

const SUGGESTED_DEFAULT_CAP = 1;

function mergedLeverPolicies(
  current: PerLeverPolicy[] | null | undefined,
  next: PerLeverPolicy,
): PerLeverPolicy[] {
  const existing = current ?? [];
  const withoutThis = existing.filter((p) => p.actionType !== next.actionType);
  return [...withoutThis, next];
}

/**
 * Set one lever's mode (auto/review) and daily cap. This is the ONLY way a
 * lever's mode becomes "auto" - always an explicit operator call, never a
 * side effect of loading suggestions or of the nightly pass itself.
 */
export async function setLeverPolicy(args: {
  actionType: string;
  mode: LeverPolicyMode;
  dailyCap?: number;
}): Promise<AutopilotUpdateResult> {
  if (!(await canPublishForCurrentTenant())) {
    return { ok: false, reason: "You don't have permission to change publishing for this site." };
  }
  const actionType = args.actionType.trim();
  if (actionType === "") {
    return { ok: false, reason: "I need a change type to set a policy for." };
  }

  const tenantId = await currentTenantId();
  if (args.mode === "auto" && tenantId === AUTOPILOT_RITZ_TENANT_ID) {
    return {
      ok: false,
      reason: "This site is set up for advice only. Nothing ever publishes automatically here.",
    };
  }

  const state = await getAutopilotState();
  const currentCap = getLeverPolicy(state.config, actionType)?.dailyCap ?? SUGGESTED_DEFAULT_CAP;
  const normalized = normalizePerLeverPolicy({
    actionType,
    mode: args.mode,
    dailyCap: args.dailyCap ?? currentCap,
  });
  if (normalized == null) {
    return { ok: false, reason: "I could not read that change type." };
  }

  const config = await updateAutopilotConfig({
    perLeverPolicies: mergedLeverPolicies(state.config.perLeverPolicies, normalized),
  });
  revalidatePath("/settings/connectors");
  return { ok: true, config };
}

/** Set only the daily cap for a lever that already has a policy row (bounds enforced). */
export async function setLeverPolicyDailyCap(args: {
  actionType: string;
  dailyCap: number;
}): Promise<AutopilotUpdateResult> {
  if (!(await canPublishForCurrentTenant())) {
    return { ok: false, reason: "You don't have permission to change publishing for this site." };
  }
  if (!Number.isFinite(args.dailyCap)) {
    return {
      ok: false,
      reason: `Enter a number between ${LEVER_DAILY_CAP_MIN} and ${LEVER_DAILY_CAP_MAX} for the daily limit.`,
    };
  }
  const actionType = args.actionType.trim();
  const state = await getAutopilotState();
  const existing = getLeverPolicy(state.config, actionType);
  if (existing == null) {
    return { ok: false, reason: "Turn on auto-ship for this change type first." };
  }
  const normalized = normalizePerLeverPolicy({ ...existing, dailyCap: args.dailyCap });
  if (normalized == null) {
    return { ok: false, reason: "I could not read that change type." };
  }
  const config = await updateAutopilotConfig({
    perLeverPolicies: mergedLeverPolicies(state.config.perLeverPolicies, normalized),
  });
  revalidatePath("/settings/connectors");
  return { ok: true, config };
}

/**
 * Enable a triage suggestion as an "auto" policy at its suggested daily cap.
 * This is the single click the settings card offers - the suggestion never
 * enables itself; this action only runs from an explicit operator click.
 */
export async function enableTriageSuggestion(args: {
  actionType: string;
  dailyCap?: number;
}): Promise<AutopilotUpdateResult> {
  return setLeverPolicy({
    actionType: args.actionType,
    mode: "auto",
    dailyCap: args.dailyCap ?? SUGGESTED_DEFAULT_CAP,
  });
}

/** Put a lever back to review-only (the operator's click, undoing "auto" any time). */
export async function setLeverPolicyToReview(args: {
  actionType: string;
}): Promise<AutopilotUpdateResult> {
  const state = await getAutopilotState();
  const existing = getLeverPolicy(state.config, args.actionType);
  return setLeverPolicy({
    actionType: args.actionType,
    mode: "review",
    dailyCap: existing?.dailyCap,
  });
}
