/** lib/spend-scope - THE FAIL-CLOSED SPEND BOUNDARY, held on the call stack rather than passed hand to hand.
 *
 *  Pausing research stopped the research cycle and stopped nothing else. Three doors into the paid drafter
 *  stayed open (a stale Today visit, a stale Changes visit and the cache warmer all rebuild the customer
 *  surface, which runs the proposal producer), and on 2026-08-19 Decision side model spend landed at 23:08
 *  UTC on a paused account, five hours after the last research run had finished. Bounding one budget pool and
 *  threading a flag through six producers is how that happened: every new path has to remember, and one
 *  forgetting costs real money.
 *
 *  So the rule is ambient and structural. A caller opens a no-spend scope once, and every paid door inside it
 *  refuses on its own, whatever imported it and however deep it sits: the model gateway and the provider call
 *  both ask this before a client is constructed or a byte leaves. Nothing is threaded, so nothing can be
 *  forgotten, and a path added later inherits the refusal instead of paying.
 *
 *  A refusal is a typed state the caller already handles, never a throw: "did not buy" must never read as
 *  "this pass failed", and it must never take back work a paid pass already banked. */
import { AsyncLocalStorage } from "node:async_hooks";

const noSpend = new AsyncLocalStorage<true>();

/** Run `fn` with every paid door inside it closed, however deeply it is reached. */
export function runWithoutSpending<T>(fn: () => T): T {
  return noSpend.run(true, fn);
}

/** Is buying refused on this call stack right now? Asked by the paid door itself, before it opens. */
export function spendingRefused(): boolean {
  return noSpend.getStore() === true;
}

/** THE PAUSE, ASKED AT THE DOOR ITSELF. The ambient scope closes every caller that opened one, and the leak
 *  proved that is not enough: a paid path nobody wrapped (the competitor overlap judgment behind Update data)
 *  kept buying on a paused account. So the two paid doors now also ask the account's own switch, HERE, so a
 *  caller added tomorrow inherits the refusal without anyone remembering to open a scope. Memoized briefly so
 *  a drafting pass does not turn one pause bit into dozens of reads. An UNREADABLE switch counts as paused:
 *  the expensive assumption is never the safe one. Hermetic under vitest exactly as checkBudget is: unit
 *  tests never read a live tenants table, and a test that pins the pause injects the probe. */
type PauseProbe = (tenantId: string) => Promise<boolean>;
let probeForTests: PauseProbe | null = null;
export function setSpendPauseProbeForTests(probe: PauseProbe | null): void { probeForTests = probe; }
const pauseMemo = new Map<string, { at: number; paused: boolean }>();
const PAUSE_MEMO_MS = 60_000;

export async function spendingClosed(tenantId: string): Promise<boolean> {
  if (noSpend.getStore() === true) return true;
  if (probeForTests) return probeForTests(tenantId);
  if (process.env.VITEST) return false;
  const held = pauseMemo.get(tenantId), now = Date.now();
  if (held && now - held.at < PAUSE_MEMO_MS) return held.paused;
  try {
    const { getSupabaseAdmin } = await import("./persistence/supabase");
    const { data, error } = await getSupabaseAdmin().from("tenants").select("research_paused").eq("id", tenantId).maybeSingle();
    if (error != null) return true;
    const paused = (data as { research_paused?: boolean } | null)?.research_paused === true;
    pauseMemo.set(tenantId, { at: now, paused });
    return paused;
  } catch {
    return true;
  }
}
