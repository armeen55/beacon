import { currentTenantId } from "@/lib/tenant-context";
import { loadTopTenantQueries } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { splitBrandedTraffic } from "./today-brand-split-rows";

/**
 * today-brand-split-section (2026-06-25) — "Branded vs discovery": how much of your
 * Google traffic comes from people who already know you (searching your name) vs
 * people discovering you through topics. Discovery growth is real reach growth.
 * Deterministic; self-hides when there's no query data or no brand to split on.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

/** Pull plausible brand seeds (name + domain label) from the tenant config, defensively. */
function brandSeedsFromConfig(cfg: Record<string, unknown> | null): string[] {
  if (!cfg) return [];
  const seeds: string[] = [];
  for (const k of ["businessName", "name", "brand", "siteName", "domain", "url", "website", "homepageUrl"]) {
    const v = cfg[k];
    if (typeof v === "string" && v.trim()) {
      try {
        seeds.push(v.startsWith("http") ? new URL(v).hostname : v);
      } catch {
        seeds.push(v);
      }
    }
  }
  return seeds;
}

export async function TodayBrandSplitSection() {
  let split: ReturnType<typeof splitBrandedTraffic> | null = null;
  try {
    const tenantId = await currentTenantId();
    const [queries, cfg] = await Promise.all([
      loadTopTenantQueries(tenantId).catch(() => []),
      getBusinessConfigForCurrentTenant().catch(() => null),
    ]);
    const seeds = brandSeedsFromConfig(cfg as Record<string, unknown> | null);
    if (queries.length === 0 || seeds.length === 0) return null;
    // 100% discovery is itself a real insight (strong topical reach, ~no brand
    // search yet) — render it; only bail when there's no demand data at all.
    split = splitBrandedTraffic(queries, seeds);
  } catch {
    return null;
  }
  if (!split || split.discovery.clicks + split.branded.clicks === 0) return null;

  const brandedPct = 100 - split.discoveryClicksPct;

  return (
    <section className="rounded-3xl border border-cyan-200/70 bg-gradient-to-br from-cyan-50/50 via-white to-blue-50/20 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-cyan-500">🧭</span> Branded vs discovery traffic
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            {split.discoveryClicksPct}% of your Google clicks come from people discovering you through topics
            (not searching your name). Discovery is your real reach — growing it grows the business.
          </p>
        </div>
        <div className="rounded-xl border border-cyan-100 bg-white px-4 py-2 text-right">
          <div className="text-2xl font-semibold tracking-tight text-cyan-600">{split.discoveryClicksPct}%</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">discovery clicks</div>
        </div>
      </div>

      {/* Proportional bar */}
      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="bg-cyan-500" style={{ width: `${split.discoveryClicksPct}%` }} title={`Discovery: ${split.discoveryClicksPct}%`} />
        <div className="bg-gray-300" style={{ width: `${brandedPct}%` }} title={`Branded: ${brandedPct}%`} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-gray-500">
        <span><span className="font-semibold text-cyan-700">Discovery</span> · {fmtNum(split.discovery.clicks)} clicks · {fmtNum(split.discovery.queries)} queries</span>
        <span>{fmtNum(split.branded.clicks)} clicks · {fmtNum(split.branded.queries)} queries · <span className="font-semibold text-gray-600">Branded</span></span>
      </div>

      {split.topDiscovery.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-700">Top topics winning you new people</h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {split.topDiscovery.map((d, i) => (
              <li key={i} className="flex items-center justify-between rounded-xl border border-cyan-100 bg-white/70 px-3 py-1.5 text-sm">
                <span className="min-w-0 truncate text-gray-800">{d.query}</span>
                <span className="shrink-0 text-xs font-semibold text-cyan-600">{fmtNum(d.clicks)} clicks/mo</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
