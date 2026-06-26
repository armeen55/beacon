/**
 * worklist-views (2026-06-25, Sprint 6) — the unified ranked worklist + filtered
 * views. PURE / deterministic / no I/O.
 *
 * The plan's north star: ONE ranked list of Moves (not 30 stacked cockpit sections),
 * sliced into views (Today / This Week / Big Bets / New Pages / Store / Tools /
 * Trends / All). This normalizes the four producers (demand-graph Moves, demand
 * opportunities, trend opportunities, product opportunities) into one WorklistItem
 * shape, ranks by score, and filters per view. No fabrication — items carry only
 * what their source provided.
 *
 * Pinned by worklist-views.test.ts.
 */

export type WorklistView =
  | "all"
  | "today"
  | "this_week"
  | "big_bets"
  | "new_pages"
  | "store"
  | "tools"
  | "trends"
  | "fixups";

export type WorklistKind = "move" | "opportunity" | "trend" | "product";
export type WorklistParent = "content" | "commerce" | "trend" | "tool" | "technical";

export type WorklistItem = {
  id: string;
  kind: WorklistKind;
  parent: WorklistParent;
  title: string;
  action: string;
  targetUrl: string | null;
  /** Normalized rank key (0..1+). Higher = do first. */
  rank: number;
  demand: number | null;
  confidence: "high" | "medium" | "low";
  prepared: boolean;
  isNew: boolean; // create_page / create_product / create_collection
  trend?: "rising" | "flat" | "declining" | "unknown";
  conceptOnly?: boolean;
  why: string;
};

import { classifyCommerceUrl } from "@/domains/page-factory/commerce-classifier";

const TOOL_ACTIONS = new Set(["build_tool", "build_calculator", "build_checklist", "build_quiz", "build_template", "create_asset"]);
const COMMERCE_ACTIONS = new Set(["create_product", "create_collection", "improve_product_page", "improve_collection", "optimize_product_page"]);
const NEW_ACTIONS = new Set(["create_page", "create_product", "create_collection"]);
const CONF_W: Record<string, number> = { high: 1, medium: 0.7, low: 0.4 };

function parentOf(action: string, kind: WorklistKind, url?: string | null): WorklistParent {
  if (kind === "trend") return "trend";
  if (TOOL_ACTIONS.has(action)) return "tool";
  if (COMMERCE_ACTIONS.has(action)) return "commerce";
  if (action === "fix_page_experience" || action === "fix_ux" || action.startsWith("fix_")) return "technical";
  // URL signal (Sprint 6): a product/collection page is commerce even under a
  // generic content action — so the Store view catches store-page edits too.
  if (url && classifyCommerceUrl(url).kind !== "content") return "commerce";
  return "content";
}

