import "server-only";

/**
 * run-status (V1 Truth Convergence Phase 5, 2026-07-31) - the operator-facing PROJECTION of a
 * Research Run: the ordered steps, the plain-language phase label, the compact Today view, and
 * the ONE honest status line. Split out of research-run.ts, which owns the record and the
 * repository and nothing about how it reads.
 *
 * EVERY FIELD COMES OFF THE PERSISTED ROW. Nothing here consults a lease or a cache, so two
 * requests reading the same unchanged row always say the same thing. The ONE clock-dependent
 * reading is the interruption below, and it is taken against a persisted column that moves only
 * when real work happens, never against transient lease state.
 */

import type { ResearchPhase, ResearchRun } from "./research-run";

/** The seven operator-visible steps, in order. `done` is terminal (not a step). */
const STEP_ORDER: ResearchPhase[] = [
  "refresh_sources", "gsc_backfill_chunk", "keyword_discovery",
  "prompt_observations", "serp_analysis", "winning_pages", "publish_surface",
];
const RESEARCH_RUN_STEPS_TOTAL = 7 as const;

/** The next phase after `phase` in THE one canonical order, or the terminal `done`. */
export function nextPhase(phase: ResearchPhase): ResearchPhase {
  const i = STEP_ORDER.indexOf(phase);
  return i < 0 || i + 1 >= STEP_ORDER.length ? "done" : STEP_ORDER[i + 1]!;
}

/** The compact Today projection, derived FROM the canonical record. `none` covers no-run and any fail-soft
 *  error. Counters carry evidence-backed numbers only: aiChecks* mirror persisted funnel counters. */
export type ResearchRunStatusView = {
  state: "running" | "paused" | "completed" | "none";
  phaseLabel: string;
  stepsDone: number;
  stepsTotal: 7;
  counters: { sourcesRefreshed?: number; backfillDaysPulled?: number; aiChecksDone?: number; aiChecksIntended?: number;
    /** How the settled checks landed: an answer, an engine that had nothing to give, an engine I cannot ask. */
    aiChecksAnswered?: number; aiChecksUnavailable?: number; aiChecksUnsupported?: number };
  updatedAt: string | null;
  completedAt: string | null;
  /** The paused phase's Beacon-voice reason: some pauses need the operator and never resume alone. */
  pauseReason: string | null;
  /** The earliest date a promised retry becomes legal, straight off the persisted row. */
  nextDueAt?: string | null;
  /** The frozen plan's topics as the run last persisted them. */
  cases?: { active: number; parked: number };
};

/** How long a `running` row may sit UNTOUCHED before I stop calling it work in progress. Every unit
 *  of a live pass renews its lease and writes progress, so ten minutes of silence on the row means
 *  the process that held it died (a lambda timeout, a deploy, a closed tab mid-phase). */
const STALE_RUN_MS = 10 * 60 * 1000;

/** What a dead process is honestly told. It cannot flicker: `updated_at` moves only on a real
 *  progress write, so the same row reads the same way on every request until work actually resumes.
 *  The daily round is what picks it back up, so that is what the copy promises: nothing here waits on
 *  the operator opening the app. Private to this projection; nobody branches on its text. */
const INTERRUPTED_REASON = "I was interrupted mid research. My next daily round picks this back up.";

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

/**
 * PURE: a persisted run (or none) -> the compact Today view.
 *
 * THE LEASE IS NOT A STATUS. This used to present a `running` row whose lease had expired as
 * paused, which meant two requests seconds apart could read the same unchanged row and report
 * different things, and the operator watched a status flicker while nothing had happened. The
 * lease decides WHICH invocation may work; it says nothing about what the account should be
 * told. Every field below comes from the row's own persisted columns and progress.
 *
 * A DEAD PROCESS IS NOT WORK IN PROGRESS EITHER. Deleting the lease projection also deleted the
 * honesty that came with it: a `running` row whose owner died read "Research in progress" forever.
 * A row that has not been TOUCHED in STALE_RUN_MS is reported as interrupted, which is true and
 * cannot flicker, because updated_at only ever moves forward on a real write.
 */
