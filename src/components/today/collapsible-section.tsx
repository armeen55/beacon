/**
 * Collapsible section wrapper (2026-06-15) — a thin <details>/<summary>
 * container used to DEMOTE the AEO ("AI answers") block on the unified
 * Today command center so it reads as one section among equals rather
 * than the page hero.
 *
 * Why <details> (not a useState toggle): the wrapped subtree is heavy
 * (the AEO hero + trend chart + leaderboard + descriptors, with their
 * own client state). A native <details> collapses with zero client JS
 * and — crucially — keeps the demoted subtree out of view by default
 * without us re-implementing a toggle. The children still render on the
 * server (RSC streams them once), but they sit collapsed under the
 * summary, preserving the demote-by-default intent. `defaultOpen`
 * controls the initial state: closed when the tenant has no AEO data
 * (so it never opens to an empty block), open when AEO data exists.
 *
 * Pure presentation, no client hooks — safe inside a server component
 * tree. Plain-English summary copy, no jargon, no vendor names.
 */

import type { ReactNode } from "react";

export type CollapsibleSectionProps = {
  /** Plain-English section title shown in the summary, e.g. "AI answers". */
  title: string;
  /** Optional muted one-liner under the title in the summary. */
  subtitle?: string;
  /** Whether the section starts expanded. */
  defaultOpen: boolean;
  /** Stable data-attr value for tests / telemetry, e.g. "ai-answers". */
  sectionKey: string;
  children: ReactNode;
};

export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen,
  sectionKey,
  children,
}: CollapsibleSectionProps) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-lg border border-border/60 bg-surface-inset/10"
      data-collapsible-section={sectionKey}
      data-collapsible-default-open={defaultOpen ? "true" : "false"}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
        data-collapsible-summary={sectionKey}
      >
        <span className="min-w-0">
          <span className="block text-[12px] font-semibold text-foreground tracking-tight">
            {title}
          </span>
          {subtitle ? (
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 text-[11px] text-muted-foreground transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-border/40 px-4 py-4">{children}</div>
    </details>
  );
}
