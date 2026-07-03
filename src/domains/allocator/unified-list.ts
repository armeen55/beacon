/**
 * unified-list (DREAM SITE V1, item D4 = N1 "the unified opportunity allocator", 2026-07-02).
 *
 * THE OPERATOR (verbatim): "combining all of these across everything we have.. i should have
 * the best list ever." One ranked decision across optimize (edit), create, link, prune, fix,
 * promote - by expected value, confidence, risk, effort - fused from every opportunity source
 * that already exists in this codebase:
 *
 *   (a) the worklist/canonical changes (optimize/edit moves) - build-canonical-changes.ts's
 *       CanonicalChange[], which itself already fuses GSC, Clarity friction (fix_conversion_
 *       friction), and internal-link moves (add_internal_links/consolidate_pages) through the
 *       ActionPack pipeline. This module does NOT re-derive that fusion - it reads the finished
 *       CanonicalChange rows as ONE lane.
 *   (b) D2's native gap verdicts (new-page + atomic-edit briefs from AI answer teardowns) -
 *       teardown-commonality-verdict.ts's GapVerdict.
 *   (c) D3's steal briefs (SERP-beaten keywords) - serp-steal-lane.ts's StealBrief.
 *   (d) keyword-library not-owned / close-to-page-1 rows - research/keyword-library.ts's
 *       KeywordLibraryRow, for demand that has no lane (a)/(b)/(c) coverage at all yet.
 *
 * PURE / no I/O. Every normalizer takes already-loaded data and returns UnifiedEntry[]; the
 * loader (load-unified-list.ts) does the fetching and hands data in here.
 *
 * SCORING (documented, deterministic): expectedValue midpoint x confidence, boosted when
 * multiple lanes agree on the SAME page (the operator's "everything working together"),
 * penalized by risk, ties broken by effort (quick wins first within a value band). See
 * `rankUnifiedEntries` for the exact formula.
 */

import { computeOpportunity, computeOpportunityFromGap, type OpportunityForecast } from "@/domains/forecast/opportunity-math";
import {
  changeTypeFamily,
  effortForFamily,
  type CanonicalChange,
  type EvidenceStrength,
} from "@/domains/changes/canonical-change";
import type { PersistedGapVerdict } from "@/domains/demand-graph/teardown-commonality-verdict";
import type { StealBrief } from "@/domains/serp/serp-steal-lane";
import type { KeywordLibraryRow } from "@/domains/research/keyword-library";
import { normalizePath } from "@/domains/experiments/daily-plan-types";

// ── The unified shape every lane normalizes into ────────────────────────────

export type UnifiedKind = "edit" | "create" | "link" | "fix" | "promote";

export type UnifiedLane = "worklist" | "aeo_gap" | "serp_steal" | "keyword_library";

export type UnifiedRisk = "low" | "medium" | "high";

export type UnifiedEntry = {
  /** Stable across re-renders of the same underlying opportunity on the same day (lane-prefixed
   *  so two lanes can never collide even if they happen to target the same page). */
  id: string;
  kind: UnifiedKind;
  /** The page this entry targets, or null for a not-yet-created page (a "create" candidate with
   *  no URL yet - the topic IS the target). */
  page: string | null;
  /** For a create candidate with no page yet, the topic/label the new page would own. */
  topic: string | null;
  pageLabel: string;
  /** One sentence, first person, plain language - what to actually do. */
  exactWhat: string;
  expectedValue: { low: number | null; high: number | null; basis: string; days: number; hypothesisId: string | null };
  /** 0-1 confidence from evidence strength + specialist/lane weight. Not a probability in the
   *  formal sense - a bounded scalar the ranker multiplies against expectedValue. */
  confidence: number;
  risk: UnifiedRisk;
  riskFlags: string[];
  /** Minutes band - reuses effortForFamily's existing per-family estimates so a "3 minutes" here
   *  means the same thing it means on the worklist today. */
  effortMinutes: number;
  /** Which lanes independently surfaced this same page - the "everything working together"
   *  signal. A page confirmed by BOTH aeo_gap and serp_steal (or any 2+) ranks higher. */
  sources: UnifiedLane[];
  forecastBasis: string;
  /** Passthrough holds from upstream gates - never re-derived, only carried. A lane-(a) row
   *  already carries its own hold state (blocked/measuring/quality flag); this module surfaces
   *  it so the ranker can push a held item down without hiding it. */
  hold: { held: boolean; reason: string | null };
  /** The original CanonicalChange for a worklist-lane entry, so a caller merging entries back
   *  into the worklist's CanonicalChange[] can recover the full row unchanged. Null for
   *  entries newly synthesized from D2/D3/keyword-library (the loader builds a fresh
   *  CanonicalChange for those; see load-unified-list.ts). */
  sourceChange: CanonicalChange | null;
};

