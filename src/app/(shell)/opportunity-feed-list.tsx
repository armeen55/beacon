"use client";

import Link from "next/link";
import { useState } from "react";

/** Pre-computed display row (server resolves kind/label/style/href so this stays dumb). */
export type FeedDisplayRow = {
  kind: string;
  kindLabel: string;
  kindStyle: string;
  query: string;
  pageSlug: string;
  clicksLabel: string;
  href: string;
};

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

/**
 * opportunity-feed-list (2026-06-25) — the ranked list rows with a "show all"
 * expander: the headline shows the top `initial`, and the operator can expand to
 * the full ranked set inline (not just via export). Pure client; rows pre-resolved.
 */
export function OpportunityFeedList({ rows, initial = 6 }: { rows: FeedDisplayRow[]; initial?: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, initial);

  return (
    <>
      <ol className="mt-5 space-y-1.5">
        {shown.map((r, i) => (
          <li
            key={i}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-100 bg-white/70 px-3 py-2 text-sm"
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
            </div>
          </li>
        ))}
      </ol>
      {rows.length > initial ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-semibold text-violet-600 hover:text-violet-800"
        >
          {expanded ? "Show fewer" : `Show all ${fmtNum(rows.length)} →`}
        </button>
      ) : null}
    </>
  );
}
