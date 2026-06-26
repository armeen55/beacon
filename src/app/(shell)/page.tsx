import { Suspense } from "react";

import Link from "next/link";

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
  TodayV2ActionCardsSkeleton,
  TodayV2DescriptorsSkeleton,
  TodayV2EditLifecycleSkeleton,
  TodayV2EditOutcomesSkeleton,
  TodayV2VisibilityGroupSkeleton,
} from "./today-v2-skeleton";
import {
  TodayV2ActionCardsSection,
  TodayV2AllSourceSummarySection,
  TodayV2DescriptorsSection,
  TodayV2BeaconLearnedSection,
  TodayV2EditLifecycleSection,
  TodayV2EditOutcomesSection,
  TodayV2ExperimentsMeasuringSection,
  TodayV2NextExperimentBatchSection,
  TodayV2GoldenPathSection,
  TodayV2ProvenResultsSection,
  TodayV2OffSiteAuthoritySection,
  TodayV2VisibilityGroupSection,
} from "./today-v2-sections";
import { loadTodayV2GateData, loadTodayV2HasAeoData } from "./today-v2-data";
import { FirstReadingWaiting } from "@/components/today/first-reading-waiting";
import { DataSourcesStrip } from "@/components/today/data-sources-strip";
import { CollapsibleSection } from "@/components/today/collapsible-section";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { StateOfUnionSection } from "./state-of-union-section";
import { CockpitJumpNav } from "./cockpit-jump-nav";
import { CommandPalette } from "./command-palette";
import { CockpitCustomize } from "./cockpit-customize";

/** Single source of truth for the cockpit's section anchors — shared by the
 *  jump-nav, the ⌘K palette, and the Customize control (no drift). */
const COCKPIT_SECTIONS: { id: string; label: string }[] = [
  { id: "sec-opportunities", label: "Opportunities" },
  { id: "sec-leverage", label: "Highest-leverage pages" },
  { id: "sec-trend", label: "Traffic trend" },
  { id: "sec-rising", label: "Rising demand" },
  { id: "sec-momentum", label: "Pages moving" },
  { id: "sec-bands", label: "Where you rank" },
  { id: "sec-clusters", label: "What content works" },
  { id: "sec-brand", label: "Branded vs discovery" },
  { id: "sec-questions", label: "Questions to answer" },
  { id: "sec-recover", label: "Recover" },
  { id: "sec-thin", label: "Expand thin pages" },
  { id: "sec-recoveries", label: "Turned around" },
  { id: "sec-quickwins", label: "Quick wins" },
  { id: "sec-ctrgap", label: "Seen not clicked" },
  { id: "sec-cannibal", label: "Self-competing" },
  { id: "sec-leaks", label: "Conversion leaks" },
  { id: "sec-tools", label: "Tools" },
  { id: "sec-newpages", label: "New pages" },
  { id: "sec-opportunities-radar", label: "New opportunities" },
  { id: "sec-implement", label: "Implement" },
  { id: "sec-ai-traffic", label: "AI traffic" },
  { id: "sec-friction-fixes", label: "Friction fixes" },
  { id: "sec-image-alt", label: "Page health" },
  { id: "sec-entity", label: "Entity" },
];
import { TodayMovesHeroSection } from "./today-moves-hero";
import { TodayOpportunitiesFeed } from "./today-opportunities-feed";
import { TodayPositionBandsSection } from "./today-position-bands-section";
import { TodayBrandSplitSection } from "./today-brand-split-section";
import { TodayClustersSection } from "./today-clusters-section";
import { TodayTrendSection } from "./today-trend-section";
import { TodayLeverageSection } from "./today-leverage-section";
import { TodayMomentumSection } from "./today-momentum-section";
import { TodayDeclinesSection } from "./today-declines-section";
import { TodayRisingSection } from "./today-rising-section";
import { TodayThinSection } from "./today-thin-section";
import { TodayRecoveriesSection } from "./today-recoveries-section";
import { TodayQuickWinsSection } from "./today-quickwins-section";
import { TodayCtrGapSection } from "./today-ctrgap-section";
import { TodayQuestionsSection } from "./today-questions-section";
import { TodayCannibalizationSection } from "./today-cannibalization-section";
import { TodayMoneyLeakSection } from "./today-moneyleak-section";
import { TodayEntityFoundationSection } from "./today-entity-foundation-section";
import { TodayToolsSection } from "./today-tools-section";
import { TodayNewPagesSection } from "./today-newpages-section";
import { TodayOpportunitiesSection } from "./today-opportunities-section";
import { ExecutionSection } from "./execution-section";
import { ProfoundDeepSection } from "./profound-deep-section";
import { ImageAltSection } from "./image-alt-section";
import { FrictionFixesSection } from "./friction-fixes-section";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";

