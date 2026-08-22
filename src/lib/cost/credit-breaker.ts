import "server-only";

/**
 * credit-breaker - THE account-level stop for "the OpenAI balance is empty".
 *
 * WHY IT IS NOT THE COST BREAKER NEXT DOOR. cost-breaker.ts refuses when WE have spent enough this month. This one
 * refuses when the PROVIDER says there is nothing left to spend: a `credit_balance_exhausted` (OpenAI's
 * `insufficient_quota`) is not a busy minute and retrying it buys nothing but another 429. Without a durable stop,
 * every lane (answer readback, competitor verdicts, every drafter) re-storms the same dead account on every pass,
 * which is exactly what 3 and 4 August did: 278 answers refused on a rate limit in one night.
 *
 * WHERE IT LIVES, with no new table and no migration: ONE row of the existing `llm_budget_ledger`, keyed
 * (tenant_id, 1970-01-01, "openai"), carrying `metadata.creditBreaker` and zero spend. Every spend read in this
 * codebase is either month-scoped (`date_utc >= this month`) or sums `spent_usd`, so a 1970 row with zero in it is
 * invisible to every cap while still being durable across lambdas.
 *
 * THE RECOVERY RULE, stated once: a trip holds every OpenAI-dependent call for 15 minutes; after that ONE probe call
 * is allowed through (its attempt is stamped BEFORE it is made, so a process that cannot write the stamp holds rather
 * than storms); a call that goes through clears the stop outright. There is no timed self-heal: only a real answer
 * from the provider ends the hold.
 *
 * WHY THIS IS TWO FUNCTIONS AND NOT ONE BOOLEAN (Codex, 2026-08-22, from a live receipt). `creditBreakerActive` both
 * ANSWERED and CONSUMED: asking it whether the account was held stamped the probe as a side effect. So an
 * orchestration precheck (a replenish drive, a producer's own guard) burned the one probe the cooldown had just
 * granted, and the real request behind it then read the fresh stamp and refused itself. Production shows exactly
 * that: probeAt advanced at 18:00 UTC and the OpenAI ledger never moved, because nothing ever asked OpenAI whether
 * the credit was back. The two acts are now named apart. `peek` is PURE and may be called by anyone, any number of
 * times: it reports `held`, `probe_due` or `clear` and writes nothing at all. `claimProbe` is the one that stamps,
 * and by contract only the transport calls it, immediately before network egress, so a due probe is spent on a real
 * provider request or on nothing. Every gate that can still refuse a call (cost breaker, monthly cap, schema) sits
 * BEFORE the claim for the same reason.
 *
 * WHAT THIS IS NOT, SAID PLAINLY RATHER THAN IMPLIED. (1) The probe is a read then a write, and those two steps are
 * not one atomic act across lambdas: there is no conditional-claim function for this row (the ledger has an atomic
 * `reserve_provider_spend`, but it reserves money, it does not claim a probe), and adding one is a migration this is
 * not worth. So the honest bound is roughly ONE probe per process that saw the same cooldown expire, not exactly one
 * globally: a handful of extra calls every 15 minutes against an account already known to be empty, which is the
 * storm this stops shrunk by three orders of magnitude, not a race left unmentioned. (2) The stop is keyed by TENANT
 * while the credential it protects is Beacon's own OpenAI account, so one account's empty balance holds only that
 * account's calls. That is exactly right today, when one Beacon account pays for one tenant. THE DEBT: the day a
 * second tenant shares this credential, the first tenant's trip must hold the second one's calls too, or the second
 * will keep storming the same dead balance. Whoever adds that tenant owns widening this key.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

/** How long a stop holds before ONE probe call is allowed through. */
const PROBE_COOLDOWN_MS = 15 * 60 * 1000;
/** The one row that holds the stop: a date no monthly read ever reaches, so it can never move a spend number. */
const STATE_DATE = "1970-01-01";
const PLATFORM = "openai";
const LEDGER = "llm_budget_ledger";

type CreditBreakerState = { trippedAt: string | null; probeAt: string | null };

type CreditBreakerDeps = {
  read: (tenantId: string) => Promise<CreditBreakerState | null>;
  write: (tenantId: string, state: CreditBreakerState | null) => Promise<boolean>;
  now: () => Date;
};

/**
 * PURE. What a stored stop means right now: held, or due one probe. Nothing on file is never a stop, so an account
 * that has never run out of credit pays no attention here at all.
 */
export function decideCreditBreaker(state: CreditBreakerState | null, now: Date): { active: boolean; probe: boolean } {
  const trippedAt = Date.parse(state?.trippedAt ?? "");
  if (!Number.isFinite(trippedAt)) return { active: false, probe: false };
  const probeAt = Date.parse(state?.probeAt ?? "");
  const lastAttempt = Math.max(trippedAt, Number.isFinite(probeAt) ? probeAt : trippedAt);
  return now.getTime() - lastAttempt >= PROBE_COOLDOWN_MS ? { active: false, probe: true } : { active: true, probe: false };
}

function underVitest(): boolean {
  return process.env.VITEST === "true";
}

