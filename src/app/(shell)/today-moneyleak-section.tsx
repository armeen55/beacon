import Link from "next/link";
import { currentTenantId } from "@/lib/tenant-context";
import { loadGa4PageValuesForTenant } from "@/domains/recommendation-intelligence/ga4-page-values";
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { buildMoneyLeakRows, moneyLeakSessionsAtRisk } from "./today-moneyleak-rows";

/**
 * today-moneyleak-section (2026-06-25, L8/CRO axis) — the REVENUE site-wide lens,
 * alongside the GSC loss/opportunity scans. Pages with real traffic that frustrate
 * users (dead/rage clicks, quickbacks) are leaking conversions — fixing the page UX
 * makes the traffic you already have convert. Bounded (GA4 + Clarity whole-tenant
 * maps, joined deterministically) + self-hides when nothing leaks or data is absent.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
function slugOf(url: string): string {
  const s = url.split("?")[0]!.split("#")[0]!.replace(/\/$/, "");
  const last = s.split("/").filter(Boolean).pop() ?? url;
  return last.replace(/[-_]+/g, " ").trim() || url;
}
const canon = (u: string) => canonicalizeCitationUrl(u) ?? u;

export async function TodayMoneyLeakSection() {
  let rows: ReturnType<typeof buildMoneyLeakRows> = [];
  try {
    const tenantId = await currentTenantId();
    const [ga4Map, clarityMap] = await Promise.all([
      loadGa4PageValuesForTenant(tenantId).catch(() => new Map()),
      loadClarityPageSignalsForTenant(tenantId).catch(() => new Map()),
    ]);
    rows = buildMoneyLeakRows([...ga4Map.values()], [...clarityMap.values()], canon);
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const sessionsAtRisk = moneyLeakSessionsAtRisk(rows);

  return (
    <section className="rounded-3xl border border-fuchsia-200/70 bg-gradient-to-br from-fuchsia-50/50 via-white to-rose-50/30 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-fuchsia-500">⚠</span> Fix conversion leaks
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Pages with real traffic that are frustrating visitors (dead clicks, rage clicks, fast
            bounce-backs). Fixing the page experience converts the traffic you already have — no new
            rankings needed.
          </p>
        </div>
        <div className="rounded-xl border border-fuchsia-100 bg-white px-4 py-2 text-right">
          <div className="text-2xl font-semibold tracking-tight text-fuchsia-600">~{fmtNum(sessionsAtRisk)}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">monthly visits at risk</div>
        </div>
      </div>

      <ul className="mt-5 space-y-1.5">
        {rows.map((r, i) => (
          <li
            key={i}
            className="rounded-xl border border-fuchsia-100 bg-white/70 px-3 py-2 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium text-gray-900">{slugOf(r.page)}</span>
                {r.conversions > 0 ? (
                  <span className="ml-2 text-xs text-emerald-600">{r.conversions.toLocaleString()} conv/mo</span>
                ) : null}
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="font-semibold text-fuchsia-600">{r.friction.pct} {r.friction.label} per 100 visits</span>
                <span className="text-gray-500">{r.sessions.toLocaleString()} visits/mo</span>
                <Link
                  href={`/proof?page=${encodeURIComponent(r.page)}`}
                  className="font-semibold text-violet-600 hover:text-violet-800"
                >
                  Fix →
                </Link>
              </div>
            </div>
            {/* signal → directive: what the friction means + the concrete fix. */}
            <p className="mt-1.5 text-xs text-gray-500">{r.friction.directive}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
