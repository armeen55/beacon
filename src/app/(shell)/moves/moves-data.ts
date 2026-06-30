import "server-only";
import { cache } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { summarizeSpecialistDebate } from "@/domains/demand-graph/debate-summary";
import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
import { competitorRelevance } from "@/domains/evidence/relevance-gate";
import { ACTION_LABEL, actionFamily, type ActionPack } from "@/domains/action-pack/types";

import { after } from "next/server";
import { loadTodayMovesHeroData, type TodayMove, type TodayMovesHeroData } from "../today-moves-data";
import { readWorklistSurface, writeWorklistSurface, isSurfaceStale } from "../worklist-surface-store";

/**
 * /moves data (2026-06-27) — the worklist is now driven by the CANONICAL ActionPack
 * brain (`loadActionPackWorklistForTenant`): the same deduped, cross-source-ranked
 * set the unified diagnostic proves. ActionPack decides WHAT shows + the ORDER; the
 * rich `TodayMove` (shared with Today `/`) supplies the full card body (title lab,
 * drafts, debate, prepared checklist) by joining on the page URL. Coverage-only AEO
 * packs the demand-graph worklist used to miss now appear inline (lightweight card).
 *
 * Create/hub packs are intentionally excluded here — they live on the New Pages board
 * (`TodayNewPagesSection`), which keeps the AI-validated badges + Draft AEO brief.
 * Read-only; no live Profound/DataForSEO on render (ActionPack reads cached/durable).
 */

const canon = (u: string): string => (canonicalizeCitationUrl(u) ?? u).toLowerCase().replace(/\/+$/, "");

/** Render cap for /moves — the strongest N (single-user app; the full brain count
 *  stays in stats.movesReady). Filters narrow within the shown set. */
const MOVES_CAP = 75;

const EMPTY_STATS: TodayMovesHeroData["stats"] = {
  movesReady: 0, demandAtStake: 0, citationsContested: 0, pagesCovered: 0,
  draftsReady: 0, strikingWins: 0, losingQueries: 0, selfCompeting: 0,
  heldWhileMeasuring: 0, preparedReady: 0,
};

/** Map an ActionPack action type → the TodayMove action key (drives the card's
 *  tone + label + which affordances the MoveCard offers). */
function actionKeyOf(a: ActionPack["actionType"]): string {
  switch (a) {
    case "add_answer_block": return "add_answer_block";
    case "fix_conversion_friction": return "fix_page_experience";
    case "fix_title_meta_ctr": return "edit_title";
    case "add_internal_links":
    case "consolidate_pages": return "add_internal_links";
    default: return "edit_title"; // edit_existing_page
  }
}

function toneOf(p: ActionPack): TodayMove["actionTone"] {
  if (p.actionType === "add_answer_block") return "citation";
  if (p.actionType === "fix_conversion_friction") return "experience";
  if (p.actionType === "add_internal_links" || p.actionType === "consolidate_pages") return "experience";
  return "clicks";
}

function prettyPath(url: string): string {
  try {
    const p = new URL(url).pathname.replace(/\/$/, "");
    return p === "" ? "Home" : p;
  } catch {
    return url;
  }
}

/** Lightweight TodayMove from an ActionPack — used for coverage-only AEO packs that
 *  have no rich demand-graph move to join to. Honest: rich-only fields stay empty. */
