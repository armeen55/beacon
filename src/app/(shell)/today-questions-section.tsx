import { currentTenantId } from "@/lib/tenant-context";
import { loadQuestionQueries } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { buildAnswerOpportunities, answerImpressionsAtStake } from "./today-questions-rows";

/**
 * today-questions-section (2026-06-25) — "Questions people ask — add the answer":
 * the AEO answer-block lens. Questions the tenant already appears for (real
 * impressions) but earns ~no clicks on, because nothing directly answers them.
 * A concise answer block / FAQ wins the snippet + the AI-overview citation. GSC-
 * grounded (long-tail via ILIKE); self-hides when none.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export async function TodayQuestionsSection() {
  let rows: ReturnType<typeof buildAnswerOpportunities> = [];
  try {
    const tenantId = await currentTenantId();
    const queries = await loadQuestionQueries(tenantId).catch(() => []);
    rows = buildAnswerOpportunities(queries);
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const impressionsAtStake = answerImpressionsAtStake(rows);

  return (
    <section className="rounded-3xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50/50 via-white to-violet-50/20 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-indigo-500">❓</span> Questions people ask — add the answer
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            People ask Google these questions and your site shows up — but almost nobody clicks, because no
            page answers them directly. Add a short, clear answer (a paragraph or FAQ) to win the snippet and
            the AI answer-box citation.
          </p>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-white px-4 py-2 text-right">
          <div className="text-2xl font-semibold tracking-tight text-indigo-600">~{fmtNum(impressionsAtStake)}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">monthly impressions, ~unclicked</div>
        </div>
      </div>

      <ul className="mt-5 space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-white/70 px-3 py-2 text-sm">
            <span className="min-w-0 font-medium text-gray-900">{r.query}</span>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-indigo-600">{fmtNum(r.impressions)} impressions</span>
              <span className="text-gray-500">{(r.ctr * 100).toFixed(1)}% click rate — answer it</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
