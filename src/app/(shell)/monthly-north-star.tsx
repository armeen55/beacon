/**
 * MonthlyNorthStar (2026-07-09 origin; 2026-07-10 P0-A truth fix) - the site overview /
 * north star strip on Today.
 *
 * P0-A: the sitewide monthly VISITS number was withdrawn because it summed non-additive
 * GA4 page-level sessions (see monthly-pulse.ts). This strip headlines the last full
 * month's Search Console clicks (the number we can prove) and states plainly that monthly
 * visits need reconciliation.
 *
 * Wave 2A (2026-07-10): visits come back, but ONLY behind a passing, fresh reconciliation
 * (the loader gates that). On a pass the strip adds a reconciled visits line and grades
 * the goal from visits (never clicks). On a mismatch it shows an honest alert and still
 * no number. With GA4 disconnected today, neither fires and the shipped hold-back stands.
 * A visits goal is never graded from clicks. Deadline-bounded + self-hiding; never a bare zero.
 */
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { loadMonthlyPulseForTenant } from "@/domains/north-star/load-monthly-pulse";

export async function MonthlyNorthStar({
  tenantId,
  monthlyVisitGoal,
}: {
  tenantId: string;
  monthlyVisitGoal: number | null;
}) {
  const raced = await loadWithDeadline(loadMonthlyPulseForTenant(tenantId, monthlyVisitGoal));
  if (raced.timedOut || !raced.data || !raced.data.headline) return null;
  const pulse = raced.data;

  // Wave 2A: reconciled goal/month-to-date copy wins when a pass produced it; otherwise
  // the shipped clicks-context lines stand.
  const goalLine = pulse.reconciledGoalLine ?? pulse.goalLine;
  const monthToDateLine = pulse.reconciledMonthToDateLine ?? pulse.monthToDateLine;
  const subLine = [goalLine, pulse.deltaLine, monthToDateLine].filter(Boolean).join(" ");

  const chipMonths = pulse.months.filter((m) => m.clicks != null);

  return (
    <section
      aria-label="Monthly progress"
      className="rounded-2xl border border-border bg-card p-4"
    >
      <p className="text-sm font-semibold text-foreground">{pulse.headline}</p>
      {pulse.reconciledVisitsHeadline ? (
        <p className="mt-1 text-sm font-semibold text-foreground">{pulse.reconciledVisitsHeadline}</p>
      ) : null}
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{pulse.reconciliationLine}</p>
      {subLine ? (
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{subLine}</p>
      ) : null}
      {chipMonths.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {chipMonths.map((m, i) => {
            const value = m.clicks!;
            const isLast = i === chipMonths.length - 1;
            return (
              <span
                key={m.month}
                className="rounded-lg border border-border px-2 py-1 text-[11px] tabular-nums text-muted-foreground"
              >
                {m.label.slice(0, 3)} {value.toLocaleString("en-US")}
                {isLast ? <span> so far</span> : null}
              </span>
            );
          })}
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-muted-foreground">
        These are your Search Console clicks. Updated with every data refresh.
      </p>
    </section>
  );
}
