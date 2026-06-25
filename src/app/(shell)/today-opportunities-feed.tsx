import Link from "next/link";
import { currentTenantId } from "@/lib/tenant-context";
import {
  loadTopDecliningPagesForTenant,
  loadTopStrikingPagesForTenant,
  loadToolIntentQueries,
  loadTopPagesWithQueriesForTenant,
} from "@/domains/recommendation-intelligence/gsc-page-queries";
import { buildToolOpportunities } from "@/domains/demand-graph/tool-intent";
import { loadGscCannibalizationForTenant } from "@/domains/recommendation-intelligence/gsc-cannibalization";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { buildCtrGapRows } from "./today-ctrgap-rows";
import { buildCannibalizationCaseRows } from "./today-declines-rows";
import { buildNewPagesData } from "./today-newpages-data";
import { clicksAtStakeForStriking, estimatedCtr } from "@/domains/recommendation-intelligence/ctr-curve";
import { workbenchHref } from "@/domains/insight/workbench-route";
import { buildRecommendationDetailHref } from "@/components/recommendations/v2/recommendation-route-id";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { loadTodayMovesHeroData } from "./today-moves-data";
import { WorklistExportButton } from "./worklist-export-button";
import { type ExportItem } from "./worklist-export";
import {
  buildOpportunityFeedWithTotals,
  type OpportunityItem,
  type FeedKind,
} from "./today-opportunities-feed-rows";

/**
 * today-opportunities-feed (2026-06-25) — the headline "do these first" list: the
 * §2 promise made literal. Fuses the two rank axes (recover declines + win
 * striking-distance) into ONE feed ranked by estimated monthly clicks at stake, so
 * the operator's eye lands on the single highest-impact handful before the detailed
 * per-axis sections below. Self-hides when nothing clears the bar.
 */

const KIND_LABEL: Record<FeedKind, string> = {
  recover: "Recover",
  win: "Win",
  cite: "Get cited",
  build: "Build",
  edit: "Improve",
  snippet: "Snippet",
  consolidate: "Consolidate",
};
const KIND_STYLE: Record<FeedKind, string> = {
  recover: "bg-rose-100 text-rose-700",
  win: "bg-amber-100 text-amber-700",
  cite: "bg-violet-100 text-violet-700",
  build: "bg-emerald-100 text-emerald-700",
  edit: "bg-sky-100 text-sky-700",
  snippet: "bg-orange-100 text-orange-700",
  consolidate: "bg-purple-100 text-purple-700",
};

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
function slugOf(url: string): string {
  const s = url.split("?")[0]!.split("#")[0]!.replace(/\/$/, "");
  const last = s.split("/").filter(Boolean).pop() ?? url;
  return last.replace(/[-_]+/g, " ").trim() || url;
}

// Map a demand-graph worklist move into a unified feed item on the SAME
// clicks-at-stake currency. A move's stake = the best clicks it could win from
// its own striking queries; if it has no striking query yet (e.g. a brand-new
// citation/page move) fall back to a conservative slice of its demand so it can
// still rank. actionTone → feed kind so the headline shows what KIND of move.
function moveToItem(m: {
  id: string;
  targetUrl: string;
  pageLabel: string;
  query: string;
  actionTone: "citation" | "clicks" | "experience" | "page";
  demand: number | null;
  topQueries: { query: string; impressions: number; position: number }[];
}): OpportunityItem | null {
  const kind: FeedKind =
    m.actionTone === "citation" ? "cite" : m.actionTone === "page" ? "build" : "edit";
  let stake = 0;
  let bestQuery = m.query || m.pageLabel;
  for (const q of m.topQueries) {
    const s = clicksAtStakeForStriking(q.impressions, q.position);
    if (s > stake) {
      stake = s;
      bestQuery = q.query;
    }
  }
  // No striking query → conservative demand-based estimate so it still ranks.
  if (stake === 0 && (m.demand ?? 0) > 0) stake = Math.round((m.demand as number) * 0.05);
  if (stake <= 0) return null;
  const detail =
    kind === "cite"
      ? `AI cites competitors here — ~${stake.toLocaleString()} clicks/mo in play`
      : kind === "build"
        ? `competitors own this — ~${stake.toLocaleString()} clicks/mo to claim`
        : `~${stake.toLocaleString()} clicks/mo in reach`;
  return {
    kind,
    query: bestQuery,
    page: m.targetUrl,
    clicksAtStake: stake,
    detail,
    // A queued move has a ready draft + Ship action on its rec detail — route
    // there to ACT, not to the page-level Workbench (where site-wide signals go).
    route: buildRecommendationDetailHref({ id: m.id }),
  };
}

