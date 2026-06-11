/**
 * Phase 6A.3 (2026-04-28) — LifecycleStatusPill.
 *
 * Surfaces Recommendation Lifecycle OS state per row/edit on /changes
 * and /recommendations. Pure presentational; no I/O. Source of truth:
 * either `RecommendedEditRow.implementation_status` (granular,
 * preferred) or `LifecycleTabClass` from the 6A.2 classifier (fallback
 * for source-derived classes like imported_legacy / scan_confirmed
 * where no recommended_edit row exists).
 *
 * Display priority:
 *   1. `status` prop wins when set — it is the most granular signal
 *      (distinguishes verified_live vs verified_live_modified, etc.).
 *   2. Otherwise `cls` prop maps to a default key:
 *        live_verified           → verified_live
 *        pending_implementation  → accepted
 *        needs_review            → needs_review
 *        imported_legacy         → imported_legacy
 *        scan_confirmed          → scan_confirmed
 *        unclassified            → unclassified
 *   3. If neither is provided, render nothing (caller's empty-state).
 *
 * Compact mode shortens long labels and tightens padding for inline
 * row use (where space is tight). Full mode is used on detail surfaces.
 */

import { cn } from "@/lib/utils";
import { isOperatorModeClient } from "@/lib/operator-mode";

import type { ImplementationStatus } from "@/domains/recommendations/recommended-edits-persistence";
import type { LifecycleTabClass } from "@/domains/attribution/lifecycle-classification";

// 2026-05-10 customer-mode audit: `data-lifecycle-key` exposed raw
// enum keys (e.g. "verified_live_modified", "not_found_after_7d") on
// every pill in customer-mode HTML. Visible text already used the
// friendly `spec.label` ("Live", "Pending implementation", etc.) so
// the leak was only via DevTools / view-source — but it's still
// operator vocabulary. Same shape as the scorecard
// `data-attribution-branch` gate at scorecard-client.tsx:759 — keep
// the attribute under operator/test mode for dev-tools workflows;
// strip it in customer mode.
const OPERATOR_MODE_DEBUG: boolean = isOperatorModeClient();

/** Union of every key the pill can render — granular edit statuses
 *  PLUS the three source-derived classes that have no edit row. */
export type LifecycleStatusPillKey =
  | ImplementationStatus
  | "imported_legacy"
  | "scan_confirmed"
  | "unclassified";

type StyleSpec = {
  /** Full-mode label (operator-facing, plain English). */
  label: string;
  /** Compact-mode label (≤14 chars when possible, for tight rows). */
  compactLabel?: string;
  /** Tailwind class names — border + background + text + dot color. */
  className: string;
  /** When true, prefix with a small ✓ glyph. */
  checkmark?: boolean;
  /** When true, show a hollow dot instead of a checkmark. */
  hollow?: boolean;
};

const STYLES: Record<LifecycleStatusPillKey, StyleSpec> = {
  verified_live: {
    label: "Live",
    compactLabel: "Live",
    className: "border-status-success/40 bg-status-success/[0.08] text-status-success",
    checkmark: true,
  },
  verified_live_modified: {
    label: "Live (modified)",
    compactLabel: "Live·mod",
    className: "border-status-success/35 bg-status-success/[0.06] text-status-success",
    checkmark: true,
  },
  accepted: {
    label: "Pending implementation",
    compactLabel: "Pending",
    className: "border-status-warning/40 bg-status-warning/[0.06] text-status-warning",
  },
  pushed: {
    label: "Published by Beacon",
    compactLabel: "Pushed",
    className: "border-status-success/40 bg-status-success/[0.06] text-status-success",
    checkmark: true,
  },
  push_failed: {
    label: "Publish failed",
    compactLabel: "Push failed",
    className: "border-status-error/40 bg-status-error/[0.08] text-status-error",
  },
  recommended: {
    label: "Recommended",
    compactLabel: "Recommended",
    className: "border-accent-primary/40 bg-accent-primary/[0.06] text-accent-primary",
  },
  needs_review: {
    label: "Needs review",
    compactLabel: "Review",
    className: "border-status-warning/50 bg-status-warning/[0.08] text-status-warning",
  },
  partially_implemented: {
    label: "Partially implemented",
    compactLabel: "Partial",
    className: "border-status-warning/40 bg-status-warning/[0.06] text-status-warning",
  },
  wrong_page: {
    label: "Wrong page",
    compactLabel: "Wrong page",
    className: "border-status-warning/40 bg-status-warning/[0.06] text-status-warning",
  },
  not_found_after_7d: {
    label: "Not found after 7d",
    compactLabel: "Not found 7d",
    className: "border-border/60 bg-surface-inset/60 text-muted-foreground",
  },
  dismissed: {
    label: "Dismissed",
    compactLabel: "Dismissed",
    className: "border-border/60 bg-surface-inset/60 text-muted-foreground",
    hollow: true,
  },
  // Night-shift #114 (2026-06-11): auto-expired by the nightly queue
  // sweeper (TTL / queue cap) — machine hygiene, rendered muted.
  expired: {
    label: "Expired",
    compactLabel: "Expired",
    className: "border-border/60 bg-surface-inset/60 text-muted-foreground",
    hollow: true,
  },
  imported_legacy: {
    label: "Pre-launch",
    compactLabel: "Pre-launch",
    className: "border-border/50 bg-surface-inset/40 text-muted-foreground",
  },
  scan_confirmed: {
    label: "Detected by scan",
    compactLabel: "Scan",
    className: "border-amber-500/40 bg-amber-500/[0.06] text-amber-600 dark:text-amber-400",
  },
  unclassified: {
    label: "Other",
    compactLabel: "Other",
    className: "border-border/40 bg-surface-inset/30 text-muted-foreground/70",
  },
};

/**
 * Resolve the displayed key from the (status, cls) inputs. Exported for
 * testing — keeps the priority rule one definition for both the pill
 * and any caller that needs to know the resolved label without rendering.
 */
export function resolveLifecyclePillKey(input: {
  status?: ImplementationStatus | null;
  cls?: LifecycleTabClass | null;
}): LifecycleStatusPillKey | null {
  if (input.status) return input.status;
  if (!input.cls) return null;
  switch (input.cls) {
    case "live_verified":
      return "verified_live";
    case "pending_implementation":
      return "accepted";
    case "needs_review":
      return "needs_review";
    case "imported_legacy":
      return "imported_legacy";
    case "scan_confirmed":
      return "scan_confirmed";
    case "unclassified":
      return "unclassified";
  }
}

export type LifecycleStatusPillProps = {
  /** Granular per-edit lifecycle state. Wins over `cls` when present. */
  status?: ImplementationStatus | null;
  /** Source-derived class from the 6A.2 classifier (fallback when no edit
   *  row joins). */
  cls?: LifecycleTabClass | null;
  /** Tighten padding + use shorter labels. Default false. */
  compact?: boolean;
  className?: string;
};

export function LifecycleStatusPill({
  status,
  cls,
  compact = false,
  className,
}: LifecycleStatusPillProps) {
  const key = resolveLifecyclePillKey({ status, cls });
  if (!key) return null;
  const spec = STYLES[key];
  const text = compact ? (spec.compactLabel ?? spec.label) : spec.label;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-semibold",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        spec.className,
        className,
      )}
      {...(OPERATOR_MODE_DEBUG ? { "data-lifecycle-key": key } : {})}
      title={spec.label}
    >
      {spec.checkmark && (
        <span aria-hidden className="font-bold">
          ✓
        </span>
      )}
      {spec.hollow && (
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full border border-current"
        />
      )}
      <span>{text}</span>
    </span>
  );
}
