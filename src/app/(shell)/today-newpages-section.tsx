import Link from "next/link";
import { loadNewPagesData } from "./today-newpages-data";
import { NewPageCard } from "./today-newpages-card";
import { NewPagesPrepareButton } from "./today-newpages-prepare";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";

/**
 * today-newpages-section (2026-06-24) — the "New Pages to Build" board: the
 * create_page half of the Rank-&-Revenue engine. Topics competitors own that the
 * tenant has no page for — the biggest growth lever — surfaced as a premium board,
 * each card with the competitor teardown + an on-demand "✨ Draft the opening".
 * Read-only, tenant-agnostic; self-hides when there are none.
 */

export async function TodayNewPagesSection({ enableAeoBrief = false, limit }: { enableAeoBrief?: boolean; limit?: number } = {}) {
  let data;
  try {
    // FP1 (2026-07-02) - this board can rebuild the demand graph on a cold cache,
    // the slowest read on Today. Deadline-bounded so its pulse skeleton can never
    // strand; the abandoned build keeps running and warms the cache.
    const raced = await loadWithDeadline(loadNewPagesData());
    if (raced.timedOut) return <HonestDelay />;
    data = raced.data;
  } catch {
    return null;
  }
  if (!data.opportunities.length) return null;

  const operator = await isOperatorModeServer();
  const preparedCount = data.opportunities.filter((o) => o.preparedVerdict).length;
  // Item 53 - Today shows only the 3 best; the full board lives on /worklist.
  const shown = limit ? data.opportunities.slice(0, limit) : data.opportunities;

  return (
    <section id="new-pages" className="rounded-3xl border border-gray-200 bg-gradient-to-br from-emerald-50/40 via-white to-gray-50 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900">New pages to build</h2>
          {/* A7 (operator-experience fix batch, 2026-07-02) - "competitor pages get cited for
              this, you have no page yet" used to repeat verbatim on every card below. Said once
              here for the whole board; each card now only names its own competitor count. */}
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Competitor pages get cited for these topics, and you have no page yet. The fastest way to
            capture demand AI and Google are already sending elsewhere.
          </p>
        </div>
        <div className="flex items-start gap-2">
          {operator && !limit ? <NewPagesPrepareButton alreadyPrepared={preparedCount} total={data.opportunities.length} /> : null}
          {limit && data.opportunities.length > limit ? (
            // UX4 item 5 - Today shows only the top 3; the rest live in Changes (/worklist),
            // named explicitly so the operator knows exactly where the other N went.
            <Link
              href="/worklist#new-pages"
              className="rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
            >
              See all {data.opportunities.length} in Changes →
            </Link>
          ) : null}
          {!limit && data.totalCandidates > data.opportunities.length ? (
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
        {shown.map((o) => (
          <NewPageCard key={o.id} o={o} ownDomain={data.ownDomain} enableAeoBrief={enableAeoBrief} />
        ))}
      </div>
    </section>
  );
}
