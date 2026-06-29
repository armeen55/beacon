"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prepareTopMovesAction, regenerateTopDraftsFromTeardownAction } from "./today-moves-actions";

/**
 * PrepareTopMovesButton (2026-06-25, P5) — "prepared, not chores" for Today Moves.
 * One click prepares the top existing-page Moves (specialist debate → structured
 * draft → experiment → proof plan, persisted), so each card arrives "ready to
 * review" with no per-card drafting. Operator-gated server-side; cache-first +
 * capped (re-runs are cheap). No publish.
 */
export function PrepareTopMovesButton({ readyCount, total }: { readyCount: number; total: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setMsg(null);
    start(async () => {
      try {
        const r = await prepareTopMovesAction({ maxN: 10 });
        if (!r.ok) {
          setMsg(r.reason);
          return;
        }
        const s = r.summary;
        setMsg(
          `Prepared ${s.prepared} (${s.cached} cached) · ${s.readyToReview} ready to review · $${s.llmCostUsd.toFixed(3)}${s.failed ? ` · ${s.failed} need a look` : ""}`,
        );
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
        title="Prepare your top Moves end-to-end (specialist debate, structured draft, experiment, proof plan) so each arrives ready to review — capped + cached, re-runs are cheap"
        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-60"
      >
        {pending ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
            Preparing…
          </>
        ) : (
          <>✦ Prepare my top 10{readyCount > 0 ? ` (${readyCount}/${total} ready)` : ""}</>
        )}
      </button>
      {msg ? <span className="text-[11px] text-gray-500">{msg}</span> : null}
    </div>
  );
}

/**
 * RegenerateFromTeardownButton (2026-06-28) — "improve the top drafts using the pages
 * that currently win." Re-runs the structured drafter for the top teardown-backed Moves
 * with the competitor's real facts threaded in ("beat it, don't copy it"). HARD $0.10
 * cap, top 3, every output quality-gated (a fail surfaces "Needs review", never fake
 * "ready"). Operator-gated server-side. No publish, no Wix.
 */
export function RegenerateFromTeardownButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setMsg(null);
    start(async () => {
      try {
        const r = await regenerateTopDraftsFromTeardownAction({ limit: 3, maxUsd: 0.1 });
        if (!r.ok) {
          setMsg(r.reason);
          return;
        }
        const s = r.summary;
        setMsg(
          `Improved ${s.regenerated} of ${s.considered} with competitor facts · $${s.llmCostUsd.toFixed(3)}${s.failed ? ` · ${s.failed} kept for review` : ""}${s.stoppedForBudget ? " · stopped at $0.10" : ""}`,
        );
        router.refresh();
      } catch {
        setMsg("Regenerate failed — try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title="Rewrite the top 3 teardown-backed drafts using the competitor pages that currently win (their structure/FAQ/schema as 'beat it, don't copy it'). Capped at $0.10; every draft must pass the quality gate."
        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-violet-700 transition-colors hover:border-violet-400 hover:bg-violet-50 disabled:opacity-60"
      >
        {pending ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-300 border-t-violet-600" />
            Improving…
          </>
        ) : (
          <>✦ Improve top 3 with competitor facts</>
        )}
      </button>
      {msg ? <span className="text-[11px] text-gray-500">{msg}</span> : null}
    </div>
  );
}
