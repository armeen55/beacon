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

/** The eight operator-visible steps, in order. `done` is terminal (not a step). */
const STEP_ORDER: ResearchPhase[] = [
  "refresh_sources", "gsc_backfill_chunk", "crawl_pages", "keyword_discovery",
  "prompt_observations", "serp_analysis", "winning_pages", "publish_surface",
];
const RESEARCH_RUN_STEPS_TOTAL = 8 as const;

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
  stepsTotal: 8;
  counters: { sourcesRefreshed?: number; backfillDaysPulled?: number; aiChecksDone?: number; aiChecksIntended?: number;
    /** How the settled checks landed: an answer, an engine that had nothing to give, an engine I cannot ask. */
    aiChecksAnswered?: number; aiChecksUnavailable?: number; aiChecksUnsupported?: number;
    /** ANSWERS I ACTUALLY READ CLOSELY, which is NEVER the same number as answers collected: `aiChecksAnswered` counts checks that came back with something, this is the run's own receipt of answers a structured reading was settled against. Today printed the collected number under the words "an answer I analyzed", so 140 collected read as 140 understood. Two fields, two numbers, and no surface may spend one as the other. */
    answersReadClosely?: number };
  updatedAt: string | null;
  completedAt: string | null;
  /** The paused phase's Beacon-voice reason: some pauses need the operator and never resume alone. */
  pauseReason: string | null;
  /** The earliest date a promised retry becomes legal, straight off the persisted row. */
  nextDueAt?: string | null;
  /** The frozen plan's topics as the run last persisted them. */
  cases?: { active: number; parked: number };
  /** IS THE RESEARCH ALIVE, and what did the last of it actually produce. A surface reading counters alone
   *  cannot tell a quiet day from an account nothing has run for in a week: both render an empty string. */
  liveness?: { state: "productive" | "quiet" | "silent"; line: string };
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

/** How long an account may go with NO research at all before a surface stops implying anything is running. A day and a half covers one missed daily round and
 *  the hours either side of it, so an ordinary quiet night never reads as an outage while a genuine week of silence cannot hide behind a blank line. */
const SILENT_AFTER_MS = 36 * 60 * 60 * 1000;
/** The reporting zone, and there is only one of it in V1: src/lib/reporting-day.ts holds the contract. */
const TZ = { timeZone: "America/Los_Angeles" } as const;
/** WHAT TO DO when nothing has run. Named once, so the promise on the screen and the control that keeps it cannot drift apart. */
const RESTART_STEP = "Open Today and press Update data.";

