/**
 * Page Surgeon — page-level ATOMIC ACTION decision (W1a LLM-judge target).
 *
 * The judge is a 10x SEO/AEO operator over the evidence packet: it decides the
 * single highest-leverage atomic change for a page (title is only ONE option),
 * surfaces the non-obvious pattern, and never invents a metric. This module
 * holds the decision contract, the DETERMINISTIC fallback (also the safety
 * baseline), and the DETERMINISTIC GATE that sets confidence/publishability —
 * the LLM may propose, but it can never set publishability or claim impact a
 * source can't back.
 *
 * Pure. No I/O.
 */

import type {
  AtomicChangeType,
  EvidenceConfidence,
  EvidencePacket,
  Publishability,
} from "./contract";
import { evaluateTitle } from "./evaluate-title";
import type { BrandConfig } from "./title-candidates";

export type AtomicAction = AtomicChangeType | "keep_current" | "needs_more_evidence";

export type RejectedAlternative = { action: string; reason: string };
export type EvidenceBySource = {
  gsc?: string;
  ga4?: string;
  clarity?: string;
  semrush?: string;
  profound?: string;
  crawl?: string;
};

export type PageAtomicDecision = {
  pageUrl: string;
  recommended_atomic_action: AtomicAction;
  /** Only non-null when recommended_atomic_action === "title". */
  title_candidate: string | null;
  rejected_alternatives: RejectedAlternative[];
  evidence_by_source: EvidenceBySource;
  hypothesis: string;
  risk: string;
  before_after_diff: { before: string | null; after: string | null };
  measurement_plan: string;
  rollback_plan: string;
  confidence: EvidenceConfidence;
  /** The non-obvious pattern the operator would have missed. */
  operator_insight: string;
  /** SET BY THE GATE, never the LLM. Judge max is "staged" (never publishable). */
  publishability: Publishability;
  decided_by: "llm_judge" | "deterministic_fallback";
};

/** Which evidence source each action REQUIRES to be substantiated. An action
 *  whose required source is absent is downgraded to needs_more_evidence. */
const ACTION_REQUIRED_SOURCE: Partial<Record<AtomicChangeType, keyof EvidenceBySource>> = {
  ux_cta_fix: "clarity",
  // AEO/answer actions can be PROPOSED from GSC, but any AI-citation CLAIM needs
  // Profound — enforced separately (claim-capping), not a hard block here.
};

const CONF_RANK: Record<EvidenceConfidence, number> = {
  needs_more_evidence: 0,
  low: 1,
  medium: 2,
  high: 3,
};
function minConf(a: EvidenceConfidence, b: EvidenceConfidence): EvidenceConfidence {
  return CONF_RANK[a] <= CONF_RANK[b] ? a : b;
}

/** Actions that publish through a mapped CMS field (eligible for "staged"). */
const CMS_FIELD_ACTIONS = new Set<AtomicChangeType>(["title", "meta", "h1", "schema", "image_alt"]);
/** AEO-type actions whose AI-citation impact requires Profound to claim. */
const AEO_ACTIONS = new Set<AtomicChangeType>(["intro_answer_block", "faq", "citation_source"]);

function summarizeEvidence(packet: EvidencePacket): EvidenceBySource {
  const out: EvidenceBySource = {};
  if (packet.gsc) {
    const g = packet.gsc;
    out.gsc = `${g.impressions} impr · ${g.clicks} clicks · ${(g.ctr * 100).toFixed(2)}% CTR · pos ${g.avgPosition.toFixed(1)} · top "${g.topQueries[0]?.query ?? ""}"`;
  }
  if (packet.ga4)
    out.ga4 = `${packet.ga4.sessions} sessions · engagementRate ${packet.ga4.engagementRate ?? "—"}`;
  if (packet.clarity)
    out.clarity = `scrollDepth ${packet.clarity.scrollDepthMedian ?? "—"} · dead ${packet.clarity.deadClicks ?? "—"} · rage ${packet.clarity.rageClicks ?? "—"}`;
  if (packet.semrush?.keywords?.length)
    out.semrush = `${packet.semrush.keywords.length} ranked keywords`;
  if (packet.profound) out.profound = `aiVisibility ${packet.profound.aiVisibility ?? "—"}`;
  if (packet.crawl)
    out.crawl = `h1 "${packet.crawl.h1 ?? ""}" · ${packet.crawl.wordCount ?? "?"} words · ${packet.crawl.h2List.length} sections`;
  return out;
}

/**
 * Deterministic page decision = the safety baseline + LLM fallback. It runs the
 * deterministic TITLE evaluator and wraps it as a page-level atomic decision
 * (title or keep_current / needs_more_evidence). It NEVER proposes a non-title
 * action — that creativity is the LLM's job; without the LLM we stay
 * conservative (title-only or keep).
 */
