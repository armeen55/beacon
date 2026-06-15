import { Suspense } from "react";

import Link from "next/link";

import { TodayClient } from "./today-client";

/**
 * Phase 2B follow-up (2026-05-13) — force dynamic rendering.
 *
 * This route reads `currentTenantId()` (via the gate loader), which
 * already triggers dynamic rendering at runtime, but the explicit
 * marker also disables Vercel's edge caching of the RSC payload AND
 * the Next.js full-route cache. The combination prevents stale
 * payloads from before a deploy serving the previous data shape
 * (e.g. the post-P0 GAIO-filter rollout where a cached payload
 * could still list "Google AI Overviews" in
 * `brandSeriesByPlatform`).
 *
 * Mirrors the other shell routes that read tenant context
 * (`/settings/*`, `/changes`, `/api/cron/*`).
 */
export const dynamic = "force-dynamic";
import {
  TodayLegacySkeleton,
  TodayV2ActionCardsSkeleton,
  TodayV2DescriptorsSkeleton,
  TodayV2EditLifecycleSkeleton,
  TodayV2EditOutcomesSkeleton,
  TodayV2VisibilityGroupSkeleton,
} from "./today-v2-skeleton";
import {
  TodayV2ActionCardsSection,
  TodayV2DescriptorsSection,
  TodayV2BeaconLearnedSection,
  TodayV2EditLifecycleSection,
  TodayV2EditOutcomesSection,
  TodayV2ProvenResultsSection,
  TodayV2OffSiteAuthoritySection,
  TodayV2VisibilityGroupSection,
} from "./today-v2-sections";
import { loadTodayV2GateData } from "./today-v2-data";
import { FirstReadingWaiting } from "@/components/today/first-reading-waiting";
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
 * Today route — perceived-speed via section-level streaming.
 *
 * Streaming bundle (2026-05-12) — the v2 path now renders THREE
 * independently streaming sections, each behind its own <Suspense>
 * boundary with a section-shaped skeleton fallback:
 *
 *   1. Visibility group (hero + chart + leaderboard) — shares the
 *      `visibilityWindow` client state, so these three stay together.
 *   2. Action cards (Do today / Working / Recent wins).
 *   3. Descriptors / "How AI describes you" — has its own NARROW
 *      loader that doesn't run the full legacy pipeline; streams
 *      first in practice.
 *
 * Before any sections render, the page awaits a cheap gate
 * (`loadTodayV2GateData`) that resolves demo-mode + first-reading
 * checks. Demo or first-reading short-circuits the page to the
 * matching view INSTANTLY without paying section-load cost.
 *
 * Legacy `?legacy=1` is unchanged — single Suspense, single loader,
 * same render as before.
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const useV2 = shouldUseV2(params);

  if (!useV2) {
    return (
      <div className="max-w-6xl">
        <Suspense fallback={<TodayLegacySkeleton />}>
          <TodayLegacyAsyncContent />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <Suspense fallback={<TodayV2SectionedSkeleton />}>
        <TodayV2SectionedContent />
      </Suspense>
    </div>
  );
}

/** Full v2 layout skeleton — used while the gate loader resolves
 *  (~the time it takes to read the canonical store). After the gate
 *  resolves, EACH section's own Suspense fallback takes over. */
function TodayV2SectionedSkeleton() {
  return (
    <div className="space-y-6">
      <TodayV2VisibilityGroupSkeleton />
      <TodayV2ActionCardsSkeleton />
      <TodayV2EditLifecycleSkeleton />
      <TodayV2DescriptorsSkeleton />
    </div>
  );
}

/**
 * V2 path: resolves the cheap gate first (demo / firstReading
 * shortcuts), then mounts the three section-streaming Suspense
 * boundaries.
 */