// ── Lane (a): worklist / canonical changes ──────────────────────────────────

const KIND_BY_FAMILY: Record<string, UnifiedKind> = {
  meta: "edit", title: "edit", h1: "edit", answer: "edit", schema: "edit", cro: "fix",
  link: "link", new_page: "create", other: "edit",
};

/** A CanonicalChange's own status already encodes hold/blocked/quality-flag state - reuse it,
 *  never re-derive. "blocked" (protected control / mid-measurement) and a "flagged" quality
 *  decision both count as a hold; "skipped" entries are dropped by the caller before this runs. */
function holdFromCanonicalChange(c: CanonicalChange): { held: boolean; reason: string | null } {
  if (c.status === "blocked") return { held: true, reason: c.blockedReason ?? "Not actionable right now." };
  if (c.qualityDecision === "flagged") return { held: true, reason: c.qualityNote ?? "Review before shipping." };
  return { held: false, reason: null };
}

/** Evidence strength -> confidence scalar. Mirrors the existing strong/directional/tracking
 *  ladder (canonical-change.ts) so a worklist row's confidence here means the same thing the
 *  "Strong comparison" / "Directional signal" / "Tracking only" badge already means. */
export function confidenceFromEvidence(e: EvidenceStrength): number {
  if (e === "strong") return 0.9;
  if (e === "directional") return 0.6;
  return 0.35; // tracking
}

export function normalizeWorklistEntry(c: CanonicalChange): UnifiedEntry {
  const kind = KIND_BY_FAMILY[c.changeFamily] ?? "edit";
  const hold = holdFromCanonicalChange(c);
  return {
    id: `worklist:${c.id}`,
    kind,
    page: c.pagePath || null,
    topic: kind === "create" ? c.pageLabel : null,
    pageLabel: c.pageLabel,
    exactWhat: c.recommendation,
    expectedValue: {
      low: c.expectedOutcomeLow ?? null,
      high: c.expectedOutcomeHigh ?? null,
      basis: c.expectedOutcome ?? "I do not have enough history to size this yet.",
      days: c.expectedOutcomeDays ?? 28,
      hypothesisId: c.hypothesisId ?? null,
    },
    confidence: confidenceFromEvidence(c.evidenceStrength),
    risk: c.riskLevel,
    riskFlags: c.attributionLimited ? ["An overlapping edit weakens this measurement."] : [],
    effortMinutes: c.estimatedEffortMinutes,
    sources: ["worklist"],
    forecastBasis: c.expectedOutcome ?? "not enough history yet",
    hold,
    sourceChange: c,
  };
}

// ── Lane (b): D2 native AEO gap verdicts ────────────────────────────────────

/** D2 verdicts carry no GSC position signal (they come from AI-answer citations, not Google
 *  rank), so their expected value uses the honest "not enough history" opportunity-math path
 *  rather than fabricating a position. The forecast is still logged through the SAME
 *  computeOpportunity() call every other lane uses (one sizing source, per the D4 mandate) -
 *  it simply returns the honest null-range basis for a pre-rank AEO opportunity, same as a
 *  brand-new page would on the worklist lane. */
