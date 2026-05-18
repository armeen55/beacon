import "server-only";

/**
 * 2026-05-18 Phase A.2 Step 3d — operator-only lifecycle
 * eligibility diagnostic.
 *
 * Read-only page that surfaces the FULL Beacon lifecycle funnel for
 * a tenant's `recommended_edits`:
 *
 *   suggested → reviewed → accepted → shipped/live_at →
 *   cited → threshold-eligible
 *
 * Built after the verified_live gap investigation discovered that
 * "1 of 28" was misread as a match-engine bug when in fact 20 of 28
 * are simply awaiting operator acceptance. The page exists to make
 * this math impossible to misunderstand again — distinguishes
 * OPERATOR-blocked rows ("you haven't accepted this") from
 * SYSTEM-blocked rows ("scan/data hasn't matched this").
 *
 * Operator-only. Gated by `isOperatorModeServer()`; `notFound()` for
 * every other caller. `NODE_ENV === "test"` extension preserves
 * render-under-test (same convention as `/diagnostics/indexability`).
 *
 * Read-only contract (pinned by
 * `tests/architecture/lifecycle-eligibility-no-mutation.test.ts`):
 * no Supabase writes, no `markRecommendedEditsAsShipped`, no accept/
 * dismiss server actions, no match-runner invocation, no GSC, no
 * LLM, no paid APIs.
 */

import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import { loadLifecycleForEdit } from "@/domains/citation-lifecycle/load-lifecycle";
import { getResponse } from "@/domains/product/recommendation-response-store";
import {
  buildSnapshotUrlIndex,
  deriveLifecycleReason,
} from "@/domains/lifecycle-eligibility/derive-reason";
import { computeFunnelCounters } from "@/domains/lifecycle-eligibility/aggregate-counters";
import type {
  FunnelCounters,
  LifecycleEligibilityReason,
  PerRowEligibility,
} from "@/domains/lifecycle-eligibility/types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { LifecycleForEdit } from "@/domains/citation-lifecycle/load-lifecycle";

export const dynamic = "force-dynamic";

