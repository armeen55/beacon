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

import Link from "next/link";
import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import { loadLifecycleForEdit } from "@/domains/citation-lifecycle/load-lifecycle";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import {
  buildSnapshotUrlIndex,
  deriveLifecycleReason,
  type SnapshotUrlIndex,
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
// Phase A.2 Step 3e.A1 — snapshot-coverage classifier
//
// Independent of `derive-reason.ts`'s reason branching because the
// canonical-equal-but-not-exact-equal case applies to ALL row classes
// (awaiting, accepted, shipped, etc.) — the reason classifier only
// surfaces it explicitly for `accepted` rows. Filter chips
// (`?url_match=mismatch`) and the `url_match` table column need this
// broader signal so awaiting rows on homepage-trailing-slash URLs
// surface as ⚠ instead of ✗.
//
// Mirrors the same canonicalizer the reason classifier uses so the
// two views agree on the ⚠ class.
// ─────────────────────────────────────────────────────────────────────

type UrlMatchToken = "✓" | "⚠" | "✗" | "—";

function deriveUrlMatch(args: {
  targetUrl: string | null;
  snapshotIndex: SnapshotUrlIndex;
}): UrlMatchToken {
  if (!args.targetUrl) return "—";
  if (args.snapshotIndex.exact.has(args.targetUrl)) return "✓";
  const canonical = canonicalizeCitationUrl(args.targetUrl);
  if (canonical != null && args.snapshotIndex.canonicalToExact.has(canonical)) {
    return "⚠";
  }
  return "✗";
}

// ─────────────────────────────────────────────────────────────────────
// Phase A.2 Step 3e — filter chips (server-rendered searchParams).
//
// Pattern ported verbatim from /diagnostics/indexability. Filters run
// AFTER all tenant-scoped reads on a pure in-memory row set; no extra
// repository calls per filter. Default = no filter = all rows.
// ─────────────────────────────────────────────────────────────────────

type SearchParams = Record<string, string | string[] | undefined>;

function readParam(p: SearchParams, key: string): string | null {
  const v = p[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

type BlockedByFilter = "operator" | "system" | "terminal";

function blockedByBucket(
  blocked: "operator" | "system" | null,
): BlockedByFilter {
  if (blocked === "operator") return "operator";
  if (blocked === "system") return "system";
  return "terminal";
}

type FilterableRow = {
  decision: PerRowEligibility;
  edit: RecommendedEditRow;
  urlMatch: UrlMatchToken;
};

function applyFilters<R extends FilterableRow>(
  rows: ReadonlyArray<R>,
  sp: SearchParams,
): R[] {
  const reason = readParam(sp, "reason");
  const urlMatchFilter = readParam(sp, "url_match");
  const statusFilter = readParam(sp, "status");
  const blockedByFilter = readParam(sp, "blocked_by");
  return rows.filter((r) => {
    if (reason && reason !== "all" && r.decision.reason !== reason) {
      return false;
    }
    if (urlMatchFilter && urlMatchFilter !== "all") {
      if (urlMatchFilter === "ready" && r.urlMatch !== "✓") return false;
      if (urlMatchFilter === "mismatch" && r.urlMatch !== "⚠") return false;
      if (urlMatchFilter === "missing" && r.urlMatch !== "✗") return false;
    }
    if (
      statusFilter &&
      statusFilter !== "all" &&
      r.edit.implementation_status !== statusFilter
    ) {
      return false;
    }
    if (blockedByFilter && blockedByFilter !== "all") {
      const bucket = blockedByBucket(r.decision.blocked_by);
      if (bucket !== blockedByFilter) return false;
    }
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Server component
// ─────────────────────────────────────────────────────────────────────

export default async function LifecycleEligibilityDiagnosticPage(
  props: {
    searchParams?: Promise<SearchParams>;
  } = {},
) {
  if (!isAccessAllowed()) {
    notFound();
  }

  const sp: SearchParams =
    (await (props.searchParams ?? Promise.resolve({}))) ?? {};

  const tenantId = await currentTenantId();
  const now = new Date();

  const repo = getRepository().forTenant(tenantId);
  const [edits, snapshots, responses] = await Promise.all([
    repo.getRecommendedEdits(),
    repo.getPageSnapshots(),
    // Tenant-scoped recommendation_responses rollup. We MUST load the
    // full tenant response set (not iterate by rec_id derived from
    // edits) because the response counters represent operator-level
    // activity — including accepted/dismissed/deferred recs that
    // never produced typed `recommended_edits` rows (e.g., create-
    // page recs, regenerate recs, review_decision recs, or specific-
    // edit abstentions). Filtering by typed-edit lineage would hide
    // exactly the funnel signal this diagnostic exists to expose.
    repo.getRecommendationResponses(),
  ]);

  // Per-row JOIN uses the same dataset (no additional store call).
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

  // Build rows for table render. Combine edit + decision + response
  // + url-match token (pre-computed once so filter + render share
  // the same data).
  type Row = {
    edit: RecommendedEditRow;
    decision: PerRowEligibility;
    response: ReturnType<typeof responsesByRecId.get>;
    urlMatch: UrlMatchToken;
  };
  const rows: Row[] = edits.map((edit, i) => {
    const decision = perRowDecisions[i]!;
    const urlMatch = deriveUrlMatch({
      targetUrl: edit.target_url,
      snapshotIndex,
    });
    return {
      edit,
      decision,
      response: responsesByRecId.get(edit.rec_id),
      urlMatch,
    };
  });
  rows.sort(
    (a, b) =>
      REASON_SEVERITY[a.decision.reason] - REASON_SEVERITY[b.decision.reason],
  );

  // Reason-distribution counters — computed from the UNFILTERED row
  // set so the chip tallies stay stable as the operator drills in.
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

  // Apply server-side filters AFTER tenant-scoped reads. The
  // displayed table draws from `filteredRows`; the funnel-counter
  // tiles + reason-distribution chips ALWAYS draw from the
  // unfiltered set (so the operator can see the global funnel + the
  // filtered subset in one view).
  const filteredRows = applyFilters(rows, sp);

  // Active filter values for the chip rendering.
  const activeReason = readParam(sp, "reason");
  const activeUrlMatch = readParam(sp, "url_match");
  const activeStatus = readParam(sp, "status");
  const activeBlockedBy = readParam(sp, "blocked_by");
  const anyFilterActive =
    (activeReason && activeReason !== "all") ||
    (activeUrlMatch && activeUrlMatch !== "all") ||
    (activeStatus && activeStatus !== "all") ||
    (activeBlockedBy && activeBlockedBy !== "all");

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

      {/* ── Reason distribution + active filter ──────────────────
         Reason-tally chips now double as filter links. The
         `data-reason-tally` attribute is preserved for existing
         render assertions; each chip wraps in a Next <Link> so the
         operator can narrow the row table to one reason class with
         a single click. Tallies remain computed from the UNFILTERED
         row set so the operator sees the full funnel context even
         while the table below is narrowed. */}
      <section
        className="flex flex-wrap gap-2"
        data-diagnostics-section="reason-distribution"
      >
        {ALL_REASONS.map((r) => {
          const isActive = activeReason === r;
          return (
            <Link
              key={r}
              href={`/diagnostics/lifecycle-eligibility?reason=${r}`}
              prefetch={false}
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${REASON_TONE[r]} ${
                isActive ? "ring-2 ring-foreground/40" : ""
              }`}
              data-reason-tally={r}
              data-diagnostics-chip={`reason=${r}`}
              data-diagnostics-chip-active={isActive ? "true" : "false"}
            >
              <span className="tabular-nums">{reasonDistribution[r]}</span>
              <span className="font-mono">{r}</span>
            </Link>
          );
        })}
      </section>

      {/* ── Filter chips (url_match · status · blocked_by) ───────
         Server-rendered. Pure <Link> elements with searchParams —
         no client JS. Filter applies AFTER tenant-scoped reads on a
         pure in-memory row set; no extra repository calls per
         filter. Default = no filter = all rows. */}
      <FilterChips
        activeReason={activeReason}
        activeUrlMatch={activeUrlMatch}
        activeStatus={activeStatus}
        activeBlockedBy={activeBlockedBy}
        anyFilterActive={!!anyFilterActive}
      />

      {/* ── Per-row table ───────────────────────────────────────── */}
      <section
        className="rounded-md border border-border/60 bg-surface-base overflow-x-auto"
        data-diagnostics-section="row-table"
        data-diagnostics-row-count={filteredRows.length}
      >
        {filteredRows.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">
            {rows.length === 0
              ? "No recommended_edits rows for this tenant."
              : "No rows match the current filters."}
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
              {filteredRows.map((r) => (
                <RowDisplay key={r.edit.id} row={r} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FilterChips sub-section
// ─────────────────────────────────────────────────────────────────────

function FilterChips(props: {
  activeReason: string | null;
  activeUrlMatch: string | null;
  activeStatus: string | null;
  activeBlockedBy: string | null;
  anyFilterActive: boolean;
}) {
  const urlMatchOptions: ReadonlyArray<{
    value: string;
    label: string;
  }> = [
    { value: "all", label: "all" },
    { value: "ready", label: "url_match=ready" },
    { value: "mismatch", label: "url_match=mismatch" },
    { value: "missing", label: "url_match=missing" },
  ];
  const statusOptions: ReadonlyArray<{
    value: string;
    label: string;
  }> = [
    { value: "all", label: "all" },
    { value: "recommended", label: "status=recommended" },
    { value: "accepted", label: "status=accepted" },
    { value: "verified_live", label: "status=verified_live" },
    { value: "verified_live_modified", label: "status=verified_live_modified" },
    { value: "partially_implemented", label: "status=partially_implemented" },
    { value: "dismissed", label: "status=dismissed" },
    { value: "wrong_page", label: "status=wrong_page" },
    { value: "needs_review", label: "status=needs_review" },
    { value: "not_found_after_7d", label: "status=not_found_after_7d" },
  ];
  const blockedByOptions: ReadonlyArray<{
    value: string;
    label: string;
  }> = [
    { value: "all", label: "all" },
    { value: "operator", label: "blocked_by=operator" },
    { value: "system", label: "blocked_by=system" },
    { value: "terminal", label: "blocked_by=terminal" },
  ];
  return (
    <section
      className="flex flex-col gap-2 text-[11.5px]"
      data-diagnostics-section="filter-chips"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground w-24 shrink-0">clear:</span>
        <ChipLink
          href="/diagnostics/lifecycle-eligibility"
          active={!props.anyFilterActive}
          label="all filters off"
          dataAttr="clear"
        />
      </div>
      <ChipRow
        dimension="url_match"
        active={props.activeUrlMatch}
        options={urlMatchOptions}
      />
      <ChipRow
        dimension="status"
        active={props.activeStatus}
        options={statusOptions}
      />
      <ChipRow
        dimension="blocked_by"
        active={props.activeBlockedBy}
        options={blockedByOptions}
      />
    </section>
  );
}

function ChipRow(props: {
  dimension: "url_match" | "status" | "blocked_by";
  active: string | null;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-diagnostics-chip-row={props.dimension}
    >
      <span className="text-muted-foreground w-24 shrink-0">
        {props.dimension}:
      </span>
      {props.options.map((opt) => {
        const isActive =
          opt.value === "all"
            ? props.active == null || props.active === "all"
            : props.active === opt.value;
        const href =
          opt.value === "all"
            ? `/diagnostics/lifecycle-eligibility`
            : `/diagnostics/lifecycle-eligibility?${props.dimension}=${opt.value}`;
        return (
          <ChipLink
            key={opt.value}
            href={href}
            active={isActive}
            label={opt.label}
            dataAttr={
              opt.value === "all"
                ? `${props.dimension}=all`
                : `${props.dimension}=${opt.value}`
            }
          />
        );
      })}
    </div>
  );
}

function ChipLink(props: {
  href: string;
  active: boolean;
  label: string;
  dataAttr: string;
}) {
  return (
    <Link
      href={props.href}
      prefetch={false}
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono ${
        props.active
          ? "bg-foreground text-background"
          : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
      }`}
      data-diagnostics-chip={props.dataAttr}
      data-diagnostics-chip-active={props.active ? "true" : "false"}
    >
      {props.label}
    </Link>
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
}: {
  row: {
    edit: RecommendedEditRow;
    decision: PerRowEligibility;
    response: ReturnType<Map<string, unknown>["get"]> | undefined;
    urlMatch: UrlMatchToken;
  };
}) {
  const { edit, decision, urlMatch } = row;
  const idTail = edit.id.length > 16 ? edit.id.slice(-16) : edit.id;

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
