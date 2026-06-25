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
import { auditTopCompetitorsForTenant, getCompetitorAuditsForTenant, whatWins } from "@/domains/demand-graph/competitor-page-audit";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { loadChangePacksForTenant } from "@/domains/demand-graph/gap-compiler";
import { formatMoveCard } from "@/domains/demand-graph/move-card";
import { MoveCardList } from "./move-cards";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

export default async function RankRevenuePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  if (!isOperatorMode()) notFound();

  const tenantId = await currentTenantId();
  // Operator-triggered teardown refresh (?refresh=1). Competitor teardowns go
  // stale as the move ranking shifts (the audit cache is keyed by URL); this
  // re-runs the polite-fetch audit for the current top moves before loading.
  // Stopgap until Step 6 wires the audit into the nightly cron. Fail-soft.
  const params = await searchParams;
  if (params?.refresh === "1") {
    await auditTopCompetitorsForTenant({ tenantId, limit: TOP_N }).catch(() => null);
  }
  const [{ graph, coverage }, audits, packsResult] = await Promise.all([
    loadDemandGraphForTenant(tenantId),
    getCompetitorAuditsForTenant().catch(() => new Map()),
    loadChangePacksForTenant(tenantId, { limit: 25 }).catch(() => ({ packets: [] as EvidencePacket[] })),
  ]);
  const auditedOk = [...audits.values()].filter((a) => a.fetchStatus === "ok").length;
  const packetByKey = new Map<string, EvidencePacket>(
    (packsResult.packets ?? []).map((p) => [p.move.key, p]),
  );

  const actionable = graph.moves.filter((m) => m.gap !== "low_demand" && m.gap !== "healthy");
  const top = actionable.slice(0, TOP_N);
  // §7 Move-ritual cards for the top moves that have a full evidence packet.
  const moveCards = top
    .map((m) => packetByKey.get(m.demandKey))
    .filter((p): p is EvidencePacket => !!p)
    .slice(0, 8)
    .map(formatMoveCard);
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
        {coverage.clarityPages} Clarity pages · {coverage.competitorCitations} competitor pages cited
        {coverage.emptySources.length > 0 ? (
          <span className="ml-2 text-amber-700">
            (empty: {coverage.emptySources.join(", ")})
          </span>
        ) : null}
        <span className="ml-2 text-gray-400">
          · {coverage.competitorEdges} competitor edges · {coverage.createPageCandidates} create-page
          candidates · you cited on {coverage.ownedCited} pages · {auditedOk} competitor pages
          torn down{" "}
          <a href="?refresh=1" className="text-blue-600 underline hover:text-blue-800" title="Re-run the competitor teardown audit for the current top moves (polite fetch; may take 20-40s)">
            ↻ refresh teardowns
          </a>
        </span>
        <span className="ml-2 text-gray-400">
          · {graph.moves.length} clusters · {healthyCount} healthy · {lowDemandCount} below demand floor
        </span>
      </div>

      {moveCards.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-800">Your top moves (plain-language)</h2>
          <p className="text-xs text-gray-500">
            The §7 Move card — what to do, why, what wins, your gap, and how we&apos;ll prove it. Quick wins
            are flagged green. The full ranked table with raw scores is below.
          </p>
          <MoveCardList cards={moveCards} />
        </section>
      ) : null}

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
                <th className="px-2 py-1.5">What wins (teardown)</th>
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
                  <td className="px-2 py-1.5 text-gray-600" style={{ maxWidth: 220 }}>
                    {(() => {
                      // Prefer the packet's competitor view — it respects the
                      // relevance gate (off-topic cited pages are labeled, not torn down).
                      const pkt = packetByKey.get(m.demandKey);
                      if (pkt?.competitor) {
                        if (pkt.competitor.looselyMatched) {
                          return <span className="text-amber-600">loosely matched (off-topic) — verify with SERP</span>;
                        }
                        if (pkt.competitor.facts) return <span>{pkt.competitor.whatWins}</span>;
                        if (pkt.competitor.fetchStatus && pkt.competitor.fetchStatus !== "ok") {
                          return <span className="text-amber-600">{pkt.competitor.fetchStatus}</span>;
                        }
                      }
                      const top = m.competitorUrls[0];
                      if (!top) return <span className="text-gray-300">—</span>;
                      const a = audits.get(canonicalizeCitationUrl(top) || top);
                      if (!a) return <span className="text-gray-300">not audited</span>;
                      if (a.fetchStatus !== "ok") return <span className="text-amber-600">{a.fetchStatus}</span>;
                      return <span>{whatWins(a.facts)}</span>;
                    })()}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500">{shortUrl(m.ownedUrl)}</td>
                  <td className="px-2 py-1.5 text-gray-500" style={{ maxWidth: 320 }}>
                    {(() => {
                      const pkt = packetByKey.get(m.demandKey);
                      if (!pkt) return m.rationale;
                      return (
                        <details>
                          <summary className="cursor-pointer">{m.rationale}</summary>
                          <div className="mt-1 space-y-1 border-l-2 border-gray-200 pl-2 text-[11px]">
                            <div>
                              <span className="font-medium text-gray-700">Gaps:</span>{" "}
                              {pkt.gaps.length === 0
                                ? "—"
                                : pkt.gaps.map((g) => (
                                    <span key={g.kind} className="mr-1 rounded bg-rose-50 px-1 text-rose-700">
                                      {g.kind}
                                    </span>
                                  ))}
                            </div>
                            {pkt.draft.titleSuggestion ? (
                              <div><span className="font-medium text-gray-700">Title:</span> {pkt.draft.titleSuggestion}</div>
                            ) : null}
                            {pkt.draft.answerBlockBrief ? (
                              <div><span className="font-medium text-gray-700">Answer block:</span> {pkt.draft.answerBlockBrief}</div>
                            ) : null}
                            {pkt.draft.outline.length > 0 ? (
                              <div><span className="font-medium text-gray-700">Outline ({pkt.draft.outline.length}):</span> {pkt.draft.outline.slice(0, 6).join(" · ")}</div>
                            ) : null}
                            {pkt.draft.faqQuestions.length > 0 ? (
                              <div><span className="font-medium text-gray-700">FAQ:</span> {pkt.draft.faqQuestions.slice(0, 4).join(" · ")}</div>
                            ) : null}
                            {pkt.draft.schemaRecommendations.length > 0 ? (
                              <div><span className="font-medium text-gray-700">Schema:</span> {pkt.draft.schemaRecommendations.join(", ")}</div>
                            ) : null}
                            {pkt.draft.asset ? (
                              <div>
                                <span className="font-medium text-gray-700">Asset:</span>{" "}
                                <span className="rounded bg-violet-50 px-1 text-violet-700">{pkt.draft.asset.kind}</span>{" "}
                                {pkt.draft.asset.buildPath}
                              </div>
                            ) : pkt.draft.assetSpec ? (
                              <div><span className="font-medium text-gray-700">Asset:</span> {pkt.draft.assetSpec}</div>
                            ) : null}
                            <div className="text-gray-400">
                              Proof: {pkt.proofPlan.metrics.join(", ")} @ {pkt.proofPlan.windowsDays.join("/")}d · hash {pkt.evidenceHash} · {pkt.draft.kind}
                            </div>
                          </div>
                        </details>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create-page candidates: AI cites competitors for a topic you have no page
          for. These rank below the GSC-demand Top-25 (AI-attention proxy demand,
          no measured search volume yet → LOW confidence until SERP/DataForSEO). */}
      {(() => {
        const creates = graph.moves
          .filter((m) => m.gap === "create_page")
          .sort((a, b) => b.components.demand - a.components.demand)
          .slice(0, 15);
        if (creates.length === 0) return null;
        return (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-800">
              Create-page candidates ({creates.length}) — AI cites competitors, you have no page
            </h3>
            <p className="text-xs text-gray-500">
              Demand here is an AI-attention proxy (no measured search volume yet) → LOW confidence
              until SERP/DataForSEO. Build aggressively, but verify volume first.
            </p>
            <div className="overflow-x-auto rounded-md border border-emerald-200">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-emerald-50 text-left text-gray-600">
                  <tr>
                    <th className="px-2 py-1.5">AI-attn</th>
                    <th className="px-2 py-1.5">Topic to create</th>
                    <th className="px-2 py-1.5">Conf</th>
                    <th className="px-2 py-1.5">Competitors AI cites</th>
                    <th className="px-2 py-1.5">Answer these (fanouts)</th>
                  </tr>
                </thead>
                <tbody>
                  {creates.map((m) => (
                    <tr key={m.demandKey} className="border-t border-gray-100 align-top hover:bg-gray-50">
                      <td className="px-2 py-1.5 tabular-nums">{fmt(m.components.demand)}</td>
                      <td className="px-2 py-1.5 font-medium text-gray-900">{m.label}</td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CONF_COLORS[m.confidence]}`}>
                          {m.confidence}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-500">
                        {m.competitorUrls.slice(0, 2).map((u) => (
                          <div key={u}>{shortUrl(u)}</div>
                        ))}
                      </td>
                      <td className="px-2 py-1.5 text-gray-500" style={{ maxWidth: 280 }}>
                        {m.fanoutSeeds.slice(0, 4).join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
