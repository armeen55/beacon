import "server-only";

/**
 * Trust-budget autopilot state store (2026-07-01, BEACON 500 item 1).
 *
 * One durable state object per tenant, through the existing json-store
 * pattern ("autopilot-state" is registered in SINGLETON_STORES and mirrored
 * to Supabase via SUPABASE_MIRRORED_STORES so config, the daily-run marker,
 * and receipts survive lambda recycles on hosted prod).
 *
 * Holds:
 *   - config: the operator's armed budget (enabled + weekly cap + thresholds).
 *   - lastRunDay: the Pacific date the nightly pass last ran (double-run guard).
 *   - receipts: append-only lines for every autopilot attempt (capped).
 *
 * SAFETY: reads fail soft to the DEFAULT (disabled) config. Losing this
 * store can only ever DISARM autopilot, never arm it.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import {
  DEFAULT_AUTOPILOT_CONFIG,
  normalizeAutopilotConfig,
  type AutopilotConfig,
} from "./autopilot-policy";

const STORE = "autopilot-state";
/** Keep the receipt trail bounded (newest first). */
const MAX_RECEIPTS = 200;

export type AutopilotReceipt = {
  id: string;
  editId: string;
  url: string;
  actionType: string;
  /** ISO timestamp of the attempt. */
  shippedAt: string;
  result: "pushed" | "failed";
  /** The operator-visible receipt line (also written on the proof record). */
  receiptLine: string;
  /** Push-path detail (adapter detail or the refusal reason). */
  detail: string;
  /**
   * Item 11 (additive): "ship" = a proven-lever auto-ship, "revert" = an
   * automatic restore of a prior value. Absent on legacy receipts = ship.
   * Reverts never consume the weekly SHIP budget (they are corrective and
   * bounded per night by the revert pass itself).
   */
  kind?: "ship" | "revert";
};

export type AutopilotState = {
  config: AutopilotConfig;
  /** Pacific date (YYYY-MM-DD) the pass last ran for this tenant, or null. */
  lastRunDay: string | null;
  /** Newest first. */
  receipts: AutopilotReceipt[];
};

function defaultState(): AutopilotState {
  return { config: { ...DEFAULT_AUTOPILOT_CONFIG }, lastRunDay: null, receipts: [] };
}

function normalizeState(raw: unknown): AutopilotState {
  if (raw == null || typeof raw !== "object") return defaultState();
  const r = raw as Partial<AutopilotState>;
  return {
    config: normalizeAutopilotConfig(r.config ?? null),
    lastRunDay: typeof r.lastRunDay === "string" && r.lastRunDay !== "" ? r.lastRunDay : null,
    receipts: Array.isArray(r.receipts)
      ? r.receipts.filter((x): x is AutopilotReceipt => x != null && typeof x === "object")
      : [],
  };
}

/** The tenant's autopilot state. Fail-soft: any read error means DISABLED. */
export async function getAutopilotState(): Promise<AutopilotState> {
  try {
    const rows = (await readStore<AutopilotState>(STORE)) ?? [];
    return normalizeState(rows[0]);
  } catch {
    return defaultState();
  }
}

/** Persist the full state (single-element array, per the singleton pattern). */
export async function saveAutopilotState(state: AutopilotState): Promise<void> {
  const next: AutopilotState = {
    ...normalizeState(state),
    receipts: (state.receipts ?? []).slice(0, MAX_RECEIPTS),
  };
  await writeStore<AutopilotState>(STORE, [next]);
}

/** The tenant's autopilot config (default: disabled). */
export async function getAutopilotConfig(): Promise<AutopilotConfig> {
  return (await getAutopilotState()).config;
}

/** Merge a partial config change and persist. Returns the stored config. */
export async function updateAutopilotConfig(
  patch: Partial<AutopilotConfig>,
): Promise<AutopilotConfig> {
  const state = await getAutopilotState();
  const config = normalizeAutopilotConfig({ ...state.config, ...patch });
  await saveAutopilotState({ ...state, config });
  return config;
}

/** Stamp the day the nightly pass ran (the per-day double-run guard). */
export async function markAutopilotRunDay(day: string): Promise<AutopilotState> {
  const state = await getAutopilotState();
  const next = { ...state, lastRunDay: day };
  await saveAutopilotState(next);
  return next;
}

/** Prepend one receipt (newest first) and persist. */
export async function appendAutopilotReceipt(receipt: AutopilotReceipt): Promise<void> {
  const state = await getAutopilotState();
  await saveAutopilotState({
    ...state,
    receipts: [receipt, ...state.receipts].slice(0, MAX_RECEIPTS),
  });
}

/** How many changes autopilot successfully shipped in the trailing window.
 *  Reverts are corrective, not new ships - they never eat the weekly budget. */
export function countAutoShippedInLastDays(
  state: Pick<AutopilotState, "receipts">,
  now: Date,
  days = 7,
): number {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return state.receipts.filter((r) => {
    if (r.result !== "pushed") return false;
    if (r.kind === "revert") return false;
    const t = Date.parse(r.shippedAt);
    return Number.isFinite(t) && t >= cutoff;
  }).length;
}

/**
 * Item 52: how many changes of EACH lever autopilot already shipped TODAY
 * (the given Pacific day string, e.g. "2026-07-02"), keyed by action type.
 * Feeds the per-lever daily cap in decideAutopilotShips. Reverts never count
 * (same reasoning as the weekly counter: they are corrective, not new ships).
 * Receipts carry a UTC ISO timestamp; compared here in Pacific time so it
 * lines up with the Pacific day marker the nightly pass stamps.
 */
export function countAutoShippedTodayByLever(
  state: Pick<AutopilotState, "receipts">,
  day: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of state.receipts) {
    if (r.result !== "pushed") continue;
    if (r.kind === "revert") continue;
    const t = Date.parse(r.shippedAt);
    if (!Number.isFinite(t)) continue;
    const shippedDay = new Date(t).toLocaleDateString("en-CA", {
      timeZone: "America/Los_Angeles",
    });
    if (shippedDay !== day) continue;
    counts[r.actionType] = (counts[r.actionType] ?? 0) + 1;
  }
  return counts;
}
