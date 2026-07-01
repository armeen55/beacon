/**
 * specialist-opinions (2026-06-25, P1 - the Beacon Team Contract) - model every
 * connector as a SPECIALIST teammate that emits a falsifiable, attributable
 * opinion about a Move: a claim, the evidence rows behind it, a confidence, the
 * Move types it would support, the objections it raises against other Moves, the
 * way it should tilt the Rank-&-Revenue score, and when its evidence goes stale.
 *
 * PURE / deterministic / no I/O / no LLM. Each emitter consumes the canonical
 * fused `EvidencePacket` (the object the demand graph already builds - we reuse
 * it, never re-load) plus a small `SpecialistExtras` for the few facts the packet
 * doesn't carry yet (live SERP verdict, CMS pushability). An emitter returns
 * `null` to ABSTAIN when it has no evidence - it never fabricates data. The
 * MoveRouter (P2) debates these opinions into one decision; the PreparedMovePack
 * (P3) carries them so every surface can show the team's reasoning.
 *
 * Tenant-agnostic. Pinned by specialist-opinions.test.ts.
 */

import type { EvidencePacket } from "./evidence-packet";
import type { SerpValidation } from "@/domains/serp/serp-validation";
import { competitorRelevance } from "@/domains/evidence/relevance-gate";

/** The teammates. Each maps to a connector (or, for the last two, a synthesis
 *  role). `commerce_asset` is the Opportunity/Asset/Commerce Strategist - it
 *  decides what an opportunity should BECOME (article / tool / product / …). */
export type Specialist =
  | "gsc"
  | "ga4"
  | "clarity"
  | "profound"
  | "dataforseo"
  | "wix"
  | "llm"
  | "commerce_asset";

/** The Move taxonomy the team can route to (the action level, distinct from the
 *  recommendation-queue ActionType). `wait` is a real, first-class recommendation. */
export type MoveRouterAction =
  | "create_page"
  | "edit_existing_page"
  | "add_answer_block"
  | "add_schema"
  | "change_title_meta"
  | "add_internal_links"
  | "build_tool"
  | "build_calculator"
  | "create_asset"
  | "fix_ux"
  | "get_backlinks"
  | "local_seo_update"
  | "improve_image_seo"
  | "optimize_product_page"
  | "wait";

/** A pointer at a real stored row (or a derived/computed fact), so every claim is
 *  auditable back to its source. `source` is the literal table the loader read
 *  (or "computed" for a synthesis). */
export type EvidenceSource =
  | "gsc_daily_page_totals"
  | "ga4_url_traffic"
  | "clarity_daily_url_metrics"
  | "profound_citation_rows"
  | "profound_visibility_rows"
  | "dataforseo_serp_cache"
  | "wix_url_map"
  | "competitor_teardown"
  | "computed";

export type EvidenceRef = {
  specialist: Specialist;
  source: EvidenceSource;
  /** Row identity within the tenant (canonical url, demand key, …). */
  key: string;
  /** Human one-liner with the raw numbers behind the claim. */
  detail: string;
};

export type ObjectionKind =
  | "fix_ux_first"
  | "cant_outrank_serp"
  | "already_ranks"
  | "not_pushable"
  | "off_topic_competitor"
  | "no_measured_demand"
  | "thin_evidence";

export type Objection = {
  kind: ObjectionKind;
  /** Move actions this objection argues against (empty = any content move). */
  against: MoveRouterAction[];
  /** veto removes the action from consideration; downgrade only cuts its score. */
  severity: "veto" | "downgrade";
  detail: string;
  evidenceRefs: EvidenceRef[];
};

/** Bounded score DELTAS a specialist wants to push into the Rank-&-Revenue score.
 *  Deltas compose; the router applies them transparently (it never re-derives the
 *  pure scorer). `scoreMultiplier` is a flat boost/cut (1 = neutral).
 *  NOTE (Sprint 1): the router consumes ONLY `scoreMultiplier`. The additive deltas
 *  (demand/winnabilityDelta/visibilityGapDelta/dollarValue/friction) are carried on
 *  the opinion for the later P6 score-fold + learning reweight; they are intentionally
 *  not folded in yet so the pure scorer stays the single source of truth. */
