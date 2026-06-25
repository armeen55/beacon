"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { respondToRecommendation } from "./recommendation-actions";

/**
 * today-moves-bulkship (2026-06-25) — the §7 ritual finale: one tap ships the top
 * N Moves at once so the daily ritual is "open → glance → ship the top 3 → done"
 * in under a minute. Accepts each rec (the same one-tap Ship the cards use) in
 * parallel, then refreshes so the shipped moves fall off the list. Optimistic,
 * resilient (per-move failures don't abort the batch), self-hides for <2 moves.
 */
export function BulkShipBar({
  moves,
}: {
  moves: { id: string; targetUrl: string; query: string; action: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(0);

  const top = moves.slice(0, 3);
  if (top.length < 2) return null; // bulk only earns its keep with a real stack

  const shipTop = () => {
    startTransition(async () => {
      const results = await Promise.allSettled(
        top.map((m) =>
          respondToRecommendation(m.id, "accepted", { targetPageUrl: m.targetUrl, actionType: m.action, query: m.query }),
        ),
      );
      setDone(results.filter((r) => r.status === "fulfilled").length);
      router.refresh();
    });
  };

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50/70 px-4 py-3">
      <div className="text-sm text-violet-900">
        <span className="font-semibold">Ship today&apos;s top {top.length} in one go.</span>{" "}
        <span className="text-violet-700">
          {top.map((m) => m.query).slice(0, 3).join(" · ")}
        </span>
      </div>
      {done > 0 ? (
        <span className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white">
          Shipped {done} ✓ — measuring
        </span>
      ) : (
        <button
          onClick={shipTop}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 disabled:opacity-60"
        >
          {pending ? "Shipping…" : `⚡ Ship the top ${top.length}`}
        </button>
      )}
    </div>
  );
}
