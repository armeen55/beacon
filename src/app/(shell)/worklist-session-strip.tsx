"use client";

/**
 * worklist-session-strip (BEACON 500 D6 - the daily ritual loop, static mode).
 *
 * The operator's own words: "i want to log on everyday.. do whatever number of changes i want
 * to do.. it can be 1 it can be every single change on that list... once i make the edits then
 * it dynamically goes to next best edit and so on". This owns the FLOW half of that (client
 * affordances + session state); the DATA layer (which change is actually next-best, ranked) is
 * `rankChanges`/`goalMatches` in strategy.ts plus `findNextActionable` in session-flow.ts - this
 * file only walks that already-ranked list and remembers what happened this session.
 *
 * State lives in a plain useState hook the page owns (`useWorklistSession`), backed by
 * localStorage ONLY for the display counter ("You have shipped N changes today" - a same-day
 * convenience so a refresh doesn't reset the number mid-session). Server truth (the shipped-
 * change ledger) remains the real record; Today's daily counter strip reads that, not this.
 * Fails soft: if localStorage is unavailable (private mode), the counter just starts at 0 and
 * still counts up correctly for the rest of the session.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CanonicalChange } from "@/domains/changes/canonical-change";
import {
  findNextActionable,
  nextBestLine,
  sessionProgressLine,
  weeklyOutcomeLine,
} from "@/domains/changes/session-flow";
import { autoAdvancePrepareAction } from "./today-moves-actions";

function todayKey(): string {
  // Pacific calendar date, matching the same clock the shipped-change ledger dates ships
  // against (defaultPacificShipDate) - "today" means the same day everywhere in the app.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

const STORAGE_PREFIX = "beacon:worklist:shipped-count:";

function readStoredCount(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + todayKey());
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeStoredCount(n: number): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + todayKey(), String(n));
  } catch {
    // localStorage unavailable (private mode) - the in-memory count still works for this session.
  }
}

/** R20 - server-truth lifecycle numbers the strip shows alongside the live session counter.
 *  These come from the SAME FP3 lifecycle-counts loader every other surface reads (passed in
 *  from the page), so the strip never re-derives a number the Tonight chip or Results already
 *  own. All optional: absent = that clause self-hides. */
export type WorklistSessionCounts = {
  /** Prepared, not-yet-shipped picks (FP3 tonightPicked - tonightApplied). */
  ready?: number;
  /** Whole-tenant "In flight" set (FP3 measuring). */
  measuring?: number;
  /** Changes shipped in the trailing 7 days (proof ledger). */
  shippedThisWeek?: number;
};

/** R20 - the honest status of the background auto-advance prepare. "idle" before any ship,
 *  "preparing" while the next best is being drafted in the background, "ready" once it lands.
 *  Reuses ONLY the existing Preparing/Ready words - never a new lifecycle status. */
export type PrepareStatus = "idle" | "preparing" | "ready";

export type WorklistSessionState = {
  /** "You have shipped N changes today" - same-day, localStorage-backed convenience counter. */
  shippedCount: number;
  /** The next actionable row to point at, or null at the honest end of the queue. */
  nextBest: CanonicalChange | null;
  /** One line naming it ("Next best: <exactWhat>"), or null when there is none. */
  banner: string | null;
  /** R20 - the live progress line ("3 shipped today, 2 ready, next best is /iran-flags"), or
   *  null when there is nothing to say yet. Pure from lifecycle counts + this session. */
  progressLine: string | null;
  /** R20 - the cumulative week line ("5 shipped this week, 3 measuring"), or null on a cold
   *  week. */
  weeklyLine: string | null;
  /** R20 - the background auto-advance prepare state, surfaced honestly on the strip. */
  prepareStatus: PrepareStatus;
  /** Call after ANY row action (done, skip, not-now) - never leaves the operator at a dead end
   *  and asks the background maintenance lane to restore five ready changes. */
  handleRowAction: (handledId: string, kind: "done" | "skip" | "not_now") => void;
  /** Clears the banner (e.g. once the operator opens the next row themselves). */
  dismissBanner: () => void;
};

/**
 * Owns the D6 session loop for one /changes render. `orderedChanges` is the SAME ranked +
 * filtered list the list component already computes (rankChanges + goal/status predicates) -
 * this hook never re-ranks, just walks it. `counts` (R20) carries the server-truth lifecycle
 * numbers (from the FP3 loader) so the strip's progress line and week line agree with every
 * other surface.
 */
