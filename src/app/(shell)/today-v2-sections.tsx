/**
 * Today v2 section wrappers (2026-05-12) — server components that each
 * own one Suspense-bounded section of the v2 layout. Each section
 * awaits its narrow loader from `today-v2-data.ts` and renders the
 * matching presentation subtree using the existing v2 subcomponents.
 *
 * Layout (mirrors today-v2-client.tsx's main return):
 *
 *   1. <TodayV2VisibilityGroupSection>
 *        AIVisibilityHero
 *        VisibilityScoreChart   (shares `visibilityWindow` state with hero + leaderboard)
 *        VisibilityLeaderboard
 *
 *   2. <TodayV2ActionCardsSection>
 *        TodayV2DoToday | TodayV2Working | TodayV2RecentWins
 *
 *   3. <TodayV2DescriptorsSection>
 *        EnrichmentV2 OR EnrichmentBadges (legacy fallback)
 *
 * The visibility group must stay in ONE Suspense boundary because the
 * three pieces share the `visibilityWindow` client state. The other
 * two sections have no shared state, so each is its own Suspense.
 *
 * Pure presentation. The actual data math (heroProps derivation, etc.)
 * lives inside the client components, NOT here.
 */

import "server-only";

import {
  loadTodayV2ActionCardsData,
  loadTodayV2DescriptorsData,
  loadTodayV2VisibilityData,
} from "./today-v2-data";
import { TodayV2VisibilityGroupClient } from "./today-v2-visibility-group-client";
import { TodayV2DoToday } from "@/components/today/v2/today-v2-do-today";
import { TodayV2Working } from "@/components/today/v2/today-v2-working";
import { TodayV2RecentWins } from "@/components/today/v2/today-v2-recent-wins";
import { EnrichmentV2 } from "@/components/today/enrichment-v2";
import { EnrichmentBadges } from "@/components/today/enrichment-badges";
import { EditLifecycleTile } from "@/components/today/edit-lifecycle-tile";
import { loadLifecycleSummaryForTenant } from "@/domains/citation-lifecycle/load-lifecycle";
import { currentTenantId } from "@/lib/tenant-context";

export async function TodayV2VisibilityGroupSection() {
  const data = await loadTodayV2VisibilityData();
  return (
    <TodayV2VisibilityGroupClient
      visibilityData={data.visibilityData ?? null}
      enrichmentV2={data.enrichmentV2 ?? null}
      primaryShare={data.primaryShare}
    />
  );
}

export async function TodayV2ActionCardsSection() {
  const data = await loadTodayV2ActionCardsData();
  const liveChanges = data.lifecycleSummary?.liveChanges ?? [];
  const pendingImplementationCount =
    data.lifecycleSummary?.counts.pendingImplementation ?? 0;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <TodayV2DoToday primaryAction={data.primaryAction ?? null} />
      <TodayV2Working
        liveChanges={liveChanges}
        pendingImplementationCount={pendingImplementationCount}
      />
      <TodayV2RecentWins
        measuredWins={data.measuredWins ?? []}
        urlVerdictProof={data.urlVerdictProof ?? null}
      />
    </div>
  );
}

/**
 * Phase A.1 §2.11 (2026-05-13) — Edit lifecycle tile section. Streams
 * independently from action cards + descriptors; reads tenant-scoped
 * recommended_edits + prompt_answer_observations via
 * `loadLifecycleSummaryForTenant`. Tile is small enough to share a row
 * with other surfaces in a future Today layout pass; for now it sits
 * on its own line between the action grid and the descriptor section.
 */
export async function TodayV2EditLifecycleSection() {
  const tenantId = await currentTenantId();
  const summary = await loadLifecycleSummaryForTenant({ tenantId });
  return (
    <EditLifecycleTile
      perStage={summary.per_stage}
      total={summary.total}
      latestLiveAtIso={summary.latest_live_at_iso}
      stageLabels={summary.tile_strings.stage_labels}
      tooltipBody={summary.tile_strings.tooltip_body}
      emptyStateBody={summary.tile_strings.empty_state_body}
    />
  );
}

export async function TodayV2DescriptorsSection() {
  const { enrichmentV2, enrichmentRollup } = await loadTodayV2DescriptorsData();
  if (!enrichmentV2 && !enrichmentRollup) return null;
  return (
    <section
      className="space-y-3"
      data-today-v2-section="topic-depth"
    >
      {enrichmentV2 ? (
        <EnrichmentV2 data={enrichmentV2} />
      ) : enrichmentRollup ? (
        <EnrichmentBadges rollup={enrichmentRollup} />
      ) : null}
    </section>
  );
}
