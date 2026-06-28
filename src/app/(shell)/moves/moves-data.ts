import "server-only";
import { cache } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { summarizeSpecialistDebate } from "@/domains/demand-graph/debate-summary";
import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
import { ACTION_LABEL, actionFamily, type ActionPack } from "@/domains/action-pack/types";

import { loadTodayMovesHeroData, type TodayMove, type TodayMovesHeroData } from "../today-moves-data";

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
    whoCited: p.profoundReceipt?.citedDomains?.[0] ?? null,
    whatWins: p.competitorPagesToBeat?.[0] ?? null,
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
  if (!wl) return hero ?? { moves: [], stats: EMPTY_STATS, learning: { measuring: 0, won: 0, lost: 0, headline: null } };

  // Index rich demand-graph moves by canonical page URL for the join (one per page).
  const richByUrl = new Map<string, TodayMove>();
  for (const m of hero?.moves ?? []) {
    if (m.targetUrl && m.targetUrl !== "needs_new_page") richByUrl.set(canon(m.targetUrl), m);
  }

  const usedRich = new Set<string>();
  const moves: TodayMove[] = [];
  for (const p of wl.packs) {
    // Create/hub packs live on the New Pages board, not this worklist.
    const fam = actionFamily(p.actionType);
    if (fam === "new_page" || fam === "hub") continue;

    const rich = p.targetUrl ? richByUrl.get(canon(p.targetUrl)) : undefined;
    if (rich) {
      if (usedRich.has(rich.id)) continue; // one rich card per page
      usedRich.add(rich.id);
      moves.push(rich); // full card, but SELECTED + ORDERED by the ActionPack brain
    } else {
      moves.push(actionPackToTodayMove(p)); // coverage-only AEO pack, surfaced inline
    }
  }

  const stats: TodayMovesHeroData["stats"] = {
    movesReady: moves.length,
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

  return { moves, stats, learning: hero?.learning ?? { measuring: 0, won: 0, lost: 0, headline: null } };
}

/** Request-memoized /moves worklist, ActionPack-powered. */
export const loadMovesWorklist = cache(
  async (): Promise<TodayMovesHeroData> => loadUncached(await currentTenantId()),
);