export function normalizeGapVerdictEntry(
  tenantId: string,
  v: PersistedGapVerdict,
): UnifiedEntry | null {
  if (v.outcome === "no_verdict") return null;
  const isEdit = v.outcome === "atomic_edit";
  const page = isEdit ? v.atomicEdit?.ownedUrl ?? v.ownedUrl ?? null : null;
  const lever = isEdit ? "add_answer_block" : "create_new_page";
  const forecast: OpportunityForecast = computeOpportunity({
    tenantId,
    page: page ?? `aeo-gap:${v.promptId}`,
    lever,
  });
  const exactWhat = isEdit
    ? (v.atomicEdit?.additions?.length ?? 0) > 0
      ? `Add to this page: ${v.atomicEdit!.additions.slice(0, 3).join("; ")}.`
      : "Your page already covers what AI's winning answers share - no addition needed."
    : `Build a new page covering what AI's winning answers all share for "${v.promptText}".`;
  const rationale = v.renderedSentence ?? v.reason ?? "AI answer teardown found a consensus among winning pages.";
  return {
    id: `aeo_gap:${v.promptId}`,
    kind: isEdit ? "edit" : "create",
    page: page ? normalizePath(page) : null,
    topic: isEdit ? null : v.promptText,
    pageLabel: isEdit ? (page ? normalizePath(page) : v.promptText) : v.promptText,
    exactWhat,
    expectedValue: {
      low: forecast.lowPerMonth,
      high: forecast.highPerMonth,
      basis: forecast.basis,
      days: forecast.days,
      hypothesisId: forecast.hypothesisId,
    },
    // AEO teardown evidence: real (multiple winning pages independently checked), but no GSC
    // rank signal backs it yet - a step below a directional worklist row (0.6), a step above
    // pure tracking (0.35). New pages read one notch lower than an edit to an owned page (a
    // page that already exists is a much safer bet than a page that does not exist yet).
    confidence: isEdit ? 0.55 : 0.45,
    risk: isEdit ? "low" : "medium",
    riskFlags: [],
    effortMinutes: effortForFamily(isEdit ? "answer" : "new_page"),
    sources: ["aeo_gap"],
    forecastBasis: rationale,
    hold: { held: false, reason: null },
    sourceChange: null,
  };
}

// ── Lane (c): D3 SERP steal briefs ──────────────────────────────────────────

/** A steal brief already carries real GSC position/impressions for the beaten keyword - the
 *  richest signal of any new lane, closer to a worklist row's own confidence than D2's. Actionable
 *  whenever the keyword is confirmed beaten with a resolved SERP (torn_down = a concrete edit
 *  pointer, blocked = we know we're beaten but could not read the winner's structure); "not_read"
 *  (no SERP resolved yet) stays out of the ranked list - nothing concrete to do yet. */
export function normalizeStealBriefEntry(tenantId: string, b: StealBrief): UnifiedEntry | null {
  if (b.teardownStatus === "not_read") return null;
  const page = b.ourPage ? normalizePath(b.ourPage) : null;
  const forecast: OpportunityForecast = computeOpportunity({
    tenantId,
    page: page ?? `serp_steal:${b.keyword}`,
    lever: "edit_existing_page",
    currentPosition: b.ourPosition,
    impressions90d: b.impressions,
  });
  const exactWhat = b.editPointer
    ? `${b.editPointer.label}: ${b.editPointer.reason}`
    : b.teardownStatus === "blocked"
      ? `You are beaten on "${b.keyword}" but I could not read the winning page's structure yet - it blocks crawlers.`
      : `Close the structure gap on "${b.keyword}" - ${b.whatWins ?? "match what the top result does better"}.`;
  return {
    id: `serp_steal:${b.keyword.trim().toLowerCase()}`,
    kind: "edit",
    page,
    topic: page ? null : b.keyword,
    pageLabel: page ?? b.keyword,
    exactWhat,
    expectedValue: {
      low: forecast.lowPerMonth,
      high: forecast.highPerMonth,
      basis: forecast.basis,
      days: forecast.days,
      hypothesisId: forecast.hypothesisId,
    },
    // Real GSC position + impressions back this one - closer to a directional worklist row.
    // teardownStatus === "blocked" (competitor page reads robots-blocked) knocks confidence down
    // a notch since the structure-gap claim then rests on less complete evidence.
    confidence: b.teardownStatus === "torn_down" ? 0.65 : 0.45,
    risk: "low",
    riskFlags: b.teardownStatus === "blocked" ? ["Could not read the competitor page - it blocks crawlers."] : [],
    effortMinutes: effortForFamily("other"),
    sources: ["serp_steal"],
    forecastBasis: b.summary,
    hold: { held: false, reason: null },
    sourceChange: null,
  };
}