/**
 * Today route — the all-source unified command center.
 *
 * Surface collapse (2026-06-15) — the legacy AEO-centric 19-section
 * layout (the old `?legacy=1` path + `TodayClient`) was deleted; V2 is
 * now the ONLY surface. The page LEADS with the all-source stat row +
 * the universal action/outcome layer and DEMOTES AEO into one
 * collapsible "AI answers" block.
 *
 * Perceived-speed via section-level streaming — the page renders
 * independently streaming sections, each behind its own <Suspense>
 * boundary with a section-shaped skeleton fallback:
 *
 *   1. Visibility group (hero + chart + leaderboard) — shares the
 *      `visibilityWindow` client state, so these three stay together.
 *   2. Action cards (Do today / Working / Recent wins).
 *   3. Descriptors / "How AI describes you" — has its own NARROW
 *      loader that doesn't run the full pipeline; streams first in
 *      practice.
 *
 * Before any sections render, the page awaits a cheap gate
 * (`loadTodayV2GateData`) that resolves demo-mode + first-reading
 * checks. Demo or first-reading short-circuits the page to the
 * matching view INSTANTLY without paying section-load cost.
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const notice = params.notice;

  return (
    <div className="max-w-6xl">
      <AlreadyLaunchedNotice notice={notice} />
      <Suspense fallback={<TodayV2SectionedSkeleton />}>
        <TodayV2SectionedContent />
      </Suspense>
    </div>
  );
}

/**
 * #143: when an already-launched customer revisits an /onboard/* URL, the
 * access guard sends them here with `?notice=already_launched` instead of
 * bouncing silently. Explain the redirect and point them to where setup
 * details now live, rather than leaving them wondering if they misclicked.
 */
