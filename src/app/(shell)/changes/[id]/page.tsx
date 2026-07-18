import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getResults, getOpportunities } from "@/lib/seed-data.server";
import type { ChangelogEntry } from "@/domains/changelog/types";
import { getEventDecisions } from "@/domains/attribution/store";
import { computeScorecard } from "@/domains/attribution/scorecard";
import { enrichWithImpact } from "@/domains/attribution/change-impact";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import { getCitationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import {
  getRolloutExecutions,
  getPatternEvidence,
} from "@/domains/pages/issues";
import { minePatterns, generateBriefs } from "@/domains/pages/playbook";
import { computeRecommendations } from "@/domains/product/recommendation-engine";
import { computeTrackRecord, wasChangeRecommended } from "@/domains/product/recommendation-tracker";
import { getSectionAnalyzerConfig } from "@/lib/business-config";
import { loadChangeOutcomeById } from "@/domains/attribution/change-outcome-store";
import { buildProofSentence } from "@/domains/attribution/proof-sentence";
import { getUrlChangeOutcomes } from "@/domains/attribution/url-change-outcome";
import { ChangeDetailV2Client } from "./change-detail-v2-client";
import { loadPushReceipt } from "@/domains/push/push-receipt";
import { PushReceipt } from "@/components/changes/push-receipt";
import { resolveProofPill } from "@/domains/changes/proof-timeline/result-pill";
import {
  humanizeOutcomeEvent,
  platformLabel,
} from "@/domains/changes/proof-timeline/event-humanizer";
import { resolveNextActions } from "@/domains/changes/proof-timeline/next-action";
import {
  projectChangeTitle,
  clampShortTitle,
} from "@/domains/changes/proof-timeline/title-projection";
import {
  changelogJoinKey,
  classifyChangelogRow,
  indexEditsByJoinKey,
  type LifecycleTabClass,
} from "@/domains/attribution/lifecycle-classification";
import type { ImplementationStatus } from "@/domains/recommendations/recommended-edits-persistence";
import { loadLifecycleForEdit } from "@/domains/citation-lifecycle/load-lifecycle";
import { loadChangePrimaryEvidence } from "@/domains/citation-lifecycle/load-change-primary-evidence";
import { loadRepeatCitationForEdit } from "@/domains/citation-lifecycle/load-repeat-citation";
import type { RepeatCitationResult } from "@/domains/citation-lifecycle/compute-repeat-citation";
import { loadModeAForChangesDetail } from "@/domains/outcome-attribution/load-mode-a-for-changes-detail";
import type { ModeAResult } from "@/domains/outcome-attribution/mode-a-cited-here-traffic-here";
import { getBusinessConfig } from "@/lib/business-config";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";
import { loadProofLedgerPersisted } from "@/domains/proof-gsc/load-ledger";
import { findProofForChange, proofResultHref } from "@/domains/proof-gsc/change-proof-link";

// Phase 1.6 (Sprint 1 follow-up, 2026-04-24): force dynamic render so every
// request runs the fresh-repo-read pattern below. Matches /changes main list.
export const dynamic = "force-dynamic";

/**
 * `/changes/[id]` — the v2 5-act proof brief.
 *
 * Surface collapse (2026-06-15) — the legacy data-rich detail layout
 * (8 stacked cards) was deleted; the v2 proof brief is now the ONLY
 * surface. Both rendered off the same loaded data; only the legacy
 * presentation layer + its legacy-only loaders (page summaries,
 * recommendation engine, pattern mining) were removed.
 */
export default async function ChangeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const trace = createPerfTrace("loader:/changes/[id]", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/changes/[id]",
  });
  try {
  const { id } = await params;

  // Phase 1.6 (Sprint 1 follow-up, 2026-04-24): fresh per-request repo read.
  // The prior implementation called `changelogEntries.find(...)` against the
  // module-level array from @/lib/seed-data.server, which is hydrated once
  // per Vercel lambda cold start. A scan_detection entry written by a
  // different lambda was invisible here and the page rendered notFound.
  //
  // Scope: only `changelogEntries` is fresh this phase. `results`,
  // `opportunities`, and `eventDecisions` below continue to read from their
  // module-level arrays — they enrich the attribution/coverage display but
  // do not affect whether the target entry renders or what its core fields
  // say. Full mutable-array sweep is Sprint 4/5 scope.
  // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — tenant-bound read.
  const tenantId = await currentTenantId();
  const repository = getRepository().forTenant(tenantId);
  let freshChangelogEntries: ChangelogEntry[];
  try {
    freshChangelogEntries = await repository.getChangelogEntries();
  } catch (error) {
    return <ChangeDetailReadError error={error} />;
  }

  const entry = freshChangelogEntries.find((c) => c.id === id);
  if (!entry) notFound();

  // Results owns the measurement truth. A tracked change deep-links to its
  // exact proof card (including compound-package semantics); an older untracked
  // changelog row lands on Results without inventing an outcome. The retired
  // detail implementation remains below temporarily for removal in the bounded
  // cleanup wave, but is no longer customer-reachable.
  const proofLedger = await loadProofLedgerPersisted(tenantId).catch(() => []);
  const canonicalProof = findProofForChange(entry, proofLedger);
  redirectToCanonicalResult(canonicalProof ? proofResultHref(canonicalProof) : "/results");

  const [results, opportunities, eventDecisions, rolloutExecutions, persistedPatternEvidence] = await Promise.all([
    getResults(),
    getOpportunities(),
    getEventDecisions(),
    getRolloutExecutions(),
    getPatternEvidence(),
  ]);
  const allRows = computeScorecard(
    freshChangelogEntries,
    results,
    opportunities,
    eventDecisions,
  );
  const row = allRows.find((r) => r.change.id === id);
  if (!row) notFound();

  // Compute recommendations originating from this change
  const impactRows = enrichWithImpact(allRows);

  const citationIndex2 = (await getCitationEvidenceIndex()) as {
    by_page_and_topic: {
      page_url: string;
      is_owned: boolean;
      total_citations: number;
    }[];
    by_topic: { topic: string }[];
  } | null;
  const citMap = new Map<string, number>();
  if (citationIndex2) {
    for (const r of citationIndex2.by_page_and_topic) {
      if (!r.is_owned) continue;
      const key = r.page_url.replace(/\/+$/, "").toLowerCase();
      citMap.set(key, (citMap.get(key) ?? 0) + r.total_citations);
    }
  }

  // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — tenant-bound read; reuses
  // tenantId resolved at the top of the page render.
  const repo = getRepository().forTenant(tenantId);
  const pageSnapshots = await repo.getPageSnapshots();
  const patterns = minePatterns(
    pageSnapshots,
    citMap,
    allRows,
    rolloutExecutions,
    persistedPatternEvidence,
  );
  const briefs = generateBriefs(pageSnapshots, citMap, patterns);
  // MT-3C (2026-05-23) — resolve tenant config once; thread into the
  // section analyzer (now requires config) + reuse for brandName below.
  const businessConfig = getBusinessConfig(tenantId);
  const allRecs = computeRecommendations({
    impactRows,
    patterns,
    briefs,
    sectionAnalyzerConfig: getSectionAnalyzerConfig(businessConfig),
    siteOrigin: businessConfig.domain
      ? `https://${businessConfig.domain.replace(/^www\./, "")}`
      : undefined,
  });

  const trackRecord = computeTrackRecord({ impactRows, patterns });
  const recommendedMatch = wasChangeRecommended(id, trackRecord);

  const replicateRecs = allRecs.filter(
    (r) => r.type === "replicate" && r.sourceChangeId === id,
  );

  {
    // v2 proof brief — pure presentation, derived from the same data
    // the legacy detail page already loaded above. Reuses:
    //   • `entry` (changelog row) for header + Act 1 + Act 2 hypothesis
    //   • `row.eventAttributions` for Act 4 (humanized event labels)
    //   • `row.platforms` for Act 3 platform chips
    //   • `recommendedMatch` for the "Beacon recommended" tag
    //   • `replicateRecs` for Act 5's "Replicate this pattern" CTA
    //   • per-URL outcome verdict for the result-pill resolver
    //   • sparkline points from `storedOutcome.sparklines.treated`
    const [urlOutcomesAll, storedOutcome, recommendedEdits] = await Promise.all([
      getUrlChangeOutcomes(),
      loadChangeOutcomeById(entry.id),
      repository.getRecommendedEdits().catch(() => [] as never),
    ]);
    const urlOutcome =
      urlOutcomesAll.find((o) => o.change_id === entry.id) ?? null;

    // Lifecycle context — drives the result pill alongside the URL
    // verdict so the brief shows the same pill the proof timeline
    // showed the customer one click earlier.
    const editsByJoinKey = indexEditsByJoinKey(recommendedEdits);
    const joinKey = changelogJoinKey(entry);
    const linkedEdit = joinKey ? (editsByJoinKey.get(joinKey) ?? null) : null;
    const lifecycleClass: LifecycleTabClass = classifyChangelogRow({
      entry,
      edit: linkedEdit,
    });
    const lifecycleStatus: ImplementationStatus | null =
      linkedEdit?.implementation_status ?? null;

    // Phase 5 (MAX_SEO_AEO P0 #5) — the push receipt for this change's
    // linked edit, when Beacon itself published it. READ-ONLY composition
    // (ledger + snapshot + rec); returns null when the edit was never
    // pushed. Soft-fail: a transient store error degrades to null (no
    // receipt section) rather than crashing the change detail page.
    let pushReceipt: Awaited<ReturnType<typeof loadPushReceipt>> = null;
    if (linkedEdit) {
      try {
        pushReceipt = await loadPushReceipt(tenantId, linkedEdit.id);
      } catch (error) {
        console.warn("[phase5-receipt] push receipt load failed", {
          tenantId,
          changeId: entry.id,
          recommendedEditId: linkedEdit.id,
          error: error instanceof Error ? error.message : String(error),
        });
        pushReceipt = null;
      }
    }

    const pill = resolveProofPill({
      urlVerdict: urlOutcome ? { verdict: urlOutcome.verdict } : null,
      lifecycleClass,
      lifecycleStatus,
    });

    // Phase A.1 Step 7 (2026-05-13) — citation-lifecycle copy for Act 3.
    // Only the v2 brief consumes this; the legacy detail layout below
    // is intentionally untouched per Section 2.10 placement decision
    // (Act 3 lives on the v2 route only).
    const lifecycle = linkedEdit
      ? await loadLifecycleForEdit({
          tenantId,
          recommendedEdit: linkedEdit,
        })
      : null;

    // Section 6 C6b (2026-05-15) — primary-recommendation evidence
    // for Act 3. Additive sub-line below LifecycleLine. Skipped when
    // there's no linked recommended_edit (the loader has its own
    // internal short-circuits; this saves a round-trip when we
    // already know the answer). Wrapped in try/catch so a transient
    // Supabase error degrades to the null-fallback render path
    // instead of crashing Changes detail. Fallback emits a structured
    // console.warn so operators see degradation without exposing raw
    // error objects, stacks, or Supabase internals.
    const brandName = businessConfig.name || "You";
    const lifecycleStage = lifecycle?.available
      ? (lifecycle.stage ?? null)
      : null;
    let primaryEvidenceLines: string[] | null = null;
    if (linkedEdit) {
      try {
        const result = await loadChangePrimaryEvidence({
          tenantId,
          recommendedEdit: linkedEdit,
          brandName,
          lifecycleStage,
        });
        primaryEvidenceLines = result.lines;
      } catch (error) {
        console.warn("[section6-c6] change primary evidence failed", {
          tenantId,
          changeId: entry.id,
          recommendedEditId: linkedEdit.id,
          error: error instanceof Error ? error.message : String(error),
        });
        primaryEvidenceLines = null;
      }
    }

    // Section 5.B Slice 1 (2026-05-16) — repeat-citation result for
    // Act 3 customer sub-line. Same try/catch posture as Section 6
    // C6b above: a transient Supabase error degrades to `null` (the
    // sub-line is suppressed) without crashing Changes detail.
    // Independent structured warn for operator visibility. The two
    // loads stay sequential to preserve the Section 6 invariant
    // shape; both readers use `unstable_cache` so warm-path cost is
    // negligible.
    let repeatCitation30d: RepeatCitationResult | null = null;
    if (linkedEdit) {
      try {
        repeatCitation30d = await loadRepeatCitationForEdit({
          tenantId,
          recommendedEdit: linkedEdit,
          windowDays: 30,
        });
      } catch (error) {
        console.warn("[section5-b1] repeat citation load failed", {
          tenantId,
          changeId: entry.id,
          recommendedEditId: linkedEdit.id,
          error: error instanceof Error ? error.message : String(error),
        });
        repeatCitation30d = null;
      }
    }

    // Slice 9.A2β (2026-05-19) — Mode A outcome-attribution sub-line
    // for Act 3. Reads cached ga4_url_traffic rows (NEVER calls the
    // GA4 Data API on render) + computes Mode A via the 9.A2α.2 pure
    // function. Same try/catch fail-soft posture as the Section 5
    // repeat-citation block above: transient Supabase error → `null`
    // → component renders silently. Independent structured warn for
    // operator visibility.
    let modeAResult: ModeAResult | null = null;
    if (linkedEdit) {
      try {
        modeAResult = await loadModeAForChangesDetail({
          tenantId,
          recommendedEdit: linkedEdit,
        });
      } catch (error) {
        console.warn("[section9-a2b] mode A load failed", {
          tenantId,
          changeId: entry.id,
          recommendedEditId: linkedEdit.id,
          error: error instanceof Error ? error.message : String(error),
        });
        modeAResult = null;
      }
    }

    const events = row.eventAttributions
      // Most-recent first — the brief reads as a story, not a database row.
      .slice()
      .sort(
        (a, b) =>
          new Date(b.event.trigger_date).getTime() -
          new Date(a.event.trigger_date).getTime(),
      )
      .map((ea) => humanizeOutcomeEvent(ea.event));

    // Causal proof (diff-in-diff) plain-English sentence for the premium
    // brief — the strongest "what happened" claim. Self-hides when no
    // computed outcome yet (buildProofSentence handles every status).
    const causalProof = storedOutcome
      ? buildProofSentence(storedOutcome)
      : null;
    const sparklineSource = storedOutcome?.sparklines?.treated ?? [];
    const sparkline = sparklineSource.map((p) => ({
      date: p.date,
      count: p.count,
    }));

    const platformLabels = row.platforms.map((p) => platformLabel(p));

    const patternTimingNarrative =
      urlOutcome?.landing_day_n != null
        ? `Similar changes usually show signal around day ${urlOutcome.landing_day_n}.`
        : null;

    const nextActions = resolveNextActions({
      pillKind: pill.kind,
      sourceRecId: entry.source_rec_id ?? null,
      replicateRecCount: replicateRecs.length,
    });

    // Customer-safe title projection — strips internal prompt IDs,
    // "packet" vocabulary, and runaway parenthetical example lists.
    // The header uses the short form; Act 1 surfaces the cleaned
    // full description ONLY when it adds information beyond the
    // header (avoids the duplicate-render bug the visual review
    // flagged).
    const projected = projectChangeTitle(
      entry.change_description || entry.asset_name,
    );
    const shortTitle = clampShortTitle(projected.shortTitle);

    return (
      <div className="space-y-6">
        {/* Phase 5 (P0 #5) — "What shipped" receipt. Only rendered when
            Beacon itself pushed this change's linked edit (non-null
            receipt). Sits above the proof brief; the existing
            attribution/verdict acts below are untouched. */}
        {pushReceipt && (
          <div className="max-w-3xl">
            <PushReceipt receipt={pushReceipt} />
          </div>
        )}
        <ChangeDetailV2Client
          title={shortTitle}
          fullDescription={projected.fullDescription}
          targetUrl={entry.url ?? null}
          shippedAt={entry.timestamp}
          pill={pill}
          hypothesis={entry.hypothesis}
          hypothesisSource={entry.hypothesis_source ?? null}
          patternTimingNarrative={patternTimingNarrative}
          events={events}
          sparkline={sparkline}
          platformLabels={platformLabels}
          beaconRecommended={!!recommendedMatch}
          nextActions={nextActions}
          lifecycle={
            lifecycle?.available && lifecycle.copy
              ? {
                  stage: lifecycle.stage!,
                  copy: lifecycle.copy,
                  isPartialLive: lifecycle.result.is_partial_live,
                }
              : null
          }
          primaryEvidenceLines={primaryEvidenceLines}
          repeatCitation30d={repeatCitation30d}
          modeAResult={modeAResult}
          causalProof={causalProof}
        />
      </div>
    );
  }
  } finally {
    trace.flush();
  }
}

