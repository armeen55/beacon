import Link from "next/link";
// R4 (2026-07-03) - this timeline renders only on /results, so its ledger read
// uses the same request-memoized SWR snapshot the page already serves instead of
// re-triggering a full re-measure (loadProofLedger).
import { loadResultsLedgerSurface } from "../results/results-ledger-data";
import { presentationVerdictFor } from "../results/proof-badge";
import { isOperatorModeServer } from "@/lib/operator-mode";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { EnrichedChangeRow, ChangeRowProof } from "./types";
import { ChangesV2Client } from "./changes-v2-client";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import { maybeRefreshUrlWatcher } from "@/domains/product/url-watcher";
import { findProofForChange } from "@/domains/proof-gsc/change-proof-link";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  buildMeasurementPresentation,
  detectMeasurementOverlaps,
} from "@/domains/proof-gsc/measurement-maturity";
import {
  changelogJoinKey,
  classifyAll,
  indexEditsByJoinKey,
} from "@/domains/attribution/lifecycle-classification";
import {
  buildSyntheticChangelogRows,
  computeLifecycleCounts,
  editNeedsRewrite,
} from "@/domains/attribution/pending-timeline-rows";
import type {
  ImplementationStatus,
  RecommendedEditRow,
} from "@/domains/recommendations/recommended-edits-persistence";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";

/**
 * ResultsTimeline — the "what changed / is it measuring / did it work" timeline.
 *
 * IA consolidation (2026-06-23): this is the former `/changes` index body,
 * extracted so it can be embedded inside the single Results (/results) page.
 * The /changes index is now a thin redirect to /results; this component renders
 * the v2 proof timeline with its own header SUPPRESSED (Results shows the page
 * header) and without the duplicate proof-ledger strip.
 *
 * Verdict-engine consolidation (2026-07-21, CORE 100K Lane F): the per-row
 * result used to come from a parallel URL Z-score verdict engine plus the
 * legacy ChangeImpact scorecard. Each row now joins the SAME shipped-change
 * proof ledger Results renders (request-memoized SWR snapshot) and reads the
 * maturity-gated buildMeasurementPresentation summary, so one change can never
 * show two competing verdicts on one page. Rows without proof coverage say
 * plainly they are not being measured.
 *
 * Embedded empty/error states are compact (no PageHeader) so they compose
 * cleanly as a section under the Results page.
 */
