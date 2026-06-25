import { currentTenantId } from "@/lib/tenant-context";
import { loadTopPagesWithQueriesForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { buildClusterPerformance, type ClusterPerf } from "./today-clusters-rows";

/**
 * today-clusters-section (2026-06-25) — "What content works": the tenant's pages
 * grouped by theme (URL prefix) and ranked by clicks, so the operator sees which
 * content TYPES drive traffic (make more) vs which lag (fix or retire). The
 * strategic portfolio view above the per-page lenses. Deterministic; self-hides
 * without page data.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

const BAR_COLORS = ["bg-emerald-500", "bg-teal-500", "bg-cyan-500", "bg-sky-500", "bg-indigo-500", "bg-violet-500", "bg-purple-500", "bg-slate-400"];

export async function TodayClustersSection() {
  let clusters: ClusterPerf[] = [];
  try {
    const tenantId = await currentTenantId();
    const pages = await loadTopPagesWithQueriesForTenant(tenantId).catch(() => []);
    // Sum each page's query metrics → per-page totals → cluster aggregation.
    const pageInputs = pages.map((p) => ({
      page: p.page,
      clicks: p.queries.reduce((s, q) => s + q.clicks, 0),
      impressions: p.queries.reduce((s, q) => s + q.impressions, 0),
    }));
    clusters = buildClusterPerformance(pageInputs);
  } catch {
    return null;
  }
  // Only meaningful when there's more than one theme to compare.
  if (clusters.length < 2) return null;

  const maxClicks = Math.max(1, ...clusters.map((c) => c.clicks));
  const top = clusters[0]!;

  return (
    <section className="rounded-3xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/40 via-white to-teal-50/20 p-6 shadow-sm">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
          <span className="text-emerald-500">▥</span> What content works
        </h2>
        <p className="mt-1 max-w-xl text-sm text-gray-500">
          Your pages grouped by theme, ranked by clicks. <span className="font-medium text-gray-700">{top.cluster}</span> is
          your strongest content type ({fmtNum(top.clicks)} clicks across {top.pages} {top.pages === 1 ? "page" : "pages"}) —
          the clearest signal of what to make more of.
        </p>
      </div>

      <ul className="mt-4 space-y-2">
        {clusters.map((c, i) => (
          <li key={c.cluster} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-gray-800">{c.cluster}</span>
              <span className="text-xs text-gray-500">
                <span className="font-semibold text-gray-900">{fmtNum(c.clicks)}</span> clicks · {c.pages} {c.pages === 1 ? "page" : "pages"} · {(c.ctr * 100).toFixed(1)}% CTR
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={BAR_COLORS[i % BAR_COLORS.length]}
                style={{ width: `${Math.max(2, (c.clicks / maxClicks) * 100)}%`, height: "100%" }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
