"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

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
const OPERATOR_MODE_DEBUG: boolean =
  process.env.NEXT_PUBLIC_OPERATOR_MODE === "true" ||
  process.env.NODE_ENV === "test";
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
import { sanitizeOperatorEvidenceText } from "@/domains/recommendations/copy-sanitize";
import { RecommendationEvidencePanel } from "@/components/recommendations/recommendation-evidence-panel";
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

  return (
    <>
      <ExecutiveStrip
        rows={stripRows}
        topPick={stripTopPick}
        evidence={stripEvidence}
      />
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
  needs_review: "Needs more evidence",
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
          ? "Beacon doesn't yet have enough evidence to recommend shipping this. Open the drawer for the evidence breakdown — we'll keep watching."
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
            {sanitizeOperatorEvidenceText(
              stripBracketedDiagnostics(d.why),
              promptTextById,
            )}
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
            to see today&apos;s prompt-by-prompt observations.
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