/** PURE. WHEN, in the reporting zone: "today at 9:14 AM" on the current day, "Aug 3 at 9:14 AM" on any other. */
function whenLabel(atMs: number, nowMs: number): string {
  const d = new Date(atMs), time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...TZ });
  return d.toLocaleDateString("en-US", TZ) === new Date(nowMs).toLocaleDateString("en-US", TZ)
    ? `today at ${time}` : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...TZ })} at ${time}`;
}

/**
 * PURE. IS RESEARCH ALIVE FOR THIS ACCOUNT, in one sentence, off the persisted row and the clock alone.
 *
 * A COUNTER IS NOT A HEARTBEAT. Every surface reading of this run was a count, so an account whose research
 * had not run in a week and an account whose day was genuinely quiet both rendered the same empty string, and
 * an operator had no way at all to tell "nothing was owed" from "nothing is running". Three readings, and each
 * one carries a fact somebody can check: PRODUCTIVE names what the last pass produced and when, QUIET says it
 * looked and owed nothing and when, SILENT says how long it has been and what to press.
 */
function livenessOf(run: ResearchRun | null, nowMs: number, state: ResearchRunStatusView["state"]): NonNullable<ResearchRunStatusView["liveness"]> {
  const touched = Date.parse(run?.updated_at ?? "");
  if (run == null || !Number.isFinite(touched)) return { state: "silent", line: `No research has run for this account yet. ${RESTART_STEP}` };
  if (nowMs - touched >= SILENT_AFTER_MS) {
    const d = new Date(touched);
    // Inside a week the weekday is the thing a person actually remembers; past that it is a date.
    const since = nowMs - touched < 7 * 86_400_000 ? d.toLocaleDateString("en-US", { weekday: "long", ...TZ })
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...TZ });
    return { state: "silent", line: `No research has run since ${since}. ${RESTART_STEP}` };
  }
  const num = (v: unknown): number => Number(v) || 0;
  const f = run.progress?.funnel ?? {}, s = run.progress?.state ?? {};
  const answers = num(f.answersAnalyzed), collected = num(s.checksAnswers), sources = num(run.progress?.sourcesRefreshed), spent = num(f.spendUsd);
  const at = whenLabel(Date.parse(run.completed_at ?? "") || touched, nowMs);
  // ONE number, the closest one to the work an account pays for: a reading beats a collection, a collection beats a refresh, and money beats nothing at all.
  const did = answers > 0 ? `Read ${answers} new ${answers === 1 ? "answer" : "answers"} closely`
    : collected > 0 ? `Collected ${collected} new AI ${collected === 1 ? "answer" : "answers"}`
    : sources > 0 ? `Refreshed ${sources} connected ${sources === 1 ? "source" : "sources"}`
    : spent > 0 ? `Spent $${spent.toFixed(2)} on research` : null;
  // "NOTHING WAS OWED" IS A CLAIM ABOUT HOW THE RUN ENDED, not just what it counted. A run that paused or
  // died mid-research with zero output did NOT check everything, and saying so here contradicted the same
  // view's own pauseReason on the one surface that renders only this line.
  return did != null ? { state: "productive", line: `${did} ${at}.` }
    : state === "completed" ? { state: "quiet", line: `Checked ${at}. Nothing new was owed.` }
    : { state: "quiet", line: `Research stopped partway ${at}. ${RESTART_STEP}` };
}

/** Human step index for a phase; `done` maps to all 8 steps done. */
function stepsDoneForPhase(phase: ResearchPhase): number {
  if (phase === "done") return RESEARCH_RUN_STEPS_TOTAL;
  const i = STEP_ORDER.indexOf(phase);
  return i < 0 ? 0 : i; // phases already PASSED = steps done
}

const PHASE_LABEL: Record<ResearchPhase, string> = {
  refresh_sources: "refreshing your connected data",
  gsc_backfill_chunk: "loading more Search Console history",
  crawl_pages: "reading the pages on your website",
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
 * THE LEASE IS NOT A STATUS. This used to present a `running` row whose lease had expired as paused, so two requests seconds apart could read the same
 * unchanged row and report different things while the operator watched a status flicker over nothing. The lease decides WHICH invocation may work and says
 * nothing about what the account should be told; every field below comes from the row's own persisted columns and progress. A DEAD PROCESS IS NOT WORK IN
 * PROGRESS EITHER: deleting the lease projection also deleted the honesty that came with it, and a `running` row whose owner died read "Research in progress"
 * forever. A row untouched for STALE_RUN_MS is reported as interrupted, which is true and cannot flicker, because updated_at only moves forward on a real write.
 */
export function projectStatusView(run: ResearchRun | null, nowMs: number): ResearchRunStatusView {
  if (run == null) return { state: "none", phaseLabel: "", stepsDone: 0, stepsTotal: RESEARCH_RUN_STEPS_TOTAL, counters: {}, updatedAt: null, completedAt: null, pauseReason: null, liveness: livenessOf(null, nowMs, "none") };

  const touchedAt = Date.parse(run.updated_at ?? "");
  const interrupted = run.status === "running" && Number.isFinite(touchedAt) && nowMs - touchedAt >= STALE_RUN_MS;
  const state: ResearchRunStatusView["state"] = interrupted ? "paused" : run.status;
  const persisted = run.progress?.state ?? {};

  const counters: ResearchRunStatusView["counters"] = {};
  if (typeof run.progress?.sourcesRefreshed === "number") counters.sourcesRefreshed = run.progress.sourcesRefreshed;
  if (typeof run.progress?.backfill?.daysPulled === "number") counters.backfillDaysPulled = run.progress.backfill.daysPulled;
  // AI checks: the persisted daily standing first (the planner's own arithmetic, true whatever phase the run is on), and only then the older funnel counters, cumulative and so only readable while the AI-check phase is current.
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
  const read = run.progress?.funnel?.answersAnalyzed; if (typeof read === "number" && Number.isFinite(read)) counters.answersReadClosely = read;

  return {
    state,
    liveness: livenessOf(run, nowMs, state),
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
    // The reporting zone, and there is only one of it in V1: src/lib/reporting-day.ts holds the contract.
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