function actionPackToTodayMove(p: ActionPack): TodayMove {
  const action = actionKeyOf(p.actionType);
  return {
    id: p.id,
    action,
    actionLabel: ACTION_LABEL[p.actionType],
    actionTone: toneOf(p),
    query: p.label,
    targetUrl: p.targetUrl ?? "needs_new_page",
    pageLabel: p.targetUrl ? prettyPath(p.targetUrl) : p.label,
    why: p.whyNotNoise,
    proof: p.profoundReceipt
      ? `AI is asked “${p.profoundReceipt.topPrompt}” — ${p.profoundReceipt.citedDomains.slice(0, 2).join(", ")} cited${p.profoundReceipt.ownAbsent ? ", you're not" : ""}.`
      : "",
    confidence: p.confidence,
    demand: p.gscDemand?.impressions ?? null,
    demandBasis: p.gscDemand && p.gscDemand.impressions > 0 ? "gsc" : p.profoundReceipt ? "ai_attention" : null,
    whoCited:
      p.profoundReceipt?.citedDomains?.[0] &&
      competitorRelevance(p.label, { url: p.profoundReceipt.citedDomains[0], title: p.profoundReceipt.citedDomains[0] }).relevant
        ? p.profoundReceipt.citedDomains[0]
        : null,
    // Evidence relevance gate: suppress an off-topic / noise competitor page (a
    // facebook.com/TasteAtlas eggplant URL on a flag page) from "what wins".
    whatWins:
      p.competitorPagesToBeat?.[0] &&
      competitorRelevance(p.label, { url: p.competitorPagesToBeat[0], title: p.competitorPagesToBeat[0] }).relevant
        ? p.competitorPagesToBeat[0]
        : null,
    yourGap: "",
    topQueries: [],
    declines: [],
    cannibalization: [],
    ga4: p.ga4Value ? { sessions: p.ga4Value.sessions, conversions: p.ga4Value.conversions } : null,
    friction: null, // ActionPack carries a friction score, not the dead/rage split the card renders
    looselyMatched: false,
    also: [],
    outline: [],
    answerBrief: null,
    draftTitle: null,
    draftMeta: null,
    faqs: [],
    schema: [],
    titleVariants: [],
    rankWhy: `Ranked by ${p.evidenceSources.join(" + ")}.`,
    score: p.priorityScore,
    savedAnswerBlock: null,
    savedFaqJsonLd: null,
    specialists: [],
    debate: summarizeSpecialistDebate([]),
    routerAction: null,
    routerRationale: null,
    routerConfidence: null,
    preparedStatus: null,
    preparedChecklist: null,
    preparedDraftKind: null,
    preparedDraftText: null,
    preparedQuality: null,
    preparedExperiment: null,
    preparedStale: false,
    learnedTag: null,
  };
}

