import "server-only";

// v7 Commit 3 (2026-04-23): GPT-5-mini adjudicator runs on Layer 1/2
// fall-throughs. Build-time prerender would hit the real API — mark the
// route dynamic so it renders per-request only.
export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/data/page-header";
import {
  ensureCanonicalStoresSeeded,
  loadFreshCanonicalData,
} from "@/storage/canonical-store";
import { buildPromptDecisionMatrix } from "@/domains/prompts/decision-matrix";
import { generateRecommendations } from "@/domains/recommendations/generate";
import { resolvePageIntent } from "@/domains/recommendations/resolve-page-intent";
import { buildPageInventory } from "@/domains/recommendations/page-inventory";
import { prioritizeRecommendations } from "@/domains/recommendations/prioritize";
import {
  adjudicateFromCacheOnly,
  applyAdjudicationToResolution,
} from "@/domains/recommendations/adjudicate";
import { allPages } from "@/domains/pages/page-store";
import { getRepository } from "@/lib/persistence/repositories";
import {
  ensureRecommendationResponsesSeeded,
  type RecommendationResponse,
} from "@/domains/product/recommendation-response-store";
import { RecommendationsClient } from "./recommendations-client";

/**
 * /recommendations — the ranked decision queue (Phase v6 Commit 4, 2026-04-23).
 *
 * Server-side flow:
 *   1. Seed canonical stores from Supabase.
 *   2. Build the Phase-v5 DecisionMatrix (prompts + observations + entities),
 *      which now includes the primaryByPromptId rollup from Commit 3.
 *   3. Generate unranked candidates via the pure generator.
 *   4. Split into queue + watchlist with the transparent-rubric prioritizer.
 *   5. Join operator decision state (accepted / deferred / dismissed).
 *   6. Pass to the client for interactive accept / defer / dismiss.
 *
 * Design constraint: decision-shaped, not analytics-shaped. No charts.
 * No scores rendered as numbers next to rows (score is available for
 * power users via drilldown if ever needed; v1 shows reasoning string
 * instead). Operator should read the top row and know what to do.
 */
/**
 * Hard rule (stabilization 2026-04-24): no layer is allowed to 500 this
 * route. Every step is try/catch-wrapped with a safe fallback. If any
 * layer fails, we render as much as we have and surface a small banner
 * instead of crashing.
 */
