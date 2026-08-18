import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import type { DuePhase } from "./ops/due-work";

/** research-run - the durable Research Run record (Slice 4, 2026-07-24). THE canonical type + repository for a resumable research cycle. At most ONE unfinished (running or paused) run per account
 *  across ALL dates (partial unique index). Two doors claim through claim_research_run: the global daily scheduler (claim_due_research_work, one bounded dispatch for every account whose reporting day
 *  still owes work: src/lib/reporting-day.ts is the ONE timezone contract) and any visit, which recovers and resumes whatever the scheduler left. Both RESUME the one unfinished run regardless of
 *  cycle_key or start date, and start a fresh daily cycle (cycle_key "<tenant>:<day>", at DATABASE time) only when none is open and none completed that day. THE DATABASE LEASE DECIDES WHO ADVANCES A
 *  RUN: a dispatch and a visit racing the same account cannot both proceed. Persistence is a service-role Supabase repository behind an injectable seam (tests inject an in-memory repo modeling the
 *  RPC contract). Every operation requires an explicit tenantId and throws before any I/O when empty. An unavailable claim RPC FAILS CLOSED (null, no background work); the render degrades to "none".
 *  Migrations: 2026-07-24_research_runs.sql (table + RLS), _truth.sql (database-time advance / renew / finish), _claim_semantics.sql (one open run + resume-first claim), 2026-08-02_progress_patch_rpc.sql
 *  (the one atomic progress merge, so two writers cannot erase each other's keys), 2026-08-03_claim_due_research_work.sql (the fleet enumeration + the research-paused switch). */

// ── Canonical record ───────────────────────────────────────────────────────

/** The ordered phases of one Research Run. `done` is terminal. The four evidence phases (Slice 6) sit between
 *  the connector work and the surface publish: keyword discovery, AI observation, SERPs, winning pages.
 *  crawl_pages reads ONE bounded batch of the account's own website per pass (a render never crawls). */