export type ScoreContribution = {
  demand?: number;
  winnabilityDelta?: number;
  visibilityGapDelta?: number;
  dollarValue?: number;
  friction?: number;
  /** 0.5..1.5 - a flat multiplier on the final score (overlap boost, not-pushable cut). */
  scoreMultiplier?: number;
};

export type SpecialistOpinion = {
  specialist: Specialist;
  /** Operator-language statement of what this teammate found. */
  claim: string;
  evidenceRefs: EvidenceRef[];
  /** 0..1. */
  confidence: number;
  /** Strongest-first; empty for amplifier-only specialists (GA4, Wix). */
  suggestedMoveTypes: MoveRouterAction[];
  objections: Objection[];
  scoreContribution: ScoreContribution;
  /** ISO; recompute before ship if past. */
  staleAt: string;
};

/** The few facts the EvidencePacket doesn't carry yet - threaded by the loader
 *  when available, otherwise omitted (the relevant specialist then abstains). */
export type SpecialistExtras = {
  nowIso?: string;
  /** The tenant's own domain (for the DataForSEO "you already rank" read). */
  ownDomain?: string | null;
  /** Live-SERP verdict for this Move, when one has been prepared (DataForSEO). */
  serpVerdict?: SerpValidation | null;
  /** Whether this Move's target is field-publishable on the tenant's CMS (Wix).
   *  undefined ⇒ unknown ⇒ the Wix specialist abstains. */
  pushable?: boolean;
};