export function useWorklistSession(
  orderedChanges: ReadonlyArray<CanonicalChange>,
  counts: WorklistSessionCounts = {},
): WorklistSessionState {
  const [shippedCount, setShippedCount] = useState(0);
  const [handledIds, setHandledIds] = useState<ReadonlySet<string>>(new Set());
  const [nextBest, setNextBest] = useState<CanonicalChange | null>(null);
  const [prepareStatus, setPrepareStatus] = useState<PrepareStatus>("idle");
  const hydrated = useRef(false);

  // Hydrate the counter from localStorage after mount (SSR-safe: first paint matches server).
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    setShippedCount(readStoredCount());
  }, []);

  const handleRowAction = useCallback(
    (handledId: string, kind: "done" | "skip" | "not_now") => {
      setHandledIds((prev) => {
        const next = new Set(prev);
        next.add(handledId);
        return next;
      });
      if (kind === "done") {
        setShippedCount((n) => {
          const next = n + 1;
          writeStoredCount(next);
          return next;
        });
      }
      // Every handled row changes the actionable order. Refill after done, skip,
      // or not-now so the session never drains into tomorrow's batch.
      setPrepareStatus("preparing");
      void autoAdvancePrepareAction()
        .then(() => setPrepareStatus("ready"))
        .catch(() => setPrepareStatus("ready"));
      // NO DEAD ENDS: after any action, always compute and surface the next actionable row.
      const upcoming = findNextActionable(orderedChanges, handledId, handledIds);
      setNextBest(upcoming);
    },
    [orderedChanges, handledIds],
  );

  const dismissBanner = useCallback(() => setNextBest(null), []);

  // R20 - the live progress line reuses the FP3 counts + this session's shipped tally + the
  // next best page. Derived, never a second store.
  const progressLine = sessionProgressLine({
    shippedToday: shippedCount,
    ready: counts.ready ?? 0,
    nextBestPage: nextBest ? (nextBest.pageLabel || nextBest.pagePath) : null,
  });
  const weeklyLine = weeklyOutcomeLine({
    shippedThisWeek: counts.shippedThisWeek ?? 0,
    measuring: counts.measuring ?? 0,
  });

  return {
    shippedCount,
    nextBest,
    banner: nextBestLine(nextBest),
    progressLine,
    weeklyLine,
    prepareStatus,
    handleRowAction,
    dismissBanner,
  };
}

/** The honest one-liner for the background auto-advance prepare state. "preparing" while the
 *  next best is being drafted, "ready" once it lands, nothing before the first ship. Reuses the
 *  existing Preparing/Ready words only. */
function prepareStatusLine(status: PrepareStatus): string | null {
  if (status === "preparing") return "Preparing the next one while you work...";
  if (status === "ready") return "The next one is ready.";
  return null;
}

/**
 * The session strip (R20 - D6 dynamic auto-mode): the live progress line ("3 shipped today,
 * 2 ready, next best is /iran-flags"), the cumulative week line ("5 shipped this week, 3
 * measuring"), the honest auto-advance prepare status, and the "Next best: <exactWhat>" banner
 * with Open it / Dismiss. Self-hides entirely when there is nothing to say yet (a fresh session
 * with no actions taken). Every number comes from the shared FP3 lifecycle counts + this
 * session; no new store, no new lifecycle word.
 */
export function WorklistSessionBanner({
  shippedCount,
  banner,
  progressLine,
  weeklyLine,
  prepareStatus,
  onDismiss,
  onOpenNext,
}: {
  shippedCount: number;
  banner: string | null;
  /** R20 - "N shipped today, M ready, next best is /page" (optional; falls back to the classic
   *  "You have shipped N changes today" line when absent so existing callers keep working). */
  progressLine?: string | null;
  /** R20 - "X shipped this week, Y measuring" (optional). */
  weeklyLine?: string | null;
  /** R20 - the background auto-advance prepare status (optional; defaults to idle). */
  prepareStatus?: PrepareStatus;
  onDismiss: () => void;
  onOpenNext?: () => void;
}) {
  const prepLine = prepareStatusLine(prepareStatus ?? "idle");
  if (shippedCount === 0 && !banner && !progressLine && !weeklyLine) return null;
  // R20 - the live progress line replaces the classic count sentence when present; the classic
  // "You have shipped N changes today." remains the fallback for callers that pass no counts.
  const leadLine =
    progressLine ??
    (shippedCount > 0
      ? `You have shipped ${shippedCount} change${shippedCount === 1 ? "" : "s"} today.`
      : null);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-status-success/30 bg-status-success-bg px-3 py-2 text-[12px] text-status-success"
    >
      <span className="min-w-0 break-words">
        {leadLine ? <span className="font-medium">{leadLine}</span> : null}
        {weeklyLine ? (
          <span className={leadLine ? " ml-1.5 text-status-success" : "text-status-success"}>
            {weeklyLine}
          </span>
        ) : null}
        {prepLine ? (
          <span className="ml-1.5 text-status-success">{prepLine}</span>
        ) : null}
        {banner ? (
          <span className={leadLine || weeklyLine || prepLine ? " ml-1.5" : ""}>{banner}</span>
        ) : null}
      </span>
      {banner ? (
        <span className="flex shrink-0 items-center gap-2">
          {onOpenNext ? (
            <button
              type="button"
              onClick={onOpenNext}
              className="rounded-sm text-[11px] font-semibold text-status-success underline underline-offset-2 hover:opacity-80"
            >
              Open it
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rounded-sm text-[11px] text-status-success hover:opacity-80"
          >
            Dismiss
          </button>
        </span>
      ) : null}
    </div>
  );
}
