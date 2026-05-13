import "server-only";

// v7 Commit 3 (2026-04-23): GPT-5-mini adjudicator runs on Layer 1/2
// fall-throughs. Build-time prerender would hit the real API — mark the
// route dynamic so it renders per-request only.
export const dynamic = "force-dynamic";

import { Suspense } from "react";

import { PageHeader } from "@/components/data/page-header";
import { currentTenantId } from "@/lib/tenant-context";
import {
  loadLiveRecommendationQueueForPage,
  loadPersistedRecommendationQueueForPage,
  type LiveRecQueueItem,
} from "@/domains/recommendations/load-queue";
import type { prioritizeRecommendations } from "@/domains/recommendations/prioritize";
import { getRepository } from "@/lib/persistence/repositories";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { RecommendationsClient } from "./recommendations-client";
import { RecommendationsV2Client } from "./recommendations-v2-client";
import { RecsResolverDebugPanel } from "./recs-resolver-debug-panel";
import {
  RecommendationsV2Skeleton,
  RecommendationsLegacySkeleton,
} from "./recommendations-v2-skeleton";
import { getChangelogEntries } from "@/lib/seed-data.server";
import { buildChangelogIdByRecId } from "@/domains/recommendations/changelog-link";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";

/**
 * Bundle 2A (Plan: i-want-a-maximum-depth-curried-curry) — switch
 * /recommendations between the legacy table + drawer and the v2 card
 * stack.
 *
 * Routing:
 *   - Default: legacy (current production behavior).
 *   - `BEACON_RECOMMENDATIONS_V2=true` env: v2 becomes the default
 *     (mirrors the BEACON_TODAY_V2 pattern from Bundle 1).
 *   - `?legacy=1` query: always legacy (escape hatch — works regardless
 *     of the env flag).
 *   - `?v2=1` query: always v2 (preview escape hatch — useful for
 *     hosted demos before flipping the env flag).
 */
function shouldUseRecommendationsV2(
  searchParams: Record<string, string | string[] | undefined>,
): boolean {
  if (searchParams.legacy === "1") return false;
  if (searchParams.v2 === "1") return true;
  return process.env.BEACON_RECOMMENDATIONS_V2 === "true";
}

/**
 * 2026-05-13 P0 — operator-facing diagnostic panel toggle. Auth-gated
 * by the existing route auth gate (signed-in / tenant-scoped); the
 * flag exists only for the operator's runtime inspection and writes
 * nothing.
 */
function shouldShowResolverDebug(
  searchParams: Record<string, string | string[] | undefined>,
): boolean {
  return searchParams.debugResolver === "1";
}

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

/**
 * Streaming bundle (2026-05-12) — page.tsx now flushes the route frame
 * + Suspense fallback skeleton instantly. The slow data load happens
 * inside `RecommendationsV2Async` / `RecommendationsLegacyAsync` —
 * those resolve behind the Suspense boundary so the page doesn't feel
 * blank during the wait.
 *
 * v2 path: persisted fast loader (~500 ms cold). Legacy path: full
 * live pipeline (~30 s cold). Streaming benefits both — v2 because
 * even 500 ms benefits from instant frame, legacy because the 30 s
 * wait stops feeling like a hang.
 */
export default async function RecommendationsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const params = await (searchParams ?? Promise.resolve({}));
  const useV2 = shouldUseRecommendationsV2(params);
  const debugResolver = shouldShowResolverDebug(params);
  return (
    <Suspense
      fallback={
        useV2 ? (
          <RecommendationsV2Skeleton />
        ) : (
          <RecommendationsLegacySkeleton />
        )
      }
    >
      <RecommendationsAsyncContent
        useV2={useV2}
        debugResolver={debugResolver}
      />
    </Suspense>
  );
}

/**
 * Async server component — the data load happens here, behind the
 * page-level Suspense boundary. Resolves the tenant + loader output,
 * then renders the appropriate client. Branches inside the async
 * boundary so both v2 and legacy benefit from the streamed shell.
 *
 * Exported for smoke tests: `renderToStaticMarkup` in Vitest does not
 * resolve Suspense, so callers that want to assert on the resolved
 * page content invoke this function directly.
 */
