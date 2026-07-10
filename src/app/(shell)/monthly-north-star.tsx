/**
 * MonthlyNorthStar (2026-07-09 origin; 2026-07-10 P0-A truth fix) - the site overview /
 * north star strip on Today.
 *
 * P0-A: the sitewide monthly VISITS number was withdrawn because it summed non-additive
 * GA4 page-level sessions (see monthly-pulse.ts). This strip now headlines the last full
 * month's Search Console clicks (the number we can prove), states plainly that monthly
 * visits need reconciliation, and shows honest goal/delta/month-to-date lines. A visits
 * goal is never graded from clicks. Deadline-bounded + self-hiding; never a bare zero.
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

  const subLine = [pulse.goalLine, pulse.deltaLine, pulse.monthToDateLine].filter(Boolean).join(" ");

  const chipMonths = pulse.months.filter((m) => m.clicks != null);

  return (
    <section
      aria-label="Monthly progress"
      className="rounded-2xl border border-border bg-card p-4"
    >
      <p className="text-sm font-semibold text-foreground">{pulse.headline}</p>
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
