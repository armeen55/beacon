"use client";

/**
 * RecommendationsV2Client — Bundle 2A of the UI redesign
 * (Plan: ~/.claude/plans/i-want-a-maximum-depth-curried-curry.md).
 *
 * Replaces the legacy /recommendations table + per-row drawer with a
 * premium two-column layout for the opt-in /recommendations?v2=1 view:
 *
 *   • Left (≈60%): a stack of the top 5–7 "Suggested" recommendations
 *     as full-width cards. Each card surfaces evidence chips, target
 *     URL, plain-English why, confidence, and a single "Review →"
 *     CTA that links back into the legacy view at the row's anchor.
 *
 *   • Right (≈40%): a "Working" rail showing accepted / shipped /
 *     measuring / needs_review rows so accountability for in-flight
 *     items has its own surface.
 *
 * Open-only for Bundle 2A: every CTA links into the legacy view
 * (/recommendations?legacy=1#rec-<id>). The legacy drawer remains the
 * authoritative accept / defer / dismiss surface for this first pass —
 * no new server-action wiring lands here.
 *
 * Pure presentation. Consumes the same `RecommendationQueueRow[]` and
 * `RecommendationWatchRow[]` props as the legacy client; reuses the
 * existing `buildRecommendationActionRows` helper to project the queue
 * into the typed `RecommendationActionRow[]` shape both v1 and v2
 * surfaces use. No new data fetches, no new server actions, no domain
 * logic changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  buildRecommendationActionRows,
  type ActionRowStatus,
  type RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";

import { RecommendationV2Card } from "@/components/recommendations/v2/recommendation-v2-card";
import {
  bucketForSummary,
  type PageSurgeonBucket,
  type PageSurgeonSummary,
} from "@/domains/recommendation-intelligence/page-surgeon/change-pack";
import { actionLabel } from "@/domains/insight/page-primary";
import { workbenchHref } from "@/domains/insight/workbench-route";
import {
  acceptRecommendation,
  acceptAndPublishRecommendation,
  type RecommendationActionPayload,
} from "./actions";
import {
  decideAcceptDisposition,
  type PublishingMode,
} from "@/domains/push/publishing-mode";
import type { PublishTargetKind } from "@/domains/tenants/types";
import { RecommendationsV2WorkingRail } from "@/components/recommendations/v2/recommendations-v2-working-rail";
import type {
  RecommendationQueueRow,
  RecommendationWatchRow,
} from "./page";

/**
 * Customer-actionable statuses that surface as cards in the v2
 * Suggested stack. Bundle 2A V (verification pass, 2026-05-10):
 * widened from `{"new"}` to include `needs_review` and
 * `needs_fresh_edit` after the post-Bundle-2A audit caught the
 * original set hiding rows that the legacy Executive Strip's
 * "Need review" tile already exposed. Per the audit's "never hide
 * all value just because rows are not in one exact status bucket"
 * rule.
 *
 * Bucket-to-placement map (locked):
 *   - new                → Suggested stack (this set)
 *   - needs_review       → Suggested stack (this set; customer reviews
 *                          the lower-confidence rec and decides)
 *   - needs_fresh_edit   → Suggested stack (this set; rec is still
 *                          actionable — operator triggers regenerate)
 *   - accepted           → Working rail (see rail's WORKING_STATUSES)
 *   - shipped            → Working rail
 *   - measuring          → Working rail
 *   - dismissed          → hidden (operator already rejected)
 *   - deferred           → hidden (operator snoozed it)
 */
const SUGGESTED_STATUSES: ReadonlySet<ActionRowStatus> = new Set<ActionRowStatus>([
  "new",
  "needs_review",
  "needs_fresh_edit",
]);

/**
 * Statuses considered "in flight" for the calm-state copy + the
 * "Working" rail's filter. Mirrors `WORKING_STATUSES` in
 * recommendations-v2-working-rail.tsx (the two arrays MUST stay in
 * sync — the calm copy says "Beacon is measuring N change(s) you've
 * already shipped" and that count drives the operator's decision
 * about whether to flip back to legacy).
 */
