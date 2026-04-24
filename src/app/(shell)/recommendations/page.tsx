import "server-only";

// v7 Commit 3 (2026-04-23): GPT-5-mini adjudicator runs on Layer 1/2
// fall-throughs. Build-time prerender would hit the real API — mark the
// route dynamic so it renders per-request only.
export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/data/page-header";
import { ensureCanonicalStoresSeeded } from "@/storage/canonical-store";
import {
  trackedPrompts,
  promptAnswerObservations,
  trackedEntities,
} from "@/storage/canonical-store";
import { buildPromptDecisionMatrix } from "@/domains/prompts/decision-matrix";
import { generateRecommendations } from "@/domains/recommendations/generate";
import { resolvePageIntent } from "@/domains/recommendations/resolve-page-intent";
import { buildPageInventory } from "@/domains/recommendations/page-inventory";
import { prioritizeRecommendations } from "@/domains/recommendations/prioritize";
import {
  adjudicateRecommendation,
  shouldAdjudicate,
  applyAdjudicationToResolution,
} from "@/domains/recommendations/adjudicate";
import { allPages } from "@/domains/pages/page-store";
import { getRepository } from "@/lib/persistence/repositories";
import {
  ensureRecommendationResponsesSeeded,
  getResponse,
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
export default async function RecommendationsPage() {
  await ensureCanonicalStoresSeeded();
  await ensureRecommendationResponsesSeeded();

  const matrix = buildPromptDecisionMatrix({
    prompts: trackedPrompts,
    observations: promptAnswerObservations,
    activeEntities: trackedEntities,
    now: new Date(),
  });

  const candidates = generateRecommendations({
    matrix,
    activeEntities: trackedEntities,
    trackedPrompts,
  });

  // v7 Commit 1 + 2 (2026-04-23): observation-led resolver + page-inventory
  // fallback insert between generator and prioritizer. Transforms e.g.
  // "Create a Los Altos page" → "Strengthen /locations/los-altos" when
  // AI cites the page OR when the page exists in the inventory but AI
  // hasn't cited it yet.
  const repo = getRepository();
  const pageSnapshots = await repo.getPageSnapshots();
  const pageInventory = buildPageInventory({
    pages: allPages,
    snapshots: pageSnapshots,
    activeEntities: trackedEntities,
  });
  const resolved = resolvePageIntent({
    candidates,
    observations: promptAnswerObservations,
    activeEntities: trackedEntities,
    pageInventory,
  });

  // v7 Commit 3 (2026-04-23): LLM adjudicator. Runs only on ambiguous /
  // high-value resolutions (merge_or_dedupe, needs_review, low-confidence,
  // create_new_page w/ inventory partial match, URL-less changelog risks).
  // Hard cap per request + monthly budget + evidence-hash cache keep cost
  // bounded. Silent failure mode: if adjudicator returns error / skipped /
  // budget-blocked, the resolution passes through as Layer 1/2 output.
  const adjudicated: typeof resolved = [];
  let firedCount = 0;
  const MAX_ADJUDICATIONS_PER_REQUEST = 5;
  for (const candidate of resolved) {
    const decision = shouldAdjudicate(candidate, {
      alreadyFiredCount: firedCount,
      maxPerRequest: MAX_ADJUDICATIONS_PER_REQUEST,
    });
    if (!decision.fire) {
      adjudicated.push(candidate);
      continue;
    }
    firedCount += 1;
    try {
      const result = await adjudicateRecommendation({
        customerId: "ritz",
        candidate,
        matrixPrompts: matrix.prompts,
        trackedPrompts,
        activeEntities: trackedEntities,
        observations: promptAnswerObservations,
        pageInventory,
      });
      if (result.status === "ok") {
        adjudicated.push(applyAdjudicationToResolution(candidate, result.output));
      } else {
        adjudicated.push(candidate);
      }
    } catch {
      adjudicated.push(candidate);
    }
  }

  const { queue, watchlist } = prioritizeRecommendations(adjudicated);

  // Join in current operator decisions so the client can render state
  // pills and hide dismissed / defer-still-active items behind "Show all".
  const decorated = queue.map((rec) => ({
    rec,
    response: getResponse(rec.stableKey) ?? null,
  }));
  const watchDecorated = watchlist.map((rec) => ({
    rec,
    response: getResponse(rec.stableKey) ?? null,
  }));

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Recommendations"
        description="What to do this week. Ranked by severity, cluster size, and who actually owns the prompt. Accept to start a tracked experiment."
      />
      <RecommendationsClient
        queue={decorated}
        watchlist={watchDecorated}
        matrixDate={matrix.date}
      />
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
