"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkAnswerRaceAction } from "./retrieval-twin-action";

/**
 * RetrievalTwinButton (2026-07-02, master plan item 50) - "Check who wins the answer race":
 * one click embeds your top pages + the competitor pages AI already cites, then simulates the
 * retrieval step an answer engine runs before it decides which passage to quote. Bounded,
 * budgeted (pennies), cached (re-runs are near-free). Operator-gated server-side too.
 */
export function RetrievalTwinButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [example, setExample] = useState<string | null>(null);

  function run() {
    setMsg(null);
    setExample(null);
    start(async () => {
      try {
        const r = await checkAnswerRaceAction();
        if (!r.ok) {
          setMsg(r.reason);
          return;
        }
        setMsg(r.message);
        setExample(r.exampleSentence);
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
        title="I embed your top pages and the competitor pages AI already cites, then simulate the retrieval step an answer engine runs before it picks a passage to quote. Costs pennies, cached after the first run."
        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-60"
      >
        {pending ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
            Checking the answer race...
          </>
        ) : (
          <>Check who wins the answer race</>
        )}
      </button>
      {msg ? <span className="text-right text-[11px] leading-snug text-gray-500">{msg}</span> : null}
      {example ? <span className="max-w-xs text-right text-[11px] leading-snug text-indigo-700">{example}</span> : null}
    </div>
  );
}
