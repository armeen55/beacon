import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

/**
 * research-run - the durable, visit-driven Research Run record (Slice 4,
 * 2026-07-24). THE canonical type + repository for a resumable research cycle.
 *
 * At most ONE unfinished (running or paused) run per account across ALL dates (partial
 * unique index). Every visit claims through claim_research_run, which RESUMES the one
 * unfinished run regardless of cycle_key or start date, and starts a fresh daily cycle
 * (cycle_key "<tenant>:<UTC day>", computed at DATABASE time) only when none is open and
 * none completed this UTC day. A leased owner token makes exactly one invocation advance
 * the run; phase + cursor let a crash resume. The DATABASE lease is the correctness
 * mechanism - no scheduler, cron, heartbeat, queue.
 *
 * Persistence is a service-role Supabase repository behind an injectable seam (tests
 * inject an in-memory repo modeling the RPC contract). Every operation requires an
 * explicit tenantId and throws before any I/O when empty. An unavailable claim RPC
 * FAILS CLOSED (null, no background work); the render degrades to "none", never crashes.
 *
 * Migrations: 2026-07-24_research_runs.sql (table + RLS), _truth.sql (database-time
 * advance / renew / finish), _claim_semantics.sql (one open run + resume-first claim).
 */

// ── Canonical record ───────────────────────────────────────────────────────

/** The ordered phases of one Research Run. `done` is terminal. The four evidence phases (Slice 6) sit between
 *  the connector work and the surface publish: keyword discovery, AI observation, SERPs, winning pages. */
export type ResearchPhase =
  | "refresh_sources"
  | "gsc_backfill_chunk"
  | "keyword_discovery"
  | "prompt_observations"
  | "serp_analysis"
  | "winning_pages"
  | "publish_surface"
  | "done";

/** Three honestly-produced states only: a transient phase failure PAUSES with a bounded last_error
 *  (recoverable next visit), never a terminal `failed`. Completion means every phase succeeded or no-opped. */
type ResearchRunStatus = "running" | "paused" | "completed";

/** Evidence-based counters only, never a fabricated number. `refreshedProviders` is the set of providers
 *  that actually synced this cycle (unioned across retries); `sourcesRefreshed` is that set's size. */
export type ResearchRunProgress = {
  refreshedProviders?: string[];
  sourcesRefreshed?: number;
  backfill?: { ran: boolean; complete?: boolean; daysPulled?: number };
  /** THIS run's frozen INVESTIGATION, chosen ONCE at the results-page phase and reused unchanged by
   *  winning-pages, the comparison and the verdict: the ordered topic, the exact search it owes when a
   *  search is what it owes, the typed requirement that was open, and the basis it was all chosen under.
   *  Freezing the STRINGS alone let a second independent pick buy a comparison for a DIFFERENT topic than
   *  the searches were bought for. Durable on progress (the phase advance clears the cursor), dies with the run. */
  /** `retryAfter` is the earliest moment that topic may legally be read again (a page of yours that did not
   *   answer, a winning page due tomorrow). It is carried, not recomputed: it decides both what this run may
   *   still search for and what Today is allowed to call "checking". Null = nothing is waiting on it. */
  /** `ownedUrl` is the page of the ACCOUNT'S OWN that topic cannot be judged without. Decision NAMES it and
   *   never fetches it; the page phase reads at most one per run, under this run's live lease. */
  focus?: { basis: string | null; topics: Array<{ topicKey: string | null; query: string | null; requirement: string | null; retryAfter?: string | null; ownedUrl?: string | null }> };
  /** LEGACY, read-only: a run frozen before `focus` existed carries only its query strings. Never written now. */
  surfacePublished?: boolean;
  /** The operator's durable ask for extra readings of today's AI answers: the day and how many EXTRA readings per pair were granted (max two); the press and the pass that acts on it are two requests.
   *  And whether this run already attempted its ONE advisory reading of the case registry: reconciliation runs before every unit, so without a marker of its own that reading was bounded per iteration. */
  extraSamples?: { day: string; granted: number };
  synthesisAttempted?: boolean;
  /** THE DAY THIS RUN COULD NOT BUY A CASE'S COMPETING DOMAINS because the spending ceiling was
   *  reached, and which cases those were. Day-scoped exactly like the extra-sample grant, so it
   *  clears by rollover rather than by a cleanup nobody runs, and the case receipt can say
   *  "capped" about the pass that was actually capped instead of about every pass since. */
  capped?: { day: string; caseIds: string[] };
  /** How many continuation hops this account has already been given on `day`. SERVER-COUNTED: the
   *  hop number a browser sends back is a number it made up, so the bound that stops a live tab
   *  looping forever cannot be built on it. Day-scoped like the grant above, and inherited by every
   *  pass that opens the same day, so a new row never hands out a fresh allowance. */
  continuations?: { day: string; count: number };
  /** The watermark the LAST decide-and-publish pass ran against: which basis, and which version
   *  of the research notes. Notes that moved past it are new evidence, which is what makes a
   *  second pass on the same day legitimate instead of redundant. */
  decided?: { basis: string; rowVersion: number };
  /** PROGRESS AS PERSISTED TRUTH, so every surface reads the same numbers on every request. It
   *  used to be assembled per render from whatever was in hand, including the lease, so two
   *  requests a second apart could disagree about whether research was running. Written by the
   *  run itself from the due-work read it already made; nothing here is derived at render time. */
  state?: {
    /** Today's AI checks, from the planner: landed of owed. */
    checksDone?: number; checksTotal?: number;
    /** The frozen plan's topics: readable now, and waiting on a promised date. */
    casesActive?: number; casesParked?: number;
    /** The earliest date something waiting becomes legal again, when everything is waiting. */
    nextDueAt?: string | null;
    /** The pause vocabulary, persisted beside the numbers it explains. */
    blocker?: string | null;
  };
  /** Slice 6: real persisted funnel counters (never fabricated). */
  funnel?: {
    rawKeywords?: number; normalizedKeywords?: number; retainedKeywords?: number;
    rejectedKeywords?: number; promptsChecked?: number; enginePairsDone?: number;
    enginePairsIntended?: number; serpsAnalyzed?: number; pageReadsAttempted?: number; answersAnalyzed?: number;
    cacheHits?: number; spendUsd?: number;
  };
};

