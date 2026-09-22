/** Ambient fail-closed boundary: model and provider doors ask here before buying. */
import { AsyncLocalStorage } from "node:async_hooks";

const noSpend = new AsyncLocalStorage<true>();
type ExternalTarget = { capability: string; url: string };
type ProofPolicy = { maxExternalCalls: number; maxExternalUsd: number; allowedExternal?: ExternalTarget[]; stopBy?: number };
type ProofMeter = { modelCalls: number; modelReservedUsd: number; externalCalls: number; externalReservedUsd: number };
type ProofAllowance = { tenantId: string; maxCalls: number; maxUsd: number; policy: ProofPolicy; meter: ProofMeter };
const proofSpend = new AsyncLocalStorage<ProofAllowance>();
const targetUrl = (value: string): string | null => {
  try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null; url.hash = ""; return url.toString(); } catch { return null; }
};
export function runWithoutSpending<T>(fn: () => T): T { return noSpend.run(true, fn); }

export const PROOF_SPEND = {
  run<T>(tenantId: string, maxCalls: number, maxUsd: number, fn: () => T, policy: ProofPolicy = { maxExternalCalls: 0, maxExternalUsd: 0 }): T {
    if (proofSpend.getStore() || !tenantId || !Number.isInteger(maxCalls) || maxCalls < 1 || !Number.isFinite(maxUsd) || maxUsd <= 0
      || !Number.isInteger(policy.maxExternalCalls) || policy.maxExternalCalls < 0 || !Number.isFinite(policy.maxExternalUsd) || policy.maxExternalUsd < 0
      || policy.maxExternalCalls > 0 && (policy.maxExternalUsd <= 0 || !policy.allowedExternal?.length) || policy.stopBy != null && !Number.isFinite(policy.stopBy)
      || policy.allowedExternal?.some((target) => !["onpage_rendered_html", "onpage_content_parsing"].includes(target.capability) || !targetUrl(target.url))) throw new Error("invalid proof spending ceiling");
    return proofSpend.run({ tenantId, maxCalls, maxUsd, policy: { ...policy, allowedExternal: policy.allowedExternal?.map((target) => ({ ...target })) },
      meter: { modelCalls: 0, modelReservedUsd: 0, externalCalls: 0, externalReservedUsd: 0 } }, fn);
  },
  withExternalTargets<T>(tenantId: string, targets: ExternalTarget[], fn: () => T): T {
    const held = proofSpend.getStore();
    if (!held || held.tenantId !== tenantId || targets.some((target) => target.capability !== "onpage_content_parsing" || !targetUrl(target.url))) throw new Error("invalid proof source scope");
    return proofSpend.run({ ...held, policy: { ...held.policy, allowedExternal: [...(held.policy.allowedExternal ?? []), ...targets.map((target) => ({ ...target }))] } }, fn);
  },
  activeFor(tenantId: string): boolean | null { if (noSpend.getStore() === true) return false; const held = proofSpend.getStore(); return held ? held.tenantId === tenantId : null; },
  externalClosed(tenantId: string, target?: ExternalTarget): boolean | null {
    if (noSpend.getStore() === true) return true;
    const held = proofSpend.getStore(); if (!held) return null;
    return held.tenantId !== tenantId || !target || !["onpage_rendered_html", "onpage_content_parsing"].includes(target.capability)
      || !held.policy.allowedExternal?.some((allowed) => allowed.capability === target.capability && targetUrl(allowed.url) === targetUrl(target.url));
  },
  authorize(tenantId: string, channel: "model" | "external", projectedUsd = 0, target?: ExternalTarget): boolean | null {
    if (noSpend.getStore() === true) return true;
    const held = proofSpend.getStore(); if (!held) return null;
    const calls = channel === "model" ? "modelCalls" : "externalCalls", usd = channel === "model" ? "modelReservedUsd" : "externalReservedUsd";
    const maxCalls = channel === "model" ? held.maxCalls : held.policy.maxExternalCalls, maxUsd = channel === "model" ? held.maxUsd : held.policy.maxExternalUsd;
    if (held.tenantId !== tenantId || held.policy.stopBy != null && Date.now() >= held.policy.stopBy || held.meter.externalReservedUsd > held.policy.maxExternalUsd
      || !Number.isFinite(projectedUsd) || projectedUsd <= 0 || held.meter[calls] >= maxCalls || held.meter[usd] + projectedUsd > maxUsd
      || channel === "external" && PROOF_SPEND.externalClosed(tenantId, target) !== false) return true;
    held.meter[calls] += 1; held.meter[usd] += projectedUsd; return false;
  },
  meter(tenantId: string): ProofMeter | null { const held = proofSpend.getStore(); return held?.tenantId === tenantId ? { ...held.meter } : null; },
  accountExternal(tenantId: string, estimatedUsd: number, knownUsd: number | null): void {
    const held = proofSpend.getStore();
    if (held?.tenantId === tenantId && knownUsd != null && Number.isFinite(knownUsd) && knownUsd > estimatedUsd) held.meter.externalReservedUsd += knownUsd - estimatedUsd;
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