const IN_FLIGHT_STATUSES: ReadonlySet<ActionRowStatus> = new Set<ActionRowStatus>([
  "accepted",
  "shipped",
  "measuring",
]);

const MAX_SUGGESTED_CARDS = 7;

// ─────────────────────────────────────────────────────────────────────
// Bulk-select slice (2026-06-14) — pure helpers
//
// Behavior lives in pure functions so it can be locked by Node-only
// tests (this codebase has no DOM test library; the convention is
// renderToStaticMarkup for output + pure helpers for behavior — see
// recommendation-detail-actions.test.tsx). The component below calls
// EXACTLY these helpers, so a test of the helper is a test of the
// real code path.
// ─────────────────────────────────────────────────────────────────────

/** The intent a queue keypress resolves to. `null` = ignore the key. */
export type QueueKeyAction =
  | { kind: "focus"; index: number }
  | { kind: "accept"; index: number }
  | { kind: "toggle"; index: number };

/**
 * Map a queue keypress to an intent. Pure; no DOM, no React. Guards:
 *   - empty queue → null
 *   - j / k → clamp focus within [0, count-1] (k from -1 lands on 0)
 *   - a → accept the focused row, UNLESS it is already accepted/pending
 *   - x → toggle the focused row's selection, UNLESS already accepted
 *   - any other key, or no focused row for a/x → null
 */
export function resolveQueueKeyAction(
  key: string,
  ctx: {
    focusedIndex: number;
    count: number;
    /** accept-state of the focused row, when one is focused. */
    focusedAcceptState?: "idle" | "pending" | "accepted" | "error";
  },
): QueueKeyAction | null {
  const { focusedIndex, count } = ctx;
  if (count === 0) return null;

  if (key === "j") {
    return { kind: "focus", index: Math.min(focusedIndex + 1, count - 1) };
  }
  if (key === "k") {
    return { kind: "focus", index: focusedIndex <= 0 ? 0 : focusedIndex - 1 };
  }

  const hasFocusedRow = focusedIndex >= 0 && focusedIndex < count;
  if (!hasFocusedRow) return null;

  if (key === "a") {
    if (
      ctx.focusedAcceptState === "accepted" ||
      ctx.focusedAcceptState === "pending"
    ) {
      return null;
    }
    return { kind: "accept", index: focusedIndex };
  }
  if (key === "x") {
    if (ctx.focusedAcceptState === "accepted") return null;
    return { kind: "toggle", index: focusedIndex };
  }
  return null;
}

/**
 * Run the EXISTING per-row accept across a batch, sequentially, with a
 * per-step progress callback. Returns the ids that succeeded vs failed
 * so the caller can clear succeeded rows and keep failed ones selected
 * for the existing per-card retry. Pure orchestration — `acceptOne` is
 * the (already-wired) per-row accept.
 */
export async function runBulkAccept(
  ids: string[],
  acceptOne: (id: string) => Promise<boolean>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ succeeded: string[]; failed: string[] }> {
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const ok = await acceptOne(ids[i]);
    if (ok) succeeded.push(ids[i]);
    else failed.push(ids[i]);
    onProgress?.(i + 1, ids.length);
  }
  return { succeeded, failed };
}

