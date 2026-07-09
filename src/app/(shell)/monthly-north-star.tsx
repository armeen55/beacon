/**
 * MonthlyNorthStar (2026-07-09, operator spec B-6) - the site overview / north
 * star strip on Today: last full month's visits + clicks, honest goal progress,
 * current month clearly labeled "so far". Monthly framing on purpose (the
 * operator: weekly won't cut it). Deadline-bounded + self-hiding; never a bare
 * zero.
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

  const chipMonths = pulse.months.filter((m) => m.visits != null || m.clicks != null);

  return (
    <section
      aria-label="Monthly progress"
      className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <p className="text-sm font-semibold text-gray-900 dark:text-neutral-100">{pulse.headline}</p>
      {subLine ? (
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500 dark:text-neutral-400">{subLine}</p>
      ) : null}
      {chipMonths.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {chipMonths.map((m, i) => {
            const value = (m.visits ?? m.clicks)!;
            const isLast = i === chipMonths.length - 1;
            return (
              <span
                key={m.month}
                className="rounded-lg border border-gray-100 px-2 py-1 text-[11px] tabular-nums text-gray-600 dark:border-neutral-800 dark:text-neutral-300"
              >
                {m.label.slice(0, 3)} {value.toLocaleString("en-US")}
                {isLast ? <span className="text-gray-400"> so far</span> : null}
              </span>
            );
          })}
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-gray-400 dark:text-neutral-500">
        Visits are from your Google Analytics and clicks from Search Console. Updated with every data refresh.
      </p>
    </section>
  );
}
