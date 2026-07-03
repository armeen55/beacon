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
import { findNextActionable, nextBestLine } from "@/domains/changes/session-flow";

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

export type WorklistSessionState = {
  /** "You have shipped N changes today" - same-day, localStorage-backed convenience counter. */
  shippedCount: number;
  /** The next actionable row to point at, or null at the honest end of the queue. */
  nextBest: CanonicalChange | null;
  /** One line naming it ("Next best: <exactWhat>"), or null when there is none. */
  banner: string | null;
  /** Call after ANY row action (done, skip, not-now) - never leaves the operator at a dead end. */
  handleRowAction: (handledId: string, kind: "done" | "skip" | "not_now") => void;
  /** Clears the banner (e.g. once the operator opens the next row themselves). */
  dismissBanner: () => void;
};

/**
 * Owns the D6 session loop for one /changes render. `orderedChanges` is the SAME ranked +
 * filtered list the list component already computes (rankChanges + goal/status predicates) -
 * this hook never re-ranks, just walks it.
 */
export function useWorklistSession(orderedChanges: ReadonlyArray<CanonicalChange>): WorklistSessionState {
  const [shippedCount, setShippedCount] = useState(0);
  const [handledIds, setHandledIds] = useState<ReadonlySet<string>>(new Set());
  const [nextBest, setNextBest] = useState<CanonicalChange | null>(null);
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
      // NO DEAD ENDS: after any action, always compute and surface the next actionable row.
      const upcoming = findNextActionable(orderedChanges, handledId, handledIds);
      setNextBest(upcoming);
    },
    [orderedChanges, handledIds],
  );

  const dismissBanner = useCallback(() => setNextBest(null), []);

  return {
    shippedCount,
    nextBest,
    banner: nextBestLine(nextBest),
    handleRowAction,
    dismissBanner,
  };
}

/** "You have shipped N changes today" + the "Next best: <exactWhat>" banner. Self-hides both
 *  lines when there is nothing to say yet (a fresh session with no actions taken). */
export function WorklistSessionBanner({
  shippedCount,
  banner,
  onDismiss,
  onOpenNext,
}: {
  shippedCount: number;
  banner: string | null;
  onDismiss: () => void;
  onOpenNext?: () => void;
}) {
  if (shippedCount === 0 && !banner) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[12px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
    >
      <span className="min-w-0 break-words">
        {shippedCount > 0 ? (
          <span className="font-medium">
            You have shipped {shippedCount} change{shippedCount === 1 ? "" : "s"} today.
          </span>
        ) : null}
        {banner ? <span className={shippedCount > 0 ? " ml-1.5" : ""}>{banner}</span> : null}
      </span>
      {banner ? (
        <span className="flex shrink-0 items-center gap-2">
          {onOpenNext ? (
            <button
              type="button"
              onClick={onOpenNext}
              className="rounded-sm text-[11px] font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100"
            >
              Open it
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rounded-sm text-[11px] text-emerald-600 hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-100"
          >
            Dismiss
          </button>
        </span>
      ) : null}
    </div>
  );
}
