"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prepareNewPagesAction } from "./serp-actions";

/**
 * NewPagesPrepareButton (2026-06-25) — "prepared, not chores". One click Google-
 * checks ALL top create-page candidates (capped + cached + ledgered inside the
 * action) and persists the verdicts, so every card arrives "Google checked:
 * BUILD/WAIT/SKIP" with no per-card validation. Operator-gated server-side.
 */
export function NewPagesPrepareButton({ alreadyPrepared, total }: { alreadyPrepared: number; total: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setMsg(null);
    start(async () => {
      try {
        const r = await prepareNewPagesAction({ maxValidations: 25 });
        if (!r.ok) {
          setMsg(r.reason);
          return;
        }
        const s = r.summary;
        setMsg(`Prepared ${s.validated + s.cached} (${s.cached} cached) · $${s.costUsd.toFixed(3)}${s.capped ? " · cap hit" : ""}`);
        router.refresh();
      } catch {
        setMsg("Prepare failed — try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title="Run a live Google SERP check on the top create-page candidates and verdict them (build/wait/skip) — capped + cached, so re-runs are cheap"
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:border-emerald-400 hover:bg-emerald-50 disabled:opacity-60"
      >
        {pending ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-300 border-t-emerald-600" />
            Google-checking…
          </>
        ) : (
          <>✦ Prepare all{alreadyPrepared > 0 ? ` (${alreadyPrepared}/${total} done)` : ""}</>
        )}
      </button>
      {msg ? <span className="text-[11px] text-gray-500">{msg}</span> : null}
    </div>
  );
}
