"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SerializedFinding } from "@/app/(shell)/today-client";

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
          >
            Confirm
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
  // Only show content-relevant change types (not guardrails or stale visibility)
  const contentChanges = findings.filter((f) =>
    CONTENT_CHANGE_TYPES.has(f.type),
  );

  if (contentChanges.length === 0) return null;

  return (
    <div className="rounded-lg border border-accent-primary/30 bg-accent-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">
            {contentChanges.length} change{contentChanges.length !== 1 ? "s" : ""} detected
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Review what changed since your last scan. Confirmed changes are tracked for attribution.
          </p>
        </div>
        <Link
          href="/pages"
          className="text-xs text-accent-primary hover:underline shrink-0"
        >
          View all in Pages →
        </Link>
      </div>

      <div className="space-y-2">
        {contentChanges.map((f) => (
          <ChangeCard
            key={f.id}
            finding={f}
            onConfirm={onConfirm}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTENT_CHANGE_TYPES = new Set([
  "title_changed",
  "meta_changed",
  "h1_changed",
  "faq_changed",
  "schema_changed",
  "content_changed",
  "canonical_changed",
  "links_changed",
  "page_added",
  "page_removed",
]);

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
