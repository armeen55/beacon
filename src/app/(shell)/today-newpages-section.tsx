import Link from "next/link";
import { loadNewPagesData, type NewPageOpportunity } from "./today-newpages-data";

/**
 * today-newpages-section (2026-06-24) — the "New Pages to Build" board: the
 * create_page half of the Rank-&-Revenue engine. Topics competitors own that the
 * tenant has no page for — the biggest growth lever — surfaced as a premium board.
 * Read-only, tenant-agnostic; self-hides when there are none.
 */

const TIER: Record<NewPageOpportunity["tier"], { label: string; cls: string }> = {
  hot: { label: "Hot", cls: "bg-rose-50 text-rose-600 ring-rose-200" },
  warm: { label: "Warm", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  emerging: { label: "Emerging", cls: "bg-gray-100 text-gray-500 ring-gray-200" },
};

function OppCard({ o }: { o: NewPageOpportunity }) {
  const tier = TIER[o.tier];
  return (
    <div className="group flex flex-col justify-between rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            New page
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${tier.cls}`}>{tier.label}</span>
        </div>
        <h3 className="mt-2.5 text-[15px] font-semibold leading-snug tracking-tight text-gray-900">{o.topic}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
          {o.competitorCount > 0 ? (
            <>
              <span className="font-medium text-gray-700">{o.competitorCount}</span> competitor page
              {o.competitorCount === 1 ? "" : "s"} get cited for this — you have no page yet.
            </>
          ) : (
            <>There&apos;s demand for this and none of your pages covers it yet.</>
          )}
        </p>
        {o.topCompetitor ? (
          <p className="mt-1 text-[11px] text-gray-400">e.g. {o.topCompetitor}</p>
        ) : null}
      </div>
      <Link
        href="/pages"
        className="mt-3 inline-flex items-center gap-1 self-start rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700"
      >
        Plan this page →
      </Link>
    </div>
  );
}

export async function TodayNewPagesSection() {
  let data;
  try {
    data = await loadNewPagesData();
  } catch {
    return null;
  }
  if (!data.opportunities.length) return null;

  return (
    <section className="rounded-3xl border border-gray-200 bg-gradient-to-br from-emerald-50/40 via-white to-gray-50 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900">New pages to build</h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Topics competitors own that you have no page for — the fastest way to capture demand AI and
            Google are already sending elsewhere.
          </p>
        </div>
        {data.totalCandidates > data.opportunities.length ? (
          <Link
            href="/diagnostics/rank-revenue"
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
          >
            +{data.totalCandidates - data.opportunities.length} more →
          </Link>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.opportunities.map((o) => (
          <OppCard key={o.id} o={o} />
        ))}
      </div>
    </section>
  );
}