async function loadUncached(tenantId: string): Promise<TodayMovesHeroData> {
  const [wl, hero] = await Promise.all([
    loadActionPackWorklistForTenant(tenantId).catch(() => null),
    loadTodayMovesHeroData({ limit: 60 }).catch((): TodayMovesHeroData | null => null),
  ]);

  // No canonical worklist → fall back to the rich hero set (never a blank page).
  if (!wl) return hero ?? { moves: [], stats: EMPTY_STATS, learning: { measuring: 0, won: 0, lost: 0, headline: null }, cockpit: null };

  // Index rich demand-graph moves by canonical page URL for the join (one per page).
  const richByUrl = new Map<string, TodayMove>();
  for (const m of hero?.moves ?? []) {
    if (m.targetUrl && m.targetUrl !== "needs_new_page") richByUrl.set(canon(m.targetUrl), m);
  }

  // Cross-enrich (W6): a coverage-only (profound) pack and a demand-graph pack can
  // describe the SAME owned URL. Union their evidence sources by canonical URL so a
  // coverage card honestly shows the GSC/Clarity/etc. the brain already has for that
  // page — not a misleadingly profound-only chip row. Honest: only real sources.
  const sourcesByUrl = new Map<string, Set<string>>();
  for (const p of wl.packs) {
    if (!p.targetUrl) continue;
    const key = canon(p.targetUrl);
    const set = sourcesByUrl.get(key) ?? new Set<string>();
    for (const s of p.evidenceSources) set.add(s);
    sourcesByUrl.set(key, set);
  }

  const usedRich = new Set<string>();
  const moves: TodayMove[] = [];
  for (const p of wl.packs) {
    // Create/hub packs live on the New Pages board, not this worklist.
    const fam = actionFamily(p.actionType);
    if (fam === "new_page" || fam === "hub") continue;

    const chips = p.targetUrl ? [...(sourcesByUrl.get(canon(p.targetUrl)) ?? p.evidenceSources)] : p.evidenceSources;
    const dfs = p.dataforseoValidation
      ? { verdict: p.dataforseoValidation.verdict, topDomains: p.dataforseoValidation.topDomains.slice(0, 3), overlap: p.dataforseoValidation.profoundOverlapCount }
      : null;
    const rich = p.targetUrl ? richByUrl.get(canon(p.targetUrl)) : undefined;
    if (rich) {
      if (usedRich.has(rich.id)) continue; // one rich card per page
      usedRich.add(rich.id);
      // Thread the canonical ActionPack provenance + SERP verdict onto the rich
      // card (they were computed on the pack but dropped at this projection).
      moves.push({ ...rich, sourceChips: chips, dataforseoVerdict: dfs });
    } else {
      // coverage-only AEO pack, surfaced inline — with cross-enriched provenance.
      moves.push({ ...actionPackToTodayMove(p), sourceChips: chips, dataforseoVerdict: dfs });
    }
  }

  // Cap the rendered worklist to the strongest MOVES_CAP so /moves feels powerful,
  // not endless — the true total is preserved in stats.movesReady (the brain size).
  const trueTotal = moves.length;
  const shown = moves.slice(0, MOVES_CAP);

  const stats: TodayMovesHeroData["stats"] = {
    movesReady: trueTotal,
    demandAtStake: Math.round(moves.reduce((s, m) => s + (m.demand ?? 0), 0)),
    citationsContested: moves.filter((m) => m.actionTone === "citation").length,
    pagesCovered: new Set(moves.map((m) => m.targetUrl)).size,
    draftsReady: moves.filter((m) => m.savedAnswerBlock || m.preparedChecklist?.draftPrepared).length,
    strikingWins: hero?.stats.strikingWins ?? 0,
    losingQueries: hero?.stats.losingQueries ?? 0,
    selfCompeting: hero?.stats.selfCompeting ?? 0,
    heldWhileMeasuring: hero?.stats.heldWhileMeasuring ?? 0,
    preparedReady: moves.filter((m) => m.preparedChecklist?.readyToReview).length,
  };

  // Today-cockpit projection — the few pack-derived counts the `/` cockpit needs, computed
  // here (from the SAME `wl` this surface is built from) so Today reads them off this cached
  // snapshot instead of rebuilding the ~20s ActionPack worklist on its critical path.
  const cockpit: TodayMovesHeroData["cockpit"] = {
    newPagesCount: wl.packs.filter((p) => {
      const fam = actionFamily(p.actionType);
      return fam === "new_page" || fam === "hub";
    }).length,
    aiValidatedCount: wl.packs.filter((p) => p.dataforseoValidation?.verdict === "build").length,
    sourceCoverage: wl.summary.sourceCoverage,
  };

  return { moves: shown, stats, learning: hero?.learning ?? { measuring: 0, won: 0, lost: 0, headline: null }, cockpit };
}

/**
 * Stale-while-revalidate surface cache. The cold compute (`loadUncached`) rebuilds the
 * demand graph from Supabase (~32s) and floors /worklist at ~50s — only `react.cache`
 * (per-request), no cross-request persistence. So: serve the last persisted snapshot
 * INSTANTLY (with its `computedAt` for an honest "updated N ago"), and when it's stale
 * refresh in the background via `after()` (best-effort; if the lambda freezes mid-refresh
 * the next visit retries). Only the first-ever load (cold cache) pays the full compute.
 * Mutating actions invalidate the surface so operator changes show on the next load.
 */
async function loadSurfaceWithSwr(tenantId: string): Promise<TodayMovesHeroData> {
  const cached = await readWorklistSurface().catch(() => null);
  if (cached) {
    if (isSurfaceStale(cached.computedAt, Date.now())) {
      after(async () => {
        try {
          const fresh = await loadUncached(tenantId);
          await writeWorklistSurface(fresh, new Date().toISOString());
        } catch {
          /* best-effort background refresh; the next visit retries */
        }
      });
    }
    return { ...cached.data, surfaceComputedAt: cached.computedAt };
  }
  // First-ever / invalidated → compute synchronously, then persist for next time.
  const fresh = await loadUncached(tenantId);
  await writeWorklistSurface(fresh, new Date().toISOString());
  return fresh;
}

/** Request-memoized /moves worklist, ActionPack-powered, SWR-cached cross-request. */
export const loadMovesWorklist = cache(
  async (): Promise<TodayMovesHeroData> => loadSurfaceWithSwr(await currentTenantId()),
);
