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
 * Companion helper `buildPacketForRec` produces a
 * `SpecificEditEvidencePacket` for one queue rec using the orchestration
 * outputs + a fetched `pageElementInventory`. The page does NOT call this
 * helper; only the CLI (and Sprint 6A.2's evidence-cache builder) does.
 *
 * Pure of side effects EXCEPT the seeding calls + repository reads —
 * matches what the page render already does.
 */

import "server-only";

import { adjudicateFromCacheOnly, applyAdjudicationToResolution } from "./adjudicate";
import { buildPageInventory, type PageInventoryEntry } from "./page-inventory";
import { generateRecommendations, type RecommendationCandidate } from "./generate";
import {
  prioritizeRecommendations,
  type PrioritizedRecommendation,
} from "./prioritize";
import { resolvePageIntent } from "./resolve-page-intent";
import type { PageEntity } from "@/domains/pages/types";
import type { CrossTenantPattern } from "./cross-tenant-brain";
import {
  buildSpecificEditEvidencePacket,
  hasAiSearchSignalForRec,
  hasCompetitorPageBlueprintsForRec,
  type SpecificEditEvidencePacket,
} from "./specific-edit-evidence";
import type { ResolvedRecommendationCandidate } from "./resolved-types";
import { buildPromptDecisionMatrix, type DecisionMatrix } from "@/domains/prompts/decision-matrix";
import { getRepository } from "@/lib/persistence/repositories";
import {
  ensureCanonicalStoresSeeded,
  loadFreshCanonicalData,
} from "@/storage/canonical-store";
import { ensureRecommendationResponsesSeeded } from "@/domains/product/recommendation-response-store";
import { createPerfTrace } from "@/lib/perf-trace";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import {
  getCompetitorPageSnapshotsByUrl,
  type CompetitorPageSnapshot,
} from "@/domains/pages/competitor-page-snapshots";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import {
  computeRecConfidence,
  type RecConfidenceVerdict,
} from "./confidence";
import type { RecommendedEditRow } from "./recommended-edits-persistence";
import {
  loadGscPageSignalsForTenant,
  type GscPageSignal,
} from "@/domains/recommendation-intelligence/gsc-page-signals";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";

/**
 * W3 Step 3.3 (2026-05-01) — `PrioritizedRecommendation` decorated with
 * the engine confidence verdict. The pipeline stamps it once per rec
 * so every consumer (page render, CLI, future Step 3.4 LLM activator)
 * reads the same trust label. Field is required (never undefined) so
 * UI / log surfaces don't have to defensively branch.
 */
export type LiveRecQueueItem = PrioritizedRecommendation & {
  engineConfidence: RecConfidenceVerdict;
  /** Pivot (2026-06-13) — per-page Google Search Console signal for this rec's
   *  target URL (28-day clicks/impressions/CTR/position/top queries), or null
   *  when the page has no GSC data. Lets the card lead with first-party search
   *  demand instead of AEO citations. */
  gscSignal?: GscPageSignal | null;
};

/**
 * Output of `loadLiveRecommendationQueue`. Shape mirrors what the
 * `/recommendations` page render needs, plus the intermediate inputs
 * the CLI uses to build SpecificEditEvidencePackets.
 */
export type LiveRecommendationQueue = {
  queue: LiveRecQueueItem[];
  /** Watchlist items are the unprioritized winning-cluster `watch` recs
   *  — `prioritizeRecommendations` never adds rank/score/tier to them. */
  watchlist: RecommendationCandidate[];
  /** Null only when the matrix step failed catastrophically — page
   *  renders an error banner; CLI exits with a non-zero code. */
  matrix: DecisionMatrix | null;
  trackedPrompts: TrackedPrompt[];
  trackedEntities: TrackedEntity[];
  promptAnswerObservations: PromptAnswerObservation[];
  pageInventory: PageInventoryEntry[];
  /**
   * W3 Step 3.3 (2026-05-01) — recommended_edits rows fresh-read by
   * the loader so the page render and the engineConfidence stamp
   * see the same set. Page consumers can use this directly instead
   * of re-fetching.
   */
  recommendedEdits: RecommendedEditRow[];
  /**
   * T-CompPageBlueprints (2026-05-08) — manually-captured competitor
   * page snapshots, keyed by url. Empty Map when no scanner has run
   * (today's default state). When populated, the LLM packet's
   * competitorPageBlueprints get real h1/topH2s/faqQuestions/
   * metaDescription instead of hardcoded null/[].
   */
  competitorPageSnapshotsByUrl: Map<string, CompetitorPageSnapshot>;
  /**
   * T-CompPageBlueprints (2026-05-08) — flat list of brand-name
   * aliases the blueprint scrub drops from any captured h1/topH2s/
   * faqQuestions. Includes operator's own brand (tracked-entities
   * row is_owned=true) + every active competitor name.
   */
  competitorBlueprintBrandScrubAliases: string[];
  /** Per-step error strings collected via `safeCall`. Empty when
   *  everything succeeded. The page surfaces these in a banner; the
   *  CLI prints them to stderr. */
  errors: string[];
};

export type LoadLiveRecommendationQueueOptions = {
  /** Required tenant scope. Used by the adjudicator cache-read step
   *  (key namespace) and threaded through to packet builders. Sprint 7
   *  Phase 7.3 (2026-04-25): plumbed through from `currentTenantId()`;
   *  callers must resolve and pass this explicitly. */
  tenantId: string;
  /** Override the "now" used by `buildPromptDecisionMatrix`. Useful
   *  for deterministic tests; defaults to `new Date()`. */
  now?: Date;
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
 * Run the full orchestration the `/recommendations` page used to inline.
 * Returns a `LiveRecommendationQueue` with the decorated queue + every
 * intermediate input the CLI needs to build packets.
 */
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

export async function loadLiveRecommendationQueue(
  opts: LoadLiveRecommendationQueueOptions,
): Promise<LiveRecommendationQueue> {
  const { tenantId } = opts;
  const errors: string[] = [];

  // Emergency P0 fix (2026-05-12) — granular tracing inside the
  // recommendation queue loader. NOOP when `BEACON_PERF_TRACE != "true"`.
  // When enabled, emits one log line per major sub-step so the next
  // production capture can identify which call dominates the measured
  // 33 s loader time (vs the existing single-line "loadLiveRecommendationQueue
  // ms=33004" which gives us no decomposition).
  const trace = createPerfTrace("load-queue", { route: "internal" });

  const seedRes = await trace.time("seed_canonical_stores", () =>
    safeCall(
      () => ensureCanonicalStoresSeeded(),
      undefined,
      "seed canonical stores",
    ),
  );
  if (seedRes.error) errors.push(seedRes.error);
  const respSeedRes = await trace.time("seed_recommendation_responses", () =>
    safeCall(
      () => ensureRecommendationResponsesSeeded(),
      undefined,
      "seed recommendation responses",
    ),
  );
  if (respSeedRes.error) errors.push(respSeedRes.error);

  // EGRESS-P0 (2026-05-07) — bound the observations window. Without a
  // `since`, this loads ALL observations from prompt_answer_observations
  // (the largest table in the system) on every /recommendations
  // navigation. Recommendations only need recent activity to evaluate;
  // 60 days covers every confidence/dedup window the engine consults.
  // Snapshots window is wider (120 days) to keep verdict-baseline math
  // honest. Pinned by tests/architecture/egress-bounded-reads-p0.test.ts.
  const NOW_MS = Date.now();
  const observationsSince = new Date(NOW_MS - 60 * 86_400_000).toISOString();
  const snapshotsSince = new Date(NOW_MS - 120 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const freshCanonRes = await trace.time("loadFreshCanonicalData", () =>
    safeCall(
      () => loadFreshCanonicalData({ observationsSince, snapshotsSince }),
      {
        trackedPrompts: [],
        promptAnswerObservations: [],
        trackedEntities: [],
        dailyMetricSnapshots: [],
      },
      "fetch fresh canonical data",
    ),
  );
  if (freshCanonRes.error) errors.push(freshCanonRes.error);
  const { trackedPrompts, promptAnswerObservations, trackedEntities } =
    freshCanonRes.value;

  const matrixRes = await trace.time("buildPromptDecisionMatrix", () =>
    safeCall(
      () =>
        buildPromptDecisionMatrix({
          prompts: trackedPrompts,
          observations: promptAnswerObservations,
          activeEntities: trackedEntities,
          now: opts.now ?? new Date(),
        }),
      null,
      "build decision matrix",
    ),
  );
  if (matrixRes.error) errors.push(matrixRes.error);
  const matrix = matrixRes.value;

  if (!matrix) {
    trace.data("outcome", "no_matrix");
    trace.flush();
    return {
      queue: [],
      watchlist: [],
      matrix: null,
      trackedPrompts,
      trackedEntities,
      promptAnswerObservations,
      pageInventory: [],
      recommendedEdits: [],
      competitorPageSnapshotsByUrl: new Map(),
      competitorBlueprintBrandScrubAliases: [],
      errors,
    };
  }

  const candidates = (
    await trace.time("generateRecommendations", () =>
      safeCall(
        () =>
          generateRecommendations({
            matrix,
            activeEntities: trackedEntities,
            trackedPrompts,
          }),
        [],
        "generate candidates",
      ),
    )
  ).value;
  trace.data("candidates_count", candidates.length);

  // Phase 14 (2026-04-24): fetch pages + snapshots via the repository
  // instead of importing the seeded `allPages` module. The seeded
  // module uses top-level await which breaks `tsx → esbuild` CJS
  // transform that the CLI runs through. The repo call returns the
  // same data; both backends already cache appropriately.
  // Sprint 7 Phase 7.5b Commit 3 (2026-04-25) — tenant-bound reads.
  // `tenantId` is required by `LoadLiveRecommendationQueueOptions` (Phase 7.3).
  const [pagesValue, pageSnapshotsValue] = await trace.time(
    "pages+snapshots_parallel",
    () =>
      Promise.all([
        trace.time("tenantRepo.getPages", async () =>
          safeCall(
            async () => getRepository().forTenant(tenantId).getPages(),
            [] as PageEntity[],
            "fetch pages",
          ).then((r) => r.value),
        ),
        trace.time("tenantRepo.getPageSnapshots", async () =>
          safeCall(
            async () => getRepository().forTenant(tenantId).getPageSnapshots(),
            [],
            "fetch page snapshots",
          ).then((r) => r.value),
        ),
      ]),
  );
  const pages = pagesValue;
  const pageSnapshots = pageSnapshotsValue;
  trace.data("pages_count", pages.length);
  trace.data("page_snapshots_count", pageSnapshots.length);

  const pageInventory = (
    await trace.time("buildPageInventory", () =>
      safeCall(
        () =>
          buildPageInventory({
            pages,
            snapshots: pageSnapshots,
            activeEntities: trackedEntities,
          }),
        [],
        "build page inventory",
      ),
    )
  ).value;

  const resolved: ResolvedRecommendationCandidate[] = (
    await trace.time("resolvePageIntent", () =>
      safeCall(
        () =>
          resolvePageIntent({
            candidates,
            observations: promptAnswerObservations,
            activeEntities: trackedEntities,
            pageInventory,
          }),
        [] as ResolvedRecommendationCandidate[],
        "resolve page intent",
      ),
    )
  ).value;

  const adjudicated: ResolvedRecommendationCandidate[] = await trace.time(
    "adjudicator_loop",
    async () => {
      const out: ResolvedRecommendationCandidate[] = [];
      for (const candidate of resolved) {
        const result = await safeCall(
          () =>
            adjudicateFromCacheOnly({
              tenantId,
              candidate,
              matrixPrompts: matrix.prompts,
              trackedPrompts,
              activeEntities: trackedEntities,
              observations: promptAnswerObservations,
              pageInventory,
            }),
          null,
          `adjudicator cache read ${candidate.stableKey}`,
        );
        if (result.value && result.value.status === "ok") {
          out.push(
            applyAdjudicationToResolution(candidate, result.value.output),
          );
        } else {
          out.push(candidate);
        }
      }
      return out;
    },
  );
  trace.data("adjudicated_count", adjudicated.length);

  const prioritized = (
    await trace.time("prioritizeRecommendations", () =>
      safeCall(
        () => prioritizeRecommendations(adjudicated),
        {
          queue: [] as PrioritizedRecommendation[],
          watchlist: [] as RecommendationCandidate[],
        },
        "prioritize recommendations",
      ),
    )
  ).value;

  // W3 Step 3.3 (2026-05-01) — fresh-read recommended_edits for the
  // engine-confidence stamp. Same source the page render fetches; we
  // load it here so the rec carries its trust label and the page
  // doesn't double-fetch. Failure here gracefully degrades — recs get
  // engineConfidence = "low" with reason "no_edits".
  const editsRes = await trace.time("tenantRepo.getRecommendedEdits", () =>
    safeCall(
      () => getRepository().forTenant(tenantId).getRecommendedEdits(),
      [] as RecommendedEditRow[],
      "fetch recommended_edits",
    ),
  );
  if (editsRes.error) errors.push(editsRes.error);
  const recommendedEdits = editsRes.value;
  const editsByRecId = new Map<string, RecommendedEditRow[]>();
  for (const row of recommendedEdits) {
    const list = editsByRecId.get(row.rec_id);
    if (list) list.push(row);
    else editsByRecId.set(row.rec_id, [row]);
  }

  // Competitor name list for the leakage guard. Sourced from active
  // competitor entities; directories + brand entities are excluded.
  // Empty list disables the check (defensive — the validator already
  // ran the same check at write time; this is defense-in-depth).
  const competitorNames = trackedEntities
    .filter((e) => e.entity_type === "competitor" && e.is_active)
    .map((e) => e.name)
    .filter((n) => n.length >= 3);

  // Pivot (2026-06-13) — per-page GSC signals so each card can lead with
  // first-party search demand (impressions/CTR/position) when present. One
  // bounded Supabase read; soft-fail to empty so the queue still renders.
  const gscRes = await trace.time("loadGscPageSignals", () =>
    safeCall(
      () => loadGscPageSignalsForTenant(tenantId, opts.now),
      new Map<string, GscPageSignal>(),
      "load GSC page signals",
    ),
  );
  if (gscRes.error) errors.push(gscRes.error);
  const gscByUrl = gscRes.value;

  trace.mark("decoration_loop_start");
  const decoratedQueue: LiveRecQueueItem[] = prioritized.queue.map((rec) => {
    const edits = editsByRecId.get(rec.stableKey) ?? [];
    const affectedPromptIds = rec.affectedPromptIds ?? [];
    // W3 Step 3.4 (2026-05-02) — close the loop. Real packet signals
    // derived from the same observations the LLM provider will
    // receive when it activates. Cheap (per-rec scan over already-
    // loaded observations of affected prompts; no extra I/O). HIGH
    // is now reachable when the rec has multi-prompt validation +
    // grounded packet evidence + every other dimension passes.
    const hasAiSearchSignal = hasAiSearchSignalForRec({
      affectedPromptIds,
      observations: promptAnswerObservations,
      trackedEntities,
    });
    const hasCompetitorPageBlueprints = hasCompetitorPageBlueprintsForRec({
      affectedPromptIds,
      observations: promptAnswerObservations,
      ownedPageInventory: pageInventory,
    });
    const engineConfidence = computeRecConfidence({
      // Defensive reads: synthetic test fixtures occasionally omit
      // these fields. Pre-W3 page-render tests want to exercise the
      // UI layer without filling the full RecommendationCandidate
      // shape; treat missing values as zero/empty so the stamp never
      // crashes the page render.
      affectedPromptCount: affectedPromptIds.length,
      resolverTier: rec.resolution?.tier ?? "deterministic_only",
      resolutionConfidence: rec.resolution?.confidence ?? "low",
      needsHumanReview: rec.resolution?.needsHumanReview ?? false,
      evidenceRefCount: rec.resolution?.evidenceRefs?.length ?? 0,
      edits,
      hasAiSearchSignal,
      hasCompetitorPageBlueprints,
      competitorNames,
    });
    const targetUrl = rec.resolution?.targetUrl ?? null;
    const canonical =
      targetUrl != null && targetUrl !== "needs_new_page"
        ? canonicalizeCitationUrl(targetUrl)
        : null;
    const gscSignal = canonical != null ? gscByUrl.get(canonical) ?? null : null;
    return { ...rec, engineConfidence, gscSignal };
  });
  trace.mark("decoration_loop_end");
  trace.data("queue_count", decoratedQueue.length);
  trace.data("watchlist_count", prioritized.watchlist.length);

  // T-CompPageBlueprints (2026-05-08) — load competitor page
  // structural snapshots (manual scanner output) and assemble the
  // brand-scrub alias list (operator brand from tracked-entities
  // is_owned=true + every active competitor name). Both are passed
  // through to `buildPacketForRec` so `competitorPageBlueprints`
  // gets real h1/topH2s/faqQuestions/metaDescription instead of
  // hardcoded null/[]. Empty Map preserves byte-identical pre-patch
  // behavior for tenants that haven't run the scanner.
  const compSnapshotsRes = await trace.time(
    "getCompetitorPageSnapshotsByUrl",
    () =>
      safeCall(
        () => getCompetitorPageSnapshotsByUrl(),
        new Map<string, CompetitorPageSnapshot>(),
        "load competitor page snapshots",
      ),
  );
  if (compSnapshotsRes.error) errors.push(compSnapshotsRes.error);
  const competitorPageSnapshotsByUrl = compSnapshotsRes.value;
  const competitorBlueprintBrandScrubAliases = trackedEntities
    .filter(
      (e) =>
        e.is_active &&
        (e.is_owned === true || e.entity_type === "competitor"),
    )
    .map((e) => e.name)
    .filter((n) => typeof n === "string" && n.length >= 3);

  trace.data("errors_count", errors.length);
  trace.flush();
  return {
    queue: decoratedQueue,
    watchlist: prioritized.watchlist,
    matrix,
    trackedPrompts,
    trackedEntities,
    promptAnswerObservations,
    pageInventory,
    recommendedEdits,
    competitorPageSnapshotsByUrl,
    competitorBlueprintBrandScrubAliases,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Emergency P0 v4 (2026-05-12) — cached wrapper for the page-render path.
//
// The full `loadLiveRecommendationQueue` runs a long pipeline (canonical
// seed → matrix → generate → page reads → resolve → adjudicate loop →
// prioritize → edits read → comp snapshots → decoration) measured at
// ~33 s on cold Vercel in production. The user-visible result for one
// tenant is deterministic across a short window — page renders within
// ~60 s of a mutation-free interval can serve the same result.
//
// `loadLiveRecommendationQueueForPage` wraps the loader with
// `unstable_cache`, keyed on tenantId, TTL 60 s, tag
// `recs-queue:<tenantId>`. The 7 mutation server actions in
// `src/app/(shell)/recommendations/actions.ts` call
// `revalidateTag(buildRecQueueCacheTag(tenantId))` so accept / defer /
// dismiss / shipped / restore / promote / undo invalidate the cache
// IMMEDIATELY — no stale action state is ever served.
//
// Return shape strips `competitorPageSnapshotsByUrl` (a `Map`) which:
//   (1) doesn't round-trip safely across Next's cache serialization,
//   (2) is only consumed by the CLI's `buildPacketForRec`, never by the
//       page render. Test fixtures and the CLI continue to use the
//       uncached `loadLiveRecommendationQueue` directly.
//
// Cache scope: per-tenant. The cache key is `["recs-queue:v1", tenantId]`;
// no cross-tenant bleed is possible. `revalidateTag` is also tenant-scoped.
// ---------------------------------------------------------------------------

/** Tag string for `revalidateTag` from mutation actions. Shared between
 *  the cached wrapper (`tags: [...]`) and the mutation actions
 *  (`revalidateTag(...)`). */
export function buildRecQueueCacheTag(tenantId: string): string {
  return `recs-queue:${tenantId}`;
}

const REC_QUEUE_CACHE_TTL_SECONDS = 60;

/** Page-render-only shape — drops the non-serializable Map field. */
export type PageShapedLiveRecommendationQueue = Omit<
  LiveRecommendationQueue,
  "competitorPageSnapshotsByUrl"
>;

/**
 * Cached page-shaped loader. Pages call this; tests + CLI call the raw
 * `loadLiveRecommendationQueue` (uncached, unmodified). Cache invalidates
 * on TTL expiry (60 s) OR `revalidateTag(buildRecQueueCacheTag(tenantId))`.
 */
export async function loadLiveRecommendationQueueForPage(opts: {
  tenantId: string;
}): Promise<PageShapedLiveRecommendationQueue> {
  const { unstable_cache } = await import("next/cache");
  const { tenantId } = opts;
  const cached = unstable_cache(
    async () => {
      const full = await loadLiveRecommendationQueue({ tenantId });
      // Strip Map — see header comment.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { competitorPageSnapshotsByUrl: _drop, ...rest } = full;
      return rest;
    },
    ["recs-queue:v1", tenantId],
    {
      revalidate: REC_QUEUE_CACHE_TTL_SECONDS,
      tags: [buildRecQueueCacheTag(tenantId)],
    },
  );
  return cached();
}

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
import type { SpecificEditEvidenceRef } from "@/domains/recommendations/specific-edit-provider";

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
};

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

      // Four parallel small reads.
      const { getChangelogEntries } = await import("@/lib/seed-data.server");
      const [editsRes, responsesRes, promptsRes, changelogRes] = await Promise.all([
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
      ]);

      if (editsRes.error) errors.push(editsRes.error);
      if (responsesRes.error) errors.push(responsesRes.error);
      if (promptsRes.error) errors.push(promptsRes.error);
      if (changelogRes.error) errors.push(changelogRes.error);

      const recommendedEdits = editsRes.value;
      const responses = responsesRes.value;
      const trackedPrompts = promptsRes.value;
      const changelogEntries = changelogRes.value;

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
        return { rec, response, edits };
      });

      return {
        queue,
        watchlist: [], // v2 doesn't surface watchlist
        trackedPrompts,
        recommendedEdits,
        changelogEntries,
        matrixDateLabel: new Date().toISOString().slice(0, 10),
        errors,
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

// ---------------------------------------------------------------------------
// Packet builder for one queue rec — pure given the queue context + the
// inventory rows. The CLI calls this; the page does NOT (the page only
// renders the queue + previously-persisted edits).
// ---------------------------------------------------------------------------

export type BuildPacketForRecArgs = {
  rec: PrioritizedRecommendation;
  context: LiveRecommendationQueue;
  pageElementInventory: ReadonlyArray<PageElementInventoryRow>;
  tenantId: string;
  now?: Date;
  /**
   * Phase A.2 §3.2 — pre-computed cross-tenant patterns from the async
   * producer, threaded through the sync packet-build chain. Omitted by
   * every current caller → the packet builder falls back to the sync
   * stub ([]), so byte-identical until the async ancestor computes +
   * passes real patterns (gated by BEACON_CROSS_TENANT_BRAIN).
   */
  crossTenantPatterns?: ReadonlyArray<CrossTenantPattern>;
};

/**
 * Build a `SpecificEditEvidencePacket` for one queue rec. Pure
 * function: given the same `context + pageElementInventory`, it
 * produces the same packet.
 *
 * `targetPageElements` will be empty when the inventory is empty
 * (production today, before a scan has run after Phase 6 wiring).
 * Callers should report this honestly rather than pretend the
 * downstream generators have signal to work with — `add_h2_section`
 * and `add_faq` would propose against a phantom baseline.
 */
export function buildPacketForRec(
  args: BuildPacketForRecArgs,
): SpecificEditEvidencePacket {
  const { rec, context, pageElementInventory, tenantId, now } = args;
  if (!context.matrix) {
    throw new Error(
      "buildPacketForRec: matrix is null (load-queue step failed) — cannot build packet",
    );
  }

  const primarySummaries = Object.values(context.matrix.primaryByPromptId);

  return buildSpecificEditEvidencePacket({
    tenantId,
    crossTenantPatterns: args.crossTenantPatterns,
    recId: rec.stableKey,
    clusterLabel: rec.clusterLabel,
    clusterKind: rec.clusterKind,
    affectedPromptIds: rec.affectedPromptIds,
    promptOpportunities: context.matrix.prompts,
    trackedPrompts: context.trackedPrompts,
    primarySummaries,
    ownedPageInventory: context.pageInventory,
    pageElementInventory,
    // Sprint 6A.2g.E (2026-04-26) — packet enrichment. Thread the full
    // observation set already loaded by `loadLiveRecommendationQueue`
    // so the packet builder can aggregate Phase D extraction (search
    // queries the AI emitted), citation URLs (sources to outrank), and
    // descriptor windows (tone-mirroring) per affected prompt. The
    // builder filters by affectedPromptIds internally — passing the
    // full set keeps `buildPacketForRec` pure of further repository
    // reads. Pre-Phase-D observations contribute empty arrays (graceful
    // — see Phase D.1 report; ~986 legacy native-poll rows lack the
    // metadata.extracted block).
    observations: context.promptAnswerObservations,
    // Step 1.4 (master plan) — thread the tracked-entity registry so the
    // packet's `competitorAngles` block excludes directories + generic
    // nouns, matching the /today leaderboard's filter.
    trackedEntities: context.trackedEntities,
    // Sprint 6A.2g.A (2026-04-26) — strict target alignment. The
    // page-intent resolver runs before prioritization (load-queue step
    // 6) and stamps `rec.resolution.targetUrl` on every queued rec.
    // Threading it here forces `allowedTargetUrls` to anchor the LLM
    // to the rec's resolved page (or `needs_new_page` for create/page-
    // level recs). Falls back to `null` only if the resolver was
    // skipped, preserving the legacy candidate-set behavior for
    // graceful degradation.
    singleTargetUrl: rec.resolution?.targetUrl ?? null,
    // LLM-DryRun-3 (2026-05-05) — surface the FULL resolver context
    // (confidence + tier + action) so the LLM's structural-abstention
    // rule (Rule 16.A trigger 2) can actually fire. Before this, the
    // model could see brandAssertions empty but had no way to evaluate
    // `confidence === "low"` for multi-prompt packets — the rule was
    // structurally unenforceable in that branch. With this in place
    // the JSON-stringified user message carries a literal
    // `"resolution": { "confidence": "low", ... }` block.
    resolution: rec.resolution
      ? {
          confidence: rec.resolution.confidence,
          tier: rec.resolution.tier,
          action: rec.resolution.action,
        }
      : null,
    // T-CompPageBlueprints (2026-05-08) — populates competitor page
    // h1/topH2s/faqQuestions/metaDescription on blueprints. Empty Map
    // preserves pre-patch byte-identical behavior.
    competitorPageSnapshotsByUrl: context.competitorPageSnapshotsByUrl,
    competitorBlueprintBrandScrubAliases:
      context.competitorBlueprintBrandScrubAliases,
    now,
  });
}
