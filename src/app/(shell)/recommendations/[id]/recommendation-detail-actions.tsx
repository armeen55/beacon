"use client";

/**
 * RecommendationDetailActions — Bundle 2C (2026-05-11).
 *
 * Wires the v2 brief page's Act 5 into the existing legacy server
 * actions so operators can Accept / Defer / Dismiss / Mark shipped /
 * Restore / Promote without leaving `/recommendations/[id]`.
 *
 * Design contract:
 *   - Reuses the SAME server actions the legacy table calls — no new
 *     mutation paths, no new business logic. Server-side revalidation
 *     of `/recommendations` is preserved by each action; this client
 *     additionally calls `router.refresh()` so the brief re-fetches
 *     its row and re-renders with the new status.
 *   - Only renders actions the legacy view supports for the current
 *     status. Unsupported transitions never appear — no fake forward-
 *     state buttons.
 *   - Customer-safe labels everywhere ("Accept", "Defer", "Dismiss",
 *     "Mark shipped", "Restore", "Promote", "Open change",
 *     "Back to recommendations"). No internal vocab.
 *   - Pending state disables all buttons. Error state renders a calm
 *     "Beacon couldn't apply that action. Try again." line — never
 *     raw server/action error text.
 *
 * 2026-05-13 — the "Open legacy review →" customer-facing CTA was
 * removed. v2 detail is now legacy-hop-free; the legacy route still
 * exists at `/recommendations?legacy=1` for direct operator access
 * but is no longer advertised on the v2 surface.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  acceptRecommendation as defaultAcceptRecommendation,
  deferRecommendation as defaultDeferRecommendation,
  dismissRecommendation as defaultDismissRecommendation,
  markRecommendationShipped as defaultMarkRecommendationShipped,
  undoRecommendationResponse as defaultUndoRecommendationResponse,
  type RecommendationActionPayload,
  type RecommendationActionResponse,
} from "../actions";
import type {
  ActionRowStatus,
  RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────

/**
 * Visible inline action keys for a given row. Pure / deterministic so
 * the status-to-action contract can be unit-tested without rendering.
 *
 * Locked by the audit (Bundle 2C) + the legacy table's transition map
 * in `recommendations-client.tsx`:
 *   - new / needs_review     → Accept (when hasExactEdit) + Defer + Dismiss
 *   - needs_fresh_edit       → Defer + Dismiss (Regenerate is legacy-only)
 *   - accepted               → Mark shipped (only when eligibleEditCount > 0)
 *   - dismissed              → Restore (undo)
 *   - deferred               → Promote (undo)
 *   - measuring / shipped    → (none inline — see Open change link)
 */
export type DetailActionKey =
  | "accept"
  | "defer"
  | "dismiss"
  | "mark-shipped"
  | "restore"
  | "promote";

export function visibleActionsForRow(
  row: Pick<
    RecommendationActionRow,
    "status" | "hasExactEdit" | "eligibleEditCount"
  >,
): DetailActionKey[] {
  switch (row.status) {
    case "new":
    case "needs_review": {
      const out: DetailActionKey[] = [];
      if (row.hasExactEdit) out.push("accept");
      out.push("defer", "dismiss");
      return out;
    }
    case "needs_fresh_edit":
      return ["defer", "dismiss"];
    case "accepted":
      return row.eligibleEditCount > 0 ? ["mark-shipped"] : [];
    case "dismissed":
      return ["restore"];
    case "deferred":
      return ["promote"];
    case "measuring":
    case "shipped":
      return [];
  }
}

/**
 * Build the minimal RecommendationActionPayload the legacy `accept`
 * server action expects. Server reads canonical type / cluster fields
 * from the response store, so the client-side `type` is a placeholder
 * — matching the legacy table's contract at
 * `recommendations-client.tsx:555`.
 *
 * Exported pure so the payload shape can be pinned by tests.
 */
