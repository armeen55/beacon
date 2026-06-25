"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  dismissOpportunityAction,
  undismissOpportunityAction,
  pinOpportunityAction,
  unpinOpportunityAction,
} from "./opportunity-actions";

/** Pre-computed display row (server resolves kind/label/style/href so this stays dumb). */
export type FeedDisplayRow = {
  kind: string;
  kindLabel: string;
  kindStyle: string;
  query: string;
  pageSlug: string;
  clicksLabel: string;
  href: string;
  /** Stable dismissal key (`kind|page|query`) for the curate-the-worklist control. */
  oppKey: string;
  /** Persisted focus state — pinned rows sort to the top + show a "Focusing" tag. */
  pinned: boolean;
};

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

/**
 * opportunity-feed-list (2026-06-25) — the ranked list rows with two operator
 * controls: a "show all" expander (top `initial` by default, expand to the full
 * ranked set inline) and a per-row DISMISS (curate the worklist — a dismissed
 * opportunity persists off the recomputed feed, with an inline Undo). Optimistic:
 * the row drops on dismiss and the server action persists in the background.
 */
export function OpportunityFeedList({
  rows,
  initial = 6,
  dismissed: dismissedRows = [],
}: {
  rows: FeedDisplayRow[];
  initial?: number;
  /** Previously-dismissed opportunities (persisted) — shown in a restore drawer. */
  dismissed?: { oppKey: string; label: string; kind: string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  // Optimistically-removed keys + the last dismissal (for the Undo affordance).
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [lastDismissed, setLastDismissed] = useState<FeedDisplayRow | null>(null);
  // Keys restored from the drawer this session (optimistically hidden from it).
  const [restored, setRestored] = useState<Set<string>>(() => new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Optimistic pin overrides keyed by oppKey (true=pinned, false=unpinned).
  const [pinOverride, setPinOverride] = useState<Map<string, boolean>>(() => new Map());
  // "Focus only" mode — work just the pinned list.
  const [focusOnly, setFocusOnly] = useState(false);
  const [, startTransition] = useTransition();

  const isRowPinned = (r: FeedDisplayRow) => pinOverride.get(r.oppKey) ?? r.pinned;
  const pinnedCount = rows.filter((r) => isRowPinned(r) && !dismissed.has(r.oppKey)).length;

  function togglePin(r: FeedDisplayRow, nextPinned: boolean) {
    setPinOverride((prev) => new Map(prev).set(r.oppKey, nextPinned));
    startTransition(() => {
      void (nextPinned ? pinOpportunityAction(r.oppKey) : unpinOpportunityAction(r.oppKey));
    });
  }

  const drawerRows = dismissedRows.filter((d) => !restored.has(d.oppKey));

  function restore(oppKey: string) {
    setRestored((prev) => new Set(prev).add(oppKey));
    startTransition(() => {
      void undismissOpportunityAction(oppKey);
    });
  }

  const visible = rows
    .filter((r) => !dismissed.has(r.oppKey))
    .filter((r) => !focusOnly || isRowPinned(r));
  const shown = expanded ? visible : visible.slice(0, initial);

  function dismiss(r: FeedDisplayRow) {
    setDismissed((prev) => new Set(prev).add(r.oppKey));
    setLastDismissed(r);
    startTransition(() => {
      void dismissOpportunityAction(r.oppKey, "skip");
    });
  }

  function undo() {
    if (!lastDismissed) return;
    const key = lastDismissed.oppKey;
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setLastDismissed(null);
    startTransition(() => {
      void undismissOpportunityAction(key);
    });
  }

  return (
    <>
      <ol className="mt-5 space-y-1.5">
        {shown.map((r, i) => (
          <li
            key={r.oppKey || i}
            className="group flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-100 bg-white/70 px-3 py-2 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-bold text-violet-700">
                {i + 1}
              </span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${r.kindStyle}`}>
                {r.kindLabel}
              </span>
              <span className="min-w-0">
                <span className="font-medium text-gray-900">{r.query}</span>
                <span className="ml-2 text-xs text-gray-400">on {r.pageSlug}</span>
                {(pinOverride.get(r.oppKey) ?? r.pinned) ? (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                    Focusing
                  </span>
                ) : null}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-violet-600">{r.clicksLabel}</span>
              <Link href={r.href} className="font-semibold text-violet-600 hover:text-violet-800">
                Act →
              </Link>
              {(() => {
                const isPinned = pinOverride.get(r.oppKey) ?? r.pinned;
                return (
                  <button
                    type="button"
                    onClick={() => togglePin(r, !isPinned)}
                    title={isPinned ? "Unpin" : "Pin to focus — sorts to the top"}
                    aria-label={isPinned ? "Unpin opportunity" : "Pin opportunity to focus"}
                    className={
                      isPinned
                        ? "text-amber-500 hover:text-amber-600"
                        : "text-gray-300 transition-colors hover:text-amber-500 sm:opacity-0 sm:group-hover:opacity-100"
                    }
                  >
                    📌
                  </button>
                );
              })()}
              <button
                type="button"
                onClick={() => dismiss(r)}
                title="Dismiss — hide this from your worklist"
                aria-label="Dismiss opportunity"
                className="text-gray-300 transition-colors hover:text-rose-500 sm:opacity-0 sm:group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-2 flex items-center gap-3">
        {visible.length > initial ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-semibold text-violet-600 hover:text-violet-800"
          >
            {expanded ? "Show fewer" : `Show all ${fmtNum(visible.length)} →`}
          </button>
        ) : null}
        {pinnedCount > 0 || focusOnly ? (
          <button
            type="button"
            onClick={() => setFocusOnly((v) => !v)}
            className={
              "rounded-full px-2.5 py-0.5 text-xs font-semibold " +
              (focusOnly ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-700 hover:bg-amber-200")
            }
          >
            {focusOnly ? "✓ Focusing" : `Focus only (${pinnedCount})`}
          </button>
        ) : null}
        {lastDismissed ? (
          <span className="text-xs text-gray-500">
            Dismissed “{lastDismissed.query}”.{" "}
            <button type="button" onClick={undo} className="font-semibold text-violet-600 hover:text-violet-800">
              Undo
            </button>
          </span>
        ) : null}
      </div>

      {drawerRows.length > 0 ? (
        <div className="mt-3 border-t border-violet-100 pt-2">
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            className="text-xs font-medium text-gray-400 hover:text-gray-600"
          >
            {drawerOpen ? "Hide" : "Show"} {drawerRows.length} dismissed{" "}
            <span aria-hidden>{drawerOpen ? "▴" : "▾"}</span>
          </button>
          {drawerOpen ? (
            <ul className="mt-2 space-y-1">
              {drawerRows.map((d) => (
                <li key={d.oppKey} className="flex items-center justify-between gap-2 text-xs text-gray-500">
                  <span className="min-w-0 truncate">
                    {d.label} <span className="text-gray-300">· {d.kind}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => restore(d.oppKey)}
                    className="shrink-0 font-semibold text-violet-600 hover:text-violet-800"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
