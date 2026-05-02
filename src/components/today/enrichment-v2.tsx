"use client";

/**
 * W2 Step 2.3 (master plan) — "How AI described you this week" v2.
 *
 * Replaces the prior single-day EnrichmentBadges. Renders FOUR sections
 * in a deliberately spare layout:
 *
 *   1. Who AI thinks YOU are       (brand descriptors + rank deltas)
 *   2. Who AI thinks THEY are      (selected competitor's descriptors)
 *   3. Where AI ranks you          (per-platform primary % + sparkline)
 *   4. What format wins            (per-platform answer-shape sentence)
 *
 * Pure UI consumption — every product-intelligence decision lives in
 * the Step 2.2 / 2.2b data layer. This file does NOT compute deltas,
 * does NOT decide defaults, does NOT re-derive percentages. It maps
 * data-layer fields to copy + visuals via STRUCTURE_LABEL / PLATFORM_LABEL.
 *
 * Layout discipline (operator-locked):
 *   - Premium and obvious, not analytics dashboard.
 *   - Sections 1+2 share a row on desktop, stack at 375px.
 *   - Sections 3+4 span full width.
 *   - Thin samples render softer copy; never hide.
 *   - Empty states surface a precise reason from `emptyStateReason`.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import type {
  CompetitorDropdownEntry,
  CompetitorEnrichmentEmptyReason,
  CompetitorEnrichmentRollup,
  DescriptorWithDelta,
  EnrichmentV2Data,
  EnrichmentWindowRollup,
  FormatWinsRollup,
  PlatformPrimaryRateSparkline,
  SampleStatus,
} from "@/domains/prompt-answer-observations/enrichment-rollup";
import { Sparkline } from "./sparkline";
import { CompetitorSelect } from "./competitor-select";
import { platformLabel, structureLabel } from "@/lib/structure-labels";

export type { EnrichmentV2Data };

export type EnrichmentV2Props = {
  data: EnrichmentV2Data | null;
  className?: string;
};

export function EnrichmentV2({ data, className }: EnrichmentV2Props) {
  // Initial competitor: data-layer's isDefault entry. CompetitorSelect
  // handles localStorage hydration on mount (and silently falls back
  // when the stored name no longer appears in options).
  const initialCompetitor =
    data?.competitorOptions.find((o) => o.isDefault)?.name ??
    data?.competitorOptions[0]?.name ??
    "";
  const [competitorName, setCompetitorName] = useState<string>(initialCompetitor);

  if (!data) return null;

  const competitor = competitorName
    ? data.competitorRollups[competitorName] ?? null
    : null;

  return (
    <section
      className={cn(
        "rounded-lg border border-border/60 bg-surface-raised/30 px-5 pt-5 pb-5 space-y-6",
        className,
      )}
      data-today-section="enrichment-v2"
    >
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-[13px] font-semibold text-foreground tracking-tight">
          How AI described you this week
        </h2>
        <p className="text-[10px] text-muted-foreground/70 tabular-nums">
          {data.brand.currentWindow.totalObservations} answer
          {data.brand.currentWindow.totalObservations === 1 ? "" : "s"} ·{" "}
          last {data.windowDays} days
        </p>
      </header>

      {/* Sections 1 + 2 share a row on desktop; stack on mobile. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
        <WhoAIThinksYouAre brandName={data.brandName} brand={data.brand} />
        <WhoAIThinksTheyAre
          options={data.competitorOptions}
          competitor={competitor}
          competitorName={competitorName}
          onCompetitorChange={setCompetitorName}
        />
      </div>

      {/* Section 3 — full width sparkline list. */}
      <WhereAIRanksYou sparklines={data.sparklines} />

      {/* Section 4 — full width sentences. */}
      <WhatFormatWins rollups={data.formatWins} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 1: WhoAIThinksYouAre
// ---------------------------------------------------------------------------