export function deterministicPageDecision(
  packet: EvidencePacket,
  brand: BrandConfig,
): PageAtomicDecision {
  const t = evaluateTitle({ packet, brand });
  const action: AtomicAction =
    t.confidence === "needs_more_evidence"
      ? "needs_more_evidence"
      : t.keepCurrent
        ? "keep_current"
        : "title";
  const gsc = packet.gsc;
  const insight =
    gsc && gsc.ctrGap != null && gsc.ctrGap > 0
      ? `Ranks pos ${gsc.avgPosition.toFixed(1)} for "${gsc.topQueries[0]?.query ?? ""}" but earns ${(gsc.ctr * 100).toFixed(2)}% CTR vs ~${(((gsc.expectedCtrForPosition ?? 0) * 100)).toFixed(1)}% typical — the bottleneck is the snippet, not the ranking.`
      : `No standout cross-source pattern from the evidence available.`;
  return applyDeterministicGate(
    {
      pageUrl: packet.current.pageUrl,
      recommended_atomic_action: action,
      title_candidate: action === "title" ? t.recommendedText : null,
      rejected_alternatives: t.rejectedCandidates.map((r) => ({
        action: "title:" + (r.title ?? "keep"),
        reason: r.reason,
      })),
      evidence_by_source: summarizeEvidence(packet),
      hypothesis: t.hypothesis,
      risk: t.risks.join(" "),
      before_after_diff: t.beforeAfterDiff,
      measurement_plan: t.measurementPlan,
      rollback_plan: t.rollbackPlan,
      confidence: t.confidence,
      operator_insight: insight,
      publishability: "review_only",
      decided_by: "deterministic_fallback",
    },
    packet,
  );
}

/**
 * The DETERMINISTIC GATE. Runs on EVERY decision (LLM or fallback) and is the
 * sole authority on confidence-capping + publishability. It:
 *  - downgrades an action to needs_more_evidence when its required source is
 *    absent (can't substantiate);
 *  - caps confidence for AEO-type actions when Profound is absent (no
 *    AI-citation claim without AI evidence) and annotates the risk;
 *  - sets publishability (judge max = "staged"; never auto-publishable);
 *  - forces keep_current / null title when confidence is needs_more_evidence.
 */
export function applyDeterministicGate(
  decision: PageAtomicDecision,
  packet: EvidencePacket,
): PageAtomicDecision {
  let action = decision.recommended_atomic_action;
  let confidence = decision.confidence;
  let risk = decision.risk;
  const evid = decision.evidence_by_source;

  // 1. Required-source check: an action we can't substantiate becomes
  //    needs_more_evidence.
  if (action !== "keep_current" && action !== "needs_more_evidence") {
    const req = ACTION_REQUIRED_SOURCE[action as AtomicChangeType];
    if (req && evid[req] == null) {
      action = "needs_more_evidence";
      confidence = "needs_more_evidence";
      risk = `${risk} Downgraded: "${decision.recommended_atomic_action}" needs ${req} data, which isn't connected/populated.`.trim();
    }
  }

  // 2. AEO claim-capping: AEO actions may be proposed from GSC, but their
  //    AI-citation impact can't be CLAIMED without Profound.
  if (
    action !== "keep_current" &&
    action !== "needs_more_evidence" &&
    AEO_ACTIONS.has(action as AtomicChangeType) &&
    evid.profound == null
  ) {
    confidence = minConf(confidence, "low");
    risk = `${risk} AI-citation impact is unverified until Profound is connected.`.trim();
  }

  // 3. Thin evidence ⇒ keep current. No demand data at all ⇒ cannot decide.
  if (packet.gsc == null) {
    action = "needs_more_evidence";
    confidence = "needs_more_evidence";
  }
  if (confidence === "needs_more_evidence" && action !== "needs_more_evidence") {
    action = "keep_current";
  }

  // 4. Publishability (LLM can NEVER set this). Judge max is "staged".
  let publishability: Publishability = "review_only";
  const isChange = action !== "keep_current" && action !== "needs_more_evidence";
  if (
    isChange &&
    CMS_FIELD_ACTIONS.has(action as AtomicChangeType) &&
    packet.current.cmsFieldMapped &&
    (confidence === "high" || confidence === "medium")
  ) {
    publishability = "staged";
  }

  const titleCandidate = action === "title" ? decision.title_candidate : null;

  return {
    ...decision,
    recommended_atomic_action: action,
    title_candidate: titleCandidate,
    confidence,
    risk,
    publishability,
  };
}