export type ResearchPhase =
  | "refresh_sources"
  | "gsc_backfill_chunk"
  | "crawl_pages"
  | "keyword_discovery"
  | "prompt_observations"
  | "serp_analysis"
  | "winning_pages"
  // CHECKING WHAT THIS ACCOUNT'S OWN PAGES CLAIM against sources outside them. A real phase because a
  // correction whose research nothing in production can acquire, refresh or retire is a demonstration
  // (Codex, 2026-08-18), and a phase is what gives it an owner, a budget and a place in the run.
  | "fact_check"
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
   *  winning-pages, the comparison and the verdict: the ordered topic, the exact search it owes, the typed
   *  requirement that was open, and the basis it was all chosen under. A second independent pick would buy a
   *  comparison for a DIFFERENT topic than the searches were bought for. Durable on progress (the phase
   *  advance clears the cursor), dies with the run. `retryAfter` is the earliest moment that topic may
   *  legally be read again; it is carried, not recomputed, and it decides both what this run may still
   *  search for and what Today may call "checking". `ownedUrl` is the page of the ACCOUNT'S OWN that topic
   *  cannot be judged without: Decision NAMES it and never fetches it, one read per run under this lease. */
  focus?: { basis: string | null; topics: Array<{ topicKey: string | null; query: string | null; requirement: string | null; retryAfter?: string | null; ownedUrl?: string | null }> };
  surfacePublished?: boolean;
  /** How many of this page's statements the fact-check phase banked against outside sources. */
  factsChecked?: number;
  /** WHY THIS PASS WAS OPENED, and therefore WHAT IT OWES. Due-work decides whether another pass runs; without
   *  its answer on the row the executor traversed the whole cycle whatever the debt was, so a pass opened to
   *  read stored answers re-ran keyword discovery, results pages, winner reads, a crawl and a publication and
   *  spent real money on research nobody asked for. A recovery pass carries the exact units due-work named
   *  when it opened and SKIPS every phase outside them. Absent on the day's first genuine run, which still
   *  walks the full ordered sequence. It rides progress (an existing jsonb column), so no schema moves. */
  plan?: { units: DuePhase[] };
  /** The operator's durable ask for extra readings of today's AI answers: the day and how many EXTRA readings per pair were granted (max two); the press and the pass that acts on it are two requests.
   *  And whether this run already attempted its ONE advisory reading of the case registry: reconciliation runs before every unit, so without a marker of its own that reading was bounded per iteration. */
  extraSamples?: { day: string; granted: number };
  synthesisAttempted?: boolean;
  /** THE DAY THIS RUN COULD NOT BUY A CASE'S COMPETING DOMAINS because the spending ceiling was reached, and
   *  which cases those were. Day-scoped like the extra-sample grant, so it clears by rollover and the case
   *  receipt says "capped" about the pass that was actually capped, not about every pass since. */
  capped?: { day: string; caseIds: string[] };
  /** How many continuation hops this account has already been given on `day`. SERVER-COUNTED at database
   *  time (patch_research_run_progress increments it inside the update): the hop a browser sends back is a
   *  number it made up. Day-scoped and inherited by every pass that opens the same day, so a new row never
   *  hands out a fresh allowance. Browser recovery only: the daily scheduler never uses hops. */
  continuations?: { day: string; count: number };
  observationRetries?: { day: string; counts: Record<string, number> }; // how many times each broken question and engine pair has been asked AGAIN today (daily-observations owns the rule); day-scoped and inherited exactly like the markers above, so a provider that refuses one engine all day is not re-bought on every pass forever
  /** The watermark the LAST decide-and-publish pass ran against: which basis, and which version
   *  of the research notes. Notes that moved past it are new evidence, which is what makes a
   *  second pass on the same day legitimate instead of redundant. */
  decided?: { basis: string; rowVersion: number };
  /** PROGRESS AS PERSISTED TRUTH, so every surface reads the same numbers on every request: written by the
   *  run itself from the due-work read it already made, never derived at render time. */
  state?: {
    /** Today's AI checks from the planner: SETTLED of owed, then how those settled (an answer, an engine that had nothing to give, an engine I cannot ask at all). */
    checksDone?: number; checksTotal?: number; checksAnswers?: number; checksUnavailable?: number; checksUnsupported?: number;
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
    /** WHAT THE READING PASSES ACTUALLY DID, beside how many landed: how many stored answers they took on and how many came back as a
     *  non-reading. A bare zero cannot tell a quiet day from a pass that took forty answers on and could store none of them, and that is
     *  precisely the shape a run sitting in one phase for ten hours wears, so both numbers go on the row rather than into a log line. */
    answersAttempted?: number; answersRefused?: number;
    /** WHY THE ATTEMPTED AND THE READ ARE DIFFERENT NUMBERS, summed across this run's reading passes: one bucket per answer taken on, and the buckets add up to
     *  answersAttempted. A reader of the row can tell a reader that refused from a shape nobody could use, from a write that was lost, from a pass that stopped
     *  before it asked anything. Without it "505 taken on, 0 read" carried no explanation anywhere, on the row or off it. */
    answersOutcomes?: Record<string, number>;
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
  if (typeof tenantId !== "string" || tenantId.trim().length === 0) throw new Error("[research-run] tenantId is required");
  return tenantId;
}

/** A fresh, globally-unique owner token for one invocation's lease. */
export function newOwnerToken(): string { return randomUUID(); }

/** Stable JSON: object keys sorted recursively, so an identical cursor always
 *  hashes to the identical key across retries regardless of insertion order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Deterministic idempotency key for one phase attempt, SCOPED to the account + run + phase + cursor.
 *  Identical across retries of the same attempt; different across phases, cursors and accounts. Stored into
 *  phase_cursor so a paid retry can prove it is the same unit of work. */