export function buildAcceptPayload(
  row: Pick<
    RecommendationActionRow,
    "sourceRecommendationId" | "title" | "evidenceSummary"
  >,
): RecommendationActionPayload {
  return {
    stableKey: row.sourceRecommendationId,
    type: "create_cluster_page",
    title: row.title,
    description: row.evidenceSummary,
    clusterLabel: null,
    clusterKind: null,
  };
}

export const SUCCESS_MESSAGES: Record<DetailActionKey, string | ((row: Pick<RecommendationActionRow, "hasExactEdit" | "eligibleEditCount">) => string)> = {
  accept: (row) =>
    row.hasExactEdit
      ? "Accepted — Beacon will track results."
      : "Accepted.",
  defer: "Deferred.",
  dismiss: "Dismissed.",
  "mark-shipped": (row) =>
    row.eligibleEditCount === 1
      ? "Marked live — Beacon is watching impact."
      : `Marked ${row.eligibleEditCount} edits live — Beacon is watching impact.`,
  restore: "Restored.",
  promote: "Promoted.",
};

export const CALM_ERROR_MESSAGE =
  "Beacon couldn't apply that action. Try again.";

export function successMessageFor(
  key: DetailActionKey,
  row: Pick<RecommendationActionRow, "hasExactEdit" | "eligibleEditCount">,
): string {
  const entry = SUCCESS_MESSAGES[key];
  return typeof entry === "function" ? entry(row) : entry;
}

// Status types kept in scope so subsequent code references stay typed.
// (re-export not needed — used internally only.)
export type _StatusContext = ActionRowStatus;

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type DetailActionHandlers = {
  /** Optional handler overrides — primarily for tests so we don't have
   *  to spin up Next.js server-action plumbing. In production the
   *  legacy actions from `../actions.ts` are used. */
  readonly accept?: (
    payload: RecommendationActionPayload,
  ) => Promise<RecommendationActionResponse>;
  readonly defer?: (stableKey: string) => Promise<RecommendationActionResponse>;
  readonly dismiss?: (
    stableKey: string,
  ) => Promise<RecommendationActionResponse>;
  readonly markShipped?: (args: {
    stableKey: string;
  }) => Promise<RecommendationActionResponse>;
  readonly undo?: (stableKey: string) => Promise<RecommendationActionResponse>;
};

export type RecommendationDetailActionsProps = {
  readonly row: RecommendationActionRow;
  readonly changelogId: string | null;
  /** Tests inject mock handlers. Production uses the real actions. */
  readonly handlers?: DetailActionHandlers;
  /** Tests can disable router.refresh() to avoid the Next router stub.
   *  Defaults to calling router.refresh() after a successful action. */
  readonly skipRouterRefresh?: boolean;
};

type Feedback = { kind: "ok" | "error"; message: string } | null;

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────

