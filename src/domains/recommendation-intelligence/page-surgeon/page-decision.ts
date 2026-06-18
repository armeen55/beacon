/**
 * Page Surgeon — page-level decision (W1a upgrade: MULTI-change battle plan).
 *
 * A page can need several atomic changes; exactly one is PRIMARY, the rest are
 * supporting (with dependency order), plus rejected changes with reasons. Every
 * brief carries SOURCE COVERAGE (what evidence was actually used vs connected-
 * but-empty vs absent) so a "connected but no rows pulled" source is never
 * silently ignored. The deterministic fallback is NON-CONTRADICTORY: it never
 * says "keep the title" while claiming a snippet bottleneck + a CTR lift +
 * a rollback. When it detects a bottleneck it can't safely action, it returns
 * `needs_llm_review`. Deterministic gate is the sole authority on
 * confidence/publishability; the LLM proposes, never publishes.
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

export type AtomicAction =
  | AtomicChangeType
  | "keep_current"
  | "needs_more_evidence"
  | "needs_llm_review";

export type AtomicChange = {
  action: AtomicChangeType;
  /** Exactly what to do (e.g. the proposed title text, or "add a FAQ answering …"). */
  exact_change: string;
  evidence: string;
  hypothesis: string;
  risk: string;
  before_after: { before: string | null; after: string | null };
  measurement: string;
  rollback: string;
  /** SET BY THE GATE. Judge max = "staged"; never auto-publishable. */
  publishability: Publishability;
  /** 1 = do first. Supporting changes may depend on the primary. */
  dependency_order: number;
};

export type SourceName = "gsc" | "ga4" | "clarity" | "semrush" | "profound" | "crawl";
export type SourceCoverage = {
  source: SourceName;
  used: boolean;
  /** Human detail: rows/date/metrics, or "connected but no rows pulled", or "not connected". */
  detail: string;
};

/** Out-of-the-box wording variant the judge researched + where it belongs. */
export type WordingResearch = {
  variant: string;
  evidence: string;
  best_placement: string; // title | meta | h1 | faq | section | none
};

export type PageAtomicDecision = {
  pageUrl: string;
  /** Headline action = primary.action, or keep_current / needs_more_evidence / needs_llm_review. */
  recommended_atomic_action: AtomicAction;
  primary_atomic_change: AtomicChange | null;
  supporting_atomic_changes: AtomicChange[];
  rejected_changes: Array<{ action: string; reason: string }>;
  source_coverage: SourceCoverage[];
  wording_research: WordingResearch[];
  confidence: EvidenceConfidence;
  operator_insight: string;
  what_normal_seo_misses: string;
  why_not_just_title: string;
  evidence_gaps: string[];
  decided_by: "llm_judge" | "deterministic_fallback";
};

const ACTION_REQUIRED_SOURCE: Partial<Record<AtomicChangeType, SourceName>> = {
  ux_cta_fix: "clarity",
};
const CMS_FIELD_ACTIONS = new Set<AtomicChangeType>(["title", "meta", "h1", "schema", "image_alt"]);
const AEO_ACTIONS = new Set<AtomicChangeType>(["intro_answer_block", "faq", "citation_source"]);
const CONF_RANK: Record<EvidenceConfidence, number> = { needs_more_evidence: 0, low: 1, medium: 2, high: 3 };
const minConf = (a: EvidenceConfidence, b: EvidenceConfidence): EvidenceConfidence =>
  CONF_RANK[a] <= CONF_RANK[b] ? a : b;

/** Bump when the decision shape changes so old cached briefs re-run. */
export const DECISION_SCHEMA_VERSION = "v2-multichange";

export function buildSourceCoverage(packet: EvidencePacket): SourceCoverage[] {
  const present = new Set(packet.sourcesPresent);
  const empty = new Set(packet.sourcesConnectedButEmpty);
  const detail = (s: SourceName): SourceCoverage => {
    if (present.has(s)) {
      let d = "used";
      if (s === "gsc" && packet.gsc)
        d = `${packet.gsc.impressions.toLocaleString()} impr · ${packet.gsc.clicks} clicks · ${packet.gsc.topQueries.length} queries`;
      else if (s === "crawl" && packet.crawl)
        d = `title/${packet.crawl.h1 ? "h1" : "no-h1"}/${packet.crawl.metaDescription ? "meta" : "NO-meta"} · ${packet.crawl.h2List.length} sections · ${packet.crawl.schemaTypes.length} schema`;
      else if (s === "clarity" && packet.clarity)
        d = `dead ${packet.clarity.deadClicks ?? "—"} · rage ${packet.clarity.rageClicks ?? "—"}`;
      else if (s === "ga4" && packet.ga4) d = `${packet.ga4.sessions} sessions`;
      else if (s === "semrush" && packet.semrush) {
        const parts = [`${packet.semrush.keywords.length} keywords`];
        if (packet.semrush.relatedKeywords?.length) parts.push(`${packet.semrush.relatedKeywords.length} related`);
        if (packet.semrush.questionKeywords?.length) parts.push(`${packet.semrush.questionKeywords.length} questions`);
        if (packet.semrush.competitorDomains?.length) parts.push(`${packet.semrush.competitorDomains.length} competitors`);
        d = parts.join(" · ");
      }
      return { source: s, used: true, detail: d };
    }
    if (empty.has(s))
      return { source: s, used: false, detail: s === "profound" ? "not connected" : "connected but no rows pulled" };
    return { source: s, used: false, detail: "not connected" };
  };
  return (["gsc", "crawl", "clarity", "ga4", "semrush", "profound"] as SourceName[]).map(detail);
}

