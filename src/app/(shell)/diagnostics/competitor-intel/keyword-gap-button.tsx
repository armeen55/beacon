"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { findCompetitorKeywordGapsAction } from "./keyword-gap-action";

/**
 * KeywordGapButton (2026-07-02, master plan item 16) - "Find what competitors
 * rank for": one click checks the top 3 competitors' Google keyword portfolios
 * (bounded, 30-day cached, dry-run safe, shared monthly cap enforced server-side)
 * and shows the honest receipt with real spend. Operator-gated server-side too.
 */
export function KeywordGapButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setMsg(null);
    start(async () => {
      try {
        const r = await findCompetitorKeywordGapsAction();
        if (!r.ok) {
          setMsg(r.reason);
          return;
        }
        setMsg(r.message);
        if (r.status === "ok") router.refresh();
      } catch {
        setMsg("That check failed. Try again in a minute.");
      }
    });
  }

  return (
    <div className="flex max-w-sm flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title="I check your top 3 competitors for keywords they win on Google that you do not. Capped, cached for 30 days, and it never spends past the monthly budget."
        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-60"
      >
        {pending ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
            Checking their keywords...
          </>
        ) : (
          <>Find what competitors rank for</>
        )}
      </button>
      {msg ? <span className="text-right text-[11px] leading-snug text-gray-500">{msg}</span> : null}
    </div>
  );
}
