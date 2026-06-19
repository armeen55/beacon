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
import { expectedCtrForPosition } from "./expected-ctr";
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
  /** FINISHED content (operator-draft, not a directive): the literal copy to
   *  ship for content changes. For title/meta/h1 the literal value lives in
   *  `exact_change`; for intro_answer_block/section_add the literal block text
   *  lives here; for faq the literal Q&A pairs live in `faq_items`. */
  artifact_text?: string | null;
  faq_items?: Array<{ question: string; answer: string }> | null;
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
  /** Real, gate-surviving changes held back as FOLLOW-UP so the ready plan stays
   *  focused (primary + ≤2 supports). Not rejected — deferred to a later pass. */
  deferred_changes?: AtomicChange[];
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

/** Bump when the decision shape OR the gate logic changes so old cached briefs
 *  re-run. v3 = the 2026-06-18 trust-hardening gate (over-recommendation
 *  suppression, evidence-citation sanitizer, candidate eligibility).
 *  v4 = the WL1–11 trust worklist (keep_current narrative, per-claim absent
 *  evidence, numeric fidelity, supporting-change cap, per-query deficit,
 *  diagnose-then-plan, null≠0 KD/CPC). */
export const DECISION_SCHEMA_VERSION = "v4-trust-worklist";

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

// ── Deterministic TRUST gate thresholds (2026-06-18 audit hardening) ─────────
// A snippet deficit is real when a HIGH-IMPRESSION query underperforms the CTR
// expected at ITS OWN position — blended page CTR hides this (one big winner can
// mask a bleeding query, and one tiny query can fake a page-level gap). The
// blended page gap is kept only as a coarse fallback above a higher floor.
const PERQ_DEFICIT_MIN_IMPR = 100; // a query needs real volume to matter
const PERQ_DEFICIT_MIN_GAP = 0.01; // its CTR must trail position-expected by ≥1pt
const SNIPPET_DEFICIT_BLENDED_GAP = 0.02; // blended-alone is coarse → higher floor
const ZERO_CLICK_MIN_IMPR = 200;
const ZERO_CLICK_MAX_POS = 10;
const ZERO_CLICK_MAX_CTR = 0.01;
const CLUSTER_MIN_VOL = 500;
const FRICTION_MIN_DEAD = 20;
const FRICTION_MIN_RAGE = 5;
const CLARITY_TINY_TOTAL = 10;

