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
export type ResearchRunStatus = "running" | "paused" | "completed";

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
  focus?: { basis: string | null; topics: Array<{ topicKey: string | null; query: string | null; requirement: string | null }> };
  /** LEGACY, read-only: a run frozen before `focus` existed carries only its query strings. Never written now. */
  surfacePublished?: boolean;
  /** Slice 6: real persisted funnel counters (never fabricated). */
  funnel?: {
    rawKeywords?: number; normalizedKeywords?: number; retainedKeywords?: number;
    rejectedKeywords?: number; promptsChecked?: number; enginePairsDone?: number;
    enginePairsIntended?: number; serpsAnalyzed?: number; winningPagesFetched?: number;
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

/** The compact Today projection, derived FROM the canonical record. `none` covers no-run and any fail-soft
 *  error. Counters carry evidence-backed numbers only: aiChecks* mirror persisted funnel counters. */
export type ResearchRunStatusView = {
  state: "running" | "paused" | "completed" | "none";
  phaseLabel: string;
  stepsDone: number;
  stepsTotal: 7;
  counters: { sourcesRefreshed?: number; backfillDaysPulled?: number; aiChecksDone?: number; aiChecksIntended?: number };
  updatedAt: string | null;
  completedAt: string | null;
  /** The paused phase's Beacon-voice reason: some pauses need the operator and never resume alone. */
  pauseReason: string | null;
};

/** The seven operator-visible steps, in order. `done` is terminal (not a step). */
const STEP_ORDER: ResearchPhase[] = [
  "refresh_sources", "gsc_backfill_chunk", "keyword_discovery",
  "prompt_observations", "serp_analysis", "winning_pages", "publish_surface",
];
export const RESEARCH_RUN_STEPS_TOTAL = 7 as const;

/** The next phase after `phase` in THE one canonical order, or the terminal `done`. */
export function nextPhase(phase: ResearchPhase): ResearchPhase {
  const i = STEP_ORDER.indexOf(phase);
  return i < 0 || i + 1 >= STEP_ORDER.length ? "done" : STEP_ORDER[i + 1]!;
}

/** Lease length for one claimed cycle. Renewed at DATABASE time BEFORE every
 *  bounded phase (renew_research_lease) so no phase inside the 210s cycle deadline
 *  can knowingly outlive its lease. */
export const RESEARCH_RUN_LEASE_SECONDS = 240;
/** A `running` row whose lease expired this long ago is a dead invocation; the
 *  Today line presents it as paused (derived from persisted lease, not hope). */
export const RESEARCH_RUN_LEASE_GRACE_MS = 30_000;

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

/** Human step index for a phase; `done` maps to all 7 steps done. */
function stepsDoneForPhase(phase: ResearchPhase): number {
  if (phase === "done") return RESEARCH_RUN_STEPS_TOTAL;
  const i = STEP_ORDER.indexOf(phase);
  return i < 0 ? 0 : i; // phases already PASSED = steps done
}

const PHASE_LABEL: Record<ResearchPhase, string> = {
  refresh_sources: "refreshing your connected data",
  gsc_backfill_chunk: "loading more Search Console history",
  keyword_discovery: "researching what your customers search for",
  prompt_observations: "checking how AI assistants answer your questions",
  serp_analysis: "reading the results pages for your strongest topics",
  winning_pages: "studying the pages that win those results",
  publish_surface: "updating your ranked changes",
  done: "updating your ranked changes",
};

/** True when a `running` row's lease is expired past the grace window: the
 *  invocation that held it is dead, so the run is really paused. */
export function isLeaseDead(run: Pick<ResearchRun, "lease_expires_at">, nowMs: number): boolean {
  const t = run.lease_expires_at ? Date.parse(run.lease_expires_at) : NaN;
  return !Number.isFinite(t) || nowMs - t > RESEARCH_RUN_LEASE_GRACE_MS;
}

/** PURE: project a persisted run (or none) into the compact Today view. A
 *  `running` row with a dead lease presents as paused. */
export function projectStatusView(run: ResearchRun | null, nowMs: number): ResearchRunStatusView {
  if (run == null) return { state: "none", phaseLabel: "", stepsDone: 0, stepsTotal: RESEARCH_RUN_STEPS_TOTAL, counters: {}, updatedAt: null, completedAt: null, pauseReason: null };

  let state: ResearchRunStatusView["state"];
  if (run.status === "completed") state = "completed";
  else if (run.status === "paused") state = "paused";
  else state = isLeaseDead(run, nowMs) ? "paused" : "running"; // running with dead lease → paused

  const counters: ResearchRunStatusView["counters"] = {};
  if (typeof run.progress?.sourcesRefreshed === "number") counters.sourcesRefreshed = run.progress.sourcesRefreshed;
  if (typeof run.progress?.backfill?.daysPulled === "number") counters.backfillDaysPulled = run.progress.backfill.daysPulled;
  // AI checks: durably persisted funnel numbers, both or neither, and ONLY while the AI-check
  // phase is current (they survive onto later phases and would freeze under a moving label).
  const { enginePairsDone: aiDone, enginePairsIntended: aiWanted } =
    run.current_phase === "prompt_observations" ? (run.progress?.funnel ?? {}) : {};
  if (typeof aiDone === "number" && Number.isFinite(aiDone) && typeof aiWanted === "number" && Number.isFinite(aiWanted)) {
    counters.aiChecksDone = aiDone;
    counters.aiChecksIntended = aiWanted;
  }

  return {
    state,
    phaseLabel: PHASE_LABEL[run.current_phase],
    stepsDone: stepsDoneForPhase(run.current_phase),
    stepsTotal: RESEARCH_RUN_STEPS_TOTAL,
    counters,
    updatedAt: run.updated_at ?? null,
    completedAt: run.completed_at ?? null,
    // A reason belongs to the phase that recorded it (claim preserves last_error): a stale
    // reason from an already-passed phase must never resurrect.
    pauseReason:
      state === "paused" && run.last_error?.phase === run.current_phase ? (run.last_error?.message?.trim() || null) : null,
  };
}

/**
 * PURE: the ONE honest Beacon-voice Today status line for the durable Research Run,
 * or null (render nothing) for none/idle. An OPEN run with no bounded reason reads as
 * ONE in-progress sentence whether or not a lease is live, so the line can never
 * toggle on lease state alone; only a real pause reason changes it, because a pause
 * needing the operator must not promise a resume. No progress bar, percentage, ETA,
 * animation, and never "current": a completed row is a finished PASS at a stated time,
 * never a promise the data stays fresh, and an earlier day's pass shows its date.
 */
export function researchStatusLine(view: ResearchRunStatusView, now: Date = new Date()): string | null {
  if (view.state === "running" || (view.state === "paused" && view.pauseReason == null)) {
    const { aiChecksDone: aiDone, aiChecksIntended: aiWanted } = view.counters;
    const checks = typeof aiDone === "number" && typeof aiWanted === "number" && aiWanted > 0 ? ` ${aiDone} of ${aiWanted} AI checks collected.` : "";
    return `Research in progress: ${view.phaseLabel}.${checks}`;
  }
  if (view.state === "paused") return `Research paused after ${view.stepsDone} of ${view.stepsTotal} steps. ${view.pauseReason}`;
  if (view.state === "completed" && view.completedAt) {
    const tz = { timeZone: "America/Los_Angeles" } as const;
    const finished = new Date(view.completedAt);
    const at = finished.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...tz });
    const sameDay = finished.toLocaleDateString("en-US", tz) === now.toLocaleDateString("en-US", tz);
    if (sameDay) return `Latest research pass finished today at ${at}.`;
    const day = finished.toLocaleDateString("en-US", { month: "short", day: "numeric", ...tz });
    return `Latest research pass finished ${day} at ${at}.`;
  }
  return null;
}

