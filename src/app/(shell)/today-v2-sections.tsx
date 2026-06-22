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
  loadTodayV2AllSourceSummaryData,
  loadTodayV2DescriptorsData,
  loadTodayV2VisibilityData,
} from "./today-v2-data";
import { AllSourceStatRow } from "@/components/today/all-source-stat-row";
import { FixFirstCallout } from "@/components/today/fix-first-callout";
import { TodayV2VisibilityGroupClient } from "./today-v2-visibility-group-client";
import { TodayV2DoToday } from "@/components/today/v2/today-v2-do-today";
import { TodayV2Working } from "@/components/today/v2/today-v2-working";
import {
  TodayV2RecentWins,
  hasRecentWins,
} from "@/components/today/v2/today-v2-recent-wins";
import { EnrichmentV2 } from "@/components/today/enrichment-v2";
import { EnrichmentBadges } from "@/components/today/enrichment-badges";
import { EditLifecycleTile } from "@/components/today/edit-lifecycle-tile";
import { EditOutcomesTile } from "@/components/today/edit-outcomes-tile";
import { OffSiteAuthorityTile } from "@/components/today/off-site-authority-tile";
import { loadLifecycleSummaryForTenant } from "@/domains/citation-lifecycle/load-lifecycle";
import { loadOutcomesSummaryForTenant } from "@/domains/outcome-attribution/load-outcomes-summary-for-tenant";
import { loadOffSitePresenceSnapshot } from "@/domains/off-site-authority/load-snapshot";
import { computeOffSiteRecommendationCandidates } from "@/domains/off-site-authority/recommendation-rules";
import { TodayV2ProvenResults } from "@/components/today/v2/today-v2-proven-results";
import { loadProvenWins } from "@/domains/attribution/load-proven-wins";
import {
  TodayV2ExperimentsMeasuring,
  type MeasuringExperiment,
} from "@/components/today/v2/today-v2-experiments-measuring";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import {
  BeaconLearnedTile,
  type BeaconLearnedState,
} from "@/components/today/beacon-learned-tile";
import { isBrainLearnedTileEnabled } from "@/domains/recommendations/cross-tenant-brain/config";
import { BRAIN_SAMPLE_THRESHOLDS } from "@/domains/recommendations/cross-tenant-brain/thresholds";
import { GoldenPathStrip } from "@/components/today/golden-path-strip";
import { loadGoldenPathState } from "@/domains/today/golden-path";

/**
 * All-source summary stat row (2026-06-15) — the unified command
 * center's top scoreboard. Awaits the fail-soft all-source loader,
 * builds the per-source cards (data-presence gated, NOT connector
 * gated), and renders the row. Returns null when ZERO cards qualify so
 * a tenant with no data anywhere reserves no layout. Ships default-on:
 * the self-hide is the safety, not an env flag.
 */
export async function TodayV2AllSourceSummarySection() {
  const { cards, fixFirst } = await loadTodayV2AllSourceSummaryData();
  if (cards.length === 0 && (fixFirst == null || fixFirst.length === 0)) {
    return null;
  }
  return (
    <div className="space-y-4">
      {/* Cross-source fusion insight LEADS the scoreboard — when pages are
          both losing clicks AND frustrating visitors, that's the single most
          urgent thing to say. Self-hides when there's no such overlap. */}
      <FixFirstCallout pages={fixFirst} />
      {cards.length > 0 && <AllSourceStatRow cards={cards} />}
    </div>
  );
}

/**
 * MAX_SEO_AEO Phase 6 (final) — the daily GOLDEN PATH strip. Composes the five
 * built controls (Refresh → Review → Approve → Verify → Learn) into one
 * orienting stepper at the TOP of the cockpit, with the single next-best
 * action linked to its existing control. READ-ONLY composition — the logic
 * lives in `golden-path.ts`; this section stays thin. Soft-fails to nothing on
 * any composer error (the composer itself never throws, but the tenant-id read
 * + an unexpected throw must never block the page). The strip ORIENTS; the
 * detailed sections below remain untouched.
 */
