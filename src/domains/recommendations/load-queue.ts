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
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";

/**
 * Output of `loadLiveRecommendationQueue`. Shape mirrors what the
 * `/recommendations` page render needs, plus the intermediate inputs
 * the CLI uses to build SpecificEditEvidencePackets.
 */
export type LiveRecommendationQueue = {
  queue: PrioritizedRecommendation[];
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

  const seedRes = await safeCall(
    () => ensureCanonicalStoresSeeded(),
    undefined,
    "seed canonical stores",
  );
  if (seedRes.error) errors.push(seedRes.error);
  const respSeedRes = await safeCall(
    () => ensureRecommendationResponsesSeeded(),
    undefined,
    "seed recommendation responses",
  );
  if (respSeedRes.error) errors.push(respSeedRes.error);

  const freshCanonRes = await safeCall(
    () => loadFreshCanonicalData(),
    {
      trackedPrompts: [],
      promptAnswerObservations: [],
      trackedEntities: [],
      dailyMetricSnapshots: [],
    },
    "fetch fresh canonical data",
  );
  if (freshCanonRes.error) errors.push(freshCanonRes.error);
  const { trackedPrompts, promptAnswerObservations, trackedEntities } =
    freshCanonRes.value;

  const matrixRes = await safeCall(
    () =>
      buildPromptDecisionMatrix({
        prompts: trackedPrompts,
        observations: promptAnswerObservations,
        activeEntities: trackedEntities,
        now: opts.now ?? new Date(),
      }),
    null,
    "build decision matrix",
  );
  if (matrixRes.error) errors.push(matrixRes.error);
  const matrix = matrixRes.value;

  if (!matrix) {
    return {
      queue: [],
      watchlist: [],
      matrix: null,
      trackedPrompts,
      trackedEntities,
      promptAnswerObservations,
      pageInventory: [],
      errors,
    };
  }

  const candidates = (
    await safeCall(
      () =>
        generateRecommendations({
          matrix,
          activeEntities: trackedEntities,
          trackedPrompts,
        }),
      [],
      "generate candidates",
    )
  ).value;

  // Phase 14 (2026-04-24): fetch pages + snapshots via the repository
  // instead of importing the seeded `allPages` module. The seeded
  // module uses top-level await which breaks `tsx → esbuild` CJS
  // transform that the CLI runs through. The repo call returns the
  // same data; both backends already cache appropriately.
  // Sprint 7 Phase 7.5b Commit 3 (2026-04-25) — tenant-bound reads.
  // `tenantId` is required by `LoadLiveRecommendationQueueOptions` (Phase 7.3).
  const pages = (
    await safeCall(
      async () => getRepository().forTenant(tenantId).getPages(),
      [] as PageEntity[],
      "fetch pages",
    )
  ).value;
  const pageSnapshots = (
    await safeCall(
      async () => getRepository().forTenant(tenantId).getPageSnapshots(),
      [],
      "fetch page snapshots",
    )
  ).value;

  const pageInventory = (
    await safeCall(
      () =>
        buildPageInventory({
          pages,
          snapshots: pageSnapshots,
          activeEntities: trackedEntities,
        }),
      [],
      "build page inventory",
    )
  ).value;

  const resolved: ResolvedRecommendationCandidate[] = (
    await safeCall(
      () =>
        resolvePageIntent({
          candidates,
          observations: promptAnswerObservations,
          activeEntities: trackedEntities,
          pageInventory,
        }),
      [] as ResolvedRecommendationCandidate[],
      "resolve page intent",
    )
  ).value;

  const adjudicated: ResolvedRecommendationCandidate[] = [];
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
      adjudicated.push(
        applyAdjudicationToResolution(candidate, result.value.output),
      );
    } else {
      adjudicated.push(candidate);
    }
  }

  const prioritized = (
    await safeCall(
      () => prioritizeRecommendations(adjudicated),
      {
        queue: [] as PrioritizedRecommendation[],
        watchlist: [] as RecommendationCandidate[],
      },
      "prioritize recommendations",
    )
  ).value;

  return {
    queue: prioritized.queue,
    watchlist: prioritized.watchlist,
    matrix,
    trackedPrompts,
    trackedEntities,
    promptAnswerObservations,
    pageInventory,
    errors,
  };
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
    now,
  });
}