const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "for", "to", "in", "on", "with", "how",
  "what", "is", "are", "your", "you", "best", "top", "list", "guide",
]);
function significantTokens(s: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of (s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (w.length > 2 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}
function pageTitle(packet: EvidencePacket): string {
  return packet.crawl?.title ?? packet.current.currentText ?? "";
}
/** Every significant token of `phrase` is present in `inText`. */
function phraseCoveredBy(phrase: string, inText: string): boolean {
  const have = significantTokens(inText);
  for (const w of significantTokens(phrase)) if (!have.has(w)) return false;
  return true;
}

/** Deterministic, evidence-grounded "what is actually wrong with this page"
 *  detector — the SOLE basis for whether a change family is eligible. No LLM. */
export type PageProblems = {
  snippetDeficit: boolean;
  titleMissingDominantQuery: boolean;
  zeroClickPage1: boolean;
  highValueUnservedCluster: boolean;
  meaningfulFriction: boolean;
  claritySampleTiny: boolean;
  missingSchema: boolean;
  questionDemand: boolean;
  /** Any problem that justifies a surgeon recommendation at all. Excludes
   *  missingSchema/questionDemand (those are supporting-only justifications). */
  hasAnyProblem: boolean;
};

export function detectPageProblems(packet: EvidencePacket): PageProblems {
  const g = packet.gsc;
  const title = pageTitle(packet);
  const queries = g?.topQueries ?? [];

  // Per-query: any high-impression query whose CTR trails the curve at its
  // position. This is the real signal — the blended gap is only a coarse fallback.
  const perQueryDeficit =
    !!g &&
    queries.some(
      (q) =>
        q.impressions >= PERQ_DEFICIT_MIN_IMPR &&
        expectedCtrForPosition(q.position) - q.ctr >= PERQ_DEFICIT_MIN_GAP,
    );
  const snippetDeficit = !!g && (perQueryDeficit || (g.ctrGap ?? 0) >= SNIPPET_DEFICIT_BLENDED_GAP);

  const dominant = queries[0];
  const titleMissingDominantQuery = !!dominant && !phraseCoveredBy(dominant.query, title);

  const zeroClickPage1 = queries.some(
    (q) => q.impressions >= ZERO_CLICK_MIN_IMPR && q.position <= ZERO_CLICK_MAX_POS && q.ctr < ZERO_CLICK_MAX_CTR,
  );

  // Queries the page ALREADY earns clicks on are NOT "unserved" — exclude them
  // so a synonym of a winning query can't masquerade as a new intent cluster.
  const earning = new Set(queries.filter((q) => q.clicks > 0).map((q) => q.query.toLowerCase()));
  const highValueUnservedCluster = (packet.semrush?.keywords ?? []).some(
    (k) =>
      k.volume >= CLUSTER_MIN_VOL &&
      k.position != null && k.position >= 4 && k.position <= 20 &&
      !phraseCoveredBy(k.keyword, title) &&
      !earning.has(k.keyword.toLowerCase()),
  );

  const dead = packet.clarity?.deadClicks ?? 0;
  const rage = packet.clarity?.rageClicks ?? 0;
  const quick = packet.clarity?.quickbacks ?? 0;
  const meaningfulFriction = !!packet.clarity && (dead >= FRICTION_MIN_DEAD || rage >= FRICTION_MIN_RAGE);
  const claritySampleTiny = !!packet.clarity && dead + rage + quick < CLARITY_TINY_TOTAL;

  const missingSchema = !!packet.crawl && (packet.crawl.schemaTypes?.length ?? 0) === 0;
  const questionDemand =
    (packet.semrush?.questionKeywords?.length ?? 0) > 0 ||
    queries.some((q) => /^(what|how|why|who|when|where|which|is|are|does|do|can)\b/i.test(q.query));

  // hasAnyProblem deliberately EXCLUDES highValueUnservedCluster: a soft
  // "different cluster" signal alone (no CTR deficit, no zero-click query, no
  // friction) is too speculative to justify touching a healthy page — defaulting
  // to keep_current is the trust-first call. The cluster still grants per-change
  // eligibility (so a real cluster can shape wording when a hard problem exists).
  const hasAnyProblem =
    snippetDeficit || titleMissingDominantQuery || zeroClickPage1 || meaningfulFriction;

  return {
    snippetDeficit, titleMissingDominantQuery, zeroClickPage1, highValueUnservedCluster,
    meaningfulFriction, claritySampleTiny, missingSchema, questionDemand, hasAnyProblem,
  };
}

/** P2 — reject a change whose evidence affirmatively cites a packet field that
 *  is absent/empty (the fabrication class the audit caught). Returns a reject
 *  reason, or null when the change doesn't lean on missing evidence. */
function citesAbsentEvidence(change: AtomicChange, packet: EvidencePacket): string | null {
  const text = `${change.evidence} ${change.exact_change} ${change.hypothesis}`.toLowerCase();
  // PER-CLAIM acknowledgement: split into sentences/clauses so an honest "no GA4"
  // in one clause cannot disable absent-source checks for a DIFFERENT source cited
  // affirmatively in another clause. A citation counts only when a clause matches
  // the source pattern AND that same clause does not acknowledge absence.
  const ABSENCE =
    /\b(no |none|absent|empty|not (available|returned|present|connected|pulled)|n\/a|isn't|aren't|lack|without|missing|0 )\b/;
  const clauses = text.split(/(?<=[.!?;:])\s+|\n+|\s—\s|\s-\s/).filter((c) => c.trim().length > 0);
  const scan = clauses.length > 0 ? clauses : [text];
  const cites = (re: RegExp): boolean => scan.some((c) => re.test(c) && !ABSENCE.test(c));
  const sem = packet.semrush;
  if ((sem?.relatedKeywords?.length ?? 0) === 0 && cites(/related (keyword|search|term)|relatedkeyword/))
    return "Insufficient evidence: cites SEMrush related keywords, but none were pulled for this page.";
  if ((sem?.questionKeywords?.length ?? 0) === 0 && cites(/question (keyword|phrase|form)|questionkeyword|phrase[_ ]question|people also ask/))
    return "Insufficient evidence: cites SEMrush question keywords, but none were pulled for this page.";
  if (!packet.ga4 && cites(/\bga4\b|conversion|engaged session|engagement rate|\bsessions?\b/))
    return "Insufficient evidence: cites GA4 engagement/conversion, but GA4 has no rows for this page.";
  if (!packet.clarity && cites(/\bclarity\b|dead[- ]click|rage[- ]click|quickback|pogo[- ]?stick/))
    return "Insufficient evidence: cites Microsoft Clarity behavior, but Clarity has no data for this page.";
  if ((sem?.competitorDomains?.length ?? 0) === 0 && !(sem?.competitorGaps?.length) && cites(/competitor (url|domain|ranking|page)/))
    return "Insufficient evidence: cites competitor ranking data, but none was pulled.";
  return null;
}

/** P1 + P3 — is this atomic change ELIGIBLE given the page's real problems?
 *  Returns a reject reason, or null when eligible. */
function changeEligibilityReason(
  change: AtomicChange,
  packet: EvidencePacket,
  p: PageProblems,
): string | null {
  const cite = citesAbsentEvidence(change, packet);
  if (cite) return cite;

  switch (change.action) {
    case "image_alt":
      // We never crawl image/alt data → an image_alt change is always ungrounded.
      return "Insufficient evidence: no image/alt-text data is crawled for this page.";
    case "schema":
      return p.missingSchema
        ? null
        : "Page already has schema markup — a schema add isn't justified (FAQ rich-result CTR is deprecated and not a valid lever).";
    case "ux_cta_fix":
      if (!packet.clarity) return "No Microsoft Clarity data — a UX fix isn't grounded.";
      if (!p.meaningfulFriction)
        return `Clarity friction below a meaningful sample (dead ${packet.clarity.deadClicks ?? 0}, rage ${packet.clarity.rageClicks ?? 0}).`;
      return null;
    case "title":
    case "meta":
    case "h1":
      if (p.snippetDeficit || p.titleMissingDominantQuery || p.zeroClickPage1 || p.highValueUnservedCluster) return null;
      return "No snippet deficit: page CTR is at/above expected for its position and the title already serves the dominant query.";
    case "intro_answer_block":
      if (p.snippetDeficit || p.zeroClickPage1 || p.highValueUnservedCluster) return null;
      return "No unmet query demand: page converts at/above expected and has no page-1 zero-click queries.";
    case "faq":
      if (p.zeroClickPage1 || p.questionDemand || p.snippetDeficit) return null;
      return "No question demand or snippet deficit to justify an FAQ block.";
    case "create_new_page":
      // A whole new page is the heaviest, most speculative move — only justified
      // by a genuine high-volume intent the EXISTING page doesn't serve. Absent
      // that, optimize the existing page instead.
      if (p.highValueUnservedCluster) return null;
      return "No high-volume unserved intent cluster — optimize the existing page instead of creating a new one.";
    default:
      // internal_link, section_*, citation_source — no extra P1/P3 gate (still
      // subject to the P2 evidence-citation check above).
      return null;
  }
}

/** A deterministic, evidence-grounded UX-fix candidate built straight from the
 *  Clarity numbers — so meaningful friction is SURFACED, never silently dropped. */
function buildClarityFrictionChange(packet: EvidencePacket, order: number): AtomicChange {
  const dead = packet.clarity?.deadClicks ?? 0;
  const rage = packet.clarity?.rageClicks ?? 0;
  const quick = packet.clarity?.quickbacks ?? 0;
  return {
    action: "ux_cta_fix",
    exact_change:
      `Investigate the on-page friction Microsoft Clarity recorded (${dead} dead clicks` +
      `${rage ? `, ${rage} rage clicks` : ""}): find the element(s) users click that don't respond and make them work or remove them.`,
    evidence: `Microsoft Clarity for this page: ${dead} dead clicks, ${rage} rage clicks, ${quick} quickbacks.`,
    hypothesis: "Removing dead/rage-click friction should improve engagement and reduce pogo-sticking back to the SERP.",
    risk: "Low — a diagnostic + targeted element fix; confirm the element's intended behavior before changing it.",
    before_after: { before: null, after: null },
    measurement: "Re-check this page's Clarity dead/rage-click counts 14–28 days after the fix.",
    rollback: "Revert the element change if engagement does not improve.",
    publishability: "review_only",
    dependency_order: order,
  };
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

/** Deprecated / unsupported justification phrases the gate strips from a
 *  change's reasoning (e.g. FAQ rich-result CTR — Google deprecated it in 2023).
 *  Removing the claim is the gate's job, same as dropping an unsupported change. */
const DEPRECATED_CLAIM = /(rich result|rich snippet|serp real estate|faq schema[^.!?]*ctr)/i;
function cleanClaimText(text: string, fallback: string): string {
  if (!text) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => !DEPRECATED_CLAIM.test(s));
  const out = kept.join(" ").trim();
  return out.length > 0 ? out : fallback;
}

/** Numeric-fidelity gate (the single biggest trust risk): the judge may cite
 *  ONLY metrics that exist in the EvidencePacket. We extract metric-tagged
 *  numbers from a change's prose and reconcile each against the packet's real
 *  values. A cited number that matches NO measured value for that metric — and
 *  isn't a forward-looking TARGET — is a fabrication, so the change is rejected
 *  and never reaches the operator with a wrong number on it.
 *
 *  Deliberately conservative (a false rejection nukes a good rec):
 *   - only unambiguous, backward-looking metrics (impressions, CTR, position,
 *     dead/rage clicks, quickbacks, search volume);
 *   - numbers introduced by to/reach/target/from/above/→/"+" are treated as
 *     goals, not claims, and skipped;
 *   - absent sources are skipped here — citesAbsentEvidence owns that case. */
function verifyNumericFidelity(change: AtomicChange, packet: EvidencePacket): string | null {
  const text = `${change.evidence} ${change.hypothesis} ${change.exact_change}`;
  const g = packet.gsc;
  const c = packet.clarity;
  const sem = packet.semrush;

  const parseNum = (raw: string): number => {
    const s = raw.toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
    const k = s.endsWith("k");
    const n = parseFloat(k ? s.slice(0, -1) : s);
    return k ? n * 1000 : n;
  };
  // A number is a forward-looking TARGET (not a claim about current state) when
  // it follows to/reach/target/from/above/arrow, etc.
  const TARGET_BEFORE =
    /(to|reach\w*|target\w*|aim\w*|goal|above|over|at least|toward\w*|hit|raise\w*|lift\w*|improv\w*|grow\w*|from|up to|→|->|>=|≥|>)\s*(?:to\s*)?(?:positions?|pos\.?|rank|#|~)?\s*$/i;

  type Check = { label: string; patterns: RegExp[]; acceptable: number[]; kind: "count" | "percent" | "position" };
  const checks: Check[] = [];
  if (g) {
    checks.push({
      label: "impressions",
      patterns: [/\b([\d][\d,]*(?:\.\d+)?\s*k?)\s*(?:impressions?|impr\b)/gi],
      acceptable: [g.impressions, ...g.topQueries.map((q) => q.impressions)],
      kind: "count",
    });
    checks.push({
      label: "CTR",
      patterns: [
        /\b([\d]+(?:\.\d+)?)\s*%\s*(?:ctr|click[- ]?through)/gi,
        /(?:ctr|click[- ]?through(?:\s*rate)?)\s*(?:of|:|=|is|at|~|was|,)?\s*([\d]+(?:\.\d+)?)\s*%/gi,
      ],
      acceptable: [g.ctr, g.expectedCtrForPosition ?? NaN, ...g.topQueries.map((q) => q.ctr)]
        .filter((n) => Number.isFinite(n))
        .map((n) => n * 100),
      kind: "percent",
    });
    checks.push({
      label: "position",
      patterns: [
        /(?:positions?|pos\.?|rank(?:s|ed|ing)?)\s*#?\s*([\d]+(?:\.\d+)?)/gi,
        /\b([\d]+(?:\.\d+)?)(?:st|nd|rd|th)\s*(?:position|spot|place)/gi,
      ],
      acceptable: [g.avgPosition, ...g.topQueries.map((q) => q.position)],
      kind: "position",
    });
  }
  if (c) {
    if (c.deadClicks != null)
      checks.push({ label: "dead clicks", patterns: [/\b([\d][\d,]*)\s*dead[- ]?clicks?/gi], acceptable: [c.deadClicks], kind: "count" });
    if (c.rageClicks != null)
      checks.push({ label: "rage clicks", patterns: [/\b([\d][\d,]*)\s*rage[- ]?clicks?/gi], acceptable: [c.rageClicks], kind: "count" });
    if (c.quickbacks != null)
      checks.push({ label: "quickbacks", patterns: [/\b([\d][\d,]*)\s*quick[- ]?backs?/gi], acceptable: [c.quickbacks], kind: "count" });
  }
  if (sem) {
    const vols = [
      ...sem.keywords.map((k) => k.volume),
      ...(sem.relatedKeywords?.map((k) => k.volume) ?? []),
      ...(sem.questionKeywords?.map((k) => k.volume) ?? []),
    ].filter((n) => Number.isFinite(n));
    if (vols.length > 0)
      checks.push({
        label: "search volume",
        patterns: [
          /\b([\d][\d,]*(?:\.\d+)?\s*k?)\s*(?:monthly\s*)?(?:search(?:es)?\s*)?(?:volume|monthly searches)/gi,
          /(?:search\s*)?volume\s*(?:of|:|=|is|~|,)?\s*([\d][\d,]*(?:\.\d+)?\s*k?)/gi,
        ],
        acceptable: vols,
        kind: "count",
      });
  }

  const reconciles = (v: number, accept: number[], kind: Check["kind"]): boolean => {
    if (!Number.isFinite(v)) return true; // un-parseable → don't flag
    return accept.some((a) => {
      if (kind === "percent") return Math.abs(v - a) <= Math.max(0.3, 0.12 * Math.abs(a));
      if (kind === "position") return Math.abs(v - a) <= 1.0;
      return Math.abs(v - a) <= Math.max(1, 0.05 * Math.abs(a));
    });
  };
  const fmt = (n: number, kind: Check["kind"]): string =>
    kind === "percent" ? `${n.toFixed(2)}%` : String(Math.round(n));

  for (const chk of checks) {
    if (chk.acceptable.length === 0) continue;
    for (const re of chk.patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) != null) {
        const raw = m[1];
        if (raw == null) continue;
        const before = text.slice(Math.max(0, m.index - 16), m.index);
        if (TARGET_BEFORE.test(before)) continue;
        if (text.slice(re.lastIndex, re.lastIndex + 2).trimStart().startsWith("+")) continue;
        const v = parseNum(raw);
        if (!reconciles(v, chk.acceptable, chk.kind)) {
          const real = chk.acceptable.slice(0, 4).map((n) => fmt(n, chk.kind)).join(", ");
          return `Dropped ${change.action}: cited ${chk.label} "${raw.trim()}" doesn't match this page's measured ${chk.label} (${real}). Numbers must come from the evidence packet.`;
        }
      }
    }
  }
  return null;
}

/** Gate one atomic change: P2 evidence-citation + P1/P3 eligibility, then the
 *  AEO cap + publishability. Returns the gated change, or null + a reason when
 *  the change isn't substantiated. */
function gateChange(
  change: AtomicChange,
  packet: EvidencePacket,
  p: PageProblems,
): { change: AtomicChange | null; confCap: EvidenceConfidence | null; note: string | null } {
  const present = new Set(packet.sourcesPresent);

  const ineligible = changeEligibilityReason(change, packet, p);
  if (ineligible) return { change: null, confCap: "needs_more_evidence", note: ineligible };

  // Numeric-fidelity: a change whose prose cites a metric that contradicts the
  // packet is rejected outright — a wrong number is a trust failure, not a
  // downgrade. (Absent-source citations are handled in changeEligibilityReason.)
  const numericViolation = verifyNumericFidelity(change, packet);
  if (numericViolation) return { change: null, confCap: "needs_more_evidence", note: numericViolation };

  // Strip any deprecated/unsupported justification (e.g. FAQ rich-result CTR)
  // from the reasoning before it can reach the operator.
  change = {
    ...change,
    evidence: cleanClaimText(change.evidence, "Grounded in this page's GSC demand."),
    hypothesis: cleanClaimText(change.hypothesis, "Serve the page's existing question/meaning demand with a visible answer."),
  };

  const req = ACTION_REQUIRED_SOURCE[change.action];
  if (req && !present.has(req)) {
    return { change: null, confCap: "needs_more_evidence", note: `Dropped ${change.action}: needs ${req} data (not connected/populated).` };
  }

  let confCap: EvidenceConfidence | null = null;
  let risk = change.risk;
  if (AEO_ACTIONS.has(change.action) && !present.has("profound")) {
    confCap = "low";
    risk = `${risk} AI-citation impact is a hypothesis until Profound is connected.`.trim();
  }
  // A change leaning on a tiny Clarity sample can't be high-confidence.
  if (p.claritySampleTiny && /clarity|dead click|rage click|quickback/i.test(`${change.evidence} ${change.hypothesis}`)) {
    confCap = minConf(confCap ?? "medium", "low");
  }

  let publishability: Publishability = "review_only";
  if (CMS_FIELD_ACTIONS.has(change.action) && packet.current.cmsFieldMapped) {
    publishability = "staged"; // final confidence cap applied by caller
  }
  return { change: { ...change, risk, publishability }, confCap, note: null };
}

/** Leverage order used when the primary is gated out and a supporting change
 *  must be promoted (highest-leverage first). */
const PROMOTION_ORDER: AtomicChangeType[] = [
  "intro_answer_block", "ux_cta_fix", "meta", "title", "h1", "faq",
  "section_add", "internal_link", "citation_source", "schema",
  "section_reorder", "section_remove", "create_new_page", "image_alt",
];

const NON_CHANGE_ACTIONS = new Set<AtomicAction>(["keep_current", "needs_more_evidence", "needs_llm_review"]);

/** A keep_current verdict must read as "we are deliberately NOT changing this and
 *  here's why" — never carry a leftover change-plan narrative. Built from the
 *  real evidence so it's specific, not generic. */
function protectiveKeepInsight(packet: EvidencePacket): string {
  const g = packet.gsc;
  if (!g) return "No measured problem on this page right now — no change is recommended; monitor and revisit if its data moves.";
  const q = g.topQueries[0]?.query;
  return (
    `This page is healthy — it converts at or above the expected click-through for its position` +
    `${q ? ` (top query "${q}" at ~pos ${g.avgPosition.toFixed(0)})` : ""}, and the title already serves its dominant query. ` +
    `No change is recommended now; monitor and revisit only if rankings or CTR slip.`
  );
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
      deferred_changes: [],
      confidence: "needs_more_evidence",
    };
  }

  const p = detectPageProblems(packet);
  const wasChangeRequest = !NON_CHANGE_ACTIONS.has(decision.recommended_atomic_action);
  const proposed = [decision.primary_atomic_change, ...decision.supporting_atomic_changes].filter(
    (c): c is AtomicChange => c != null,
  );

  // P1 (page-level): a page with NO measured problem gets NO change — every
  // proposed edit is rejected with an honest reason and the decision collapses
  // to keep_current. This is what makes a healthy page (CTR ≥ expected, title
  // covers the dominant query, no zero-click page-1 query, no real friction)
  // return keep_current instead of a reflex title rewrite.
  if (wasChangeRequest && !p.hasAnyProblem) {
    const reason =
      "Page is healthy — CTR is at/above expected for its position, the title already serves the dominant query, there are no page-1 zero-click queries, and no meaningful Clarity friction. No change surfaced.";
    return {
      ...decision,
      recommended_atomic_action: "keep_current",
      primary_atomic_change: null,
      supporting_atomic_changes: [],
      deferred_changes: [],
      rejected_changes: [
        ...decision.rejected_changes,
        ...proposed.map((c) => ({ action: c.action, reason })),
      ],
      confidence: "medium",
      operator_insight: protectiveKeepInsight(packet),
      what_normal_seo_misses: "",
      why_not_just_title: "",
    };
  }

  let confidence = decision.confidence;
  const extraRejected: Array<{ action: string; reason: string }> = [];

  let primary = decision.primary_atomic_change;
  if (primary) {
    const g = gateChange(primary, packet, p);
    if (g.change == null) {
      if (g.note) extraRejected.push({ action: primary.action, reason: g.note });
      primary = null;
    } else {
      primary = g.change;
      if (g.confCap) confidence = minConf(confidence, g.confCap);
    }
  }

  const supporting: AtomicChange[] = [];
  for (const s of decision.supporting_atomic_changes) {
    const g = gateChange(s, packet, p);
    if (g.change == null) {
      if (g.note) extraRejected.push({ action: s.action, reason: g.note });
      continue;
    }
    if (g.confCap) confidence = minConf(confidence, g.confCap);
    supporting.push(g.change);
  }

  // P3 (rescue): meaningful Clarity friction must be SURFACED, not silently
  // rejected. If the page has real friction but no surviving ux_cta_fix, add a
  // deterministic, Clarity-grounded one (and drop any ux_cta_fix the judge had
  // rejected, since the gate is overriding that call).
  let rejected = [...decision.rejected_changes, ...extraRejected];
  if (
    p.meaningfulFriction &&
    primary?.action !== "ux_cta_fix" &&
    !supporting.some((c) => c.action === "ux_cta_fix")
  ) {
    supporting.push(buildClarityFrictionChange(packet, supporting.length + 2));
    rejected = rejected.filter((r) => r.action !== "ux_cta_fix");
  }

  // Resolve the headline action.
  let action = decision.recommended_atomic_action;
  if (wasChangeRequest) {
    if (primary == null && supporting.length > 0) {
      supporting.sort(
        (a, b) => PROMOTION_ORDER.indexOf(a.action) - PROMOTION_ORDER.indexOf(b.action),
      );
      primary = { ...supporting.shift()!, dependency_order: 1 };
      action = primary.action;
    } else if (primary == null) {
      // A problem exists but no deterministic action survived → escalate, never
      // fabricate. (keep_current would be a contradiction when a problem exists.)
      action = "needs_llm_review";
    } else {
      action = primary.action;
    }
  }

  // WL4 — cap the READY bundle: a publishable plan is the primary plus at most a
  // couple of necessary supports. Extra gate-surviving changes are real but
  // DEFERRED (follow-up), never an 8-change wall. Highest-leverage supports stay;
  // the rest move to follow-up so the operator sees one focused plan.
  const MAX_READY_SUPPORTING = 2;
  let deferred: AtomicChange[] = [];
  if (wasChangeRequest && supporting.length > MAX_READY_SUPPORTING) {
    supporting.sort(
      (a, b) => PROMOTION_ORDER.indexOf(a.action) - PROMOTION_ORDER.indexOf(b.action),
    );
    deferred = supporting
      .slice(MAX_READY_SUPPORTING)
      .map((c, i) => ({ ...c, dependency_order: MAX_READY_SUPPORTING + 2 + i }));
    supporting.length = MAX_READY_SUPPORTING; // truncate in place (keep top-leverage)
  }

  const capPublish = (c: AtomicChange): AtomicChange =>
    c.publishability === "staged" && CONF_RANK[confidence] < CONF_RANK.medium
      ? { ...c, publishability: "review_only" }
      : c;

  // P4 (fallback consistency): a non-change verdict carries NO change artifacts
  // (no primary, no supporting, no rollback/CTR-lift implied by a before/after).
  if (NON_CHANGE_ACTIONS.has(action)) {
    const isKeep = action === "keep_current";
    return {
      ...decision,
      recommended_atomic_action: action,
      primary_atomic_change: null,
      supporting_atomic_changes: [],
      deferred_changes: [],
      rejected_changes: rejected,
      confidence: isKeep ? confidence : "needs_more_evidence",
      // A non-change verdict must not carry change-plan prose. keep_current gets a
      // protective insight; needs_* keeps its bottleneck insight (it's an escalation).
      operator_insight: isKeep ? protectiveKeepInsight(packet) : decision.operator_insight,
      what_normal_seo_misses: "",
      why_not_just_title: "",
    };
  }

  return {
    ...decision,
    recommended_atomic_action: action,
    primary_atomic_change: primary ? capPublish(primary) : null,
    supporting_atomic_changes: supporting.map(capPublish),
    deferred_changes: deferred.map(capPublish),
    rejected_changes: rejected,
    confidence,
  };
}