export async function ResultsTimeline() {
  const trace = createPerfTrace("loader:results-timeline", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/results",
  });
  try {
    const repository = getRepository().forTenant(await currentTenantId());
    let freshChangelogEntries: ChangelogEntry[];
    try {
      freshChangelogEntries = await repository.getChangelogEntries();
    } catch (error) {
      // The raw technical error (which can carry the store internals and the
      // failing table name) goes to the SERVER log only, never to the operator.
      console.error("[results-timeline] change history read failed", error);
      return <ResultsTimelineReadError />;
    }

    const liveEntries = freshChangelogEntries.filter((c) => !c.archived);

    let recommendedEdits: RecommendedEditRow[] = [];
    try {
      recommendedEdits = await repository.getRecommendedEdits();
    } catch (err) {
      console.error(
        "[results-timeline] recommended_edits read failed (non-fatal)",
        err,
      );
    }

    // Compact embedded empty state (no duplicate page header).
    if (liveEntries.length === 0 && recommendedEdits.length === 0) {
      return (
        <section
          className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5"
          aria-labelledby="results-timeline-empty-heading"
          data-results-timeline-empty="true"
        >
          <h2
            id="results-timeline-empty-heading"
            className="text-[13px] font-semibold text-foreground tracking-tight"
          >
            No changes yet
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Every edit you ship, and every change Beacon detects on your site,
            shows up here, newest first. Approve a suggested fix to get your
            first change tracked.
          </p>
          <Link
            href="/changes?status=ready"
            className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
          >
            See suggested fixes &rarr;
          </Link>
        </section>
      );
    }

    try {
      await maybeRefreshUrlWatcher("page-load");
    } catch (err) {
      console.error("[results-timeline] URL watcher refresh error (non-fatal)", err);
    }

    const lifecycleBuckets = computeLifecycleCounts(recommendedEdits);
    const syntheticPendingRows = buildSyntheticChangelogRows({
      changelogEntries: liveEntries,
      editsToSynthesize: [
        ...lifecycleBuckets.buckets.pendingEdits,
        ...lifecycleBuckets.buckets.needsReviewEdits,
      ],
    });
    const allRowsForClassifier = [...liveEntries, ...syntheticPendingRows];

    const editsByJoinKey = indexEditsByJoinKey(recommendedEdits);
    const classification = classifyAll({
      entries: allRowsForClassifier,
      editsByJoinKey,
    });
    const editStatusByChangelogId: Record<string, ImplementationStatus> = {};
    const editLiveAtByChangelogId: Record<string, string> = {};
    const editNeedsRewriteByChangelogId: Record<string, boolean> = {};
    for (const entry of allRowsForClassifier) {
      const joinKey = changelogJoinKey(entry);
      if (!joinKey) continue;
      const edit = editsByJoinKey.get(joinKey);
      if (edit?.implementation_status) {
        editStatusByChangelogId[entry.id] = edit.implementation_status;
      }
      if (edit?.live_at) {
        editLiveAtByChangelogId[entry.id] = edit.live_at;
      }
      if (edit && editNeedsRewrite(edit)) {
        editNeedsRewriteByChangelogId[entry.id] = true;
      }
    }

    // The measured ledger this page's verdict bands already render. The SWR
    // surface read is request-memoized (React cache), so this shares ONE
    // snapshot with the rest of /results. Fail-soft to [] - the rows then
    // render the honest not-measured line, same posture as the count below.
    let ledger: ShippedChangeRecord[] = [];
    try {
      ledger = (await loadResultsLedgerSurface()).ledger;
    } catch (err) {
      console.error("[results-timeline] proof ledger read failed (non-fatal)", err);
    }

    const proofNow = new Date();
    const overlapById = detectMeasurementOverlaps(
      ledger.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })),
    );
    // Same compact presentation input today-moves-data.ts uses: the pill needs
    // mature-vs-not + direction, not the blocked/collecting split, so the GSC
    // watermark is omitted. The calibration quarantine (presentationVerdictFor)
    // keeps an uncalibrated won/lost reading as inconclusive, matching the
    // Results cards above this section.
    const proofSummaryFor = (record: ShippedChangeRecord): ChangeRowProof => {
      const basisWin = (record.windows ?? [])
        .filter((w) => w.ran)
        .sort((a, b) => b.day - a.day)[0];
      const pres = buildMeasurementPresentation({
        shippedAt: record.shippedAt,
        now: proofNow,
        latestGscDate: null,
        windows: (record.windows ?? []).map((w) => ({ day: w.day, ran: w.ran })),
        verdict: presentationVerdictFor(record),
        controlsUsed: basisWin?.controlsUsed ?? 0,
        baselineImpressions: record.baseline?.impressions ?? 0,
        overlap: overlapById.get(record.id) ?? null,
        live: true,
        weakComparison: record.controlMatchWeak === true,
      });
      return {
        maturity: pres.maturity,
        direction: pres.direction,
        verdict: pres.verdict,
        nextCheckpoint: pres.nextCheckpoint,
      };
    };

    const sortedRows = [...allRowsForClassifier].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    const enriched: EnrichedChangeRow[] = sortedRows.map((change) => {
      const record = findProofForChange(change, ledger);
      return {
        change,
        proof: record ? proofSummaryFor(record) : null,
      };
    });

    const proofLedgerCount = isOperatorModeServer() ? ledger.length : 0;

    return (
      <ChangesV2Client
        rows={enriched}
        classByChangelogId={Object.fromEntries(classification.classOf)}
        editStatusByChangelogId={editStatusByChangelogId}
        proofLedgerCount={proofLedgerCount}
        showHeader={false}
      />
    );
  } finally {
    trace.flush();
  }
}

/**
 * Compact embedded error state (no PageHeader). Never falls back to stale
 * cached truth, and never leaks the raw technical error (store internals, table
 * names, stack fragments) to the operator - that goes to the server log at the
 * catch site. The operator sees calm, plain recovery copy only.
 */
export function ResultsTimelineReadError() {
  return (
    <section
      className="rounded-lg border border-status-warning/40 bg-status-warning/5 px-5 py-5"
      aria-labelledby="results-timeline-read-error-heading"
      data-results-timeline-error="true"
    >
      <h2
        id="results-timeline-read-error-heading"
        className="text-[13px] font-semibold text-foreground tracking-tight"
      >
        I could not read your change history just now.
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        Try again in a minute.
      </p>
    </section>
  );
}