/** Normalize the four producers into one ranked list (desc by rank). PURE. */
export function buildWorklist(inputs: {
  moves?: { id: string; action: string; targetUrl: string | null; score: number; demand: number | null; confidence: "high" | "medium" | "low"; prepared: boolean; title: string; why?: string }[];
  opportunities?: { id: string; action: string; matchedPageUrl: string | null; estDemand: number; confidence: "high" | "medium" | "low"; primaryKeyword: string; whyNow: string; parentType?: string }[];
  trends?: { id: string; recommendedAction: string; targetPageUrl: string | null; estDemand: number | null; confidence: "high" | "medium" | "low"; query: string; trend: "rising" | "flat" | "declining" | "unknown"; whyNow: string }[];
  products?: { id: string; recommendedAction: string; matchedPageUrl: string | null; estDemand: number; confidence: "high" | "medium" | "low"; keyword: string; whyNow: string; conceptOnly: boolean; trend: "rising" | "flat" | "declining" | "unknown" }[];
  /** Bot-coverage crawlability gaps (Sprint 6) — valuable pages AI can't crawl. */
  crawlGaps?: { path: string; value: number; reason: string; severity: "high" | "medium" }[];
}): WorklistItem[] {
  const items: WorklistItem[] = [];
  // Normalize a demand value to ~0..1 for ranking (log scale; 100k ≈ 1).
  const demandRank = (d: number | null) => (d && d > 0 ? Math.min(1, Math.log10(1 + d) / 5) : 0);

  for (const m of inputs.moves ?? []) {
    items.push({
      id: m.id,
      kind: "move",
      parent: parentOf(m.action, "move", m.targetUrl),
      title: m.title,
      action: m.action,
      targetUrl: m.targetUrl,
      rank: (Number.isFinite(m.score) ? m.score : 0) * (m.prepared ? 1.1 : 1),
      demand: m.demand,
      confidence: m.confidence,
      prepared: m.prepared,
      isNew: NEW_ACTIONS.has(m.action),
      why: m.why ?? "",
    });
  }
  for (const o of inputs.opportunities ?? []) {
    items.push({
      id: o.id,
      kind: "opportunity",
      parent: o.parentType === "commerce_move" ? "commerce" : parentOf(o.action, "opportunity", o.matchedPageUrl),
      title: o.primaryKeyword,
      action: o.action,
      targetUrl: o.matchedPageUrl,
      rank: demandRank(o.estDemand) * CONF_W[o.confidence],
      demand: o.estDemand,
      confidence: o.confidence,
      prepared: false,
      isNew: NEW_ACTIONS.has(o.action),
      why: o.whyNow,
    });
  }
  for (const t of inputs.trends ?? []) {
    items.push({
      id: t.id,
      kind: "trend",
      parent: "trend",
      title: t.query,
      action: t.recommendedAction,
      targetUrl: t.targetPageUrl,
      rank: demandRank(t.estDemand) * CONF_W[t.confidence] * (t.trend === "rising" ? 1.25 : 1),
      demand: t.estDemand,
      confidence: t.confidence,
      prepared: false,
      isNew: NEW_ACTIONS.has(t.recommendedAction),
      trend: t.trend,
      why: t.whyNow,
    });
  }
  for (const p of inputs.products ?? []) {
    items.push({
      id: p.id,
      kind: "product",
      parent: "commerce",
      title: p.keyword,
      action: p.recommendedAction,
      targetUrl: p.matchedPageUrl,
      rank: demandRank(p.estDemand) * CONF_W[p.confidence] * (p.trend === "rising" ? 1.15 : 1),
      demand: p.estDemand,
      confidence: p.confidence,
      prepared: false,
      isNew: NEW_ACTIONS.has(p.recommendedAction),
      trend: p.trend,
      conceptOnly: p.conceptOnly,
      why: p.whyNow,
    });
  }
  for (const g of inputs.crawlGaps ?? []) {
    items.push({
      id: `crawl:${g.path}`,
      kind: "move",
      parent: "technical",
      title: `Make crawlable: ${g.path}`,
      action: "fix_crawlability",
      targetUrl: g.path,
      rank: demandRank(g.value) * (g.severity === "high" ? 1.2 : 1),
      demand: g.value,
      confidence: g.severity === "high" ? "high" : "medium",
      prepared: false,
      isNew: false,
      why: g.reason,
    });
  }
  return items.sort((a, b) => b.rank - a.rank);
}

/** Filter the unified list to a view. PURE. `all` returns the full ranked list. */
export function sliceWorklist(items: WorklistItem[], view: WorklistView, opts: { todayN?: number; weekN?: number } = {}): WorklistItem[] {
  const todayN = opts.todayN ?? 5;
  const weekN = opts.weekN ?? 15;
  switch (view) {
    case "all":
      return items;
    case "today":
      return items.slice(0, todayN);
    case "this_week":
      return items.slice(0, weekN);
    case "big_bets":
      // High-demand net-new bets (the swing-for-the-fences items).
      return items.filter((i) => i.isNew && (i.demand ?? 0) >= 1000).sort((a, b) => (b.demand ?? 0) - (a.demand ?? 0));
    case "new_pages":
      return items.filter((i) => i.action === "create_page" || (i.isNew && i.parent === "content"));
    case "store":
      return items.filter((i) => i.parent === "commerce");
    case "tools":
      return items.filter((i) => i.parent === "tool");
    case "trends":
      return items.filter((i) => i.kind === "trend" || i.trend === "rising");
    case "fixups":
      // Technical fix-ups: crawlability gaps + page-experience/friction fixes.
      return items.filter((i) => i.parent === "technical");
    default:
      return items;
  }
}

export const WORKLIST_VIEWS: { id: WorklistView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "this_week", label: "This week" },
  { id: "big_bets", label: "Big bets" },
  { id: "new_pages", label: "New pages" },
  { id: "store", label: "Store" },
  { id: "tools", label: "Tools" },
  { id: "trends", label: "Trends" },
  { id: "fixups", label: "Fix-ups" },
  { id: "all", label: "All" },
];
