import "server-only";

// v7 Commit 3 (2026-04-23): GPT-5-mini adjudicator runs on Layer 1/2
// fall-throughs. Build-time prerender would hit the real API — mark the
// route dynamic so it renders per-request only.
export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/data/page-header";
import { currentTenantId } from "@/lib/tenant-context";
import { loadLiveRecommendationQueue } from "@/domains/recommendations/load-queue";
import type { prioritizeRecommendations } from "@/domains/recommendations/prioritize";
import { getRepository } from "@/lib/persistence/repositories";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
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
  // Sprint 6A.1 Phase 14 (2026-04-24) — orchestration extracted to
  // `loadLiveRecommendationQueue` so the queue-driven CLI consumes the
  // same source. Page render behavior is byte-equivalent.
  // Sprint 7 Phase 7.3 (2026-04-25) — tenantId required; resolved via
  // header (after Phase 7.4) or BEACON_TENANT_ID env var.
  const tenantId = await currentTenantId();
  const live = await loadLiveRecommendationQueue({ tenantId });
  const errors = [...live.errors];

  if (!live.matrix) {
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

  const matrix = live.matrix;
  const { queue, watchlist } = live;

  // Sprint 7 Phase 7.5b Commit 2 (2026-04-25) — tenant-bound read.
  const freshResponsesRes = await safeCall(
    () => getRepository().forTenant(tenantId).getRecommendationResponses(),
    [] as RecommendationResponse[],
    "fetch fresh recommendation responses",
  );
  if (freshResponsesRes.error) errors.push(freshResponsesRes.error);
  const freshResponsesByRecId = new Map(
    freshResponsesRes.value.map((r) => [r.recId, r]),
  );

  // Sprint 6A.1 Phase 12 (2026-04-24): fresh-read recommended_edits per
  // request. Group by `rec_id` so each rec row gets its own edits slice.
  // Failure here gracefully degrades: edits are absent → UI falls back
  // to the existing single-changelog Accept behavior.
  // Sprint 7 Phase 7.5b Commit 2 (2026-04-25) — tenant-bound read.
  const freshEditsRes = await safeCall(
    () => getRepository().forTenant(tenantId).getRecommendedEdits(),
    [] as RecommendedEditRow[],
    "fetch fresh recommended edits",
  );
  if (freshEditsRes.error) errors.push(freshEditsRes.error);
  const editsByRecId = new Map<string, RecommendedEditRow[]>();
  for (const row of freshEditsRes.value) {
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

  // Step 1.1 (master plan) — build the prompt-text lookup the client uses
  // to render evidence chips. Replaces the raw UUID leak in the prior
  // `prompt:${ref.promptId}` chip.
  const promptTextById: Record<string, string> = {};
  for (const p of live.trackedPrompts) {
    promptTextById[p.id] = p.text;
  }

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
        promptTextById={promptTextById}
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