// ── Repository (injected; production = Supabase) ───────────────────────────

export type AdvancePatch = {
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
};

function mapRow(r: Record<string, unknown>): ResearchRun {
  return {
    id: String(r.id),
    tenant_id: String(r.tenant_id),
    cycle_key: String(r.cycle_key),
    status: r.status as ResearchRunStatus,
    current_phase: r.current_phase as ResearchPhase,
    phase_cursor: (r.phase_cursor as Record<string, unknown> | null) ?? null,
    progress: (r.progress as ResearchRunProgress | null) ?? {},
    spend_usd: Number(r.spend_usd ?? 0),
    last_error: (r.last_error as ResearchRunError | null) ?? null,
    lease_owner: (r.lease_owner as string | null) ?? null,
    lease_expires_at: (r.lease_expires_at as string | null) ?? null,
    started_at: String(r.started_at),
    updated_at: String(r.updated_at ?? r.started_at),
    completed_at: (r.completed_at as string | null) ?? null,
  };
}

const supabaseRepo: ResearchRunRepo = {
  async claim({ tenantId, owner, leaseSeconds }) {
    const { data, error } = await getSupabaseAdmin().rpc("claim_research_run", {
      p_tenant_id: tenantId,
      p_owner: owner,
      p_lease_seconds: leaseSeconds,
    });
    if (error != null) throw new Error(error.message ?? String(error));
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return rows.length > 0 ? mapRow(rows[0]!) : null;
  },
  async advance({ tenantId, id, owner, leaseSeconds, patch }) {
    const { data, error } = await getSupabaseAdmin().rpc("advance_research_run", {
      p_tenant_id: tenantId,
      p_run_id: id,
      p_owner: owner,
      p_next_phase: patch.phase,
      p_progress: patch.progress ?? null,
      p_cursor: patch.cursor ?? null,
      p_lease_seconds: leaseSeconds,
    });
    if (error != null) throw new Error(error.message ?? String(error));
    return data === true;
  },
  async renew({ tenantId, id, owner, leaseSeconds, cursor }) {
    const { data, error } = await getSupabaseAdmin().rpc("renew_research_lease", {
      p_tenant_id: tenantId,
      p_run_id: id,
      p_owner: owner,
      p_cursor: cursor ?? null,
      p_lease_seconds: leaseSeconds,
    });
    if (error != null) throw new Error(error.message ?? String(error));
    return data === true;
  },
  async finish({ tenantId, id, owner, outcome, errorInfo }) {
    const { data, error } = await getSupabaseAdmin().rpc("finish_research_run", {
      p_tenant_id: tenantId,
      p_run_id: id,
      p_owner: owner,
      p_outcome: outcome,
      p_error: errorInfo ?? null,
    });
    if (error != null) throw new Error(error.message ?? String(error));
    return data === true;
  },
  async latest(tenantId) {
    const { data, error } = await getSupabaseAdmin()
      .from("research_runs")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error != null) throw new Error(error.message ?? String(error));
    return data ? mapRow(data as Record<string, unknown>) : null;
  },
};

