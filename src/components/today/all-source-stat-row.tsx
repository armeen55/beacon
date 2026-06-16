/**
 * All-source stat row (2026-06-15) — the unified Today command center's
 * top scoreboard. One compact card per source that ACTUALLY has data
 * (Search / Visits / Rankings / Experience / AI answers as equals).
 *
 * Beacon is not an AEO tool — AEO is ~30–50% of what we do, so this row
 * leads the page with whatever is richest for the tenant and treats AI
 * answers as one card among many.
 *
 * Pure presentation. Receives the already-reduced cards from
 * `buildSourceStatCards` (server-side) and renders a responsive grid of
 * small cards, reusing the existing card styling (rounded-lg border
 * border-border/60 bg-surface-inset, text-[12px] labels, tabular-nums
 * numbers — mirrors data-sources-strip.tsx + edit-lifecycle-tile.tsx).
 *
 * No client JS. Plain English, no jargon, no vendor names ("AI answers"
 * never "Profound"). Honest: every card shows a real number or the
 * source isn't here at all (the helper gates on data presence).
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import type {
  SourceStatCard,
  SourceSubline,
} from "@/domains/today-summary/build-source-stat-cards";
import { StatSparkline } from "@/components/today/stat-sparkline";

function sublineToneClass(tone: SourceSubline["tone"]): string {
  switch (tone) {
    case "up":
      return "text-status-success";
    case "down":
      return "text-status-warning";
    default:
      return "text-muted-foreground";
  }
}

function sublineGlyph(tone: SourceSubline["tone"]): string {
  switch (tone) {
    case "up":
      return "↑";
    case "down":
      return "↓";
    default:
      return "·";
  }
}

function StatCard({ card }: { card: SourceStatCard }) {
  return (
    <li
      className="rounded-lg border border-border/60 bg-surface-inset/20 px-4 py-3"
      data-all-source-card={card.key}
    >
      <h3 className="text-[12px] font-semibold text-foreground tracking-tight">
        {card.source}
      </h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
        {card.stats.map((stat, i) => (
          <div key={i} data-all-source-stat={i}>
            <dd className="text-[18px] font-semibold leading-none text-foreground tabular-nums">
              {stat.value}
            </dd>
            <dt className="mt-1 text-[11px] leading-tight text-muted-foreground">
              {stat.label}
            </dt>
          </div>
        ))}
      </dl>
      {card.sparkline ? <StatSparkline values={card.sparkline} /> : null}
      {card.subline ? (
        <p
          className={cn(
            "mt-2.5 text-[11px] leading-tight",
            sublineToneClass(card.subline.tone),
          )}
          data-all-source-subline={card.subline.tone}
        >
          <span aria-hidden="true">{sublineGlyph(card.subline.tone)} </span>
          {card.subline.text}
        </p>
      ) : null}
      {card.topDeclines && card.topDeclines.length > 0 ? (
        <div className="mt-2.5" data-all-source-declines={card.key}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Biggest drops
          </p>
          <ul className="mt-1 space-y-0.5">
            {card.topDeclines.map((d) => (
              <li
                key={d.path}
                className="flex items-baseline justify-between gap-2 text-[11px]"
              >
                <span className="truncate font-mono text-muted-foreground">
                  {d.path}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-status-warning">
                  −{d.dropPct}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {card.action ? (
        <Link
          href={card.action.href}
          className="mt-2 inline-flex text-[11px] font-semibold text-accent-primary hover:underline"
          data-all-source-action={card.key}
        >
          {card.action.label}
        </Link>
      ) : null}
    </li>
  );
}

export function AllSourceStatRow({ cards }: { cards: SourceStatCard[] }) {
  // Caller already returns null when empty, but be defensive.
  if (cards.length === 0) return null;
  return (
    <section
      aria-label="Your numbers across every connected source"
      data-all-source-stat-row="true"
      data-all-source-card-count={cards.length}
    >
      <h2 className="text-[12px] font-semibold text-foreground tracking-tight">
        Your numbers, all in one place
      </h2>
      <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <StatCard key={card.key} card={card} />
        ))}
      </ul>
    </section>
  );
}
