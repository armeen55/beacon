/** Ambient fail-closed boundary: model and provider doors ask here before buying. */
import { AsyncLocalStorage } from "node:async_hooks";

const noSpend = new AsyncLocalStorage<true>();
type ProofAllowance = { tenantId: string; calls: number; usd: number };
const proofSpend = new AsyncLocalStorage<ProofAllowance>();

/** Run `fn` with every paid door inside it closed, however deeply it is reached. */
export function runWithoutSpending<T>(fn: () => T): T {
  return noSpend.run(true, fn);
}

/** One named-candidate proof may cross the paused model door under its own hard allowance. Every other
 * account and every external-evidence door stays closed; reservation caps still apply underneath it. */
export const PROOF_SPEND = {
  run<T>(tenantId: string, maxCalls: number, maxUsd: number, fn: () => T): T {
    if (!tenantId || !Number.isInteger(maxCalls) || maxCalls < 1 || !Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error("invalid proof spending ceiling");
    return proofSpend.run({ tenantId, calls: maxCalls, usd: maxUsd }, fn);
  },
  activeFor(tenantId: string): boolean | null { if (noSpend.getStore() === true) return false; const held = proofSpend.getStore(); return held ? held.tenantId === tenantId : null; },
  authorize(tenantId: string, channel: "model" | "external", projectedUsd = 0): boolean | null {
    const held = proofSpend.getStore(); if (!held) return null;
    if (held.tenantId !== tenantId || channel === "external" || held.calls < 1 || projectedUsd <= 0 || projectedUsd > held.usd) return true;
    held.calls -= 1; held.usd -= projectedUsd; return false;
  },
};

/** Permission is never memoized; only a verified pause is briefly held. Unreadable fails closed. */
type PauseProbe = (tenantId: string) => Promise<boolean>;
let probeForTests: PauseProbe | null = null;
export function setSpendPauseProbeForTests(probe: PauseProbe | null): void { probeForTests = probe; }
const pausedMemo = new Map<string, number>(); // tenantId -> when the refusal was learned; running is never held
const PAUSE_MEMO_MS = 60_000;

export function settleSpendPause(tenantId: string, paused: boolean): void {
  if (paused) pausedMemo.set(tenantId, Date.now());
  else pausedMemo.delete(tenantId);
}

export async function spendingClosed(tenantId: string): Promise<boolean> {
  if (noSpend.getStore() === true) return true;
  if (probeForTests) return probeForTests(tenantId);
  if (process.env.VITEST) return false;
  const heldAt = pausedMemo.get(tenantId);
  if (heldAt != null && Date.now() - heldAt < PAUSE_MEMO_MS) return true;
  try {
    const { getSupabaseAdmin } = await import("./persistence/supabase");
    const { data, error } = await getSupabaseAdmin().from("tenants").select("research_paused").eq("id", tenantId).maybeSingle();
    if (error != null) return true;
    const paused = (data as { research_paused?: boolean } | null)?.research_paused === true;
    settleSpendPause(tenantId, paused);
    return paused;
  } catch {
    return true;
  }
}