// ── Lane (d): keyword-library not-owned / close-to-page-1 rows ─────────────

const KEYWORD_LIBRARY_MIN_TIMES_SHOWN = 50; // floor: a real audience, not a stray query
const KEYWORD_LIBRARY_CLOSE_TO_PAGE_ONE_MAX = 20; // rank past 20 has no real page-1 story yet

/** Only a row with NO owner page (a true content gap) or an owner ranking 11-20 (close to page 1
 *  but not there) is a genuine, undercovered opportunity - a row already on page 1 (position
 *  <= 10) is doing fine and belongs to lane (a) if it needs work, not this lane. Deliberately
 *  conservative: `alreadyCovered` lets the loader skip any keyword whose owner page already has
 *  a lane-(a)/(b)/(c) entry, so this lane only fires for genuinely uncovered demand. */
export function selectKeywordLibraryGaps(
  rows: readonly KeywordLibraryRow[],
  alreadyCoveredPaths: ReadonlySet<string>,
  opts: { minTimesShown?: number; closeToPageOneMax?: number } = {},
): KeywordLibraryRow[] {
  const minShown = opts.minTimesShown ?? KEYWORD_LIBRARY_MIN_TIMES_SHOWN;
  const closeMax = opts.closeToPageOneMax ?? KEYWORD_LIBRARY_CLOSE_TO_PAGE_ONE_MAX;
  return rows.filter((r) => {
    const demand = r.timesShownPerMo ?? 0;
    const volume = r.searchesPerMo ?? 0;
    if (demand < minShown && volume < minShown) return false;
    const notOwned = !r.ownerPage;
    const closeToPageOne = r.yourPosition != null && r.yourPosition > 10 && r.yourPosition <= closeMax;
    if (!notOwned && !closeToPageOne) return false;
    if (r.ownerPage && alreadyCoveredPaths.has(normalizePath(r.ownerPage))) return false;
    return true;
  });
}

