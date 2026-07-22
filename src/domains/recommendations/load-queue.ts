/**
 * Sprint 6A.1 Phase 14 (2026-04-24) — Live recommendation queue loader.
 *
 * Extracted from `src/app/(shell)/recommendations/page.tsx` so both the
 * page render AND the queue-driven CLI consume the SAME orchestration.
 * No behavior change to the page — it just calls this function instead
 * of inlining the steps.
 *
 * Steps (mirrors the page's pre-Phase-14 inline pipeline):
 *   1. seed canonical + recommendation-response stores (best-effort)
 *   2. fresh-read canonical data via repository (Phase 4.9 pattern)
 *   3. build the Phase-v5 DecisionMatrix
 *   4. generate raw `RecommendationCandidate[]` via the pure generator
 *   5. fetch page snapshots fresh, build owned page inventory
 *   6. resolve page intent (action / motive / target URL) per candidate
 *   7. apply adjudicator cache hits (cache-only — no LLM calls)
 *   8. prioritize into { queue, watchlist }
 *
 * Every step uses `safeCall` so a single layer's failure degrades
 * gracefully — same posture as the page render.
 *
 * Core 100K wave 2 (DECISION kernel collapse): the evidence-packet
 * builder (`buildPacketForRec`) and the full generation pipeline it fed
 * were deleted — they had no live caller. What remains is the persisted
 * fast loader (`loadPersistedRecommendationQueueForPage`) that the live
 * surfaces + publish-time QA lookup read.
 *
 * Pure of side effects EXCEPT the repository reads.
 */

import "server-only";

import type { RecommendationCandidate } from "./recommendation-types";
import type { ResolvedRecommendationCandidate } from "./resolved-types";
import { getRepository } from "@/lib/persistence/repositories";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { RecommendedEditRow } from "./recommended-edits-persistence";
import {
  loadGscPageSignalsForTenant,
  type GscPageSignal,
} from "@/domains/recommendation-intelligence/gsc-page-signals";
import {
  loadClarityPageSignalsForTenant,
  type ClarityPageSignal,
} from "@/domains/recommendation-intelligence/clarity-page-signals";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";

/**
 * Ranking tier a prioritized rec lands in. Formerly emitted by the removed
 * in-file prioritizer; retained here as the queue item's shared vocabulary.
 */
export type PrioritizedRecommendationTier = "now" | "this_week" | "later";

/**
 * A `RecommendationCandidate` decorated with the ranking fields the queue
 * item + packet builder read. The runtime prioritizer that produced these
 * has been removed; the persisted loader synthesizes the same shape from
 * stored edit rows. `resolution` is attached by the page-intent resolver
 * when present.
 */
export type PrioritizedRecommendation = RecommendationCandidate & {
  /** Final rubric score. */
  score: number;
  tier: PrioritizedRecommendationTier;
  /** 1-indexed position in the queue (1 is top). */
  rank: number;
  /** One-sentence operator-facing justification for the position. */
  reasoning: string;
  /** Attached by the resolver when the input includes it. */
  resolution?: ResolvedRecommendationCandidate["resolution"];
};

/**
 * W3 Step 3.3 (2026-05-01) — `PrioritizedRecommendation` decorated with
 * the engine confidence verdict. The pipeline stamps it once per rec
 * so every consumer (page render, CLI, future Step 3.4 LLM activator)
 * reads the same trust label. Field is required (never undefined) so
 * UI / log surfaces don't have to defensively branch.
 */
export type LiveRecQueueItem = PrioritizedRecommendation & {
  engineConfidence: {
    confidence: "low" | "medium" | "high";
    reasons: ReadonlyArray<string>;
  };
  /** Pivot (2026-06-13) — per-page Google Search Console signal for this rec's
   *  target URL (28-day clicks/impressions/CTR/position/top queries), or null
   *  when the page has no GSC data. Lets the card lead with first-party search
   *  demand instead of AEO citations. */
  gscSignal?: GscPageSignal | null;
  /** 2026-06-15 — per-page Microsoft Clarity behavioral signal for this rec's
   *  target URL (28-day sessions + rage/dead/quickback/script-error counts and
   *  derived rates), or null when Clarity has no data for the page. Lets the
   *  card quote the on-page FRICTION ("visitors rage-click in 8% of sessions")
   *  the search signals can't see. */
  claritySignal?: ClarityPageSignal | null;
};