export async function TodayV2GoldenPathSection() {
  try {
    const tenantId = await currentTenantId();
    const state = await loadGoldenPathState(tenantId);
    return <GoldenPathStrip state={state} />;
  } catch (error) {
    console.warn("[today-golden-path] state load failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

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
  // #402 — only give the Recent wins card a column when there's actually
  // a win to show. With no wins the card renders null, so a 3-col grid
  // would leave a permanent gap; drop to 2 columns in that case.
  const winsProps = {
    measuredWins: data.measuredWins ?? [],
    urlVerdictProof: data.urlVerdictProof ?? null,
  };
  const showWins = hasRecentWins(winsProps);
  return (
    <div
      className={
        showWins
          ? "grid grid-cols-1 lg:grid-cols-3 gap-4"
          : "grid grid-cols-1 lg:grid-cols-2 gap-4"
      }
    >
      <TodayV2DoToday
        primaryAction={data.primaryAction ?? null}
        queueLoadFailed={data.queueLoadFailed ?? false}
      />
      <TodayV2Working
        liveChanges={liveChanges}
        pendingImplementationCount={pendingImplementationCount}
      />
      {showWins && <TodayV2RecentWins {...winsProps} />}
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
  // Declutter (2026-06-15): on the /today command center, hide this section
  // entirely when there's no lifecycle data yet, rather than stacking a
  // "nothing yet" placeholder next to the (often also-empty) outcomes +
  // learned tiles. The tile's empty state still renders on its own surfaces.
  if (summary.total === 0) return null;
  return (
    <EditLifecycleTile
      perStage={summary.per_stage}
      total={summary.total}
      latestLiveAtIso={summary.latest_live_at_iso}
      stageLabels={summary.tile_strings.stage_labels}
      tooltipBody={summary.tile_strings.tooltip_body}
      emptyStateBody={summary.tile_strings.empty_state_body}
      repeatCitation30d={summary.repeat_citation_30d}
    />
  );
}

/**
 * Phase A.2 §3.6 (2026-05-26) — "Beacon learned" tile section. Gated
 * behind `BEACON_BRAIN_LEARNED_TILE` (off by default — "coming soon").
 * When ON, surfaces the PER-TENANT citation-timing insight only when
 * the tenant has crossed the customer-tile sample gate AND the loader
 * resolved Beacon-owned (not borrowed) thresholds — the honesty gate.
 * Otherwise renders nothing. Returns null immediately when the flag is
 * off, so production Today is byte-identical until activation.
 */
export async function TodayV2BeaconLearnedSection() {
  if (!isBrainLearnedTileEnabled()) return null;
  let state: BeaconLearnedState = { kind: "hidden" };
  try {
    const tenantId = await currentTenantId();
    const summary = await loadLifecycleSummaryForTenant({ tenantId });
    const d = summary.threshold_decision;
    if (
      d.source === "per_tenant" &&
      d.sample_size >= BRAIN_SAMPLE_THRESHOLDS.customer_tile
    ) {
      state = {
        kind: "per_tenant",
        medianDays: d.thresholds.median_days,
        sampleSize: d.sample_size,
      };
    }
  } catch {
    state = { kind: "hidden" };
  }
  return <BeaconLearnedTile state={state} />;
}

/**
 * Section 9 Today tile (2026-05-19) — "Edit outcomes (past 30
 * days)". Streams independently from the action cards + lifecycle +
 * descriptors. Reads tenant-scoped `recommended_edits` + cached
 * `ga4_url_traffic` rows via `loadOutcomesSummaryForTenant`. Soft-
 * fails to a calm "still gathering" message on transient errors —
 * try/catch parity with the other Section 9 / Section 5 / Section 6
 * loaders so a transient Supabase failure never blocks the page.
 */
export async function TodayV2EditOutcomesSection() {
  const tenantId = await currentTenantId();
  let summary;
  try {
    summary = await loadOutcomesSummaryForTenant({ tenantId });
  } catch (error) {
    // Mirrors the Changes detail Mode A loader's try/catch posture:
    // a transient error degrades to `null` so the component renders
    // the locked "still gathering" copy. Independent structured
    // console.warn for operator visibility.
    console.warn("[section9-today-outcomes] summary load failed", {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    summary = null;
  }
  // Declutter (2026-06-15): hide on /today until there's at least one
  // shipped edit to measure (no edits → nothing to say but "nothing yet").
  // Once edits ship, the tile shows the "watching / measured" states. The
  // tile's empty copy still renders on its own surfaces.
  if (summary == null || summary.total_recent_live_edits === 0) return null;
  return <EditOutcomesTile summary={summary} />;
}

/**
 * Section 7 C7d (2026-05-22) — Off-site authority tile. The first
 * customer-facing off-site surface. Reads the now-tenant-correct
 * off-site detection snapshot (MT-2 made `loadOffSitePresenceSnapshot`
 * resolve per-tenant) and derives the operator-rule candidates purely.
 * Soft-fails to a hidden tile on loader error — a transient Supabase /
 * connector-store read failure must never block Today. The tile itself
 * renders nothing when `is_local_service === false` or when there's no
 * useful off-site signal.
 *
 * Read-only: NO recommendation-queue promotion (off-site rows stay
 * `diagnostic_only` per the locked offsite-contract) and NO connector /
 * API / scrape / LLM calls — only the cached snapshot path is read.
 */
export async function TodayV2OffSiteAuthoritySection() {
  let snapshot = null;
  let candidates: Awaited<
    ReturnType<typeof computeOffSiteRecommendationCandidates>
  >["candidates"] = [];
  try {
    snapshot = await loadOffSitePresenceSnapshot();
    candidates = computeOffSiteRecommendationCandidates(snapshot).candidates;
  } catch (error) {
    console.warn("[section7-c7d-off-site] snapshot load failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    snapshot = null;
    candidates = [];
  }
  return <OffSiteAuthorityTile snapshot={snapshot} candidates={candidates} />;
}

/**
 * Proven results — the causal Proof Engine's `computed` + positive-lift wins,
 * surfaced on the home screen as plain-English cause-and-effect proof. The
 * loader is failure-soft (→ []) and the tile self-hides when empty, so this
 * section reserves no layout until there's a real measured win.
 */
/**
 * Experiments measuring — the home-screen mirror of the GSC proof ledger.
 * Reads loadProofLedger (the RE-MEASURED ledger, exactly like /proof and
 * /changes) — NOT the raw stored records — so a window that has since closed
 * shows its true terminal verdict everywhere and Today never over-counts or
 * mislabels vs /proof. Operator-only (the /proof link is operator-gated).
 * Self-hides when nothing is measuring or on any read error.
 */
export async function TodayV2ExperimentsMeasuringSection() {
  if (!isOperatorModeServer()) return null;
  const tenantId = await currentTenantId().catch(() => null);
  if (!tenantId) return null;
  const records = await loadProofLedger(tenantId).catch(() => []);
  const measuring = records.filter((r) => r.verdict === "measuring");
  if (measuring.length === 0) return null;

  // Earliest still-pending check window across the measuring set. Skip windows
  // whose date is already today/past — a "first results around <past date>" line
  // would read as broken. (With the re-measured ledger an un-ran window is
  // already strictly future; this is belt-and-suspenders.)
  const todayYmd = new Date().toISOString().slice(0, 10);
  let nextCheckDate: string | null = null;
  for (const r of measuring) {
    for (const w of r.windows) {
      if (w.ran || !w.checkOn || w.checkOn <= todayYmd) continue;
      if (nextCheckDate == null || w.checkOn < nextCheckDate) nextCheckDate = w.checkOn;
    }
  }

  const recent: MeasuringExperiment[] = measuring
    .slice(0, 3)
    .map((r) => ({ path: r.path, actionType: r.actionType }));

  return (
    <TodayV2ExperimentsMeasuring
      count={measuring.length}
      nextCheckDate={nextCheckDate}
      recent={recent}
    />
  );
}

export async function TodayV2ProvenResultsSection() {
  const wins = await loadProvenWins({ limit: 4 }).catch(() => []);
  return <TodayV2ProvenResults wins={wins} />;
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
