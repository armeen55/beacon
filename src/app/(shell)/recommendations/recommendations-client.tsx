"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
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

type Props = {
  queue: RecommendationQueueRow[];
  watchlist: RecommendationWatchRow[];
  matrixDate: string;
  /** Step 1.1 (master plan) — lookup so the drawer's evidence
   *  section can render a prompt-text snippet instead of the raw
   *  UUID. */
  promptTextById: Record<string, string>;
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
}: Props) {
  const allRows = useMemo(
    () => buildRecommendationActionRows({ queue, promptTextById }),
    [queue, promptTextById],
  );

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ActionRowType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ActionRowStatus | "all">(
    "all",
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    rowId: string;
    message: string;
    isError: boolean;
  } | null>(null);

  const filteredRows = useMemo(
    () =>
      allRows.filter((row) => {
        if (typeFilter !== "all" && row.actionType !== typeFilter) return false;
        if (statusFilter !== "all" && row.status !== statusFilter) return false;
        const q = search.trim().toLowerCase();
        if (q.length === 0) return true;
        const haystack =
          `${row.title} ${row.targetLabel} ${ACTION_ROW_TYPE_LABEL[row.actionType]} ${row.evidenceSummary}`.toLowerCase();
        return haystack.includes(q);
      }),
    [allRows, typeFilter, statusFilter, search],
  );

  const summary = useMemo(() => buildSummary(allRows), [allRows]);

  return (
    <>
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
        <EmptyTable hasAnyRows={allRows.length > 0} />
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

const TYPE_FILTER_OPTIONS: Array<{
  value: ActionRowType | "all";
  label: string;
}> = [
  { value: "all", label: "All types" },
  // W3 §3.5f — compact labels. "Page" replaces "Create page" so the
  // dropdown stays single-line and the pill column doesn't overflow.
  // W3 §3.11 (2026-05-04) — operator-locked taxonomy adds H1 +
  // Table as their own filterable types (planner v0).
  { value: "create_page", label: "Page" },
  { value: "edit_title", label: "Title" },
  { value: "edit_meta", label: "Meta" },
  { value: "edit_h1", label: "H1" },
  { value: "edit_h2", label: "H2" },
  { value: "add_section", label: "Section" },
  { value: "improve_copy", label: "Copy" },
  { value: "add_faq", label: "FAQ" },
  { value: "add_schema", label: "Schema" },
  { value: "add_internal_links", label: "Links" },
  { value: "add_comparison_table", label: "Table" },
  { value: "technical_fix", label: "Technical" },
  { value: "review_decision", label: "Review" },
  { value: "regenerate_edit", label: "Regenerate" },
];

const STATUS_FILTER_OPTIONS: Array<{
  value: ActionRowStatus | "all";
  label: string;
}> = [
  { value: "all", label: "All statuses" },
  { value: "new", label: "New" },
  { value: "accepted", label: "Accepted" },
  { value: "measuring", label: "Measuring" },
  { value: "shipped", label: "Shipped" },
  { value: "needs_review", label: "Needs review" },
  { value: "needs_fresh_edit", label: "Needs fresh edit" },
  { value: "deferred", label: "Deferred" },
  { value: "dismissed", label: "Dismissed" },
];

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
  typeFilter: ActionRowType | "all";
  onTypeChange: (v: ActionRowType | "all") => void;
  statusFilter: ActionRowStatus | "all";
  onStatusChange: (v: ActionRowStatus | "all") => void;
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
          onChange={(e) => onTypeChange(e.target.value as ActionRowType | "all")}
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
          onChange={(e) =>
            onStatusChange(e.target.value as ActionRowStatus | "all")
          }
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

function ActionTable({
  rows,
  expandedId,
  onToggleExpand,
  feedback,
  setFeedback,
  promptTextById,
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
}) {
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
              expanded={expandedId === row.id}
              onToggleExpand={() => onToggleExpand(row.id)}
              feedback={feedback}
              setFeedback={setFeedback}
              promptTextById={promptTextById}
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
  expanded,
  onToggleExpand,
  feedback,
  setFeedback,
  promptTextById,
}: {
  row: RecommendationActionRow;
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
          setFeedback({
            rowId: row.id,
            message: res.error ?? "Action failed.",
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
        )}
        data-rec-row-id={row.id}
        data-rec-action-row-type={row.actionType}
        data-rec-priority={row.priority}
        data-rec-status={row.status}
        data-rec-source-rec-id={row.sourceRecommendationId}
        data-rec-source-edit-id={row.sourceEditId ?? ""}
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
            <span className="font-medium leading-snug">{row.title}</span>
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
          <RowActionButton
            row={row}
            pending={pending}
            handle={handle}
            recPayload={recPayload}
            onOpenDetails={onToggleExpand}
          />
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

const STATUS_PILL_CLASS: Record<ActionRowStatus, string> = {
  new: "border-accent-primary/40 bg-accent-primary/[0.06] text-accent-primary",
  accepted: "border-status-success/40 bg-status-success/[0.06] text-status-success",
  shipped: "border-status-success/40 bg-status-success/[0.10] text-status-success",
  measuring: "border-status-info/40 bg-status-info/[0.06] text-status-info",
  needs_review: "border-status-warning/40 bg-status-warning/[0.06] text-status-warning",
  needs_fresh_edit: "border-status-warning/40 bg-status-warning/[0.06] text-status-warning",
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

function RowDrawer({
  row,
  promptTextById,
  showFeedback,
  feedback,
  pending,
  handle,
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
}) {
  const d = row.detail;
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

      {/* Section: Exact recommended change */}
      {hasExactCopy && (
        <DrawerSection title="Exact recommended change">
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

      {/* Section: Why */}
      {d.why && d.why.trim().length > 0 && (
        <DrawerSection title="Why Beacon recommends it">
          <p className="text-foreground/90 leading-relaxed">
            {scrubRawPromptIds(stripBracketedDiagnostics(d.why))}
          </p>
        </DrawerSection>
      )}

      {/* Section: Evidence */}
      <DrawerSection title="Evidence">
        <ul className="space-y-1 text-foreground/90">
          <li>
            <span className="text-muted-foreground">Affected prompts:</span>{" "}
            {d.affectedPromptCount}
          </li>
          <li>
            <span className="text-muted-foreground">Observations:</span>{" "}
            {d.observationCount}
          </li>
          {d.topCompetitor && (
            <li>
              <span className="text-muted-foreground">Top competitor:</span>{" "}
              {d.topCompetitor.name} (primary in {d.topCompetitor.primaryPct}%)
            </li>
          )}
        </ul>
        {d.evidenceRefs.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground select-none">
              {d.evidenceRefs.length} evidence refs
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

      {/* Section: Debug (collapsed by default) */}
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
              full_reasoning: {scrubRawPromptIds(d.fullReasoning)}
            </li>
          )}
          {d.confidenceReason && (
            <li className="whitespace-pre-wrap">
              confidence_reason: {scrubRawPromptIds(d.confidenceReason)}
            </li>
          )}
        </ul>
      </details>

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
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              handle(
                () => dismissRecommendation(row.sourceRecommendationId),
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

function EmptyTable({ hasAnyRows }: { hasAnyRows: boolean }) {
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
        </>
      ) : (
        <>
          <p className="text-[13px] font-medium text-foreground">
            No recommendations today.
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            The queue regenerates nightly from the latest prompt observations.
            Come back tomorrow, or check{" "}
            <Link
              href="/prompts"
              className="underline underline-offset-2 hover:text-foreground"
            >
              /prompts
            </Link>{" "}
            for raw decision signals.
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

/**
 * Defense-in-depth scrubber for raw prompt-ids in operator copy.
 */
function scrubRawPromptIds(text: string | null | undefined): string {
  if (typeof text !== "string" || text.length === 0) return text ?? "";
  let out = text.replace(
    /\bprompt\s*:?\s*[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi,
    "an affected prompt",
  );
  out = out.replace(
    /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi,
    "an affected prompt",
  );
  out = out.replace(
    /\bprompt\s*:?\s*[a-f0-9]{8,}\b/gi,
    "an affected prompt",
  );
  return out;
}