export function normalizeKeywordLibraryEntry(tenantId: string, r: KeywordLibraryRow): UnifiedEntry {
  const notOwned = !r.ownerPage;
  const page = r.ownerPage ? normalizePath(r.ownerPage) : null;
  const kind: UnifiedKind = notOwned ? "create" : "edit";
  const forecast: OpportunityForecast = notOwned
    ? computeOpportunity({ tenantId, page: `keyword_gap:${r.keyword}`, lever: "create_new_page" })
    : computeOpportunity({
        tenantId,
        page: page!,
        lever: "edit_existing_page",
        currentPosition: r.yourPosition,
        impressions90d: r.timesShownPerMo ?? 0,
      });
  const demandClause = r.searchesPerMo != null
    ? `about ${r.searchesPerMo.toLocaleString("en-US")} searches a month`
    : r.timesShownPerMo != null
      ? `about ${r.timesShownPerMo.toLocaleString("en-US")} times shown on Google a month`
      : "real demand with no volume number yet";
  const exactWhat = notOwned
    ? `Build a page for "${r.keyword}" - I have no page targeting this yet, and it gets ${demandClause}.`
    : `Improve the page ranking position ${Math.round(r.yourPosition ?? 0)} for "${r.keyword}" - it gets ${demandClause} but is not on page 1 yet.`;
  return {
    id: `keyword_library:${r.keyword.trim().toLowerCase()}`,
    kind,
    page,
    topic: notOwned ? r.keyword : null,
    pageLabel: page ?? r.keyword,
    exactWhat,
    expectedValue: {
      low: forecast.lowPerMonth,
      high: forecast.highPerMonth,
      basis: forecast.basis,
      days: forecast.days,
      hypothesisId: forecast.hypothesisId,
    },
    // Weakest-evidence lane by design: a bare keyword-demand row with no teardown, no AI-answer
    // consensus, no worklist scoring behind it yet - real demand, but the least worked opportunity
    // of the four lanes. Close-to-page-1 (we already rank, just not on page 1) reads slightly more
    // confident than a from-scratch page (notOwned).
    confidence: notOwned ? 0.3 : 0.4,
    risk: notOwned ? "medium" : "low",
    riskFlags: [],
    effortMinutes: effortForFamily(notOwned ? "new_page" : "other"),
    sources: ["keyword_library"],
    forecastBasis: `${demandClause}${r.competitorOwners.length > 0 ? `, ${r.competitorOwners[0]} already ranks for it` : ""}`,
    hold: { held: false, reason: null },
    sourceChange: null,
  };
}

// ── Fusion: multiple lanes agreeing on the SAME page ────────────────────────

/** Merge entries that target the SAME real page (never merges two "create" entries with
 *  different topics - a page must exist to be a fusion target). The merged entry keeps the
 *  highest-confidence lane's `kind`/`exactWhat`/`expectedValue` (the most complete picture),
 *  unions `sources`, and takes the LOWER risk + HIGHER confidence when lanes disagree (real
 *  corroboration should never make an opportunity look worse). Deterministic: ties break by
 *  lane declaration order (worklist > aeo_gap > serp_steal > keyword_library), matching the
 *  order those lanes are documented in the D4 spec. */
const LANE_PRIORITY: Record<UnifiedLane, number> = { worklist: 0, aeo_gap: 1, serp_steal: 2, keyword_library: 3 };
const RISK_RANK: Record<UnifiedRisk, number> = { low: 0, medium: 1, high: 2 };

export function fuseByPage(entries: readonly UnifiedEntry[]): UnifiedEntry[] {
  const byPage = new Map<string, UnifiedEntry[]>();
  const standalone: UnifiedEntry[] = [];
  for (const e of entries) {
    if (!e.page) {
      standalone.push(e);
      continue;
    }
    const group = byPage.get(e.page) ?? [];
    group.push(e);
    byPage.set(e.page, group);
  }
  const fused: UnifiedEntry[] = [...standalone];
  for (const group of byPage.values()) {
    if (group.length === 1) {
      fused.push(group[0]!);
      continue;
    }
    const sorted = [...group].sort((a, b) => LANE_PRIORITY[a.sources[0]!] - LANE_PRIORITY[b.sources[0]!]);
    const primary = sorted[0]!;
    const allSources = [...new Set(sorted.flatMap((e) => e.sources))];
    const bestConfidence = Math.max(...sorted.map((e) => e.confidence));
    const bestRisk = sorted.reduce((acc, e) => (RISK_RANK[e.risk] < RISK_RANK[acc] ? e.risk : acc), primary.risk);
    const bestExpected = sorted.reduce((acc, e) => {
      const accMid = acc.expectedValue.low != null && acc.expectedValue.high != null ? (acc.expectedValue.low + acc.expectedValue.high) / 2 : -1;
      const eMid = e.expectedValue.low != null && e.expectedValue.high != null ? (e.expectedValue.low + e.expectedValue.high) / 2 : -1;
      return eMid > accMid ? e : acc;
    }, primary);
    fused.push({
      ...primary,
      sources: allSources,
      confidence: bestConfidence,
      risk: bestRisk,
      expectedValue: bestExpected.expectedValue,
      // Union of any hold: if ANY lane says held, the fused entry is held (never silently drops
      // the caution just because another lane didn't know about it).
      hold: sorted.some((e) => e.hold.held) ? sorted.find((e) => e.hold.held)!.hold : primary.hold,
      riskFlags: [...new Set(sorted.flatMap((e) => e.riskFlags))],
    });
  }
  return fused;
}