/** Bounded error info stored on last_error when a phase pauses (throw or returned failure).
 *  `failures` carries per-source connector detail on a partial refresh. */
export type ResearchRunError = {
  phase: ResearchPhase;
  message: string;
  at: string;
  failures?: Array<{ provider: string; detail: string }>;
};

/** Mirrors the research_runs row (snake_case, like refresh-runs-store). */
export type ResearchRun = {
  id: string;
  tenant_id: string;
  cycle_key: string;
  status: ResearchRunStatus;
  current_phase: ResearchPhase;
  phase_cursor: Record<string, unknown> | null;
  progress: ResearchRunProgress;
  spend_usd: number;
  last_error: ResearchRunError | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

/** Lease length for one claimed cycle. Renewed at DATABASE time BEFORE every bounded phase
 *  (renew_research_lease) so no phase inside the 210s cycle deadline can knowingly outlive its lease. */
export const RESEARCH_RUN_LEASE_SECONDS = 240;

// The operator-facing projection lives in run-status (the record and the way it READS are two
// jobs). Re-exported here so every existing caller keeps its one import.
export { nextPhase, projectStatusView, researchStatusLine, type ResearchRunStatusView } from "./run-status";
import { projectStatusView, type ResearchRunStatusView } from "./run-status";

// ── Pure helpers ───────────────────────────────────────────────────────────

function requireTenant(tenantId: string): string {
  if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw new Error("[research-run] tenantId is required");
  }
  return tenantId;
}

/** A fresh, globally-unique owner token for one invocation's lease. */
export function newOwnerToken(): string {
  return randomUUID();
}

/** Stable JSON: object keys sorted recursively, so an identical cursor always
 *  hashes to the identical key across retries regardless of insertion order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Deterministic idempotency key for one phase attempt, SCOPED to the account +
 * run + phase + cursor. Identical across retries of the same attempt; different
 * across phases, cursors, and accounts. Stored into phase_cursor for future paid
 * phases so a retry can prove it is the same unit of work.
 */
export function phaseIdempotencyKey(
  tenantId: string,
  runId: string,
  phase: ResearchPhase,
  cursor: Record<string, unknown> | null,
): string {
  return `rr_${createHash("sha256")
    .update([requireTenant(tenantId), runId, phase, stableStringify(cursor ?? {})].join("\x00"))
    .digest("hex")
    .slice(0, 32)}`;
}