/** The stop on file, or null. Never throws; an unreadable ledger reads as no stop, because the global cost breaker
 *  beside this one already fails closed on exactly that condition and two holds on one outage help nobody. */
async function readState(tenantId: string): Promise<CreditBreakerState | null> {
  if (underVitest() || !isSupabaseConfigured()) return null;
  try {
    const { data, error } = await getSupabaseAdmin().from(LEDGER).select("metadata")
      .eq("tenant_id", tenantId).eq("date_utc", STATE_DATE).eq("platform", PLATFORM).maybeSingle();
    if (error || !data) return null;
    const s = (data.metadata as { creditBreaker?: CreditBreakerState | null } | null)?.creditBreaker;
    return s?.trippedAt ? { trippedAt: String(s.trippedAt), probeAt: s.probeAt ? String(s.probeAt) : null } : null;
  } catch {
    return null;
  }
}

/** Persist (or clear) the stop. Returns whether it durably landed; the caller decides what a lost write means. */
async function writeState(tenantId: string, state: CreditBreakerState | null): Promise<boolean> {
  if (underVitest() || !isSupabaseConfigured()) return true;
  try {
    const { error } = await getSupabaseAdmin().from(LEDGER).upsert({
      tenant_id: tenantId, date_utc: STATE_DATE, platform: PLATFORM, spent_usd: 0, call_count: 0,
      metadata: { creditBreaker: state }, updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,date_utc,platform" });
    return !error;
  } catch {
    return false;
  }
}

const defaultDeps: CreditBreakerDeps = { read: readState, write: writeState, now: () => new Date() };

/** Accounts this PROCESS has seen a stop on file for, so a call that goes through only pays for a clearing write
 *  when there is actually something to clear. */
const stopOnFile = new Set<string>();

/** WHAT THIS ACCOUNT'S STOP MEANS RIGHT NOW. PURE: it reads, it decides, and it writes NOTHING, so asking the
 *  question can never spend the answer. `held` = refuse without calling. `probe_due` = the cooldown has elapsed and
 *  the next REAL request may try to clear it. `clear` = no stop on file, which is what almost every pass sees. */
async function creditBreakerPeek(tenantId: string, deps: Partial<CreditBreakerDeps> = {}): Promise<"clear" | "held" | "probe_due"> {
  const d = { ...defaultDeps, ...deps };
  const state = await d.read(tenantId).catch(() => null);
  if (state?.trippedAt) stopOnFile.add(tenantId); else stopOnFile.delete(tenantId);
  const verdict = decideCreditBreaker(state, d.now());
  return verdict.active ? "held" : verdict.probe ? "probe_due" : "clear";
}

/** CLAIM THE ONE PROBE, AND THEN CALL. The ONLY function here that writes a probe stamp, and the transport is the
 *  only caller: it runs immediately before the fetch, past every gate that could still refuse. True means this call
 *  may reach the provider. A stamp that could not be written returns false and keeps the hold, because an
 *  unrecordable probe is an unbounded retry loop wearing a probe's clothes. The read and the stamp are not one
 *  atomic act across lambdas (see the module note), so the honest bound stays roughly one probe per process. */
async function claimCreditProbe(tenantId: string, deps: Partial<CreditBreakerDeps> = {}): Promise<boolean> {
  const d = { ...defaultDeps, ...deps };
  const state = await d.read(tenantId).catch(() => null);
  const verdict = decideCreditBreaker(state, d.now());
  if (verdict.active) return false;
  if (!verdict.probe) return true;
  return await d.write(tenantId, { trippedAt: state?.trippedAt ?? null, probeAt: d.now().toISOString() }).catch(() => false);
}

/** The provider said the balance is empty. Hold every OpenAI-dependent call for this account until one goes through. */
async function tripCreditBreaker(tenantId: string, deps: Partial<CreditBreakerDeps> = {}): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  stopOnFile.add(tenantId);
  const landed = await d.write(tenantId, { trippedAt: d.now().toISOString(), probeAt: null }).catch(() => false);
  log.warn(`[credit-breaker] the OpenAI balance for this account is empty, so I am holding every call that needs it${landed ? "" : " (the hold could not be written down, so it lasts only as long as this process)"}`, { tenantId });
}

/** A call went through, so the balance is not empty. Clears the stop, and costs nothing when there was none. */
async function clearCreditBreaker(tenantId: string, deps: Partial<CreditBreakerDeps> = {}): Promise<void> {
  if (!stopOnFile.delete(tenantId) && deps.write === undefined) return;
  const d = { ...defaultDeps, ...deps };
  await d.write(tenantId, null).catch(() => false);
}

/** THE CREDIT STOP AS ONE SURFACE. Two readers and two writers, kept together so the asking and the spending of a
 *  probe can never drift apart again: `peek` answers, `claimProbe` spends, `trip` holds, `clear` releases. */
export const CREDIT_BREAKER = { peek: creditBreakerPeek, claimProbe: claimCreditProbe, trip: tripCreditBreaker, clear: clearCreditBreaker } as const;