/** True when GSC shows real demand the page is under-converting (a bottleneck
 *  exists somewhere), regardless of whether the TITLE is the lever. */
function hasUnderperformanceBottleneck(packet: EvidencePacket): boolean {
  const g = packet.gsc;
  if (!g) return false;
  const gap = g.ctrGap ?? 0;
  return g.impressions >= 500 && gap >= 0.02;
}

export function deterministicPageDecision(
  packet: EvidencePacket,
  brand: BrandConfig,
): PageAtomicDecision {
  const t = evaluateTitle({ packet, brand });
  const coverage = buildSourceCoverage(packet);
  const gaps = coverage.filter((c) => !c.used).map((c) => `${c.source}: ${c.detail}`);
  const base = {
    pageUrl: packet.current.pageUrl,
    source_coverage: coverage,
    wording_research: [] as WordingResearch[],
    evidence_gaps: gaps,
    decided_by: "deterministic_fallback" as const,
    supporting_atomic_changes: [] as AtomicChange[],
  };

  // No demand data → can't decide.
  if (packet.gsc == null) {
    return {
      ...base,
      recommended_atomic_action: "needs_more_evidence",
      primary_atomic_change: null,
      rejected_changes: [],
      confidence: "needs_more_evidence",
      operator_insight: "No Google Search Console demand for this page yet — connect/refresh GSC to ground a decision.",
      what_normal_seo_misses: "",
      why_not_just_title: "",
    };
  }

  const bottleneck = hasUnderperformanceBottleneck(packet);
  const topQuery = packet.gsc.topQueries[0]?.query ?? "";

  // A real title change the deterministic evaluator is confident in.
  if (!t.keepCurrent && t.recommendedText) {
    const change: AtomicChange = {
      action: "title",
      exact_change: t.recommendedText,
      evidence: `Top query "${topQuery}" · ${packet.gsc.impressions} impr · ${(packet.gsc.ctr * 100).toFixed(2)}% CTR at pos ${packet.gsc.avgPosition.toFixed(1)}.`,
      hypothesis: t.hypothesis,
      risk: t.risks.join(" "),
      before_after: t.beforeAfterDiff,
      measurement: t.measurementPlan,
      rollback: t.rollbackPlan,
      publishability: "review_only",
      dependency_order: 1,
    };
    return applyDeterministicGate(
      {
        ...base,
        recommended_atomic_action: "title",
        primary_atomic_change: change,
        rejected_changes: t.rejectedCandidates.map((r) => ({ action: "title:" + (r.title ?? "keep"), reason: r.reason })),
        confidence: t.confidence,
        operator_insight: `Top query "${topQuery}" isn't well-served by the current title; aligning it should lift CTR at the current rank.`,
        what_normal_seo_misses: "",
        why_not_just_title: "The title is genuinely the lever here (the searched term is missing from it).",
      },
      packet,
    );
  }

  // keep_current path — but split honestly:
  if (bottleneck) {
    // The page underperforms (low CTR despite rank) yet the TITLE already serves
    // the query → the lever is likely the meta/snippet or an answer block, which
    // the deterministic layer can't safely choose. NO contradictory claims.
    return {
      ...base,
      recommended_atomic_action: "needs_llm_review",
      primary_atomic_change: null,
      rejected_changes: [
        { action: "title", reason: "Current title already contains the top query — re-titling risks dropping terms without CTR upside." },
      ],
      confidence: "needs_more_evidence",
      operator_insight: `Ranks pos ${packet.gsc.avgPosition.toFixed(1)} for "${topQuery}" with ${packet.gsc.impressions.toLocaleString()} impressions but only ${(packet.gsc.ctr * 100).toFixed(2)}% CTR — there is a snippet/answer bottleneck, but the title is not it.`,
      what_normal_seo_misses: "A normal SEO would rewrite the title; the title already matches the query — the meta description or an answer block is the likely lever.",
      why_not_just_title: "Re-titling a title that already contains the searched term usually loses descriptive terms for no CTR gain.",
    };
  }

  // Clean keep — no bottleneck, no contradictory measurement.
  return {
    ...base,
    recommended_atomic_action: "keep_current",
    primary_atomic_change: null,
    rejected_changes: t.rejectedCandidates.map((r) => ({ action: "title:" + (r.title ?? "keep"), reason: r.reason })),
    confidence: t.confidence === "needs_more_evidence" ? "needs_more_evidence" : "medium",
    operator_insight: `The current title already serves "${topQuery}" and the page isn't visibly under-converting — no change needed now.`,
    what_normal_seo_misses: "",
    why_not_just_title: "",
    // consistent measurement: monitoring, not a change.
  };
}