// ── Repository (injected; production = Supabase) ───────────────────────────

type AdvancePatch = {
  phase: ResearchPhase;
  cursor?: Record<string, unknown> | null;
  progress?: ResearchRunProgress;
};

export type ResearchRunRepo = {
  /** Atomic claim/resume/create for the account. Resumes the single unfinished run
   *  regardless of date; creates today's cycle only when none is open and none
   *  completed this UTC day (the database computes the daily key). Returns the
   *  claimed row, or null when the caller did not win (foreign unexpired lease, or
   *  research already current for today). */
  claim(input: { tenantId: string; owner: string; leaseSeconds: number }): Promise<ResearchRun | null>;
  /** Open ANOTHER pass on a day that already completed one, for an account with genuinely due
   *  work. Returns the new leased row, or null when it must not run: the one-open-run-per-account
   *  index refuses the insert while any run is unfinished, so a second tab, a second instance and
   *  a still-live pass all lose this race by construction rather than by a check. */
  startPass(input: { tenantId: string; owner: string; leaseSeconds: number; day: string }): Promise<ResearchRun | null>;
  /** Guarded advance at DATABASE time (id + tenant + owner + a LIVE lease +
   *  status='running'). Extends the lease. Returns whether a row matched; false ⇒
   *  our lease was lost or expired. */
  advance(input: { tenantId: string; id: string; owner: string; leaseSeconds: number; patch: AdvancePatch }): Promise<boolean>;
  /** Guarded lease renewal at DATABASE time (same guards as advance) that also
   *  persists the pre-phase attempt identity (phase_cursor) WITHOUT changing the
   *  phase. Returns whether our lease still held; false ⇒ abort before the side
   *  effect. */
  renew(input: { tenantId: string; id: string; owner: string; leaseSeconds: number; cursor: Record<string, unknown> | null }): Promise<boolean>;
  /** Guarded terminal update at DATABASE time (releases the lease). 'completed'
   *  clears last_error; 'paused' records it. Returns whether a row matched. */
  finish(input: {
    tenantId: string;
    id: string;
    owner: string;
    outcome: Exclude<ResearchRunStatus, "running">;
    errorInfo?: ResearchRunError | null;
  }): Promise<boolean>;
  /** Latest run for the tenant by started_at desc, or null. */
  latest(tenantId: string): Promise<ResearchRun | null>;
  /** This account's rows for ONE reporting day, newest first, lean (id + progress). It answers both
   *  questions a day asks: how many passes have already opened today, and what day-scoped state a
   *  new one inherits. */
  sameDay(input: { tenantId: string; day: string; limit: number }): Promise<Array<{ id: string; progress: ResearchRunProgress }>>;
  /** Count ONE continuation hop for `day` on the account's latest row and return the day's new
   *  total, or null when it could not be counted (no row yet, or the write did not land). */
  countContinuation(input: { tenantId: string; day: string }): Promise<number | null>;
};

function mapRow(r: Record<string, unknown>): ResearchRun {
  return {
    id: String(r.id), tenant_id: String(r.tenant_id), cycle_key: String(r.cycle_key),
    status: r.status as ResearchRunStatus, current_phase: r.current_phase as ResearchPhase,
    phase_cursor: (r.phase_cursor as Record<string, unknown> | null) ?? null,
    progress: (r.progress as ResearchRunProgress | null) ?? {}, spend_usd: Number(r.spend_usd ?? 0),
    last_error: (r.last_error as ResearchRunError | null) ?? null,
    lease_owner: (r.lease_owner as string | null) ?? null, lease_expires_at: (r.lease_expires_at as string | null) ?? null,
    started_at: String(r.started_at), updated_at: String(r.updated_at ?? r.started_at),
    completed_at: (r.completed_at as string | null) ?? null,
  };
}

/** Every guarded mutation is one RPC that answers true when a row matched. */
async function rpcBool(fn: string, args: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc(fn, args);
  if (error != null) throw new Error(error.message ?? String(error));
  return data === true;
}

