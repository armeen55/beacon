import { currentTenantId } from "@/lib/tenant-context";
import { loadDemandOpportunities } from "@/domains/demand/load-demand-opportunities";
import { loadPageCandidates } from "@/domains/page-factory/load-page-candidates";
import type { PageCandidate } from "@/domains/page-factory/entity-attribute-factory";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { DiscoverDemandButton } from "./today-opportunities-panel";

/**
 * today-opportunities-section (2026-06-25, Sprint 4G) — the "New Opportunities"
 * (Demand Radar) panel: real external search demand → discovered opportunities
 * (improve an existing page vs build a new one vs a product concept), each with
 * demand, trend, recommended action, page match, confidence, risk, and a cached/
 * live label. CACHE-ONLY render ($0); the operator runs Discover to fetch fresh
 * demand. Read-only + tenant-agnostic; self-hides when there's nothing to show
 * (and the operator isn't present to run Discover).
 */

const ACTION_LABEL: Record<string, string> = {
  create_page: "Build new page",
  create_product: "Product concept",
  expand_page: "Expand page",
  add_answer_block: "Add answer block",
  update_title_meta: "Tighten title/meta",
  content_refresh: "Refresh page",
  improve_product_page: "Improve product page",
  create_collection: "New collection",
  improve_collection: "Improve collection",
  monitor: "Monitor",
  no_action: "Monitor",
};
const TREND_ICON: Record<string, string> = { rising: "↑", declining: "↓", flat: "→", unknown: "·" };
const CONF_CLASS = (c: string) =>
  c === "high"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : c === "medium"
    ? "bg-amber-50 text-amber-700 ring-amber-200"
    : "bg-gray-100 text-gray-500 ring-gray-200";

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}
function pathOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export async function TodayOpportunitiesSection() {
  const operator = await isOperatorModeServer();
  let data;
  try {
    data = await loadDemandOpportunities(await currentTenantId(), { limit: 12 });
  } catch {
    return null;
  }
  // Programmatic page ideas (Sprint 6 factory) — needs-demand-validation candidates.
  let ideas: PageCandidate[] = [];
  try {
    ideas = await loadPageCandidates(await currentTenantId(), { max: 8 });
  } catch {
    ideas = [];
  }
  // Self-hide when there's nothing AND no operator to discover (keep cockpit clean).
  if (data.opportunities.length === 0 && data.trends.length === 0 && data.products.length === 0 && ideas.length === 0 && !operator)
    return null;

  return (
    <section className="rounded-3xl border border-gray-200 bg-gradient-to-br from-sky-50/40 via-white to-gray-50 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900">New opportunities</h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Real search demand Beacon found — what to create or improve next, with the monthly demand and
            whether you already have a page for it.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {operator ? <DiscoverDemandButton /> : null}
          <span className="text-[11px] text-gray-400">
            {data.cached ? `cached demand · ${data.keywordsConsidered} keywords` : "no cached demand yet"}
          </span>
        </div>
      </div>

      {data.opportunities.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-gray-200 bg-white/60 px-4 py-6 text-center text-sm text-gray-500">
          No discovered demand yet.{operator ? " Click Discover to fetch real keyword demand for your topics (capped + cached)." : ""}
        </p>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {data.opportunities.map((o) => (
            <div key={o.id} className="flex flex-col justify-between rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${o.parentType === "commerce_move" ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-sky-50 text-sky-700 ring-sky-200"}`}>
                    {ACTION_LABEL[o.action] ?? o.action}
                  </span>
                  <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600 ring-1 ring-gray-200">
                    {fmt(o.estDemand)}/mo {TREND_ICON[o.trend]}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${o.confidence === "high" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : o.confidence === "medium" ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-gray-100 text-gray-500 ring-gray-200"}`}>
                    {o.confidence}
                  </span>
                  {o.shouldBeTodayMove ? <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">★ Today Move</span> : null}
                </div>
                <h3 className="mt-2 text-[15px] font-semibold leading-snug tracking-tight text-gray-900">{o.primaryKeyword}</h3>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">{o.whyNow}</p>
                <p className="mt-1.5 text-[11px] text-gray-500">
                  {o.matchStrength === "none" ? (
                    <span className="text-emerald-700">No page yet — net-new</span>
                  ) : (
                    <>Matches <span className="font-medium text-gray-700">{pathOf(o.matchedPageUrl)}</span> ({o.matchStrength})</>
                  )}
                </p>
                {o.learnedTag ? <p className="mt-1 text-[10px] font-medium text-indigo-600">🧠 {o.learnedTag}</p> : null}
                {o.risk ? <p className="mt-1 text-[10px] text-amber-700">⚠ {o.risk}</p> : null}
                {o.confidence === "low" ? <p className="mt-1 text-[10px] text-gray-400">Weak evidence — verify before acting.</p> : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 4D — Trend Radar: rising / seasonal / declining, ranked. */}
      {data.trends.length > 0 ? (
        <div className="mt-7">
          <h3 className="text-sm font-bold tracking-tight text-gray-800">📈 Trends — rising & seasonal</h3>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {data.trends.slice(0, 6).map((t) => (
              <div key={t.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-700 ring-1 ring-fuchsia-200">
                    {t.trend} {TREND_ICON[t.trend]}{t.seasonal ? " · seasonal" : ""}
                  </span>
                  <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600 ring-1 ring-gray-200">
                    {t.estDemand != null ? `${fmt(t.estDemand)}/mo` : "no volume"}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${CONF_CLASS(t.confidence)}`}>{t.confidence}</span>
                  {t.shouldBeTodayMove ? <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">★</span> : null}
                </div>
                <p className="mt-1.5 text-[13px] font-semibold leading-snug text-gray-900">{t.query}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
                  {ACTION_LABEL[t.recommendedAction] ?? t.recommendedAction} · {t.whyNow}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-400">source: {t.evidenceSource}</p>
                {t.risk ? <p className="mt-0.5 text-[10px] text-amber-700">⚠ {t.risk}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 4E — Store/Product opportunities (concept-only unless inventory verified). */}
      {data.products.length > 0 ? (
        <div className="mt-7">
          <h3 className="text-sm font-bold tracking-tight text-gray-800">🛍️ Store / product concepts</h3>
          <p className="mt-0.5 text-[11px] text-gray-400">Commerce demand → product/collection ideas. Concept-only until inventory is confirmed; nothing is created.</p>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {data.products.slice(0, 6).map((p) => (
              <div key={p.id} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-300">
                    {ACTION_LABEL[p.recommendedAction] ?? p.recommendedAction}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600 ring-1 ring-gray-200">
                    {fmt(p.estDemand)}/mo {TREND_ICON[p.trend]}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${p.conceptOnly ? "bg-gray-100 text-gray-600 ring-gray-300" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>
                    {p.conceptOnly ? "concept-only" : "in inventory"}
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] font-semibold leading-snug text-gray-900">{p.keyword}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{p.whyNow}</p>
                {p.matchedPageUrl ? <p className="mt-0.5 text-[10px] text-gray-500">maps to {p.matchedPageKind}: {pathOf(p.matchedPageUrl)}</p> : null}
                {p.licensingRisk ? <p className="mt-0.5 text-[10px] font-medium text-red-700">⚖️ {p.licensingRisk}</p> : null}
                {p.risk && !p.licensingRisk ? <p className="mt-0.5 text-[10px] text-amber-700">⚠ {p.risk}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {/* 💡 Programmatic page ideas (Sprint 6 factory) — needs demand validation. */}
      {ideas.length > 0 ? (
        <div className="mt-7">
          <h3 className="text-sm font-bold tracking-tight text-gray-800">💡 Page ideas to validate</h3>
          <p className="mt-0.5 text-[11px] text-gray-400">Generated from your recurring themes — validate demand (Discover) before building.</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {ideas.slice(0, 8).map((c) => (
              <span key={c.slug} className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-700 shadow-sm" title={c.why}>
                {c.title}
                <span className="ml-1 text-[9px] text-gray-400">validate</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