export function projectStatusView(run: ResearchRun | null, nowMs: number): ResearchRunStatusView {
  if (run == null) return { state: "none", phaseLabel: "", stepsDone: 0, stepsTotal: RESEARCH_RUN_STEPS_TOTAL, counters: {}, updatedAt: null, completedAt: null, pauseReason: null };

  const touchedAt = Date.parse(run.updated_at ?? "");
  const interrupted = run.status === "running" && Number.isFinite(touchedAt) && nowMs - touchedAt >= STALE_RUN_MS;
  const state: ResearchRunStatusView["state"] = interrupted ? "paused" : run.status;
  const persisted = run.progress?.state ?? {};

  const counters: ResearchRunStatusView["counters"] = {};
  if (typeof run.progress?.sourcesRefreshed === "number") counters.sourcesRefreshed = run.progress.sourcesRefreshed;
  if (typeof run.progress?.backfill?.daysPulled === "number") counters.backfillDaysPulled = run.progress.backfill.daysPulled;
  // AI checks: the persisted daily standing first (the planner's own arithmetic, true whatever
  // phase the run is on), and only then the older funnel counters, which are cumulative and so
  // may only be read while the AI-check phase is the current one.
  const { enginePairsDone: aiDone, enginePairsIntended: aiWanted } =
    run.current_phase === "prompt_observations" ? (run.progress?.funnel ?? {}) : {};
  if (typeof persisted.checksDone === "number" && typeof persisted.checksTotal === "number" && persisted.checksTotal > 0) {
    counters.aiChecksDone = persisted.checksDone;
    counters.aiChecksIntended = persisted.checksTotal;
    if (typeof persisted.checksAnswers === "number") counters.aiChecksAnswered = persisted.checksAnswers;
    if (typeof persisted.checksUnavailable === "number") counters.aiChecksUnavailable = persisted.checksUnavailable;
    if (typeof persisted.checksUnsupported === "number") counters.aiChecksUnsupported = persisted.checksUnsupported;
  } else if (typeof aiDone === "number" && Number.isFinite(aiDone) && typeof aiWanted === "number" && Number.isFinite(aiWanted)) {
    counters.aiChecksDone = aiDone;
    counters.aiChecksIntended = aiWanted;
  }

  return {
    state,
    // The phase label is DERIVED from the persisted current_phase column, never stored twice.
    phaseLabel: PHASE_LABEL[run.current_phase],
    nextDueAt: persisted.nextDueAt ?? null,
    ...(typeof persisted.casesActive === "number" || typeof persisted.casesParked === "number"
      ? { cases: { active: persisted.casesActive ?? 0, parked: persisted.casesParked ?? 0 } }
      : {}),
    stepsDone: stepsDoneForPhase(run.current_phase),
    stepsTotal: RESEARCH_RUN_STEPS_TOTAL,
    counters,
    updatedAt: run.updated_at ?? null,
    completedAt: run.completed_at ?? null,
    // A reason belongs to the phase that recorded it (claim preserves last_error): a stale
    // reason from an already-passed phase must never resurrect. An interrupted run has no
    // recorded reason at all, because nothing got the chance to write one.
    pauseReason: interrupted ? INTERRUPTED_REASON
      : state === "paused" && run.last_error?.phase === run.current_phase ? (run.last_error?.message?.trim() || null) : null,
  };
}

/** PURE. HOW TODAY'S CHECKS ACTUALLY LANDED, in one sentence, and only when it is worth saying. A day whose
 *  last pair was honestly unavailable is a FINISHED day, and the count now says so; without this the same
 *  screen would read "140 of 140" and quietly imply 140 answers. Silent while the round is unfinished (the
 *  in-progress line already carries the running count) and silent when every check really did answer. */
function settledChecksNote(c: ResearchRunStatusView["counters"]): string {
  const { aiChecksDone: done, aiChecksIntended: total, aiChecksAnswered: answers } = c;
  if (typeof done !== "number" || typeof total !== "number" || total === 0 || done < total) return "";
  if (typeof answers !== "number" || answers >= total) return "";
  const quiet = c.aiChecksUnavailable ?? 0, shut = c.aiChecksUnsupported ?? 0;
  const parts = [`${answers} ${answers === 1 ? "answer" : "answers"}`];
  // CHECKS, NEVER ENGINES. Every count here is a (question, engine) CHECK, so one silent engine across
  // forty questions reads as forty checks: calling them engines told the operator four engines were down.
  if (quiet > 0) parts.push(`${quiet} ${quiet === 1 ? "check" : "checks"} came back empty`);
  if (shut > 0) parts.push(`${shut} I cannot ask`);
  return ` I finished today's checks: ${parts.join(", ")}.`;
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
    // A WAIT IS PART OF THE ANSWER. A finished pass with everything else waiting on a date I
    // promised used to read as a full stop, so the operator had no way to tell "done for now"
    // from "done until August 2". The date is persisted on the row, never recomputed here.
    const waiting = view.nextDueAt && Number.isFinite(Date.parse(view.nextDueAt))
      ? ` Nothing more is due until ${new Date(view.nextDueAt).toLocaleDateString("en-US", { month: "long", day: "numeric", ...tz })}.`
      : "";
    if (sameDay) return `Latest research pass finished today at ${at}.${settledChecksNote(view.counters)}${waiting}`;
    const day = finished.toLocaleDateString("en-US", { month: "short", day: "numeric", ...tz });
    return `Latest research pass finished ${day} at ${at}.${waiting}`;
  }
  return null;
}