async function safeCall<T>(fn: () => Promise<T> | T, fallback: T, label: string): Promise<{ value: T; error: string | null }> {
  try {
    const v = await fn();
    return { value: v, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[recommendations] ${label} failed:`, msg);
    return { value: fallback, error: `${label}: ${msg}` };
  }
}

export default async function RecommendationsPage() {
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

  // Phase 4.9 (Sprint 4, 2026-04-24): fetch canonical arrays FRESH from the
  // repository per render. The module-level arrays in canonical-store.ts
  // are seeded once per Vercel lambda behind `_canonSeeded`; after the
  // 07:00 UTC poll writes fresh observations to Supabase, already-warm
  // lambdas kept serving yesterday's data. On repo failure we surface the
  // error banner and fall through to empty arrays (never stale module state).
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
  const {
    trackedPrompts,
    promptAnswerObservations,
    trackedEntities,
  } = freshCanonRes.value;

  const matrixRes = await safeCall(
    () =>
      buildPromptDecisionMatrix({
        prompts: trackedPrompts,
        observations: promptAnswerObservations,
        activeEntities: trackedEntities,
        now: new Date(),
      }),
    null,
    "build decision matrix",
  );
  if (matrixRes.error) errors.push(matrixRes.error);
  const matrix = matrixRes.value;

  if (!matrix) {
    return (
      <div className="max-w-4xl">
        <PageHeader
          title="Recommendations"
          description="Decision queue temporarily unavailable."
        />
        <ErrorFallback errors={errors} />
      </div>
    );
  }

  const candidates = (await safeCall(
    () =>
      generateRecommendations({
        matrix,
        activeEntities: trackedEntities,
        trackedPrompts,
      }),
    [],
    "generate candidates",
  )).value;

  const pageSnapshots = (await safeCall(
    async () => {
      const repo = getRepository();
      return repo.getPageSnapshots();
    },
    [],
    "fetch page snapshots",
  )).value;

  const pageInventory = (await safeCall(
    () =>
      buildPageInventory({
        pages: allPages,
        snapshots: pageSnapshots,
        activeEntities: trackedEntities,
      }),
    [],
    "build page inventory",
  )).value;

  const resolved = (await safeCall(
    () =>
      resolvePageIntent({
        candidates,
        observations: promptAnswerObservations,
        activeEntities: trackedEntities,
        pageInventory,
      }),
    [],
    "resolve page intent",
  )).value;

  // v7 Commit 3 (2026-04-23) + stabilization (2026-04-24): the adjudicator
  // only reads cache on the render path. Live LLM calls run out-of-band
  // (explicit opt-in API route / cron) because 5 × 30s sequential calls
  // would exceed Vercel's serverless timeout. Cache hit = adjudicated
  // tier; cache miss = Layer 1/2 output, no blocking I/O.
  const adjudicated: typeof resolved = [];
  for (const candidate of resolved) {
    const result = await safeCall(
      () =>
        adjudicateFromCacheOnly({
          customerId: "ritz",
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

  const prioritized = (await safeCall(
    () => prioritizeRecommendations(adjudicated),
    { queue: [], watchlist: [] },
    "prioritize recommendations",
  )).value;
  const { queue, watchlist } = prioritized;

  // Phase 4.2 (Sprint 4, 2026-04-24): fetch recommendation responses FRESH
  // from the repository per render. The prior implementation read the
  // module-level `recommendationResponses` array, seeded once per Vercel
  // lambda behind a `_dbSeeded` one-shot flag. Once lambda A has seeded, a
  // write performed by lambda B is invisible on A even after
  // `revalidatePath` — A's `_dbSeeded=true` blocks re-fetching. Fresh
  // per-request fetch is the only way to guarantee cross-lambda truth on the
  // render path. `invalidateRecommendationResponsesSeed()` cannot help
  // because lambda B can only invalidate its own memory, never another
  // lambda's.
  //
  // The write path (recordResponse + persistResponses + dual-write) is
  // unchanged — it already writes durably to Supabase on `rec_id` upsert.
  // Module-level `recommendationResponses` + `getResponse()` + `isRecSuppressed()`
  // still exist for non-render callers (today-data, replication-engine). Those
  // surfaces have the same bug class and will be addressed in a later sprint.
  const freshResponsesRes = await safeCall(
    () => getRepository().getRecommendationResponses(),
    [] as RecommendationResponse[],
    "fetch fresh recommendation responses",
  );
  if (freshResponsesRes.error) errors.push(freshResponsesRes.error);
  const freshResponsesByRecId = new Map(
    freshResponsesRes.value.map((r) => [r.recId, r]),
  );

  const decorated = queue.map((rec) => ({
    rec,
    response: freshResponsesByRecId.get(rec.stableKey) ?? null,
  }));
  const watchDecorated = watchlist.map((rec) => ({
    rec,
    response: freshResponsesByRecId.get(rec.stableKey) ?? null,
  }));

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Recommendations"
        description="What to do this week. Ranked by severity, cluster size, and who actually owns the prompt. Accept to start a tracked experiment."
      />
      {errors.length > 0 && (
        <div
          className="mb-4 rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-2 text-[12px] text-status-warning leading-relaxed"
          role="status"
        >
          Some recommendation data couldn&apos;t load. Showing what we have.
        </div>
      )}
      <RecommendationsClient
        queue={decorated}
        watchlist={watchDecorated}
        matrixDate={matrix.date}
      />
    </div>
  );
}

function ErrorFallback({ errors }: { errors: string[] }) {
  return (
    <div className="rounded-lg border border-status-warning/40 bg-status-warning/[0.06] px-5 py-4 text-[13px]">
      <p className="font-medium text-status-warning">
        Decision queue couldn&apos;t load.
      </p>
      <p className="mt-1 text-muted-foreground">
        Beacon hit an error while computing recommendations. The rest of the
        app is unaffected. Try again in a minute or check logs.
      </p>
      {errors.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Diagnostic ({errors.length})
          </summary>
          <ul className="mt-1 list-disc pl-4 text-[11px] text-muted-foreground">
            {errors.map((e, i) => (
              <li key={i} className="font-mono">
                {e}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export type RecommendationQueueRow = {
  rec: ReturnType<typeof prioritizeRecommendations>["queue"][number];
  response: RecommendationResponse | null;
};

export type RecommendationWatchRow = {
  rec: ReturnType<typeof prioritizeRecommendations>["watchlist"][number];
  response: RecommendationResponse | null;
};
