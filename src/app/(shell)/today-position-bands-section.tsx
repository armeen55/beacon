import { currentTenantId } from "@/lib/tenant-context";
import { loadTopPagesWithQueriesForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { buildPositionBands, totalBandQueries } from "./today-position-bands-rows";

/**
 * today-position-bands-section (2026-06-25) — "Where you rank": a portfolio view of
 * the tenant's query ranking distribution by position band, so the operator sees
 * the opportunity funnel (winning vs striking-distance vs page-2 vs beyond) instead
 * of only per-page tasks. Deterministic; self-hides without query data.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

const BAND_COLOR: Record<string, string> = {
  top3: "bg-emerald-500",
  striking: "bg-amber-500",
  page2: "bg-orange-400",
  beyond: "bg-gray-300",
};

export async function TodayPositionBandsSection() {
  let bands: ReturnType<typeof buildPositionBands> = [];
  try {
    const tenantId = await currentTenantId();
    const pages = await loadTopPagesWithQueriesForTenant(tenantId).catch(() => []);
    const queries = pages.flatMap((p) => p.queries);
    bands = buildPositionBands(queries);
  } catch {
    return null;
  }
  const total = totalBandQueries(bands);
  if (total === 0) return null;

  const striking = bands.find((b) => b.key === "striking");

  return (
    <section className="rounded-3xl border border-slate-200/70 bg-gradient-to-br from-slate-50/50 via-white to-emerald-50/20 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-slate-500">▦</span> Where you rank
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Your whole-site ranking funnel across {fmtNum(total)} top queries.
            {striking && striking.queries > 0
              ? ` ${fmtNum(striking.queries)} sit in striking distance (pos 4–10) — your biggest near-term pool.`
              : ""}
          </p>
        </div>
      </div>

      {/* Proportional bar */}
      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
        {bands.map((b) => (
          <div
            key={b.key}
            className={BAND_COLOR[b.key] ?? "bg-gray-300"}
            style={{ width: `${total > 0 ? (b.queries / total) * 100 : 0}%` }}
            title={`${b.label}: ${b.queries}`}
          />
        ))}
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {bands.map((b) => (
          <li key={b.key} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white/70 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${BAND_COLOR[b.key] ?? "bg-gray-300"}`} />
              <span className="text-gray-700">{b.label}</span>
            </span>
            <span className="text-xs text-gray-500">
              <span className="font-semibold text-gray-900">{fmtNum(b.queries)}</span> queries · {fmtNum(b.clicks)} clicks/mo
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