const supabaseRepo: ResearchRunRepo = {
  async claim({ tenantId, owner, leaseSeconds }) {
    const { data, error } = await getSupabaseAdmin()
      .rpc("claim_research_run", { p_tenant_id: tenantId, p_owner: owner, p_lease_seconds: leaseSeconds });
    if (error != null) throw new Error(error.message ?? String(error));
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return rows.length > 0 ? mapRow(rows[0]!) : null;
  },
  async startPass({ tenantId, owner, leaseSeconds, day }) {
    const admin = getSupabaseAdmin();
    // The pass ordinal keeps (tenant, cycle_key) unique for a second pass on the same day, and the
    // key still ENDS in the day because the reporting day is read off its tail: a pass that spans
    // midnight must keep reporting into the day it opened.
    const { count } = await admin.from("research_runs").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).like("cycle_key", `%${day}`);
    const { data, error } = await admin.from("research_runs").insert({
      tenant_id: tenantId, cycle_key: `${tenantId}:p${(count ?? 1) + 1}:${day}`, status: "running",
      current_phase: "refresh_sources", lease_owner: owner,
      lease_expires_at: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
    }).select("*").maybeSingle();
    // A unique violation is the expected LOSS (another pass is open, or another tab inserted
    // first), never an error worth surfacing: the caller simply does nothing.
    if (error != null || data == null) return null;
    return mapRow(data as Record<string, unknown>);
  },
  async advance({ tenantId, id, owner, leaseSeconds, patch }) {
    return rpcBool("advance_research_run", { p_tenant_id: tenantId, p_run_id: id, p_owner: owner,
      p_next_phase: patch.phase, p_progress: patch.progress ?? null, p_cursor: patch.cursor ?? null, p_lease_seconds: leaseSeconds });
  },
  async renew({ tenantId, id, owner, leaseSeconds, cursor }) {
    return rpcBool("renew_research_lease", { p_tenant_id: tenantId, p_run_id: id, p_owner: owner, p_cursor: cursor ?? null, p_lease_seconds: leaseSeconds });
  },
  async finish({ tenantId, id, owner, outcome, errorInfo }) {
    return rpcBool("finish_research_run", { p_tenant_id: tenantId, p_run_id: id, p_owner: owner, p_outcome: outcome, p_error: errorInfo ?? null });
  },
  async latest(tenantId) {
    const { data, error } = await getSupabaseAdmin().from("research_runs").select("*")
      .eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (error != null) throw new Error(error.message ?? String(error));
    return data ? mapRow(data as Record<string, unknown>) : null;
  },
  // The reporting day rides on the TAIL of both cycle-key shapes (the daily "<tenant>:<day>" and an
  // extra pass's "<tenant>:p<n>:<day>"), which is exactly why it lives there.
  async sameDay({ tenantId, day, limit }) {
    const { data, error } = await getSupabaseAdmin().from("research_runs").select("id,progress")
      .eq("tenant_id", tenantId).like("cycle_key", `%${day}`).order("started_at", { ascending: false }).limit(limit);
    if (error != null) throw new Error(error.message ?? String(error));
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ id: String(r.id), progress: (r.progress as ResearchRunProgress | null) ?? {} }));
  },
  async countContinuation({ tenantId, day }) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("research_runs").select("id,progress")
      .eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (error != null || data == null) return null;
    const row = data as { id: string; progress: ResearchRunProgress | null }, held = row.progress?.continuations;
    const count = (held?.day === day ? held.count : 0) + 1;
    const { error: failed } = await admin.from("research_runs")
      .update({ progress: { ...(row.progress ?? {}), continuations: { day, count } } }).eq("tenant_id", tenantId).eq("id", row.id);
    return failed == null ? count : null;
  },
};

let repo: ResearchRunRepo = supabaseRepo;

/** Tests inject an in-memory repo modeling the RPC contract; null restores prod. */
export function setResearchRunRepoForTests(next: ResearchRunRepo | null): void {
  repo = next ?? supabaseRepo;
}

// ── The reporting day's own memory ─────────────────────────────────────────

/** How many research passes ONE account may open in ONE reporting day. A topic that can never be
 *  satisfied reads as genuinely due on every look, so without a ceiling every navigation all day
 *  opened another full pass on it. Past the ceiling I say so and open nothing until the day rolls. */
const MAX_PASSES_PER_DAY = 8;

type DayRow = { id: string; progress: ResearchRunProgress };