function WhoAIThinksYouAre({
  brandName,
  brand,
}: {
  brandName: string;
  brand: EnrichmentWindowRollup;
}) {
  return (
    <div className="space-y-3">
      <header>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
          Who AI thinks you are
        </h3>
        <p className="mt-0.5 text-[12px] font-semibold text-foreground">
          {brandName}
        </p>
      </header>
      <DescriptorList
        descriptors={brand.topDescriptorsWithDelta}
        sampleStatus={brand.sampleStatus}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 2: WhoAIThinksTheyAre — competitor descriptors
// ---------------------------------------------------------------------------

function WhoAIThinksTheyAre({
  options,
  competitor,
  competitorName,
  onCompetitorChange,
}: {
  options: ReadonlyArray<CompetitorDropdownEntry>;
  competitor: CompetitorEnrichmentRollup | null;
  competitorName: string;
  onCompetitorChange: (next: string) => void;
}) {
  if (options.length === 0) {
    return (
      <div className="space-y-3">
        <header>
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
            Who AI thinks they are
          </h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            No competitors tracked yet
          </p>
        </header>
        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
          Add competitors to compare how AI describes them next to you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <header className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
          Who AI thinks they are
        </h3>
        <CompetitorSelect
          options={options}
          value={competitorName}
          onChange={onCompetitorChange}
        />
      </header>
      <CompetitorDescriptorList competitor={competitor} />
    </div>
  );
}

function CompetitorDescriptorList({
  competitor,
}: {
  competitor: CompetitorEnrichmentRollup | null;
}) {
  if (!competitor || competitor.emptyStateReason !== null) {
    return <CompetitorEmptyState reason={competitor?.emptyStateReason ?? null} />;
  }
  return (
    <DescriptorList
      descriptors={competitor.topDescriptorsWithDelta}
      sampleStatus={competitor.sampleStatus}
    />
  );
}

const COMPETITOR_EMPTY_COPY: Record<CompetitorEnrichmentEmptyReason, string> = {
  no_observations_in_window: "Not enough AI answers in this window yet.",
  no_descriptor_field_yet: "Competitor descriptor data is still warming up.",
  competitor_not_mentioned: "AI did not mention this competitor in this window.",
};

function CompetitorEmptyState({
  reason,
}: {
  reason: CompetitorEnrichmentEmptyReason | null;
}) {
  const copy = reason
    ? COMPETITOR_EMPTY_COPY[reason]
    : "No competitor descriptor data yet.";
  return (
    <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
      {copy}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Shared descriptor list (used by both brand + competitor sections)
// ---------------------------------------------------------------------------

function DescriptorList({
  descriptors,
  sampleStatus,
}: {
  descriptors: ReadonlyArray<DescriptorWithDelta>;
  sampleStatus: SampleStatus;
}) {
  if (descriptors.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
        {sampleStatus === "empty"
          ? "AI hasn't described you on this prompt set yet."
          : "Not enough descriptor signal yet."}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {descriptors.map((d, i) => (
          <DescriptorRow key={d.word} index={i} entry={d} />
        ))}
      </ul>
      {sampleStatus === "thin" && (
        <p className="text-[10px] text-muted-foreground/60 leading-snug">
          Early signal — based on a few answers so far.
        </p>
      )}
    </div>
  );
}

function DescriptorRow({
  index,
  entry,
}: {
  index: number;
  entry: DescriptorWithDelta;
}) {
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-baseline gap-2 text-[12px]">
      <span className="text-[10px] tabular-nums text-muted-foreground/60 w-3 text-right">
        #{index + 1}
      </span>
      <span className="font-medium text-foreground truncate">{entry.word}</span>
      <DeltaBadge entry={entry} />
    </li>
  );
}

function DeltaBadge({ entry }: { entry: DescriptorWithDelta }) {
  // "new" — descriptor wasn't in the prior window's top-N at all.
  if (entry.rankPriorWindow === null && entry.delta === null) {
    return (
      <span className="text-[9px] font-semibold uppercase tracking-wider text-accent-primary bg-accent-primary/10 px-1.5 py-0.5 rounded">
        new
      </span>
    );
  }
  if (entry.delta === null) {
    return <span className="text-[10px] text-muted-foreground/40">—</span>;
  }
  if (entry.delta === 0) {
    return (
      <span
        className="text-[10px] text-muted-foreground/60"
        title="Same rank as previous window"
      >
        —
      </span>
    );
  }
  if (entry.delta > 0) {
    return (
      <span
        className="text-[10px] font-medium tabular-nums text-status-success"
        title={`Up ${entry.delta} ${entry.delta === 1 ? "spot" : "spots"} from previous window`}
      >
        ↑{entry.delta}
      </span>
    );
  }
  return (
    <span
      className="text-[10px] font-medium tabular-nums text-status-danger"
      title={`Down ${Math.abs(entry.delta)} ${Math.abs(entry.delta) === 1 ? "spot" : "spots"} from previous window`}
    >
      ↓{Math.abs(entry.delta)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Section 3: WhereAIRanksYou — per-platform primary % + sparkline
// ---------------------------------------------------------------------------

function WhereAIRanksYou({
  sparklines,
}: {
  sparklines: ReadonlyArray<PlatformPrimaryRateSparkline>;
}) {
  if (sparklines.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
          Where AI ranks you
        </h3>
        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
          Ranking data is still warming up.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
        Where AI ranks you
      </h3>
      <ul className="space-y-1.5">
        {sparklines.map((s) => (
          <PlatformRankRow key={s.platform} sparkline={s} />
        ))}
      </ul>
    </div>
  );
}

function PlatformRankRow({
  sparkline,
}: {
  sparkline: PlatformPrimaryRateSparkline;
}) {
  // The latest sampled point is the most recent primary rate.
  const latest = [...sparkline.points]
    .reverse()
    .find((p) => p.primaryRate !== null);

  // For thin sample, soften the headline copy.
  const isThin = sparkline.sampleStatus === "thin";
  const isEmpty = sparkline.sampleStatus === "empty";

  return (
    <li className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-[12px]">
      <span className="font-medium text-foreground truncate">
        {platformLabel(sparkline.platform)}
      </span>
      <span className="text-muted-foreground tabular-nums">
        {isEmpty ? (
          <span className="text-muted-foreground/50">No data yet</span>
        ) : latest && latest.primaryRate !== null ? (
          <>
            Primary {Math.round(latest.primaryRate * 100)}%
            {isThin && (
              <span className="ml-1.5 text-[10px] text-muted-foreground/60">
                (early data)
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground/50">No data yet</span>
        )}
      </span>
      <Sparkline
        points={sparkline.points.map((p) => p.primaryRate)}
        ariaLabel={`${platformLabel(sparkline.platform)} primary rate trend`}
      />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Section 4: WhatFormatWins — per-platform answer-shape sentence
// ---------------------------------------------------------------------------

function WhatFormatWins({
  rollups,
}: {
  rollups: ReadonlyArray<FormatWinsRollup>;
}) {
  // Only show platforms that actually have signal.
  const renderable = rollups.filter((r) => r.sampleStatus !== "empty");

  if (renderable.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
          What format wins
        </h3>
        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
          Not enough format data yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
        What format wins
      </h3>
      <ul className="space-y-1">
        {renderable.map((r) => (
          <li
            key={r.platform}
            className="text-[12px] text-foreground leading-relaxed"
          >
            <FormatSentence rollup={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FormatSentence({ rollup }: { rollup: FormatWinsRollup }) {
  if (
    rollup.dominantStructure === null ||
    rollup.dominantPct === null ||
    rollup.sampleCount === 0
  ) {
    return (
      <span className="text-muted-foreground/70">
        {platformLabel(rollup.platform)} — not enough data yet.
      </span>
    );
  }
  const platform = platformLabel(rollup.platform);
  const structure = structureLabel(rollup.dominantStructure);
  const pct = Math.round(rollup.dominantPct * 100);

  if (rollup.sampleStatus === "thin") {
    return (
      <span>
        <span className="font-medium">{platform}</span> is mostly using{" "}
        <span className="font-medium">{structure.toLowerCase()}</span> so far{" "}
        <span className="text-[10px] text-muted-foreground/60">
          (early data)
        </span>
        .
      </span>
    );
  }
  return (
    <span>
      <span className="font-medium">{platform}</span> prefers{" "}
      <span className="font-medium">{structure}</span> ({pct}%).
    </span>
  );
}