function isAccessAllowed(): boolean {
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

// ─────────────────────────────────────────────────────────────────────
// Reason ordering + visual tone
// ─────────────────────────────────────────────────────────────────────

const REASON_SEVERITY: Record<LifecycleEligibilityReason, number> = {
  // Most-actionable first.
  awaiting_operator_acceptance: 0,
  accepted_not_live: 1,
  no_snapshot_for_target_url: 2,
  url_canonicalization_mismatch: 3,
  match_fields_missing: 4,
  missing_live_at: 5,
  missing_target_url: 6,
  wrong_page: 7,
  stuck_uncited: 8,
  verified_live_not_yet_cited: 9,
  needs_new_page_sentinel: 10,
  dismissed_at_response_level: 11,
  dismissed_at_edit_level: 12,
  cited_eligible: 13,
  unknown: 14,
};

const REASON_TONE: Record<LifecycleEligibilityReason, string> = {
  awaiting_operator_acceptance: "bg-status-warning/15 text-status-warning",
  accepted_not_live: "bg-muted/40 text-foreground/70",
  no_snapshot_for_target_url: "bg-status-warning/15 text-status-warning",
  url_canonicalization_mismatch: "bg-status-warning/10 text-status-warning",
  match_fields_missing: "bg-status-warning/10 text-status-warning",
  missing_live_at: "bg-status-danger/10 text-status-danger",
  missing_target_url: "bg-status-danger/10 text-status-danger",
  wrong_page: "bg-status-danger/10 text-status-danger",
  stuck_uncited: "bg-status-warning/10 text-foreground/70",
  verified_live_not_yet_cited: "bg-muted/40 text-foreground/70",
  needs_new_page_sentinel: "bg-muted/30 text-muted-foreground",
  dismissed_at_response_level: "bg-muted/30 text-muted-foreground",
  dismissed_at_edit_level: "bg-muted/30 text-muted-foreground",
  cited_eligible: "bg-status-success/15 text-status-success",
  unknown: "bg-muted/40 text-muted-foreground",
};

const ALL_REASONS: ReadonlyArray<LifecycleEligibilityReason> = [
  "awaiting_operator_acceptance",
  "accepted_not_live",
  "no_snapshot_for_target_url",
  "url_canonicalization_mismatch",
  "match_fields_missing",
  "missing_live_at",
  "missing_target_url",
  "wrong_page",
  "stuck_uncited",
  "verified_live_not_yet_cited",
  "needs_new_page_sentinel",
  "dismissed_at_response_level",
  "dismissed_at_edit_level",
  "cited_eligible",
  "unknown",
];

// ─────────────────────────────────────────────────────────────────────
// Server component
// ─────────────────────────────────────────────────────────────────────

export default async function LifecycleEligibilityDiagnosticPage() {
  if (!isAccessAllowed()) {
    notFound();
  }

  const tenantId = await currentTenantId();
  const now = new Date();

  const repo = getRepository().forTenant(tenantId);
  const [edits, snapshots] = await Promise.all([
    repo.getRecommendedEdits(),
    repo.getPageSnapshots(),
  ]);

  // `recommendation_responses` is read via `getResponse(recId)`. The
  // store backfills from Supabase + disk in one call; per-rec lookup
  // is cached. Build a deduped recId list first so we only call the
  // store once per distinct rec.
  const distinctRecIds = new Set<string>();
  for (const e of edits) {
    if (e.rec_id) distinctRecIds.add(e.rec_id);
  }
  const responseEntries = await Promise.all(
    Array.from(distinctRecIds).map(async (recId) => {
      const r = await getResponse(recId);
      return r;
    }),
  );
  const responses = responseEntries.filter(
    (r): r is NonNullable<typeof r> => r != null,
  );
  const responsesByRecId = new Map(responses.map((r) => [r.recId, r]));

  // Snapshot URL index for the derive-reason canonicalization check.
  const snapshotIndex = buildSnapshotUrlIndex(snapshots.map((s) => s.url));

  // Per-row lifecycle load. Sequential to keep budget tight for
  // operator-only render; per-row 60s cache from `loadLifecycleForEdit`
  // means a refresh hits cache.
  const lifecycleResults: Array<LifecycleForEdit | null> = [];
  for (const edit of edits) {
    try {
      const res = await loadLifecycleForEdit({
        tenantId,
        recommendedEdit: edit,
        now,
      });
      lifecycleResults.push(res);
    } catch {
      lifecycleResults.push(null);
    }
  }

  // Per-row reason derivation.
  const perRowDecisions: PerRowEligibility[] = edits.map((edit, i) =>
    deriveLifecycleReason({
      edit,
      response: responsesByRecId.get(edit.rec_id) ?? null,
      snapshotIndex,
      lifecycleResult: lifecycleResults[i] ?? null,
    }),
  );

  const counters: FunnelCounters = computeFunnelCounters({
    edits,
    responses,
    snapshotIndex,
    perRowDecisions,
    lifecycleResults,
  });

  // Build rows for table render. Combine edit + decision + response.
  type Row = {
    edit: RecommendedEditRow;
    decision: PerRowEligibility;
    response: ReturnType<typeof responsesByRecId.get>;
  };
  const rows: Row[] = edits.map((edit, i) => ({
    edit,
    decision: perRowDecisions[i]!,
    response: responsesByRecId.get(edit.rec_id),
  }));
  rows.sort(
    (a, b) =>
      REASON_SEVERITY[a.decision.reason] - REASON_SEVERITY[b.decision.reason],
  );

  // Reason-distribution counters for filter chips.
  const reasonDistribution: Record<LifecycleEligibilityReason, number> = {
    awaiting_operator_acceptance: 0,
    accepted_not_live: 0,
    no_snapshot_for_target_url: 0,
    url_canonicalization_mismatch: 0,
    match_fields_missing: 0,
    missing_live_at: 0,
    missing_target_url: 0,
    wrong_page: 0,
    stuck_uncited: 0,
    verified_live_not_yet_cited: 0,
    needs_new_page_sentinel: 0,
    dismissed_at_response_level: 0,
    dismissed_at_edit_level: 0,
    cited_eligible: 0,
    unknown: 0,
  };
  for (const d of perRowDecisions) reasonDistribution[d.reason]++;

  return (
    <main
      className="container mx-auto max-w-7xl px-4 py-6 space-y-6"
      data-diagnostics-page="lifecycle-eligibility"
    >
      <header className="space-y-1">
        <h1 className="text-[18px] font-semibold tracking-tight">
          Lifecycle eligibility diagnostics
        </h1>
        <p className="text-[12px] text-muted-foreground">
          Operator-only surface. Per-row reason taxonomy for the
          suggested → reviewed → accepted → shipped → cited →
          threshold-eligible funnel. Distinguishes operator-blocked
          rows from system-blocked rows. Read-only.
        </p>
      </header>

      {/* ── Funnel counters ─────────────────────────────────────── */}
      <section
        className="rounded-md border border-border/60 bg-surface-base p-4 space-y-3"
        data-diagnostics-section="funnel-counters"
      >
        <h2 className="text-[13px] font-semibold">Funnel counters</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
          <SummaryRow
            label="Total suggested edits"
            value={String(counters.total_edits)}
            attr="total_edits"
          />
          <SummaryRow
            label="Awaiting operator acceptance"
            value={String(counters.edits_recommended)}
            attr="edits_recommended"
          />
          <SummaryRow
            label="Dismissed (edit-level)"
            value={String(counters.edits_dismissed)}
            attr="edits_dismissed"
          />
          <SummaryRow
            label="Accepted, not yet live"
            value={String(counters.edits_accepted_not_live)}
            attr="edits_accepted_not_live"
          />
          <SummaryRow
            label="Shipped (live_at set)"
            value={String(counters.edits_with_live_at)}
            attr="edits_with_live_at"
          />
          <SummaryRow
            label="Verified-live status family"
            value={String(counters.edits_verified_live)}
            attr="edits_verified_live"
          />
          <SummaryRow
            label="Cited post-ship"
            value={String(counters.edits_cited_post_ship)}
            attr="edits_cited_post_ship"
          />
          <SummaryRow
            label="Threshold-eligible"
            value={String(counters.edits_threshold_eligible)}
            attr="edits_threshold_eligible"
          />
        </dl>
      </section>

      {/* ── Response-level + threshold gate ─────────────────────── */}
      <section
        className="rounded-md border border-border/60 bg-surface-base p-4 space-y-3"
        data-diagnostics-section="responses-and-gate"
      >
        <h2 className="text-[13px] font-semibold">
          Recommendation responses + threshold gate
        </h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
          <SummaryRow
            label="Total responses"
            value={String(counters.responses_total)}
            attr="responses_total"
          />
          <SummaryRow
            label="Accepted responses"
            value={String(counters.responses_accepted)}
            attr="responses_accepted"
          />
          <SummaryRow
            label="Dismissed responses"
            value={String(counters.responses_dismissed)}
            attr="responses_dismissed"
          />
          <SummaryRow
            label="Deferred responses"
            value={String(counters.responses_deferred)}
            attr="responses_deferred"
          />
          <SummaryRow
            label="Edits in accepted lineage"
            value={String(counters.edits_in_accepted_lineage)}
            attr="edits_in_accepted_lineage"
          />
          <SummaryRow
            label="Threshold gate progress"
            value={`${counters.edits_threshold_eligible} / ${counters.threshold_gate}`}
            attr="threshold_gate_progress"
          />
          <SummaryRow
            label="Threshold source"
            value={counters.threshold_source}
            attr="threshold_source"
          />
        </dl>
      </section>

      {/* ── URL coverage / matchability ─────────────────────────── */}
      <section
        className="rounded-md border border-border/60 bg-surface-base p-4 space-y-3"
        data-diagnostics-section="url-coverage"
      >
        <h2 className="text-[13px] font-semibold">URL coverage</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
          <SummaryRow
            label="Unique target URLs"
            value={String(counters.unique_target_urls)}
            attr="unique_target_urls"
          />
          <SummaryRow
            label="URLs with snapshot coverage (exact)"
            value={String(counters.urls_with_snapshot_coverage)}
            attr="urls_with_snapshot_coverage"
          />
          <SummaryRow
            label="URLs without snapshot coverage"
            value={String(counters.urls_without_snapshot_coverage)}
            attr="urls_without_snapshot_coverage"
          />
          <SummaryRow
            label="URLs with canonicalization mismatch"
            value={String(counters.urls_with_canonicalization_mismatch)}
            attr="urls_with_canonicalization_mismatch"
          />
        </dl>
        {counters.urls_with_canonicalization_mismatch > 0 ? (
          <p
            className="text-[11px] text-status-warning"
            data-diagnostics-section="canonicalization-warning"
          >
            ⚠ {counters.urls_with_canonicalization_mismatch} target URL(s)
            have canonical-equal but not exact-equal snapshots — e.g.,
            target stores trailing slash but snapshot does not. The
            match engine compares exact URLs; these rows would not match
            on the current snapshot if accepted. Not fixed in this
            slice — surfaced for operator triage.
          </p>
        ) : null}
      </section>

      {/* ── Block classification ────────────────────────────────── */}
      <section
        className="rounded-md border border-border/60 bg-surface-base p-4 space-y-3"
        data-diagnostics-section="block-classification"
      >
        <h2 className="text-[13px] font-semibold">Block classification</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
          <SummaryRow
            label="Blocked by operator inaction"
            value={String(counters.edits_blocked_by_operator)}
            attr="edits_blocked_by_operator"
          />
          <SummaryRow
            label="Blocked by scan/match/data"
            value={String(counters.edits_blocked_by_system)}
            attr="edits_blocked_by_system"
          />
          <SummaryRow
            label="Terminal or in-flight"
            value={String(counters.edits_terminal_or_in_flight)}
            attr="edits_terminal_or_in_flight"
          />
        </dl>
      </section>

      {/* ── Reason distribution ─────────────────────────────────── */}
      <section
        className="flex flex-wrap gap-2"
        data-diagnostics-section="reason-distribution"
      >
        {ALL_REASONS.map((r) => (
          <span
            key={r}
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${REASON_TONE[r]}`}
            data-reason-tally={r}
          >
            <span className="tabular-nums">{reasonDistribution[r]}</span>
            <span className="font-mono">{r}</span>
          </span>
        ))}
      </section>

      {/* ── Per-row table ───────────────────────────────────────── */}
      <section
        className="rounded-md border border-border/60 bg-surface-base overflow-x-auto"
        data-diagnostics-section="row-table"
      >
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">
            No recommended_edits rows for this tenant.
          </div>
        ) : (
          <table
            className="w-full text-[11.5px]"
            data-diagnostics-table="lifecycle-eligibility"
          >
            <thead className="text-left text-muted-foreground border-b border-border/60">
              <tr>
                <th className="px-2 py-2 font-medium">edit id (tail)</th>
                <th className="px-2 py-2 font-medium">rec id</th>
                <th className="px-2 py-2 font-medium">action_type</th>
                <th className="px-2 py-2 font-medium">target_url</th>
                <th className="px-2 py-2 font-medium">element_key</th>
                <th className="px-2 py-2 font-medium">impl_status</th>
                <th className="px-2 py-2 font-medium">response_status</th>
                <th className="px-2 py-2 font-medium">live_at</th>
                <th className="px-2 py-2 font-medium">not_found_reason</th>
                <th className="px-2 py-2 font-medium">match_kind</th>
                <th className="px-2 py-2 font-medium">match_conf</th>
                <th className="px-2 py-2 font-medium">url_match</th>
                <th className="px-2 py-2 font-medium">stage</th>
                <th className="px-2 py-2 font-medium">days_to_cite</th>
                <th className="px-2 py-2 font-medium">threshold_eligible</th>
                <th className="px-2 py-2 font-medium">reason</th>
                <th className="px-2 py-2 font-medium">detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RowDisplay key={r.edit.id} row={r} snapshotExact={snapshotIndex.exact} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function SummaryRow({
  label,
  value,
  attr,
}: {
  label: string;
  value: string;
  attr: string;
}) {
  return (
    <div className="flex items-baseline gap-2" data-counter={attr}>
      <dt className="text-muted-foreground w-64 shrink-0">{label}</dt>
      <dd className="font-mono text-[11.5px] tabular-nums">{value}</dd>
    </div>
  );
}

function RowDisplay({
  row,
  snapshotExact,
}: {
  row: {
    edit: RecommendedEditRow;
    decision: PerRowEligibility;
    response: ReturnType<Map<string, unknown>["get"]> | undefined;
  };
  snapshotExact: ReadonlySet<string>;
}) {
  const { edit, decision } = row;
  const idTail = edit.id.length > 16 ? edit.id.slice(-16) : edit.id;
  const urlMatch = edit.target_url
    ? snapshotExact.has(edit.target_url)
      ? "✓"
      : decision.reason === "url_canonicalization_mismatch"
        ? "⚠"
        : "✗"
    : "—";

  return (
    <tr
      className="border-b border-border/40 last:border-b-0 align-top"
      data-diagnostics-row="true"
      data-row-edit-id={edit.id}
      data-row-impl-status={edit.implementation_status}
      data-row-eligibility-reason={decision.reason}
    >
      <td className="px-2 py-2 font-mono text-[10.5px] break-all max-w-[140px]">
        {idTail}
      </td>
      <td className="px-2 py-2 font-mono text-[10.5px] break-all max-w-[200px]">
        {edit.rec_id}
      </td>
      <td className="px-2 py-2 font-mono whitespace-nowrap">
        {edit.action_type ?? "—"}
      </td>
      <td className="px-2 py-2 font-mono text-[10.5px] break-all max-w-[240px]">
        {edit.target_url ?? "—"}
      </td>
      <td className="px-2 py-2 font-mono text-[10.5px] break-all max-w-[120px]">
        {edit.target_element_key ?? "—"}
      </td>
      <td className="px-2 py-2 font-mono">{edit.implementation_status}</td>
      <td className="px-2 py-2 font-mono">
        {row.response != null
          ? (row.response as { status: string }).status
          : "—"}
      </td>
      <td className="px-2 py-2 font-mono text-[10.5px]">
        {edit.live_at ? edit.live_at.slice(0, 10) : "—"}
      </td>
      <td className="px-2 py-2 font-mono text-[10.5px] break-all max-w-[180px]">
        {edit.not_found_reason ?? "—"}
      </td>
      <td className="px-2 py-2 font-mono">{edit.live_match_kind ?? "—"}</td>
      <td className="px-2 py-2 font-mono">
        {edit.live_match_confidence ?? "—"}
      </td>
      <td
        className={`px-2 py-2 font-mono ${urlMatch === "⚠" ? "text-status-warning" : ""}`}
        data-row-url-match={urlMatch}
      >
        {urlMatch}
      </td>
      <td className="px-2 py-2 font-mono whitespace-nowrap">
        {decision.lifecycle_stage ?? "—"}
      </td>
      <td className="px-2 py-2 font-mono tabular-nums">
        {decision.days_to_first_citation ?? "—"}
      </td>
      <td className="px-2 py-2 font-mono">
        {decision.threshold_eligible ? "✓" : "✗"}
      </td>
      <td className="px-2 py-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-mono ${REASON_TONE[decision.reason]}`}
        >
          {decision.reason}
        </span>
      </td>
      <td className="px-2 py-2 text-[11px] text-muted-foreground max-w-[280px] break-words">
        {decision.detail ?? "—"}
      </td>
    </tr>
  );
}
