/**
 * /prompts v2 — single prompt card.
 *
 * Bundle (2026-05-11) — second pass at /prompts per the maximum-
 * depth UI audit. Each card is one tracked prompt, rendered as a
 * strategic surface (not an operator row):
 *
 *   • Prompt text as the headline.
 *   • Customer-safe category pill (Winning / Almost there / Missing /
 *     Outranked / Still learning).
 *   • One-line plain-English reasoning (already written by the
 *     classifier — passed verbatim).
 *   • Per-platform badges with branded names + state microcopy
 *     ("ChatGPT · Recommended first" etc.).
 *   • Top competitors when present (already cleaned by the
 *     classifier — never raw entity IDs).
 *   • Geo / topic cluster chips for context.
 *   • "View details →" CTA linking to the existing /prompts/[id]
 *     drilldown (untouched in v2A; the legacy detail stays).
 *
 * Pure presentation. No client-side state, no server-action calls.
 * Customer-vocabulary contract enforced by the projection layer —
 * this component never reads raw fields, only the typed row.
 */
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { PromptsV2CardRow } from "@/domains/prompts/v2-projection";

import { PromptsV2PlatformBadge } from "./prompts-v2-platform-badge";
import { encodePromptRouteId } from "./prompt-route-id";

const CATEGORY_PILL_TONE: Record<PromptsV2CardRow["category"]["tone"], string> = {
  success: "border-status-success/35 bg-status-success/[0.08] text-status-success",
  warning: "border-status-warning/35 bg-status-warning/[0.08] text-status-warning",
  danger: "border-status-danger/35 bg-status-danger/[0.08] text-status-danger",
  info: "border-accent-primary/35 bg-accent-primary/[0.06] text-accent-primary",
  muted: "border-border/60 bg-surface-inset/60 text-muted-foreground",
};

export function PromptsV2Card({
  row,
  className,
}: {
  row: PromptsV2CardRow;
  className?: string;
}) {
  const { text, category, reasoning, platformBadges, competitors, clusterChips } = row;

  return (
    <article
      data-prompts-v2-card="strategic-prompt"
      data-prompts-v2-card-id={row.promptId}
      data-prompts-v2-card-category={category.kind}
      className={cn(
        "rounded-lg border border-border/60 bg-surface-base px-4 py-4 transition-colors",
        "hover:border-border focus-within:border-border",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3
            className="text-[14px] font-semibold text-foreground leading-snug line-clamp-2 break-words"
            data-prompts-v2-card-text="true"
          >
            {text || "Untitled prompt"}
          </h3>
        </div>
        <span
          data-prompts-v2-card-pill={category.kind}
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap shrink-0",
            CATEGORY_PILL_TONE[category.tone],
          )}
        >
          {category.label}
        </span>
      </div>

      {reasoning && (
        <p
          className="mt-2 text-[12.5px] leading-relaxed text-foreground/80"
          data-prompts-v2-card-reasoning="true"
        >
          {reasoning}
        </p>
      )}

      {platformBadges.length > 0 && (
        <ul
          className="mt-3 flex flex-wrap gap-1.5"
          data-prompts-v2-card-platforms="true"
          aria-label="Per-platform answer state"
        >
          {platformBadges.map((badge) => (
            <li key={badge.platform}>
              <PromptsV2PlatformBadge badge={badge} />
            </li>
          ))}
        </ul>
      )}

      {(competitors.length > 0 || clusterChips.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {competitors.length > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-surface-inset/60 px-2 py-0.5 text-[11px] text-foreground/80"
              data-prompts-v2-card-competitors="true"
              title={`AI also mentions: ${competitors.join(", ")}`}
            >
              <span className="text-muted-foreground">Also cited:</span>
              <span className="font-medium">
                {competitors.slice(0, 2).join(", ")}
                {competitors.length > 2 ? ` +${competitors.length - 2}` : ""}
              </span>
            </span>
          )}
          {clusterChips.map((chip) => (
            <span
              key={`${chip.kind}-${chip.label}`}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-surface-inset/40 px-2 py-0.5 text-[11px] text-muted-foreground"
              data-prompts-v2-card-cluster={chip.kind}
            >
              <span className="font-medium text-foreground/80">{chip.kind}</span>
              <span className="opacity-60">·</span>
              <span>{chip.label.replace(/_/g, " ")}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3.5">
        <Link
          // Detail page is the existing legacy `/prompts/[id]`
          // drilldown — v2A intentionally does NOT create a new
          // detail page (that's v2B). Linking with `?v2=1` is a
          // forward-compatibility hook for when the detail also
          // gets a switcher; today the legacy page ignores it.
          href={`/prompts/${encodePromptRouteId(row.promptId)}?v2=1`}
          prefetch={false}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-border/60 bg-surface-inset/40",
            "px-2.5 py-1 text-[12px] font-semibold text-foreground/85 transition-colors",
            "hover:bg-surface-inset hover:text-foreground hover:border-border",
          )}
          data-prompts-v2-card-cta="view-details"
        >
          View details
          <span aria-hidden className="text-accent-primary">→</span>
        </Link>
      </div>
    </article>
  );
}