export type RecommendationsV2ClientProps = {
  queue: RecommendationQueueRow[];
  // 2026-05-13 follow-up — the customer-facing watchlist footer link
  // was removed (it was the last v2 → legacy hop). The prop stays in
  // the contract so the page-level loader doesn't have to change, and
  // so a future v2 watchlist surface can adopt it without a prop diff.
  watchlist?: RecommendationWatchRow[];
  matrixDate: string;
  promptTextById: Record<string, string>;
  /** Slice 4.5.G-B.1 — active tracked-entity competitor names for the
   *  render-time `why`-display guard on each `<RecommendationV2Card>`.
   *  Threaded from the server page; optional. */
  competitorNames?: ReadonlyArray<string>;
  /** #149 (2026-06-11): per-tenant city vocabulary
   *  (BusinessConfig.locations) for geo tags in row titles. Threaded
   *  from the server page (client components can't read server config).
   *  Absent → legacy Bay-Area default. */
  knownCities?: ReadonlyArray<string>;
  /** #149-sibling: per-tenant service phrases for topic extraction. */
  knownServices?: ReadonlyArray<string>;
  /** Armed publishing (2026-06-16) — the per-site one-click state. Absent →
   *  staged (two-click). When "armed" + a safe, mapped, high-confidence row +
   *  canPublish + a live wix_cms target, the card shows "Accept & publish". */
  publishingMode?: PublishingMode;
  /** Whether this user may publish for the tenant (server-computed). */
  canPublish?: boolean;
  /** The tenant's live write target (only wix_cms supports one-click publish). */
  publishTarget?: PublishTargetKind | null;
  /** Trust audit E — tenant canonical brand name for title brand-casing. */
  brandName?: string;
  /** PSQ (operator-only) — true when this render is in operator mode. Gates the
   *  Page-Surgeon-first tabs + reorder + legacy separation. Customer view = false. */
  isOperator?: boolean;
  /** PSQ (operator-only) — Page Surgeon status per page PATH (QA/review/headline).
   *  Empty in customer mode. Drives the Ready/Needs-edit/Reviewed/Legacy buckets. */
  pageSurgeonSummaries?: Record<string, PageSurgeonSummary>;
};