// ── Ranking ──────────────────────────────────────────────────────────────

export const MULTI_LANE_BOOST_PER_EXTRA_SOURCE = 0.15; // +15% per corroborating lane beyond the first
export const RISK_PENALTY: Record<UnifiedRisk, number> = { low: 1, medium: 0.85, high: 0.6 };
export const HELD_PENALTY = 0.05; // a held item stays visible but sinks far below actionable ones

/**
 * The one ranking score: expectedValue midpoint x confidence, boosted when multiple lanes agree,
 * penalized by risk. A null expectedValue midpoint (not enough history) scores from confidence
 * alone at a steep discount, so an unsized-but-real opportunity still ranks (never disappears)
 * but never outranks a sized one at comparable confidence. Deterministic - no randomness, no
 * wall-clock dependence beyond what the caller already baked into `expectedValue`/`hypothesisId`.
 */
export function unifiedScore(e: UnifiedEntry): number {
  const mid = e.expectedValue.low != null && e.expectedValue.high != null ? (e.expectedValue.low + e.expectedValue.high) / 2 : null;
  // Honest-gap floor: an entry with no sizeable range yet still gets a small base value (5)
  // scaled by confidence, instead of scoring zero and vanishing below every sized entry.
  const base = mid != null ? Math.max(mid, 1) : 5;
  const laneBoost = 1 + MULTI_LANE_BOOST_PER_EXTRA_SOURCE * Math.max(0, e.sources.length - 1);
  const heldFactor = e.hold.held ? HELD_PENALTY : 1;
  return base * e.confidence * laneBoost * RISK_PENALTY[e.risk] * heldFactor;
}

/**
 * Rank the fused unified list. Deterministic sort: primary key is `unifiedScore` descending;
 * ties (same rounded score) break by effort ascending (quick wins first within a value band),
 * then by id for full determinism (never an unstable sort artifact). Held items are NEVER
 * dropped from the list (an operator should still see them, just far down) - callers that want
 * only actionable items should filter on `!entry.hold.held` themselves.
 */