function AlreadyLaunchedNotice({
  notice,
}: {
  notice: string | string[] | undefined;
}) {
  if (notice !== "already_launched") return null;
  return (
    <div className="mb-6 rounded-md border border-border/60 bg-surface-inset/40 px-4 py-3 text-[13px]">
      <p className="font-medium text-foreground">
        You&apos;ve already finished setup — here&apos;s your workspace.
      </p>
      <p className="mt-1 text-muted-foreground">
        Setup is a one-time step. To change your business details, service
        area, or competitors, head to{" "}
        <Link
          href="/settings/config"
          className="text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
        >
          Settings
        </Link>
        .
      </p>
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
 * shortcuts), then mounts the section-streaming Suspense
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
            Connect Google Search Console (plus GA4 or
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

  // All-source command-center reorder (2026-06-15). Beacon is NOT an
  // AEO-only tool — AEO is one source among equals. So the page now LEADS
  // with the all-source stat row + the universal action/outcome layer,
  // and DEMOTES the AEO visibility hero + descriptors into one collapsible
  // "AI answers" block lower on the page. The collapsible opens by default
  // only when the tenant actually has AEO data (so it never opens blank).
  const hasAeoData = await loadTodayV2HasAeoData();

  return (
    <div className="space-y-6">
      {/* Print-only report header (2026-06-25) — gives the "Save as PDF report"
          output a proper title block; hidden on screen. */}
      <header className="hidden print:block border-b border-gray-300 pb-3">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Beacon — Rank &amp; Revenue Report</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Generated {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </p>
      </header>
      {/* Operator-OS rebuild (2026-06-19) — the State of the Union executive
          briefing leads the cockpit for operators: one card that reads the
          whole business across GSC/Clarity/GA4 and says what's
          happening + what to do. Operator-gated; its own Suspense (null
          fallback) so its tenant reads never block the rest of the page; it
          self-hides when there's no data. Customer view is unchanged. */}
      {/* The ONE primary task list for everyone (IA consolidation 2026-06-23):
          "How your business is doing" + Today's plan (top 3) + the measuring
          summary. Un-gated so every user sees the polished GSC-grounded plan as
          their single daily list, not the older Do-today / Fix-these-first
          duplicates (removed below). */}
      <Suspense fallback={null}>
        <StateOfUnionSection />
      </Suspense>
      {/* Jump-nav (2026-06-25) — sticky index for the cockpit's many self-hiding
          sections; only shows anchors that actually rendered content. */}
      <CockpitJumpNav targets={COCKPIT_SECTIONS} />
      {/* ⌘K command palette (2026-06-25) — jump to any lens/section or key route
          from the keyboard. Shares the cockpit section anchors. Client-only, no data. */}
      <CommandPalette targets={COCKPIT_SECTIONS} />
      {/* Customize (2026-06-25) — hide the lenses you don't use, persisted locally. */}
      <div className="mt-3 flex justify-end">
        <CockpitCustomize targets={COCKPIT_SECTIONS} />
      </div>
      {/* Today's Moves hero (2026-06-24) — the premium §7 ritual surface. Leads
          the cockpit with the live Rank-&-Revenue Moves (demand-graph engine,
          now flowing into the real queue) as rich cards: who AI cites now, what
          wins, the grounded outline, the proof plan, and a one-tap route to ship.
          Its own Suspense (null fallback) so its reads never block the page; the
          section self-hides when the engine is off for the tenant (no Moves). */}
      <Suspense fallback={null}>
        <TodayMovesHeroSection />
      </Suspense>
      {/* Biggest opportunities (2026-06-25) — the §2 promise made literal: ONE
          ranked list fusing recover-declines + win-striking by estimated monthly
          clicks at stake, the headline above the per-axis detail sections below.
          Own Suspense / self-hides when nothing clears the bar. */}
      <div id="sec-opportunities" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayOpportunitiesFeed />
        </Suspense>
      </div>
      {/* Highest-leverage pages (2026-06-25) — cross-lens signal fusion. Own Suspense / self-hides. */}
      <div id="sec-leverage" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayLeverageSection />
        </Suspense>
      </div>
      {/* Your traffic trend (2026-06-25) — macro weekly clicks trend. Own Suspense / self-hides. */}
      <div id="sec-trend" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayTrendSection />
        </Suspense>
      </div>
      {/* Rising demand (2026-06-25) — emerging queries gaining clicks fast. Own Suspense / self-hides. */}
      <div id="sec-rising" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayRisingSection />
        </Suspense>
      </div>
      {/* Which pages are moving (2026-06-25) — per-page weekly momentum drill-down. Own Suspense / self-hides. */}
      <div id="sec-momentum" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayMomentumSection />
        </Suspense>
      </div>
      {/* Questions to answer (2026-06-25) — AEO answer-block lens. Own Suspense / self-hides. */}
      <div id="sec-questions" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayQuestionsSection />
        </Suspense>
      </div>
      {/* Where you rank (2026-06-25) — portfolio ranking-distribution funnel. Own Suspense / self-hides. */}
      <div id="sec-bands" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayPositionBandsSection />
        </Suspense>
      </div>
      {/* What content works (2026-06-25) — content-cluster performance. Own Suspense / self-hides. */}
      <div id="sec-clusters" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayClustersSection />
        </Suspense>
      </div>
      {/* Branded vs discovery (2026-06-25) — reach split. Own Suspense / self-hides. */}
      <div id="sec-brand" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayBrandSplitSection />
        </Suspense>
      </div>
      {/* Recover lost ground (2026-06-25) — the queries the worklist pages are
          actively LOSING (recent vs prior 28d, GSC-grounded). Names the bleeding
          so the operator can act. Own Suspense / self-hides when nothing declines. */}
      <div id="sec-recover" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayDeclinesSection />
        </Suspense>
      </div>
      {/* Expand thin pages (2026-06-25) — thin-but-trafficked expand candidates. Own Suspense / self-hides. */}
      <div id="sec-thin" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayThinSection />
        </Suspense>
      </div>
      {/* Pages you've turned around (2026-06-25) — the payoff of the recover loop:
          shipped fixes whose Google clicks climbed back (before/after the ship date).
          Own Suspense / self-hides when nothing has recovered yet. */}
      <div id="sec-recoveries" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayRecoveriesSection />
        </Suspense>
      </div>
      {/* Quick CTR wins (2026-06-25) — symmetric to Recover-lost-ground: site-wide
          pages in striking distance (pos 4–15, real demand). Own Suspense / self-hides. */}
      <div id="sec-quickwins" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayQuickWinsSection />
        </Suspense>
      </div>
      {/* Seen but not clicked (2026-06-25) — well-ranked pages with CTR far below
          expected for their position (title/snippet fix). Own Suspense / self-hides. */}
      <div id="sec-ctrgap" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayCtrGapSection />
        </Suspense>
      </div>
      {/* Stop competing with yourself (2026-06-25) — site-wide cannibalization:
          own pages co-ranking + splitting clicks. Own Suspense / self-hides. */}
      <div id="sec-cannibal" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayCannibalizationSection />
        </Suspense>
      </div>
      {/* Fix conversion leaks (2026-06-25, L8/CRO) — the REVENUE site-wide lens:
          high-traffic pages with Clarity friction leaking conversions. Own Suspense / self-hides. */}
      <div id="sec-leaks" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayMoneyLeakSection />
        </Suspense>
      </div>
      {/* Entity foundation (2026-06-25, L11) — one-time Organization + WebSite JSON-LD
          (site-level entity recognition for Google + AI). Own Suspense / self-hides. */}
      <div id="sec-entity" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayEntityFoundationSection />
        </Suspense>
      </div>
      {/* Tools worth building (2026-06-25, §5/§8 asset engine) — interactive assets
          the site's searchers ask for (GSC tool-intent demand). Own Suspense / self-hides. */}
      <div id="sec-tools" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayToolsSection />
        </Suspense>
      </div>
      {/* New Pages to Build (2026-06-24) — the create_page half of the engine:
          topics competitors own that the tenant has no page for. These never
          enter the edit queue (they're new pages), so this board is their home.
          Own Suspense / self-hides when there are none. */}
      <div id="sec-newpages" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayNewPagesSection />
        </Suspense>
      </div>
      {/* New Opportunities / Demand Radar (2026-06-25, Sprint 4G) — real external
          search demand → discovered opportunities (improve existing vs build new vs
          product concept). CACHE-ONLY render ($0); operator runs Discover to fetch.
          Own Suspense / self-hides when empty + no operator. */}
      <div id="sec-opportunities-radar" className="scroll-mt-24">
        <Suspense fallback={null}>
          <TodayOpportunitiesSection />
        </Suspense>
      </div>
      {/* Operator Execution Layer (2026-06-25, Sprint 5) — exact what/where/paste
          + confirmation-gated mark-applied → measurement. READ-ONLY; no publish.
          Own Suspense / self-hides when empty + no operator. */}
      <div id="sec-implement" className="scroll-mt-24">
        <Suspense fallback={null}>
          <ExecutionSection />
        </Suspense>
      </div>
      {/* AI traffic (2026-06-25, Sprint 6) — resurrected Profound bot+referral data:
          AI-referred visits + uncrawled valuable pages. Self-hides when no data. */}
      <div id="sec-ai-traffic" className="scroll-mt-24">
        <Suspense fallback={null}>
          <ProfoundDeepSection />
        </Suspense>
      </div>
      {/* Sprint 6 (plan P13) — Clarity as a Move router: the specific fix per page
          (errors / dead click / rage / intent / buried answer). Self-hides. */}
      <div id="sec-friction-fixes" className="scroll-mt-24">
        <Suspense fallback={null}>
          <FrictionFixesSection />
        </Suspense>
      </div>
      {/* Sprint 6 — image alt-text: operator-triggered $0 scan of owned pages →
          missing/poor alt + a deterministic suggestion to paste. Self-hides. */}
      <div id="sec-image-alt" className="scroll-mt-24">
        <Suspense fallback={null}>
          <ImageAltSection />
        </Suspense>
      </div>
      {/* MAX_SEO_AEO Phase 6 (final) — the daily GOLDEN PATH strip. Sits at
          the TOP of the cockpit and ORIENTS the operator through the one
          guided loop (Refresh → Review → Approve → Verify → Learn) with the
          single next-best action. READ-ONLY composition (logic in
          golden-path.ts); its own Suspense boundary with a null fallback so
          its tenant-scoped reads never block the rest of the page, and it
          self-hides on any composer error. */}
      <Suspense fallback={null}>
        <TodayV2GoldenPathSection />
      </Suspense>
      {/* IA consolidation 2026-06-23: the "Next experiment batch" list was a
          second task list competing with Today's plan above. It lives on the
          Experiments page now; Today shows ONE plan. */}
      {/* "Your data sources" quick-connect strip (2026-06-15) — mounted
          AFTER the demo + first-reading gate short-circuits above, so it
          only shows on the real V2 command center. Its own server reads
          are fail-soft; renders nothing when all six sources connect.
          Wrapped in Suspense so its connector reads don't delay the rest
          of the command center streaming in. */}
      <Suspense fallback={null}>
        <DataSourcesStrip />
      </Suspense>
      {/* All-source stat row (2026-06-15) — the unified command-center
          scoreboard: one tiny card per source that HAS data (Search /
          Visits / Rankings / Experience / AI answers as equals). Its own
          Suspense boundary with a null fallback so its added Supabase
          reads (the #72 statement-timeout class) never block the rest of
          the page streaming; the section self-hides when no source has
          data. Default-on — the self-hide is the safety. */}
      <Suspense fallback={null}>
        <TodayV2AllSourceSummarySection />
      </Suspense>
      {/* IA consolidation 2026-06-23: the action-cards layer (Do today /
          Working / Recent wins) was two more task lists competing with Today's
          plan above. "Do today" duplicated the plan; "Working" + "Recent wins"
          are change-status and belong on Results. Removed from Today so the
          plan is the single daily list. */}
      {/* GA4-grounded edit outcomes — behavior/SEO-adjacent, kept high. */}
      <Suspense fallback={<TodayV2EditOutcomesSkeleton />}>
        <TodayV2EditOutcomesSection />
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
      {/* Experiments measuring (2026-06-22) — mirrors the GSC proof ledger so
          the home screen shows shipped changes mid-measurement (measuring ->
          proven). Operator-only; self-hides when nothing is measuring. */}
      <Suspense fallback={null}>
        <TodayV2ExperimentsMeasuringSection />
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
      {/* DEMOTED "AI answers" block (2026-06-15) — the AEO visibility
          group (hero + trend chart + leaderboard, kept in ONE Suspense so
          they share visibilityWindow client state — never split) and the
          AEO descriptors, wrapped in a single collapsible container so AEO
          reads as one-section-among-equals. <details>-based collapse keeps
          the heavy subtree out of view by default; opens automatically
          only when the tenant has AEO data. */}
      <CollapsibleSection
        title="AI answers"
        subtitle="How AI assistants see and recommend you"
        defaultOpen={hasAeoData}
        sectionKey="ai-answers"
      >
        <div className="space-y-6">
          <Suspense fallback={<TodayV2VisibilityGroupSkeleton />}>
            <TodayV2VisibilityGroupSection />
          </Suspense>
          <Suspense fallback={<TodayV2DescriptorsSkeleton />}>
            <TodayV2DescriptorsSection />
          </Suspense>
        </div>
      </CollapsibleSection>
    </div>
  );
}