export function RecommendationsV2Client({
  queue,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  watchlist: _watchlist = [],
  matrixDate,
  promptTextById,
  competitorNames,
  knownCities,
  knownServices,
  publishingMode = "staged",
  canPublish = false,
  publishTarget = null,
  brandName,
  isOperator = false,
  pageSurgeonSummaries = {},
}: RecommendationsV2ClientProps) {
  // 2026-05-13 follow-up — "See full list" used to link to
  // `/recommendations?legacy=1`, pushing customers out of v2 every time
  // the queue had more than 7 actionable rows. The fix is a v2-native
  // inline toggle: when the operator clicks "See full list", expand
  // the Suggested stack to render every actionable row; clicking
  // "Show fewer" collapses back to the top 7. No legacy hop. No new
  // route. No new data fetch.
  const [showAllSuggested, setShowAllSuggested] = useState(false);

  // PSQ (operator-only) — which Page Surgeon bucket the operator is viewing.
  // Defaults to "ready" so the operator lands on finished, QA-passed drafts.
  const [operatorTab, setOperatorTab] = useState<PageSurgeonBucket>("ready");

  // One-tap slice (2026-06-12): inline Accept on each card, wired to
  // the SAME acceptRecommendation server action the legacy drawer and
  // the detail page use (per-edit fan-out, changelog entries,
  // attribution clock — all unchanged). Optimistic per-row state.
  const [acceptStates, setAcceptStates] = useState<
    Record<string, "pending" | "accepted" | "error">
  >({});
  // #316 — capture the per-row error message so a failed card can show
  // WHICH error happened (the action returns `{error}` on the success:false
  // path) and the owner can retry that exact card. Keyed by rowId so one
  // failure among many is attributable.
  const [acceptErrors, setAcceptErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  // Bulk-select slice (2026-06-14): batch-accept for power users /
  // agencies. Multi-select tracks the chosen actionable row ids;
  // `bulkProgress` drives the "Accepting X of N…" announcement; the
  // focused-card highlight powers j/k keyboard nav. The batch loop
  // reuses the SAME per-row accept (acceptRowAsync) — no new server
  // action, no data-flow change.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Core single-accept, awaitable. Returns whether the accept
  // succeeded so the bulk loop can keep failed rows selected. Shares
  // the exact optimistic state machine (`acceptStates`/`acceptErrors`)
  // the per-card button + retry already use.
  const acceptRowAsync = useCallback(
    async (
      rowId: string,
      payload: RecommendationActionPayload,
    ): Promise<boolean> => {
      setAcceptStates((s) => ({ ...s, [rowId]: "pending" }));
      setAcceptErrors((e) => {
        if (!(rowId in e)) return e;
        const next = { ...e };
        delete next[rowId];
        return next;
      });
      try {
        const res = await acceptRecommendation(payload);
        if (res.success) {
          setAcceptStates((s) => ({ ...s, [rowId]: "accepted" }));
          return true;
        }
        // Action ran but reported a failure — surface its actual error.
        setAcceptStates((s) => ({ ...s, [rowId]: "error" }));
        setAcceptErrors((e) => ({
          ...e,
          [rowId]:
            res.error ??
            "Something went wrong, please try again, or refresh your data.",
        }));
        return false;
      } catch (err) {
        setAcceptStates((s) => ({ ...s, [rowId]: "error" }));
        setAcceptErrors((e) => ({
          ...e,
          [rowId]: err instanceof Error ? err.message : String(err),
        }));
        return false;
      }
    },
    [],
  );

  // Per-row Accept / retry (single card). Keeps the existing
  // transition-wrapped, fire-and-forget ergonomics of the button.
  const acceptRow = useCallback(
    (rowId: string, payload: RecommendationActionPayload) => {
      startTransition(() => {
        void acceptRowAsync(rowId, payload);
      });
    },
    [acceptRowAsync],
  );

  // Armed publishing (2026-06-16) — one-click Accept→live-publish. Reuses the
  // SAME optimistic state machine; the server action accepts THEN publishes
  // (executePush enforces every structural rail) and re-checks the armed +
  // QA gates server-side. On a refusal the row's status reverts to error with
  // the exact reason; on success it reads "accepted" (published live).
  const acceptAndPublishRow = useCallback(
    (rowId: string, payload: RecommendationActionPayload, editId: string) => {
      setAcceptStates((s) => ({ ...s, [rowId]: "pending" }));
      setAcceptErrors((e) => {
        if (!(rowId in e)) return e;
        const next = { ...e };
        delete next[rowId];
        return next;
      });
      startTransition(async () => {
        try {
          const res = await acceptAndPublishRecommendation({ payload, editId });
          if (res.ok) {
            setAcceptStates((s) => ({ ...s, [rowId]: "accepted" }));
          } else {
            setAcceptStates((s) => ({ ...s, [rowId]: "error" }));
            setAcceptErrors((e) => ({
              ...e,
              [rowId]:
                res.reason ??
                "Couldn't publish this change. Nothing was changed on your site.",
            }));
          }
        } catch (err) {
          setAcceptStates((s) => ({ ...s, [rowId]: "error" }));
          setAcceptErrors((e) => ({
            ...e,
            [rowId]: err instanceof Error ? err.message : String(err),
          }));
        }
      });
    },
    [],
  );

  // Build typed action rows from the same queue the legacy table consumes.
  // Pure projection — no new I/O, no math change.
  const allRows = useMemo(
    () =>
      buildRecommendationActionRows({
        queue,
        promptTextById,
        knownCities,
        knownServices,
        brandName,
      }),
    [queue, promptTextById, knownCities, knownServices, brandName],
  );

  const actionableRows = useMemo(
    () => allRows.filter((r) => SUGGESTED_STATUSES.has(r.status)),
    [allRows],
  );

  // PSQ — per-row Page Surgeon bucket (operator-only). Matches a rec to its pack
  // by page PATH; no pack ⇒ "legacy". Pure derivation; empty in customer mode.
  const summaryForRow = useCallback(
    (row: RecommendationActionRow): PageSurgeonSummary | undefined => {
      if (!isOperator || !row.targetUrl || row.targetUrl === "needs_new_page") return undefined;
      const path = row.targetUrl.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "") || "/";
      return pageSurgeonSummaries[path];
    },
    [isOperator, pageSurgeonSummaries],
  );

  const bucketed = useMemo(() => {
    const g: Record<PageSurgeonBucket, RecommendationActionRow[]> = {
      ready: [], needs_edit: [], reviewed: [], legacy: [],
    };
    for (const r of actionableRows) g[bucketForSummary(summaryForRow(r))].push(r);
    return g;
  }, [actionableRows, summaryForRow]);

  // The displayed set. Customer: the flat top-N. Operator: the SELECTED Page
  // Surgeon bucket — tabs ARE the separation (Ready lands first; legacy is its
  // own tab, clearly demoted). Never mutates the server builder sort.
  const suggested = useMemo(() => {
    const base = isOperator ? bucketed[operatorTab] : actionableRows;
    return showAllSuggested ? base : base.slice(0, MAX_SUGGESTED_CARDS);
  }, [isOperator, bucketed, operatorTab, actionableRows, showAllSuggested]);

  const inFlightCount = useMemo(
    () => allRows.filter((r) => IN_FLIGHT_STATUSES.has(r.status)).length,
    [allRows],
  );

  const displayTotal = isOperator ? bucketed[operatorTab].length : actionableRows.length;
  const hasMoreActionable = displayTotal > MAX_SUGGESTED_CARDS;

  // Bulk-select slice — single source of truth for the accept payload
  // both the per-card button AND the batch loop send. Identical to the
  // inline payload the one-tap slice built; extracted so the two paths
  // can't drift.
  const payloadFor = useCallback(
    (row: RecommendationActionRow): RecommendationActionPayload => ({
      stableKey: row.sourceRecommendationId,
      // Placeholder type — the server action reads the canonical rec
      // from the store by stableKey (same contract the legacy table uses).
      type: "create_cluster_page",
      title: row.title,
      description: row.evidenceSummary ?? row.title,
      clusterLabel: null,
      clusterKind: null,
    }),
    [],
  );

  // Selectable row ids are exactly the visible Suggested cards that are
  // not already accepted (an accepted card has nothing left to batch).
  const selectableIds = useMemo(
    () =>
      suggested
        .filter((r) => acceptStates[r.id] !== "accepted")
        .map((r) => r.id),
    [suggested, acceptStates],
  );

  // Keep the selection from referencing rows that scrolled out of the
  // visible/selectable set (e.g. after "Show fewer"). Prune silently.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const allowed = new Set(selectableIds);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (allowed.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [selectableIds]);

  const toggleSelect = useCallback((rowId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(selectableIds));
  }, [selectableIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedCount = selectedIds.size;
  const allSelected =
    selectableIds.length > 0 && selectedCount === selectableIds.length;
  const isBulkAccepting = bulkProgress != null;

  // Batch-accept: loop the EXISTING per-row accept sequentially so the
  // changelog fan-out / attribution clock stay identical to single
  // Accept. Succeeded rows drop out of the selection; failed rows stay
  // selected and surface the existing per-card error + "Try again".
  const acceptSelected = useCallback(() => {
    const ids = suggested
      .map((r) => r.id)
      .filter((id) => selectedIds.has(id));
    if (ids.length === 0 || isBulkAccepting) return;
    const rowById = new Map(suggested.map((r) => [r.id, r]));
    startTransition(() => {
      void (async () => {
        setBulkProgress({ done: 0, total: ids.length });
        const { failed } = await runBulkAccept(
          ids,
          async (id) => {
            const row = rowById.get(id);
            if (!row) return false;
            return acceptRowAsync(id, payloadFor(row));
          },
          (done, total) => setBulkProgress({ done, total }),
        );
        // Clear succeeded rows; keep failed ones selected for retry.
        setSelectedIds(new Set(failed));
        setBulkProgress(null);
      })();
    });
  }, [suggested, selectedIds, isBulkAccepting, acceptRowAsync, payloadFor]);

  // Keyboard nav — scoped to the queue. Fires only when focus is NOT in
  // an input/textarea/contentEditable AND focus is within (or nothing
  // outside) the queue container. Uses plain j/k/a/x with no modifiers
  // so it never collides with the global ⌘K / ? / g-nav handlers
  // (command-palette.tsx), which only consume `k` when a `g` is pending.
  const queueRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Scope: only act when the queue exists and focus is either inside
      // the queue or on the document body (no other widget owns focus).
      const container = queueRef.current;
      if (!container) return;
      const active = document.activeElement;
      const focusElsewhere =
        active != null &&
        active !== document.body &&
        !container.contains(active);
      if (focusElsewhere) return;
      if (suggested.length === 0) return;
      if (e.key !== "j" && e.key !== "k" && e.key !== "a" && e.key !== "x") {
        return;
      }

      const focusedRow = suggested[focusedIndex];
      const action = resolveQueueKeyAction(e.key, {
        focusedIndex,
        count: suggested.length,
        focusedAcceptState: focusedRow
          ? acceptStates[focusedRow.id] ?? "idle"
          : undefined,
      });
      if (!action) return;
      e.preventDefault();

      if (action.kind === "focus") {
        setFocusedIndex(action.index);
        return;
      }
      const row = suggested[action.index];
      if (!row) return;
      if (action.kind === "accept") {
        acceptRow(row.id, payloadFor(row));
      } else {
        toggleSelect(row.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    suggested,
    focusedIndex,
    acceptStates,
    acceptRow,
    payloadFor,
    toggleSelect,
  ]);

  // Keep the focused index in-bounds when the visible set shrinks.
  useEffect(() => {
    setFocusedIndex((i) =>
      i >= suggested.length ? suggested.length - 1 : i,
    );
  }, [suggested.length]);

  // Friendly date label for the page header microcopy. Already
  // formatted server-side as YYYY-MM-DD; keep it operator-safe by
  // rendering only as "as of <date>" — no UTC, no cron.
  const headerSubline = (
    <span data-recommendations-v2-header-subline="true">
      Beacon finds where your website is losing visitors on Google and AI, and
      gives you the exact fix. You approve every change before anything goes live.{" "}
      <span className="text-muted-foreground/80">
        Updated {matrixDate}.
      </span>
    </span>
  );

  return (
    <div
      className="space-y-5 max-w-5xl"
      data-recommendations-layout="v2-card-stack"
    >
      {/* Header */}
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Drafts
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
            {headerSubline}
          </p>
        </div>
      </header>

      {allRows.length === 0 ? (
        <RecommendationsV2EmptyState />
      ) : (isOperator ? actionableRows.length === 0 : suggested.length === 0) ? (
        // Operator mode keys the calm state off the FULL actionable set (not the
        // selected tab) so an empty "Ready" tab still shows the tabs to switch.
        <RecommendationsV2CalmState inFlightCount={inFlightCount} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-5">
          {/* Suggested stack */}
          <section
            ref={queueRef}
            className="space-y-3"
            data-recommendations-v2-section="suggested"
            aria-label="Suggested recommendations"
          >
            {/* PSQ (operator-only) — Page Surgeon-first tabs. The operator works
                from finished, QA-passed packs ("Ready") first; basic legacy recs
                are demoted to their own clearly-labeled tab. Customer view never
                renders these (isOperator=false). */}
            {isOperator && (
              <div data-recommendations-v2-ps-tabs="true">
                <div className="flex flex-wrap items-center gap-1.5">
                  {([
                    ["ready", "Ready"],
                    ["needs_edit", "Needs edit"],
                    ["reviewed", "Reviewed"],
                    ["legacy", "Standard"],
                  ] as ReadonlyArray<readonly [PageSurgeonBucket, string]>).map(
                    ([key, label]) => {
                      const count = bucketed[key].length;
                      const active = operatorTab === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setOperatorTab(key)}
                          aria-pressed={active}
                          data-ps-tab={key}
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            active
                              ? "border-accent-primary/50 bg-accent-primary/10 text-accent-primary"
                              : "border-border/60 text-muted-foreground hover:bg-surface-inset/50"
                          }`}
                        >
                          {label} ({count})
                        </button>
                      );
                    },
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {operatorTab === "legacy"
                    ? "Standard suggestions, grounded in your Google and SEMrush data and ready to use. The Ready tab is the same kind of suggestion with a deeper page review, so check those first when present."
                    : operatorTab === "needs_edit"
                      ? "Drafts that need a quick edit, or that our quality check held back."
                      : operatorTab === "reviewed"
                        ? "Suggestions you've already approved."
                        : "Finished drafts that passed our quality check. Review and approve these first."}
                </p>
              </div>
            )}

            {/* Bulk action bar — appears only once ≥1 card is selected
                (spec: ≥1 selected). "Select all" then expands to every
                selectable card; "Clear selection" / "Select none"
                collapses back. */}
            {selectedCount > 0 && (
              <RecommendationsV2BulkBar
                selectedCount={selectedCount}
                allSelected={allSelected}
                bulkProgress={bulkProgress}
                onAcceptSelected={acceptSelected}
                onSelectAll={selectAll}
                onClearSelection={clearSelection}
              />
            )}

            {isOperator && suggested.length === 0 && (
              <p className="text-[12px] text-muted-foreground">
                Nothing in this view. {operatorTab !== "legacy" ? "Switch tabs above to see other recommendations." : ""}
              </p>
            )}

            {suggested.map((row, index) => {
              const isAccepted = acceptStates[row.id] === "accepted";
              const psSummary = summaryForRow(row);
              // Armed publishing — does a click on THIS row publish live in one
              // tap? Only when the site is armed + this user can publish + a live
              // wix_cms target + the deterministic QA verdict approves a paste-
              // ready field edit. The server re-checks all of this before any
              // write; this only chooses which CTA the card shows.
              const editId = row.detail?.debug?.editId ?? null;
              const oneClickPublish =
                editId != null &&
                decideAcceptDisposition({
                  mode: publishingMode,
                  canPublish,
                  publishTarget,
                  qaVerdict: row.detail.qaVerdict ?? null,
                  isSuggestion: true,
                }) === "publish_live";
              return (
                <RecommendationV2Card
                  key={row.id}
                  row={row}
                  competitorNames={competitorNames}
                  acceptState={acceptStates[row.id] ?? "idle"}
                  acceptError={acceptErrors[row.id]}
                  onAccept={() => acceptRow(row.id, payloadFor(row))}
                  onRetry={() => acceptRow(row.id, payloadFor(row))}
                  onAcceptAndPublish={
                    oneClickPublish && editId != null
                      ? () =>
                          acceptAndPublishRow(row.id, payloadFor(row), editId)
                      : undefined
                  }
                  selectable={!isAccepted}
                  selected={selectedIds.has(row.id)}
                  onToggleSelect={() => toggleSelect(row.id)}
                  isFocused={focusedIndex === index}
                  pageSurgeonReady={psSummary != null && psSummary.qaPass}
                  pageSurgeonReviewVerdict={psSummary?.reviewVerdict ?? null}
                  pageSurgeonHeadline={
                    psSummary?.hasPack
                      ? actionLabel(psSummary.headlineAction)
                      : null
                  }
                  reviewHref={
                    psSummary?.hasPack ? workbenchHref(psSummary.path) : undefined
                  }
                />
              );
            })}

            {hasMoreActionable && (
              <p className="pt-2 text-[11px] text-muted-foreground/80">
                {showAllSuggested ? (
                  <>
                    Showing all {displayTotal} recommendations.{" "}
                    <button
                      type="button"
                      onClick={() => setShowAllSuggested(false)}
                      className="text-accent-primary hover:underline font-medium"
                      data-recommendations-v2-cta="show-fewer"
                    >
                      Show fewer ↑
                    </button>
                  </>
                ) : (
                  <>
                    Showing the top {suggested.length} of{" "}
                    {displayTotal} recommendations.{" "}
                    <button
                      type="button"
                      onClick={() => setShowAllSuggested(true)}
                      className="text-accent-primary hover:underline font-medium"
                      data-recommendations-v2-cta="see-all"
                    >
                      See full list →
                    </button>
                  </>
                )}
              </p>
            )}
          </section>

          {/* Working rail */}
          <RecommendationsV2WorkingRail rows={allRows} />
        </div>
      )}

      {/* 2026-05-13 follow-up — the customer-facing watchlist footer
          used to render `${watchlist.length} winning patterns on watch →`
          here, linking at `/recommendations?legacy=1#watchlist`. It was
          the last customer-facing v2 → legacy hop and is removed in
          this bundle. The watchlist still exists on the legacy route
          (`/recommendations?legacy=1`) for direct operator access;
          when a v2 watchlist surface lands, restore this footer with
          a v2 href. The `watchlist` prop is intentionally still
          accepted so the page-level loader contract doesn't change. */}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Bulk action bar (bulk-select slice, 2026-06-14)
// ─────────────────────────────────────────────────────────────────────

/**
 * Sticky bar that appears at the top of the Suggested stack whenever at
 * least one card is selected. Offers "Accept N selected", a select-all /
 * select-none toggle, and "Clear selection". During a batch it swaps the
 * Accept label for a live "Accepting X of N…" progress readout.
 *
 * Accessibility: the bar is a labelled region with aria-live="polite"
 * so the selection count + progress are announced; the controls are
 * plain buttons (no focus trap).
 */
function RecommendationsV2BulkBar({
  selectedCount,
  allSelected,
  bulkProgress,
  onAcceptSelected,
  onSelectAll,
  onClearSelection,
}: {
  selectedCount: number;
  allSelected: boolean;
  bulkProgress: { done: number; total: number } | null;
  onAcceptSelected: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}) {
  const busy = bulkProgress != null;
  return (
    <div
      className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-primary/30 bg-accent-primary/[0.06] px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-accent-primary/[0.06]"
      role="region"
      aria-label="Bulk actions for selected recommendations"
      aria-live="polite"
      data-recommendations-v2-bulk-bar="true"
    >
      <span className="text-[12px] font-medium text-foreground">
        {busy && bulkProgress
          ? `Accepting ${Math.min(bulkProgress.done + 1, bulkProgress.total)} of ${bulkProgress.total}…`
          : `${selectedCount} selected`}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={allSelected ? onClearSelection : onSelectAll}
          disabled={busy}
          className="rounded-md border border-border/60 px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-surface-inset/50 disabled:opacity-50"
          data-recommendations-v2-bulk-cta="select-all"
        >
          {allSelected ? "Select none" : "Select all"}
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          disabled={busy}
          className="rounded-md border border-border/60 px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-surface-inset/50 disabled:opacity-50"
          data-recommendations-v2-bulk-cta="clear"
        >
          Clear selection
        </button>
        <button
          type="button"
          onClick={onAcceptSelected}
          disabled={busy || selectedCount === 0}
          className="rounded-md bg-accent-primary px-3 py-2 text-[12px] font-semibold text-white hover:bg-accent-primary/90 disabled:opacity-60"
          data-recommendations-v2-bulk-cta="accept-selected"
        >
          {busy && bulkProgress
            ? `Accepting ${Math.min(bulkProgress.done + 1, bulkProgress.total)} of ${bulkProgress.total}…`
            : `Accept ${selectedCount} selected`}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Empty + calm states
// ─────────────────────────────────────────────────────────────────────

function RecommendationsV2EmptyState() {
  return (
    <div
      className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-8 text-center"
      role="status"
      data-recommendations-v2-empty="true"
    >
      <p className="text-[14px] font-semibold text-foreground">
        No recommendations right now.
      </p>
      <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed max-w-md mx-auto">
        Update your data in Settings to see if anything new comes up. If you
        haven&apos;t connected Google yet, start there.
      </p>
    </div>
  );
}

function RecommendationsV2CalmState({
  inFlightCount,
}: {
  inFlightCount: number;
}) {
  return (
    <div
      className="rounded-lg border border-status-success/30 bg-status-success/[0.04] px-5 py-6"
      role="status"
      data-recommendations-v2-calm="true"
    >
      <p className="text-[14px] font-semibold text-foreground">
        You&apos;re caught up on suggestions.
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
        {inFlightCount > 0
          ? `Nice work. We're tracking ${inFlightCount} change${inFlightCount === 1 ? "" : "s"} you've already made to see if they helped. Update your data in Settings to check for anything new.`
          : "Update your data in Settings to check for anything new on your pages."}
      </p>
    </div>
  );
}
