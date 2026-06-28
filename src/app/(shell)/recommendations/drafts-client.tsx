"use client";

import { useState } from "react";
import { MoveCard } from "../today-moves-card";
import type { TodayMove } from "../today-moves-data";
import { draftStatusOf, type DraftStatus } from "./draft-status";

/**
 * drafts-client (2026-06-28 — ActionPack execution loop) — the Drafts list, driven
 * by the canonical ActionPack worklist (rich TodayMove). Replaces the legacy
 * recommended_edits queue (recommendations-v2-client). Each card is a prepared
 * ActionPack asset (draft/brief + copy + Ship it). Tabs filter by draft readiness.
 * The deep brief + armed-publish review still live on /recommendations/[id].
 */

type Filter = "all" | DraftStatus;

const TABS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "ready_to_draft", label: "Ready to draft" },
  { key: "needs_review", label: "Needs review" },
];

export function DraftsClient({ moves }: { moves: TodayMove[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const statusById = new Map(moves.map((m) => [m.id, draftStatusOf(m)]));
  const count = (f: Filter) =>
    f === "all" ? moves.length : moves.filter((m) => statusById.get(m.id) === f).length;
  const shown = filter === "all" ? moves : moves.filter((m) => statusById.get(m.id) === filter);

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
            Nothing in this lane right now.
          </p>
        ) : null}
      </div>
    </div>
  );
}
