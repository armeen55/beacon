/**
 * /changes proof timeline — "Waiting for signal" right-rail view.
 *
 * Bundle (2026-05-10) — second pass at /changes per the maximum-depth
 * UI audit. Right column on the v2 timeline that surfaces the rows
 * Beacon is actively waiting on, with a plain-English narrative
 * rewritten from the existing pattern-timing prediction.
 *
 * Pure presentation. Renders nothing when the items list is empty —
 * the timeline can stand alone without a rail.
 */
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { WaitingRailItem } from "@/domains/changes/proof-timeline/waiting-rail";

export function ChangesV2WaitingRail({
  items,
  className,
}: {
  items: ReadonlyArray<WaitingRailItem>;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <aside
      data-changes-rail="waiting-for-signal"
      className={cn(
        "rounded-lg border border-border/60 bg-surface-inset/30 px-4 py-4",
        className,
      )}
      aria-label="Waiting for signal"
    >
      <h2
        className="text-[13px] font-semibold text-foreground"
        data-changes-rail-title="true"
      >
        Waiting for signal
      </h2>
      <p className="mt-1 text-[11.5px] text-muted-foreground leading-relaxed">
        Recent changes Beacon is watching for an answer-engine response.
      </p>

      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            data-changes-rail-item="true"
            className="rounded-md border border-border/40 bg-surface-base px-3 py-2"
          >
            <Link
              href={`/changes/${item.id}?v2=1`}
              className="block group"
              data-changes-rail-item-cta="true"
            >
              <p className="text-[12.5px] font-medium text-foreground group-hover:text-accent-primary truncate">
                {item.title}
              </p>
              {item.targetUrl && (
                <p className="mt-0.5 text-[11px] font-mono text-muted-foreground truncate">
                  {item.targetUrl}
                </p>
              )}
              <p
                className="mt-1 text-[11.5px] text-muted-foreground leading-relaxed"
                data-changes-rail-item-narrative="true"
              >
                {item.narrative}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
