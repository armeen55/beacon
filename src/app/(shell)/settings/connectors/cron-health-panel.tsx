import { loadCronHealthView } from "@/domains/ops/cron-health-view";
import { recoveryForCronFailure } from "@/domains/ops/recovery-actions";

/**
 * Cron health panel (BEACON_500 item 85, 2026-07-03) - "I showed up every
 * night this week" for every scheduled job. Server Component: loads +
 * renders in one pass (no client round-trip needed, this is read-only).
 * Self-quiets to nothing interesting rather than erroring - a job with no
 * history yet (pre-migration, or brand new) shows "I have not run yet."
 * instead of a scary blank state.
 *
 * FP7 finding (2026-07-02): a section titled "How reliably I show up" that
 * renders "I have not run yet." on every single job proves the opposite of
 * its own name. Until at least one job has a real run receipt, collapse the
 * whole panel to one honest line instead of a wall of empty statuses. Once
 * any job has run, it renders the full per-job breakdown as before.
 */
export async function CronHealthPanel() {
  const jobs = await loadCronHealthView();
  const hasAnyRun = jobs.some((j) => j.lastRun != null);

  if (!hasAnyRun) {
    // T0c - the collapsed line stays honest: once a first scheduled moment
    // has passed with no receipt at all, say so (same deadman words as the
    // Today banner) instead of promising "starts tonight" forever.
    const overdue =
      jobs.find((j) => j.pace === "stalled" && j.paceSentence) ??
      jobs.find((j) => j.pace === "late" && j.paceSentence);
    return (
      <section className="rounded-lg border border-border/60 bg-surface p-5" data-cron-health-panel="true" data-cron-health-collapsed="true">
        <h3 className="text-[15px] font-semibold text-foreground">How reliably I show up</h3>
        {overdue ? (
          <>
            <p
              className={`mt-1 text-[13px] font-medium leading-relaxed ${overdue.pace === "stalled" ? "text-status-danger" : "text-status-warning"}`}
              data-cron-health-pace={overdue.pace}
            >
              {overdue.paceSentence}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground" data-cron-health-fix={overdue.pace}>
              <span className="font-semibold text-foreground">Fix this:</span>{" "}
              {recoveryForCronFailure(overdue.job, overdue.label, overdue.pace as "late" | "stalled").exactFix}
            </p>
          </>
        ) : (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Nightly work starts tonight around 2 AM. I will show receipts for every run here.
          </p>
        )}
      </section>
    );
  }

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

            {(j.pace === "late" || j.pace === "stalled") && j.paceSentence && (
              <>
                <p
                  className={`mt-2 text-[12px] font-medium ${j.pace === "stalled" ? "text-status-danger" : "text-status-warning"}`}
                  data-cron-health-pace={j.pace}
                >
                  {j.paceSentence}
                </p>
                {/* T0b (2026-07-03) - the exact recovery for this job, from the
                    SAME shared map Today's alert and the Connections cards
                    read, so a stalled job never gets a "tell me and I will
                    investigate" dead end here. */}
                <p className="mt-1 text-[12px] text-muted-foreground" data-cron-health-fix={j.pace}>
                  <span className="font-semibold text-foreground">Fix this:</span>{" "}
                  {recoveryForCronFailure(j.job, j.label, j.pace).exactFix}
                </p>
              </>
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
