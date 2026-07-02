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
  computeLeverRecords,
  leverIsProven,
  leverLabel,
  normalizeAutopilotConfig,
  type AutopilotConfig,
} from "@/domains/autopilot/autopilot-policy";
import {
  countAutoShippedInLastDays,
  getAutopilotState,
  updateAutopilotConfig,
} from "@/domains/autopilot/autopilot-store";
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

export type AutopilotSettingsView = {
  canPublish: boolean;
  /** One-click publishing is armed for this site (autopilot's precondition). */
  publishingArmed: boolean;
  /** The advise-only site can never arm autopilot. */
  adviseOnly: boolean;
  config: AutopilotConfig;
  usedThisWeek: number;
  levers: AutopilotLeverView[];
  recentReceipts: AutopilotReceiptView[];
};

export async function loadAutopilotSettings(): Promise<AutopilotSettingsView> {
  const tenantId = await currentTenantId();
  const [canPublish, modeState, state, ledger] = await Promise.all([
    canPublishForCurrentTenant(),
    getPublishingMode(),
    getAutopilotState(),
    loadShippedChanges().catch(() => []),
  ]);

  const records = computeLeverRecords(
    ledger.map((r) => ({ actionType: r.actionType, verdict: r.verdict })),
  );
  const levers: AutopilotLeverView[] = records.map((r) => ({
    actionType: r.actionType,
    label: leverLabel(r.actionType),
    decided: r.decided,
    nonRegression: r.nonRegression,
    ratePct: r.decided > 0 ? Math.round((r.nonRegression / r.decided) * 100) : 0,
    proven: leverIsProven(r, state.config),
  }));

  return {
    canPublish,
    publishingArmed: modeState.mode === "armed",
    adviseOnly: tenantId === AUTOPILOT_RITZ_TENANT_ID,
    config: state.config,
    usedThisWeek: countAutoShippedInLastDays(state, new Date()),
    levers,
    recentReceipts: state.receipts.slice(0, 5).map((r) => ({
      shippedAt: r.shippedAt,
      line: r.receiptLine,
      result: r.result,
    })),
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