export function phaseIdempotencyKey(
  tenantId: string, runId: string, phase: ResearchPhase, cursor: Record<string, unknown> | null,
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
  /** Atomic claim/resume/create for the account. Resumes the single unfinished run regardless of date;
   *  creates today's cycle only when none is open and none completed that day (the database computes the
   *  key). Null = the caller did not win (a foreign unexpired lease, or research already current today). */
  claim(input: { tenantId: string; owner: string; leaseSeconds: number }): Promise<ResearchRun | null>;
  /** THE FLEET DOOR (claim_due_research_work). Enumerates every ACTIVE, not-research-paused account whose
   *  current Pacific day still owes work and claims up to `limit` of them THROUGH the same claim above, so
   *  the advisory lock and the one-open-run index stay the single mechanism. An account another dispatcher
   *  or a visit already holds is simply absent from the result. */
  claimDue(input: { owner: string; limit: number; leaseSeconds: number }): Promise<ResearchRun[]>;
  /** Open ANOTHER pass on a day that already completed one, for an account with genuinely due work. Null =
   *  it must not run: the one-open-run-per-account index refuses the insert while any run is unfinished.
   *  `progress` is what the opener already knows (the plan it opened on), written with the row itself. */
  startPass(input: { tenantId: string; owner: string; leaseSeconds: number; day: string; progress?: ResearchRunProgress }): Promise<ResearchRun | null>;
  /** Guarded advance at DATABASE time (id + tenant + owner + a LIVE lease + status='running'). Extends the
   *  lease. False ⇒ our lease was lost or expired. */
  advance(input: { tenantId: string; id: string; owner: string; leaseSeconds: number; patch: AdvancePatch }): Promise<boolean>;
  /** Guarded lease renewal at DATABASE time (same guards as advance) that also persists the pre-phase
   *  attempt identity (phase_cursor) WITHOUT changing the phase. False ⇒ abort before the side effect. */
  renew(input: { tenantId: string; id: string; owner: string; leaseSeconds: number; cursor: Record<string, unknown> | null }): Promise<boolean>;
  /** Guarded terminal update at DATABASE time (releases the lease). 'completed' clears last_error; 'paused'
   *  records it. `spendUsd` STAMPS THE ROW'S OWN ACCUMULATOR at the close, from what this run actually
   *  tracked; absent leaves whatever is on the row. Returns whether a row matched. */
  finish(input: { tenantId: string; id: string; owner: string; outcome: Exclude<ResearchRunStatus, "running">; errorInfo?: ResearchRunError | null; spendUsd?: number | null }): Promise<boolean>;
  /** Latest run for the tenant by started_at desc, or null. */
  latest(tenantId: string): Promise<ResearchRun | null>;
  /** This account's rows for ONE reporting day, newest first, lean (id + progress): how many passes have
   *  already opened today, and what day-scoped state a new one inherits. */
  sameDay(input: { tenantId: string; day: string; limit: number }): Promise<Array<{ id: string; progress: ResearchRunProgress }>>;
  /** Count ONE continuation hop for `day` on the account's latest row and return the day's new total, or
   *  null when it could not be counted (no row yet, or the write did not land). */
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

/** THE ONE ATOMIC WRITE TO `progress`. Read-edit-write in the process let two writers a millisecond apart each erase what the other had just recorded on the same row. The merge, and the day-scoped
 *  {day, count} increment when one is asked for, happen inside ONE update statement, and the row's own new progress comes back, so a caller reads the number it actually landed. Null = no row matched,
 *  which is never "saved". A MISSING FUNCTION is a deploy that ran ahead of its migration: named loudly and thrown, never swallowed. */
export async function patchRunProgress(
  tenantId: string, runId: string, patch: Record<string, unknown>, increment?: { key: string; day: string },
): Promise<ResearchRunProgress | null> {
  const { data, error } = await getSupabaseAdmin().rpc("patch_research_run_progress", { p_tenant_id: tenantId,
    p_run_id: runId, p_patch: patch, p_increment_key: increment?.key ?? null, p_increment_day: increment?.day ?? null });
  if (error != null) {
    log.error("[research-run] the progress patch did not land, so nothing was recorded", { tenantId, runId,
      code: (error as { code?: string }).code ?? null, error: error.message ?? String(error) });
    throw new Error(error.message ?? String(error));
  }
  return (data as ResearchRunProgress | null) ?? null;
}

const supabaseRepo: ResearchRunRepo = {
  async claim({ tenantId, owner, leaseSeconds }) {
    const { data, error } = await getSupabaseAdmin()
      .rpc("claim_research_run", { p_tenant_id: tenantId, p_owner: owner, p_lease_seconds: leaseSeconds });
    if (error != null) throw new Error(error.message ?? String(error));
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return rows.length > 0 ? mapRow(rows[0]!) : null;
  },
  async claimDue({ owner, limit, leaseSeconds }) {
    const { data, error } = await getSupabaseAdmin()
      .rpc("claim_due_research_work", { p_owner: owner, p_limit: limit, p_lease_seconds: leaseSeconds });
    if (error != null) throw new Error(error.message ?? String(error));
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapRow);
  },
  async startPass({ tenantId, owner, leaseSeconds, day, progress }) {
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
      ...(progress ? { progress } : {}),
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
  async finish({ tenantId, id, owner, outcome, errorInfo, spendUsd }) {
    // THE DECLARED ACCUMULATOR, FINALLY WRITTEN. spend_usd has been on this table since the first migration and no code ever set it, so every run row has
    // claimed $0.00 forever while the real number sat in progress. It is stamped here, under the lease we still hold and BEFORE the finish releases it, and a
    // write that could not land never costs the account its completion: the money is already ledgered elsewhere, this row is the receipt.
    if (typeof spendUsd === "number" && Number.isFinite(spendUsd) && spendUsd >= 0) {
      const { error } = await getSupabaseAdmin().from("research_runs").update({ spend_usd: spendUsd }).eq("tenant_id", tenantId).eq("id", id).eq("lease_owner", owner);
      if (error != null) log.warn("[research-run] the pass closed but its spend could not be stamped on the row", { tenantId, runId: id, error: error.message ?? String(error) });
    }
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
  // THE COUNT IS COMPUTED WHERE IT IS STORED: the row id is all this reads, and the increment and the merge
  // belong to the update itself (read-modify-write let two tabs both read 0 and both write 1).
  async countContinuation({ tenantId, day }) {
    const { data, error } = await getSupabaseAdmin().from("research_runs").select("id")
      .eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (error != null || data == null) return null;
    const landed = await patchRunProgress(tenantId, String((data as { id: string }).id), {}, { key: "continuations", day });
    const held = landed?.continuations;
    return held?.day === day && Number.isFinite(held.count) ? held.count : null;
  },
};

let repo: ResearchRunRepo = supabaseRepo;

/** Tests inject an in-memory repo modeling the RPC contract; null restores prod. */
export function setResearchRunRepoForTests(next: ResearchRunRepo | null): void { repo = next ?? supabaseRepo; }

// ── The reporting day's own memory ─────────────────────────────────────────

/** THE ABSOLUTE RUNAWAY STOP for one account's Pacific day, not a work budget and not any one door's allowance. A pass may open whenever due-work reports genuinely progressable work; this only stops
 *  an account whose due list can never be cleared from opening passes forever. Past 24 in one day I say so and open nothing until the day rolls. Each door may carry a SMALLER ceiling of its own (the
 *  visit door does, because every navigation is a chance to open a pass); no door may raise this one. */
const DAILY_PASS_RUNAWAY_CEILING = 24;

type DayRow = { id: string; progress: ResearchRunProgress };

/** THE DAY'S STATE BELONGS TO THE DAY, NOT TO A ROW. Both row-creating paths (the fresh daily claim and an extra pass) are born with progress {}, so the extra-sample grant, the ceiling marker, the
 *  advisory-reading receipt and the decide watermark all died the moment the pass they justified opened. Inherited here from the passes that already ran the SAME reporting day; day-stamped markers
 *  only when they name that day. */
function carriedDayState(priors: readonly ResearchRunProgress[], day: string): ResearchRunProgress {
  const out: ResearchRunProgress = {};
  for (const p of priors) {
    if (out.decided == null && p.decided != null) out.decided = p.decided;
    if (out.extraSamples == null && p.extraSamples?.day === day) out.extraSamples = p.extraSamples;
    if (out.capped == null && p.capped?.day === day) out.capped = p.capped;
    if (out.continuations == null && p.continuations?.day === day) out.continuations = p.continuations; if (out.observationRetries == null && p.observationRetries?.day === day) out.observationRetries = p.observationRetries;
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
  if (p.decided != null || p.extraSamples != null || p.capped != null || p.continuations != null || p.synthesisAttempted != null || p.observationRetries != null) return run;
  const priors = await repo.sameDay({ tenantId: run.tenant_id, day: run.cycle_key.slice(-10), limit: DAILY_PASS_RUNAWAY_CEILING })
    .catch(() => [] as DayRow[]);
  return inheritDayState(run, owner, priors);
}

// ── Public operations (explicit tenant, fail-closed) ───────────────────────

/** Claim, resume, or start the account's Research Run with our owner token. The database resumes the single unfinished run (any date) before considering a new daily cycle, and computes the daily key
 *  itself. A REFUSAL AND A FAILURE ARE DIFFERENT ANSWERS, and this is the one place that can tell them apart. `null` means the database refused us honestly (a foreign live lease, or a pass already
 *  completed today), which a caller may reason further about. A THROW means the claim could not be made at all, so the caller fails closed: an unavailable database must never read as "today is done". */
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

/** THE DAILY DISPATCH. Claim up to `limit` accounts that still owe work for their current Pacific day, through the same claim_research_run every visit uses, and hand the caller the runs it now holds
 *  the lease on. No tenant argument by design: this is the one fleet-wide door, reachable only by the service role behind the CRON_SECRET endpoint. AN OUTAGE IS NOT AN EMPTY FLEET. A throw used to be
 *  swallowed into an empty list, so a database that was down, an RPC that was never migrated and a permission that was revoked all read as "nobody owes anything", the endpoint answered 200 with a
 *  zero receipt, and cron monitoring recorded a healthy day on which no account was tracked at all. It now THROWS, and the endpoint answers 503. Zero rows stays what it has always been: a genuine,
 *  honest nothing. */
export async function claimDueRuns(ownerToken: string, limit: number): Promise<ResearchRun[]> {
  try {
    return await repo.claimDue({ owner: ownerToken, limit, leaseSeconds: RESEARCH_RUN_LEASE_SECONDS });
  } catch (error) {
    log.error("[research-run] the daily dispatch could not read what is due; today's tracking did not run", { error: error instanceof Error ? error.message : String(error) });
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** Open ANOTHER pass on a day that already completed one. The caller must already know work is genuinely due (see due-work): a day is not a unit of work, but nor is a visit, so nothing here decides
 *  that question. Null = a pass must not open (any unfinished run, a concurrent claimer, the day's ceiling, or unavailable persistence). Never throws. THE CEILING BELONGS TO THE DOOR: a door passes
 *  its own allowance, clamped to the day's absolute runaway stop, so no door can widen the day for the others. THE REASON TRAVELS WITH THE PASS: every door here already knows WHICH units due-work
 *  named, and the row is born carrying them, so the executor settles that debt instead of walking a whole cycle around it. An opener that names nothing gets the full ordered sequence, as before. */
export async function startExtraPass(tenantId: string, ownerToken: string, day: string, ceiling = DAILY_PASS_RUNAWAY_CEILING, plan?: readonly DuePhase[]): Promise<ResearchRun | null> {
  requireTenant(tenantId);
  const stop = Math.min(Math.max(1, Math.trunc(ceiling)), DAILY_PASS_RUNAWAY_CEILING);
  try {
    const priors = await repo.sameDay({ tenantId, day, limit: stop });
    if (priors.length >= stop) { // the honest ceiling, not a claim that nothing is due
      log.info("[research-run] this account has opened all of today's research passes; the next one opens tomorrow", { tenantId, day, passes: priors.length });
      return null;
    }
    const run = await repo.startPass({ tenantId, owner: ownerToken, leaseSeconds: RESEARCH_RUN_LEASE_SECONDS, day,
      ...(plan != null && plan.length > 0 ? { progress: { plan: { units: [...plan] } } } : {}) });
    return run == null ? null : await inheritDayState(run, ownerToken, priors);
  } catch (error) {
    log.warn("[research-run] extra same-day pass could not open; nothing runs", { tenantId, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Advance the claimed run to a new phase (owner-guarded). True when our lease still held and the row was
 *  updated; false when the lease was lost (a concurrent instance recovered our expired lease), so abort. */
export async function advancePhase(tenantId: string, runId: string, ownerToken: string, patch: AdvancePatch): Promise<boolean> {
  requireTenant(tenantId);
  try { return await repo.advance({ tenantId, id: runId, owner: ownerToken, leaseSeconds: RESEARCH_RUN_LEASE_SECONDS, patch }); }
  catch (error) {
    log.warn("[research-run] advancePhase failed", { tenantId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** Renew our lease AND persist the pre-phase attempt identity (cursor) at DATABASE time, owner-guarded,
 *  WITHOUT changing the phase. Called BEFORE each phase side effect: false ⇒ our lease was lost or expired,
 *  so the caller aborts before any side-effecting work. Never throws to the caller. */
export async function renewLease(tenantId: string, runId: string, ownerToken: string, cursor: Record<string, unknown> | null): Promise<boolean> {
  requireTenant(tenantId);
  try { return await repo.renew({ tenantId, id: runId, owner: ownerToken, leaseSeconds: RESEARCH_RUN_LEASE_SECONDS, cursor }); }
  catch (error) {
    log.warn("[research-run] renewLease failed", { tenantId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** Terminal update for the run (owner-guarded), releasing the lease. Returns whether our lease still held.
 *  `spendUsd` stamps the row's own spend accumulator at the close, from the spend this run tracked; a run
 *  that bought nothing stamps 0, which is a fact and not an absence. Never throws to the caller. */
export async function finishRun(
  tenantId: string, runId: string, ownerToken: string,
  outcome: Exclude<ResearchRunStatus, "running">, errorInfo?: ResearchRunError | null, spendUsd?: number | null,
): Promise<boolean> {
  requireTenant(tenantId);
  try { return await repo.finish({ tenantId, id: runId, owner: ownerToken, outcome, errorInfo: errorInfo ?? null, spendUsd: spendUsd ?? null }); }
  catch (error) {
    log.warn("[research-run] finishRun failed", { tenantId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** Count ONE continuation hop for this reporting day, SERVER-SIDE and at DATABASE time, and return the day's new total. The hop a browser sends back is a number it made up, so a tab that kept
 *  claiming hop 0 bought itself an unbounded chain of research requests. The count lives on the account's own row, is incremented inside the update that lands it (two tabs get 1 and 2, never 1 and
 *  1), and is inherited by every pass that opens the same day. Null = it could not be counted, which the caller treats as its own first hop rather than as permission to loop. Never throws. */
export async function countContinuationHop(tenantId: string, day: string): Promise<number | null> {
  requireTenant(tenantId);
  try { return await repo.countContinuation({ tenantId, day }); }
  catch (error) {
    log.warn("[research-run] continuation hop could not be counted", { tenantId, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** The compact Today projection: latest run, fail-soft to "none". The reading tally is the DAY'S, summed
 *  across every pass: the newest row alone hid every reading the earlier passes bought. */
export async function researchRunStatus(tenantId: string, now: Date = new Date()): Promise<ResearchRunStatusView> {
  try {
    requireTenant(tenantId);
    const run = await repo.latest(tenantId);
    const view = projectStatusView(run, now.getTime());
    const day = run?.cycle_key?.slice(-10);
    if (day) view.counters.answersReadClosely = (await repo.sameDay({ tenantId, day, limit: 50 }))
      .reduce((n, r) => n + (Number(r.progress?.funnel?.answersAnalyzed) || 0), 0) || view.counters.answersReadClosely;
    return view;
  } catch (error) {
    log.warn("[research-run] status read failed; rendering none", { tenantId, error: error instanceof Error ? error.message : String(error) });
    const { liveness: _unread, ...blind } = projectStatusView(null, now.getTime()); return blind; // A READ I COULD NOT MAKE IS NOT AN ACCOUNT NOTHING HAS RUN FOR: the liveness reading is withheld rather than claimed, so a database blip never tells an operator their research is dead.
  }
}
