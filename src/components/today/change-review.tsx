"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SerializedFinding } from "@/app/(shell)/today-client";
import { CONTENT_CHANGE_TYPES } from "@/domains/scanning/content-change-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChangeReviewProps = {
  findings: SerializedFinding[];
  onConfirm: (findingId: string) => Promise<{ success: boolean; changeId?: string }>;
  onDismiss: (findingId: string) => Promise<{ success: boolean }>;
};

// ---------------------------------------------------------------------------
// Single change card
// ---------------------------------------------------------------------------

function ChangeCard({
  finding,
  onConfirm,
  onDismiss,
}: {
  finding: SerializedFinding;
  onConfirm: (id: string) => Promise<{ success: boolean }>;
  onDismiss: (id: string) => Promise<{ success: boolean }>;
}) {
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState<"confirmed" | "dismissed" | null>(null);

  if (resolved) {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-3 text-xs text-muted-foreground">
        {resolved === "confirmed"
          ? `✓ ${finding.pagePath || "/"} — confirmed and added to changelog`
          : `✗ ${finding.pagePath || "/"} — dismissed`}
      </div>
    );
  }

  const label = CHANGE_TYPE_LABELS[finding.type] ?? finding.type;
  const hasDiff = finding.previousState || finding.currentState;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent-primary/10 text-accent-primary">
              {label}
            </span>
            {finding.citationCount > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {finding.citationCount} citations
              </span>
            )}
          </div>
          <p className="text-sm font-medium leading-snug">
            {finding.pagePath || "/"}
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {/* Phase 6A.4 (2026-04-28) — explicit "Confirm and add to
              changelog" copy. Pre-rename the button just said "Confirm",
              which made it ambiguous whether the operator was confirming
              the diff was real (no side-effect) or confirming it as a
              tracked change (side-effect: writes a changelog_entries
              row with source_system="scan_detection"). Server action
              behavior is unchanged. */}
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const res = await onConfirm(finding.id);
                if (res.success) setResolved("confirmed");
              });
            }}
            className="text-xs px-2.5 py-1 rounded border border-status-success text-status-success hover:bg-status-success/10 transition-colors disabled:opacity-50"
            title="Adds this diff to your changelog as a confirmed change. Once added, attribution starts tracking it."
          >
            Confirm and add to changelog
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const res = await onDismiss(finding.id);
                if (res.success) setResolved("dismissed");
              });
            }}
            className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      </div>

      {/* Summary */}
      <p className="text-xs text-muted-foreground">{finding.summary}</p>

      {/* Before/After diff */}
      {hasDiff && (
        <div className="text-[11px] space-y-0.5 border-t border-border/50 pt-2">
          {finding.previousState && (
            <div className="flex gap-2">
              <span className="shrink-0 text-status-danger font-medium">−</span>
              <span className="text-muted-foreground line-through">
                {truncate(finding.previousState, 120)}
              </span>
            </div>
          )}
          {finding.currentState && (
            <div className="flex gap-2">
              <span className="shrink-0 text-status-success font-medium">+</span>
              <span className="text-foreground/90">
                {truncate(finding.currentState, 120)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ChangeReview({ findings, onConfirm, onDismiss }: ChangeReviewProps) {
  // Only show content-relevant change types (not guardrails or stale visibility).
  // `f.type` is typed as `string` on SerializedFinding — Set.has accepts it
  // at runtime, cast is narrow + safe.
  const contentChanges = findings.filter((f) =>
    (CONTENT_CHANGE_TYPES as ReadonlySet<string>).has(f.type),
  );

  if (contentChanges.length === 0) return null;

  return (
    <div
      id="change-review-section"
      className="rounded-lg border border-accent-primary/30 bg-accent-primary/5 p-4 scroll-mt-6"
    >
      {/* Phase 6A.4 (2026-04-28) — collapsed-by-default accordion.
          Pre-rename the section was always-open with the heading
          "N changes detected" + the subtitle "Confirmed changes are
          tracked for attribution", which conflated raw scan diffs
          with operator-confirmed lifecycle changes. Now the heading
          says these are scan diffs (not yet tracked), the subtitle
          spells out the contract, and the cards stay tucked away
          behind a one-click expand so they don't dominate the page.
          Server actions for Confirm/Dismiss remain unchanged. */}
      <details className="group">
        <summary
          className="flex items-start justify-between gap-3 cursor-pointer list-none select-none"
          aria-label={`Scan diffs to review (${contentChanges.length})`}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block text-[10px] text-muted-foreground transition-transform group-open:rotate-90"
              >
                ▸
              </span>
              <h2 className="text-sm font-semibold">
                Scan diffs to review ({contentChanges.length})
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 ml-4 leading-relaxed">
              These are raw website differences found by Beacon&apos;s scanner.
              They are not tracked changes unless you confirm one.
            </p>
          </div>
          <Link
            href="/pages"
            className="text-xs text-accent-primary hover:underline shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            View all in Pages →
          </Link>
        </summary>

        <div className="space-y-2 mt-3">
          {contentChanges.map((f) => (
            <ChangeCard
              key={f.id}
              finding={f}
              onConfirm={onConfirm}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// CONTENT_CHANGE_TYPES moved to `@/domains/scanning/content-change-types`
// so the sidebar Today badge and this component use one source of truth.

const CHANGE_TYPE_LABELS: Record<string, string> = {
  title_changed: "Title",
  meta_changed: "Meta",
  h1_changed: "H1",
  faq_changed: "FAQ",
  schema_changed: "Schema",
  content_changed: "Content",
  canonical_changed: "Canonical",
  links_changed: "Links",
  page_added: "New page",
  page_removed: "Removed",
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
