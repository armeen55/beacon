/**
 * InvestigationSection (2026-07-02, master plan item 53; revised 2026-07-09
 * for operator spec B-10) - the red attention card for overnight forensic
 * investigations. When last night's pass found a high-severity page-family
 * collapse (or the sitewide changepoint detector flagged a high-magnitude
 * drop), this renders the drop headline plus the top ranked page-specific
 * causes and the one action they imply, so a drop is investigated overnight
 * instead of just shown on a chart.
 *
 * B-10 fix: each item states the drop once and stops - it used to also repeat
 * the same "most likely cause" sentence a second time as a sub-line, and
 * treated an unconfirmed sitewide weather shock as an invented, named cause
 * ("a Google shift I detected"). Now a weather shock is never a per-item
 * claim; it surfaces as ONE shared, honest hedge below every card in the
 * section, never duplicated per family.
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

function CauseRow({ cause }: { cause: RankedCause }) {
  return (
    <li className="text-[12px] leading-relaxed text-red-900/90 dark:text-red-200/90">
      <span className="font-medium capitalize">{cause.confidence} confidence.</span> {cause.sentence}
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
    // B-10: a sitewide shock is shared context, not a per-family claim - show
    // its sentence ONCE for the whole section, from the first row that has
    // one, instead of letting every card repeat it.
    const sharedWeatherSentence = rows.find((r) => r.diagnosis.weatherContext)?.diagnosis.weatherContext?.sentence ?? null;
    return (
      <section aria-label="Overnight investigation" className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">I investigated a clicks drop overnight</h2>
        </div>
        {rows.map((r) => (
          <DiagnosisCard key={r.key} diagnosis={r.diagnosis} />
        ))}
        {sharedWeatherSentence ? (
          <p className="min-w-0 break-words text-[12px] leading-relaxed text-red-900/80 dark:text-red-200/80">
            {sharedWeatherSentence}
          </p>
        ) : null}
      </section>
    );
  } catch {
    return null;
  }
}