export async function TodayOpportunitiesFeed() {
  let items: OpportunityItem[] = [];
  let allItems: OpportunityItem[] = [];
  let toolExportItems: ExportItem[] = [];
  let newPageExportItems: ExportItem[] = [];
  let total = 0;
  let totalClicks = 0;
  let siteName = "";
  try {
    const tenantId = await currentTenantId();
    const [declines, striking, hero, cfg, toolQueries, newPages, pagesWithQueries, cannibalCases] = await Promise.all([
      loadTopDecliningPagesForTenant(tenantId).catch(() => []),
      loadTopStrikingPagesForTenant(tenantId).catch(() => []),
      loadTodayMovesHeroData({ limit: 20 }).catch(() => null),
      getBusinessConfigForCurrentTenant().catch(() => null),
      loadToolIntentQueries(tenantId).catch(() => []),
      buildNewPagesData(tenantId).catch(() => ({ opportunities: [], totalCandidates: 0 })),
      loadTopPagesWithQueriesForTenant(tenantId).catch(() => []),
      loadGscCannibalizationForTenant(tenantId).catch(() => []),
    ]);
    siteName = cfg?.name ?? "";
    const moveExtra = (hero?.moves ?? [])
      .map((m) => moveToItem(m))
      .filter((x): x is OpportunityItem => x != null);
    // CTR-gap (snippet) wins are in the same clicks-at-stake currency → fuse them
    // into the one ranked list (a 0%-CTR page at a top position is a top opportunity).
    const ctrGapExtra: OpportunityItem[] = buildCtrGapRows(pagesWithQueries, estimatedCtr).map((r) => ({
      kind: "snippet",
      query: r.query,
      page: r.page,
      clicksAtStake: r.clicksLeft,
      detail: `ranks pos ${r.position.toFixed(1)} but only ${(r.actualCtr * 100).toFixed(1)}% CTR (vs ~${(r.expectedCtr * 100).toFixed(0)}% expected) — fix the title/snippet`,
      route: workbenchHref(r.page),
    }));
    // Cannibalization (consolidate) — split clicks are clicks at stake too.
    const canonFn = (u: string) => canonicalizeCitationUrl(u) ?? u;
    const prettyFn = (u: string) => {
      const s = u.split("?")[0]!.split("#")[0]!.replace(/\/$/, "");
      return s.split("/").filter(Boolean).pop() || u;
    };
    const consolidateExtra: OpportunityItem[] = buildCannibalizationCaseRows(cannibalCases, canonFn, prettyFn).map((r) => ({
      kind: "consolidate",
      query: r.query,
      page: r.leadPage,
      clicksAtStake: r.clicksAtStake,
      detail: `${r.others.length + 1} of your pages split this query's clicks — consolidate to "${r.leadPage}"`,
      route: "#sec-cannibal",
    }));
    const extra = [...moveExtra, ...ctrGapExtra, ...consolidateExtra];
    const result = buildOpportunityFeedWithTotals(declines, striking, clicksAtStakeForStriking, { extra });
    items = result.items;
    allItems = result.all;
    total = result.total;
    totalClicks = result.totalClicksAtStake;
    // The dev-handoff doc should be COMPLETE — append the asset-engine tools
    // (build-these) after the rank work, on their own demand metric.
    toolExportItems = buildToolOpportunities(toolQueries, { minImpressions: 5 }).map((t) => ({
      kind: "tool",
      query: t.suggestion,
      page: `/tools/${t.topic.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || t.kind}`,
      clicksAtStake: t.impressions,
      detail: `${t.impressions.toLocaleString()} searches/mo for "${t.query}" — no tool yet`,
    }));
    // New pages (create_page) — the build-new content opportunities.
    newPageExportItems = (newPages.opportunities ?? []).map((o) => ({
      kind: "build",
      query: o.topic,
      page: `/${o.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
      clicksAtStake: o.searchVolume ?? 0,
      detail: `${o.competitorCount} competitor page(s) own this${o.topCompetitor ? ` (e.g. ${o.topCompetitor})` : ""}${o.searchVolume ? `; ${o.searchVolume.toLocaleString()} searches/mo` : ""} — you have no page`,
    }));
  } catch {
    return null;
  }
  if (items.length === 0) return null;

  // Full ranked list + new pages + tools → one complete whole-site work doc.
  const exportItems: ExportItem[] = [
    ...allItems.map((it) => ({
      kind: it.kind,
      query: it.query,
      page: it.page,
      clicksAtStake: it.clicksAtStake,
      detail: it.detail,
    })),
    ...newPageExportItems,
    ...toolExportItems,
  ];

  return (
    <section className="rounded-3xl border border-violet-200/70 bg-gradient-to-br from-violet-50/60 via-white to-sky-50/40 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-violet-500">★</span> Biggest opportunities right now
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Your highest-impact moves across the whole site, ranked by the clicks at stake — whether you&apos;re
            losing them or just within reach of winning them. Start at the top.
            {total > items.length ? (
              <span className="ml-1 text-gray-400">Showing the top {items.length} of {total}.</span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <WorklistExportButton items={exportItems} siteName={siteName} />
          <div className="rounded-xl border border-violet-100 bg-white px-4 py-2 text-right">
            <div className="text-2xl font-semibold tracking-tight text-violet-600">~{fmtNum(totalClicks)}</div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              monthly clicks at stake{total > items.length ? " (all moves)" : ""}
            </div>
          </div>
        </div>
      </div>

      <ol className="mt-5 space-y-1.5">
        {items.map((it, i) => (
          <li
            key={i}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-100 bg-white/70 px-3 py-2 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-bold text-violet-700">
                {i + 1}
              </span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${KIND_STYLE[it.kind]}`}
              >
                {KIND_LABEL[it.kind]}
              </span>
              <span className="min-w-0">
                <span className="font-medium text-gray-900">{it.query}</span>
                <span className="ml-2 text-xs text-gray-400">on {slugOf(it.page)}</span>
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-violet-600">~{fmtNum(it.clicksAtStake)} clicks/mo</span>
              {/* Queued moves (cite/build/edit) carry a rec-detail route to ACT; the
                  site-wide GSC signals (recover/win) go to the page-level Workbench. */}
              <Link
                href={it.kind === "recover" || it.kind === "win" ? workbenchHref(it.page) : it.route}
                className="font-semibold text-violet-600 hover:text-violet-800"
              >
                Act →
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