// ── cadences (staleAt = now + cadence). Real, per the connector audit:
//    GSC/GA4/Clarity re-read on use (~1h), Profound 12h, DataForSEO 14d cache. ──
const HOUR = 60 * 60 * 1000;
const CADENCE_MS: Record<Specialist, number> = {
  gsc: HOUR,
  ga4: HOUR,
  clarity: HOUR,
  profound: 12 * HOUR,
  dataforseo: 14 * 24 * HOUR,
  wix: HOUR,
  llm: HOUR,
  commerce_asset: HOUR,
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function staleAtFor(specialist: Specialist, nowIso: string): string {
  const base = Date.parse(nowIso);
  const ms = Number.isFinite(base) ? base : Date.now();
  return new Date(ms + CADENCE_MS[specialist]).toISOString();
}

/** How many distinct competitor pages this Move's packet says AI/Google cite. */
function citedCompetitorCount(p: EvidencePacket): number {
  return (p.competitor.topUrl ? 1 : 0) + (p.competitor.otherUrls?.length ?? 0);
}

// ── the 8 emitters. Each is pure and abstains (null) without real evidence. ──

/** GSC - realized search demand, ranking, and CTR. The spine. */
export function emitGscOpinion(p: EvidencePacket, extras: SpecialistExtras = {}): SpecialistOpinion | null {
  const nowIso = extras.nowIso ?? new Date().toISOString();
  const gsc = p.yourPage.gsc;
  const hasGscSignal = p.move.signals.includes("GSC");
  if (!gsc && !hasGscSignal) return null; // no realized search evidence → abstain

  const refs: EvidenceRef[] = [];
  const suggested: MoveRouterAction[] = [];
  const objections: Objection[] = [];
  const contribution: ScoreContribution = { demand: p.move.components.demand };
  let confidence = 0.45;
  let claim: string;

  if (gsc) {
    const pos = gsc.position;
    const ctrPct = (gsc.ctr * 100).toFixed(1);
    claim =
      pos != null
        ? `Ranks #${Math.round(pos)} with ${ctrPct}% CTR on ${gsc.impressions.toLocaleString()} impressions.`
        : `${gsc.impressions.toLocaleString()} impressions / ${gsc.clicks.toLocaleString()} clicks of real Google demand.`;
    refs.push({
      specialist: "gsc",
      source: "gsc_daily_page_totals",
      key: p.yourPage.url ?? p.move.key,
      detail: `impr=${gsc.impressions} clicks=${gsc.clicks} ctr=${ctrPct}% pos=${pos ?? "?"}`,
    });
    confidence = clamp01(0.4 + Math.log10(1 + gsc.impressions) / 5);
    // Striking distance (ranks but under-performs) → a title/meta or edit play.
    const striking = pos != null && pos > 3 && pos <= 12;
    if (p.move.gapType === "edit_page" || striking) {
      suggested.push("change_title_meta", "edit_existing_page");
      if (striking) contribution.winnabilityDelta = 0.3;
    } else if (p.move.gapType === "healthy") {
      suggested.push("wait");
    }
  } else {
    // Demand signal without an owned GSC row (a create candidate riding the cluster).
    claim = `Real search demand for "${p.move.label}".`;
    refs.push({
      specialist: "gsc",
      source: "computed",
      key: p.move.key,
      detail: `fused demand=${Math.round(p.move.components.demand)} (basis=${p.demand.basis})`,
    });
  }

  // If the demand basis is AI-attention only (no measured GSC/volume), GSC raises
  // an honest objection against creating a page on unproven demand.
  if (p.demand.basis === "ai_attention") {
    objections.push({
      kind: "no_measured_demand",
      against: ["create_page"],
      severity: "downgrade",
      detail: "Demand here is an AI-attention proxy - no measured Google search volume yet.",
      evidenceRefs: [{ specialist: "gsc", source: "computed", key: p.move.key, detail: "basis=ai_attention" }],
    });
  }

  return {
    specialist: "gsc",
    claim,
    evidenceRefs: refs,
    confidence,
    suggestedMoveTypes: suggested,
    objections,
    scoreContribution: contribution,
    staleAt: staleAtFor("gsc", nowIso),
  };
}

/** GA4 - money. An AMPLIFIER: it never picks the Move, it weights it. */
export function emitGa4Opinion(p: EvidencePacket, extras: SpecialistExtras = {}): SpecialistOpinion | null {
  const nowIso = extras.nowIso ?? new Date().toISOString();
  const dollar = p.yourPage.dollarValue;
  if (!(dollar > 0)) return null; // no measured value → abstain (money never vetoes)

  return {
    specialist: "ga4",
    claim: `This page makes money: conversion value score ${Math.round(dollar)} over the last 28 days. Protect and grow it.`,
    evidenceRefs: [
      {
        specialist: "ga4",
        source: "ga4_url_traffic",
        key: p.yourPage.url ?? p.move.key,
        detail: `ga4 value/conversions=${dollar}`,
      },
    ],
    confidence: clamp01(0.5 + Math.log10(1 + dollar) / 4),
    suggestedMoveTypes: [], // amplifier - money weights, never decides
    objections: [],
    scoreContribution: { dollarValue: dollar },
    staleAt: staleAtFor("ga4", nowIso),
  };
}

/** Clarity - on-page friction. In Sprint 1 it fires on the AGGREGATED friction
 *  the packet carries (rage + dead + 2×script-errors) and raises a DOWNGRADE
 *  ("fix UX first") against content Moves. The script-error-specific hard VETO
 *  (JS errors block AI crawlers) needs the raw Clarity breakdown - that arrives
 *  with P13 (Clarity-as-router); until then we never over-claim a veto. */
export function emitClarityOpinion(p: EvidencePacket, extras: SpecialistExtras = {}): SpecialistOpinion | null {
  const nowIso = extras.nowIso ?? new Date().toISOString();
  const friction = p.yourPage.friction;
  if (!(friction >= 15)) return null; // below the meaningful-friction floor → abstain

  const ref: EvidenceRef = {
    specialist: "clarity",
    source: "clarity_daily_url_metrics",
    key: p.yourPage.url ?? p.move.key,
    detail: `friction=${friction} (rage + dead + 2×script-errors)`,
  };
  return {
    specialist: "clarity",
    claim: `Real visitors struggle here: dead and rage clicks put friction at ${friction} of 100. The page frustrates before it converts.`,
    evidenceRefs: [ref],
    confidence: 0.6,
    suggestedMoveTypes: ["fix_ux"],
    objections: [
      {
        kind: "fix_ux_first",
        against: ["add_answer_block", "edit_existing_page", "change_title_meta"],
        severity: "downgrade",
        detail: "High on-page friction - fixing the experience first protects any traffic a content move would win.",
        evidenceRefs: [ref],
      },
    ],
    scoreContribution: { friction },
    staleAt: staleAtFor("clarity", nowIso),
  };
}

/** Profound - answer-engine (AEO) visibility: who AI cites for this topic. */
export function emitProfoundOpinion(p: EvidencePacket, extras: SpecialistExtras = {}): SpecialistOpinion | null {
  const nowIso = extras.nowIso ?? new Date().toISOString();
  const cited = citedCompetitorCount(p);
  if (cited === 0) return null; // no competitor-citation evidence → abstain

  // Evidence relevance gate: only NAME the cited domain when it's actually on-topic for
  // the Move (not a facebook.com/TasteAtlas eggplant page on "Safavid Flag"). An
  // off-topic/noise citation still counts as "a competitor cited" but is never named.
  const compRelevant =
    !!p.competitor.topUrl &&
    competitorRelevance(p.move.label, { url: p.competitor.topUrl, title: p.competitor.domain }).relevant;
  const onTopic = !p.competitor.looselyMatched && compRelevant;
  const domain = compRelevant ? p.competitor.domain : null;
  const isCreate = p.move.gapType === "create_page";
  const claim = isCreate
    ? `AI cites ${cited} competitor ${cited === 1 ? "page" : "pages"}${domain ? ` (like ${domain})` : ""} for this topic and you have no page at all.`
    : domain
      ? `AI cites ${domain}, not you - you rank but aren't the cited source.`
      : `AI cites ${cited} competitor ${cited === 1 ? "page" : "pages"} for this topic, never you. You rank on Google but AI answers skip you.`;

  const refs: EvidenceRef[] = [
    {
      specialist: "profound",
      source: "profound_citation_rows",
      key: p.move.key,
      detail: `competitors cited=${cited}; own_cited=no; relevance=${p.competitor.relevance.toFixed(2)}`,
    },
  ];
  const objections: Objection[] = [];
  if (!onTopic) {
    objections.push({
      kind: "off_topic_competitor",
      against: [],
      severity: "downgrade",
      detail: "The AI-cited page is loosely matched to the query - confirm the real winner before committing.",
      evidenceRefs: refs,
    });
  }

  return {
    specialist: "profound",
    claim,
    evidenceRefs: refs,
    confidence: onTopic ? 0.7 : 0.4,
    suggestedMoveTypes: isCreate ? ["create_page"] : ["add_answer_block", "add_schema"],
    objections,
    scoreContribution: { visibilityGapDelta: p.move.components.visibilityGap },
    staleAt: staleAtFor("profound", nowIso),
  };
}

/** DataForSEO - live-SERP ground truth. Abstains until a verdict is prepared
 *  (no broad paid runs in Sprint 1, so this is usually silent on existing-page
 *  Moves - honest). When a verdict exists it gatekeeps create_page. */
export function emitDataforseoOpinion(p: EvidencePacket, extras: SpecialistExtras = {}): SpecialistOpinion | null {
  const nowIso = extras.nowIso ?? new Date().toISOString();
  const v = extras.serpVerdict;
  if (!v) return null; // no live SERP yet → abstain

  const ref: EvidenceRef = {
    specialist: "dataforseo",
    source: "dataforseo_serp_cache",
    key: p.move.key,
    detail: `verdict=${v.verdict} content=${v.contentDomainCount}/10 marketplace=${v.marketplaceUgcCount} overlap=${v.profoundOverlapCount} ownRanks=${v.ownAlreadyRanks}`,
  };
  const objections: Objection[] = [];
  const suggested: MoveRouterAction[] = [];
  const contribution: ScoreContribution = {};

  if (v.ownAlreadyRanks) {
    objections.push({
      kind: "already_ranks",
      against: ["create_page"],
      severity: "veto",
      detail: "You already rank in the top 10 - this is an EDIT, not a new page.",
      evidenceRefs: [ref],
    });
    suggested.push("edit_existing_page");
  } else if (v.intent === "marketplace_ugc") {
    objections.push({
      kind: "cant_outrank_serp",
      against: ["create_page"],
      severity: "veto",
      detail: `SERP is marketplace/UGC-dominated (${v.marketplaceUgcCount}/10) - a content page can't win it.`,
      evidenceRefs: [ref],
    });
  } else if (v.verdict === "build") {
    suggested.push("create_page");
    if (v.profoundOverlapCount > 0) contribution.scoreMultiplier = 1.3; // Google + AI double-confirmed
  }

  const confidence = v.confidence === "high" ? 0.9 : v.confidence === "medium" ? 0.7 : 0.4;
  return {
    specialist: "dataforseo",
    claim: v.reasons[0] ?? `Live SERP verdict: ${v.verdict}.`,
    evidenceRefs: [ref],
    confidence,
    suggestedMoveTypes: suggested,
    objections,
    scoreContribution: contribution,
    staleAt: staleAtFor("dataforseo", nowIso),
  };
}

/** Wix/CMS - feasibility. Abstains unless the loader threads pushability. Never
 *  vetoes (a non-pushable Move is still valid as a paste-ready directive). */
export function emitWixOpinion(p: EvidencePacket, extras: SpecialistExtras = {}): SpecialistOpinion | null {
  const nowIso = extras.nowIso ?? new Date().toISOString();
  if (extras.pushable === undefined) return null; // CMS mapping unknown → abstain

  const ref: EvidenceRef = {
    specialist: "wix",
    source: "wix_url_map",
    key: p.yourPage.url ?? p.move.key,
    detail: `pushable=${extras.pushable}`,
  };
  if (extras.pushable) {
    return {
      specialist: "wix",
      claim: "This change is field-publishable on your CMS - one-click ship when approved.",
      evidenceRefs: [ref],
      confidence: 1,
      suggestedMoveTypes: [],
      objections: [],
      scoreContribution: {},
      staleAt: staleAtFor("wix", nowIso),
    };
  }
  return {
    specialist: "wix",
    claim: "This isn't field-publishable on your CMS - prepare it as a paste-ready directive for manual apply.",
    evidenceRefs: [ref],
    confidence: 1,
    suggestedMoveTypes: [],
    objections: [
      {
        kind: "not_pushable",
        against: [],
        severity: "downgrade",
        detail: "Not field-publishable on this CMS - higher operator effort to ship.",
        evidenceRefs: [ref],
      },
    ],
    scoreContribution: { scoreMultiplier: 0.9 },
    staleAt: staleAtFor("wix", nowIso),
  };
}

/** LLM strategist - synthesis only; must cite other specialists and never invent
 *  numbers. In deterministic mode (Sprint 1, no LLM in the product) it ABSTAINS;
 *  the structured strategist arrives with P4. */
export function emitLlmOpinion(_p: EvidencePacket, _extras: SpecialistExtras = {}): SpecialistOpinion | null {
  return null;
}

/** Opportunity / Asset / Commerce Strategist - decides what an opportunity should
 *  BECOME. Sprint 1 emits only the deterministic tool/asset seed (the packet found
 *  a competitor tool you lack); full dynamic routing (article vs product vs
 *  collection vs sales-artifact) is P8. */
export function emitCommerceAssetOpinion(p: EvidencePacket, extras: SpecialistExtras = {}): SpecialistOpinion | null {
  const nowIso = extras.nowIso ?? new Date().toISOString();
  const toolGap = p.gaps.some((g) => g.kind === "missing_tool") || p.draft.asset != null;
  if (!toolGap) return null; // no asset-shaped opportunity detected → abstain

  const kindLabel = p.draft.asset?.kind ?? "interactive tool";
  return {
    specialist: "commerce_asset",
    claim: `Better served as a ${kindLabel} than an article - a competitor offers one and it earns links + citations.`,
    evidenceRefs: [
      {
        specialist: "commerce_asset",
        source: "competitor_teardown",
        key: p.move.key,
        detail: p.draft.assetSpec ?? "competitor has an interactive tool/calculator you lack",
      },
    ],
    confidence: 0.6,
    suggestedMoveTypes: ["build_tool", "create_asset"],
    objections: [],
    scoreContribution: {},
    staleAt: staleAtFor("commerce_asset", nowIso),
  };
}

/** Run the whole team over one Move's packet → the opinions that have evidence
 *  (abstentions dropped). The order is the pipeline order (demand → money → UX →
 *  AEO → SERP → CMS → strategist → asset). */
export function attachOpinions(p: EvidencePacket, extras: SpecialistExtras = {}): SpecialistOpinion[] {
  // Pin ONE timestamp for the whole team so every opinion's staleAt is consistent.
  const ctx: SpecialistExtras = { ...extras, nowIso: extras.nowIso ?? new Date().toISOString() };
  return [
    emitGscOpinion(p, ctx),
    emitGa4Opinion(p, ctx),
    emitClarityOpinion(p, ctx),
    emitProfoundOpinion(p, ctx),
    emitDataforseoOpinion(p, ctx),
    emitWixOpinion(p, ctx),
    emitLlmOpinion(p, ctx),
    emitCommerceAssetOpinion(p, ctx),
  ].filter((o): o is SpecialistOpinion => o != null);
}