async function TodayV2SectionedContent() {
  const trace = createPerfTrace("loader:/", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/",
  });
  const gate = await trace.time("loadTodayV2GateData", () =>
    loadTodayV2GateData(),
  );
  trace.data("use_v2", "true");
  trace.data("is_demo", gate.isDemoMode ? "true" : "false");
  trace.data(
    "is_first_reading",
    gate.firstReading.isFirstReading ? "true" : "false",
  );
  trace.flush();

  if (gate.isDemoMode) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5">
          <h2 className="text-[13px] font-semibold text-foreground tracking-tight">
            Connect your data sources to see your real command center
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Connect Google Search Console (plus GA4, SEMrush, or
            Clarity) and refresh to see your visibility scoreboard and ranked
            actions. Three steps: 1. Connect your sources → 2. Refresh → 3.
            Review your recommendations.
          </p>
          <Link
            href="/settings/connectors"
            className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
          >
            Connect data sources →
          </Link>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Or{" "}
            <Link
              href="/settings/import"
              className="text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
            >
              import a CSV
            </Link>{" "}
            instead.
          </p>
        </div>
      </div>
    );
  }

  if (gate.firstReading.isFirstReading) {
    return <FirstReadingWaiting context={gate.firstReading.context} />;
  }

  return (
    <div className="space-y-6">
      <Suspense fallback={<TodayV2VisibilityGroupSkeleton />}>
        <TodayV2VisibilityGroupSection />
      </Suspense>
      <Suspense fallback={<TodayV2ActionCardsSkeleton />}>
        <TodayV2ActionCardsSection />
      </Suspense>
      <Suspense fallback={<TodayV2EditLifecycleSkeleton />}>
        <TodayV2EditLifecycleSection />
      </Suspense>
      {/* Phase A.2 §3.6 — "Beacon learned" tile. Gated behind
          BEACON_BRAIN_LEARNED_TILE; the section returns null when the
          flag is off or below the sample gate, so a null fallback
          reserves no layout. */}
      <Suspense fallback={null}>
        <TodayV2BeaconLearnedSection />
      </Suspense>
      <Suspense fallback={<TodayV2EditOutcomesSkeleton />}>
        <TodayV2EditOutcomesSection />
      </Suspense>
      {/* Proven results (2026-06-11) — the causal Proof Engine's measured
          wins. Self-hides until there's a real computed lift, so a null
          fallback reserves no layout for an often-empty section. */}
      <Suspense fallback={null}>
        <TodayV2ProvenResultsSection />
      </Suspense>
      {/* Section 7 C7d (2026-05-22) — off-site authority tile. Secondary
          intelligence card; the tile self-hides when there's nothing
          useful, so a null Suspense fallback avoids reserving layout
          for an often-empty section (no separate skeleton file). */}
      <Suspense fallback={null}>
        <TodayV2OffSiteAuthoritySection />
      </Suspense>
      <Suspense fallback={<TodayV2DescriptorsSkeleton />}>
        <TodayV2DescriptorsSection />
      </Suspense>
    </div>
  );
}

/**
 * Legacy `?legacy=1` path — unchanged single-Suspense load.
 */
export async function TodayLegacyAsyncContent() {
  const trace = createPerfTrace("loader:/", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/",
  });
  const data = await trace.time("loadTodayPageData", () =>
    loadTodayPageData(),
  );
  trace.data("use_v2", "false");
  trace.measureSize("payload", data);
  trace.flush();
  return (
    <TodayClient
      {...data}
      onRespondToRec={respondToRecommendation}
      onConfirmFinding={confirmFindingAsChange}
      onDismissFinding={dismissFinding}
    />
  );
}

/**
 * Backwards-compat re-export. The streaming-bundle test pin imports
 * `TodayAsyncContent` to assert that some async server component
 * awaits the slow loader. Aliasing here keeps the contract; the
 * function now routes to legacy because the v2 path no longer goes
 * through one big async component.
 */
export const TodayAsyncContent = async ({
  useV2,
}: {
  useV2: boolean;
}) => {
  if (useV2) {
    return <TodayV2SectionedContent />;
  }
  return <TodayLegacyAsyncContent />;
};
