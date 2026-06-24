/**
 * /diagnostics/rank-revenue — Step 1 "first truth test" (2026-06-24).
 *
 * The ugly-but-undeniable Top-25 Rank-&-Revenue worklist for the current
 * tenant, rendered straight from the real demand graph (`load-graph.ts`). Every
 * RAW component is shown — Demand, Winnability, $Value, Visibility-Gap, Friction
 * — so the table is a lie detector: you can see WHY each Move ranks, and the
 * final weighting can be wrong while the evidence stays right.
 *
 * Operator-only (BEACON_OPERATOR_MODE); 404s otherwise. Pure read, no paid APIs,
 * no mutations, Vercel-safe. Works for ANY tenant via its connectors.
 */

import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { PageHeader } from "@/components/data/page-header";
import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import type { MoveCandidate, ConfidenceLevel } from "@/domains/demand-graph/build-graph";

export const dynamic = "force-dynamic";

function isOperatorMode(): boolean {
  return isOperatorModeServer();
}

const TOP_N = 25;

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

const GAP_COLORS: Record<string, string> = {
  create_page: "bg-emerald-100 text-emerald-800",
  edit_page: "bg-blue-100 text-blue-800",
  answer_block: "bg-violet-100 text-violet-800",
  fix_experience: "bg-amber-100 text-amber-800",
  healthy: "bg-gray-100 text-gray-600",
  low_demand: "bg-gray-50 text-gray-400",
};
const CONF_COLORS: Record<ConfidenceLevel, string> = {
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-gray-100 text-gray-500",
};

function shortUrl(url: string | null): string {
  if (!url) return "—";
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, "").slice(0, 48);
  } catch {
    return url.slice(0, 48);
  }
}

export default async function RankRevenuePage() {
  if (!isOperatorMode()) notFound();

  const tenantId = await currentTenantId();
  const { graph, coverage } = await loadDemandGraphForTenant(tenantId);

  const actionable = graph.moves.filter((m) => m.gap !== "low_demand" && m.gap !== "healthy");
  const top = actionable.slice(0, TOP_N);
  const healthyCount = graph.moves.filter((m) => m.gap === "healthy").length;
  const lowDemandCount = graph.moves.filter((m) => m.gap === "low_demand").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rank-&-Revenue — Top 25 (operator truth test)"
        description={`Tenant ${tenantId}. The real demand graph, ranked. Raw components shown — the score can be wrong while the evidence is right.`}
      />

      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        Coverage: {coverage.gscPages} GSC pages · {coverage.ga4Pages} GA4 pages ·{" "}
        {coverage.clarityPages} Clarity pages · {coverage.competitorCitations} competitor citations
        {coverage.emptySources.length > 0 ? (
          <span className="ml-2 text-amber-700">
            (empty: {coverage.emptySources.join(", ")})
          </span>
        ) : null}
        <span className="ml-2 text-gray-400">
          · {graph.moves.length} clusters · {healthyCount} healthy · {lowDemandCount} below demand floor
        </span>
        <span className="ml-2 text-gray-400">
          · competitor edges + create_page land in Step 2 (topic-scoped Profound)
        </span>
      </div>

      {top.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-800">
          No actionable Moves yet. {coverage.gscPages === 0
            ? "GSC returned 0 pages for this tenant — connect/sync Search Console."
            : "All clusters are healthy or below the demand floor."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-gray-100 text-left text-gray-600">
              <tr>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Score</th>
                <th className="px-2 py-1.5">Move</th>
                <th className="px-2 py-1.5">Gap</th>
                <th className="px-2 py-1.5 text-right">Demand</th>
                <th className="px-2 py-1.5 text-right">Win</th>
                <th className="px-2 py-1.5 text-right">$Val</th>
                <th className="px-2 py-1.5 text-right">VisGap</th>
                <th className="px-2 py-1.5 text-right">Friction</th>
                <th className="px-2 py-1.5">Conf</th>
                <th className="px-2 py-1.5">Competitors</th>
                <th className="px-2 py-1.5">Your page</th>
                <th className="px-2 py-1.5">Why</th>
              </tr>
            </thead>
            <tbody>
              {top.map((m: MoveCandidate, i) => (
                <tr key={m.demandKey} className="border-t border-gray-100 align-top hover:bg-gray-50">
                  <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                  <td className="px-2 py-1.5 font-semibold tabular-nums">{fmt(m.score)}</td>
                  <td className="px-2 py-1.5 font-medium text-gray-900">{m.label}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${GAP_COLORS[m.gap] ?? ""}`}>
                      {m.gap}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(m.components.demand)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m.components.winnability.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(m.components.dollarValue)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m.components.visibilityGap.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(m.components.friction)}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CONF_COLORS[m.confidence]}`}>
                      {m.confidence}
                    </span>
                    <span className="ml-1 text-[10px] text-gray-400">{m.signals.join("·")}</span>
                  </td>
                  <td className="px-2 py-1.5 text-gray-500">
                    {m.competitorUrls.length === 0
                      ? "—"
                      : m.competitorUrls.slice(0, 2).map((u) => (
                          <div key={u}>{shortUrl(u)}</div>
                        ))}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500">{shortUrl(m.ownedUrl)}</td>
                  <td className="px-2 py-1.5 text-gray-500" style={{ maxWidth: 280 }}>
                    {m.rationale}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
