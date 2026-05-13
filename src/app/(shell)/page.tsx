import { Suspense } from "react";

import { TodayClient } from "./today-client";
import { TodayV2Client } from "./today-v2-client";
import { TodayV2Skeleton, TodayLegacySkeleton } from "./today-v2-skeleton";
import { respondToRecommendation } from "./recommendation-actions";
import { confirmFindingAsChange, resolveFinding } from "./finding-actions";
import { loadTodayPageData } from "./today-data";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";

async function dismissFinding(findingId: string) {
  "use server";
  return resolveFinding(findingId, "rejected");
}

/**
 * Bundle 1 (Plan: i-want-a-maximum-depth-curried-curry) — switch /today
 * between the legacy 19-section layout and the v2 4-zone layout.
 *
 * Routing:
 *   - Default: v1 (TodayClient) for safety until v2 is verified hosted.
 *   - `BEACON_TODAY_V2=true` env: v2 (TodayV2Client) becomes the default.
 *   - `?legacy=1` query: always v1 (escape hatch for operators / regression
 *     debugging — works regardless of the env flag).
 *   - `?v2=1` query: always v2 (preview escape hatch — works regardless of
 *     the env flag, useful for hosted demos before flipping the env).
 */
function shouldUseV2(
  searchParams: Record<string, string | string[] | undefined>,
): boolean {
  if (searchParams.legacy === "1") return false;
  if (searchParams.v2 === "1") return true;
  return process.env.BEACON_TODAY_V2 === "true";
}

/**
 * Streaming bundle (2026-05-12) — /today refactored for perceived speed.
 *
 * Before: this function awaited `loadTodayPageData()` BEFORE returning any
 * JSX. The route stayed on the generic `loading.tsx` for the entire data
 * load (cold ~10s), then snapped to the fully rendered page. User
 * perceived "blank waiting" the whole time.
 *
 * After: the static route frame returns immediately. A `<Suspense>`
 * boundary wraps an async server component that does the slow load; the
 * `TodayV2Skeleton` / `TodayLegacySkeleton` fallback shows the layout
 * shape (hero / chart / leaderboard / 3 cards / descriptors) while the
 * data streams. When the loader resolves, the Suspense streams in the
 * real TodayV2Client / TodayClient with the same data and same shape —
 * no data contract changes, no UI design changes.
 *
 * page.tsx itself awaits only `searchParams` (microseconds) so the
 * static frame + skeleton flush to the browser fast.
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const useV2 = shouldUseV2(params);
  return (
    <div className="max-w-6xl">
      <Suspense
        fallback={useV2 ? <TodayV2Skeleton /> : <TodayLegacySkeleton />}
      >
        <TodayAsyncContent useV2={useV2} />
      </Suspense>
    </div>
  );
}

/**
 * Async server component — the slow path. Awaiting happens here, behind
 * the Suspense boundary, so the parent frame can flush instantly with
 * the skeleton. When this resolves, Suspense streams the real client
 * tree into the page.
 *
 * Exported for smoke tests: `renderToStaticMarkup` in Vitest does not
 * resolve Suspense, so callers that want to assert on the resolved
 * page content invoke this function directly (`await
 * TodayAsyncContent({ useV2}).then(renderToStaticMarkup)`).
 */
export async function TodayAsyncContent({ useV2 }: { useV2: boolean }) {
  const trace = createPerfTrace("loader:/", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/",
  });
  const data = await trace.time("loadTodayPageData", () =>
    loadTodayPageData(),
  );
  trace.data("use_v2", useV2 ? "true" : "false");
  trace.measureSize("payload", data);
  trace.flush();
  return useV2 ? (
    <TodayV2Client
      {...data}
      onRespondToRec={respondToRecommendation}
      onConfirmFinding={confirmFindingAsChange}
      onDismissFinding={dismissFinding}
    />
  ) : (
    <TodayClient
      {...data}
      onRespondToRec={respondToRecommendation}
      onConfirmFinding={confirmFindingAsChange}
      onDismissFinding={dismissFinding}
    />
  );
}