/** THE DAY'S STATE BELONGS TO THE DAY, NOT TO A ROW. Both row-creating paths (the fresh daily claim and
 *  an extra pass) are born with progress {}, so the operator's extra-sample grant, the ceiling marker,
 *  the advisory-reading receipt and the decide watermark all died the moment the pass they justified
 *  opened: the planner reads the LATEST row, so the grant that bought the pass was orphaned by it, and a
 *  vanished watermark made deciding due forever. Inherited here from the passes that already ran the SAME
 *  reporting day; the day-stamped markers only when they name that day, so they still clear by rollover. */
function carriedDayState(priors: readonly ResearchRunProgress[], day: string): ResearchRunProgress {
  const out: ResearchRunProgress = {};
  for (const p of priors) {
    if (out.decided == null && p.decided != null) out.decided = p.decided;
    if (out.extraSamples == null && p.extraSamples?.day === day) out.extraSamples = p.extraSamples;
    if (out.capped == null && p.capped?.day === day) out.capped = p.capped;
    if (out.continuations == null && p.continuations?.day === day) out.continuations = p.continuations;
    if (out.synthesisAttempted !== true && p.synthesisAttempted === true) out.synthesisAttempted = true;
  }
  return out;
}

/** Persist the inherited state onto the row we just took, under the lease we took with it. The row's OWN
 *  progress always wins, and a carry that could not be written leaves the row exactly as the database made it. */
async function inheritDayState(run: ResearchRun, owner: string, priors: readonly DayRow[]): Promise<ResearchRun> {
  const carried = carriedDayState(priors.filter((p) => p.id !== run.id).map((p) => p.progress), run.cycle_key.slice(-10));
  if (Object.keys(carried).length === 0) return run;
  const progress: ResearchRunProgress = { ...carried, ...(run.progress ?? {}) };
  const saved = await repo.advance({ tenantId: run.tenant_id, id: run.id, owner, leaseSeconds: RESEARCH_RUN_LEASE_SECONDS,
    patch: { phase: run.current_phase, cursor: run.phase_cursor, progress } }).catch(() => false);
  return saved ? { ...run, progress } : run;
}

/** Inherit the day's state, but ONLY for a row that cannot already know it: a resumed run carrying any of
 *  it IS the day's memory and pays for no read. */
async function withDayState(run: ResearchRun, owner: string): Promise<ResearchRun> {
  const p = run.progress ?? {};
  if (p.decided != null || p.extraSamples != null || p.capped != null || p.continuations != null || p.synthesisAttempted != null) return run;
  const priors = await repo.sameDay({ tenantId: run.tenant_id, day: run.cycle_key.slice(-10), limit: MAX_PASSES_PER_DAY * 2 })
    .catch(() => [] as DayRow[]);
  return inheritDayState(run, owner, priors);
}

// ── Public operations (explicit tenant, fail-closed) ───────────────────────

/**
 * Claim, resume, or start the account's Research Run with our owner token. The database
 * resumes the single unfinished run (any date) before considering a new daily cycle, and
 * computes the daily key itself.
 *
 * A REFUSAL AND A FAILURE ARE DIFFERENT ANSWERS, and this is the one place that can tell
 * them apart. `null` means the database refused us honestly (a foreign unexpired lease, or
 * a pass already completed today), which is the case a caller may reason further about. A
 * THROW means the claim could not be made at all, and there is nothing to reason about: the
 * caller fails closed and no background work runs. Collapsing the two let an unavailable
 * database read as "today is done", which would have opened a pass on a guess.
 */
