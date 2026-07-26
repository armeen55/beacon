import Link from "next/link";
// R4 (2026-07-03) - this timeline renders only on /results, so its ledger read
// uses the same request-memoized SWR snapshot the page already serves instead of
// re-triggering a full re-measure (loadProofLedger).
import { loadResultsLedgerSurface } from "../results/results-ledger-data";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { normalizeUrl } from "@/lib/url/normalize";
import type { ChangelogEntry } from "@/domains/measurement/changelog/types";
import type { EnrichedChangeRow, ChangeRowProof } from "./types";
import { ChangesV2Client } from "./changes-v2-client";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import { maybeRefreshUrlWatcher } from "@/domains/evidence";
import type { KernelRead } from "@/domains/measurement/proof-gsc";
import { kernelProofSummary } from "@/domains/decision";
import type { ImplementationStatus, RecommendedEditRow } from "@/domains/decision/changes/recommended-edits-persistence";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";

/**
 * Inline changelog-to-edit join (Core 100K: the attribution/lifecycle-classification module
 * that owned these helpers was retired). Links a changelog row to its recommended_edit by
 * the (rec id, action type, target element) triple both sides carry, so the per-row
 * "Mark shipped" affordance still knows which edits are accepted. A row missing any leg
 * has no linkage and resolves to null.
 */
function changelogJoinKey(entry: {
  source_rec_id?: string | null;
  action_type?: string | null;
  target_element_key?: string | null;
}): string | null {
  if (!entry.source_rec_id || !entry.action_type || !entry.target_element_key) return null;
  return `${entry.source_rec_id}__${entry.action_type}__${entry.target_element_key}`;
}

function indexEditsByJoinKey<
  T extends { rec_id?: string | null; action_type?: string | null; target_element_key?: string | null },
>(edits: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const edit of edits) {
    if (!edit.rec_id || !edit.action_type || !edit.target_element_key) continue;
    map.set(`${edit.rec_id}__${edit.action_type}__${edit.target_element_key}`, edit);
  }
  return map;
}

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
            Every change you make shows up here, newest first. Open Changes, make
            the top one on your site, then mark it done and I will start measuring.
          </p>
          <Link
            href="/changes"
            className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
          >
            Open Changes &rarr;
          </Link>
        </section>
      );
    }

    try {
      await maybeRefreshUrlWatcher("page-load");
    } catch (err) {
      console.error("[results-timeline] URL watcher refresh error (non-fatal)", err);
    }

    // Core 100K: the lifecycle-classification + synthetic-pending-row enrichment was retired.
    // This is now the raw change log - live changelog rows only, joined to their recommended
    // edit ONLY to keep the per-row "Mark shipped" affordance (edit status = accepted). No tab
    // classification; the proof coverage joined below drives each row's pill.
    const allRowsForClassifier = liveEntries;
    const editsByJoinKey = indexEditsByJoinKey(recommendedEdits);
    const editStatusByChangelogId: Record<string, ImplementationStatus> = {};
    for (const entry of allRowsForClassifier) {
      const joinKey = changelogJoinKey(entry);
      if (!joinKey) continue;
      const edit = editsByJoinKey.get(joinKey);
      if (edit?.implementation_status) {
        editStatusByChangelogId[entry.id] = edit.implementation_status;
      }
    }

    // The measured ledger this page's verdict bands already render. The SWR
    // surface read is request-memoized (React cache), so this shares ONE
    // snapshot with the rest of /results. Fail-soft to [] - the rows then
    // render the honest not-measured line, same posture as the count below.
    let reads: KernelRead[] = [];
    try {
      reads = (await loadResultsLedgerSurface())?.reads ?? [];
    } catch (err) {
      console.error("[results-timeline] proof ledger read failed (non-fatal)", err);
    }

    const readById = new Map(reads.map((r) => [r.id, r] as const));
    const dateOnly = (v: string): string | null => /^\d{4}-\d{2}-\d{2}/.exec(v.trim())?.[0] ?? null;
    const findReadForChange = (change: Pick<ChangelogEntry, "id" | "url" | "timestamp">): KernelRead | null => {
      const direct = readById.get(change.id);
      if (direct) return direct;
      const path = change.url ? normalizeUrl(change.url) : null;
      const shipDate = dateOnly(change.timestamp);
      if (!path || !shipDate) return null;
      return reads.find((r) => normalizeUrl(r.path || r.page) === path && r.id.endsWith(`::${shipDate}`)) ?? null;
    };

    const sortedRows = [...allRowsForClassifier].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    const enriched: EnrichedChangeRow[] = sortedRows.map((change) => {
      const read = findReadForChange(change);
      return { change, proof: read ? readToChangeRowProof(read) : null };
    });

    const proofLedgerCount = isOperatorModeServer() ? reads.length : 0;

    return (
      <ChangesV2Client
        rows={enriched}
        classByChangelogId={{}}
        editStatusByChangelogId={editStatusByChangelogId}
        proofLedgerCount={proofLedgerCount}
        showHeader={false}
      />
    );
  } finally {
    trace.flush();
  }
}

/** Map a kernel read to the timeline row's proof summary (drops the headline). */
function readToChangeRowProof(read: KernelRead): ChangeRowProof {
  const { maturity, direction, verdict, nextCheckpoint } = kernelProofSummary(read);
  return { maturity, direction, verdict, nextCheckpoint };
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
