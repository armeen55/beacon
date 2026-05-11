/**
 * /changes proof timeline — single card.
 *
 * Bundle (2026-05-10) — second pass at /changes per the maximum-depth
 * UI audit. Each card is one shipped (or watching) change in the
 * vertical timeline, rendered with:
 *
 *   • Plain-English title (the change_description).
 *   • Customer-friendly target URL when present.
 *   • Shipped date as a short calendar label.
 *   • ONE result pill (Helping / Hurting / Too early / No signal yet /
 *     Needs review / Live / Watching), driven by the pure resolver.
 *   • A one-line outcome blurb from the same resolver.
 *   • Optional pattern-timing line ("Similar changes usually show
 *     signal around day N") when the row has a readyOn prediction.
 *   • "Open change →" CTA → /changes/[id].
 *
 * Pure presentation. No client-side state, no server-action calls.
 * The card never renders raw schema fields, scores, ids, hashes, or
 * any internal vocabulary.
 */
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { ProofPill } from "@/domains/changes/proof-timeline/result-pill";

import { ChangesV2ResultPill } from "./changes-v2-result-pill";

export type ChangesV2CardRow = {
  id: string;
  title: string;
  targetUrl: string | null;
  shippedAt: string;
  pill: ProofPill;
  patternTimingNarrative: string | null;
};

export function ChangesV2Card({
  row,
  className,
}: {
  row: ChangesV2CardRow;
  className?: string;
}) {
  return (
    <article
      data-changes-card="proof-timeline"
      data-changes-card-id={row.id}
      className={cn(
        "rounded-lg border border-border/60 bg-surface-base px-4 py-4 transition-colors",
        "hover:border-border focus-within:border-border",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3
            className="text-[14px] font-semibold text-foreground leading-snug"
            data-changes-card-title="true"
          >
            {row.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            {row.targetUrl && (
              <span
                className="font-mono truncate max-w-[280px]"
                data-changes-card-url="true"
                title={row.targetUrl}
              >
                {row.targetUrl}
              </span>
            )}
            <span
              className="tabular-nums"
              data-changes-card-shipped-at="true"
            >
              {formatShippedAt(row.shippedAt)}
            </span>
          </div>
        </div>

        <ChangesV2ResultPill pill={row.pill} />
      </div>

      <p
        className="mt-2 text-[12.5px] leading-relaxed text-foreground/80"
        data-changes-card-blurb="true"
      >
        {row.pill.blurb}
      </p>

      {row.patternTimingNarrative && (
        <p
          className="mt-1 text-[11.5px] text-muted-foreground leading-relaxed"
          data-changes-card-pattern-timing="true"
        >
          {row.patternTimingNarrative}
        </p>
      )}

      <div className="mt-3">
        <Link
          href={`/changes/${row.id}`}
          className="inline-flex items-center text-[12px] font-medium text-accent-primary hover:underline"
          data-changes-card-cta="open-change"
        >
          Open change →
        </Link>
      </div>
    </article>
  );
}

function formatShippedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
