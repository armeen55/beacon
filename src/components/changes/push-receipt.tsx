/**
 * Phase 5 — MAX_SEO_AEO audit P0 #5: the PUSH RECEIPT component.
 *
 * Renders a `PushReceipt` (composed server-side by
 * `@/domains/push/push-receipt`) as ONE clean artifact:
 *
 *   • a verify-status badge (verified_live green / pushed neutral /
 *     failed red)
 *   • the URL + the CMS field that changed
 *   • a BEFORE → AFTER diff (two labeled blocks; "(added)" when there
 *     was no previous value)
 *   • the source-evidence bullets (plain English, white-label)
 *   • the pushed-at timestamp + the ledger detail
 *   • a Revert control (only when `revertable`) that posts to the
 *     EXISTING `revertPushFromForm` server action — NO new revert path
 *
 * Server component (no `'use client'`): it embeds a `<form action=…>`
 * pointing at a server action, exactly like the /diagnostics/wix ledger.
 * Dumb: it owns no join logic, no number derivation, no clock — all of
 * that lives in the composer. Honest empty/failed states. White-label.
 *
 * Testability: the root carries `data-push-receipt="<verifyStatus>"`.
 */

import { cn } from "@/lib/utils";
import type { PushReceipt } from "@/domains/push/push-receipt";
import { revertPushFromForm } from "./revert-push-action";

/** Verify-status → badge presentation. Plain-English, customer-safe. */
const VERIFY_BADGE: Record<
  PushReceipt["verifyStatus"],
  { label: string; className: string; dot: string }
> = {
  verified_live: {
    label: "Live on your site",
    className:
      "border-status-success/40 bg-status-success/[0.08] text-status-success",
    dot: "bg-status-success",
  },
  pending: {
    label: "Pushed — confirming live",
    className:
      "border-accent-primary/35 bg-accent-primary/[0.06] text-accent-primary",
    dot: "bg-accent-primary",
  },
  unverified: {
    label: "Pushed",
    className: "border-border/60 bg-surface-inset/60 text-foreground/75",
    dot: "bg-muted-foreground/60",
  },
  failed: {
    label: "Push failed",
    className: "border-status-error/40 bg-status-error/[0.07] text-status-error",
    dot: "bg-status-error",
  },
};

export function PushReceipt({ receipt }: { receipt: PushReceipt }) {
  const badge = VERIFY_BADGE[receipt.verifyStatus];
  const failed = receipt.result === "push_failed";

  return (
    <section
      className="rounded-lg border border-border/60 bg-surface-base px-4 py-4"
      data-push-receipt={receipt.verifyStatus}
      aria-labelledby="push-receipt-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="push-receipt-heading"
            className="text-[14px] font-semibold tracking-tight text-foreground"
          >
            What shipped
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {receipt.actionLabel}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
            badge.className,
          )}
          data-push-receipt-badge={receipt.verifyStatus}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", badge.dot)} />
          {badge.label}
        </span>
      </div>

      {/* URL + field */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px]">
        {receipt.url && (
          <span
            className="font-mono text-muted-foreground break-all"
            data-push-receipt-url="true"
          >
            {receipt.url}
          </span>
        )}
        {receipt.field && (
          <span className="text-muted-foreground">
            · field{" "}
            <span className="font-medium text-foreground/80">
              {receipt.field}
            </span>
          </span>
        )}
      </div>

      {/* Failed-push honest state — no diff to show. */}
      {failed ? (
        <div
          className="mt-3 rounded-md border border-status-error/30 bg-status-error/[0.05] px-3 py-2.5"
          data-push-receipt-failed="true"
        >
          <p className="text-[12.5px] leading-relaxed text-foreground/85">
            This change didn&apos;t go live. Nothing on your site was modified.
          </p>
          {receipt.detail && (
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              {receipt.detail}
            </p>
          )}
        </div>
      ) : (
        /* BEFORE → AFTER diff */
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <DiffBlock
            label="Before"
            text={receipt.before}
            emptyLabel="(added)"
            tone="before"
          />
          <DiffBlock
            label="After"
            text={receipt.after}
            emptyLabel="(no recorded value)"
            tone="after"
          />
        </div>
      )}

      {/* Source evidence */}
      {receipt.evidence.length > 0 && (
        <div className="mt-3" data-push-receipt-evidence="true">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Why we shipped this
          </p>
          <ul className="mt-1.5 space-y-1">
            {receipt.evidence.map((line, i) => (
              <li
                key={i}
                className="flex gap-2 text-[12px] leading-relaxed text-foreground/80"
                data-push-receipt-evidence-line={i}
              >
                <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Timestamp + revert */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2.5">
        <p
          className="text-[11px] tabular-nums text-muted-foreground"
          data-push-receipt-timestamp="true"
        >
          {failed ? "Attempted" : "Pushed"} on {formatTimestamp(receipt.pushedAt)}
        </p>
        {receipt.revertable && (
          <form action={revertPushFromForm}>
            <input type="hidden" name="edit_id" value={receipt.editId} />
            <button
              type="submit"
              className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              title="Restore the field's pre-push value (counts against the daily push cap)"
              data-push-receipt-revert="true"
            >
              Revert this change
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Before / After diff block
// ─────────────────────────────────────────────────────────────────────

function DiffBlock({
  label,
  text,
  emptyLabel,
  tone,
}: {
  label: string;
  text: string | null;
  emptyLabel: string;
  tone: "before" | "after";
}) {
  const trimmed = (text ?? "").trim();
  const isEmpty = trimmed.length === 0;
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2.5",
        tone === "before"
          ? "border-border/50 bg-surface-inset/40"
          : "border-status-success/30 bg-status-success/[0.04]",
      )}
      data-push-receipt-diff={tone}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {isEmpty ? (
        <p
          className="mt-1 text-[12.5px] italic text-muted-foreground"
          data-push-receipt-diff-empty="true"
        >
          {emptyLabel}
        </p>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground/85">
          {trimmed}
        </p>
      )}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
