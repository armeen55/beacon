"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setResearchPausedNow } from "./actions";

/**
 * The pause switch over daily research (2026-08-02).
 *
 * Beacon researches every day on its own now, so the operator needs a way to say "stop for a while"
 * that is honest about what stopping costs. It lives on Settings, not on a primary surface: this is a
 * setting, not a decision. Two promises are on the screen at all times, because both are the ones a
 * customer would otherwise have to guess at: pausing deletes nothing, and resuming does not go back
 * and fill in the days that were skipped.
 */
export function ResearchPause({ paused: initial }: { paused: boolean }) {
  const router = useRouter();
  const [paused, setPaused] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !paused;
    setFailed(false);
    startTransition(async () => {
      const res = await setResearchPausedNow(next).catch(() => ({ ok: false }));
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setPaused(next);
      router.refresh();
    });
  };

  return (
    <section className="mt-6 rounded-lg border border-border/60 bg-surface px-4 py-3.5">
      <p className="text-[13px] font-semibold text-foreground">Daily research</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
        {paused
          ? "Daily research is paused. Nothing new starts, and nothing already found was deleted."
          : "Daily research is on. Your site is checked once a day automatically, so you do not need to leave Beacon open."}
      </p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
        Paused days stay blank, and research picks up from today.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-busy={pending}
          className="min-h-[44px] rounded-md border border-border/60 bg-background px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {paused ? "Resume daily research" : "Pause daily research"}
        </button>
        {failed && (
          <span className="text-[12px] text-status-danger">
            That could not be saved just now; try again in a minute.
          </span>
        )}
      </div>
    </section>
  );
}
