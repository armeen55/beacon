"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { SourceTrustIndex, PlatformTrustProfile, SourceTrustEntry } from "@/domains/competitors/source-trust-types";

const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  google_aio: "AI Overviews",
  perplexity: "Perplexity",
  unknown: "Unknown",
};

const MAX_SOURCES = 10;

export function SourceTrustSection({ index }: { index: SourceTrustIndex }) {
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);

  const meaningfulPlatforms = index.platforms.filter((p) => p.total_citations >= 10);
  if (meaningfulPlatforms.length === 0) return null;

  return (
    <section>
      <details className="group/trust">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-foreground hover:text-accent-primary transition-colors [&::-webkit-details-marker]:hidden">
          <span className="text-[9px] text-muted-foreground/50 transition-transform group-open/trust:rotate-90">▶</span>
          Where each AI gets its info
        </summary>
        <div className="mt-3 space-y-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Based on how often each AI names different websites across{" "}
            {index.total_citations_analyzed.toLocaleString()} AI answers we checked.
          </p>

          {meaningfulPlatforms.map((platform) => (
            <PlatformTrustCard
              key={platform.platform}
              profile={platform}
              expanded={expandedPlatform === platform.platform}
              onToggle={() =>
                setExpandedPlatform(
                  expandedPlatform === platform.platform ? null : platform.platform,
                )
              }
            />
          ))}

          <p className="text-[10px] text-muted-foreground/60">
            Computed {new Date(index.computed_at).toLocaleDateString()} from your last citation pull.
            Refresh your connected data to update this index.
          </p>
        </div>
      </details>
    </section>
  );
}

function PlatformTrustCard({
  profile,
  expanded,
  onToggle,
}: {
  profile: PlatformTrustProfile;
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = PLATFORM_LABELS[profile.platform] ?? profile.platform;
  const visibleSources = expanded
    ? profile.top_sources.slice(0, MAX_SOURCES)
    : profile.top_sources.slice(0, 5);

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-surface-inset/25 hover:bg-surface-inset/40 transition-colors text-left"
      >
        <div>
          <span className="text-[12px] font-semibold text-foreground">{label}</span>
          <span className="text-[10px] text-muted-foreground ml-2">
            {profile.total_citations.toLocaleString()} citations
          </span>
          {profile.owned_rank !== null && (
            <span
              className={cn(
                "text-[10px] font-medium ml-2",
                profile.owned_rank <= 5
                  ? "text-status-success"
                  : profile.owned_rank <= 10
                    ? "text-foreground"
                    : "text-muted-foreground",
              )}
            >
              You: #{profile.owned_rank} ({profile.owned_share_pct}%)
            </span>
          )}
        </div>
        <span className="text-[9px] text-muted-foreground/50">{expanded ? "▼" : "▶"}</span>
      </button>

      {expanded && (
        <div className="border-t border-border/50">
          <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 px-3 py-1.5 text-[10px] font-medium text-muted-foreground bg-surface-inset/30">
            <span>#</span>
            <span>Website</span>
            <span className="text-right">Times named</span>
            <span className="text-right">Share</span>
          </div>
          {visibleSources.map((entry, i) => (
            <SourceRow key={entry.domain} entry={entry} rank={i + 1} maxCitations={profile.top_sources[0]?.citation_count ?? 1} />
          ))}
          {profile.top_sources.length > MAX_SOURCES && (
            <p className="px-3 py-2 text-[10px] text-muted-foreground/60">
              {profile.top_sources.length - MAX_SOURCES} more sources below threshold
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SourceRow({ entry, rank, maxCitations }: { entry: SourceTrustEntry; rank: number; maxCitations: number }) {
  const barWidth = maxCitations > 0 ? (entry.citation_count / maxCitations) * 100 : 0;
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr_auto_auto] gap-x-3 items-center px-3 py-2 border-b border-border/40 last:border-b-0",
        entry.is_owned && "bg-status-success/[0.04]",
        entry.is_competitor && !entry.is_owned && "bg-status-danger/[0.03]",
      )}
    >
      <span className="text-[10px] text-muted-foreground tabular-nums w-5 text-right">{rank}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium font-mono truncate">{entry.domain}</span>
          {entry.is_owned && (
            <span className="text-[9px] font-medium text-status-success border border-status-success/20 rounded px-1 py-px shrink-0">you</span>
          )}
          {entry.is_competitor && !entry.is_owned && (
            <span className="text-[9px] font-medium text-status-danger/70 shrink-0">competitor</span>
          )}
        </div>
        <div className="h-1 rounded-full bg-border/20 mt-1 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              entry.is_owned ? "bg-status-success/60" : entry.is_competitor ? "bg-status-danger/40" : "bg-muted-foreground/25",
            )}
            style={{ width: `${Math.max(barWidth, 1)}%` }}
          />
        </div>
      </div>
      <span className="text-right text-[11px] font-semibold tabular-nums">
        {entry.citation_count.toLocaleString()}
      </span>
      <span className="text-right text-[10px] tabular-nums text-muted-foreground w-12">
        {entry.share_pct}%
      </span>
    </div>
  );
}
