import Link from "next/link";
import { loadNewPagesData } from "./today-newpages-data";
import { NewPageCard } from "./today-newpages-card";
import { NewPagesPrepareButton } from "./today-newpages-prepare";
import { isOperatorModeServer } from "@/lib/operator-mode";

/**
 * today-newpages-section (2026-06-24) — the "New Pages to Build" board: the
 * create_page half of the Rank-&-Revenue engine. Topics competitors own that the
 * tenant has no page for — the biggest growth lever — surfaced as a premium board,
 * each card with the competitor teardown + an on-demand "✨ Draft the opening".
 * Read-only, tenant-agnostic; self-hides when there are none.
 */

export async function TodayNewPagesSection({ enableAeoBrief = false }: { enableAeoBrief?: boolean } = {}) {
  let data;
  try {
    data = await loadNewPagesData();
  } catch {
    return null;
  }
  if (!data.opportunities.length) return null;

  const operator = await isOperatorModeServer();
  const preparedCount = data.opportunities.filter((o) => o.preparedVerdict).length;

  return (
    <section id="new-pages" className="rounded-3xl border border-gray-200 bg-gradient-to-br from-emerald-50/40 via-white to-gray-50 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900">New pages to build</h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Topics competitors own that you have no page for — the fastest way to capture demand AI and
            Google are already sending elsewhere.
          </p>
        </div>
        <div className="flex items-start gap-2">
          {operator ? <NewPagesPrepareButton alreadyPrepared={preparedCount} total={data.opportunities.length} /> : null}
          {data.totalCandidates > data.opportunities.length ? (
            <Link
              href="/diagnostics/rank-revenue"
              className="rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
            >
              +{data.totalCandidates - data.opportunities.length} more →
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.opportunities.map((o) => (
          <NewPageCard key={o.id} o={o} ownDomain={data.ownDomain} enableAeoBrief={enableAeoBrief} />
        ))}
      </div>
    </section>
  );
}
