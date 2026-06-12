import Link from "next/link";
import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import { StatCard } from "@/components/data/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getOpportunities,
  getBriefs,
  getChangelogEntries,
  getResults,
  getCompetitors,
} from "@/lib/seed-data.server";
import {
  computeDiagnostics,
  computeCandidateDiagnostics,
  computeModelReport,
} from "@/domains/attribution/diagnostics";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { resolveEvents, computeEventIntelligence } from "@/domains/attribution/event-resolution";
import { getCandidateLinks, getEventDecisions } from "@/domains/attribution/store";
import {
  buildAttributionDriverMap,
  summarizeDriverCoverage,
} from "@/domains/attribution/result-drivers";
import { computeActionClusters } from "@/domains/action-clusters/compute";
import { summarizeClusters } from "@/domains/action-clusters/selectors";
import {
  CLUSTER_STATUS_LABELS,
  CLUSTER_STATUS_COLORS,
} from "@/domains/action-clusters/types";
import type { ClusterStatus } from "@/domains/action-clusters/types";
import { computePatterns } from "@/domains/patterns/compute";
import { summarizePatterns } from "@/domains/patterns/selectors";
import {
  PATTERN_CONFIDENCE_COLORS,
  PATTERN_TREND_LABELS,
  PATTERN_TREND_COLORS,
} from "@/domains/patterns/types";
import { hasActiveExperiment } from "@/lib/seed-data.server";
import { computeOpportunityCandidates } from "@/domains/opportunity-candidates/compute";
import { summarizeCandidates } from "@/domains/opportunity-candidates/selectors";
import {
  CANDIDATE_TYPE_LABELS,
  CANDIDATE_TYPE_COLORS,
  CANDIDATE_CONFIDENCE_COLORS,
} from "@/domains/opportunity-candidates/types";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import { getOwnedPages } from "@/domains/pages/page-store";
import { warmPageRegistry } from "@/domains/attribution/candidates";
import type { PageEntity, PageSnapshot } from "@/domains/pages/types";
import { getCitationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import { extractEntities, summarizeEntities } from "@/domains/entity/entity-extract";
import { detectDiscrepancies } from "@/domains/entity/discrepancy-detect";
import type { DiscrepancySeverity } from "@/domains/entity/discrepancy-types";
import { getPageIssues } from "@/domains/pages/issues";
import { computeGeoCoverage, summarizeGeoCoverage } from "@/domains/geo/coverage";
import { getActivePrompts, getPromptLibrary } from "@/domains/prompts/prompt-library";
import type { LibraryPrompt } from "@/domains/prompts/types";
import { computeJourneyCoverage } from "@/domains/prompts/journey-coverage";
import { JOURNEY_STAGE_LABELS } from "@/domains/prompts/journey-stages";
import { computeBeaconScore } from "@/domains/product/beacon-score";
import type { ScoreDimension } from "@/domains/product/beacon-score-types";
import {
  computeCitationDecay,
  getDecayAlerts,
  summarizeDecay,
} from "@/domains/attribution/citation-decay";
import { getSiteConfig } from "@/lib/site-config";
import { getBusinessConfig, isPlaceholderConfig } from "@/lib/business-config";
import {
  computeLocalOperatorSurface,
  loadLocalOperatorImport,
} from "@/domains/local-operator/surface";
import { LocalOperatorPanel } from "@/components/local-operator/local-operator-panel";
import { computeMarketBenchmark } from "@/domains/pages/builder-benchmark";
import { analyzeAllExtractability, summarizeExtractability } from "@/domains/pages/extractability";
import { computeSnippetIntelligence } from "@/domains/competitors/snippet-intel";
import type { SnippetSignal } from "@/domains/competitors/snippet-types";
import { assessAdversarialReadiness } from "@/domains/prompts/adversarial";
import { assessWhatIfReadiness } from "@/domains/product/whatif-engine";
import { getOutcomeRecords } from "@/domains/product/outcome-store";
import { assessFounderAuthority } from "@/domains/entity/founder-authority";
import { assessConversionPathReadiness } from "@/domains/product/conversion-path";
import { assessTrainingDataReadiness } from "@/domains/product/training-data";
import { getAnswerSnapshots } from "@/domains/answer-snapshots/store";
import { computePulse } from "@/domains/product/pulse";
import { generateVisibilityReport, serializeReport } from "@/domains/product/report-generator";
import { computeOutcomeSummary } from "@/domains/product/outcome-store";
import { MiniBarChart } from "@/components/viz/mini-bar-chart";
import { DonutRing } from "@/components/viz/donut-ring";
import { ScoreRail } from "@/components/viz/score-rail";
import { CoverageTrellis } from "@/components/viz/coverage-trellis";
import { RankLadder } from "@/components/viz/rank-ladder";
import { StackedBar } from "@/components/viz/stacked-bar";
import { ThreatMeter } from "@/components/viz/threat-meter";
import { ConfidenceBadge } from "@/components/viz/confidence-badge";
import { ComparisonBar } from "@/components/viz/comparison-bar";
import { KpiCard } from "@/components/viz/kpi-card";
import { BeaconScoreVisual as BeaconScoreViz } from "./beacon-score-visual";

function StatBlock({
  label,
  value,
  sub,
  variant,
}: {
  label: string;
  value: string | number;
  sub?: string;
  variant?: "success" | "warning" | "danger" | "default";
}) {
  const color =
    variant === "success"
      ? "text-status-success"
      : variant === "warning"
        ? "text-status-warning"
        : variant === "danger"
          ? "text-status-danger"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border/50 bg-surface-raised/30 px-3 py-2.5 transition-colors hover:border-border/70">
      <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide">
        {label}
      </p>
      <p className={`text-lg font-bold tabular-nums tracking-tight mt-1 ${color}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-[9px] text-muted-foreground/50 mt-1">{sub}</p>}
    </div>
  );
}

const disclosureShell =
  "rounded-lg border border-border/60 bg-card [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold tracking-tight text-foreground mb-2">{children}</h3>;
}

function DisclosureBlock({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <details className={disclosureShell}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/30 rounded-lg">
        <span className="block">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{subtitle}</span>
        )}
      </summary>
      <div className="border-t border-border/40 px-4 py-4">{children}</div>
    </details>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-surface-inset overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground w-8 text-right">{value}</span>
    </div>
  );
}

// Sprint 7 Phase 7.5c/4 (2026-04-25) — diagnostics finishing touch.
// Module-level `repo`, `pageSnapshots`, and `allPages` were lifted into
// DiagnosticsPage's request scope. Each request now resolves its own
// header-set tenant via the resolver and threads the data into helper
// React components via a `ctx: DiagnosticsContext` prop. No more
// module-level repo / state in this file.
type DiagnosticsContext = {
  pages: PageEntity[];
  pageSnapshots: PageSnapshot[];
  citationEvidenceIndex: import("@/domains/pages/types").CitationEvidenceIndex | null;
  promptLibrary: LibraryPrompt[];
  activePrompts: LibraryPrompt[];
};

/**
 * 2026-05-06 demo-path fix — operator-only gate.
 *
 * /diagnostics renders engineering-grade telemetry (precision/recall
 * tables, Greek statistical notation, raw env-var names, internal
 * pipeline jargon). Pre-2026-05-06 it had no server-side guard, so a
 * customer URL-guessing /diagnostics would land on a page that
 * self-labels "for operators who need depth without leaving Beacon."
 * That's a demo-killer.
 *
 * Gate: operator must have BEACON_OPERATOR_MODE=true in their env (or
 * NODE_ENV=test for the test runner). Anything else 404s. The hidden-
 * from-nav status is preserved (see src/lib/navigation.ts) — this
 * guard is the second layer protecting against URL-guessing.
 */
function isOperatorMode(): boolean {
  // Server-only gate. Test extension preserves render-under-test for
  // existing route assertions without per-test env plumbing.
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

// 2026-05-15 — Vercel prerender safety. Without this directive, Next.js
// statically prerenders the operator-only /diagnostics index at build
// time, which executes 13+ tenant-scoped Supabase reads (including
// repo.getPageSnapshots() on a ≥ 1,367-row table) and intermittently
// hits Supabase's statement_timeout, producing nondeterministic
// deployment failures. Every sibling page under /diagnostics/* already
// declares this directive (brain, spikes, indexability). The directive
// opts the page into per-request rendering so the Supabase reads only
// run when an operator actually visits. Pinned by
// `tests/architecture/diagnostics-page-dynamic.test.ts`.
export const dynamic = "force-dynamic";

export default async function DiagnosticsPage() {
  if (!isOperatorMode()) {
    notFound();
  }
  const [results, changelogEntries, opportunities, briefs, competitors, eventDecisions, candidateLinks, pageIssues, outcomeRecords, answerSnapshots, citationEvidenceIndex, promptLibrary, activePrompts] = await Promise.all([
    getResults(),
    getChangelogEntries(),
    getOpportunities(),
    getBriefs(),
    getCompetitors(),
    getEventDecisions(),
    getCandidateLinks(),
    getPageIssues(),
    getOutcomeRecords(),
    getAnswerSnapshots(),
    getCitationEvidenceIndex(),
    getPromptLibrary(),
    getActivePrompts(),
  ]);
  const diag = computeDiagnostics(results, changelogEntries, opportunities, briefs, competitors);
  const cdiag = await computeCandidateDiagnostics(results, changelogEntries, opportunities);
  const modelReport = await computeModelReport(results, changelogEntries, opportunities, cdiag);

  const driverMap = buildAttributionDriverMap(
    results,
    changelogEntries,
    opportunities,
    eventDecisions
  );
  const driverCov = summarizeDriverCoverage(results, driverMap);
  const isExperimentActive = await hasActiveExperiment();

  // Sprint 7 Phase 7.5c/4 (2026-04-25) — fetch tenant-scoped pages +
  // snapshots once at the top of the request, then thread to helpers via
  // `ctx`. Replaces the prior module-level reads (Phase 7.5b/5 + 7.5c/3
  // partial fixes); each render now resolves its own tenant header.
  const tenantId = await currentTenantId();
  const repo = getRepository().forTenant(tenantId);
  const [pages, pageSnapshots] = await Promise.all([
    getOwnedPages(),
    repo.getPageSnapshots(),
  ]);
  await warmPageRegistry();
  const ctx: DiagnosticsContext = { pages, pageSnapshots, citationEvidenceIndex, promptLibrary, activePrompts };

  const { attribution: attrResults } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attrResults);
  const triageMap = new Map<string, ReturnType<typeof triageCandidates>>();
  const candCountMap = new Map<string, number>();
  for (const event of events) {
    const anchor = results.find((r) => r.id === event.anchor_result_id);
    if (!anchor) continue;
    const cands = discoverCandidates(anchor, changelogEntries, opportunities);
    candCountMap.set(event.anchor_result_id, cands.length);
    triageMap.set(event.anchor_result_id, triageCandidates(cands));
  }
  const resolved = resolveEvents(events, candidateLinks, triageMap, candCountMap);
  const eventIntel = computeEventIntelligence(resolved);

  const maxDensity = Math.max(...Object.values(diag.coverage.attribution_density));
  const maxConfidence = Math.max(...Object.values(diag.confidence));
  const maxVerdict = Math.max(...Object.values(diag.verdicts));
  const maxCandDist = Math.max(...Object.values(cdiag.candidate_distribution));

  const confirmedLinks = candidateLinks.filter((c) => c.status === "confirmed").length;

  const decayLocal = getDecayAlerts(computeCitationDecay(getSiteConfig().siteDomain));
  const geoLocal = computeGeoCoverage(
    pages,
    citationEvidenceIndex?.by_page_and_topic ?? [],
    activePrompts,
  );
  const localDiagSurface = computeLocalOperatorSurface({
    business: getBusinessConfig(tenantId),
    importRow: await loadLocalOperatorImport(),
    geoGap: geoLocal.gaps[0]
      ? {
          city: geoLocal.gaps[0].city,
          competitor_pages: geoLocal.gaps[0].competitor_pages,
          owned_pages: geoLocal.gaps[0].owned_pages,
        }
      : null,
    meaningfulDecayCount: decayLocal.filter((d) => d.status === "meaningful_decline")
      .length,
  });

  // D6 (operator audit follow-up, 2026-05-05) — placeholder-config
  // diagnostic. /diagnostics is an admin / operator surface (hidden
  // from main nav, gated by tenant context); a clearly-labeled banner
  // here is the right place to show "configuration not loaded" state.
  // This is NOT a customer-facing scary warning — it's an internal
  // operator signal to set BEACON_BUSINESS_CONFIG_JSON or place a
  // tenant config file. The same state also fires a one-time
  // log.warn from the business-config resolver so server logs carry the trace.
  const businessConfig = getBusinessConfig(tenantId);
  const isOnPlaceholderConfig = isPlaceholderConfig(businessConfig);

  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader
        title="Diagnostics"
        description="System specialist view: how attribution data is shaped, linked, and scored in this workspace. Technical and honest — for operators who need depth without leaving Beacon."
      />

      {isOnPlaceholderConfig && (
        <div
          className="rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-4 py-3 -mt-2"
          data-diagnostic="placeholder-config"
        >
          <p className="text-[13px] font-semibold text-status-warning">
            Configuration not loaded — running on neutral placeholder.
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
            The app resolved to an empty placeholder config because no
            tenant config was found. Set the{" "}
            <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">
              BEACON_BUSINESS_CONFIG_JSON
            </code>{" "}
            environment variable on Vercel (Production + Preview) with
            the full JSON payload, or place a tenant config file at{" "}
            <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">
              .data/global/business-config.json
            </code>{" "}
            for local development. Until then, brand-shaped surfaces
            (name, domain, locations, services, competitors) render
            empty across the app.
          </p>
        </div>
      )}

      <div className="-mt-2 mb-6">
        <LocalOperatorPanel surface={localDiagSurface} variant="health" />
      </div>

      <p className="-mt-4 text-sm text-muted-foreground leading-relaxed">
        Day-to-day decisions live on{" "}
        <Link href="/" className="text-foreground underline-offset-4 hover:underline">
          Today
        </Link>
        ,{" "}
        <Link href="/review" className="text-foreground underline-offset-4 hover:underline">
          Review
        </Link>
        , and{" "}
        <Link href="/settings/history" className="text-foreground underline-offset-4 hover:underline">
          History
        </Link>
        . Use this page when you need to sanity-check linkage, coverage, or model-shaped stats. Refresh evidence from{" "}
        <Link href="/settings/import" className="text-foreground underline-offset-4 hover:underline">
          Import
        </Link>
        .
      </p>

      {/* Phase A.2 Step 3d (2026-05-18) — operator-only deep dive
          surface. Surfaces the suggested → reviewed → accepted →
          shipped → cited → threshold-eligible funnel per row +
          aggregate so "1 of 28" math is impossible to misunderstand
          again. Operator-gated; read-only. */}
      <p
        className="-mt-2 text-xs text-muted-foreground"
        data-diagnostics-hub-link="lifecycle-eligibility"
      >
        Operator-only deep dive:{" "}
        <Link
          href="/diagnostics/lifecycle-eligibility"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Lifecycle eligibility
        </Link>{" "}
        — per-row reason taxonomy for the suggested → accepted → shipped
        → cited → threshold-eligible funnel.
      </p>

      {/* Dream shift (2026-06-11) — the causal Proof Engine's whole-tenant
          view: status histogram, top causally-proven wins, per-bucket Move
          Forecast base rates. The fastest way to confirm the nightly proof
          run is producing real `computed` outcomes. Operator-gated; read-only. */}
      <p
        className="-mt-2 text-xs text-muted-foreground"
        data-diagnostics-hub-link="proof-engine"
      >
        Operator-only deep dive:{" "}
        <Link
          href="/diagnostics/proof-engine"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Proof Engine
        </Link>{" "}
        — causal diff-in-differences outcomes per tenant: status histogram,
        top proven wins, and the per-bucket forecast base rates the
        before-you-ship Move Forecast reads.
      </p>

      {/* ── Pulse summary ── */}
      <PulseBanner ctx={ctx} />

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <p className="text-xs text-muted-foreground mb-3">At a glance</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Change records" value={changelogEntries.length} />
          <StatCard label="Visibility snapshots" value={results.length} />
          <StatCard label="Outcome events" value={eventIntel.total_events} />
          <StatCard
            label="Review pending (events)"
            value={eventIntel.pending}
          />
        </div>
      </section>

      <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">How to read system metrics</p>
        <p className="mt-1.5 leading-relaxed">
          <span className="text-foreground">Imported change IDs on snapshot rows</span> and{" "}
          <span className="text-foreground">event + Review drivers</span> are different layers — both appear below with clear labels.
          Queue and pattern stats describe the engine, not revenue or pilot outcomes.
        </p>
      </div>

      {/* Knows vs Suspects */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">Recorded in data</p>
          <div className="space-y-1 text-sm">
            <p><span className="font-medium tabular-nums text-foreground">{changelogEntries.length}</span> change records</p>
            <p><span className="font-medium tabular-nums text-foreground">{results.length}</span> visibility snapshots</p>
            <p><span className="font-medium tabular-nums text-foreground">{eventIntel.total_events}</span> outcome events (attribution-mode series)</p>
            <p><span className="font-medium tabular-nums text-foreground">{eventIntel.attributed}</span> events with Review-locked cause</p>
            <p><span className="font-medium tabular-nums text-foreground">{eventIntel.auto_resolved}</span> events auto-cleared (triage)</p>
            <p><span className="font-medium tabular-nums text-foreground">{confirmedLinks}</span> candidate links confirmed</p>
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
          <p className="text-xs font-medium text-status-warning mb-2">Open or inferred</p>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p><span className="tabular-nums text-foreground">{eventIntel.pending}</span> events awaiting Review</p>
            <p><span className="tabular-nums text-foreground">{eventIntel.no_candidates}</span> events with no scored candidates</p>
            <p><span className="tabular-nums text-foreground">{eventIntel.resolution_rate}%</span> of detected events closed (Review, auto, or no cause) — not a business outcome rate</p>
          </div>
        </div>
      </div>

      {/* Entity Inventory */}
      <DisclosureBlock
        title="Entity inventory"
        subtitle="Totals by entity type — imported vs seed"
      >
        <div className="rounded-md border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Entity</TableHead>
                <TableHead className="text-xs text-right">Total</TableHead>
                <TableHead className="text-xs text-right">Imported</TableHead>
                <TableHead className="text-xs text-right">Seed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diag.entity_counts.map((ec) => (
                <TableRow key={ec.type}>
                  <TableCell className="text-sm font-medium">{ec.type}</TableCell>
                  <TableCell className="text-sm tabular-nums text-right">{ec.total}</TableCell>
                  <TableCell className="text-sm tabular-nums text-right">
                    {ec.imported > 0 ? ec.imported : "—"}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-right">{ec.seed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DisclosureBlock>

      {/* Event Intelligence */}
      <div>
        <SectionTitle>Event intelligence</SectionTitle>
        <p className="text-sm text-muted-foreground mb-4">
          Outcome events from attribution-mode time series. Events are the learning unit — not daily snapshots.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          <StatBlock label="Total events" value={eventIntel.total_events} />
          <StatBlock
            label="Review locked"
            value={eventIntel.attributed}
            variant="success"
            sub="Cause saved from Review"
          />
          <StatBlock
            label="Auto-cleared"
            value={eventIntel.auto_resolved}
            sub="Triage only (no Review)"
          />
          <StatBlock
            label="No cause"
            value={eventIntel.no_cause}
            sub="All candidates rejected"
          />
          <StatBlock
            label="Pending"
            value={eventIntel.pending}
            variant={eventIntel.pending > 0 ? "warning" : "default"}
            sub="Needs review"
          />
          <StatBlock
            label="Queue closed"
            value={`${eventIntel.resolution_rate}%`}
            sub="Of detected events"
            variant="default"
          />
        </div>

        {(Object.keys(eventIntel.by_type).length > 0 || eventIntel.top_changes.length > 0) && (
          <DisclosureBlock
            title="Breakdowns & evidence tables"
            subtitle="By event type and changes with the strongest event signal"
          >
            {Object.keys(eventIntel.by_type).length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-medium text-muted-foreground mb-2">By event type</p>
                <div className="rounded-md border border-border/60 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Event type</TableHead>
                        <TableHead className="text-xs text-right">Total</TableHead>
                        <TableHead className="text-xs text-right">Resolved</TableHead>
                        <TableHead className="text-xs text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(eventIntel.by_type).map(([type, data]) => (
                        <TableRow key={type}>
                          <TableCell className="text-sm font-medium capitalize">
                            {type.replace(/_/g, " ")}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums text-right">
                            {data.total}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums text-right text-status-success">
                            {data.resolved}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums text-right">
                            {data.total > 0 ? Math.round((data.resolved / data.total) * 100) : 0}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {eventIntel.top_changes.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Changes with strongest event evidence</p>
                <div className="rounded-md border border-border/60 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Change</TableHead>
                        <TableHead className="text-xs text-right">Events</TableHead>
                        <TableHead className="text-xs">Topics</TableHead>
                        <TableHead className="text-xs">Event types</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {eventIntel.top_changes.map((cl) => {
                        const change = changelogEntries.find((c) => c.id === cl.change_id);
                        return (
                          <TableRow key={cl.change_id}>
                            <TableCell className="text-sm font-medium max-w-[200px] truncate">
                              {change?.asset_name ?? cl.change_id}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums text-right text-status-success font-medium">
                              {cl.events_attributed}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
                              {cl.topics.join(", ")}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {cl.event_types.map((t) => t.replace(/_/g, " ")).join(", ")}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </DisclosureBlock>
        )}
      </div>

      {/* Cluster Intelligence */}
      {isExperimentActive && (() => {
        const { clusters } = computeActionClusters(results, changelogEntries, opportunities, candidateLinks);
        const cs = summarizeClusters(clusters);
        const statusOrder: ClusterStatus[] = ["working", "review_now", "fix_data", "investigate_external", "monitor_only", "low_signal"];
        return (
          <div>
            <SectionTitle>Cluster intelligence</SectionTitle>
            <p className="text-sm text-muted-foreground mb-4">
              Action clusters group related visibility shifts to speed up Review.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
              <StatBlock label="Total clusters" value={cs.total} />
              <StatBlock label="Working" value={cs.working} variant="success" />
              <StatBlock label="Review now" value={cs.review_now} variant="warning" />
              <StatBlock label="Fix data" value={cs.fix_data + cs.investigate_external} variant="danger" />
              <StatBlock label="Avg score" value={cs.avgScore} />
            </div>
            <DisclosureBlock title="Cluster list & status mix" subtitle="Per-cluster scores and distribution by status">
              <div className="rounded-md border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Cluster</TableHead>
                      <TableHead className="text-xs text-center">Status</TableHead>
                      <TableHead className="text-xs text-right">Events</TableHead>
                      <TableHead className="text-xs text-right">Attributed</TableHead>
                      <TableHead className="text-xs text-right">Pending</TableHead>
                      <TableHead className="text-xs text-right">Score</TableHead>
                      <TableHead className="text-xs text-right">Urgency</TableHead>
                      <TableHead className="text-xs">Evidence tier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clusters.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs font-medium max-w-[180px] truncate">
                          {c.label}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`text-xs font-semibold ${CLUSTER_STATUS_COLORS[c.status]}`}>
                            {CLUSTER_STATUS_LABELS[c.status]}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right">{c.eventCount}</TableCell>
                        <TableCell className="text-xs tabular-nums text-right text-status-success">
                          {c.attributedEventCount}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right text-status-warning">
                          {c.pendingEventCount}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right font-medium">{c.score}</TableCell>
                        <TableCell className="text-xs tabular-nums text-right">{c.urgency}</TableCell>
                        <TableCell className="text-xs text-muted-foreground capitalize">{c.confidenceBand}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4">
                <StackedBar
                  title="Cluster status mix"
                  entries={[{
                    label: "All clusters",
                    segments: statusOrder.map((status) => ({
                      label: CLUSTER_STATUS_LABELS[status],
                      value: clusters.filter((c) => c.status === status).length,
                      color: status === "working" ? "bg-status-success"
                        : status === "review_now" ? "bg-status-warning"
                        : status === "fix_data" || status === "investigate_external" ? "bg-status-danger"
                        : "bg-muted-foreground/30",
                    })),
                  }]}
                  height={24}
                />
              </div>
            </DisclosureBlock>
          </div>
        );
      })()}

      {/* Pattern Intelligence */}
      {isExperimentActive && (() => {
        const { patterns } = computePatterns(results, changelogEntries, opportunities, candidateLinks);
        const ps = summarizePatterns(patterns);
        if (patterns.length === 0) return null;
        return (
          <div>
            <SectionTitle>Pattern intelligence</SectionTitle>
            <p className="text-sm text-muted-foreground mb-4">
              Patterns from change metadata and cluster history. Historical success % is an internal score from attributed events — not revenue or closed deals.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
              <StatBlock label="Patterns" value={ps.total} />
              <StatBlock label="High model score" value={ps.highConfidence} variant="default" />
              <StatBlock label="Avg historical success %" value={`${ps.avgSuccessRate}%`} variant="default" sub="Cluster-tagged only" />
              <StatBlock label="Trend: improving" value={ps.improving} variant="default" />
              <StatBlock label="Trend: declining" value={ps.declining} variant={ps.declining > 0 ? "warning" : "default"} />
            </div>
            <DisclosureBlock title="Pattern table" subtitle="Executions, clusters, internal scores">
              <div className="rounded-md border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Pattern</TableHead>
                      <TableHead className="text-xs text-center">Evidence tier</TableHead>
                      <TableHead className="text-xs text-center">Trend</TableHead>
                      <TableHead className="text-xs text-right">Executions</TableHead>
                      <TableHead className="text-xs text-right">Clusters</TableHead>
                      <TableHead className="text-xs text-right">Attributed</TableHead>
                      <TableHead className="text-xs text-right">Hist. %</TableHead>
                      <TableHead className="text-xs text-right">Avg days</TableHead>
                      <TableHead className="text-xs text-right">Score</TableHead>
                      <TableHead className="text-xs">Untapped</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patterns.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs font-medium max-w-[150px] truncate">
                          {p.label}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`text-xs font-semibold capitalize ${PATTERN_CONFIDENCE_COLORS[p.confidenceBand]}`}>
                            {p.confidenceBand}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`text-xs ${PATTERN_TREND_COLORS[p.trend]}`}>
                            {PATTERN_TREND_LABELS[p.trend]}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right">{p.executionCount}</TableCell>
                        <TableCell className="text-xs tabular-nums text-right">{p.clustersImpacted}</TableCell>
                        <TableCell className="text-xs tabular-nums text-right text-status-success">{p.attributedEventCount}</TableCell>
                        <TableCell className="text-xs tabular-nums text-right font-medium">{p.successRate}%</TableCell>
                        <TableCell className="text-xs tabular-nums text-right text-muted-foreground">{p.avgTimeToImpact || "—"}</TableCell>
                        <TableCell className="text-xs tabular-nums text-right font-medium">{p.score}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                          {p.untappedContexts.length > 0 ? p.untappedContexts.slice(0, 2).join(", ") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </DisclosureBlock>
          </div>
        );
      })()}

      {/* Expansion Intelligence */}
      {isExperimentActive && (() => {
        const expCandidates = computeOpportunityCandidates(results, changelogEntries, opportunities, candidateLinks, businessConfig.locations);
        const es = summarizeCandidates(expCandidates);
        if (expCandidates.length === 0) return null;
        return (
          <div>
            <SectionTitle>Expansion candidates (system)</SectionTitle>
            <p className="text-sm text-muted-foreground mb-4">
              System-derived opportunity candidates from pattern intelligence — surfaced here for inspection; product workflow for ideas remains separate.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
              <StatBlock label="Total candidates" value={es.total} />
              <StatBlock label="New" value={es.new} variant="success" />
              <StatBlock label="Strong signal tier" value={es.high} variant="success" />
              <StatBlock label="Medium" value={es.medium} variant="warning" />
              <StatBlock label="Adjacent" value={es.adjacent} />
              <StatBlock label="Expansion" value={es.expansion} />
            </div>
            <DisclosureBlock title="Candidate sample (first 20)" subtitle="Type, evidence tier, source pattern">
              <div className="rounded-md border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Candidate</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Evidence tier</TableHead>
                      <TableHead className="text-xs">Pattern</TableHead>
                      <TableHead className="text-xs">Target</TableHead>
                      <TableHead className="text-xs text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expCandidates.slice(0, 20).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm font-medium max-w-[200px] truncate">
                          {c.label}
                          {c.alreadyExists && (
                            <span className="ml-1 text-[10px] text-muted-foreground italic">exists</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium ${CANDIDATE_TYPE_COLORS[c.opportunityType]}`}>
                            {CANDIDATE_TYPE_LABELS[c.opportunityType]}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium capitalize ${CANDIDATE_CONFIDENCE_COLORS[c.confidence]}`}>
                            {c.confidence}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">
                          {c.sourcePatternLabel}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.targetCity ?? c.targetTopic}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{c.expectedImpact}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </DisclosureBlock>
          </div>
        );
      })()}

      {/* Stored change IDs on result rows (import / workbook) */}
      <DisclosureBlock
        title="Imported change IDs on snapshot rows"
        subtitle={`${diag.coverage.with_attributions} of ${diag.coverage.total_results} rows carry workbook/import IDs — not the same layer as event + Review drivers below`}
      >
        <p className="text-sm text-muted-foreground mb-4">
          Counts rows where{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">attributed_changelog_ids</code> is non-empty.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatBlock label="All results" value={diag.coverage.total_results} />
          <StatBlock
            label="Rows with stored IDs"
            value={diag.coverage.with_attributions}
            variant={diag.coverage.with_attributions > 0 ? "success" : "default"}
            sub={`${diag.coverage.total_results > 0 ? Math.round((diag.coverage.with_attributions / diag.coverage.total_results) * 100) : 0}% of rows`}
          />
          <StatBlock
            label="Rows without stored IDs"
            value={diag.coverage.without_attributions}
            variant={diag.coverage.without_attributions > 0 ? "warning" : "default"}
          />
          <StatBlock
            label="4+ IDs on one row"
            value={diag.coverage.over_attributed}
            variant={diag.coverage.over_attributed > 0 ? "danger" : "default"}
          />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">IDs per row (density)</p>
          <div className="space-y-1.5">
            {Object.entries(diag.coverage.attribution_density).map(([bucket, count]) => (
              <div key={bucket} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-6">{bucket}</span>
                <Bar value={count} max={maxDensity} color="bg-accent-primary" />
              </div>
            ))}
          </div>
        </div>
      </DisclosureBlock>

      {/* Event + Review drivers (same engine as Results table) */}
      <div>
        <SectionTitle>Event + Review drivers</SectionTitle>
        <p className="text-sm text-muted-foreground mb-4">
          Same pipeline as{" "}
          <Link href="/settings/history" className="font-medium text-foreground underline-offset-4 hover:underline">
            History
          </Link>{" "}
          → suggested cause. Attribution-mode snapshots only.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatBlock label="Attribution-mode results" value={driverCov.attributionModeResultCount} />
          <StatBlock
            label="With stored IDs (subset)"
            value={driverCov.withStoredChangeIds}
            sub="Overlaps imported-ID counts"
          />
          <StatBlock
            label="With event/Review driver"
            value={driverCov.withEventDriver}
            variant={driverCov.withEventDriver > 0 ? "success" : "default"}
          />
          <StatBlock
            label="Review locked (results)"
            value={driverCov.byTrust.confirmed}
            sub="Rows with Review decision"
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatBlock label="System / auto-cleared" value={driverCov.byTrust.system_primary + driverCov.byTrust.auto_cleared} />
          <StatBlock label="Contributing pick" value={driverCov.byTrust.contributing} />
          <StatBlock label="Needs review (top candidate)" value={driverCov.byTrust.unresolved} variant={driverCov.byTrust.unresolved > 0 ? "warning" : "default"} />
        </div>
      </div>

      <DisclosureBlock
        title="Stored-ID pair scoring & model shape"
        subtitle={`${diag.inflation.total_pairs} change→result pairs from stored IDs only — scoring tiers, factors, inflation checks, verdicts, timing`}
      >
        <div>
          <SectionTitle>Attribution tier distribution</SectionTitle>
          <p className="text-sm text-muted-foreground mb-3">
            {diag.inflation.total_pairs} pairs scored from stored IDs only.
            {diag.inflation.total_pairs === 0 && (
              <span className="mt-1 block text-status-warning">
                When this is zero, the blocks below are empty — use Event + Review drivers for the live pipeline.
              </span>
            )}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatBlock label="High" value={diag.confidence.high} variant="success" />
            <StatBlock label="Medium" value={diag.confidence.medium} />
            <StatBlock label="Low" value={diag.confidence.low} variant="warning" />
            <StatBlock label="Uncertain" value={diag.confidence.uncertain} variant="danger" />
          </div>
          <div className="space-y-1.5">
            {(["high", "medium", "low", "uncertain"] as const).map((level) => (
              <div key={level} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16 capitalize">{level}</span>
                <Bar
                  value={diag.confidence[level]}
                  max={maxConfidence}
                  color={
                    level === "high"
                      ? "bg-status-success"
                      : level === "medium"
                        ? "bg-accent-primary"
                        : level === "low"
                          ? "bg-status-warning"
                          : "bg-status-danger"
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <SectionTitle>Factor contribution</SectionTitle>
          <div className="rounded-md border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Factor</TableHead>
                  <TableHead className="text-xs text-right">Strong</TableHead>
                  <TableHead className="text-xs text-right">Partial</TableHead>
                  <TableHead className="text-xs text-right">None</TableHead>
                  <TableHead className="text-xs text-right">Unknown</TableHead>
                  <TableHead className="text-xs text-right">Avg points</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diag.factors.map((f) => (
                  <TableRow key={f.factor}>
                    <TableCell className="text-sm font-medium capitalize">{f.factor}</TableCell>
                    <TableCell className="text-sm tabular-nums text-right text-status-success">
                      {f.strong}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums text-right text-status-warning">
                      {f.partial}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums text-right text-muted-foreground">
                      {f.none}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums text-right text-muted-foreground/60">
                      {f.unknown}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums text-right font-medium">
                      {f.avg_contribution}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="mt-8">
          <SectionTitle>Attribution inflation risk</SectionTitle>
          <p className="text-sm text-muted-foreground mb-3">
            Null fields score as unknown (0 points). Highest-scoring attribution pairs with missing structural anchors still deserve scrutiny.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatBlock
              label="Null URL rate"
              value={`${diag.inflation.null_url_rate}%`}
              variant={diag.inflation.null_url_rate > 50 ? "warning" : "default"}
            />
            <StatBlock
              label="Null geo rate"
              value={`${diag.inflation.null_geo_rate}%`}
              variant={diag.inflation.null_geo_rate > 50 ? "warning" : "default"}
            />
            <StatBlock
              label="Null topic rate"
              value={`${diag.inflation.null_topic_rate}%`}
              variant={diag.inflation.null_topic_rate > 30 ? "danger" : "default"}
            />
            <StatBlock
              label="High + nulls"
              value={diag.inflation.high_confidence_with_nulls}
              variant={diag.inflation.high_confidence_with_nulls > 0 ? "danger" : "success"}
              sub="Strong signal tier with URL or geo null"
            />
          </div>
        </div>

        <div className="mt-8">
          <SectionTitle>Model outcome labels</SectionTitle>
          <StackedBar
            entries={[{
              label: "Verdict distribution",
              segments: Object.entries(diag.verdicts).map(([verdict, count]) => ({
                label: verdict.replace("_", " "),
                value: count,
                color: verdict === "validated" ? "bg-status-success"
                  : verdict === "partial" ? "bg-status-warning"
                  : verdict === "no_impact" ? "bg-status-danger"
                  : "bg-muted-foreground/30",
              })),
            }]}
            height={28}
          />
        </div>

        <div className="mt-8">
          <SectionTitle>Temporal analysis</SectionTitle>
          {diag.temporal.pairs_analyzed > 0 ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatBlock label="Avg days" value={diag.temporal.average_days ?? "—"} />
              <StatBlock label="Median days" value={diag.temporal.median_days ?? "—"} />
              <StatBlock label="Min days" value={diag.temporal.min_days ?? "—"} />
              <StatBlock label="Max days" value={diag.temporal.max_days ?? "—"} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No linked change→result pairs to analyze.</p>
          )}
        </div>
      </DisclosureBlock>

      {/* Unlinked Entities */}
      <div>
        <SectionTitle>Linkage gaps</SectionTitle>
        <p className="text-sm text-muted-foreground mb-4">
          Records missing expected relationships — worth fixing before trusting downstream attribution.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <StatBlock
            label="Changes without results"
            value={diag.unlinked.changes_without_results}
            variant={diag.unlinked.changes_without_results > 0 ? "warning" : "success"}
            sub={`of ${changelogEntries.length} total changes`}
          />
          <StatBlock
            label="Results without changes"
            value={diag.unlinked.results_without_changes}
            variant={diag.unlinked.results_without_changes > 0 ? "warning" : "success"}
            sub={`of ${results.length} total results`}
          />
          <StatBlock
            label="Changes without opportunity"
            value={diag.unlinked.changes_with_no_opportunity}
            sub="No upstream linkage"
          />
          <StatBlock
            label="Changes without brief"
            value={diag.unlinked.changes_with_no_brief}
            sub="No execution context"
          />
        </div>
      </div>

      {/* Candidate linking + link review */}
      <div>
        <SectionTitle>Candidate linking</SectionTitle>
        <p className="text-sm text-muted-foreground mb-4">
          Automated discovery of plausible causes and the link-review queue (confirmed / rejected / pending).
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatBlock label="Total results" value={cdiag.total_results} />
          <StatBlock
            label="With candidates"
            value={cdiag.results_with_candidates}
            variant={cdiag.results_with_candidates > 0 ? "success" : "default"}
            sub={`${cdiag.total_results > 0 ? Math.round((cdiag.results_with_candidates / cdiag.total_results) * 100) : 0}%`}
          />
          <StatBlock
            label="No candidates"
            value={cdiag.results_without_candidates}
            variant={cdiag.results_without_candidates > cdiag.total_results / 2 ? "warning" : "default"}
          />
          <StatBlock label="Avg per result" value={cdiag.avg_candidates_per_result} />
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatBlock label="Confirmed" value={cdiag.link_status.confirmed} variant="success" />
          <StatBlock label="Rejected" value={cdiag.link_status.rejected} variant="danger" />
          <StatBlock label="Pending" value={cdiag.link_status.suggested} />
        </div>
        <DisclosureBlock
          title="Distribution & score calibration"
          subtitle="Candidates per result and confirmed vs rejected score spread"
        >
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Candidates per result</p>
            <div className="space-y-1.5">
              {Object.entries(cdiag.candidate_distribution).map(([bucket, count]) => (
                <div key={bucket} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-10">{bucket}</span>
                  <Bar value={count} max={maxCandDist} color="bg-accent-primary" />
                </div>
              ))}
            </div>
          </div>
          {cdiag.score_calibration.avg_confirmed_score !== null && (
            <div className="mt-6">
              <p className="text-xs font-medium text-muted-foreground mb-2">Score calibration</p>
              <div className="grid grid-cols-2 gap-3">
                <StatBlock
                  label="Avg confirmed score"
                  value={cdiag.score_calibration.avg_confirmed_score}
                  variant="success"
                  sub="Higher is better calibrated"
                />
                <StatBlock
                  label="Avg rejected score"
                  value={cdiag.score_calibration.avg_rejected_score ?? "—"}
                  variant={cdiag.score_calibration.avg_rejected_score !== null ? "danger" : "default"}
                  sub="Lower is better calibrated"
                />
              </div>
            </div>
          )}
        </DisclosureBlock>
      </div>

      {/* Truth Labels */}
      {cdiag.truth_labels.total > 0 && (
        <DisclosureBlock
          title="Truth-set evaluation"
          subtitle={`${cdiag.truth_labels.total} human labels — model vs human agreement when available`}
        >
          <p className="text-sm text-muted-foreground mb-4">
            Ground-truth labels for attribution quality; not shown in daily surfaces.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            <StatBlock label="Total labels" value={cdiag.truth_labels.total} />
            <StatBlock label="Causal" value={cdiag.truth_labels.causal} variant="success" />
            <StatBlock label="Contributing" value={cdiag.truth_labels.contributing} />
            <StatBlock label="Unrelated" value={cdiag.truth_labels.unrelated} variant="danger" />
            <StatBlock label="Unknown" value={cdiag.truth_labels.unknown} />
          </div>
          {cdiag.truth_agreement && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Model vs human agreement</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <StatBlock
                  label="True positives"
                  value={cdiag.truth_agreement.model_positive_human_positive}
                  variant="success"
                  sub="Linked + human agrees"
                />
                <StatBlock
                  label="False positives"
                  value={cdiag.truth_agreement.model_positive_human_negative}
                  variant="danger"
                  sub="Linked but human disagrees"
                />
                <StatBlock
                  label="False negatives"
                  value={cdiag.truth_agreement.model_negative_human_positive}
                  variant="warning"
                  sub="Not linked but human says yes"
                />
                <StatBlock
                  label="True negatives"
                  value={cdiag.truth_agreement.model_negative_human_negative}
                  sub="Not linked + human agrees"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatBlock
                  label="Precision"
                  value={cdiag.truth_agreement.precision !== null ? `${cdiag.truth_agreement.precision}%` : "—"}
                  sub="Of linked pairs, % human-endorsed"
                  variant={
                    cdiag.truth_agreement.precision !== null
                      ? cdiag.truth_agreement.precision >= 70 ? "success" : cdiag.truth_agreement.precision >= 40 ? "warning" : "danger"
                      : "default"
                  }
                />
                <StatBlock
                  label="Recall"
                  value={cdiag.truth_agreement.recall !== null ? `${cdiag.truth_agreement.recall}%` : "—"}
                  sub="Of human-positive, % model found"
                  variant={
                    cdiag.truth_agreement.recall !== null
                      ? cdiag.truth_agreement.recall >= 70 ? "success" : cdiag.truth_agreement.recall >= 40 ? "warning" : "danger"
                      : "default"
                  }
                />
              </div>
            </div>
          )}
        </DisclosureBlock>
      )}

      {/* Model Report */}
      <div>
        <SectionTitle>Model gaps & recommendations</SectionTitle>
        <p className="text-sm text-muted-foreground mb-4">
          Scoring model gaps. “Unresolved” here means{" "}
          <span className="font-medium text-foreground">no stored change IDs on the result row</span> — not “no driver” on History rows.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatBlock
            label="Rows without stored IDs"
            value={`${modelReport.unresolved_rate}%`}
            variant="default"
            sub="Of all results — compare Event + Review drivers"
          />
          <StatBlock
            label="Topic unknown"
            value={`${modelReport.metadata_gap_rates.topic_unknown_pct}%`}
            variant={modelReport.metadata_gap_rates.topic_unknown_pct > 40 ? "warning" : "default"}
            sub="of candidate pairs"
          />
          <StatBlock
            label="URL unknown"
            value={`${modelReport.metadata_gap_rates.url_unknown_pct}%`}
            variant={modelReport.metadata_gap_rates.url_unknown_pct > 60 ? "warning" : "default"}
            sub="of candidate pairs"
          />
          <StatBlock
            label="Platform unknown"
            value={`${modelReport.metadata_gap_rates.platform_unknown_pct}%`}
            variant={modelReport.metadata_gap_rates.platform_unknown_pct > 60 ? "warning" : "default"}
            sub="of candidate pairs"
          />
        </div>

        {modelReport.factor_comparison.some((f) => f.confirmed_avg_points > 0 || f.rejected_avg_points > 0) && (
          <DisclosureBlock
            title="Factor lift: confirmed vs rejected"
            subtitle="Average points by factor for confirmed vs rejected links"
          >
            <div className="rounded-md border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Factor</TableHead>
                    <TableHead className="text-xs text-right">Confirmed avg</TableHead>
                    <TableHead className="text-xs text-right">Rejected avg</TableHead>
                    <TableHead className="text-xs text-right">Lift</TableHead>
                    <TableHead className="text-xs text-right">Confirmed strong%</TableHead>
                    <TableHead className="text-xs text-right">Confirmed unknown%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modelReport.factor_comparison.map((f) => (
                    <TableRow key={f.factor}>
                      <TableCell className="text-sm font-medium capitalize">{f.factor}</TableCell>
                      <TableCell className="text-sm tabular-nums text-right text-status-success">
                        {f.confirmed_avg_points}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-right text-status-danger">
                        {f.rejected_avg_points}
                      </TableCell>
                      <TableCell className={`text-sm tabular-nums text-right font-medium ${f.lift > 0 ? "text-status-success" : f.lift < 0 ? "text-status-danger" : ""}`}>
                        {f.lift > 0 ? "+" : ""}{f.lift}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-right">
                        {f.confirmed_strong_pct}%
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-right text-muted-foreground">
                        {f.confirmed_unknown_pct}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </DisclosureBlock>
        )}

        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Recommendations</p>
          <div className="space-y-2">
            {modelReport.recommendations.map((rec, i) => (
              <div
                key={i}
                className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5"
              >
                <p className="text-sm text-foreground">{rec}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Entity + representation intelligence ── */}
      <EntityRepresentationSection ctx={ctx} />

      {/* ── Geographic coverage intelligence ── */}
      <GeoCoverageSection ctx={ctx} />

      {/* ── Journey stage intelligence ── */}
      <JourneyCoverageSection ctx={ctx} />

      {/* ── Beacon Score ── */}
      <BeaconScoreSection ctx={ctx} />

      {/* ── Extractability intelligence ── */}
      <ExtractabilitySection ctx={ctx} />

      {/* ── Snippet intelligence ── */}
      <SnippetIntelSection ctx={ctx} />

      {/* ── Advanced intelligence readiness ── */}
      <AdvancedReadinessSection ctx={ctx} />
    </div>
  );
}

async function EntityRepresentationSection({ ctx }: { ctx: DiagnosticsContext }) {
  const entityIndex = await extractEntities(ctx.pageSnapshots);
  const entitySummary = summarizeEntities(entityIndex);
  const discrepancyReport = await detectDiscrepancies(entityIndex);

  const notable = discrepancyReport.discrepancies.filter((d) => d.severity === "notable");
  const minor = discrepancyReport.discrepancies.filter((d) => d.severity === "minor");

  return (
    <div className="space-y-4">
      <SectionTitle>Entity &amp; representation intelligence</SectionTitle>
      <p className="text-xs text-muted-foreground -mt-2">
        How Beacon understands your identity and how AI answers represent you. Early-stage detection — conservative signals only.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBlock label="Entities tracked" value={entitySummary.total} />
        <StatBlock label="Owned" value={entitySummary.owned} />
        <StatBlock label="Locations" value={entitySummary.locations} />
        <StatBlock label="Services" value={entitySummary.services} />
      </div>

      {entitySummary.external_brands > 0 && (
        <DisclosureBlock
          title={`${entitySummary.external_brands} external brands in AI answers`}
          subtitle="Competitors and other entities mentioned alongside your brand"
        >
          <div className="space-y-1">
            {entitySummary.top_external.map((name) => (
              <p key={name} className="text-sm text-foreground font-medium">{name}</p>
            ))}
            {entitySummary.external_brands > 5 && (
              <p className="text-xs text-muted-foreground mt-2">
                +{entitySummary.external_brands - 5} more
              </p>
            )}
          </div>
        </DisclosureBlock>
      )}

      {discrepancyReport.discrepancies.length > 0 ? (
        <DisclosureBlock
          title={`${discrepancyReport.discrepancies.length} possible representation ${discrepancyReport.discrepancies.length === 1 ? "discrepancy" : "discrepancies"}`}
          subtitle={`${notable.length > 0 ? `${notable.length} notable` : ""}${notable.length > 0 && minor.length > 0 ? ", " : ""}${minor.length > 0 ? `${minor.length} minor` : ""} · ${discrepancyReport.data_note}`}
        >
          <div className="space-y-3">
            {discrepancyReport.discrepancies.map((d) => (
              <div
                key={d.id}
                className={`rounded-md border px-3 py-2.5 ${
                  d.severity === "notable"
                    ? "border-status-warning/30 bg-status-warning/[0.04]"
                    : "border-border/50 bg-muted/10"
                }`}
              >
                <p className="text-sm font-medium text-foreground">{d.summary}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{d.detail}</p>
                <div className="flex gap-3 mt-1.5 text-[10px] text-muted-foreground/70">
                  <span>{d.evidence_count} evidence points</span>
                  <span>Evidence tier: {d.confidence}</span>
                </div>
              </div>
            ))}
          </div>
        </DisclosureBlock>
      ) : (
        <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2.5">
          <p className="text-sm text-muted-foreground">
            No clear representation discrepancies detected.
            {discrepancyReport.total_answers_checked > 0
              ? ` Checked ${discrepancyReport.total_answers_checked} AI answers.`
              : " No answer data available yet."}
          </p>
        </div>
      )}
    </div>
  );
}

function JourneyCoverageSection({ ctx }: { ctx: DiagnosticsContext }) {
  const journeyCoverage = computeJourneyCoverage(ctx.promptLibrary);
  const coreStages = journeyCoverage.stages.filter(
    (s) => ["awareness", "consideration", "comparison", "decision"].includes(s.stage),
  );

  return (
    <div className="space-y-4">
      <SectionTitle>Journey stage coverage</SectionTitle>
      <p className="text-xs text-muted-foreground -mt-2">
        How prompts distribute across buyer journey stages. Based on keyword classification — not ML.
      </p>

      <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2.5">
        <p className="text-sm text-muted-foreground">{journeyCoverage.assessment}</p>
      </div>

      <div className="flex flex-col sm:flex-row items-start gap-6">
        <DonutRing
          segments={journeyCoverage.stages
            .filter((s) => s.active_prompt_count > 0)
            .map((s) => ({
              label: s.label,
              value: s.active_prompt_count,
              color: s.status === "strong" ? "stroke-status-success" : s.status === "moderate" ? "stroke-accent-primary" : "stroke-status-warning",
            }))}
          size={90}
          thickness={10}
          centerValue={journeyCoverage.total_active}
          centerLabel="prompts"
        />
        <div className="flex-1 min-w-0">
          <MiniBarChart
            entries={coreStages.map((s) => ({
              label: s.label,
              value: s.active_prompt_count,
              color: s.status === "absent" ? "bg-status-danger/30" : s.status === "strong" ? "bg-status-success" : s.status === "moderate" ? "bg-accent-primary" : "bg-status-warning",
              meta: s.status === "absent" ? "No prompts tracked" : `${s.pct_of_total}% of total`,
            }))}
            height={8}
          />
        </div>
      </div>

      {journeyCoverage.absent_stages.length > 0 && (
        <div className="rounded-md border border-status-warning/20 bg-status-warning/[0.03] px-3 py-2">
          <p className="text-sm font-medium text-foreground">
            Missing stages: {journeyCoverage.absent_stages.map((s) => JOURNEY_STAGE_LABELS[s]).join(", ")}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Adding prompts for these stages would broaden visibility tracking across the buyer journey.
          </p>
        </div>
      )}
    </div>
  );
}

async function BeaconScoreSection({ ctx }: { ctx: DiagnosticsContext }) {
  const { siteDomain } = getSiteConfig();
  const citIndex = ctx.citationEvidenceIndex;
  const pageIssues = await getPageIssues();
  const benchmark = citIndex ? computeMarketBenchmark(citIndex, pageIssues) : null;

  const geoCoverage = computeGeoCoverage(ctx.pages, citIndex?.by_page_and_topic ?? [], ctx.activePrompts);
  const geoSummary = summarizeGeoCoverage(geoCoverage);

  const journeyCoverage = computeJourneyCoverage(ctx.promptLibrary);
  const coveredStages = journeyCoverage.stages.filter((s) => s.active_prompt_count > 0).length;

  const decayResults = computeCitationDecay(siteDomain);
  const decaySummary = summarizeDecay(decayResults);

  const entityIndex = await extractEntities(ctx.pageSnapshots);
  const discReport = await detectDiscrepancies(entityIndex);

  const totalOwnedCit = citIndex?.by_page_and_topic
    .filter((r) => r.is_owned)
    .reduce((s, r) => s + r.total_citations, 0) ?? 0;

  const scoreResult = computeBeaconScore({
    totalOwnedCitations: totalOwnedCit,
    totalOwnedMentions: 0,
    topicsCovered: citIndex?.by_topic.filter((t) => t.owned_citations > 0).length ?? 0,
    citiesCovered: geoSummary.strong + geoSummary.moderate,
    journeyStagesCovered: coveredStages,
    totalJourneyStages: 4,
    decayStableCount: decaySummary.stable,
    decayDecliningCount: decaySummary.meaningful_decline + decaySummary.soft_decline,
    decayTotal: decaySummary.total_analyzed - decaySummary.insufficient,
    ownedSharePct: benchmark?.ownedAppearanceRate ?? null,
    competitorCount: benchmark?.topCompetitors.length ?? 0,
    discrepancyCount: discReport.discrepancies.length,
    discrepancyNotableCount: discReport.discrepancies.filter((d) => d.severity === "notable").length,
    totalAnswersChecked: discReport.total_answers_checked,
    geoGapCount: geoSummary.gap_count,
    geoCitiesWithPresence: geoSummary.strong + geoSummary.moderate + geoSummary.weak,
    geoTotalCities: geoSummary.total_cities,
  });

  return (
    <div className="space-y-4">
      <SectionTitle>Beacon Score</SectionTitle>
      <p className="text-xs text-muted-foreground -mt-2">
        Multi-dimensional visibility health. Each dimension is computed independently — the composite only appears when enough data exists.
      </p>

      <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2.5">
        <p className="text-sm text-muted-foreground">{scoreResult.summary}</p>
      </div>

      <BeaconScoreViz
        dimensions={scoreResult.dimensions.map((d) => ({ label: d.label, value: d.value, max: d.max, status: d.status }))}
        composite={scoreResult.composite}
        compositeStatus={scoreResult.composite_status}
        sufficientCount={scoreResult.sufficient_count}
        totalDimensions={scoreResult.total_dimensions}
      />
    </div>
  );
}

function DimensionRow({ dimension }: { dimension: ScoreDimension }) {
  const pct = dimension.value !== null ? Math.round((dimension.value / dimension.max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{dimension.label}</span>
        <span className="text-sm font-semibold tabular-nums">
          {dimension.value !== null ? dimension.value : "—"}
          <span className="text-muted-foreground font-normal">/{dimension.max}</span>
        </span>
      </div>
      {dimension.value !== null && (
        <div className="h-1.5 rounded-full bg-border/40">
          <div
            className={`h-1.5 rounded-full transition-all ${
              pct >= 60 ? "bg-status-success" : pct >= 35 ? "bg-status-warning" : "bg-status-danger"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">{dimension.explanation}</p>
      {dimension.status !== "sufficient" && (
        <p className="text-[10px] text-status-warning italic">
          {dimension.status === "insufficient" ? "Insufficient data" : "Partial data"}
        </p>
      )}
    </div>
  );
}

function ExtractabilitySection({ ctx }: { ctx: DiagnosticsContext }) {
  const citIdx = ctx.citationEvidenceIndex;
  const citMap = new Map<string, number>();
  if (citIdx) {
    for (const r of citIdx.by_page_and_topic) {
      if (!r.is_owned) continue;
      const key = r.page_url.replace(/\/+$/, "").toLowerCase();
      citMap.set(key, (citMap.get(key) ?? 0) + r.total_citations);
    }
  }

  const results = analyzeAllExtractability(ctx.pageSnapshots, citMap);
  const summary = summarizeExtractability(results);

  if (results.length === 0) {
    return (
      <div className="space-y-2">
        <SectionTitle>Content extractability</SectionTitle>
        <p className="text-xs text-muted-foreground">No cited owned pages to analyze.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionTitle>Content extractability</SectionTitle>
      <p className="text-xs text-muted-foreground -mt-2">
        How well your cited pages are structured for AI extraction. Pages earning citations but missing FAQ, schema, or answer-formatted content have untapped potential.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBlock label="Pages analyzed" value={summary.total} />
        <StatBlock label="Good" value={summary.good} sub={summary.fair > 0 ? `${summary.fair} fair` : undefined} />
        <StatBlock label="Needs work" value={summary.needs_work + summary.poor} />
        <StatBlock label="Avg score" value={summary.avg_score} sub="/100" />
      </div>

      {results.filter((r) => r.grade !== "good").length > 0 && (
        <DisclosureBlock
          title={`${results.filter((r) => r.grade !== "good").length} pages with extractability opportunities`}
          subtitle="Cited pages that could benefit from structural improvements"
        >
          <div className="space-y-3">
            {results.filter((r) => r.grade !== "good").slice(0, 8).map((r) => (
              <div key={r.page_url} className="rounded-md border border-border/50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground truncate">
                    {r.page_title ?? r.page_url.replace(/^https?:\/\/[^/]+/, "")}
                  </p>
                  <span className={`text-[10px] font-medium shrink-0 ${
                    r.grade === "fair" ? "text-status-warning" : "text-status-danger"
                  }`}>
                    {r.score}/100 · {r.citation_count} cit.
                  </span>
                </div>
                {r.suggestions.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {r.suggestions.slice(0, 3).map((s, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground">
                        <span className={`inline-block w-1 h-1 rounded-full mr-1.5 align-middle ${
                          s.priority === "high" ? "bg-status-danger" : s.priority === "medium" ? "bg-status-warning" : "bg-muted-foreground"
                        }`} />
                        {s.summary}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </DisclosureBlock>
      )}
    </div>
  );
}

function GeoCoverageSection({ ctx }: { ctx: DiagnosticsContext }) {
  const geoCoverage = computeGeoCoverage(
    ctx.pages,
    ctx.citationEvidenceIndex?.by_page_and_topic ?? [],
    ctx.activePrompts,
  );
  const geoSummary = summarizeGeoCoverage(geoCoverage);
  const visibleCities = geoCoverage.cities.filter(
    (c) => c.owned_citations > 0 || c.competitor_pages >= 5,
  );

  return (
    <div className="space-y-4">
      <SectionTitle>Geographic coverage</SectionTitle>
      <p className="text-xs text-muted-foreground -mt-2">
        Local market visibility from page registry and citation data. City normalization is deterministic — based on known Bay Area geographies.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBlock label="Markets tracked" value={geoSummary.total_cities} />
        <StatBlock
          label="Strong coverage"
          value={geoSummary.strong}
          sub={geoSummary.moderate > 0 ? `${geoSummary.moderate} moderate` : undefined}
        />
        <StatBlock
          label="Gaps"
          value={geoSummary.gap_count}
          sub={geoSummary.absent > 0 ? `${geoSummary.absent} absent` : undefined}
        />
        <StatBlock
          label="Concentration"
          value={
            geoCoverage.concentration.assessment === "healthy"
              ? "Healthy"
              : geoCoverage.concentration.assessment === "concentrated"
                ? "Moderate"
                : geoCoverage.concentration.assessment === "highly_concentrated"
                  ? "High"
                  : "—"
          }
          sub={
            geoCoverage.concentration.top_city
              ? `${geoCoverage.concentration.top_city}: ${geoCoverage.concentration.top_city_pct}%`
              : undefined
          }
        />
      </div>

      {geoCoverage.concentration.assessment !== "insufficient_data" && (
        <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2.5">
          <p className="text-sm text-muted-foreground">{geoCoverage.concentration.explanation}</p>
        </div>
      )}

      {visibleCities.filter((c) => c.owned_citations > 0).length > 0 && (
        <div className="rounded-lg border border-border/60 px-4 py-3">
          <MiniBarChart
            title="Owned citations by city"
            subtitle="Hover for details"
            entries={visibleCities
              .filter((c) => c.owned_citations > 0)
              .slice(0, 8)
              .map((c) => ({
                label: c.city.replace(/\b\w/g, (ch) => ch.toUpperCase()),
                value: c.owned_citations,
                secondaryValue: c.competitor_citations,
                color: c.coverage_status === "strong" ? "bg-status-success" : c.coverage_status === "moderate" ? "bg-accent-primary" : "bg-status-warning",
                meta: `Share: ${c.share_pct !== null ? `${c.share_pct}%` : "—"} · ${c.owned_pages} owned page${c.owned_pages !== 1 ? "s" : ""} · ${c.competitor_pages} competitor`,
              }))}
            height={8}
            colorScheme="heat"
          />
        </div>
      )}

      {visibleCities.length > 0 && (
        <CoverageTrellis
          cells={visibleCities.slice(0, 18).map((c) => ({
            label: c.city,
            status: c.coverage_status,
            value: c.owned_citations,
            meta: `${c.owned_pages} owned page${c.owned_pages !== 1 ? "s" : ""}, ${c.competitor_pages} competitor pages. Share: ${c.share_pct !== null ? `${c.share_pct}%` : "—"}`,
          }))}
          title="Market coverage at a glance"
          subtitle="Hover for details"
          columns={6}
        />
      )}

      {visibleCities.length > 0 && (
        <DisclosureBlock
          title={`${visibleCities.length} local markets`}
          subtitle="Cities with owned or notable competitor presence"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-medium text-muted-foreground border-b border-border/50">
                  <th className="text-left py-1.5 pr-3">City</th>
                  <th className="text-right py-1.5 px-2">Your pages</th>
                  <th className="text-right py-1.5 px-2">Your cit.</th>
                  <th className="text-right py-1.5 px-2">Comp. pages</th>
                  <th className="text-right py-1.5 px-2">Share</th>
                  <th className="text-right py-1.5 pl-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleCities.slice(0, 20).map((c) => (
                  <tr key={c.city} className="border-b border-border/30 last:border-b-0">
                    <td className="py-1.5 pr-3 font-medium capitalize">{c.city}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums">{c.owned_pages}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums">{c.owned_citations}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-muted-foreground">{c.competitor_pages}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-muted-foreground">
                      {c.share_pct !== null ? `${c.share_pct}%` : "—"}
                    </td>
                    <td className="text-right py-1.5 pl-2">
                      <span
                        className={`text-[10px] font-medium ${
                          c.coverage_status === "strong"
                            ? "text-status-success"
                            : c.coverage_status === "moderate"
                              ? "text-foreground"
                              : c.coverage_status === "weak"
                                ? "text-status-warning"
                                : "text-status-danger"
                        }`}
                      >
                        {c.coverage_status === "strong"
                          ? "Strong"
                          : c.coverage_status === "moderate"
                            ? "Moderate"
                            : c.coverage_status === "weak"
                              ? "Weak"
                              : "Absent"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DisclosureBlock>
      )}

      {geoCoverage.gaps.length > 0 && (
        <DisclosureBlock
          title={`${geoCoverage.gaps.length} geographic gap${geoCoverage.gaps.length !== 1 ? "s" : ""}`}
          subtitle="Markets where competitors have presence but you have limited or no visibility"
        >
          <div className="space-y-2">
            {geoCoverage.gaps.map((g) => (
              <div key={g.city} className="rounded-md border border-status-warning/20 bg-status-warning/[0.03] px-3 py-2">
                <p className="text-sm font-medium capitalize">{g.city}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{g.explanation}</p>
              </div>
            ))}
          </div>
        </DisclosureBlock>
      )}
    </div>
  );
}

function SnippetIntelSection({ ctx }: { ctx: DiagnosticsContext }) {
  const citIdx = ctx.citationEvidenceIndex;
  const citMap = new Map<string, number>();
  if (citIdx) {
    for (const r of citIdx.by_page_and_topic) {
      if (!r.is_owned) continue;
      const key = r.page_url.replace(/\/+$/, "").toLowerCase();
      citMap.set(key, (citMap.get(key) ?? 0) + r.total_citations);
    }
  }

  const extractResults = analyzeAllExtractability(ctx.pageSnapshots, citMap);

  const { siteDomain } = getSiteConfig();
  const snippetIntel = citIdx
    ? computeSnippetIntelligence({
        ownedExtractability: extractResults,
        citationIndex: citIdx,
        snapshots: ctx.pageSnapshots,
        ownedDomain: siteDomain,
      })
    : null;

  if (!snippetIntel || snippetIntel.signals.length === 0) {
    return (
      <div className="space-y-2">
        <SectionTitle>Content intelligence</SectionTitle>
        <p className="text-xs text-muted-foreground">No snippet intelligence available — need cited pages with snapshot data.</p>
      </div>
    );
  }

  const grounded = snippetIntel.signals.filter((s) => s.confidence === "grounded");
  const inferred = snippetIntel.signals.filter((s) => s.confidence === "inferred");

  return (
    <div className="space-y-4">
      <SectionTitle>Content intelligence</SectionTitle>
      <p className="text-xs text-muted-foreground -mt-2">
        Extractability patterns and competitive context from owned page analysis. {snippetIntel.data_note}
      </p>

      {grounded.length > 0 && (
        <DisclosureBlock
          title={`${grounded.length} grounded signal${grounded.length !== 1 ? "s" : ""}`}
          subtitle="Directly observable from your page structure and citation data"
        >
          <div className="space-y-2">
            {grounded.map((s) => (
              <SignalRow key={s.id} signal={s} />
            ))}
          </div>
        </DisclosureBlock>
      )}

      {inferred.length > 0 && (
        <DisclosureBlock
          title={`${inferred.length} inferred signal${inferred.length !== 1 ? "s" : ""}`}
          subtitle="Reasoned from competitive citation patterns — not directly provable"
        >
          <div className="space-y-2">
            {inferred.map((s) => (
              <SignalRow key={s.id} signal={s} />
            ))}
          </div>
        </DisclosureBlock>
      )}
    </div>
  );
}

function SignalRow({ signal }: { signal: SnippetSignal }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${
      signal.priority === "high"
        ? "border-status-danger/20 bg-status-danger/[0.02]"
        : "border-border/50 bg-muted/5"
    }`}>
      <p className="text-sm font-medium text-foreground">{signal.summary}</p>
      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{signal.detail}</p>
      <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground/70">
        <span>{signal.confidence}</span>
        <span>{signal.priority} priority</span>
        {signal.competitor_domain && <span>vs {signal.competitor_domain}</span>}
      </div>
    </div>
  );
}

async function PulseBanner({ ctx }: { ctx: DiagnosticsContext }) {
  const { siteDomain } = getSiteConfig();
  const decayResults = computeCitationDecay(siteDomain);
  const decayAlerts = decayResults.filter((d) => d.status === "meaningful_decline" || d.status === "soft_decline");
  const entityIdx = await extractEntities(ctx.pageSnapshots);
  const discReport = await detectDiscrepancies(entityIdx);
  const answerSnapshots = await getAnswerSnapshots();
  const geoCov = computeGeoCoverage(ctx.pages, ctx.citationEvidenceIndex?.by_page_and_topic ?? [], ctx.activePrompts);
  const journeyCov = computeJourneyCoverage(ctx.promptLibrary);

  const citMap2 = new Map<string, number>();
  if (ctx.citationEvidenceIndex) {
    for (const r of ctx.citationEvidenceIndex.by_page_and_topic) {
      if (!r.is_owned) continue;
      const key = r.page_url.replace(/\/+$/, "").toLowerCase();
      citMap2.set(key, (citMap2.get(key) ?? 0) + r.total_citations);
    }
  }
  const extractResults2 = analyzeAllExtractability(ctx.pageSnapshots, citMap2);
  const snippetIntel2 = ctx.citationEvidenceIndex
    ? computeSnippetIntelligence({ ownedExtractability: extractResults2, citationIndex: ctx.citationEvidenceIndex, snapshots: ctx.pageSnapshots, ownedDomain: siteDomain })
    : null;

  const latestSnap = answerSnapshots.length > 0
    ? answerSnapshots.reduce((a, b) => a.sampled_at > b.sampled_at ? a : b).sampled_at
    : null;

  const pulse = computePulse({
    decayAlerts,
    discrepancyReport: discReport,
    geoCoverage: geoCov,
    journeyCoverage: journeyCov,
    snippetIntel: snippetIntel2,
    lastSamplingDate: latestSnap,
  });

  if (pulse.total === 0) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-surface-raised/30 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Pulse</span>
          {pulse.high_count > 0 && (
            <span className="text-[10px] font-semibold text-status-danger bg-status-danger/10 px-1.5 py-px rounded">
              {pulse.high_count} high
            </span>
          )}
          {pulse.medium_count > 0 && (
            <span className="text-[10px] font-medium text-status-warning bg-status-warning/10 px-1.5 py-px rounded">
              {pulse.medium_count} medium
            </span>
          )}
          {pulse.info_count > 0 && (
            <span className="text-[10px] text-muted-foreground bg-muted/30 px-1.5 py-px rounded">
              {pulse.info_count} info
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground/60">{pulse.total} signal{pulse.total !== 1 ? "s" : ""}</span>
      </div>
      <div className="mt-2 space-y-1">
        {pulse.events.slice(0, 4).map((e) => (
          <div key={e.id} className="flex items-start gap-2">
            <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
              e.severity === "high" ? "bg-status-danger" : e.severity === "medium" ? "bg-status-warning" : "bg-muted-foreground/40"
            }`} />
            <Link href={e.href} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors leading-snug">
              {e.title}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

async function AdvancedReadinessSection({ ctx }: { ctx: DiagnosticsContext }) {
  const [answerSnapshots, outcomeRecords] = await Promise.all([
    getAnswerSnapshots(),
    getOutcomeRecords(),
  ]);
  const adversarial = assessAdversarialReadiness(ctx.promptLibrary, answerSnapshots.some((s) => s.prompt_text.toLowerCase().includes("complaint") || s.prompt_text.toLowerCase().includes("scam")));
  const whatIf = assessWhatIfReadiness(outcomeRecords);
  const founder = await assessFounderAuthority();
  const conversionPath = assessConversionPathReadiness({
    hasPromptData: ctx.promptLibrary.length > 0,
    hasAnswerData: answerSnapshots.length > 0,
    hasCitationData: (ctx.citationEvidenceIndex?.total_citations_processed ?? 0) > 0,
    hasAnalyticsIntegration: false,
  });
  const trainingData = assessTrainingDataReadiness(ctx.pageSnapshots, false, false);

  type ReadinessItem = {
    label: string;
    status: string;
    statusColor: string;
    detail: string;
  };

  const items: ReadinessItem[] = [
    {
      label: "Adversarial stress testing",
      status: adversarial.coverage_status === "ready" ? "Ready" : adversarial.coverage_status === "partial" ? "Partial" : "Not started",
      statusColor: adversarial.coverage_status === "ready" ? "text-status-success" : adversarial.coverage_status === "partial" ? "text-status-warning" : "text-muted-foreground",
      detail: adversarial.assessment,
    },
    {
      label: "What-if simulator",
      status: whatIf.readiness === "ready" ? "Ready" : whatIf.readiness === "partial" ? "Partial" : "Not ready",
      statusColor: whatIf.readiness === "ready" ? "text-status-success" : whatIf.readiness === "partial" ? "text-status-warning" : "text-muted-foreground",
      detail: whatIf.assessment,
    },
    {
      label: "Founder authority",
      status: founder.has_configured_founder
        ? founder.founders.some((f) => f.presence_status === "observed_repeatedly") ? "Active" : founder.founders.some((f) => f.presence_status === "observed_lightly") ? "Light" : "Configured"
        : "Not configured",
      statusColor: founder.has_configured_founder && founder.founders.some((f) => f.presence_status === "observed_repeatedly")
        ? "text-status-success"
        : founder.has_configured_founder ? "text-status-warning" : "text-muted-foreground",
      detail: founder.data_note,
    },
    {
      label: "Conversion path",
      status: conversionPath.readiness === "partial" ? "Partial" : "Not ready",
      statusColor: conversionPath.readiness === "partial" ? "text-status-warning" : "text-muted-foreground",
      detail: conversionPath.assessment,
    },
    {
      label: "Training data pipeline",
      status: trainingData.overall_status === "good" ? "Good" : trainingData.overall_status === "partial" ? "Partial" : "Weak",
      statusColor: trainingData.overall_status === "good" ? "text-status-success" : trainingData.overall_status === "partial" ? "text-status-warning" : "text-muted-foreground",
      detail: trainingData.assessment,
    },
  ];

  return (
    <div className="space-y-4">
      <SectionTitle>Advanced intelligence readiness</SectionTitle>
      <p className="text-xs text-muted-foreground -mt-2">
        Scaffold status for future intelligence systems. These are foundations — not active features unless marked ready.
      </p>

      <div className="rounded-lg border border-border/60 divide-y divide-border/40 overflow-hidden">
        {items.map((item) => (
          <div key={item.label} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">{item.label}</span>
              <span className={`text-[10px] font-semibold ${item.statusColor}`}>{item.status}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{item.detail}</p>
          </div>
        ))}
      </div>

      {founder.has_configured_founder && founder.founders.length > 0 && (
        <DisclosureBlock
          title="Founder presence detail"
          subtitle={`${founder.founders.length} configured`}
        >
          <div className="space-y-2">
            {founder.founders.map((f) => (
              <div key={f.name} className="rounded-md border border-border/50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{f.name}</span>
                  <span className={`text-[10px] font-medium ${
                    f.presence_status === "observed_repeatedly" ? "text-status-success"
                      : f.presence_status === "observed_lightly" ? "text-status-warning"
                        : "text-muted-foreground"
                  }`}>
                    {f.mention_count} mention{f.mention_count !== 1 ? "s" : ""}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{f.assessment}</p>
              </div>
            ))}
          </div>
        </DisclosureBlock>
      )}
    </div>
  );
}
