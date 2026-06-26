"use client";

import { useState } from "react";
import { sliceWorklist, WORKLIST_VIEWS, type WorklistItem, type WorklistView } from "@/domains/worklist/worklist-views";

/**
 * WorklistClient (2026-06-25, Sprint 6) — client view-tabs over the unified ranked
 * worklist. Pure slicing (sliceWorklist) on the server-supplied items; no fetching.
 */

const PARENT_BADGE: Record<string, string> = {
  content: "bg-sky-50 text-sky-700 ring-sky-200",
  commerce: "bg-amber-50 text-amber-700 ring-amber-200",
  trend: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  tool: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  technical: "bg-gray-100 text-gray-600 ring-gray-300",
};
const TREND_ICON: Record<string, string> = { rising: "↑", declining: "↓", flat: "→", unknown: "·" };

function fmt(n: number | null): string {
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

export function WorklistClient({ items }: { items: WorklistItem[] }) {
  const [view, setView] = useState<WorklistView>("today");
  const counts = (v: WorklistView) => sliceWorklist(items, v).length;
  const shown = sliceWorklist(items, view);

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-gray-200 bg-white/60 px-4 py-8 text-center text-sm text-gray-500">
        No Moves yet — connect data or run Discover, then your worklist fills in.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {WORKLIST_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              view === v.id ? "bg-gray-900 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
            }`}
          >
            {v.label}
            <span className={`ml-1.5 text-[10px] ${view === v.id ? "text-gray-300" : "text-gray-400"}`}>{counts(v.id)}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {shown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">Nothing in this view.</p>
        ) : (
          shown.map((it, i) => (
            <div key={it.id} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <span className="mt-0.5 w-5 shrink-0 text-right text-xs font-semibold text-gray-400">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${PARENT_BADGE[it.parent] ?? PARENT_BADGE.content}`}>{it.action}</span>
                  <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600 ring-1 ring-gray-200">
                    {fmt(it.demand)}/mo{it.trend ? ` ${TREND_ICON[it.trend]}` : ""}
                  </span>
                  <span className="text-[10px] text-gray-400">{it.confidence}</span>
                  {it.prepared ? <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">prepared</span> : null}
                  {it.conceptOnly ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 ring-1 ring-gray-300">concept-only</span> : null}
                  {it.isNew ? <span className="text-[10px] font-medium text-emerald-700">net-new</span> : null}
                </div>
                <p className="mt-1 truncate text-[14px] font-semibold text-gray-900">{it.title}</p>
                {it.why ? <p className="mt-0.5 line-clamp-1 text-[11px] text-gray-500">{it.why}</p> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
