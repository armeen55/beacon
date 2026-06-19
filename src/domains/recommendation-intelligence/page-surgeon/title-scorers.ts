/**
 * Page Surgeon — deterministic TITLE scorers + reviewable weights (W1a).
 *
 * Each dimension is a PURE function (candidate, packet, brand) → DimensionScore.
 * When the source for a dimension is absent it returns `available:false` (the
 * dimension is dropped from the aggregate, never guessed). Weights live in a
 * single reviewable config object — NO inline magic constants, NO "always X"
 * rule. The aggregate is a weighted mean over AVAILABLE dimensions, then hard
 * vetoes apply. Selection is therefore a candidate COMPARISON, per page, from
 * evidence — exactly the governing spec.
 */

import type {
  CandidateOption,
  CandidateScore,
  DimensionScore,
  EvidencePacket,
  ScoreDimension,
} from "./contract";
import { clamp01, tokenCoverage, tokenSet } from "./contract";
import type { BrandConfig } from "./title-candidates";

/** Per-changeType weights. Reviewable + overridable; never inline magic. */
export const TITLE_WEIGHTS: Record<ScoreDimension, number> = {
  query_intent_fit: 1.0,
  snippet_promise_improvement: 1.0,
  ctr_or_ranking_upside: 0.9,
  already_satisfies_query: 0.8,
  page_topic_fit: 0.8,
  lost_term_risk: 0.9,
  google_title_rewrite_risk: 0.6,
  business_value: 0.6,
  brand_trust_fit: 0.7,
  measurement_clarity: 0.3,
  implementation_risk: 0.3,
  semrush_market_opportunity: 0.5,
  aeo_serp_feature_fit: 0.5,
  conversion_engagement_value: 0.7,
  ux_friction_impact: 0.1,
};

const IDEAL_MIN = 30;
const IDEAL_MAX = 60;
const TRUNCATE_HARD = 65;

const D = (
  dimension: ScoreDimension,
  score: number,
  evidenceUsed: string[],
  available = true,
): DimensionScore => ({ dimension, score: clamp01(score), evidenceUsed, available });

function candidateText(c: CandidateOption, currentTitle: string | null): string | null {
  // keep_current is evaluated as the CURRENT title; create_new_page has no title.
  if (c.strategy === "keep_current") return currentTitle;
  if (c.strategy === "create_new_page") return null;
  return c.proposedText;
}

/** Intent-bearing terms (non-trivial tokens) in a title. */
function intentTermSet(title: string | null): Set<string> {
  return tokenSet(title);
}

