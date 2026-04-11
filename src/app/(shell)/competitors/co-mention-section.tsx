"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { MiniBarChart } from "@/components/viz/mini-bar-chart";
import { FilterChips } from "@/components/viz/filter-chips";
import { ViewToggle } from "@/components/viz/view-toggle";
import type { CoMentionMatrix, CoMentionEntry } from "@/domains/competitors/co-mention-types";

const MAX_VISIBLE = 10;
const MAX_EXPANDED = 25;

export function CoMentionSection({ matrix }: { matrix: CoMentionMatrix }) {
  const [expanded, setExpanded] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "known" | "discovered">("all");
  const [view, setView] = useState<"table" | "chart">("table");

  const discoveredOutside = matrix.entries.filter((e) => !e.is_in_universe);

  const filtered = statusFilter === "all"
    ? matrix.entries
    : statusFilter === "discovered"
      ? matrix.entries.filter((e) => !e.is_in_universe)
      : matrix.entries.filter((e) => e.is_in_universe);

  const displayEntries = expanded
    ? filtered.slice(0, MAX_EXPANDED)
    : filtered.slice(0, MAX_VISIBLE);

  const hasMore = filtered.length > (expanded ? MAX_EXPANDED : MAX_VISIBLE);

  const chartEntries = filtered.slice(0, 12).map((e) => ({
    label: e.domain,
    value: e.co_occurrence_count,
    meta: `${Math.round(e.co_mention_strength * 100)}% strength · ${e.topics.slice(0, 2).join(", ")}`,
  }));

  return (
    <section>
      <details className="group/comention">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-foreground hover:text-accent-primary transition-colors [&::-webkit-details-marker]:hidden">
          <span className="text-[9px] text-muted-foreground/50 transition-transform group-open/comention:rotate-90">▶</span>
          AI-era competitors
          {discoveredOutside.length > 0 && (
            <span className="text-[10px] font-medium text-accent-primary ml-1">
              {discoveredOutside.length} discovered
            </span>
          )}
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Domains that appear alongside yours in AI answers — ranked by co-occurrence frequency
            across {matrix.total_answers_analyzed.toLocaleString()} analyzed responses.
            {discoveredOutside.length > 0 && (
              <span className="text-foreground font-medium">
                {" "}{discoveredOutside.length} are not in your configured competitor universe.
              </span>
            )}
          </p>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <FilterChips
              chips={[
                { id: "all", label: `All (${matrix.entries.length})`, active: statusFilter === "all" },
                { id: "known", label: `Known (${matrix.entries.filter((e) => e.is_in_universe).length})`, active: statusFilter === "known" },
                { id: "discovered", label: `Discovered (${discoveredOutside.length})`, active: statusFilter === "discovered" },
              ]}
              onToggle={(id) => setStatusFilter(id as "all" | "known" | "discovered")}
              allowMultiple={false}
            />
            <ViewToggle
              options={[{ value: "table" as const, label: "Table" }, { value: "chart" as const, label: "Chart" }]}
              value={view}
              onChange={setView}
              size="sm"
            />
          </div>

          {view === "chart" ? (
            <div className="rounded-lg border border-border/60 p-4">
              <MiniBarChart
                entries={chartEntries}
                title="Co-mention frequency"
                subtitle="Top domains by co-occurrence count"
                colorScheme="competitive"
              />
            </div>
          ) : (
            <div className="rounded-lg border border-border/70 overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-2 bg-surface-inset/50 text-[10px] font-medium text-muted-foreground border-b border-border/60">
                <span>Domain</span>
                <span className="text-right">Co-mentions</span>
                <span className="text-right hidden sm:block">Strength</span>
                <span className="text-right hidden sm:block">Status</span>
              </div>
              {displayEntries.map((entry) => (
                <CoMentionRow key={entry.domain} entry={entry} maxCount={filtered[0]?.co_occurrence_count ?? 1} />
              ))}
            </div>
          )}

          {view === "table" && hasMore && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-accent-primary hover:underline font-medium"
            >
              {expanded ? "Show fewer" : `Show more (${filtered.length} total)`}
            </button>
          )}

          <p className="text-[10px] text-muted-foreground/60">
            Computed {new Date(matrix.computed_at).toLocaleDateString()} from citation co-occurrence in imported Profound data.
            Strength = co-mention count / total domain appearances.
          </p>
        </div>
      </details>
    </section>
  );
}

function CoMentionRow({ entry, maxCount }: { entry: CoMentionEntry; maxCount: number }) {
  const strengthPct = Math.round(entry.co_mention_strength * 100);
  const isDiscovered = !entry.is_in_universe;
  const barWidth = maxCount > 0 ? (entry.co_occurrence_count / maxCount) * 100 : 0;

  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-3 py-2.5 border-b border-border/50 last:border-b-0 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center",
        isDiscovered && "bg-accent-primary/[0.03]",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-x-2">
          <span className="text-[12px] font-semibold text-foreground font-mono truncate">
            {entry.domain}
          </span>
          {isDiscovered && (
            <span className="text-[9px] font-medium text-accent-primary shrink-0 border border-accent-primary/20 rounded px-1 py-px">
              new
            </span>
          )}
        </div>
        {entry.topics.length > 0 && (
          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
            {entry.topics.slice(0, 3).join(", ")}
            {entry.topics.length > 3 && ` +${entry.topics.length - 3}`}
          </p>
        )}
        <div className="h-1 rounded-full bg-border/20 mt-1 overflow-hidden hidden sm:block">
          <div className="h-full rounded-full bg-accent-primary/50 transition-all" style={{ width: `${Math.max(barWidth, 1)}%` }} />
        </div>
        <div className="flex gap-2 mt-1 sm:hidden text-[10px] text-muted-foreground tabular-nums">
          <span>{entry.co_occurrence_count} co-mentions</span>
          <span>{strengthPct}% strength</span>
        </div>
      </div>
      <span className="text-right text-[12px] font-semibold tabular-nums hidden sm:block">
        {entry.co_occurrence_count}
      </span>
      <span className="text-right text-[11px] tabular-nums text-muted-foreground hidden sm:block">
        {strengthPct}%
      </span>
      <span
        className={cn(
          "text-right text-[10px] font-medium hidden sm:block",
          isDiscovered ? "text-accent-primary" : "text-muted-foreground/60",
        )}
      >
        {isDiscovered ? "Discovered" : "Known"}
      </span>
    </div>
  );
}