/** Gate one atomic change (publishability + required-source/AEO checks). Returns
 *  the gated change, or null when the change can't be substantiated. */
function gateChange(
  change: AtomicChange,
  packet: EvidencePacket,
): { change: AtomicChange | null; confCap: EvidenceConfidence | null; note: string | null } {
  const present = new Set(packet.sourcesPresent);
  const req = ACTION_REQUIRED_SOURCE[change.action];
  if (req && !present.has(req)) {
    return { change: null, confCap: "needs_more_evidence", note: `Dropped ${change.action}: needs ${req} data (not connected/populated).` };
  }
  let confCap: EvidenceConfidence | null = null;
  let risk = change.risk;
  if (AEO_ACTIONS.has(change.action) && !present.has("profound")) {
    confCap = "low";
    risk = `${risk} AI-citation impact unverified until Profound is connected.`.trim();
  }
  let publishability: Publishability = "review_only";
  if (
    CMS_FIELD_ACTIONS.has(change.action) &&
    packet.current.cmsFieldMapped
  ) {
    publishability = "staged"; // final confidence cap applied by caller
  }
  return { change: { ...change, risk, publishability }, confCap, note: null };
}

export function applyDeterministicGate(
  decision: PageAtomicDecision,
  packet: EvidencePacket,
): PageAtomicDecision {
  if (packet.gsc == null) {
    return {
      ...decision,
      recommended_atomic_action: "needs_more_evidence",
      primary_atomic_change: null,
      supporting_atomic_changes: [],
      confidence: "needs_more_evidence",
    };
  }

  let confidence = decision.confidence;
  const extraRejected: Array<{ action: string; reason: string }> = [];

  // Gate primary.
  let primary = decision.primary_atomic_change;
  if (primary) {
    const g = gateChange(primary, packet);
    if (g.change == null) {
      if (g.note) extraRejected.push({ action: primary.action, reason: g.note });
      primary = null;
    } else {
      primary = g.change;
      if (g.confCap) confidence = minConf(confidence, g.confCap);
    }
  }

  // Gate supporting.
  const supporting: AtomicChange[] = [];
  for (const s of decision.supporting_atomic_changes) {
    const g = gateChange(s, packet);
    if (g.change == null) {
      if (g.note) extraRejected.push({ action: s.action, reason: g.note });
      continue;
    }
    if (g.confCap) confidence = minConf(confidence, g.confCap);
    supporting.push(g.change);
  }

  // If the primary fell out, promote the first supporting; else needs_llm_review.
  let action = decision.recommended_atomic_action;
  if (decision.recommended_atomic_action !== "keep_current" &&
      decision.recommended_atomic_action !== "needs_more_evidence" &&
      decision.recommended_atomic_action !== "needs_llm_review") {
    if (primary == null && supporting.length > 0) {
      primary = { ...supporting.shift()!, dependency_order: 1 };
      action = primary.action;
    } else if (primary == null) {
      action = "needs_llm_review";
    } else {
      action = primary.action;
    }
  }

  // Apply the final confidence cap to each change's publishability (staged needs
  // medium+; otherwise review_only).
  const capPublish = (c: AtomicChange): AtomicChange =>
    c.publishability === "staged" && CONF_RANK[confidence] < CONF_RANK.medium
      ? { ...c, publishability: "review_only" }
      : c;

  return {
    ...decision,
    recommended_atomic_action: action,
    primary_atomic_change: primary ? capPublish(primary) : null,
    supporting_atomic_changes: supporting.map(capPublish),
    rejected_changes: [...decision.rejected_changes, ...extraRejected],
    confidence,
  };
}
