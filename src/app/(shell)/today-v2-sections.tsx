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
  loadTodayV2DescriptorsData,
  loadTodayV2VisibilityAndActionsData,
} from "./today-v2-data";
import { TodayV2VisibilityGroupClient } from "./today-v2-visibility-group-client";
import { TodayV2DoToday } from "@/components/today/v2/today-v2-do-today";
import { TodayV2Working } from "@/components/today/v2/today-v2-working";
import { TodayV2RecentWins } from "@/components/today/v2/today-v2-recent-wins";
import { EnrichmentV2 } from "@/components/today/enrichment-v2";
import { EnrichmentBadges } from "@/components/today/enrichment-badges";

export async function TodayV2VisibilityGroupSection() {
  const data = await loadTodayV2VisibilityAndActionsData();
  return (
    <TodayV2VisibilityGroupClient
      visibilityData={data.visibilityData ?? null}
      enrichmentV2={data.enrichmentV2 ?? null}
    />
  );
}

export async function TodayV2ActionCardsSection() {
  const data = await loadTodayV2VisibilityAndActionsData();
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
