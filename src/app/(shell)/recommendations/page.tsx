import "server-only";

// v7 Commit 3 (2026-04-23): GPT-5-mini adjudicator runs on Layer 1/2
// fall-throughs. Build-time prerender would hit the real API — mark the
// route dynamic so it renders per-request only.
export const dynamic = "force-dynamic";

import { Suspense } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import { isOperatorModeServer } from "@/lib/operator-mode";
import {
  loadPageSurgeonSummaries,
  type PageSurgeonSummary,
} from "@/domains/recommendation-intelligence/page-surgeon/bridge";
import { scheduleBriefBackfill } from "@/domains/recommendation-intelligence/page-surgeon/brief-backfill-on-use";
import {
  loadPersistedRecommendationQueueForPage,
  type LiveRecQueueItem,
} from "@/domains/recommendations/load-queue";
import type { prioritizeRecommendations } from "@/domains/recommendations/prioritize";
import { getRepository } from "@/lib/persistence/repositories";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { RecommendationsV2Client } from "./recommendations-v2-client";
import { RecsResolverDebugPanel } from "./recs-resolver-debug-panel";
import { OffSiteOpportunitiesSection } from "./off-site-opportunities-section";
import { RecommendationsV2Skeleton } from "./recommendations-v2-skeleton";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";

/**
 * /recommendations — the v2 card stack.
 *
 * Surface collapse (2026-06-15) — the legacy table + drawer
 * (`RecommendationsClient`, the live-pipeline branch) was deleted; v2
 * is now the ONLY surface. Customers get inline Accept on each card +
 * bulk-select + j/k/a/x keyboard + the 5-act detail brief on
 * `/recommendations/[id]`, all calling the same persisted server
 * actions (`acceptRecommendation` / `deferRecommendation` /
 * `dismissRecommendation` / `markRecommendationShipped` /
 * `undoRecommendationResponse`). The v2 card stack loads off the
 * persisted fast loader (~500 ms cold) rather than the old ~30 s live
 * pipeline.
 */

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
 * #300 — translate the loader's internal `errors` strings (each prefixed
 * with a `safeCall` label like "fetch fresh recommendation responses:
 * <message>") into plain-English layer names a non-technical owner can
 * read. Returns a de-duplicated, ordered list. We only name layers we can
 * confidently recognize from the label prefix — anything unrecognized
 * collapses to a generic "some signals" entry rather than leaking a raw
 * code or fabricating detail.
 */
function degradedLayersFromErrors(errors: string[]): string[] {
  const seen = new Set<string>();
  const layers: string[] = [];
  const add = (name: string) => {
    if (!seen.has(name)) {
      seen.add(name);
      layers.push(name);
    }
  };
  for (const raw of errors) {
    const label = raw.split(":")[0]?.toLowerCase() ?? "";
    if (label.includes("recommendation response") || label.includes("response")) {
      add("your accept/dismiss history");
    } else if (label.includes("changelog") || label.includes("change")) {
      add("your change log");
    } else if (label.includes("gsc") || label.includes("page signal")) {
      add("Google Search data");
    } else if (label.includes("competitor")) {
      add("competitor data");
    } else if (
      label.includes("snapshot") ||
      label.includes("inventory") ||
      label.includes("page") ||
      label.includes("canonical")
    ) {
      add("your website pages");
    } else if (
      label.includes("candidate") ||
      label.includes("prioriti") ||
      label.includes("matrix") ||
      label.includes("intent") ||
      label.includes("generate")
    ) {
      add("the recommendation engine");
    } else {
      add("some signals");
    }
  }
  return layers;
}

/**
 * #300 — honest, actionable degraded-data banner. Names which layer(s)
 * couldn't load (when recognizable) and tells the owner what to do next.
 * Keeps the legacy "Some recommendation data couldn't load." sentence as
 * the lead so existing copy + tests stay stable.
 */
function DataDegradedBanner({ errors }: { errors: string[] }) {
  const layers = degradedLayersFromErrors(errors);
  const layerText =
    layers.length > 0
      ? ` We couldn't load ${joinWithAnd(layers)}.`
      : "";
  return (
    <div
      className="mb-4 rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-2 text-[12px] text-status-warning leading-relaxed"
      role="status"
    >
      Some recommendation data couldn&apos;t load.{layerText} Showing what we
      have — some signals are still loading. Refresh your connected data
      (Settings → Connectors) to retry.
    </div>
  );
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Streaming bundle (2026-05-12) — page.tsx flushes the route frame +
 * Suspense fallback skeleton instantly. The slow data load happens
 * inside `RecommendationsAsyncContent`, which resolves behind the
 * Suspense boundary so the page doesn't feel blank during the wait.
 *
 * The v2 persisted fast loader is ~500 ms cold; streaming still
 * benefits it because even 500 ms reads better with an instant frame.
 */
export default async function RecommendationsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const params = await (searchParams ?? Promise.resolve({}));
  const debugResolver = shouldShowResolverDebug(params);
  return (
    <Suspense fallback={<RecommendationsV2Skeleton />}>
      <RecommendationsAsyncContent debugResolver={debugResolver} />
    </Suspense>
  );
}

