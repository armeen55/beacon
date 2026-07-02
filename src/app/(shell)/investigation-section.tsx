/**
 * InvestigationSection (2026-07-02, master plan item 53) - the red attention
 * card for overnight forensic investigations. When last night's pass found a
 * high-severity page-family collapse (or the sitewide changepoint detector
 * flagged a high-magnitude drop), this renders the diagnosis headline plus
 * the top 2 ranked causes and the one action they imply, so a drop is
 * investigated overnight instead of just shown on a chart.
 *
 * Sibling pattern (OpsPipelineSection): server component, $0 persisted read
 * (never recomputes on render), self-hides when there is nothing fresh to
 * show, fail-soft to null, dark-mode + 375px safe (flex-wrap, break-words,
 * tabular-nums). Composed right beside the item-10 Ops card on Today.
 */
import { loadLatestInvestigations } from "@/domains/investigation/investigation-store";
import type { InvestigationDiagnosis, RankedCause } from "@/domains/investigation/rank-causes";

const MAX_CARDS = 2;
const MAX_CAUSES_SHOWN = 2;

/** A9 (operator-experience fix batch, 2026-07-02) - "algorithm_weather" is the one cause
 *  whose own sentence already hedges ("this may not be specific to this page") because it
 *  is a site-wide shift, not a page-level finding. A "Medium confidence." badge next to
 *  that hedge reads as the app contradicting itself, so this kind never gets the badge. */
function CauseRow({ cause }: { cause: RankedCause }) {
  const showConfidence = cause.kind !== "algorithm_weather";
  return (
    <li className="text-[12px] leading-relaxed text-red-900/90 dark:text-red-200/90">
      {showConfidence ? <span className="font-medium capitalize">{cause.confidence} confidence.</span> : null} {cause.sentence}
    </li>
  );
}

function DiagnosisCard({ diagnosis }: { diagnosis: InvestigationDiagnosis }) {
  const topCauses = diagnosis.causes.slice(0, MAX_CAUSES_SHOWN);
  const action = diagnosis.causes.find((c) => c.actionSentence)?.actionSentence ?? null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2.5 dark:border-red-900/60 dark:bg-red-950/40">
      <p className="min-w-0 break-words text-[13px] leading-relaxed text-red-900 dark:text-red-200 tabular-nums">
        {diagnosis.headline}
      </p>
      {topCauses.length > 0 ? (
        <ul className="mt-1.5 space-y-1 pl-0.5">
          {topCauses.map((c, i) => (
            <CauseRow key={`${diagnosis.familyLabel}-${c.kind}-${i}`} cause={c} />
          ))}
        </ul>
      ) : null}
      {action ? (
        <p className="mt-1.5 text-[12px] font-medium text-red-800 dark:text-red-300">Next step: {action}</p>
      ) : null}
    </div>
  );
}

export async function InvestigationSection({ tenantId }: { tenantId: string }) {
  try {
    const rows = await loadLatestInvestigations(tenantId, MAX_CARDS);
    if (rows.length === 0) return null;
    return (
      <section aria-label="Overnight investigation" className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">I investigated a clicks drop overnight</h2>
        </div>
        {rows.map((r) => (
          <DiagnosisCard key={r.key} diagnosis={r.diagnosis} />
        ))}
      </section>
    );
  } catch {
    return null;
  }
}
