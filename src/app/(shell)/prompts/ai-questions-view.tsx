import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import type { AiQuestionsData } from "./ai-questions-data";

/**
 * AI Questions view (2026-06-28) — the Profound-powered surface: the questions AI
 * assistants already answer about this topic, who they cite, and whether we're
 * absent. Pure presentation over `loadAiQuestions` (ActionPack Profound receipts).
 * Each row links to the move that answers it on the worklist.
 */
function Stat({
  value,
  label,
  accent,
  subtitle,
}: {
  value: string;
  label: string;
  accent: string;
  /** D9 (2026-07-02): distinguishes this tile's metric from a similarly-named
   *  one elsewhere (e.g. "Rival domains cited" here vs "Competitor domains"
   *  on /competitors) so the two numbers never read as interchangeable. */
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
      <span className={`text-2xl font-semibold tracking-tight ${accent}`}>{value}</span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
      {subtitle ? <span className="text-[10px] text-gray-400">{subtitle}</span> : null}
    </div>
  );
}

export function AiQuestionsView({ data }: { data: AiQuestionsData }) {
  const { questions, totals } = data;
  // D10 (2026-07-02): totals.cited counts every un-clustered AI question that
  // is cited; the rendered list clusters near-duplicates down to one row per
  // group, so fewer "cited" rows are actually visible than the tile's count.
  const citedRowsShown = questions.filter((q) => !q.ownAbsent).length;
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="AI questions"
        description="The questions AI assistants are already answering about your topic, who they cite, and where you're absent. Each links to the move that wins it."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={String(totals.questions)} label="AI questions" accent="text-gray-900" />
        <Stat value={String(totals.absent)} label="You're absent" accent="text-amber-600" />
        <Stat value={String(totals.cited)} label="You're cited" accent="text-emerald-600" />
        <Stat
          value={String(totals.citedDomains)}
          label="Rival domains cited"
          accent="text-violet-600"
          subtitle="on the questions I track"
        />
      </div>

      {questions.length < totals.questions ? (
        <p className="text-[12px] text-gray-500">
          Showing {questions.length} topic{questions.length === 1 ? "" : "s"} clustered from {totals.questions} AI
          questions, near-duplicates are grouped
          {citedRowsShown < totals.cited ? ` (showing ${citedRowsShown} of ${totals.cited} cited)` : ""}.
        </p>
      ) : null}

      <ul className="space-y-2">
        {questions.map((q) => (
          <li key={q.id}>
            <Link
              href="/changes"
              prefetch={false}
              className="block rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition-colors hover:border-accent-primary/40 hover:bg-surface-raised/30"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-[14px] font-medium leading-snug text-gray-900">{q.prompt}</p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                    q.ownAbsent
                      ? "bg-amber-50 text-amber-700 ring-amber-200"
                      : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  }`}
                >
                  {q.ownAbsent ? "You're absent" : "You're cited"}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                {q.fanoutCount > 0 ? `${q.fanoutCount} follow-up question${q.fanoutCount === 1 ? "" : "s"} · ` : ""}
                {q.citedDomains.length > 0
                  ? `AI cites ${q.citedDomains.slice(0, 3).join(", ")}${q.citedDomains.length > 3 ? ` +${q.citedDomains.length - 3}` : ""}`
                  : "No competitor citations recorded"}
              </p>
              <p className="mt-1.5 text-[11px] font-medium text-accent-primary">
                {q.actionLabelShort}
                {q.relatedCount > 0 ? ` · +${q.relatedCount} related` : ""} →
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-[11px] leading-relaxed text-gray-400">
        Sourced from cached AI answer tracking. Questions where AI cites rivals
        but not you are shown first, those are the openings.
      </p>
    </div>
  );
}
