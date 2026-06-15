"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { isOperatorModeClient } from "@/lib/operator-mode";

/**
 * Demo-path fix (2026-05-06): the recommendations drawer historically
 * rendered a "Debug details" block listing raw DB-shape strings
 * (rec_id, edit_id, resolver_tier, evidence_hash, engine_confidence,
 * etc.) plus row-level UUID data-attributes (`data-rec-source-rec-id`).
 * Those leak schema vocabulary + UUIDs into customer-visible HTML even
 * when the `<details>` is collapsed (DOM is still inspectable).
 *
 * Gating contract:
 *   - Production / customer mode (NODE_ENV=production, no operator
 *     env): debug block hidden; UUID data-attrs stripped.
 *   - Operator mode (`NEXT_PUBLIC_OPERATOR_MODE=true`): full debug
 *     surface restored — operator can still inspect the queue.
 *   - Test environment (NODE_ENV=test): debug surface restored so
 *     existing snapshot/assertion tests continue to work without
 *     env plumbing.
 */
const OPERATOR_MODE_DEBUG: boolean = isOperatorModeClient();
import {
  acceptRecommendation,
  deferRecommendation,
  dismissRecommendation,
  markRecommendationShipped,
  undoRecommendationResponse,
  type RecommendationActionPayload,
  type RecommendationActionResponse,
} from "./actions";
import type {
  RecommendationQueueRow,
  RecommendationWatchRow,
} from "./page";
import {
  buildRecommendationActionRows,
  ACTION_ROW_TYPE_LABEL,
  ACTION_ROW_PRIORITY_LABEL,
  ACTION_ROW_STATUS_LABEL,
  type ActionRowType,
  type ActionRowStatus,
  type ActionRowPriority,
  type RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";
import {
  isIndexingDirectiveActionType,
  INDEXING_DIRECTIVE_CAVEAT,
} from "@/domains/recommendations/action-types";
import { sanitizeOperatorEvidenceText } from "@/domains/recommendations/copy-sanitize";
import { checkWhyDisplaySafe } from "@/domains/recommendations/why-display-guard";
import { changeLinkHrefForRow } from "@/domains/recommendations/changelog-link";
import { RecommendationEvidencePanel } from "@/components/recommendations/recommendation-evidence-panel";
import { WhyRankedHere } from "@/components/recommendations/why-ranked-here";
import {
  ExecutiveStrip,
  buildExecutiveStripData,
  type ExecutiveStripRow,
} from "@/components/recommendations/executive-strip";

type Props = {
  queue: RecommendationQueueRow[];
  watchlist: RecommendationWatchRow[];
  matrixDate: string;
  /** Step 1.1 (master plan) — lookup so the drawer's evidence
   *  section can render a prompt-text snippet instead of the raw
   *  UUID. */
  promptTextById: Record<string, string>;
  /** 2026-05-10 — recommendation stableKey → changelog entry id.
   *  Drives the inline "Open this change →" link on accepted/measuring/
   *  shipped rows. Optional; missing entry → no link rendered (calm
   *  fallback). Built server-side from changelog_entries.source_rec_id. */
  changelogIdByRecId?: Record<string, string>;
  /** Slice 4.5.G-B.1 — active tracked-entity competitor names for the
   *  render-time `why`-display guard inside the legacy drawer. Optional;
   *  UUID + long-hex + internal-token detection still fires when empty. */
  competitorNames?: ReadonlyArray<string>;
};

/**
 * W3 Step 3.5e (2026-05-03) — Recommendations as a ranked action
 * table.
 *
 * Operator scope (browser audit, fourth pass): /recommendations is a
 * RANKED ACTION TABLE — not a card dashboard, not a lifecycle
 * dashboard, not an evidence feed. Each row is ONE concrete website
 * task ("Add an architect-led design-build H2 to the Whole Home
 * Remodel page"), HubSpot/Jira-style.
 *
 * The page renders three regions:
 *   1. Toolbar — search + type filter + status filter + summary +
 *      last-refreshed.
 *   2. Table — Rank · Recommended action · Target · Type · Priority
 *      · Status · Evidence · Action button.
 *   3. Watchlist (existing winning clusters) — passive, below table.
 *
 * Clicking a row toggles a drawer beneath it with: exact recommended
 * change (before/after copy or page brief), why Beacon recommends
 * it, evidence (affected prompts / observations / top competitor),
 * measurement plan, and a collapsed Debug block (raw IDs / evidence
 * hash / resolver tier / token-match diagnostics).
 *
 * Default table NEVER shows: confidence-reason paragraphs, "site
 * inventory shows", "label tokens", "fragmented", "Weak signal",
 * raw prompt IDs, or full evidence JSON. Internal taxonomy lives on
 * `data-rec-*` attributes for tests + diagnostics.
 */
export function RecommendationsClient({
  queue,
  watchlist,
  matrixDate,
  promptTextById,
  changelogIdByRecId = {},
  competitorNames,
}: Props) {
  const allRows = useMemo(
    () => buildRecommendationActionRows({ queue, promptTextById }),
    [queue, promptTextById],
  );

  const [search, setSearch] = useState("");
  // 2026-05-06 demo-path Phase 3-bis fix 1+2 — filter state holds the
  // public option key (e.g. "page", "regenerate"), NOT the raw schema
  // enum. TYPE_VALUE_TO_ENUM / STATUS_VALUE_TO_ENUM translate to the
  // enum for the equality check. Default value "all" remains unchanged.
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    rowId: string;
    message: string;
    isError: boolean;
  } | null>(null);

  const filteredRows = useMemo(
    () =>
      allRows.filter((row) => {
        if (typeFilter !== "all") {
          const targetType = TYPE_VALUE_TO_ENUM[typeFilter];
          if (!targetType || row.actionType !== targetType) return false;
        }
        if (statusFilter !== "all") {
          const targetStatus = STATUS_VALUE_TO_ENUM[statusFilter];
          if (!targetStatus || row.status !== targetStatus) return false;
        }
        const q = search.trim().toLowerCase();
        if (q.length === 0) return true;
        const haystack =
          `${row.title} ${row.targetLabel} ${ACTION_ROW_TYPE_LABEL[row.actionType]} ${row.evidenceSummary}`.toLowerCase();
        return haystack.includes(q);
      }),
    [allRows, typeFilter, statusFilter, search],
  );

  const summary = useMemo(() => buildSummary(allRows), [allRows]);

  // #350 — whether any filter is narrowing the table. Drives the
  // "Clear filters" affordance in the empty-filtered state so the user
  // is never stuck on "No actions match your filters" with no escape.
  const hasActiveFilters =
    typeFilter !== "all" || statusFilter !== "all" || search.trim().length > 0;
  const clearFilters = () => {
    setTypeFilter("all");
    setStatusFilter("all");
    setSearch("");
  };

  // #348 — Escape closes the open per-row detail drawer (the existing
  // backdrop/row-click toggle still works). Listener is installed ONLY
  // while a drawer is open, fires only on a bare Escape (no modifiers),
  // and never collides with the global ⌘K / ? / g-nav handlers (none of
  // those consume Escape). On close, focus returns to the row's Details
  // chevron so keyboard users aren't dropped to the top of the document.
  useEffect(() => {
    if (expandedId == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const openId = expandedId;
      setExpandedId(null);
      e.stopPropagation();
      // Restore focus to the trigger chevron inside the row we closed.
      if (openId != null) {
        const row = document.getElementById(
          `action-row-${encodeURIComponent(openId)}`,
        );
        const trigger = row?.querySelector<HTMLElement>(
          '[data-rec-details-button="true"]',
        );
        trigger?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

  // UX.3 (2026-05-07) — Executive Strip data: project rows into the
  // strip's minimal shape, then derive top-pick + evidence
  // distribution. Pure compute over already-loaded rows.
  const stripRows: ExecutiveStripRow[] = useMemo(
    () =>
      allRows.map((r) => ({
        id: r.id,
        title: r.title,
        targetLabel: r.targetLabel,
        derived: r.derivedConfidence,
        rank: r.rank,
        status: r.status,
      })),
    [allRows],
  );
  const { evidence: stripEvidence, topPick: stripTopPick } = useMemo(
    () => buildExecutiveStripData(stripRows),
    [stripRows],
  );

  // EGRESS-P0 (2026-05-07) — kill switch for the Executive Strip.
  // Set NEXT_PUBLIC_BEACON_RECOMMENDATIONS_STRIP_ENABLED=false to hide
  // the strip without a redeploy of the table. Defense-in-depth even
  // though the strip is pure-render over already-loaded `allRows`
  // (no new data fetch). Default: enabled.
  const stripEnabled =
    process.env.NEXT_PUBLIC_BEACON_RECOMMENDATIONS_STRIP_ENABLED !== "false";

  return (
    <>
      {stripEnabled ? (
        <ExecutiveStrip
          rows={stripRows}
          topPick={stripTopPick}
          evidence={stripEvidence}
        />
      ) : null}
      <Toolbar
        search={search}
        onSearchChange={setSearch}
        typeFilter={typeFilter}
        onTypeChange={setTypeFilter}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        summary={summary}
        matrixDate={matrixDate}
      />

      {filteredRows.length === 0 ? (
        <EmptyTable
          hasAnyRows={allRows.length > 0}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
        />
      ) : (
        <ActionTable
          rows={filteredRows}
          expandedId={expandedId}
          onToggleExpand={(id) =>
            setExpandedId((prev) => (prev === id ? null : id))
          }
          feedback={feedback}
          setFeedback={setFeedback}
          promptTextById={promptTextById}
          changelogIdByRecId={changelogIdByRecId}
          competitorNames={competitorNames}
        />
      )}

      {watchlist.length > 0 && <WatchSection rows={watchlist} />}
    </>
  );
}

/* ── Toolbar (search + filters + summary) ───────────────────────────── */

type SummaryShape = {
  total: number;
  byStatus: Record<ActionRowStatus, number>;
};

function buildSummary(rows: RecommendationActionRow[]): SummaryShape {
  const byStatus: Record<ActionRowStatus, number> = {
    new: 0,
    accepted: 0,
    shipped: 0,
    measuring: 0,
    needs_review: 0,
    needs_fresh_edit: 0,
    dismissed: 0,
    deferred: 0,
  };
  for (const r of rows) {
    byStatus[r.status] += 1;
  }
  return { total: rows.length, byStatus };
}

/**
 * 2026-05-06 demo-path Phase 3-bis fix 1 — filter dropdown values
 * are no longer raw schema enums. Pre-fix: <option value="add_internal_links">,
 * <option value="regenerate_edit"> etc. leaked the underlying taxonomy
 * via View Source / DevTools. Post-fix: option values are short
 * single-word product-vocabulary keys ("links", "regenerate", ...);
 * a TYPE_VALUE_TO_ENUM map translates back to the raw `ActionRowType`
 * for the equality comparison. Customer-mode HTML now contains only
 * the labels + the friendly keys.
 */
const TYPE_FILTER_OPTIONS: Array<{
  value: string;
  label: string;
  enum: ActionRowType | null;
}> = [
  { value: "all", label: "All types", enum: null },
  { value: "page", label: "Page", enum: "create_page" },
  { value: "title", label: "Title", enum: "edit_title" },
  { value: "meta", label: "Meta", enum: "edit_meta" },
  { value: "h1", label: "H1", enum: "edit_h1" },
  { value: "h2", label: "H2", enum: "edit_h2" },
  { value: "section", label: "Section", enum: "add_section" },
  { value: "copy", label: "Copy", enum: "improve_copy" },
  { value: "faq", label: "FAQ", enum: "add_faq" },
  { value: "schema", label: "Schema", enum: "add_schema" },
  { value: "links", label: "Links", enum: "add_internal_links" },
  { value: "table", label: "Table", enum: "add_comparison_table" },
  { value: "technical", label: "Technical", enum: "technical_fix" },
  { value: "review", label: "Review", enum: "review_decision" },
  { value: "regenerate", label: "Regenerate", enum: "regenerate_edit" },
];
const TYPE_VALUE_TO_ENUM: Record<string, ActionRowType | null> =
  Object.fromEntries(TYPE_FILTER_OPTIONS.map((o) => [o.value, o.enum]));

/**
 * 2026-05-06 demo-path Phase 3-bis fix 2 — `needs_fresh_edit` is renamed
 * to "Needs new recommendation" in the dropdown label and the row pill;
 * the public filter value is "regenerate" (clean key, not a schema enum).
 * The internal `ActionRowStatus` enum keeps `needs_fresh_edit` for backwards
 * compat — only the customer-visible surfaces change.
 */
const STATUS_FILTER_OPTIONS: Array<{
  value: string;
  label: string;
  enum: ActionRowStatus | null;
}> = [
  { value: "all", label: "All statuses", enum: null },
  { value: "new", label: "New", enum: "new" },
  { value: "accepted", label: "Accepted", enum: "accepted" },
  { value: "measuring", label: "Measuring", enum: "measuring" },
  { value: "shipped", label: "Shipped", enum: "shipped" },
  { value: "review", label: "Needs review", enum: "needs_review" },
  { value: "regenerate", label: "Needs new recommendation", enum: "needs_fresh_edit" },
  { value: "deferred", label: "Deferred", enum: "deferred" },
  { value: "dismissed", label: "Dismissed", enum: "dismissed" },
];
const STATUS_VALUE_TO_ENUM: Record<string, ActionRowStatus | null> =
  Object.fromEntries(STATUS_FILTER_OPTIONS.map((o) => [o.value, o.enum]));

function Toolbar({
  search,
  onSearchChange,
  typeFilter,
  onTypeChange,
  statusFilter,
  onStatusChange,
  summary,
  matrixDate,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  // 2026-05-06 — filter state is the public option key string
  // ("all" | "page" | "regenerate" etc.), not the raw schema enum.
  typeFilter: string;
  onTypeChange: (v: string) => void;
  statusFilter: string;
  onStatusChange: (v: string) => void;
  summary: SummaryShape;
  matrixDate: string;
}) {
  const newCount = summary.byStatus.new;
  const trackingCount = summary.byStatus.accepted + summary.byStatus.measuring;
  const reviewCount =
    summary.byStatus.needs_review + summary.byStatus.needs_fresh_edit;
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search actions, pages, or evidence…"
          className="flex-1 min-w-[220px] rounded border border-border/60 bg-background px-3 py-1.5 text-[12px] focus:outline-none focus:border-accent-primary"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          data-recommendations-search="true"
        />
        <select
          className="rounded border border-border/60 bg-background px-2 py-1.5 text-[12px] focus:outline-none focus:border-accent-primary"
          value={typeFilter}
          onChange={(e) => onTypeChange(e.target.value)}
          data-recommendations-type-filter="true"
        >
          {TYPE_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-border/60 bg-background px-2 py-1.5 text-[12px] focus:outline-none focus:border-accent-primary"
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          data-recommendations-status-filter="true"
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-3 text-[11px] text-muted-foreground">
        <p data-recommendations-summary="true" className="font-medium text-foreground">
          {summary.total} action{summary.total === 1 ? "" : "s"}
          <span className="ml-2 font-normal text-muted-foreground">
            · {newCount} new · {trackingCount} tracking
            {reviewCount > 0 ? ` · ${reviewCount} need review` : ""}
          </span>
        </p>
        <p>Last refreshed: {matrixDate}</p>
      </div>
      {/* W3 §3.5g — subtle helper line. Tells the operator what an
          accept does in one sentence so the Action column buttons
          read intuitively. */}
      <p
        className="text-[11px] text-muted-foreground/80 leading-relaxed"
        data-recommendations-helper="true"
      >
        Accepting a task starts tracking its impact on AI visibility.
      </p>
    </div>
  );
}

/* ── Action table ────────────────────────────────────────────────────── */

/**
 * UX.5B.2 (2026-05-07) — Top-pick selector for the in-table emphasis.
 * Mirrors `buildExecutiveStripData`'s logic so the strip's "Top
 * opportunity" card and the table's elevated row always agree on
 * which row is the headline pick.
 *
 * Rules: lowest rank among PENDING (non-terminal) rows whose derived
 * confidence is NOT "needs_review". Falls back to the top needs_review
 * if no strong/moderate exists. Returns null on empty.
 */
function selectTopPickId(rows: ReadonlyArray<RecommendationActionRow>): string | null {
  const TERMINAL = new Set<ActionRowStatus>([
    "shipped",
    "dismissed",
    "deferred",
    "measuring",
  ]);
  const pending = rows.filter((r) => !TERMINAL.has(r.status));
  if (pending.length === 0) return null;
  const sorted = [...pending].sort((a, b) => a.rank - b.rank);
  const headline =
    sorted.find((r) => r.derivedConfidence !== "needs_review") ??
    sorted[0] ??
    null;
  return headline?.id ?? null;
}

function ActionTable({
  rows,
  expandedId,
  onToggleExpand,
  feedback,
  setFeedback,
  promptTextById,
  changelogIdByRecId,
  competitorNames,
}: {
  rows: RecommendationActionRow[];
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  feedback: {
    rowId: string;
    message: string;
    isError: boolean;
  } | null;
  setFeedback: (
    f: { rowId: string; message: string; isError: boolean } | null,
  ) => void;
  promptTextById: Record<string, string>;
  changelogIdByRecId: Record<string, string>;
  /** Slice 4.5.G-B.1 — competitor names threaded to the per-row
   *  drawer for `why` render guard. */
  competitorNames?: ReadonlyArray<string>;
}) {
  const topPickId = useMemo(() => selectTopPickId(rows), [rows]);
  return (
    <div className="overflow-x-auto rounded-md border border-border/50 bg-background">
      <table
        className="w-full text-left text-[12px]"
        data-recommendations-action-table="true"
      >
        <thead className="bg-surface-inset/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 w-8 text-right">#</th>
            <th className="px-2 py-1.5">Recommended action</th>
            <th className="px-2 py-1.5 hidden md:table-cell">Target</th>
            <th className="px-2 py-1.5 w-[68px]">Type</th>
            <th className="px-2 py-1.5 w-[72px]">Priority</th>
            <th className="px-2 py-1.5 w-[110px]">Status</th>
            <th className="px-2 py-1.5 hidden lg:table-cell">Evidence</th>
            <th className="px-2 py-1.5 w-[120px] text-right">Action</th>
            <th
              className="px-2 py-1.5 w-[40px] text-right"
              aria-label="Details"
            >
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map((row) => (
            <ActionRow
              key={row.id}
              row={row}
              isTopPick={row.id === topPickId}
              expanded={expandedId === row.id}
              onToggleExpand={() => onToggleExpand(row.id)}
              feedback={feedback}
              setFeedback={setFeedback}
              promptTextById={promptTextById}
              changelogIdByRecId={changelogIdByRecId}
              competitorNames={competitorNames}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Single action row + drawer ─────────────────────────────────────── */

function ActionRow({
  row,
  isTopPick = false,
  expanded,
  onToggleExpand,
  feedback,
  setFeedback,
  promptTextById,
  changelogIdByRecId,
  competitorNames,
}: {
  row: RecommendationActionRow;
  /** UX.5B.2 (2026-05-07) — true when this is the highest-priority
   *  pending row with strong/moderate evidence (or the top-ranked
   *  needs_review row when no other pending exists). The strip's
   *  "Top opportunity" card and this row stay in lockstep. */
  isTopPick?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  feedback: {
    rowId: string;
    message: string;
    isError: boolean;
  } | null;
  setFeedback: (
    f: { rowId: string; message: string; isError: boolean } | null,
  ) => void;
  promptTextById: Record<string, string>;
  /** 2026-05-10 — rec→changelog link map for the inline "Open this
   *  change →" CTA. Empty when not provided (no link rendered). */
  changelogIdByRecId: Record<string, string>;
  /** Slice 4.5.G-B.1 — competitor names threaded to the drawer's
   *  `why`-display guard. */
  competitorNames?: ReadonlyArray<string>;
}) {
  const [pending, startTransition] = useTransition();
  const showFeedback = feedback && feedback.rowId === row.id;

  function handle(
    action: () => Promise<RecommendationActionResponse>,
    successMsg: string,
  ) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (res.success) {
          setFeedback({
            rowId: row.id,
            message: res.changeId
              ? `${successMsg} — changelog entry created (${res.changeId}).`
              : successMsg,
            isError: false,
          });
        } else {
          // #304 — surface the action's ACTUAL error when it returns one
          // (the server action populates `error`); only fall back to a
          // generic-but-actionable line when no detail is available.
          setFeedback({
            rowId: row.id,
            message:
              res.error ??
              "Something went wrong — please try again, or refresh your connected data.",
            isError: true,
          });
        }
      } catch (e) {
        setFeedback({
          rowId: row.id,
          message: `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
          isError: true,
        });
      }
    });
  }

  // Build the rec payload only when needed (Accept / Promote actions).
  // The action-row carries enough data; the row's `sourceRecommendationId`
  // is the rec stableKey.
  const recPayload: RecommendationActionPayload = {
    stableKey: row.sourceRecommendationId,
    type: "create_cluster_page", // placeholder — server reads canonical from store
    title: row.title,
    description: row.evidenceSummary,
    clusterLabel: null,
    clusterKind: null,
  };

  return (
    <>
      <tr
        id={`action-row-${encodeURIComponent(row.id)}`}
        className={cn(
          "hover:bg-surface-inset/30 transition-colors",
          expanded && "bg-surface-inset/40",
          row.responseStatus === "dismissed" && "opacity-60",
          row.responseStatus === "deferred" && "opacity-80",
          // UX.5B.2 (2026-05-07) — subtle elevation on the top pick.
          // 4px accent on the left edge + a hair of background tint.
          // Intentionally mild — this is hierarchy, not a banner.
          isTopPick &&
            "bg-accent-primary/[0.04] border-l-[3px] border-l-accent-primary/60",
        )}
        data-rec-row-id={row.id}
        data-rec-action-row-type={row.actionType}
        data-rec-priority={row.priority}
        data-rec-status={row.status}
        data-rec-top-pick={isTopPick ? "true" : undefined}
        // 2026-05-06 demo-path fix: source-rec-id + source-edit-id are
        // UUIDs; in customer mode they leak as `data-rec-source-rec-id="<uuid>"`
        // attributes inspectable via DevTools / view-source. Strip them in
        // customer mode; keep in operator mode + tests.
        {...(OPERATOR_MODE_DEBUG
          ? {
              "data-rec-source-rec-id": row.sourceRecommendationId,
              "data-rec-source-edit-id": row.sourceEditId ?? "",
            }
          : {})}
        data-rec-rank={row.rank}
      >
        <td className="px-2 py-2 text-right text-muted-foreground tabular-nums align-top">
          {row.rank}
        </td>
        <td className="px-2 py-2 align-top">
          <button
            type="button"
            onClick={onToggleExpand}
            className="text-left w-full text-foreground hover:text-accent-primary transition-colors"
            data-rec-row-toggle="true"
            aria-expanded={expanded}
          >
            {/* UX.5B.2 (2026-05-07) — "Top pick" chip on the
                highest-priority pending row with strong/moderate
                evidence. Subtle accent color, small size; hierarchy
                cue, not a banner. */}
            {isTopPick ? (
              <span
                className="inline-block whitespace-nowrap rounded border border-accent-primary/40 bg-accent-primary/[0.08] text-accent-primary text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 mr-1.5 align-middle"
                data-rec-top-pick-chip="true"
                title="Beacon's top pick today — highest evidence + strongest impact in the queue."
              >
                Top pick
              </span>
            ) : null}
            <span className="font-medium leading-snug">{row.title}</span>
            {/*
              Round 1 customer-readiness (2026-05-05) — render the AI
              source + engine-confidence pills directly under the
              row title. No extra table column (preserves the existing
              grid layout); pills wrap naturally on narrow viewports.
              Pills are conditional and render `null` when their data
              is absent (deterministic rows, missing engineConfidence).
            */}
            {(row.editSource || row.engineConfidence || row.derivedConfidence) && (
              <span
                className="mt-1 flex flex-wrap gap-1"
                data-rec-row-pillstrip="true"
              >
                <AIPill source={row.editSource} />
                {/* T4.4 (2026-05-06) — replaces the legacy "Medium
                    confidence" pill (which read the same on every
                    production row) with a customer-safe label derived
                    from evidence quality. The legacy engine-confidence
                    pill stays available behind operator mode. */}
                <DerivedConfidencePill derived={row.derivedConfidence} />
                {OPERATOR_MODE_DEBUG && (
                  <ConfidencePill confidence={row.engineConfidence} />
                )}
              </span>
            )}
            {/* UX.5B.3 (2026-05-07) — needs-more-evidence row polish.
                Reframes the row as a watch state rather than a failure.
                Microcopy renders inline (subtle, muted) under the pill
                strip; the full evidence breakdown still lives in the
                drawer when the operator opens it. */}
            {row.derivedConfidence === "needs_review" ? (
              <span
                className="mt-1 block text-[11px] leading-relaxed text-muted-foreground/85 italic"
                data-rec-needs-more-evidence-microcopy="true"
              >
                Worth a look — based on limited data so far. Optional.
              </span>
            ) : null}
          </button>
        </td>
        <td className="px-2 py-2 align-top hidden md:table-cell">
          <TargetLink
            label={row.targetLabel}
            url={row.targetUrl}
          />
        </td>
        <td className="px-2 py-2 align-top">
          <TypePill actionType={row.actionType} />
        </td>
        <td className="px-2 py-2 align-top">
          <PriorityPill priority={row.priority} />
        </td>
        <td className="px-2 py-2 align-top">
          <StatusPill status={row.status} />
        </td>
        <td className="px-2 py-2 align-top hidden lg:table-cell text-muted-foreground">
          <span
            className="line-clamp-2 leading-snug"
            data-recommendations-evidence-summary="true"
          >
            {row.evidenceSummary}
          </span>
        </td>
        <td className="px-2 py-2 align-top text-right">
          <div className="flex flex-col items-end gap-1">
            <RowActionButton
              row={row}
              pending={pending}
              handle={handle}
              recPayload={recPayload}
              onOpenDetails={onToggleExpand}
            />
            {/* 2026-05-10 — inline rec→/changes/[id] link. Renders
                only when the row is accepted AND a changelog entry
                exists with source_rec_id matching this rec. Resolver
                returns null in every other case (calm fallback —
                never a broken link). Same operator-locked CTA copy
                used on /today's LiveChangesBlock + /changes scorecard
                expansion ("Open this change →"). */}
            {(() => {
              const href = changeLinkHrefForRow(
                {
                  sourceRecommendationId: row.sourceRecommendationId,
                  responseStatus: row.responseStatus,
                  status: row.status,
                },
                changelogIdByRecId,
              );
              if (!href) return null;
              return (
                <Link
                  href={href}
                  prefetch={false}
                  className="text-[10px] font-medium text-accent-primary hover:underline"
                  data-rec-row-change-link="true"
                >
                  Open this change →
                </Link>
              );
            })()}
          </div>
        </td>
        <td className="px-2 py-2 align-top text-right">
          {/* Visible Details affordance (W3 §3.5g): chevron only.
              Operator scope: avoid duplicate-feeling Action +
              Details labels. The Action column carries the verb
              (Accept / Review / View / etc.); the chevron is a
              visually secondary "open drawer" tap target. */}
          <button
            type="button"
            onClick={onToggleExpand}
            className={cn(
              "inline-flex items-center justify-center w-6 h-6 rounded text-[12px] text-muted-foreground/70 hover:text-foreground hover:bg-surface-inset/50 transition-colors",
              expanded && "text-foreground bg-surface-inset/40",
            )}
            data-rec-details-button="true"
            aria-expanded={expanded}
            aria-label={expanded ? "Hide details" : "Show details"}
            title={expanded ? "Hide details" : "Show details"}
          >
            <span
              className={cn(
                "inline-block transition-transform",
                expanded && "rotate-90",
              )}
              aria-hidden="true"
            >
              ▸
            </span>
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-surface-inset/20">
          <td colSpan={9} className="px-3 py-3" data-rec-row-drawer="true">
            <RowDrawer
              row={row}
              promptTextById={promptTextById}
              showFeedback={showFeedback}
              feedback={feedback}
              pending={pending}
              handle={handle}
              competitorNames={competitorNames}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Pills (type / priority / status) ───────────────────────────────── */

function TypePill({ actionType }: { actionType: ActionRowType }) {
  // W3 §3.5g — operator-locked compact labels per type. The 3.5f
  // version replaced create_page with a "—" placeholder; operator
  // browser audit flagged that as confusing ("Page-creation rows
  // show Type = blank/dash"). Restored to "Page" — short, single-
  // line, never wraps thanks to whitespace-nowrap.
  // W3 §3.11 (2026-05-04) — H1 + Table land as distinct labels per
  // operator-locked planner taxonomy.
  const COMPACT_LABEL: Record<ActionRowType, string> = {
    create_page: "Page",
    edit_h1: "H1",
    edit_h2: "H2",
    edit_title: "Title",
    edit_meta: "Meta",
    add_schema: "Schema",
    add_faq: "FAQ",
    add_section: "Section",
    improve_copy: "Copy",
    add_internal_links: "Links",
    add_comparison_table: "Table",
    technical_fix: "Technical",
    review_decision: "Review",
    regenerate_edit: "Regenerate",
  };
  return (
    <span
      className="inline-block whitespace-nowrap rounded border border-accent-primary/30 bg-accent-primary/[0.05] text-accent-primary text-[10px] font-medium px-1.5 py-0.5"
      data-rec-type-pill={actionType}
    >
      {COMPACT_LABEL[actionType]}
    </span>
  );
}

const PRIORITY_PILL_CLASS: Record<ActionRowPriority, string> = {
  high: "border-status-danger/40 bg-status-danger/[0.06] text-status-danger",
  medium: "border-status-warning/40 bg-status-warning/[0.06] text-status-warning",
  low: "border-border/60 text-muted-foreground",
};

function PriorityPill({ priority }: { priority: ActionRowPriority }) {
  return (
    <span
      className={cn(
        "inline-block rounded border text-[10px] font-medium px-1.5 py-0.5",
        PRIORITY_PILL_CLASS[priority],
      )}
      data-rec-priority-pill={priority}
    >
      {ACTION_ROW_PRIORITY_LABEL[priority]}
    </span>
  );
}

/**
 * Round 2 customer-readiness (2026-05-06) — `needs_fresh_edit` now has
 * its own distinct shade so an operator scanning the queue can tell
 * "Beacon wants you to read this" (`needs_review` — warning amber)
 * from "regenerate this rec; the prior edits were dismissed"
 * (`needs_fresh_edit` — info blue with dashed border). Round 1 audit
 * #10 flagged that both rendered as identical orange and the operator
 * couldn't distinguish them at a glance. The dashed border is the
 * "needs action from generator" cue (matches the `Regenerate` button
 * affordance in `recommendation-action-rows.ts`).
 */
const STATUS_PILL_CLASS: Record<ActionRowStatus, string> = {
  new: "border-accent-primary/40 bg-accent-primary/[0.06] text-accent-primary",
  accepted: "border-status-success/40 bg-status-success/[0.06] text-status-success",
  shipped: "border-status-success/40 bg-status-success/[0.10] text-status-success",
  measuring: "border-status-info/40 bg-status-info/[0.06] text-status-info",
  needs_review: "border-status-warning/40 bg-status-warning/[0.06] text-status-warning",
  needs_fresh_edit:
    "border-dashed border-status-info/50 bg-status-info/[0.04] text-status-info",
  deferred: "border-border/60 text-muted-foreground",
  dismissed: "border-border/60 text-muted-foreground",
};

function StatusPill({ status }: { status: ActionRowStatus }) {
  return (
    <span
      className={cn(
        "inline-block rounded border text-[10px] font-medium px-1.5 py-0.5",
        STATUS_PILL_CLASS[status],
      )}
      data-rec-status-pill={status}
    >
      {ACTION_ROW_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Round 1 customer-readiness (2026-05-05) — AI-source pill.
 *
 * Renders ONLY when an edit's provider source is `"openai"` (or any
 * future LLM provider on the allow-list). Deterministic-generated
 * rows render nothing. The pill is intentionally subtle — small
 * border + light tint + plain "AI" label — so it reads as
 * provenance, not an alarm. Operator scope (Round 1 brief): "keep it
 * subtle, not scary."
 *
 * Pinned by `tests/architecture/customer-readiness-round-1.test.ts`.
 */
const AI_SOURCE_NAMES = new Set(["openai", "anthropic"]);

function AIPill({ source }: { source: string | null }) {
  if (!source || !AI_SOURCE_NAMES.has(source)) return null;
  return (
    <span
      className="inline-block rounded border border-accent-secondary/40 bg-accent-secondary/[0.05] text-accent-secondary text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5"
      data-rec-ai-pill={source}
      title="This recommendation was generated by an AI model. Beacon's validator screens every AI-generated edit before it lands here."
    >
      AI
    </span>
  );
}

/**
 * Round 1 customer-readiness (2026-05-05) — engine-confidence pill.
 *
 * Surfaces `engineConfidence` directly on the row so the operator
 * doesn't have to expand the Debug block to see whether Beacon trusts
 * its own recommendation. The detailed `confidenceReason` stays in
 * the drawer per the operator brief ("Keep `confidenceReason` in
 * details/debug. Do not over-explain on the row.").
 *
 * Renders nothing when the verdict is unknown.
 *
 * Pinned by `tests/architecture/customer-readiness-round-1.test.ts`.
 */
const CONFIDENCE_PILL_CLASS: Record<"high" | "medium" | "low", string> = {
  high: "border-status-success/40 bg-status-success/[0.06] text-status-success",
  medium: "border-status-warning/40 bg-status-warning/[0.06] text-status-warning",
  low: "border-border/60 text-muted-foreground",
};
const CONFIDENCE_PILL_LABEL: Record<"high" | "medium" | "low", string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

function ConfidencePill({
  confidence,
}: {
  confidence: "high" | "medium" | "low" | null;
}) {
  if (!confidence) return null;
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded border text-[9px] font-medium px-1.5 py-0.5",
        CONFIDENCE_PILL_CLASS[confidence],
      )}
      data-rec-confidence-pill={confidence}
      title="Beacon's engine confidence for this recommendation. Hover the row's Details chevron for the full reasoning."
    >
      {CONFIDENCE_PILL_LABEL[confidence]}
    </span>
  );
}

/**
 * T4.4 (2026-05-06) — Derived-confidence pill. Customer-safe Strong /
 * Moderate / Needs-review label derived from evidence-quality signals
 * (depth, owned-page, competitor, search-query, multi-prompt). Replaces
 * the legacy "Medium confidence" pill on the customer-facing row;
 * engine-confidence stays gated behind operator mode.
 *
 * Locked by tests in
 * `src/components/recommendations/recommendation-evidence-panel.test.tsx`
 * + `src/domains/recommendations/derived-confidence.test.ts` and the
 * derived-confidence helper itself.
 */
const DERIVED_PILL_CLASS: Record<
  "strong_evidence" | "moderate_evidence" | "needs_review",
  string
> = {
  strong_evidence:
    "border-status-success/40 bg-status-success/[0.08] text-status-success",
  moderate_evidence:
    "border-status-warning/40 bg-status-warning/[0.06] text-status-warning",
  needs_review:
    "border-status-danger/40 bg-status-danger/[0.06] text-status-danger",
};
const DERIVED_PILL_LABEL: Record<
  "strong_evidence" | "moderate_evidence" | "needs_review",
  string
> = {
  strong_evidence: "Strong evidence",
  moderate_evidence: "Moderate evidence",
  // UX.3 (2026-05-07) — reframe from "Needs review" to a more
  // actionable, less-alarming phrase. The status itself doesn't
  // change; only the customer-facing label.
  // 2026-06-14 — softened again from "Needs more evidence" (read as
  // scary on a danger-red pill) to an optional, non-blocking framing.
  needs_review: "Lower confidence — optional",
};

function DerivedConfidencePill({
  derived,
}: {
  derived: "strong_evidence" | "moderate_evidence" | "needs_review";
}) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded border text-[9px] font-medium px-1.5 py-0.5",
        DERIVED_PILL_CLASS[derived],
      )}
      data-rec-derived-confidence-pill={derived}
      title={
        derived === "needs_review"
          ? "Based on limited data so far — optional, not urgent before shipping. Open the drawer for the evidence breakdown. Refresh your connected data (Settings → Connectors) to strengthen the signal."
          : "Customer-safe confidence label derived from evidence quality (depth, owned page, multi-prompt, competitor, search queries). Open the drawer for the full evidence breakdown."
      }
    >
      {DERIVED_PILL_LABEL[derived]}
    </span>
  );
}

/* ── Target link ────────────────────────────────────────────────────── */

function TargetLink({ label, url }: { label: string; url: string | null }) {
  if (!url || label === "New page") {
    return (
      <span className="text-muted-foreground" data-rec-target-label={label}>
        {label}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent-primary hover:underline"
      title={url}
      data-rec-target-label={label}
    >
      {label}
    </a>
  );
}

/* ── Row action button ──────────────────────────────────────────────── */

function RowActionButton({
  row,
  pending,
  handle,
  recPayload,
  onOpenDetails,
}: {
  row: RecommendationActionRow;
  pending: boolean;
  handle: (
    action: () => Promise<RecommendationActionResponse>,
    successMsg: string,
  ) => void;
  recPayload: RecommendationActionPayload;
  onOpenDetails: () => void;
}) {
  const editCount = row.eligibleEditCount;
  const PRIMARY_BTN =
    "text-[11px] font-medium px-2 py-1 rounded border whitespace-nowrap transition-colors disabled:opacity-50";

  // ── Operator-locked button mapping (W3 §3.5f) ──────────────────────
  // status === "new" + hasExactEdit          → Accept
  // status === "new" + !hasExactEdit (page)  → Accept
  // status === "new" + !hasExactEdit (review) → Review (open drawer)
  // status === "new" + !hasExactEdit (regen) → Regenerate (open drawer)
  // status === "needs_review"                → Review (open drawer)
  // status === "needs_fresh_edit"            → Regenerate (open drawer)
  // status === "accepted"                    → Mark shipped
  // status === "measuring"                   → View
  // status === "shipped"                     → ✓ Shipped (no button)
  // status === "deferred"                    → Promote (un-defer)
  // status === "dismissed"                   → Restore (un-dismiss)
  //
  // Defer is no longer the primary affordance for ANY state. It lives
  // as a secondary action inside the drawer (Step 3.5f follow-up).

  switch (row.status) {
    case "dismissed":
      return (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            handle(
              () => undoRecommendationResponse(row.sourceRecommendationId),
              "Restored.",
            )
          }
          className={cn(
            PRIMARY_BTN,
            "border-border/60 bg-background hover:bg-surface-inset/40",
          )}
          data-rec-action-button="restore"
        >
          Restore
        </button>
      );
    case "deferred":
      return (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            handle(
              () => undoRecommendationResponse(row.sourceRecommendationId),
              "Promoted.",
            )
          }
          className={cn(
            PRIMARY_BTN,
            "border-accent-primary/50 bg-accent-primary/[0.05] text-accent-primary hover:bg-accent-primary/[0.10]",
          )}
          data-rec-action-button="promote"
        >
          Promote
        </button>
      );
    case "accepted":
      if (editCount > 0) {
        return (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              handle(
                () =>
                  markRecommendationShipped({
                    stableKey: row.sourceRecommendationId,
                  }),
                editCount === 1
                  ? "Marked live — verdict clock started."
                  : `Marked ${editCount} edits live — verdict clock started.`,
              )
            }
            className={cn(
              PRIMARY_BTN,
              "border-accent-primary/50 bg-accent-primary/[0.06] text-accent-primary hover:bg-accent-primary/[0.12]",
            )}
            data-rec-action-button="mark_shipped"
          >
            Mark shipped
          </button>
        );
      }
      return (
        <button
          type="button"
          onClick={onOpenDetails}
          className={cn(
            PRIMARY_BTN,
            "border-border/60 bg-background hover:bg-surface-inset/40",
          )}
          data-rec-action-button="view_result"
        >
          View
        </button>
      );
    case "measuring":
      return (
        <button
          type="button"
          onClick={onOpenDetails}
          className={cn(
            PRIMARY_BTN,
            "border-status-info/50 bg-status-info/[0.05] text-status-info hover:bg-status-info/[0.10]",
          )}
          data-rec-action-button="view_result"
        >
          View
        </button>
      );
    case "shipped":
      // W3 §3.5g — operator scope: shipped rows render an actionable
      // View button (opens the drawer) instead of inert "✓ Shipped"
      // text, so the operator can review impact without scrolling.
      // The Status pill already says "Shipped" — no redundant copy.
      return (
        <button
          type="button"
          onClick={onOpenDetails}
          className={cn(
            PRIMARY_BTN,
            "border-status-success/50 bg-status-success/[0.05] text-status-success hover:bg-status-success/[0.10]",
          )}
          data-rec-action-button="view_result"
        >
          View
        </button>
      );
    case "needs_fresh_edit":
      return (
        <button
          type="button"
          onClick={onOpenDetails}
          className={cn(
            PRIMARY_BTN,
            "border-status-warning/50 bg-status-warning/[0.06] text-status-warning hover:bg-status-warning/[0.12]",
          )}
          data-rec-action-button="regenerate"
        >
          Regenerate
        </button>
      );
    case "needs_review":
      return (
        <button
          type="button"
          onClick={onOpenDetails}
          className={cn(
            PRIMARY_BTN,
            "border-status-warning/50 bg-status-warning/[0.06] text-status-warning hover:bg-status-warning/[0.12]",
          )}
          data-rec-action-button="review"
        >
          Review
        </button>
      );
    case "new":
    default: {
      // Non-actionable new rows (review_decision / regenerate_edit
      // without exact edits) open the drawer so the operator can
      // pick a direction. Accept-button only fires when there's
      // something concrete to ship.
      if (!row.hasExactEdit && row.actionType === "review_decision") {
        return (
          <button
            type="button"
            onClick={onOpenDetails}
            className={cn(
              PRIMARY_BTN,
              "border-status-warning/50 bg-status-warning/[0.06] text-status-warning hover:bg-status-warning/[0.12]",
            )}
            data-rec-action-button="review"
          >
            Review
          </button>
        );
      }
      if (!row.hasExactEdit && row.actionType === "regenerate_edit") {
        return (
          <button
            type="button"
            onClick={onOpenDetails}
            className={cn(
              PRIMARY_BTN,
              "border-status-warning/50 bg-status-warning/[0.06] text-status-warning hover:bg-status-warning/[0.12]",
            )}
            data-rec-action-button="regenerate"
          >
            Regenerate
          </button>
        );
      }
      return (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            handle(
              () => acceptRecommendation(recPayload),
              row.hasExactEdit
                ? "Accepted — Beacon will track results."
                : "Accepted.",
            )
          }
          className={cn(
            PRIMARY_BTN,
            "border-status-success/50 bg-status-success/[0.05] text-status-success hover:bg-status-success/[0.10]",
          )}
          data-rec-action-button="accept"
        >
          Accept
        </button>
      );
    }
  }
}

/* ── Row drawer (exact change / why / evidence / measurement / debug) ── */

/** Exported for the #310 indexing-safety caveat render test. Internal
 *  to the recommendations table otherwise. */
export function RowDrawer({
  row,
  promptTextById,
  showFeedback,
  feedback,
  pending,
  handle,
  competitorNames,
}: {
  row: RecommendationActionRow;
  promptTextById: Record<string, string>;
  showFeedback: boolean | null;
  feedback: {
    rowId: string;
    message: string;
    isError: boolean;
  } | null;
  pending: boolean;
  handle: (
    action: () => Promise<RecommendationActionResponse>,
    successMsg: string,
  ) => void;
  /** Slice 4.5.G-B.1 — competitor names for the `why`-display guard
   *  inside the legacy drawer's "Why Beacon recommends it" section. */
  competitorNames?: ReadonlyArray<string>;
}) {
  const d = row.detail;
  // #54 (2026-06-11): optional dismiss reason — the taste-learning
  // signal. Empty string → undefined → null reason (today's behavior).
  const [dismissReason, setDismissReason] = useState<string>("");
  const hasExactCopy =
    typeof d.proposedText === "string" && d.proposedText.trim().length > 0;
  // W3 §3.15 (2026-05-04): grouped FAQ Q+A rows carry the answer
  // text on `faqAnswerText`; render it alongside the question so the
  // drawer shows the full ship-as-is content.
  const isGroupedFaq =
    row.actionType === "add_faq" &&
    typeof d.faqAnswerText === "string" &&
    d.faqAnswerText.trim().length > 0;
  // Operator scope (W3 §3.5f): Defer + Dismiss are SECONDARY actions
  // and live at the bottom of the drawer, not in the row's Action
  // column. Hidden when the row already carries a terminal response.
  const showSecondaryActions =
    row.responseStatus !== "dismissed" &&
    row.responseStatus !== "deferred" &&
    row.status !== "shipped";
  return (
    <div className="space-y-3 text-[12px]">
      {showFeedback && feedback && (
        <p
          className={cn(
            "text-[11px]",
            feedback.isError ? "text-status-danger" : "text-status-success",
          )}
        >
          {feedback.message}
        </p>
      )}

      {/* Audit Correction #2 (2026-05-08): customer-facing
          "Why ranked here?" disclosure. Composes from existing
          top-level row fields (priority + derivedConfidence + affected
          prompts + observation count + top competitor). Does NOT
          change ranking math or sort order; this surfaces the
          existing-but-hidden reasoning to the customer. Operator-mode
          debug fields (prioritizerScore, engineConfidence.reasons,
          full reasoning paragraph) are unchanged and remain
          operator-only. */}
      <WhyRankedHere row={row} />

      {/* Section: Exact recommended change */}
      {hasExactCopy && (
        <DrawerSection title="Exact recommended change">
          {/* #310 (2026-06-14) — indexing-safety caveat. Crawl/index
              directives (robots.txt, meta noindex, canonical, redirect)
              can DEINDEX a live site if pasted wrong. Warn the owner
              before they act. Benign directives (FAQ / schema / copy /
              sitemap) render no caveat. */}
          {isIndexingDirectiveActionType(d.editActionType) && (
            <p
              className="mb-2 rounded border border-status-warning/40 bg-status-warning/[0.08] px-2.5 py-2 text-[11px] leading-relaxed text-status-warning"
              role="alert"
              data-rec-indexing-caveat="true"
            >
              <span aria-hidden="true">⚠️ </span>
              {INDEXING_DIRECTIVE_CAVEAT}
            </p>
          )}
          {d.currentText && d.currentText.trim().length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
                Current
              </p>
              <pre className="rounded border border-border/40 bg-background px-2.5 py-2 text-[11px] whitespace-pre-wrap break-words font-mono">
                {d.currentText}
              </pre>
            </div>
          )}
          {/*
            W3 §3.15 (2026-05-04) — grouped FAQ Q+A rows render the
            question + answer side-by-side. Non-FAQ rows render the
            single proposedText as "Proposed".
          */}
          {isGroupedFaq ? (
            <>
              <p
                className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1"
                data-rec-faq-question-label="true"
              >
                Question
              </p>
              <pre
                className="rounded border border-status-success/30 bg-status-success/[0.04] px-2.5 py-2 text-[11px] whitespace-pre-wrap break-words font-mono text-foreground mb-3"
                data-rec-faq-question="true"
              >
                {d.proposedText}
              </pre>
              <p
                className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1"
                data-rec-faq-answer-label="true"
              >
                Answer
              </p>
              <pre
                className="rounded border border-status-success/30 bg-status-success/[0.04] px-2.5 py-2 text-[11px] whitespace-pre-wrap break-words font-mono text-foreground"
                data-rec-faq-answer="true"
              >
                {d.faqAnswerText}
              </pre>
            </>
          ) : (
            <>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
                Proposed
              </p>
              <pre className="rounded border border-status-success/30 bg-status-success/[0.04] px-2.5 py-2 text-[11px] whitespace-pre-wrap break-words font-mono text-foreground">
                {d.proposedText}
              </pre>
            </>
          )}
        </DrawerSection>
      )}

      {/* Section: Page brief (when create_page rec) */}
      {!hasExactCopy && d.pageBrief && (
        <DrawerSection title="Page brief">
          <ul className="space-y-1 text-foreground/90">
            <li>
              <span className="text-muted-foreground">Title:</span>{" "}
              {d.pageBrief.recommendedTitle}
            </li>
            <li>
              <span className="text-muted-foreground">H1:</span>{" "}
              {d.pageBrief.recommendedH1}
            </li>
            {d.pageBrief.mustCoverAngles.length > 0 && (
              <li>
                <span className="text-muted-foreground">Must cover:</span>{" "}
                {d.pageBrief.mustCoverAngles.join(" · ")}
              </li>
            )}
            {d.pageBrief.competitorAnglesToCounter.length > 0 && (
              <li>
                <span className="text-muted-foreground">Counter angles:</span>{" "}
                {d.pageBrief.competitorAnglesToCounter.join(" · ")}
              </li>
            )}
            {d.pageBrief.internalLinksToAdd.length > 0 && (
              <li>
                <span className="text-muted-foreground">Internal links:</span>{" "}
                {d.pageBrief.internalLinksToAdd.join(" · ")}
              </li>
            )}
          </ul>
        </DrawerSection>
      )}

      {/* Section: Why
        *  Slice 4.5.G-B.1 — render-time guard runs AFTER the existing
        *  sanitizer chain (stripBracketedDiagnostics + sanitizeOperator
        *  EvidenceText). Catches UUID / long-hex / internal-token /
        *  competitor-name leaks that the write-time sanitizer missed
        *  (per the 4.5.G-A production audit findings). */}
      {d.why && d.why.trim().length > 0 && (
        <DrawerSection title="Why Beacon recommends it">
          <p className="text-foreground/90 leading-relaxed">
            {(() => {
              const sanitized = sanitizeOperatorEvidenceText(
                stripBracketedDiagnostics(d.why),
                promptTextById,
              );
              const sanitizedText =
                typeof sanitized === "string" ? sanitized : "";
              const guarded = checkWhyDisplaySafe(sanitizedText, {
                competitorNames,
              });
              return guarded.ok ? guarded.text : guarded.fallback;
            })()}
          </p>
        </DrawerSection>
      )}

      {/* Section: Evidence — T4.3 (2026-05-06) categorized panel
          replaces the prior raw-count list. The panel surfaces the
          actual grounding signals (prompts / search queries / owned
          page / competitor context / page elements / brand assertions)
          and an explicit "Evidence missing" line when categories are
          absent. Customer-safe; raw evidence refs stay behind the
          operator-mode debug section below. */}
      <DrawerSection title="Evidence">
        <RecommendationEvidencePanel
          evidenceRefs={d.evidenceRefs}
          affectedPromptCount={d.affectedPromptCount}
          observationCount={d.observationCount}
          evidenceDepth={d.evidenceDepth}
          topCompetitor={d.topCompetitor}
          promptTextById={promptTextById}
        />
        {OPERATOR_MODE_DEBUG && d.evidenceRefs.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground select-none">
              {d.evidenceRefs.length} raw evidence refs (operator-detail)
            </summary>
            <ul className="mt-2 space-y-1 text-[11px]">
              {d.evidenceRefs.slice(0, 8).map((ref, i) => (
                <li key={i} className="text-muted-foreground">
                  {renderEvidenceRefLine(ref, promptTextById)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </DrawerSection>

      {/* Section: Measurement plan */}
      {d.measurementPlan && d.measurementPlan.trim().length > 0 && (
        <DrawerSection title="Measurement plan">
          <p className="text-foreground/90 leading-relaxed">
            {d.measurementPlan}
          </p>
        </DrawerSection>
      )}

      {/* Section: Risks */}
      {d.risks.length > 0 && (
        <DrawerSection title="Risks">
          <ul className="list-disc pl-4 text-status-warning/90 space-y-0.5">
            {d.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </DrawerSection>
      )}

      {/* Section: Cannibalization */}
      {d.cannibalization && d.cannibalization.length > 0 && (
        <DrawerSection title="Overlapping pages">
          <ul className="list-disc pl-4 font-mono text-[11px]">
            {d.cannibalization.map((u, i) => (
              <li key={i}>
                <a
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-primary hover:underline"
                >
                  {shortUrl(u)}
                </a>
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}

      {/* Section: Debug (operator-mode only).
          2026-05-06 demo-path fix: previously a collapsed <details>
          block always rendered raw DB-shape strings (rec_id, edit_id,
          resolver_tier, motive, engine_confidence, evidence_hash,
          edit_lifecycle, full_reasoning, confidence_reason). The
          collapse only hid the values visually — they were still in
          the DOM and inspectable. Gated behind OPERATOR_MODE_DEBUG so
          customer mode renders nothing here. */}
      {OPERATOR_MODE_DEBUG && (
        <details
          className="rounded border border-border/40 bg-surface-inset/30 px-2.5 py-1.5"
          data-rec-debug-block="true"
        >
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground select-none">
            Debug details
          </summary>
          <ul className="mt-2 space-y-0.5 text-[11px] font-mono text-muted-foreground">
            <li>rec_id: {d.debug.recommendationId}</li>
            {d.debug.editId && <li>edit_id: {d.debug.editId}</li>}
            {d.debug.resolverTier && <li>resolver_tier: {d.debug.resolverTier}</li>}
            {d.debug.resolutionAction && (
              <li>resolution_action: {d.debug.resolutionAction}</li>
            )}
            {d.debug.motive && <li>motive: {d.debug.motive}</li>}
            {d.motiveLabel && <li>motive (text): {d.motiveLabel}</li>}
            <li>
              engine_confidence: {d.debug.engineConfidence.confidence}
              {d.debug.engineConfidence.reasons.length > 0
                ? ` (${d.debug.engineConfidence.reasons.join(", ")})`
                : ""}
            </li>
            {d.debug.evidenceHash && (
              <li>evidence_hash: {d.debug.evidenceHash}</li>
            )}
            {d.debug.editLifecycleStatus && (
              <li>edit_lifecycle: {d.debug.editLifecycleStatus}</li>
            )}
            {d.fullReasoning && d.fullReasoning !== d.why && (
              <li className="whitespace-pre-wrap">
                full_reasoning:{" "}
                {sanitizeOperatorEvidenceText(
                  d.fullReasoning,
                  promptTextById,
                )}
              </li>
            )}
            {d.confidenceReason && (
              <li className="whitespace-pre-wrap">
                confidence_reason:{" "}
                {sanitizeOperatorEvidenceText(
                  d.confidenceReason,
                  promptTextById,
                )}
              </li>
            )}
          </ul>
        </details>
      )}

      {/* Secondary actions (operator scope: Defer / Dismiss live
          here, NEVER as the row's primary button). Hidden when the
          row is already terminal. */}
      {showSecondaryActions && (
        <div
          className="flex items-center gap-2 pt-2 border-t border-border/30"
          data-rec-drawer-secondary-actions="true"
        >
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            Secondary
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              handle(
                () => deferRecommendation(row.sourceRecommendationId),
                "Deferred 7 days.",
              )
            }
            className="text-[11px] px-2 py-1 rounded border border-border/60 bg-background hover:bg-surface-inset/40 transition-colors disabled:opacity-50"
            data-rec-action-button="defer"
          >
            Defer 7 days
          </button>
          <select
            value={dismissReason}
            disabled={pending}
            onChange={(e) => setDismissReason(e.target.value)}
            className="text-[11px] px-1.5 py-1 rounded border border-border/60 bg-background disabled:opacity-50"
            data-rec-dismiss-reason
            aria-label="Dismiss reason"
          >
            <option value="">Reason…</option>
            <option value="not_relevant">Not relevant</option>
            <option value="already_done">Already done</option>
            <option value="wrong_page">Wrong page</option>
            <option value="bad_suggestion">Bad suggestion</option>
            <option value="too_risky">Too risky</option>
            <option value="other">Other</option>
          </select>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              handle(
                () =>
                  dismissRecommendation(
                    row.sourceRecommendationId,
                    (dismissReason || undefined) as
                      | import("@/domains/product/recommendation-response-store").DismissReason
                      | undefined,
                  ),
                "Dismissed.",
              )
            }
            className="text-[11px] px-2 py-1 rounded border border-border/60 bg-background hover:bg-surface-inset/40 transition-colors disabled:opacity-50"
            data-rec-action-button="dismiss"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div data-rec-drawer-section={title}>
      <h4 className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
        {title}
      </h4>
      <div>{children}</div>
    </div>
  );
}

function renderEvidenceRefLine(
  ref: { type: string; promptId?: string; observationId?: string; url?: string; description?: string },
  promptTextById: Record<string, string>,
): string {
  if (ref.type === "prompt" && ref.promptId) {
    const text = promptTextById[ref.promptId];
    const snippet =
      typeof text === "string" && text.length > 0
        ? text.length > 60
          ? `${text.slice(0, 57).trim()}…`
          : text
        : "an affected prompt";
    return `prompt: "${snippet}"`;
  }
  if (ref.type === "observation" && ref.observationId) {
    return ref.description ? `observation: ${ref.description}` : "observation";
  }
  if (ref.type === "citation_url" && ref.url) {
    return `cited: ${shortUrl(ref.url)}`;
  }
  return ref.type;
}

/* ── Watchlist (existing) ───────────────────────────────────────────── */

function WatchSection({ rows }: { rows: RecommendationWatchRow[] }) {
  return (
    <section
      className="mt-8 rounded-lg border border-border/40 bg-surface-inset/20 px-5 py-4"
      data-recommendations-watchlist="true"
    >
      <header className="mb-2">
        <h2 className="text-[13px] font-bold tracking-tight text-muted-foreground uppercase">
          Watchlist · {rows.length}
        </h2>
      </header>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Winning clusters worth defending. Passive — no action required unless
        the signal drops.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.rec.stableKey}
            className="rounded-md border border-border/40 bg-background px-3 py-2"
          >
            <p className="text-[13px] font-medium text-foreground">
              {row.rec.title}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {row.rec.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Empty states ───────────────────────────────────────────────────── */

function EmptyTable({
  hasAnyRows,
  hasActiveFilters = false,
  onClearFilters,
}: {
  hasAnyRows: boolean;
  /** #350 — true when a search/type/status filter is currently
   *  narrowing the table (so the empty state is filter-induced, not a
   *  genuinely empty queue). Drives the "Clear filters" affordance. */
  hasActiveFilters?: boolean;
  /** #350 — reset all filters back to the full queue. */
  onClearFilters?: () => void;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-surface-inset/20 px-6 py-8 text-center">
      {hasAnyRows ? (
        <>
          <p className="text-[13px] font-medium text-foreground">
            No actions match your filters.
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Clear the search or filter chips above to see the full queue.
          </p>
          {/* #350 — one-click escape so the user is never stuck on the
              empty-filtered state. Renders only when a filter is
              actually active and a reset handler is wired. */}
          {hasActiveFilters && onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="mt-3 inline-flex items-center rounded border border-accent-primary/50 bg-accent-primary/[0.05] px-3 py-1.5 text-[12px] font-medium text-accent-primary transition-colors hover:bg-accent-primary/[0.12]"
              data-recommendations-clear-filters="true"
            >
              Clear filters
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-[13px] font-medium text-foreground">
            No recommendations right now.
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Refresh your connected data{" "}
            <Link
              href="/settings/connectors"
              className="underline underline-offset-2 hover:text-foreground"
            >
              (Settings → Connectors)
            </Link>{" "}
            to generate new recommendations, or check{" "}
            <Link
              href="/prompts"
              className="underline underline-offset-2 hover:text-foreground"
            >
              /prompts
            </Link>{" "}
            for your latest prompt-by-prompt observations.
          </p>
        </>
      )}
    </div>
  );
}

/* ── Pure helpers (URL shortener / scrubbers) ───────────────────────── */

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Strip bracketed diagnostic suffixes from operator-facing copy.
 * `confidenceReason` and resolver `reasoning` paragraphs sometimes
 * carry `[reason1; reason2; …]` scoring detail. Drawer "Why" section
 * shows the prose; the bracket detail stays in the Debug block.
 */
function stripBracketedDiagnostics(text: string): string {
  return text
    .replace(/\s*\[[^\]]*\]\s*\.?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// M2 (operator audit, 2026-05-05): The legacy local `scrubRawPromptIds`
// helper was replaced with the shared `sanitizeOperatorEvidenceText`
// from `@/domains/recommendations/copy-sanitize`. The shared sanitizer
// substitutes a prompt-text snippet when the mapping is available
// (e.g., `prompt: "best whole home remodel builders bay area"`) instead
// of the previous always-generic "an affected prompt" fallback. The
// raw-UUID pattern + same callers stay; only the substitution improves.