export async function RecommendationsAsyncContent({
  useV2,
  debugResolver = false,
}: {
  useV2: boolean;
  debugResolver?: boolean;
}) {
  const trace = createPerfTrace("loader:/recommendations", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/recommendations",
  });
  try {
    const tenantId = await currentTenantId();
    trace.data("use_v2", useV2 ? "true" : "false");

    if (useV2) {
      const persisted = await trace.time(
        "loadPersistedRecommendationQueueForPage",
        () => loadPersistedRecommendationQueueForPage({ tenantId }),
      );
      const errors = [...persisted.errors];
      const promptTextById: Record<string, string> = {};
      for (const p of persisted.trackedPrompts) {
        promptTextById[p.id] = p.text;
      }
      trace.data("queue_count", persisted.queue.length);
      trace.measureSize("payload", {
        queue: persisted.queue,
        promptTextById,
      });
      return (
        <div className="max-w-5xl">
          {errors.length > 0 && (
            <div
              className="mb-4 rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-2 text-[12px] text-status-warning leading-relaxed"
              role="status"
            >
              Some recommendation data couldn&apos;t load. Showing what we have.
            </div>
          )}
          <RecommendationsV2Client
            queue={persisted.queue}
            watchlist={persisted.watchlist}
            matrixDate={persisted.matrixDateLabel}
            promptTextById={promptTextById}
          />
          {debugResolver && (
            <RecsResolverDebugPanel
              persisted={persisted}
              promptTextById={promptTextById}
            />
          )}
        </div>
      );
    }

    // Legacy table view — full live pipeline.
    const live = await trace.time("loadLiveRecommendationQueue", () =>
      loadLiveRecommendationQueueForPage({ tenantId }),
    );
    const errors = [...live.errors];

    if (!live.matrix) {
      return (
        <div className="max-w-4xl">
          <PageHeader
            title="Recommendations"
            description="Recommendations temporarily unavailable."
          />
          <ErrorFallback errors={errors} />
        </div>
      );
    }

    const matrix = live.matrix;
    const { queue, watchlist } = live;

    const freshResponsesRes = await safeCall(
      () => getRepository().forTenant(tenantId).getRecommendationResponses(),
      [] as RecommendationResponse[],
      "fetch fresh recommendation responses",
    );
    if (freshResponsesRes.error) errors.push(freshResponsesRes.error);
    const freshResponsesByRecId = new Map(
      freshResponsesRes.value.map((r) => [r.recId, r]),
    );

    const editsByRecId = new Map<string, RecommendedEditRow[]>();
    for (const row of live.recommendedEdits) {
      const list = editsByRecId.get(row.rec_id);
      if (list) list.push(row);
      else editsByRecId.set(row.rec_id, [row]);
    }

    const decorated = queue.map((rec) => ({
      rec,
      response: freshResponsesByRecId.get(rec.stableKey) ?? null,
      edits: editsByRecId.get(rec.stableKey) ?? [],
    }));
    const watchDecorated = watchlist.map((rec) => ({
      rec,
      response: freshResponsesByRecId.get(rec.stableKey) ?? null,
      edits: editsByRecId.get(rec.stableKey) ?? [],
    }));

    const promptTextById: Record<string, string> = {};
    for (const p of live.trackedPrompts) {
      promptTextById[p.id] = p.text;
    }

    const changelogRes = await safeCall(
      () => getChangelogEntries(),
      [] as Array<{ id: string; source_rec_id?: string | null }>,
      "fetch changelog entries for rec→change links",
    );
    if (changelogRes.error) errors.push(changelogRes.error);
    const changelogIdByRecId = buildChangelogIdByRecId(changelogRes.value);

    trace.data("queue_count", decorated.length);
    trace.data("watchlist_count", watchDecorated.length);
    trace.measureSize("payload", {
      queue: decorated,
      watchlist: watchDecorated,
      promptTextById,
      changelogIdByRecId,
    });

    return (
      <div className="max-w-5xl">
        <PageHeader
          title="Recommendations"
          description="Beacon turns AI visibility gaps into concrete website tasks. Review the top actions, accept them, or mark them as shipped."
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
          promptTextById={promptTextById}
          changelogIdByRecId={changelogIdByRecId}
        />
      </div>
    );
  } finally {
    trace.flush();
  }
}

function ErrorFallback({ errors }: { errors: string[] }) {
  return (
    <div className="rounded-lg border border-status-warning/40 bg-status-warning/[0.06] px-5 py-4 text-[13px]">
      <p className="font-medium text-status-warning">
        Recommendations couldn&apos;t load.
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
  /** W3 Step 3.3 (2026-05-01): the prioritized rec is now a
   *  `LiveRecQueueItem` — same shape as `PrioritizedRecommendation`
   *  plus a required `engineConfidence: RecConfidenceVerdict`. The UI
   *  doesn't render the verdict yet (W3 Step 3.5 ships the pill);
   *  the field is exposed here so consumers can read it as soon as
   *  it lands. */
  rec: LiveRecQueueItem;
  response: RecommendationResponse | null;
  /** Sprint 6A.1 Phase 12 — typed edits from `recommended_edits`,
   *  fresh-read per request. Empty array when the rec has none — the
   *  UI then falls back to the legacy single-changelog Accept path. */
  edits: RecommendedEditRow[];
};

export type RecommendationWatchRow = {
  rec: ReturnType<typeof prioritizeRecommendations>["watchlist"][number];
  response: RecommendationResponse | null;
  edits: RecommendedEditRow[];
};
