import { loadCronHealthView } from "@/domains/ops/cron-health-view";

/**
 * Cron health panel (BEACON_500 item 85, 2026-07-03) - "I showed up every
 * night this week" for every scheduled job. Server Component: loads +
 * renders in one pass (no client round-trip needed, this is read-only).
 * Self-quiets to nothing interesting rather than erroring - a job with no
 * history yet (pre-migration, or brand new) shows "I have not run yet."
 * instead of a scary blank state.
 */
export async function CronHealthPanel() {
  const jobs = await loadCronHealthView();

  return (
    <section className="rounded-lg border border-border/60 bg-surface p-5" data-cron-health-panel="true">
      <h3 className="text-[15px] font-semibold text-foreground">How reliably I show up</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        Every job I run overnight, whether it showed up, and what is scheduled next.
      </p>

      <div className="mt-4 space-y-4">
        {jobs.map((j) => (
          <div
            key={j.job}
            className="rounded-md border border-border/50 bg-surface-inset/30 px-3 py-2.5"
            data-cron-health-job={j.job}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-foreground">{j.label}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{j.headline}</p>
              </div>
              <span
                className={
                  j.lastRun == null
                    ? "shrink-0 rounded-full bg-surface-inset px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
                    : j.lastRun.ok
                      ? "shrink-0 rounded-full bg-status-success/15 px-2 py-0.5 text-[11px] font-semibold text-status-success"
                      : "shrink-0 rounded-full bg-status-danger/15 px-2 py-0.5 text-[11px] font-semibold text-status-danger"
                }
              >
                {j.lastRun == null ? "No history yet" : j.lastRun.ok ? "Last run OK" : "Last run had issues"}
              </span>
            </div>

            {j.perSourceThisWeek.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {j.perSourceThisWeek.map((s) => (
                  <li
                    key={s.provider}
                    className="text-[12px] text-muted-foreground"
                    data-cron-health-source={s.provider}
                  >
                    {s.label}: {s.successNights} of {s.totalNights} nights synced
                  </li>
                ))}
              </ul>
            )}

            {j.failureStreaks.length > 0 && (
              <div className="mt-2 space-y-1" data-cron-health-streaks="true">
                {j.failureStreaks.map((s) => (
                  <p
                    key={`${s.tenantId}-${s.provider}`}
                    className="text-[12px] font-medium text-status-danger"
                    data-cron-health-streak={s.provider}
                  >
                    {s.label} has failed {s.consecutiveFailures} nights in a row.
                    {s.lastFailureDetail ? ` Last error: ${s.lastFailureDetail}.` : ""}
                  </p>
                ))}
              </div>
            )}

            {j.nextScheduledAtIso && (
              <p className="mt-2 text-[11px] text-muted-foreground/80">
                Next scheduled run: {new Date(j.nextScheduledAtIso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
