import "server-only";

/**
 * /recommendations/[id] — Bundle 2B premium brief page.
 *
 * Reuses the EXACT same loader path as /recommendations
 * (loadLiveRecommendationQueue + getRecommendationResponses +
 * recommended_edits + getChangelogEntries + buildChangelogIdByRecId +
 * buildRecommendationActionRows). The detail page filters down to one
 * RecommendationActionRow by `params.id`. No new fetches, no new
 * server actions, no recommendation-engine changes.
 *
 * Empty / not-found states render a calm customer-safe message
 * (mirrors the v2 card stack's empty state). The legacy escape hatch
 * (`/recommendations?legacy=1#rec-<sourceRecommendationId>`) is the
 * authoritative drawer for accept / defer / dismiss until Bundle 2C
 * (or later) wires those actions into v2 directly.
 */

// v7 Commit 3 (2026-04-23) — same dynamic posture as the parent
// /recommendations route. The detail loader runs the same queue
// pipeline so it must render per-request.
export const dynamic = "force-dynamic";

import { currentTenantId } from "@/lib/tenant-context";
import {
  loadPersistedRecommendationQueueForPage,
} from "@/domains/recommendations/load-queue";
import { getRepository } from "@/lib/persistence/repositories";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { getChangelogEntries } from "@/lib/seed-data.server";
import { buildChangelogIdByRecId } from "@/domains/recommendations/changelog-link";
import { buildRecommendationActionRows } from "@/domains/recommendations/recommendation-action-rows";

import {
  decodeRecommendationRouteId,
  encodeRecommendationRouteId,
} from "@/components/recommendations/v2/recommendation-route-id";
import { resolveRecommendationDetail } from "@/domains/recommendations/resolve-recommendation-detail";
import { redirect } from "next/navigation";
import { RecommendationDetailClient } from "./recommendation-detail-client";
import { RecommendationDetailNotFound } from "./recommendation-detail-not-found";

import type { RecommendationQueueRow } from "../page";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";

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
    console.error(`[recommendations/detail] ${label} failed:`, msg);
    return { value: fallback, error: `${label}: ${msg}` };
  }
}

export default async function RecommendationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const trace = createPerfTrace("loader:/recommendations/[id]", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/recommendations/[id]",
  });
  try {
  const { id: rawId } = await params;
  const decodedId = decodeRecommendationRouteId(rawId);

  if (!decodedId) {
    trace.data("outcome", "not_found_bad_id");
    return <RecommendationDetailNotFound />;
  }

  const tenantId = await currentTenantId();

  // Emergency P0 fix v2 (2026-05-12) — the prior "cheap existence
  // check" (`stableKey ∈ recommended_edits ∪ recommendation_responses`)
  // had a false-positive on a real customer-facing rec id pattern.
  //
  // The recommendation-action-rows generator emits THREE id shapes:
  //   1. `${stableKey}::${edit.id}`           — edit-backed rec, IS
  //                                              in `recommended_edits`
  //   2. `${stableKey}::faq-pair::${hash}`     — synthesized from the
  //                                              matrix, NO edit row
  //   3. `${stableKey}::${metaKind}`           — synthesized,
  //                                              NO edit row
  //
  // For shapes (2) and (3), the cheap check returned not-found for a
  // VALID rec from the live v2 card. The user reported clicking a
  // card and landing on "no longer active" — confirmed false-positive.
  //
  // Restoring the queue-load path. The 15 s slow-load problem for
  // stale URLs is addressed at a different layer (`prefetch={false}`
  // on every list-to-detail Link in the same bundle, eliminating
  // the prefetch storm of 14+ simultaneous detail loads when the
  // user lands on `/recommendations`). Stale URLs now only cost
  // 15 s on the rare manual bookmark click, not on every list view.
  // Emergency P0 v5 (2026-05-12) — detail page uses the same persisted
  // fast loader as /recommendations?v2=1. The synthesized queue items
  // produce the same `RecommendationActionRow` shape via the existing
  // builder. Valid v2 card ids resolve in <500 ms (same envelope as
  // the list page); stale ids miss the find() and render the calm
  // not-found component in the same envelope.
  const persisted = await trace.time(
    "loadPersistedRecommendationQueueForPage",
    () => loadPersistedRecommendationQueueForPage({ tenantId }),
  );

  const promptTextById: Record<string, string> = {};
  for (const p of persisted.trackedPrompts) {
    promptTextById[p.id] = p.text;
  }

  const changelogIdByRecId = buildChangelogIdByRecId(persisted.changelogEntries);

  // 2026-05-13 P0 follow-up — resolve via the four-step ladder
  // (exact → by edit id → by rec stable key → miss). The list page and
  // the detail page share the same row source, so a single request
  // snapshot is internally consistent. Drift happens ACROSS requests
  // when an edit is replaced / cleaned up between the card render and
  // the click; the resolver finds the closest actionable replacement
  // and redirects to the canonical URL rather than dead-ending.
  const allRows = buildRecommendationActionRows({
    queue: persisted.queue,
    promptTextById,
  });
  const resolution = resolveRecommendationDetail(allRows, decodedId);

  if (resolution.kind === "redirect") {
    trace.data("outcome", `redirect_${resolution.via}`);
    trace.data("queue_count", persisted.queue.length);
    // redirect() throws NEXT_REDIRECT — the surrounding try/finally
    // still runs trace.flush() before the redirect propagates.
    redirect(
      `/recommendations/${encodeRecommendationRouteId(resolution.row.id)}`,
    );
  }

  if (resolution.kind === "miss") {
    trace.data("outcome", "not_found_unknown_id");
    return <RecommendationDetailNotFound hint={resolution.hint} />;
  }

  trace.data("queue_count", persisted.queue.length);
  trace.measureSize("payload", { row: resolution.row, promptTextById });
  return (
    <RecommendationDetailClient
      row={resolution.row}
      changelogId={
        changelogIdByRecId[resolution.row.sourceRecommendationId] ?? null
      }
      promptTextById={promptTextById}
    />
  );
  } finally {
    trace.flush();
  }
}