/** Keep the retired implementation type-checkable until its bounded deletion
 * wave while making the runtime redirect unconditional. */
function redirectToCanonicalResult(href: string): void {
  redirect(href);
}

/**
 * Phase 1.6 (Sprint 1 follow-up, 2026-04-24) — honest error state.
 *
 * Rendered when the repository fetch fails. Deliberately does NOT fall back
 * to the stale module-level `changelogEntries` array that this page used to
 * read from — the whole point of the fresh-read pattern is that operators
 * never see a detail page that conflicts with /changes. A transient read
 * failure is rare enough that a plain retry message is the right UX.
 * Matches the error shape on /changes main list.
 */
function ChangeDetailReadError({ error }: { error: unknown }) {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown error reading changelog entry";
  return (
    <div className="max-w-3xl">
      <section
        className="rounded-lg border border-status-warning/40 bg-status-warning/5 px-5 py-5"
        aria-labelledby="change-detail-read-error-heading"
      >
        <h2
          id="change-detail-read-error-heading"
          className="text-[13px] font-semibold text-foreground tracking-tight"
        >
          Couldn&apos;t load this change
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {message}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          This usually means the database is temporarily unreachable. Refresh
          the page to retry. We never fall back to cached data here, so you
          won&apos;t see stale truth by accident.
        </p>
        <Link
          href="/changes"
          className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
        >
          ← Back to Changes
        </Link>
      </section>
    </div>
  );
}