/**
 * Async server component — the data load happens here, behind the
 * page-level Suspense boundary. Resolves the tenant + persisted loader
 * output, then renders the v2 card stack.
 *
 * Exported for smoke tests: `renderToStaticMarkup` in Vitest does not
 * resolve Suspense, so callers that want to assert on the resolved
 * page content invoke this function directly.
 */
export async function RecommendationsAsyncContent({
  debugResolver = false,
}: {
  debugResolver?: boolean;
} = {}) {
  const trace = createPerfTrace("loader:/recommendations", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/recommendations",
  });
  try {
    const tenantId = await currentTenantId();
    trace.data("use_v2", "true");

    // Slice 4.5.G-B.1 — load active tracked competitor entities once
    // for the render-time `why`-display guard. Soft-fail to [] so the
    // page still renders if the read errors; the guard's UUID +
    // internal-token detection runs regardless of competitorNames.
    let competitorNames: string[] = [];
    try {
      const entities = await getRepository()
        .forTenant(tenantId)
        .getTrackedEntities();
      competitorNames = entities
        .filter(
          (e) => e.entity_type === "competitor" && e.is_active === true,
        )
        .map((e) => e.name)
        .filter((n) => typeof n === "string" && n.length > 0);
    } catch {
      competitorNames = [];
    }

    // #149 (2026-06-11): per-tenant city vocabulary for geo tags in row
    // titles — client components can't read server config, so the list
    // is threaded as a prop. Soft-fail to UNDEFINED (legacy Bay-Area
    // default — founder parity); a loaded-but-empty list means "this
    // tenant has no geo vocabulary" and matches nothing.
    let knownCities: string[] | undefined;
    let knownServices: string[] | undefined;
    let brandName: string | undefined;
    try {
      const { getBusinessConfigForCurrentTenant } = await import(
        "@/lib/business-config"
      );
      const cfg = await getBusinessConfigForCurrentTenant();
      knownCities = cfg.locations;
      knownServices = cfg.services;
      brandName = cfg.name?.trim() || undefined;
    } catch {
      knownCities = undefined;
      knownServices = undefined;
      brandName = undefined;
    }

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

    // Armed publishing (2026-06-16) — the per-site one-click state + this
    // user's publish permission + the live write target. Threaded to the
    // client so an ARMED site's safe, mapped, high-confidence edits show
    // "Accept & publish" (one-click live). Soft-fail to the safe default
    // (staged / cannot-publish) so the list always renders.
    let publishingMode: "staged" | "armed" = "staged";
    let canPublish = false;
    let publishTarget: "wix_cms" | "git_pr" | "dev_note" | null = null;
    try {
      const { getPublishingModeForCurrentTenant } = await import("./actions");
      const pm = await getPublishingModeForCurrentTenant();
      publishingMode = pm.mode;
      canPublish = pm.canPublish;
      const { getTenant } = await import("@/domains/tenants/store");
      publishTarget = (await getTenant(tenantId))?.publish_target ?? null;
    } catch {
      publishingMode = "staged";
      canPublish = false;
      publishTarget = null;
    }

    // PSQ — operator-only Page Surgeon summaries (read-only). Maps each briefed
    // page's PATH → its QA/review/headline so the queue can put Page-Surgeon-ready
    // packs FIRST and demote basic legacy recs. Empty in customer mode → customer
    // render is byte-identical. The loader is fail-soft internally.
    const isOperator = isOperatorModeServer();
    // Audit gap #2 — make the queue Page-Surgeon-driven on its own: schedule a
    // small, capped brief backfill (runs AFTER this response, throttled) so the
    // "Ready" bucket grows toward every top-demand page as the operator uses the
    // app, instead of only pages someone hand-clicked. Fully fail-soft + bounded.
    if (isOperator) scheduleBriefBackfill(tenantId);
    const pageSurgeonSummaries: Record<string, PageSurgeonSummary> = isOperator
      ? await trace.time("loadPageSurgeonSummaries", () =>
          loadPageSurgeonSummaries(tenantId),
        )
      : {};

    return (
      <div className="max-w-5xl">
        {errors.length > 0 && <DataDegradedBanner errors={errors} />}
        <RecommendationsV2Client
          queue={persisted.queue}
          watchlist={persisted.watchlist}
          matrixDate={persisted.matrixDateLabel}
          promptTextById={promptTextById}
          competitorNames={competitorNames}
          knownCities={knownCities}
          knownServices={knownServices}
          brandName={brandName}
          publishingMode={publishingMode}
          canPublish={canPublish}
          publishTarget={publishTarget}
          isOperator={isOperator}
          pageSurgeonSummaries={pageSurgeonSummaries}
        />
        {debugResolver && (
          <RecsResolverDebugPanel
            persisted={persisted}
            promptTextById={promptTextById}
          />
        )}
        {/* Section 7 C7e — read-only off-site opportunities, below the
            website-edit queue. Separate region; never queue-promoted.
            Suspense-wrapped: it's an async server section, so the
            boundary lets the page frame flush + keeps sync renderers
            (renderToStaticMarkup) rendering the null fallback. */}
        <Suspense fallback={null}>
          <OffSiteOpportunitiesSection />
        </Suspense>
      </div>
    );
  } finally {
    trace.flush();
  }
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