let repo: ResearchRunRepo = supabaseRepo;

/** Tests inject an in-memory repo modeling the RPC contract; null restores prod. */
export function setResearchRunRepoForTests(next: ResearchRunRepo | null): void {
  repo = next ?? supabaseRepo;
}

// ── Public operations (explicit tenant, fail-closed) ───────────────────────

/**
 * Claim, resume, or start the account's Research Run with our owner token. The database
 * resumes the single unfinished run (any date) before considering a new daily cycle, and
 * computes the daily key itself. Returns the claimed row when we won, else null (foreign
 * unexpired lease, or research already current for today). Persistence unavailable ⇒ null
 * (fail closed: NO background work runs), logged, never throws to the caller.
 */
export async function claimRun(tenantId: string, ownerToken: string): Promise<ResearchRun | null> {
  requireTenant(tenantId);
  try {
    return await repo.claim({ tenantId, owner: ownerToken, leaseSeconds: RESEARCH_RUN_LEASE_SECONDS });
  } catch (error) {
    log.warn("[research-run] claim failed; fail closed (no background work)", {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Advance the claimed run to a new phase (owner-guarded). Returns true when our
 * lease still held and the row was updated; false when the lease was lost (a
 * concurrent instance recovered our expired lease) - the caller must abort.
 */
export async function advancePhase(
  tenantId: string,
  runId: string,
  ownerToken: string,
  patch: AdvancePatch,
): Promise<boolean> {
  requireTenant(tenantId);
  try {
    return await repo.advance({ tenantId, id: runId, owner: ownerToken, leaseSeconds: RESEARCH_RUN_LEASE_SECONDS, patch });
  } catch (error) {
    log.warn("[research-run] advancePhase failed", {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Renew our lease AND persist the pre-phase attempt identity (cursor) at DATABASE time,
 * owner-guarded, WITHOUT changing the phase. Called BEFORE each phase side effect: false
 * ⇒ our lease was lost or expired, so the caller aborts before any side-effecting work.
 * Never throws to the caller.
 */
export async function renewLease(
  tenantId: string,
  runId: string,
  ownerToken: string,
  cursor: Record<string, unknown> | null,
): Promise<boolean> {
  requireTenant(tenantId);
  try {
    return await repo.renew({ tenantId, id: runId, owner: ownerToken, leaseSeconds: RESEARCH_RUN_LEASE_SECONDS, cursor });
  } catch (error) {
    log.warn("[research-run] renewLease failed", {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Terminal update for the run (owner-guarded), releasing the lease. Returns
 * whether our lease still held. Never throws to the caller.
 */
export async function finishRun(
  tenantId: string,
  runId: string,
  ownerToken: string,
  outcome: Exclude<ResearchRunStatus, "running">,
  errorInfo?: ResearchRunError | null,
): Promise<boolean> {
  requireTenant(tenantId);
  try {
    return await repo.finish({ tenantId, id: runId, owner: ownerToken, outcome, errorInfo: errorInfo ?? null });
  } catch (error) {
    log.warn("[research-run] finishRun failed", {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
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
    log.warn("[research-run] status read failed; rendering none", {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return projectStatusView(null, now.getTime());
  }
}
