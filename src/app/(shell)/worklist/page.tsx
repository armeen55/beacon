export const dynamic = "force-dynamic"; // tenant-scoped data page (no build-time prerender)

import { currentTenantId } from "@/lib/tenant-context";
import { loadTodayMovesHeroData } from "../today-moves-data";
import { loadDemandOpportunities } from "@/domains/demand/load-demand-opportunities";
import { loadProfoundDeepSignals } from "@/domains/profound-deep/load-profound-deep";
import { buildWorklist, type WorklistItem } from "@/domains/worklist/worklist-views";
import { WorklistClient } from "./worklist-client";

/**
 * /worklist (2026-06-25, Sprint 6) — the unified ranked worklist + filtered views.
 * ONE ranked list of every Move (demand-graph Moves + demand opportunities + trend
 * opportunities + product concepts), sliced into Today / This week / Big bets / New
 * pages / Store / Tools / Trends / All. Read-only, $0 (reuses cached loaders).
 * Additive surface — the existing cockpit is untouched.
 */
export default async function WorklistPage() {
  let items: WorklistItem[] = [];
  try {
    const tenantId = await currentTenantId();
    const [hero, demand] = await Promise.all([
      loadTodayMovesHeroData({}).catch(() => ({ moves: [] as Awaited<ReturnType<typeof loadTodayMovesHeroData>>["moves"] })),
      loadDemandOpportunities(tenantId, { limit: 20 }).catch(() => ({ opportunities: [], trends: [], products: [] })),
    ]);
    // Crawlability gaps (Sprint 6 bot-coverage) — valuable pages AI can't crawl;
    // valuable pages derived from the already-loaded hero moves (no extra load).
    const valuablePages = hero.moves.filter((m) => m.targetUrl).map((m) => ({ path: m.targetUrl, value: m.demand ?? 1 }));
    const deep = await loadProfoundDeepSignals(tenantId, valuablePages).catch(() => ({ crawlabilityGaps: [] as Awaited<ReturnType<typeof loadProfoundDeepSignals>>["crawlabilityGaps"] }));
    items = buildWorklist({
      crawlGaps: deep.crawlabilityGaps.map((g) => ({ path: g.path, value: g.value, reason: g.reason, severity: g.severity })),
      moves: hero.moves.map((m) => ({
        id: m.id,
        action: m.action,
        targetUrl: m.targetUrl,
        score: m.score,
        demand: m.demand,
        confidence: m.confidence,
        prepared: m.preparedStatus === "ready_to_review" || !!m.preparedDraftText,
        title: `${m.actionLabel}: ${m.pageLabel}`,
        why: m.why,
      })),
      opportunities: demand.opportunities.map((o) => ({
        id: o.id,
        action: o.action,
        matchedPageUrl: o.matchedPageUrl,
        estDemand: o.estDemand,
        confidence: o.confidence,
        primaryKeyword: o.primaryKeyword,
        whyNow: o.whyNow,
        parentType: o.parentType,
      })),
      trends: demand.trends.map((t) => ({
        id: t.id,
        recommendedAction: t.recommendedAction,
        targetPageUrl: t.targetPageUrl,
        estDemand: t.estDemand,
        confidence: t.confidence,
        query: t.query,
        trend: t.trend,
        whyNow: t.whyNow,
      })),
      products: demand.products.map((p) => ({
        id: p.id,
        recommendedAction: p.recommendedAction,
        matchedPageUrl: p.matchedPageUrl,
        estDemand: p.estDemand,
        confidence: p.confidence,
        keyword: p.keyword,
        whyNow: p.whyNow,
        conceptOnly: p.conceptOnly,
        trend: p.trend,
      })),
    });
  } catch {
    items = [];
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">Worklist</h1>
      <p className="mt-1 text-sm text-gray-500">
        Every Move Beacon found, ranked into one list. Switch views to focus.
      </p>
      <div className="mt-6">
        <WorklistClient items={items} />
      </div>
    </div>
  );
}
