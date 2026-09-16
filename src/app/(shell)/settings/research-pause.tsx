"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setDailyBudgetNow, setResearchPausedNow } from "./actions";

/**
 * The pause switch over daily research (2026-08-02; three states 2026-08-14).
 *
 * Beacon researches every day on its own, so the operator needs a way to say "stop for a while" that is
 * honest about what stopping costs. It lives on Settings, not on a primary surface: this is a setting, not
 * a decision. Two promises stay on the screen in both live states, because both are ones a customer would
 * otherwise have to guess at: pausing deletes nothing, and resuming does not go back and fill in the days
 * that were skipped. THE THIRD STATE IS NOT A GUESS. When the switch itself could not be read, this says so
 * and offers no toggle: rendering "on" or "paused" there would be a claim about whether money is being spent.
 */
export function ResearchPause({ permission, budgetUsd }: { permission: "paused" | "running" | "unreadable"; budgetUsd: number | null }) {
  const router = useRouter();
  const [state, setState] = useState(permission);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const paused = state === "paused";
  // THE DAILY BUDGET, THE ONE NUMBER EVERY PAID DOOR ENFORCES (2026-09-16): whole dollars, saved on press, read back before the screen claims it.
  const [budget, setBudget] = useState<string>(budgetUsd == null ? "" : String(budgetUsd));
  const [budgetSaid, setBudgetSaid] = useState<string | null>(null);
  const saveBudget = () => { const n = Math.round(Number(budget)); if (!Number.isFinite(n) || n < 0 || n > 50) { setBudgetSaid("Enter a whole number of dollars from 0 to 50."); return; }
    startTransition(async () => { const res = await setDailyBudgetNow(n).catch(() => ({ ok: false })); setBudgetSaid(res.ok ? `Saved. Research spends at most $${n} a day from the next pass.` : "That could not be saved just now; try again in a minute."); if (res.ok) router.refresh(); }); };

  const toggle = () => {
    const next = !paused;
    setFailed(false);
    startTransition(async () => {
      const res = await setResearchPausedNow(next).catch(() => ({ ok: false }));
      if (!res.ok) { setFailed(true); return; }
      setState(next ? "paused" : "running");
      router.refresh();
    });
  };

  return (
    <section className="mt-6 rounded-lg border border-border/60 bg-surface px-4 py-3.5">
      <p className="text-[13px] font-semibold text-foreground">Daily research</p>
      {state === "unreadable" ? (
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
          The daily research setting could not be checked just now, so neither state is shown. Reload Settings in a minute to check it again.
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {paused ? "Daily research is paused. Nothing new starts, and nothing already found was deleted."
              : "Daily research is on. It runs every day on its own schedule, a visit only resumes a missed day, so there is no need to leave Beacon open."}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            Paused days stay blank, and research picks up from today.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={toggle} disabled={pending} aria-busy={pending}
              className="min-h-[44px] rounded-md border border-border/60 bg-background px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-60">
              {paused ? "Resume daily research" : "Pause daily research"}
            </button>
            {failed && (
              <span className="text-[12px] text-status-danger">That could not be saved just now; try again in a minute.</span>
            )}
          </div>
        </>
      )}
      <div className="mt-4 border-t border-border/60 pt-3" data-daily-budget="true">
        <label htmlFor="daily-budget" className="text-[13px] font-semibold text-foreground">Daily research budget</label>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{budgetUsd == null ? "The budget could not be read just now." : `Research spends at most $${budgetUsd} a day across searches and writing. 0 turns paid work off for the day; nothing already found is touched.`}</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[13px] text-muted-foreground">$</span>
          <input id="daily-budget" type="number" min={0} max={50} step={1} value={budget} onChange={(e) => setBudget(e.target.value)} className="w-20 rounded-md border border-border/60 bg-background px-2 py-1.5 text-[13px] text-foreground" />
          <button type="button" onClick={saveBudget} disabled={pending} className="min-h-[36px] rounded-md border border-border/60 bg-background px-3 py-1.5 text-[12px] font-medium text-foreground hover:border-foreground/30 disabled:opacity-60">Save budget</button>
          {budgetSaid ? <span className="text-[12px] text-muted-foreground">{budgetSaid}</span> : null}
        </div>
      </div>
    </section>
  );
}
