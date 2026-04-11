import {
  results,
  changelogEntries,
  opportunities,
} from "@/lib/seed-data.server";
import { eventDecisions } from "@/domains/attribution/store";
import {
  computeScorecard,
  type ScorecardRow,
  type TrustSource,
} from "@/domains/attribution/scorecard";
import { detectOutcomeEvents, type OutcomeEvent } from "@/domains/attribution/events";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { normalizePageUrl, canonicalizeOwnedUrl } from "@/domains/pages/classify";
import type {
  PageEntity,
  PageSnapshot,
  PageSnapshotDiff,
  CitationPageRollup,
  EvidenceTier,
  SitemapReconciliation,
} from "@/domains/pages/types";
import { allPages } from "@/domains/pages/page-store";
import { pageSnapshots } from "@/domains/pages/snapshot-store";
import { guardrailAlerts } from "@/domains/pages/guardrail-store";
import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import { pageSnapshotDiffs } from "@/domains/pages/page-snapshot-diff-store";
import { renderCheckResults } from "@/domains/pages/render-check-store";
import { sitemapReconciliation } from "@/domains/pages/sitemap-reconciliation-store";
import {
  PagesClient,
  type PageRow,
  type PageChange,
  type PageEvent,
  type PageSnapshotSummary,
  type PageDiffSummary,
} from "./pages-client";
import { computePageOpportunityScore } from "@/domains/pages/opportunity-score";
import type { RenderCheckResult } from "@/domains/pages/render-check";
import { generateFixBrief, type FixBrief } from "@/domains/pages/fix-briefs";
import { minePatterns, generateBriefs, type PlaybookBrief } from "@/domains/pages/playbook";
import { planWaves, rolloutWaves, computeWaveProgress, deriveWaveStatus, type RolloutWave, type WaveProgress } from "@/domains/pages/wave-planner";
import { updateWaveStatus, handOffWave } from "./wave-actions";
import { pageIssues, issueIdFromAlert, issueIdFromBrief, rolloutExecutions, patternEvidence, type PersistedIssue } from "@/domains/pages/issues";
import { getOutcomeWatchForIssue, type OutcomeWatchSummary } from "@/domains/pages/outcome-watch";
import { triggerPageScan } from "./scan-action";
import { verifyPageFix } from "./verify-action";
import { updateIssueStatus, verifyAndUpdateIssue, generateHandoffText, convertBriefToIssue, refreshOutcomeObservation } from "./issue-actions";
import { getSiteConfig } from "@/lib/site-config";
import { latestWebsiteCrawlRun } from "@/domains/observations/read";
import type { GuardrailAlert } from "@/domains/pages/guardrails";
import { getPendingFindings } from "@/domains/scanning/findings-store";

function guardrailIssueBasis(
  alert: GuardrailAlert,
  snap: PageSnapshot | null
): { issueEvidenceBasis: string; observationRunId: string | null } {
  if (alert.observation_run_id) {
    return {
      issueEvidenceBasis:
        "Detected during a crawl of the live page.",
      observationRunId: alert.observation_run_id,
    };
  }
  if (snap) {
    return {
      issueEvidenceBasis:
        "Detected from a stored HTML snapshot. Re-run crawl to get fresh evidence.",
      observationRunId: snap.observation_run_id ?? null,
    };
  }
  return {
    issueEvidenceBasis:
      "Detected but no HTML snapshot on file. Run a crawl to verify.",
    observationRunId: null,
  };
}

type PageStatus = "winning" | "building" | "unresolved" | "dormant";
type PageNextMove =
  | "double_down"
  | "review_signals"
  | "strengthen_evidence"
  | "wait"
  | "no_action";

