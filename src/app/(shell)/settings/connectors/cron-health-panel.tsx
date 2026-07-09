import { loadCronHealthView, type JobHealthView } from "@/domains/ops/cron-health-view";
import { recoveryForCronFailure } from "@/domains/ops/recovery-actions";

/**
 * Cron health panel (BEACON_500 item 85, 2026-07-03; rescoped 2026-07-09, I-61).
 * Server Component: loads + renders in one pass (read-only).
 *
 * I-61 (operator spec 2026-07-09): the reliability report is NOISE unless
 * something needs action. "I showed up 5 of 5 nights" is a full green roster no
 * operator ever needs to read. So this panel now renders ONLY when at least one
 * scheduled job is actually FAILING or STALLED - and then shows only those jobs,
 * each with its amber/red line and next scheduled run. When everything ran on
 * schedule, the whole section disappears (returns null), same self-hiding
 * discipline as the Today Ops alert.
 *
 * Also removes the old "starts tonight" collapsed line: with freshness now
 * guaranteed on visit (I-59), an empty-but-healthy schedule is not something the
 * operator needs a standing reassurance about.
 */

/** A job needs the operator's attention when it is running behind or stalled, its
 *  last run had issues, or a source failed several nights in a row. Everything else
 *  ran on schedule and is intentionally not shown (I-61). */
function isJobFailingOrStalled(j: JobHealthView): boolean {
  if (j.pace === "late" || j.pace === "stalled") return true;
  if (j.lastRun != null && !j.lastRun.ok) return true;
  if (j.failureStreaks.length > 0) return true;
  return false;
}

export async function CronHealthPanel() {
  const jobs = await loadCronHealthView();
  const needsAttention = jobs.filter(isJobFailingOrStalled);
  // I-61: no failing/stalled job means nothing to report - the whole panel hides.
  if (needsAttention.length === 0) return null;

  return (
    <section className="rounded-lg border border-border/60 bg-surface p-5" data-cron-health-panel="true">
      <h3 className="text-[15px] font-semibold text-foreground">Scheduled work that needs attention</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        Everything else ran on schedule. These are the only jobs I could not complete cleanly.
      </p>

      <div className="mt-4 space-y-4">
        {needsAttention.map((j) => {
          // The last run failed even though the schedule pace looks fine (ran, but
          // errored) - a red line the pace sentence would otherwise not cover.
          const lastRunFailedOnly =
            j.lastRun != null && !j.lastRun.ok && j.pace !== "late" && j.pace !== "stalled";
          return (
            <div
              key={j.job}
              className="rounded-md border border-border/50 bg-surface-inset/30 px-3 py-2.5"
              data-cron-health-job={j.job}
            >
              <p className="text-[13px] font-semibold text-foreground">{j.label}</p>

              {(j.pace === "late" || j.pace === "stalled") && j.paceSentence && (
                <>
                  <p
                    className={`mt-1 text-[12px] font-medium ${j.pace === "stalled" ? "text-status-danger" : "text-status-warning"}`}
                    data-cron-health-pace={j.pace}
                  >
                    {j.paceSentence}
                  </p>
                  {/* T0b - the exact recovery for this job, from the SAME shared map
                      Today's alert and the Connections cards read, so a stalled job
                      never gets a dead end here. */}
                  <p className="mt-1 text-[12px] text-muted-foreground" data-cron-health-fix={j.pace}>
                    <span className="font-semibold text-foreground">Fix this:</span>{" "}
                    {recoveryForCronFailure(j.job, j.label, j.pace).exactFix}
                  </p>
                </>
              )}

              {lastRunFailedOnly && (
                <p className="mt-1 text-[12px] font-medium text-status-danger" data-cron-health-lastrun="issues">
                  The last run had issues.
                </p>
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
          );
        })}
      </div>
    </section>
  );
}
