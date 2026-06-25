"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { dismissOpportunityAction, undismissOpportunityAction } from "./opportunity-actions";

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
export function OpportunityFeedList({ rows, initial = 6 }: { rows: FeedDisplayRow[]; initial?: number }) {
  const [expanded, setExpanded] = useState(false);
  // Optimistically-removed keys + the last dismissal (for the Undo affordance).
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [lastDismissed, setLastDismissed] = useState<FeedDisplayRow | null>(null);
  const [, startTransition] = useTransition();

  const visible = rows.filter((r) => !dismissed.has(r.oppKey));
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
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-violet-600">{r.clicksLabel}</span>
              <Link href={r.href} className="font-semibold text-violet-600 hover:text-violet-800">
                Act →
              </Link>
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
        {lastDismissed ? (
          <span className="text-xs text-gray-500">
            Dismissed “{lastDismissed.query}”.{" "}
            <button type="button" onClick={undo} className="font-semibold text-violet-600 hover:text-violet-800">
              Undo
            </button>
          </span>
        ) : null}
      </div>
    </>
  );
}