export default function PagesPage() {
  const siteDomain = getSiteConfig().siteDomain;
  // ── Load data ──
  const ownedPages = allPages.filter((p) => p.is_owned);

  const citationIndex = citationEvidenceIndex;

  // ── Load page snapshots + diffs ──
  const pageDiffs = pageSnapshotDiffs;

  const snapshotByPageId = new Map<string, PageSnapshot>();
  const snapshotByUrl = new Map<string, PageSnapshot>();
  for (const snap of pageSnapshots) {
    snapshotByPageId.set(snap.page_id, snap);
    snapshotByUrl.set(snap.url.replace(/\/+$/, "").toLowerCase(), snap);
  }
  const diffByPageId = new Map<string, PageSnapshotDiff>();
  const diffByUrl = new Map<string, PageSnapshotDiff>();
  for (const d of pageDiffs) {
    diffByPageId.set(d.page_id, d);
    diffByUrl.set(d.url.replace(/\/+$/, "").toLowerCase(), d);
  }

  const allPendingFindings = getPendingFindings();
  const findingCountByUrl = new Map<string, number>();
  for (const f of allPendingFindings) {
    const key = f.url.replace(/\/+$/, "").toLowerCase();
    findingCountByUrl.set(key, (findingCountByUrl.get(key) ?? 0) + 1);
  }

  // ── Load guardrails + scan runs ──
  const latestObs = latestWebsiteCrawlRun();

  const alertsByUrl = new Map<string, GuardrailAlert[]>();
  for (const a of guardrailAlerts) {
    const key = a.url.replace(/\/+$/, "").toLowerCase();
    if (!alertsByUrl.has(key)) alertsByUrl.set(key, []);
    alertsByUrl.get(key)!.push(a);
  }

  // ── Load render checks ──
  const renderChecks = renderCheckResults;

  const renderByUrl = new Map<string, RenderCheckResult>();
  for (const r of renderChecks) {
    renderByUrl.set(r.url.replace(/\/+$/, "").toLowerCase(), r);
  }

  // ── Build issue state index ──
  const issueStateMap = new Map<string, PersistedIssue>();
  for (const issue of pageIssues) {
    issueStateMap.set(issue.issueId, issue);
  }

  // ── Build citation count map ──
  const citCountMap = new Map<string, number>();
  if (citationIndex) {
    for (const r of citationIndex.by_page_and_topic) {
      if (!r.is_owned) continue;
      const key = r.page_url.replace(/\/+$/, "").toLowerCase();
      citCountMap.set(key, (citCountMap.get(key) ?? 0) + r.total_citations);
    }
  }

  // ── Load sitemap reconciliation ──
  const sitemapRecon: SitemapReconciliation | null = sitemapReconciliation;

  const canonicalUrls = sitemapRecon
    ? new Set(sitemapRecon.canonical_pages.map((c) => c.url.replace(/\/+$/, "").toLowerCase()))
    : null;
  const stalePageIds = sitemapRecon
    ? new Set(sitemapRecon.stale_pages.map((s) => s.registry_page_id))
    : null;

  const { attribution: attrResults } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attrResults);
  const rows = computeScorecard(
    changelogEntries,
    results,
    opportunities,
    eventDecisions
  );
  const decidedEventIds = new Set(eventDecisions.map((d) => d.event_id));

  // ── Mine patterns + generate playbook briefs ──
  const patterns = minePatterns(pageSnapshots, citCountMap, rows, rolloutExecutions, patternEvidence);
  const playbookBriefs = generateBriefs(pageSnapshots, citCountMap, patterns);
  const playbookByUrl = new Map<string, PlaybookBrief[]>();
  for (const pb of playbookBriefs) {
    const key = pb.pageUrl.replace(/\/+$/, "").toLowerCase();
    if (!playbookByUrl.has(key)) playbookByUrl.set(key, []);
    playbookByUrl.get(key)!.push(pb);
  }

  // ── Compute waves (derive status in a new array — do not mutate store during render) ──
  const rolloutWavesDerived = rolloutWaves.map((w) => {
    if (w.status === "dismissed") return w;
    const derived = deriveWaveStatus(w, pageIssues);
    return w.status === derived ? w : { ...w, status: derived };
  });
  const proposedWaves = planWaves(
    playbookBriefs,
    pageIssues,
    rolloutExecutions,
    rolloutWavesDerived
  );
  const allWaves = [
    ...rolloutWavesDerived,
    ...proposedWaves.filter(
      (pw) =>
        !rolloutWavesDerived.some((rw) => rw.rolloutWaveId === pw.rolloutWaveId)
    ),
  ];
  const activeWaves = allWaves.filter(
    (w) => w.status !== "dismissed" && w.status !== "completed"
  );

  type ClientWave = {
    id: string; title: string; status: string; waveType: string;
    rationale: string; targetPages: string[]; priorityScore: number;
    progress: WaveProgress; briefIds: string[];
  };

  const clientWaveMap = new Map<string, ClientWave>();
  const pageToWaveId = new Map<string, string>();
  for (const w of activeWaves) {
    const progress = computeWaveProgress(w, pageIssues);
    const cw: ClientWave = {
      id: w.rolloutWaveId, title: w.title, status: w.status,
      waveType: w.waveType, rationale: w.rationale,
      targetPages: w.targetPages, priorityScore: w.priorityScore,
      progress, briefIds: w.briefIds,
    };
    clientWaveMap.set(w.rolloutWaveId, cw);
    for (const p of w.targetPages) {
      pageToWaveId.set(p.replace(/\/+$/, "").toLowerCase(), w.rolloutWaveId);
    }
  }

  // ── Build URL → ScorecardRow[] index ──
  // Normalize change URLs to match page URLs
  const urlToRows = new Map<string, ScorecardRow[]>();
  for (const row of rows) {
    if (!row.change.url) continue;
    const parsed = normalizePageUrl(row.change.url, siteDomain);
    if (!parsed) continue;
    const canonical = canonicalizeOwnedUrl(parsed);
    if (!urlToRows.has(canonical.url)) urlToRows.set(canonical.url, []);
    urlToRows.get(canonical.url)!.push(row);
  }

  // ── Build URL → citation rollups ──
  const urlToCitations = new Map<string, CitationPageRollup[]>();
  if (citationIndex) {
    for (const r of citationIndex.by_page_and_topic) {
      if (!r.is_owned) continue;
      if (!urlToCitations.has(r.page_url)) urlToCitations.set(r.page_url, []);
      urlToCitations.get(r.page_url)!.push(r);
    }
  }

  // ── Build topic → events index ──
  const topicEvents = new Map<string, OutcomeEvent[]>();
  for (const e of events) {
    if (!topicEvents.has(e.topic)) topicEvents.set(e.topic, []);
    topicEvents.get(e.topic)!.push(e);
  }

  // ── Build page rows ──
  const pageRows: PageRow[] = [];
  const staleRows: PageRow[] = [];

  // Add sitemap-only pages (not in registry) as lightweight entries
  const registryUrls = new Set(ownedPages.map((p) => p.url.replace(/\/+$/, "").toLowerCase()));
  const sitemapOnlyPages: PageEntity[] = [];
  if (sitemapRecon) {
    let smIdx = 100;
    for (const cp of sitemapRecon.canonical_pages) {
      const normUrl = cp.url.replace(/\/+$/, "").toLowerCase();
      if (!registryUrls.has(normUrl)) {
        smIdx++;
        sitemapOnlyPages.push({
          id: cp.scan_page_id,
          url: cp.url,
          canonical_url: cp.url,
          domain: siteDomain,
          path: cp.path,
          page_type: "other",
          city: null,
          service: null,
          topics: [],
          ownership_tier: "owned",
          tracked_entity_id: null,
          is_owned: true,
          first_seen_at: new Date().toISOString(),
          last_observed_at: new Date().toISOString(),
          discovery_sources: ["manual"],
          title_last_seen: null,
          changelog_ids: [],
          metadata: {},
        });
      }
    }
  }

  const allOwnedForDisplay = [...ownedPages, ...sitemapOnlyPages];

  for (const page of allOwnedForDisplay) {
    const normPageUrl = page.url.replace(/\/+$/, "").toLowerCase();
    const isStale = stalePageIds?.has(page.id) || false;
    const isCanonical = canonicalUrls ? canonicalUrls.has(normPageUrl) : page.domain === siteDomain;
    const linkedRows = urlToRows.get(page.url) ?? [];
    const citations = urlToCitations.get(page.url) ?? [];
    const totalCitations = citations.reduce((s, c) => s + c.total_citations, 0);

    // Topics: union of page topics, change topics, and citation topics
    const topicSet = new Set<string>();
    for (const t of page.topics) topicSet.add(t);
    for (const r of linkedRows) {
      for (const t of r.topics) topicSet.add(t);
    }
    for (const c of citations) topicSet.add(c.topic);
    const topics = [...topicSet];

    // Skip pages with zero signal — but keep canonical sitemap pages (they have snapshot data)
    const hasSignal = linkedRows.length > 0 || totalCitations > 0 || topics.length > 0;
    if (!hasSignal && !isCanonical) {
      continue;
    }

    // ── Collect linked events via topics ──
    const linkedEvents: OutcomeEvent[] = [];
    const seenEventIds = new Set<string>();
    for (const topic of topics) {
      for (const e of topicEvents.get(topic) ?? []) {
        if (!seenEventIds.has(e.id)) {
          seenEventIds.add(e.id);
          linkedEvents.push(e);
        }
      }
    }
    linkedEvents.sort(
      (a, b) =>
        new Date(b.trigger_date).getTime() - new Date(a.trigger_date).getTime()
    );

    // ── Change stats ──
    const validatedCount = linkedRows.filter(
      (r) => r.verdict === "validated"
    ).length;
    const partialCount = linkedRows.filter(
      (r) => r.verdict === "partial"
    ).length;
    const opConfirmedCount = linkedRows.filter(
      (r) => r.operatorConfirmedCount > 0
    ).length;

    // ── Event stats ──
    const decidedEventCount = linkedEvents.filter((e) =>
      decidedEventIds.has(e.id)
    ).length;
    const unresolvedEventCount = linkedEvents.length - decidedEventCount;

    // ── Best trust ──
    const trustRank: Record<TrustSource, number> = {
      operator_confirmed: 0,
      auto_cleared: 1,
      system_primary: 2,
      contributing: 3,
      candidate: 4,
      operator_rejected: 5,
    };
    let bestTrust: TrustSource | null = null;
    for (const r of linkedRows) {
      if (
        r.topTrust &&
        (bestTrust === null || trustRank[r.topTrust] < trustRank[bestTrust])
      ) {
        bestTrust = r.topTrust;
      }
    }

    // ── Best evidence tier ──
    const tierRank: Record<EvidenceTier, number> = {
      exact: 0,
      probable: 1,
      weak: 2,
      inferred: 3,
    };
    let bestEvidenceTier: EvidenceTier | null = null;
    for (const r of linkedRows) {
      if (
        bestEvidenceTier === null ||
        tierRank[r.evidenceTier] < tierRank[bestEvidenceTier]
      ) {
        bestEvidenceTier = r.evidenceTier;
      }
    }

    // ── Best change ──
    const bestChange = linkedRows
      .sort(
        (a, b) =>
          b.operatorConfirmedCount - a.operatorConfirmedCount ||
          (b.topScore ?? 0) - (a.topScore ?? 0)
      )[0] ?? null;

    // ── Platform breakdown from citations ──
    const platformCounts: Record<string, number> = {};
    for (const c of citations) {
      for (const [plat, stats] of Object.entries(c.by_platform)) {
        platformCounts[plat] = (platformCounts[plat] ?? 0) + stats.citation_count;
      }
    }
    const platforms = Object.entries(platformCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([p]) => p);

    // ── Snapshot for this page (match by page_id or URL) ──
    const snap = snapshotByPageId.get(page.id) ?? snapshotByUrl.get(normPageUrl);
    const diff = diffByPageId.get(page.id) ?? diffByUrl.get(normPageUrl);

    // ── Compute page status ──
    let status: PageStatus;
    if (
      validatedCount >= 2 ||
      (validatedCount >= 1 && opConfirmedCount >= 1) ||
      (validatedCount >= 1 && totalCitations >= 100)
    ) {
      status = "winning";
    } else if (validatedCount >= 1 || partialCount >= 1 || totalCitations >= 50) {
      status = "building";
    } else if (linkedEvents.length > 0 || linkedRows.length > 0) {
      status = "unresolved";
    } else {
      status = "dormant";
    }

    // ── Compute status reason ──
    let statusReason: string;
    if (status === "winning") {
      const parts: string[] = [];
      if (validatedCount > 0) parts.push(`${validatedCount} validated change${validatedCount !== 1 ? "s" : ""}`);
      if (totalCitations > 0) parts.push(`${totalCitations} citations`);
      if (snap && snap.faqs.length > 0) parts.push("FAQ");
      if (snap && snap.schema_types.length > 0) parts.push("Schema");
      statusReason = parts.join(" · ");
    } else if (status === "building") {
      const parts: string[] = [];
      if (validatedCount > 0) parts.push(`${validatedCount} validated`);
      if (partialCount > 0) parts.push(`${partialCount} partial`);
      if (totalCitations > 0) parts.push(`${totalCitations} citations`);
      statusReason = parts.join(" · ") || "Early positive signals";
    } else if (status === "unresolved") {
      statusReason = `${linkedEvents.length} visibility event${linkedEvents.length !== 1 ? "s" : ""} · ${linkedRows.length} linked change${linkedRows.length !== 1 ? "s" : ""}`;
    } else {
      statusReason = "No visibility signals linked yet";
    }

    // ── Compute opportunity score ──
    const { score: opportunityScore } = computePageOpportunityScore({
      totalCitations,
      totalChanges: linkedRows.length,
      validatedChanges: validatedCount,
      partialChanges: partialCount,
      unresolvedEvents: unresolvedEventCount,
      bestTrust,
      snap: snap ?? null,
    });

    // ── Compute next move (snapshot-aware) ──
    let nextMove: PageNextMove;
    let nextMoveDetail: string;

    const structureGaps: string[] = [];
    if (snap) {
      if (snap.faqs.length === 0) structureGaps.push("no FAQ");
      if (snap.schema_types.length === 0) structureGaps.push("no schema");
    }

    if (
      status === "winning" &&
      validatedCount >= 1
    ) {
      if (structureGaps.length > 0) {
        nextMove = "strengthen_evidence";
        nextMoveDetail = `Winning but ${structureGaps.join(" + ")} — add structure to protect gains`;
      } else {
        nextMove = "double_down";
        nextMoveDetail = `${validatedCount} validated change${validatedCount !== 1 ? "s" : ""} — extend or replicate`;
      }
    } else if (unresolvedEventCount > 0) {
      nextMove = "review_signals";
      nextMoveDetail = `${unresolvedEventCount} unresolved event${unresolvedEventCount !== 1 ? "s" : ""} to review`;
    } else if (
      linkedRows.length > 0 &&
      validatedCount === 0 &&
      partialCount === 0
    ) {
      nextMove = "strengthen_evidence";
      nextMoveDetail = structureGaps.length > 0
        ? `${linkedRows.length} change${linkedRows.length !== 1 ? "s" : ""}, ${structureGaps.join(" + ")} — add structure`
        : `${linkedRows.length} change${linkedRows.length !== 1 ? "s" : ""} but no validated impact`;
    } else if (linkedRows.length === 0 && totalCitations > 0) {
      nextMove = "strengthen_evidence";
      nextMoveDetail = structureGaps.length > 0
        ? `${totalCitations} citations + ${structureGaps.join(", ")}`
        : `${totalCitations} citations but no tracked changes`;
    } else if (linkedEvents.length === 0 && linkedRows.length === 0) {
      nextMove = "no_action";
      nextMoveDetail = "No linked signals yet";
    } else {
      nextMove = "wait";
      nextMoveDetail = "Waiting for more signals";
    }

    // ── Determine label (prefer snapshot title for sitemap-only pages) ──
    const label =
      page.title_last_seen ??
      snap?.title ??
      (page.path.replace(/^\//, "").replace(/-/g, " ") || page.domain);

    // ── Serialize events ──
    const serializedEvents: PageEvent[] = linkedEvents.slice(0, 6).map((e) => ({
      id: e.id,
      type: e.type,
      platform: e.platform,
      topic: e.topic,
      triggerDate: e.trigger_date,
      anchorResultId: e.anchor_result_id,
      isDecided: decidedEventIds.has(e.id),
    }));

    // ── Serialize changes ──
    const serializedChanges: PageChange[] = linkedRows
      .sort(
        (a, b) =>
          b.operatorConfirmedCount - a.operatorConfirmedCount ||
          (b.topScore ?? 0) - (a.topScore ?? 0)
      )
      .slice(0, 5)
      .map((r) => ({
        id: r.change.id,
        name: r.change.asset_name,
        description: r.change.change_description,
        verdict: r.verdict,
        topScore: r.topScore,
        topTrust: r.topTrust,
        evidenceTier: r.evidenceTier,
        operatorConfirmed: r.operatorConfirmedCount > 0,
        date: r.change.timestamp,
      }));

    // ── Snapshot data ──
    const snapshotSummary: PageSnapshotSummary | null = snap
      ? {
          scannedAt: snap.fetched_at,
          title: snap.title,
          metaDescription: snap.meta_description,
          canonicalUrl: snap.canonical_url,
          h1: snap.h1,
          faqCount: snap.faqs.length,
          schemaTypes: snap.schema_types,
          internalLinks: snap.internal_link_count,
          externalLinks: snap.external_link_count,
          wordCount: snap.word_count,
          hasCanonicalMismatch: snap.has_canonical_mismatch,
          robotsMeta: snap.robots_meta,
          httpStatus: snap.http_status,
          observationRunId: snap.observation_run_id ?? null,
        }
      : null;

    const diffSummary: PageDiffSummary | null = diff
      ? {
          changed: diff.changed,
          summary: diff.summary,
          titleChanged: diff.title_changed,
          h1Changed: diff.h1_changed,
          faqCountChanged: diff.faq_count_changed,
          schemaChanged: diff.schema_changed,
          contentChanged: diff.content_changed,
        }
      : null;

    const pageAlerts = alertsByUrl.get(normPageUrl) ?? [];
    const pageRender = renderByUrl.get(normPageUrl) ?? null;

    const pageFixBriefs: FixBrief[] = pageAlerts.map((alert) =>
      generateFixBrief(
        alert,
        snap ?? null,
        pageRender,
        changelogEntries.map((c) => ({
          id: c.id,
          timestamp: c.timestamp,
          asset_name: c.asset_name,
          change_description: c.change_description ?? "",
          url: c.url ?? "",
        })),
        totalCitations
      )
    );

    const row: PageRow = {
      id: page.id,
      url: page.url,
      path: page.path,
      label,
      pageType: page.page_type,
      city: page.city,
      status,
      statusReason,
      opportunityScore,
      topics,
      platforms,
      totalCitations,
      totalChanges: linkedRows.length,
      validatedChanges: validatedCount,
      partialChanges: partialCount,
      operatorConfirmed: opConfirmedCount,
      totalEvents: linkedEvents.length,
      unresolvedEvents: unresolvedEventCount,
      bestTrust,
      bestEvidenceTier,
      bestChangeName: bestChange?.change.asset_name ?? null,
      bestChangeId: bestChange?.change.id ?? null,
      nextMove,
      nextMoveDetail,
      events: serializedEvents,
      changes: serializedChanges,
      snapshot: snapshotSummary,
      diff: diffSummary,
      guardrails: pageAlerts.map((a) => ({
        severity: a.severity,
        category: a.category,
        message: a.message,
        observationRunId: a.observation_run_id ?? null,
      })),
      fixBriefs: pageFixBriefs.map((fb, alertIdx) => {
        const alert = pageAlerts[alertIdx]!;
        const basis = guardrailIssueBasis(alert, snap ?? null);
        const iid = issueIdFromAlert(fb.alertCategory, fb.pageUrl);
        const persisted = issueStateMap.get(iid);
        return {
          issueId: iid,
          issueSummary: fb.issueSummary,
          severity: fb.alertSeverity,
          citationCount: fb.citationCount,
          expectedState: fb.expectedState,
          observedState: fb.observedState,
          likelyCauses: fb.likelyCauses,
          verificationChecklist: fb.verificationChecklist,
          bestNextMove: fb.bestNextMove,
          intentConflict: fb.intentConflict,
          intentDetail: fb.intentDetail,
          relatedChangelog: fb.relatedChangelog,
          issueStatus: persisted?.status ?? "new",
          handedOffAt: persisted?.handedOffAt ?? null,
          shippedAt: persisted?.shippedAt ?? null,
          verifiedAt: persisted?.verifiedAt ?? null,
          verifyResult: persisted?.verifyResult ?? null,
          issueEvidenceBasis: basis.issueEvidenceBasis,
          observationRunId:
            basis.observationRunId ?? alert.observation_run_id ?? null,
          verificationObservationRunId:
            persisted?.verificationObservationRunId ?? null,
          verificationBaselineObservationRunId:
            persisted?.verificationBaselineObservationRunId ?? null,
          verificationBindingLegacy:
            (persisted?.status === "verified" ||
              persisted?.status === "not_fixed") &&
            !persisted?.verificationObservationRunId,
        };
      }),
      playbookBriefs: (playbookByUrl.get(normPageUrl) ?? []).map((pb) => {
        const rolloutIssueId = issueIdFromBrief(pb.id, pb.pageUrl);
        const rolloutIssue = pageIssues.find((i) => i.issueId === rolloutIssueId);
        const rolloutExec = rolloutExecutions.find((r) => r.briefId === pb.id && r.targetPage === pb.pageUrl);
        return {
          id: pb.id,
          type: pb.type,
          title: pb.title,
          patternId: pb.patternId,
          patternName: pb.patternName,
          rationale: pb.rationale,
          evidence: pb.evidence,
          recommendations: pb.recommendations,
          verificationChecklist: pb.verificationChecklist,
          priority: pb.priority,
          citationOpportunity: pb.citationOpportunity,
          spec: pb.spec,
          sourcePages: pb.sourcePages,
          gapTrigger: pb.gapTrigger,
          patternEvidence: {
            executionConfidence: pb.patternEvidence.executionConfidence,
            executionsTotal: pb.patternEvidence.executionsTotal,
            executionsVerified: pb.patternEvidence.executionsVerified,
            evidenceSummary: pb.patternEvidence.evidenceSummary,
            trustBasis: pb.patternEvidence.trustBasis,
            outcomeMaturity: pb.patternEvidence.outcomeMaturity,
          },
          rolloutIssueId: rolloutIssue?.issueId ?? null,
          rolloutStatus: rolloutIssue?.status ?? null,
          rolloutShippedAt: rolloutIssue?.shippedAt ?? null,
          rolloutVerifiedAt: rolloutIssue?.verifiedAt ?? null,
          rolloutVerifyResult: rolloutIssue?.verifyResult ?? null,
          outcomeWatch: rolloutIssue?.issueId
            ? (() => {
                const ow = getOutcomeWatchForIssue(rolloutIssue.issueId);
                return ow ? {
                  daysSinceVerified: ow.daysSinceVerified,
                  citationDelta: ow.citationDelta,
                  outcomeAssessment: ow.outcomeAssessment,
                  evidenceSummary: ow.evidenceSummary,
                  linkedResultCount: ow.linkedResultCount,
                } : null;
              })()
            : null,
        };
      }),
      pendingFindingCount: findingCountByUrl.get(normPageUrl) ?? 0,
      waveId: pageToWaveId.get(normPageUrl) ?? null,
      waveName: (() => {
        const wid = pageToWaveId.get(normPageUrl);
        return wid ? clientWaveMap.get(wid)?.title ?? null : null;
      })(),
      wave: (() => {
        const wid = pageToWaveId.get(normPageUrl);
        return wid ? clientWaveMap.get(wid) ?? null : null;
      })(),
    };

    if (isStale) {
      staleRows.push(row);
    } else {
      pageRows.push(row);
    }
  }

  // Sort: winning first, then building, unresolved, dormant — then by citation count
  const statusOrder: Record<PageStatus, number> = {
    winning: 0,
    building: 1,
    unresolved: 2,
    dormant: 3,
  };
  pageRows.sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      b.opportunityScore - a.opportunityScore ||
      b.totalCitations - a.totalCitations
  );

  // Summary (canonical only)
  const winningCount = pageRows.filter((p) => p.status === "winning").length;
  const buildingCount = pageRows.filter((p) => p.status === "building").length;
  const unresolvedCount = pageRows.filter((p) => p.status === "unresolved").length;
  const dormantCount = pageRows.filter((p) => p.status === "dormant").length;

  const scannedCount = pageRows.filter((p) => p.snapshot).length;
  const noFaqCount = pageRows.filter(
    (p) => p.snapshot && p.snapshot.faqCount === 0
  ).length;
  const noSchemaCount = pageRows.filter(
    (p) => p.snapshot && p.snapshot.schemaTypes.length === 0
  ).length;

  const sitemapTotal = sitemapRecon?.sitemap_url_count ?? 0;

  const citedCount = pageRows.filter((p) => p.totalCitations > 0).length;
  const fixCount = pageRows.filter((p) => p.fixBriefs.length > 0 || p.guardrails.length > 0).length;
  const totalCitationsAll = pageRows.reduce((s, p) => s + p.totalCitations, 0);

  const pageSummary = {
    total: pageRows.length,
    winning: winningCount,
    needsAction: fixCount,
    building: buildingCount,
    unresolved: unresolvedCount,
    dormant: dormantCount,
    cited: citedCount,
    totalCitations: totalCitationsAll,
    noFaq: noFaqCount,
    noSchema: noSchemaCount,
    scanned: scannedCount,
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Pages</h2>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          Health, citations, and the next step for each URL.
        </p>
      </div>

      <PagesClient
        pageSummary={pageSummary}
        rows={pageRows}
        staleRows={staleRows}
        lastScanAt={latestObs?.completed_at ?? null}
        latestObservationRunId={latestObs?.run_id ?? null}
        onScan={triggerPageScan}
        onVerify={verifyPageFix}
        onUpdateIssue={updateIssueStatus as (issueId: string, status: string, meta?: { pageUrl?: string; pagePath?: string; category?: string }) => Promise<{ success: boolean }>}
        onVerifyIssue={verifyAndUpdateIssue}
        onGenerateHandoff={generateHandoffText}
        onConvertBrief={convertBriefToIssue}
        onRefreshOutcome={refreshOutcomeObservation}
        onHandOffWave={async (waveId: string) => {
          "use server";
          const result = await handOffWave(waveId, playbookBriefs);
          return result;
        }}
        onDismissWave={async (waveId: string) => {
          "use server";
          return updateWaveStatus(waveId, "dismissed");
        }}
      />
    </div>
  );
}