export async function claimRun(tenantId: string, ownerToken: string): Promise<ResearchRun | null> {
  requireTenant(tenantId);
  try {
    const run = await repo.claim({ tenantId, owner: ownerToken, leaseSeconds: RESEARCH_RUN_LEASE_SECONDS });
    // A row born blank inherits what the day already knows, before any phase reads it.
    return run == null ? null : await withDayState(run, ownerToken);
  } catch (error) {
    log.warn("[research-run] claim failed; fail closed (no background work)", { tenantId, error: error instanceof Error ? error.message : String(error) });
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Open ANOTHER pass on a day that already completed one. The caller must already know work is
 * genuinely due (see due-work): a day is not a unit of work, but nor is a visit, so nothing here
 * decides that question. Returns the claimed row, or null when a pass must not open (any
 * unfinished run, a concurrent tab, the day's pass ceiling, or unavailable persistence). Never throws.
 *
 * THE DAY HAS A CEILING. "Due" is computed from persisted state, and some state stays due however
 * often it is looked at, so a due list that cannot be cleared used to open a full pass on every
 * navigation for the rest of the day. MAX_PASSES_PER_DAY is the honest stop.
 */
export async function startExtraPass(tenantId: string, ownerToken: string, day: string): Promise<ResearchRun | null> {
  requireTenant(tenantId);
  try {
    const priors = await repo.sameDay({ tenantId, day, limit: MAX_PASSES_PER_DAY * 2 });
    if (priors.length >= MAX_PASSES_PER_DAY) { // the honest ceiling, not a claim that nothing is due
      log.info("[research-run] this account has opened all of today's research passes; the next one opens tomorrow", { tenantId, day, passes: priors.length });
      return null;
    }
    const run = await repo.startPass({ tenantId, owner: ownerToken, leaseSeconds: RESEARCH_RUN_LEASE_SECONDS, day });
    return run == null ? null : await inheritDayState(run, ownerToken, priors);
  } catch (error) {
    log.warn("[research-run] extra same-day pass could not open; nothing runs", { tenantId, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Advance the claimed run to a new phase (owner-guarded). Returns true when our
 * lease still held and the row was updated; false when the lease was lost (a
 * concurrent instance recovered our expired lease) - the caller must abort.
 */
export async function advancePhase(tenantId: string, runId: string, ownerToken: string, patch: AdvancePatch): Promise<boolean> {
  requireTenant(tenantId);
  try { return await repo.advance({ tenantId, id: runId, owner: ownerToken, leaseSeconds: RESEARCH_RUN_LEASE_SECONDS, patch }); }
  catch (error) {
    log.warn("[research-run] advancePhase failed", { tenantId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Renew our lease AND persist the pre-phase attempt identity (cursor) at DATABASE time,
 * owner-guarded, WITHOUT changing the phase. Called BEFORE each phase side effect: false
 * ⇒ our lease was lost or expired, so the caller aborts before any side-effecting work.
 * Never throws to the caller.
 */
export async function renewLease(tenantId: string, runId: string, ownerToken: string, cursor: Record<string, unknown> | null): Promise<boolean> {
  requireTenant(tenantId);
  try { return await repo.renew({ tenantId, id: runId, owner: ownerToken, leaseSeconds: RESEARCH_RUN_LEASE_SECONDS, cursor }); }
  catch (error) {
    log.warn("[research-run] renewLease failed", { tenantId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Terminal update for the run (owner-guarded), releasing the lease. Returns
 * whether our lease still held. Never throws to the caller.
 */
export async function finishRun(
  tenantId: string, runId: string, ownerToken: string,
  outcome: Exclude<ResearchRunStatus, "running">, errorInfo?: ResearchRunError | null,
): Promise<boolean> {
  requireTenant(tenantId);
  try { return await repo.finish({ tenantId, id: runId, owner: ownerToken, outcome, errorInfo: errorInfo ?? null }); }
  catch (error) {
    log.warn("[research-run] finishRun failed", { tenantId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Count ONE continuation hop for this reporting day, SERVER-SIDE, and return the day's new total. The
 * hop a browser sends back is a number it made up, so a tab that kept claiming hop 0 bought itself an
 * unbounded chain of research requests. The count lives on the account's own row and is inherited by
 * every pass that opens the same day, so a new row hands out no fresh allowance. Null = it could not be
 * counted (no row yet, or the write did not land), which the caller treats as its own first hop rather
 * than as permission to loop. Never throws.
 */
export async function countContinuationHop(tenantId: string, day: string): Promise<number | null> {
  requireTenant(tenantId);
  try { return await repo.countContinuation({ tenantId, day }); }
  catch (error) {
    log.warn("[research-run] continuation hop could not be counted", { tenantId, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** The compact Today projection: latest run for the tenant, projected to the status
 *  view. Bounded + fail-soft - any error (unavailable persistence) ⇒ "none", so the
 *  status line simply renders nothing. */
export async function researchRunStatus(tenantId: string, now: Date = new Date()): Promise<ResearchRunStatusView> {
  try {
    requireTenant(tenantId);
    const run = await repo.latest(tenantId);
    return projectStatusView(run, now.getTime());
  } catch (error) {
    log.warn("[research-run] status read failed; rendering none", { tenantId, error: error instanceof Error ? error.message : String(error) });
    return projectStatusView(null, now.getTime());
  }
}