async function safeCall<T>(
  fn: () => Promise<T> | T,
  fallback: T,
  label: string,
): Promise<{ value: T; error: string | null }> {
  try {
    const v = await fn();
    return { value: v, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[load-queue] ${label} failed:`, msg);
    return { value: fallback, error: `${label}: ${msg}` };
  }
}

/**
 * Night-shift #48 (2026-06-11) — unified queue ordering score for a
 * rec_id's edit group: drafted moves (proposed_text present) outrank
 * undrafted; confidence high > medium > low. Max over the group. Pure;
 * exported for tests. Recency breaks ties at the call site.
 */
export function queueGroupScore(
  edits: ReadonlyArray<{ proposed_text?: string | null; confidence?: string | null }>,
): number {
  let best = 0;
  for (const e of edits) {
    const drafted = e.proposed_text != null && e.proposed_text !== "" ? 10 : 0;
    const conf = e.confidence === "high" ? 2 : e.confidence === "medium" ? 1 : 0;
    const score = drafted + conf;
    if (score > best) best = score;
  }
  return best;
}

/** Tag string for `revalidateTag` from mutation actions. Shared between
 *  the cached wrapper (`tags: [...]`) and the mutation actions
 *  (`revalidateTag(...)`). */
export function buildRecQueueCacheTag(tenantId: string): string {
  return `recs-queue:${tenantId}`;
}

// Quota/waste pass (2026-06-17): was 60s — an open /recommendations tab re-read
// prod every minute, burning egress while idle. Operator actions (accept /
// refresh / scan) call revalidatePath("/", "layout") which busts this cache
// immediately, so the TTL only governs IDLE auto-refresh. 30 min cuts idle
// re-reads ~30x with zero freshness cost on the button-refresh flow.
const REC_QUEUE_CACHE_TTL_SECONDS = 1800;

// ---------------------------------------------------------------------------
// Emergency P0 v5 (2026-05-12) — persisted fast loader for v2 page renders.
//
// The cached wrapper above amortizes warm renders, but cold renders still
// pay the full ~33 s pipeline (canonical seed → matrix → generate → page
// reads → resolve → adjudicate → prioritize → decoration). For the v2
// card surface, that pipeline is overkill: every Suggested/Working/etc.
// card is anchored on a row in `recommended_edits` that was produced by
// a PRIOR generation pass and persisted. We can render the v2 cards
// directly from that persisted snapshot in ~3 small parallel Supabase
// reads (recommended_edits + recommendation_responses + tracked_prompts +
// changelog_entries — none larger than a few hundred rows per tenant).
//
// The legacy table view still needs the full pipeline because the
// per-row drawer renders fields (cluster reasoning, resolution motive,
// page-brief structure, primaryCompetitors, etc.) that aren't on the
// edit row. Legacy traffic is opt-in (`?legacy=1`); v2 is the default.
//
// Synthesis: for each rec_id with at least one renderable edit, we
// build a minimal `LiveRecQueueItem` (rank=N, score=0, tier="later",
// reasoning="", default evidence counts derived from the edit's own
// evidence array). The existing `buildRecommendationActionRows` builder
// consumes this and produces a `RecommendationActionRow[]` that's
// shape-compatible with the v2 client. Title / target / why /
// confidence / measurement plan / evidence refs ALL come from the edit
// row itself; the synthesized rec just satisfies the type contract.
// Fields the synthesized rec can't populate (clusterLabel, motive,
// pageBrief, topCompetitor) are null/empty — same as today for recs
// whose resolution didn't emit them.
//
// Result: v2 cold render goes from ~33 s to a handful of small reads
// (~500 ms expected on Vercel/Supabase). The cache wrapper still
// applies (60 s TTL + same tag); on a warm hit it's ~50 ms.
// ---------------------------------------------------------------------------

import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { ActionType } from "@/domains/recommendations/action-types";
import type { EvidenceRef } from "@/domains/recommendations/resolved-types";
import type { SpecificEditEvidenceRef } from "@/domains/recommendations/recommended-edits-persistence";

/** Shape consumed by the v2 page + v2 detail page. Mirrors the page-shaped
 *  cached loader's output (queue + watchlist + matrix/null + small
 *  ancillary fields), but produced WITHOUT running the generation
 *  pipeline. `matrix` is null — the v2 client falls back to a sensible
 *  date when null (existing handling). Watchlist is empty — v2 doesn't
 *  surface a watchlist (it lives only in legacy). */
export type PersistedRecommendationQueueForPage = {
  queue: Array<{
    rec: LiveRecQueueItem;
    response: RecommendationResponse | null;
    edits: RecommendedEditRow[];
  }>;
  watchlist: Array<{
    rec: RecommendationCandidate;
    response: RecommendationResponse | null;
    edits: RecommendedEditRow[];
  }>;
  trackedPrompts: TrackedPrompt[];
  recommendedEdits: RecommendedEditRow[];
  changelogEntries: Array<{ id: string; source_rec_id?: string | null }>;
  matrixDateLabel: string;
  errors: string[];
  /**
   * audit-4: true ONLY when a QUEUE-CRITICAL read failed (recommended_edits or
   * recommendation_responses). Distinct from `errors`, which also collects
   * non-queue ENRICHMENT failures (changelog, GSC/SEMrush/Clarity page signals).
   * Today's Do-today card keys its "couldn't load" state off THIS, so a
   * transient enrichment miss on a genuinely-empty queue doesn't cry wolf.
   */
  queueError: boolean;
};

/**
 * Honest "as of" date for the recommendations header (#322). Returns the
 * most recent `updated_at` (ISO sorts lexically, so a string max works)
 * across the persisted edits — i.e. when the recs were actually last
 * produced — sliced to YYYY-MM-DD. Falls back to today ONLY for an empty
 * queue (no edits = no stale data to misrepresent). Pure.
 */
export function deriveMatrixDateLabel(
  edits: ReadonlyArray<{ updated_at?: string | null; created_at?: string | null }>,
): string {
  let latest = "";
  for (const e of edits) {
    const ts = e.updated_at ?? e.created_at ?? "";
    if (typeof ts === "string" && ts > latest) latest = ts;
  }
  return (latest || new Date().toISOString()).slice(0, 10);
}

/** Map an edit's `action_type` (specific-edit taxonomy) to the
 *  `RecommendationAction` (rec-resolution taxonomy) the rec's resolution
 *  carries. Used only for the synthesized resolution on the persisted
 *  loader path. */
function recommendationActionForEdit(
  actionType: ActionType,
): "strengthen_existing_page" | "expand_existing_page" | "add_section_or_faq" | "create_new_page" | "merge_or_dedupe" | "split_or_separate_page" {
  switch (actionType) {
    case "edit_title":
    case "edit_meta":
    case "change_h1":
    case "rewrite_h2":
    case "rewrite_faq":
    case "edit_table_row":
    case "fix_schema":
    case "add_internal_link":
    case "reorder_sections":
      return "strengthen_existing_page";
    case "add_h2_section":
    case "add_table":
    case "add_answer_block":
    case "add_proof_section":
    case "add_comparison_section":
    case "add_cost_section":
    case "add_timeline_section":
    case "add_schema":
      return "expand_existing_page";
    case "add_faq":
      return "add_section_or_faq";
    case "create_page":
      return "create_new_page";
    case "merge_pages":
      return "merge_or_dedupe";
    case "split_page":
      return "split_or_separate_page";
    case "watch":
    default:
      return "strengthen_existing_page";
  }
}

/** Map low/medium/high confidence → severity (same scale). */
function severityFromConfidence(c: "low" | "medium" | "high"): "high" | "medium" | "low" {
  return c;
}

/**
 * Synthesize a minimal `LiveRecQueueItem` from a group of edits sharing
 * the same `rec_id`. Picks the "primary" edit (most recent by
 * created_at) to anchor the resolution. Aggregates affected prompt ids
 * from all edits' evidence arrays.
 */
function synthesizeLiveRecQueueItemFromEdits(
  recId: string,
  edits: ReadonlyArray<RecommendedEditRow>,
  rank: number,
): LiveRecQueueItem {
  // Primary edit = most recent. We don't pick by status because all
  // edits in the group share `rec_id`; the most recent one most
  // accurately reflects the operator's current view of the rec.
  const primary = [...edits].sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  )[0]!;

  // Collect distinct prompt ids referenced across ALL edits' evidence.
  const promptIdSet = new Set<string>();
  for (const e of edits) {
    for (const ref of e.evidence ?? []) {
      const p = (ref as { promptId?: string }).promptId;
      if (typeof p === "string" && p.length > 0) promptIdSet.add(p);
    }
  }
  const affectedPromptIds = Array.from(promptIdSet);

  const action = recommendationActionForEdit(primary.action_type);
  const severity = severityFromConfidence(primary.confidence);

  // Map specific-edit evidence refs (provider shape) to the resolver's
  // EvidenceRef shape. The two have partially-overlapping discriminants;
  // map what's representable, drop the rest.
  const resolverEvidenceRefs: EvidenceRef[] = ((primary.evidence ?? []) as SpecificEditEvidenceRef[])
    .map((r): EvidenceRef | null => {
      if (r.type === "prompt") return { type: "prompt", id: r.promptId };
      if (r.type === "owned_page")
        return { type: "url", url: r.url, citationCount: 0, observationCount: 0 };
      if (r.type === "competitor")
        return { type: "competitor", name: r.competitorName, primaryShare: 0 };
      // `element` + `prior_outcome` aren't representable in the resolver's
      // EvidenceRef union; drop them. The v2 card doesn't surface these
      // beyond the count it derives from the edit's evidence array directly.
      return null;
    })
    .filter((r): r is EvidenceRef => r !== null);

  // Motive is required (not nullable). Pick a sensible default based on
  // the action; the v2 card surfaces this only as a label, not behavior.
  const motive: ResolvedRecommendationCandidate["resolution"]["motive"] =
    action === "create_new_page"
      ? "capture_absent_cluster"
      : action === "expand_existing_page" || action === "add_section_or_faq"
        ? "improve_close_prompt"
        : "improve_citation_depth";

  const resolution: ResolvedRecommendationCandidate["resolution"] = {
    action,
    motive,
    targetUrl: primary.target_url,
    confidence: primary.confidence,
    confidenceReason: primary.why ?? "",
    reasoning: primary.why ?? "",
    tier: "deterministic_only",
    evidenceRefs: resolverEvidenceRefs,
    pageBrief: null,
    suggestedEdits: [],
    risks: primary.risks ?? [],
    cannibalization: null,
    needsHumanReview: false,
  };

  const evidence: RecommendationCandidate["evidence"] = {
    promptCount: affectedPromptIds.length,
    observationCount: 0,
    categoryBreakdown: {},
    dominantCompetitors: [],
    descriptorsNearBrand: [],
    maxSignalStrength: 0,
    primaryCompetitors: [],
    brandPrimaryPromptCount: 0,
    fragmentedPromptCount: 0,
  };

  return {
    stableKey: recId,
    type: "strengthen_page_copy",
    title: primary.display_label ?? "",
    description: primary.why ?? "",
    affectedPromptIds,
    clusterLabel: null,
    clusterKind: null,
    evidence,
    severity,
    effort: primary.difficulty,
    score: 0,
    tier: "later",
    rank,
    reasoning: "",
    resolution,
    engineConfidence: {
      confidence: primary.confidence,
      reasons: [],
    },
  };
}

/**
 * Fast loader for the v2 page render. Reads only persisted rows
 * (recommended_edits + recommendation_responses + tracked_prompts +
 * changelog_entries), synthesizes minimal LiveRecQueueItems from
 * grouped edits, and returns the same envelope the page expects.
 *
 * Cached under the SAME tag (`recs-queue:<tenantId>`) as the full
 * loader so mutation invalidation continues to work uniformly.
 */
export async function loadPersistedRecommendationQueueForPage(opts: {
  tenantId: string;
}): Promise<PersistedRecommendationQueueForPage> {
  const { unstable_cache } = await import("next/cache");
  const { tenantId } = opts;
  const cached = unstable_cache(
    async () => {
      const repo = getRepository().forTenant(tenantId);
      const errors: string[] = [];

      // Five parallel small reads. audit #8 (2026-06-14): the GSC page
      // signals were MISSING here, so the default v2 render path never
      // attached gscSignal — composeRowEvidenceSummary fell through to the
      // AEO "0 AI answers" branch on every card and the GSC priority floors
      // never fired, making the entire GSC-led pivot invisible on prod.
      const { getChangelogEntries } = await import("@/lib/seed-data.server");
      const [
        editsRes,
        responsesRes,
        promptsRes,
        changelogRes,
        gscRes,
        clarityRes,
      ] = await Promise.all([
        safeCall(
          () => repo.getRecommendedEdits(),
          [] as RecommendedEditRow[],
          "persisted: fetch recommended_edits",
        ),
        safeCall(
          () => repo.getRecommendationResponses(),
          [] as RecommendationResponse[],
          "persisted: fetch recommendation_responses",
        ),
        safeCall(
          () => repo.getTrackedPrompts(),
          [] as TrackedPrompt[],
          "persisted: fetch tracked_prompts",
        ),
        safeCall(
          () => getChangelogEntries(),
          [] as Array<{ id: string; source_rec_id?: string | null }>,
          "persisted: fetch changelog_entries",
        ),
        safeCall(
          () => loadGscPageSignalsForTenant(tenantId),
          new Map<string, GscPageSignal>(),
          "persisted: fetch gsc page signals",
        ),
        // 2026-06-15 — Microsoft Clarity per-page signals so the v2 card can
        // quote the on-page FRICTION (rage-clicks / page errors) the search
        // signals can't see. Already-synced data only; soft-fail to empty.
        safeCall(
          () => loadClarityPageSignalsForTenant(tenantId),
          new Map<string, ClarityPageSignal>(),
          "persisted: fetch clarity page signals",
        ),
      ]);

      if (editsRes.error) errors.push(editsRes.error);
      if (responsesRes.error) errors.push(responsesRes.error);
      // audit-4: only the queue-critical reads make the Do-today card claim a
      // LOAD FAILURE. Enrichment failures below stay in `errors` (banner) only.
      const queueError = editsRes.error != null || responsesRes.error != null;
      if (promptsRes.error) errors.push(promptsRes.error);
      if (changelogRes.error) errors.push(changelogRes.error);
      if (gscRes.error) errors.push(gscRes.error);
      if (clarityRes.error) errors.push(clarityRes.error);

      const recommendedEdits = editsRes.value;
      const responses = responsesRes.value;
      const trackedPrompts = promptsRes.value;
      const changelogEntries = changelogRes.value;
      const gscByUrl = gscRes.value;
      const clarityByUrl = clarityRes.value;

      // Group edits by rec_id. Skip edits that have no rec_id (legacy
      // rows that predate the column — extremely rare).
      const editsByRecId = new Map<string, RecommendedEditRow[]>();
      for (const edit of recommendedEdits) {
        if (!edit.rec_id) continue;
        const list = editsByRecId.get(edit.rec_id);
        if (list) list.push(edit);
        else editsByRecId.set(edit.rec_id, [edit]);
      }

      const responseByRecId = new Map<string, RecommendationResponse>();
      for (const r of responses) responseByRecId.set(r.recId, r);

      // Build queue items. Synthesized LiveRecQueueItem per rec_id with
      // at least one edit. Night-shift #48 (2026-06-11): unified
      // ordering replaces the recency-only stand-in — drafted moves
      // (approvable on sight) outrank undrafted; higher confidence
      // outranks lower; recency breaks ties. Mirrors the morning
      // digest's ordering so the email and the page agree.
      const recIds = Array.from(editsByRecId.keys()).sort((a, b) => {
        const sa = queueGroupScore(editsByRecId.get(a)!);
        const sb = queueGroupScore(editsByRecId.get(b)!);
        if (sb !== sa) return sb - sa;
        const aMax = Math.max(
          ...editsByRecId
            .get(a)!
            .map((e) => Date.parse(e.updated_at ?? e.created_at ?? "") || 0),
        );
        const bMax = Math.max(
          ...editsByRecId
            .get(b)!
            .map((e) => Date.parse(e.updated_at ?? e.created_at ?? "") || 0),
        );
        return bMax - aMax;
      });

      const queue = recIds.map((recId, idx) => {
        const edits = editsByRecId.get(recId)!;
        const rec = synthesizeLiveRecQueueItemFromEdits(recId, edits, idx + 1);
        const response = responseByRecId.get(recId) ?? null;
        // audit #8 (2026-06-14): attach the GSC signal by canonical target
        // URL (mirrors the full loader) so composeRowEvidenceSummary leads
        // with Google demand + the GSC priority floors fire on the v2 render.
        const targetUrl = rec.resolution?.targetUrl ?? null;
        const canonical =
          targetUrl != null && targetUrl !== "needs_new_page"
            ? canonicalizeCitationUrl(targetUrl)
            : null;
        const gscSignal =
          canonical != null ? gscByUrl.get(canonical) ?? null : null;
        const claritySignal =
          canonical != null ? clarityByUrl.get(canonical) ?? null : null;
        return {
          rec: { ...rec, gscSignal, claritySignal },
          response,
          edits,
        };
      });

      return {
        queue,
        watchlist: [], // v2 doesn't surface watchlist
        trackedPrompts,
        recommendedEdits,
        changelogEntries,
        // HONESTY (UX_TEARDOWN #322): the header renders this as
        // "Updated {date}." Using `new Date()` made it ALWAYS say today even
        // when the recs are weeks stale — a freshness lie. Reflect when the
        // recs were actually last produced (latest edit `updated_at`); fall
        // back to today only for an empty queue (no stale data to misstate).
        matrixDateLabel: deriveMatrixDateLabel(recommendedEdits),
        errors,
        queueError,
      };
    },
    ["recs-persisted:v1", tenantId],
    {
      revalidate: REC_QUEUE_CACHE_TTL_SECONDS,
      tags: [buildRecQueueCacheTag(tenantId)],
    },
  );
  return cached();
}