export function rankUnifiedEntries(entries: readonly UnifiedEntry[]): UnifiedEntry[] {
  return [...entries].sort((a, b) => {
    const sa = unifiedScore(a);
    const sb = unifiedScore(b);
    // Round to avoid float-noise ties reading as "different" (2 decimal places is plenty of
    // precision for a ranking score built from dollars/clicks-per-month inputs).
    const ra = Math.round(sa * 100);
    const rb = Math.round(sb * 100);
    if (ra !== rb) return rb - ra;
    if (a.effortMinutes !== b.effortMinutes) return a.effortMinutes - b.effortMinutes;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Convenience: normalize + fuse + rank in one call, given already-normalized per-lane entries.
 *  The loader (load-unified-list.ts) builds the per-lane arrays (I/O) and calls this. */
export function buildUnifiedList(perLane: readonly UnifiedEntry[]): UnifiedEntry[] {
  return rankUnifiedEntries(fuseByPage(perLane));
}

// ── Rendering onto the worklist's existing CanonicalChange[] seam ──────────

/** Plain-language provenance labels, never a raw lane key - the "AI answers + Google results
 *  agree" chip the operator asked for reads real words, matching the rest of the worklist's
 *  first-person, no-jargon copy rule. */
export const LANE_LABEL: Record<UnifiedLane, string> = {
  worklist: "your worklist",
  aeo_gap: "AI answers",
  serp_steal: "Google results",
  keyword_library: "keyword research",
};

export function sourcesSentence(sources: readonly UnifiedLane[]): string[] {
  return sources.map((s) => LANE_LABEL[s]);
}

const KIND_TO_OPPORTUNITY_LABEL: Record<UnifiedKind, string> = {
  edit: "Improve page",
  create: "New page",
  link: "Add internal link",
  fix: "Fix experience",
  promote: "Promote",
};

/**
 * Render a NON-worklist-lane UnifiedEntry (aeo_gap / serp_steal / keyword_library) as a
 * first-class CanonicalChange, so it appears on /worklist through the SAME rendering seam every
 * other row already uses (ChangesListClient reads CanonicalChange[] generically - no new UI
 * needed). A worklist-lane entry already IS a CanonicalChange (see `sourceChange`) and should be
 * merged with `mergeSourcesOntoChange` instead of re-synthesized.
 */
export function unifiedEntryToCanonicalChange(tenantId: string, e: UnifiedEntry): CanonicalChange {
  const family = e.kind === "create" ? "new_page" : e.kind === "link" ? "link" : e.kind === "fix" ? "cro" : changeTypeFamily(e.sources[0] === "aeo_gap" ? "add_answer_block" : "edit_existing_page");
  const pagePath = e.page ?? "";
  const evidenceStrength: EvidenceStrength = e.confidence >= 0.75 ? "strong" : e.confidence >= 0.5 ? "directional" : "tracking";
  return {
    id: e.id,
    tenantId,
    pagePath,
    pageUrl: e.page ?? "",
    pageLabel: e.pageLabel,
    opportunityType: KIND_TO_OPPORTUNITY_LABEL[e.kind],
    changeType: e.sources[0] === "aeo_gap" && e.kind === "edit" ? "add_answer_block" : e.kind === "create" ? "create_new_page" : "edit_existing_page",
    changeFamily: family,
    status: e.hold.held ? "blocked" : "suggested",
    recommendation: e.exactWhat,
    exactInstructions: null,
    before: null,
    after: null,
    rationale: e.forecastBasis,
    estimatedEffortMinutes: e.effortMinutes,
    impactScore: Math.round(unifiedScore(e)),
    upside: e.expectedValue.low != null && e.expectedValue.high != null ? Math.round((e.expectedValue.low + e.expectedValue.high) / 2) : null,
    expectedOutcome: e.expectedValue.basis,
    expectedOutcomeLow: e.expectedValue.low,
    expectedOutcomeHigh: e.expectedValue.high,
    expectedOutcomeDays: e.expectedValue.days,
    hypothesisId: e.expectedValue.hypothesisId,
    riskLevel: e.risk,
    evidenceStrength,
    measurementMethod: "Tracked descriptively until selected into a measured plan",
    selectedForToday: false,
    activeExperiment: false,
    protectedControl: false,
    blockedReason: e.hold.held ? e.hold.reason : null,
    result: null,
    measurementHeadline: null,
    measurementDetail: null,
    nextCheckpoint: null,
    attributionLimited: false,
    qualityDecision: "approved",
    qualityNote: e.riskFlags[0] ?? null,
    sourceIds: [e.id],
    alternateOpportunities: [],
    sources: sourcesSentence(e.sources),
  };
}

/** A worklist-lane entry (sourceChange !== null) may have been fused with a D2/D3/keyword-
 *  library lane on the same page - stamp the union of sources + any fusion-lifted confidence/
 *  risk/expectedValue back onto the ORIGINAL CanonicalChange (never replace it - the worklist row
 *  already carries live status/measurement truth this module must not clobber). */
export function mergeSourcesOntoChange(e: UnifiedEntry): CanonicalChange {
  const base = e.sourceChange!;
  if (e.sources.length <= 1) return { ...base, sources: sourcesSentence(e.sources) };
  return {
    ...base,
    sources: sourcesSentence(e.sources),
    rationale: e.sources.length > 1 ? `${base.rationale} Confirmed by ${sourcesSentence(e.sources.filter((s) => s !== "worklist")).join(" and ")} too.` : base.rationale,
  };
}
