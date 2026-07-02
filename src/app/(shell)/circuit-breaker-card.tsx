"use client";

/**
 * "I paused myself" card (2026-07-02, BEACON 500 item 80).
 *
 * Self-hiding: renders nothing unless the portfolio circuit breaker is
 * tripped for this tenant. Plain language, real numbers (the reason line
 * already carries them, computed server-side by circuit-breaker.ts from the
 * tenant's own settled results), what is paused, what still works, and a
 * one-click Resume. Shared by the Today mount and the autopilot settings
 * area - same component, same view shape.
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { resumeAutopilotCircuitBreaker, type CircuitBreakerCardView } from "./circuit-breaker-actions";

export function CircuitBreakerCard({ view }: { view: CircuitBreakerCardView }) {
  const router = useRouter();
  const [resumed, setResumed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onResume = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const res = await resumeAutopilotCircuitBreaker();
      if (res.ok) {
        setResumed(true);
        router.refresh();
      } else {
        setError(res.reason);
      }
    });
  }, [router]);

  if (!view.tripped || resumed) return null;

  return (
    <section
      aria-label="Autopilot paused itself"
      className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3.5 dark:border-amber-900/60 dark:bg-amber-950/30"
      data-circuit-breaker-card="true"
      data-circuit-breaker-tripped="true"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5 text-amber-600 dark:text-amber-400">⏸</span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">I paused myself</p>
          <p className="break-words text-[13px] leading-relaxed text-amber-900/90 dark:text-amber-200/90 tabular-nums">
            {view.reason}
          </p>
          <p className="text-[12px] leading-relaxed text-amber-800/80 dark:text-amber-300/70">
            What is paused: shipping new changes on my own and putting old versions back on my own.
            What still works: everything you do by hand, results tracking, and every card in your worklist.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <button
          type="button"
          onClick={onResume}
          disabled={pending}
          className="rounded-md bg-amber-700 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
          data-circuit-breaker-action="resume"
        >
          {pending ? "Resuming…" : "Resume autopilot"}
        </button>
        <span className="text-[11px] text-amber-800/70 dark:text-amber-300/60">
          This also clears the count that tripped me, so I start fresh.
        </span>
      </div>
      {error ? (
        <p className="pl-6 text-[12px] text-status-danger" data-circuit-breaker-error="true">
          {error}
        </p>
      ) : null}
    </section>
  );
}