const PRIMARY_BTN =
  "inline-flex items-center justify-center px-3 py-1.5 text-[12px] font-semibold rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const TONE = {
  accent:
    "border-accent-primary/50 bg-accent-primary/[0.06] text-accent-primary hover:bg-accent-primary/[0.12]",
  success:
    "border-status-success/50 bg-status-success/[0.05] text-status-success hover:bg-status-success/[0.10]",
  warning:
    "border-status-warning/50 bg-status-warning/[0.06] text-status-warning hover:bg-status-warning/[0.12]",
  neutral: "border-border/60 bg-background hover:bg-surface-inset/40",
} as const;

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function RecommendationDetailActions({
  row,
  changelogId,
  handlers,
  skipRouterRefresh = false,
}: RecommendationDetailActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);

  const accept = handlers?.accept ?? defaultAcceptRecommendation;
  const defer = handlers?.defer ?? defaultDeferRecommendation;
  const dismiss = handlers?.dismiss ?? defaultDismissRecommendation;
  const markShipped =
    handlers?.markShipped ?? defaultMarkRecommendationShipped;
  const undo = handlers?.undo ?? defaultUndoRecommendationResponse;

  // Re-use the pure-helper contract so the rendered buttons stay in
  // lockstep with `visibleActionsForRow` (the tested truth table).
  const recPayload = buildAcceptPayload(row);
  const visible = visibleActionsForRow(row);

  function run(
    fn: () => Promise<RecommendationActionResponse>,
    okMessage: string,
  ): void {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.success) {
          setFeedback({ kind: "ok", message: okMessage });
          if (!skipRouterRefresh) {
            router.refresh();
          }
        } else {
          setFeedback({ kind: "error", message: CALM_ERROR_MESSAGE });
        }
      } catch {
        setFeedback({ kind: "error", message: CALM_ERROR_MESSAGE });
      }
    });
  }

  // Map each key to its concrete button. The helper guarantees the
  // visible-set; this map owns the labels + tone + per-action call.
  const ACTION_BUTTON_PROPS: Record<
    DetailActionKey,
    { label: string; tone: keyof typeof TONE; invoke: () => Promise<RecommendationActionResponse> }
  > = {
    accept: {
      label: "Accept",
      tone: "success",
      invoke: () => accept(recPayload),
    },
    defer: {
      label: "Defer",
      tone: "neutral",
      invoke: () => defer(row.sourceRecommendationId),
    },
    dismiss: {
      label: "Dismiss",
      tone: "neutral",
      invoke: () => dismiss(row.sourceRecommendationId),
    },
    "mark-shipped": {
      label: "Mark shipped",
      tone: "accent",
      invoke: () => markShipped({ stableKey: row.sourceRecommendationId }),
    },
    restore: {
      label: "Restore",
      tone: "neutral",
      invoke: () => undo(row.sourceRecommendationId),
    },
    promote: {
      label: "Promote",
      tone: "accent",
      invoke: () => undo(row.sourceRecommendationId),
    },
  };

  const primary = visible.map((key) => {
    const cfg = ACTION_BUTTON_PROPS[key];
    return (
      <button
        key={key}
        type="button"
        disabled={pending}
        onClick={() => run(cfg.invoke, successMessageFor(key, row))}
        className={cn(PRIMARY_BTN, TONE[cfg.tone])}
        data-recommendation-detail-action={key}
      >
        {cfg.label}
      </button>
    );
  });

  // 2026-05-13 — v2 detail page is now legacy-hop-free. The
  // "Open legacy review" CTA used to live here as a one-click escape
  // hatch into the legacy drawer; it was the last customer-facing
  // v2 → legacy link on the detail surface. The legacy route itself
  // (/recommendations?legacy=1) is still wired and reachable via
  // direct URL — only the v2 advertisement is gone.
  const changeHref = changelogId ? `/changes/${changelogId}` : null;

  return (
    <div
      className="space-y-3"
      data-recommendation-detail-actions="true"
      data-recommendation-detail-actions-status={row.status}
    >
      {/* Primary action row */}
      <div className="flex flex-wrap items-center gap-2">
        {primary.length > 0 ? (
          primary
        ) : (
          <p
            className="text-[12px] text-muted-foreground"
            data-recommendation-detail-actions-empty="true"
          >
            No inline actions for this status.
          </p>
        )}
      </div>

      {/* Secondary / fallback links — always available */}
      <div className="flex flex-wrap items-center gap-3 text-[12px] font-semibold">
        {changeHref && (
          <Link
            href={changeHref}
            className="text-accent-primary hover:underline"
            data-recommendation-detail-cta="open-change"
          >
            Open change →
          </Link>
        )}
        <Link
          href="/recommendations?v2=1"
          className="text-muted-foreground hover:text-foreground"
          data-recommendation-detail-cta="back-to-list"
        >
          Back to recommendations
        </Link>
      </div>

      {/* Pending / feedback */}
      {pending && (
        <p
          className="text-[11px] text-muted-foreground/80"
          data-recommendation-detail-actions-pending="true"
        >
          Working…
        </p>
      )}
      {feedback && (
        <p
          className={cn(
            "text-[11px] leading-snug",
            feedback.kind === "ok"
              ? "text-status-success"
              : "text-status-warning",
          )}
          role="status"
          data-recommendation-detail-actions-feedback={feedback.kind}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
