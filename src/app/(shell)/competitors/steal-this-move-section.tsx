/**
 * "Their winning moves" — competitor moves joined with AI-citation
 * aftermath (§competitor-intel, 2026-06-09). Server component.
 *
 * Customer surface shows proven / early / watching only (quiet lives on
 * the operator diagnostic). Copy is temporal-associative — two dated
 * facts — never causal. Each card carries the decision-loop tie-ins:
 * the What-If evidence line (this tenant's own history) and the peer
 * forecast (gated; appears once the network is live).
 */

import Link from "next/link";
import type { CompetitorMoveWithEvidence } from "@/domains/competitor-intel/load-moves";

const MAX_CARDS = 5;

const TIER_BADGE: Record<
  string,
  { label: string; className: string }
> = {
  proven: {
    label: "Working for them",
    className:
      "bg-status-success/15 text-status-success border-status-success/30",
  },
  early: {
    label: "Too early to tell",
    className: "bg-accent-primary/10 text-accent-primary border-accent-primary/30",
  },
  watching: {
    label: "Keeping an eye on",
    className: "bg-surface-inset/60 text-muted-foreground border-border/40",
  },
};

export function StealThisMoveSection({
  moves,
}: {
  moves: CompetitorMoveWithEvidence[];
}) {
  const visible = moves
    .filter((m) => m.tier !== "quiet")
    .slice(0, MAX_CARDS);
  if (visible.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground">
        Their winning moves
      </h2>
      <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
        Pages your competitors shipped or changed, next to what AI did with
        them afterward. When a move worked for them, the equivalent move is
        one click away.
      </p>
      <div className="mt-3 space-y-2">
        {visible.map((m) => {
          const badge = TIER_BADGE[m.tier] ?? TIER_BADGE.watching!;
          return (
            <div
              key={m.id}
              data-move-tier={m.tier}
              className="rounded-lg border border-border/50 px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badge.className}`}
                >
                  {badge.label}
                </span>
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={m.path}
                  className="truncate text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                >
                  {m.displayName}
                </a>
              </div>
              <p className="mt-2 text-[13px] text-foreground leading-relaxed">
                {m.line}
              </p>
              {m.evidenceLine != null && (
                <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                  {m.evidenceLine}
                </p>
              )}
              {m.forecastLine != null && (
                <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                  {m.forecastLine}
                </p>
              )}
              <p className="mt-2 text-[12px]">
                <Link
                  href="/recommendations"
                  className="font-medium text-accent-primary hover:underline"
                >
                  {m.action.label} →
                </Link>
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
