"use client";

import { useState } from "react";
import { MoveCard } from "../today-moves-card";
import type { TodayMove } from "../today-moves-data";

/**
 * moves-worklist-client (2026-06-25) — the full Rank-&-Revenue worklist with filter
 * tabs. One ranked list of every engine Move (the §2 vision), each a rich §7 card
 * (ship / draft / title lab / AI draft). Reuses the verified MoveCard.
 */

type Filter = "all" | "citation" | "clicks" | "experience";

const TABS: { key: Filter; label: string }[] = [
  { key: "all", label: "All moves" },
  { key: "citation", label: "Win AI citations" },
  { key: "clicks", label: "Capture clicks" },
  { key: "experience", label: "Fix experience" },
];

export function MovesWorklistClient({ moves }: { moves: TodayMove[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const count = (f: Filter) => (f === "all" ? moves.length : moves.filter((m) => m.actionTone === f).length);
  const shown = filter === "all" ? moves : moves.filter((m) => m.actionTone === filter);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const c = count(t.key);
          const active = filter === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              disabled={c === 0 && t.key !== "all"}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? "bg-gray-900 text-white"
                  : "border border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50"
              }`}
            >
              {t.label}
              <span className={`ml-1.5 ${active ? "text-gray-300" : "text-gray-400"}`}>{c}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid gap-3">
        {shown.map((m, i) => (
          <MoveCard key={m.id} m={m} rank={i + 1} />
        ))}
        {shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
            No moves in this lane right now.
          </p>
        ) : null}
      </div>
    </div>
  );
}
