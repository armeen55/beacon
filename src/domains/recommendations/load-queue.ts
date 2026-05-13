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

/**
 * W3 Step 3.3 (2026-05-01) — `PrioritizedRecommendation` decorated with
 * the engine confidence verdict. The pipeline stamps it once per rec
 * so every consumer (page render, CLI, future Step 3.4 LLM activator)
 * reads the same trust label. Field is required (never undefined) so
 * UI / log surfaces don't have to defensively branch.
 */
export type LiveRecQueueItem = PrioritizedRecommendation & {
  engineConfidence: RecConfidenceVerdict;
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
    return { ...rec, engineConfidence };
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
