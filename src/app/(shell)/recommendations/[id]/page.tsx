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
  loadLiveRecommendationQueue,
} from "@/domains/recommendations/load-queue";
import { getRepository } from "@/lib/persistence/repositories";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { getChangelogEntries } from "@/lib/seed-data.server";
import { buildChangelogIdByRecId } from "@/domains/recommendations/changelog-link";
import { buildRecommendationActionRows } from "@/domains/recommendations/recommendation-action-rows";

import { decodeRecommendationRouteId } from "@/components/recommendations/v2/recommendation-route-id";
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
  const live = await trace.time("loadLiveRecommendationQueue", () =>
    loadLiveRecommendationQueue({ tenantId }),
  );

  if (!live.matrix) {
    // Same fail-soft posture as /recommendations: degrade to the
    // not-found state rather than crashing the whole shell.
    return <RecommendationDetailNotFound />;
  }

  // Detail page only resolves rows from the prioritized queue.
  // The watchlist (passive winning patterns) doesn't expose action
  // briefs — a watched rec is informational, not actionable, so a
  // detail URL for one renders the calm not-found state. This keeps
  // the loader's row shape strictly compatible with
  // `buildRecommendationActionRows` (which expects LiveRecQueueItem,
  // not the lighter RecommendationCandidate shape watchlist rows
  // carry).
  const { queue } = live;

  const freshResponsesRes = await safeCall(
    () => getRepository().forTenant(tenantId).getRecommendationResponses(),
    [] as RecommendationResponse[],
    "fetch fresh recommendation responses",
  );
  const freshResponsesByRecId = new Map(
    freshResponsesRes.value.map((r) => [r.recId, r]),
  );

  const editsByRecId = new Map<string, RecommendedEditRow[]>();
  for (const row of live.recommendedEdits) {
    const list = editsByRecId.get(row.rec_id);
    if (list) list.push(row);
    else editsByRecId.set(row.rec_id, [row]);
  }

  // Decorate queue using the SAME shape /recommendations uses.
  const decorated: RecommendationQueueRow[] = queue.map((rec) => ({
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
  const changelogIdByRecId = buildChangelogIdByRecId(changelogRes.value);

  // Build the FULL action-row set, then locate the one whose `id`
  // matches the decoded route param. Unknown id → calm not-found
  // (rec is no longer in the queue — likely shipped, dismissed, or
  // resolved; we don't keep a permanent brief URL for those).
  const allRows = buildRecommendationActionRows({
    queue: decorated,
    promptTextById,
  });
  const row = allRows.find((r) => r.id === decodedId) ?? null;

  if (!row) {
    trace.data("outcome", "not_found_unknown_id");
    return <RecommendationDetailNotFound />;
  }

  trace.data("queue_count", decorated.length);
  trace.measureSize("payload", { row, promptTextById });
  return (
    <RecommendationDetailClient
      row={row}
      changelogId={changelogIdByRecId[row.sourceRecommendationId] ?? null}
      promptTextById={promptTextById}
    />
  );
  } finally {
    trace.flush();
  }
}