export function scoreTitleCandidate(
  c: CandidateOption,
  packet: EvidencePacket,
  brand: BrandConfig,
): CandidateScore {
  const current = packet.current.currentText?.trim() || null;
  const text = candidateText(c, current);
  const gsc = packet.gsc;
  const topQuery = gsc?.topQueries?.[0]?.query ?? "";
  const dims: DimensionScore[] = [];
  const vetoes: string[] = [];

  // — query_intent_fit: does this candidate cover the top search term?
  if (gsc && topQuery) {
    dims.push(
      D("query_intent_fit", tokenCoverage(text, topQuery), ["gsc.topQueries"]),
    );
  } else {
    dims.push(D("query_intent_fit", 0, [], false));
  }

  // — already_satisfies_query: does the CURRENT title already cover the query?
  //   (Boosts keep_current; penalizes needless rewrites.)
  if (gsc && topQuery) {
    const curCov = tokenCoverage(current, topQuery);
    // For keep_current this rewards leaving a satisfying title alone; for a
    // change candidate it DISCOUNTS the change when current already satisfies.
    const score = c.strategy === "keep_current" ? curCov : 1 - curCov;
    dims.push(D("already_satisfies_query", score, ["gsc.topQueries", "current"]));
  } else {
    dims.push(D("already_satisfies_query", 0, [], false));
  }

  // — snippet_promise_improvement: does this candidate ADD query coverage the
  //   current title lacks? Δ coverage, only meaningful for change candidates.
  if (gsc && topQuery) {
    const curCov = tokenCoverage(current, topQuery);
    const newCov = tokenCoverage(text, topQuery);
    const improvement = c.strategy === "keep_current" ? 0 : clamp01(newCov - curCov);
    dims.push(D("snippet_promise_improvement", improvement, ["gsc.topQueries", "current"]));
  } else {
    dims.push(D("snippet_promise_improvement", 0, [], false));
  }

  // — ctr_or_ranking_upside: a title change has upside when the page has real
  //   impressions, a CTR gap, and a mid-rank position (4–20). keep_current has
  //   no upside FROM a change.
  if (gsc) {
    if (c.strategy === "keep_current") {
      dims.push(D("ctr_or_ranking_upside", 0.1, ["gsc"]));
    } else {
      const gap = gsc.ctrGap ?? 0;
      const gapScore = clamp01(gap / 0.05); // a 5pt CTR gap ≈ full upside
      const pos = gsc.avgPosition;
      const posScore = pos >= 4 && pos <= 20 ? 1 : pos < 4 ? 0.5 : 0.3;
      const imprScore = clamp01(gsc.impressions / 1000);
      dims.push(
        D(
          "ctr_or_ranking_upside",
          clamp01(0.5 * gapScore + 0.3 * posScore + 0.2 * imprScore),
          ["gsc.ctrGap", "gsc.avgPosition", "gsc.impressions"],
        ),
      );
    }
  } else {
    dims.push(D("ctr_or_ranking_upside", 0, [], false));
  }

  // — page_topic_fit: does the candidate stay on the page's actual topic
  //   (h1 / crawl)? Low fit on a re-title is a signal the query may want a NEW
  //   page instead. create_new_page scores HIGH here when the query is OFF the
  //   page topic (i.e. low candidate-vs-topic fit for the re-title path).
  const topic = packet.crawl?.h1 ?? packet.crawl?.title ?? null;
  if (topic) {
    if (c.strategy === "create_new_page") {
      // new page is a good idea precisely when the query is far from the topic
      const queryTopicFit = tokenCoverage(topic, topQuery);
      dims.push(D("page_topic_fit", 1 - queryTopicFit, ["crawl.h1", "gsc.topQueries"]));
    } else {
      dims.push(D("page_topic_fit", tokenCoverage(text, topic) || 0.5, ["crawl.h1"]));
    }
  } else {
    dims.push(D("page_topic_fit", 0, [], false));
  }

  // — lost_term_risk: penalize dropping intent-bearing words the current title
  //   had — but ONLY real terms, not the tenant's own boilerplate/chrome
  //   (evidence-derived, not a hardcoded list). 1 = lost nothing of value.
  {
    const boilerplate = new Set((packet.boilerplateTerms ?? []).map((t) => t.toLowerCase()));
    const isReal = (t: string) => {
      const n = t.toLowerCase().replace(/[^a-z0-9]/g, "");
      return n.length > 0 && !boilerplate.has(n);
    };
    const curReal = Array.from(intentTermSet(current)).filter((t) => !boilerplate.has(t));
    const realLost = c.removedTerms.filter(isReal);
    const score = curReal.length === 0 ? 1 : clamp01(1 - realLost.length / curReal.length);
    dims.push(D("lost_term_risk", score, ["current", "candidate.removedTerms"]));
    // Hard veto: a change that drops MORE than half the REAL intent terms is a
    // net loss of meaning, regardless of other gains.
    if (c.strategy !== "keep_current" && curReal.length >= 2 && realLost.length / curReal.length > 0.5) {
      vetoes.push("excessive_term_loss");
    }
  }

  // — google_title_rewrite_risk: Google tends to rewrite a title that diverges
  //   hard from a title already matching the query. Higher when current already
  //   satisfies AND the candidate changes a lot. 1 = low risk.
  if (gsc && topQuery) {
    if (c.strategy === "keep_current") {
      dims.push(D("google_title_rewrite_risk", 1, ["gsc"]));
    } else {
      const curCov = tokenCoverage(current, topQuery);
      const churn = c.removedTerms.length + (c.proposedText ? 1 : 0);
      const risk = clamp01(curCov * clamp01(churn / 4));
      dims.push(D("google_title_rewrite_risk", 1 - risk, ["gsc.topQueries", "current"]));
    }
  } else {
    dims.push(D("google_title_rewrite_risk", 0, [], false));
  }

  // — business_value: proxy by the page's real GSC impressions (a high-demand
  //   page is worth more). GA4 revenue would refine this when present.
  if (gsc) {
    dims.push(D("business_value", clamp01(gsc.impressions / 5000), ["gsc.impressions"]));
  } else {
    dims.push(D("business_value", 0, [], false));
  }

  // — brand_trust_fit: a TRADEOFF, not a preference. Brand suffix adds trust
  //   but costs characters. Score include-brand higher only when there's length
  //   headroom; score omit-brand higher when characters are scarce. Neutral
  //   (keep/new-page) → mid. Text-only ⇒ available when a brand is configured.
  if (brand) {
    const len = (text ?? "").length;
    const headroom = IDEAL_MAX - len; // positive ⇒ room for a brand suffix
    let score = 0.5;
    if (c.brandSuffixDecision === "include") score = headroom >= 0 ? 0.85 : 0.1;
    else if (c.brandSuffixDecision === "omit") score = len > IDEAL_MAX ? 0.7 : 0.5;
    dims.push(D("brand_trust_fit", score, ["brand", "candidate.length"]));
  } else {
    dims.push(D("brand_trust_fit", 0, [], false));
  }

  // — measurement_clarity: title changes are cleanly measurable via GSC CTR.
  dims.push(
    gsc
      ? D("measurement_clarity", 1, ["gsc"])
      : D("measurement_clarity", 0, [], false),
  );

  // — implementation_risk: low (good) when the field is CMS-mapped; else higher.
  dims.push(
    D(
      "implementation_risk",
      packet.current.cmsFieldMapped ? 1 : 0.5,
      ["current.cmsFieldMapped"],
    ),
  );

  // — Sources not present for this tenant yet → unavailable (not faked).
  dims.push(
    packet.semrush?.keywords?.length
      ? D("semrush_market_opportunity", 0.5, ["semrush.keywords"])
      : D("semrush_market_opportunity", 0, [], false),
  );
  dims.push(
    packet.semrush?.serpFeatures?.length || packet.profound
      ? D("aeo_serp_feature_fit", 0.5, ["semrush.serpFeatures"])
      : D("aeo_serp_feature_fit", 0, [], false),
  );
  dims.push(
    packet.ga4
      ? D("conversion_engagement_value", clamp01((packet.ga4.sessionKeyEventRate ?? 0) * 20), ["ga4"])
      : D("conversion_engagement_value", 0, [], false),
  );
  dims.push(
    packet.clarity
      ? D("ux_friction_impact", 0.5, ["clarity"])
      : D("ux_friction_impact", 0, [], false),
  );

  // — Hard length veto: a title that would truncate badly is disqualified.
  if (text != null && text.length > TRUNCATE_HARD) vetoes.push("title_too_long");

  // Weighted mean over AVAILABLE dimensions only.
  let wsum = 0;
  let acc = 0;
  for (const d of dims) {
    if (!d.available) continue;
    const w = TITLE_WEIGHTS[d.dimension] ?? 0;
    wsum += w;
    acc += w * d.score;
  }
  const weightedTotal = wsum > 0 ? acc / wsum : 0;

  return { candidateId: c.id, dimensions: dims, weightedTotal, vetoes };
}
