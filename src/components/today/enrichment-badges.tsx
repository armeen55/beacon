"use client";

import { cn } from "@/lib/utils";
import { structureLabel } from "@/lib/structure-labels";
import type {
  EnrichmentRollup,
  PlatformEnrichmentRollup,
} from "@/domains/prompt-answer-observations/enrichment-rollup";

/**
 * Renders today's AI-extracted brand-position signal as a compact row of
 * badges + descriptor chips. Reads from the enrichment-rollup aggregator;
 * null-safe (renders nothing when rollup is null or totalObservations=0).
 *
 * Commit 7C (2026-04-24). Surfaces the schema v2 + v2.1 extraction work:
 *   - Primary-recommendation rate per platform (the "I'm the #1 rec" signal)
 *   - Average citation rank per platform (position in citation list)
 *   - Descriptor chip cloud (adjectives AI uses near the brand)
 *   - Answer-structure mix (ranked vs bullet vs narrative)
 */

export type EnrichmentBadgesProps = {
  rollup: EnrichmentRollup | null;
  className?: string;
};

const PLATFORM_LABEL: Record<string, string> = {
  perplexity: "Perplexity",
  chatgpt: "ChatGPT",
  openai: "ChatGPT",
  google_aio: "Google AI",
};

function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

export function EnrichmentBadges({ rollup, className }: EnrichmentBadgesProps) {
  if (!rollup || rollup.totalObservations === 0) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-surface-raised/30 px-4 py-3 space-y-3",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground tracking-wide uppercase">
          How AI described you today
        </p>
        <p className="text-[10px] text-muted-foreground/70 tabular-nums">
          {rollup.totalObservations} answers · {formatDateShort(rollup.date)}
        </p>
      </div>

      {rollup.byPlatform.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rollup.byPlatform.map((p) => (
            <PlatformBadge key={p.platform} platform={p} />
          ))}
        </ul>
      )}

      {rollup.topDescriptors.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground mb-1.5">
            Words AI uses near your brand
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {rollup.topDescriptors.map((d) => (
              <li
                key={d.word}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] tabular-nums"
              >
                <span className="font-medium text-foreground">{d.word}</span>
                <span className="text-muted-foreground/70">{d.count}×</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rollup.answerStructures.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Answer shape:{" "}
          {rollup.answerStructures.map((s, i) => (
            <span key={s.structure}>
              <span className="font-medium text-foreground">
                {structureLabel(s.structure)}
              </span>
              <span className="tabular-nums ml-0.5">
                &nbsp;{s.count}
              </span>
              {i < rollup.answerStructures.length - 1 ? " · " : null}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function PlatformBadge({ platform }: { platform: PlatformEnrichmentRollup }) {
  const rankLabel =
    platform.avgCitationRank !== null
      ? `#${platform.avgCitationRank.toFixed(1)} avg cited`
      : `not cited`;
  const primaryLabel =
    platform.primaryRate !== null && platform.observations > 0
      ? `${Math.round(platform.primaryRate * 100)}% primary`
      : "no data";

  return (
    <li className="rounded-md border border-border/50 bg-background px-3 py-2 flex items-center justify-between gap-2">
      <div className="flex flex-col">
        <span className="text-[12px] font-semibold text-foreground">
          {platformLabel(platform.platform)}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {platform.observations} answer{platform.observations === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex flex-col items-end">
        <span
          className={cn(
            "text-[11px] font-medium tabular-nums",
            platform.primaryRate !== null && platform.primaryRate >= 0.5
              ? "text-status-success"
              : "text-foreground",
          )}
        >
          {primaryLabel}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {rankLabel}
        </span>
      </div>
    </li>
  );
}

function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
