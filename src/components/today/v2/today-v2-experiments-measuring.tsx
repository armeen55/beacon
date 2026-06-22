/**
 * TodayV2ExperimentsMeasuring — "your shipped changes are being tracked".
 *
 * Closes the operator loop on the home screen: the Plan says what to do, and
 * this says what you already shipped and that Beacon is measuring it against
 * untreated pages. Reads the SAME GSC proof ledger as /proof, so Today and
 * Proof never disagree. SELF-HIDES when nothing is being measured, so the home
 * screen stays quiet until there is real shipped work to track.
 *
 * Pure presentational. Honest framing: "measuring", a date, and a link — never
 * a claimed result before a window has closed.
 */

import Link from "next/link";

export type MeasuringExperiment = { path: string; actionType: string };

function humanizeAction(actionType: string): string {
  return actionType.replace(/_/g, " ");
}

export function TodayV2ExperimentsMeasuring({
  count,
  nextCheckDate,
  recent,
}: {
  count: number;
  nextCheckDate: string | null;
  recent: ReadonlyArray<MeasuringExperiment>;
}) {
  if (count === 0) return null;
  return (
    <article
      className="rounded-lg border border-accent-primary/30 bg-accent-primary/[0.04] px-5 py-5"
      data-today-v2-card="experiments-measuring"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-accent-primary">
          Measuring
        </span>
        <Link
          href="/proof"
          prefetch={false}
          className="text-[12px] font-medium text-foreground underline-offset-2 hover:underline"
        >
          {`Track all ${count} in Proof & Learning →`}
        </Link>
      </div>
      <p className="mt-2 text-[15px] font-semibold leading-snug text-foreground">
        {count} change{count === 1 ? "" : "s"} shipped and measuring
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {nextCheckDate
          ? `First results around ${nextCheckDate}. `
          : ""}
        Beacon compares each page to comparable untreated pages on the same site at 7, 14, and 28 days.
      </p>
      {recent.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {recent.map((e) => (
            <li key={e.path} className="flex items-baseline gap-2 text-[12px]">
              <span className="truncate font-medium text-foreground">{e.path}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {humanizeAction(e.actionType)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
