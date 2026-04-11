"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { StatCard } from "@/components/data/stat-card";
import { TabFilter } from "@/components/display/tab-filter";
import { DeltaIndicator } from "@/components/display/delta-indicator";
import { KpiCard } from "@/components/viz/kpi-card";
import { DonutRing } from "@/components/viz/donut-ring";
import { PlatformSplit } from "@/components/viz/platform-split";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PLATFORM_LABELS, METRIC_TYPE_LABELS, METRIC_DIRECTION } from "@/lib/constants";
import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { EvidenceTier } from "@/domains/pages/types";
import type {
  ResultDriverInfo,
  ResultDriverTrust,
} from "@/domains/attribution/result-drivers";
import { resultVisibilityRowLegacyUnstamped } from "@/domains/results/visibility-provenance";
import type { ResultsCompetitorUniverseSummary } from "@/domains/competitors/universe-banners";

export type { ResultDriverInfo, ResultDriverTrust as DriverTrust };

const platformTabs = [
  { label: "All Platforms", value: "all" },
  { label: "ChatGPT", value: "chatgpt" },
  { label: "Google AIO", value: "google_aio" },
  { label: "Perplexity", value: "perplexity" },
];

const TRUST_CONFIG: Record<
  ResultDriverTrust,
  { dot: string; label: string; text: string }
> = {
  confirmed: {
    dot: "bg-status-success",
    label: "Review locked",
    text: "text-status-success",
  },
  auto_cleared: {
    dot: "bg-accent-primary",
    label: "Auto-cleared",
    text: "text-accent-primary",
  },
  system_primary: {
    dot: "bg-accent-primary",
    label: "System pick",
    text: "text-accent-primary",
  },
  contributing: {
    dot: "bg-status-warning",
    label: "Contributing",
    text: "text-status-warning",
  },
  unresolved: {
    dot: "bg-muted-foreground/50",
    label: "Needs review",
    text: "text-muted-foreground",
  },
};

const TIER_LABELS: Record<EvidenceTier, string> = {
  exact: "Exact",
  probable: "Probable",
  weak: "Weak",
  inferred: "Inferred",
};

function CompetitorUniverseSampleStrip({
  summary,
}: {
  summary: ResultsCompetitorUniverseSummary;
}) {
  const originLabel =
    summary.origin === "configured_file"
      ? "Workspace file"
      : summary.origin === "demo_defaults_explicit"
        ? "Demo defaults (explicit)"
        : "None configured";
  return (
    <div className="text-[10px] border-t border-border pt-2 mt-2 space-y-1">
      <p>
        <span className="font-semibold text-foreground">
          Configured competitor universe:{" "}
        </span>
        {summary.activeConfiguredCount} active ({originLabel})
        {summary.configuredNamesPreview.length > 0 && (
          <span className="text-muted-foreground">
            {" "}
            — e.g. {summary.configuredNamesPreview.slice(0, 3).join(", ")}
            {summary.configuredNamesPreview.length > 3 ? "…" : ""}
          </span>
        )}
      </p>
      <p className="text-muted-foreground">
        Top cited external domains in this index:{" "}
        <span className="text-foreground tabular-nums">
          {summary.topCitedConfiguredCount}
        </span>{" "}
        match configured hostnames ·{" "}
        <span className="text-foreground tabular-nums">
          {summary.topCitedUncategorizedCount}
        </span>{" "}
        uncategorized sample ·{" "}
        <span className="text-foreground tabular-nums">
          {summary.topCitedImportEntityCount}
        </span>{" "}
        overlap imported entity hostnames only (not in universe file).
      </p>
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">Current workspace pin: </span>
        v{summary.currentUniverseVersion ?? "—"} ·{" "}
        {summary.currentUniverseFingerprintShort ?? "—"}…
        {summary.currentUniverseLegacyUnversionedFile ? " · legacy file" : ""}
        {summary.currentUniverseFingerprintMismatch ? " · fingerprint drift" : ""}
      </p>
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">Dominant visibility run pin: </span>
        {summary.visibilityRunPinStatus ?? "—"}
        {summary.visibilityRunUniverseFingerprintShort
          ? ` · ${summary.visibilityRunUniverseFingerprintShort}… (v${summary.visibilityRunUniverseVersion ?? "—"})`
          : ""}
      </p>
      {summary.competitorUniverseDriftNote && (
        <p className="text-status-warning font-medium">{summary.competitorUniverseDriftNote}</p>
      )}
    </div>
  );
}

export type SampleObservationContext = {
  importedRowCount: number;
  visibilityRunId: string | null;
  visibilityRunHref: string | null;
  visibilitySynthetic: boolean;
  visibilityScopeLabel: string | null;
  latestCrawlCompletedAt: string | null;
  visibilityStaleVsCrawl: boolean;
  staleNote: string | null;
  /** When primary grid run ≠ citation rollup used for crawl staleness. */
  rollupStalenessNote: string | null;
  /** Citation top domains vs workspace universe (null if no index). */
  competitorUniverseSummary: ResultsCompetitorUniverseSummary | null;
};

interface ResultsClientProps {
  results: Result[];
  changelogEntries: ChangelogEntry[];
  opportunities: Opportunity[];
  drivers: Record<string, ResultDriverInfo>;
  sampleObservation: SampleObservationContext;
}

export function ResultsClient({
  results,
  changelogEntries,
  opportunities,
  drivers,
  sampleObservation,
}: ResultsClientProps) {
  const [activePlatform, setActivePlatform] = useState("all");
  const [trustFilter, setTrustFilter] = useState<
    ResultDriverTrust | "all" | "none"
  >(() => {
    const driverCount = Object.values(drivers).filter(Boolean).length;
    return driverCount > 0 && driverCount < results.length ? "confirmed" : "all";
  });

  const filtered = useMemo(() => {
    let list = results;
    if (activePlatform !== "all") {
      list = list.filter((r) => r.platform === activePlatform);
    }
    if (trustFilter !== "all") {
      if (trustFilter === "none") {
        list = list.filter((r) => !drivers[r.id]);
      } else {
        list = list.filter((r) => drivers[r.id]?.trust === trustFilter);
      }
    }
    return list;
  }, [results, activePlatform, trustFilter, drivers]);

  const sorted = [...filtered].sort(
    (a, b) =>
      new Date(b.snapshot_date).getTime() - new Date(a.snapshot_date).getTime()
  );

  const platformCounts: Record<string, number> = { all: results.length };
  for (const r of results) {
    platformCounts[r.platform] = (platformCounts[r.platform] ?? 0) + 1;
  }

  // Real attribution-driven stats
  const withDriver = results.filter((r) => !!drivers[r.id]).length;
  const confirmedCount = results.filter(
    (r) => drivers[r.id]?.trust === "confirmed"
  ).length;
  const autoClearedCount = results.filter(
    (r) =>
      drivers[r.id]?.trust === "auto_cleared" ||
      drivers[r.id]?.trust === "system_primary"
  ).length;
  const unresolvedCount = results.filter(
    (r) => drivers[r.id]?.trust === "unresolved"
  ).length;

  const stampedRowCount = useMemo(
    () => results.filter((r) => !!r.visibility_observation_run_id).length,
    [results]
  );
  const legacyUnstampedCount = useMemo(
    () => results.filter((r) => resultVisibilityRowLegacyUnstamped(r)).length,
    [results]
  );
  const runGroups = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of results) {
      const id = r.visibility_observation_run_id?.trim();
      if (!id) continue;
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [results]);

  return (
    <div>
      <PageHeader
        title="History"
        description="Every row is a raw visibility measurement. Suggested causes are separate — they do not change the measurement."
      />

      <div className="rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <KpiCard label="Sample Rows" value={sampleObservation.importedRowCount} />
          <KpiCard label="Run-Linked" value={stampedRowCount} meta={`${results.length - stampedRowCount} unlinked`} />
          <KpiCard label="With Cause" value={withDriver} meta={withDriver > 0 ? `${Math.round((withDriver / results.length) * 100)}% attributed` : undefined} />
          <KpiCard label="Review Locked" value={confirmedCount} />
        </div>
        <div className="flex items-center gap-4 flex-wrap text-[11px] text-muted-foreground">
          {sampleObservation.visibilityRunHref && sampleObservation.visibilityRunId && (
            <span>
              Primary run{" "}
              <Link
                href={sampleObservation.visibilityRunHref}
                className="text-accent-primary font-medium hover:underline font-mono text-[10px]"
              >
                {sampleObservation.visibilityRunId.length > 24
                  ? `${sampleObservation.visibilityRunId.slice(0, 24)}…`
                  : sampleObservation.visibilityRunId}
              </Link>
            </span>
          )}
          {sampleObservation.latestCrawlCompletedAt && (
            <span>
              Crawl through{" "}
              {new Date(sampleObservation.latestCrawlCompletedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
        </div>
        {sampleObservation.visibilityStaleVsCrawl && sampleObservation.staleNote && (
          <p className="text-[12px] text-status-warning font-medium mt-3 border-t border-border/40 pt-3">
            {sampleObservation.staleNote}
          </p>
        )}
        <details className="group/prov mt-3 border-t border-border/40 pt-2">
          <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-2 [&::-webkit-details-marker]:hidden">
            <span className="text-[9px] text-muted-foreground/50 transition-transform group-open/prov:rotate-90">▶</span>
            Runs, stamps &amp; technical notes
          </summary>
          <div className="mt-2 space-y-2 text-[11px] text-muted-foreground leading-relaxed">
            {!sampleObservation.visibilityRunHref && (
              <p>No dominant visibility run resolved from row ids — check Import or citation index.</p>
            )}
            {sampleObservation.visibilitySynthetic && (
              <p className="text-status-warning font-medium">
                Synthetic wrapper from citation index — not a live prompt-engine run.
              </p>
            )}
            {sampleObservation.rollupStalenessNote && <p>{sampleObservation.rollupStalenessNote}</p>}
            {runGroups.length > 1 && (
              <p>
                Row mix:{" "}
                {runGroups.map(([id, n]) => (
                  <span key={id} className="mr-2 inline-block">
                    <Link
                      href={`/observations/${encodeURIComponent(id)}`}
                      className="text-accent-primary hover:underline font-mono text-[10px]"
                    >
                      {id.slice(0, 28)}
                      {id.length > 28 ? "…" : ""}
                    </Link>
                    <span className="tabular-nums"> ({n})</span>
                  </span>
                ))}
              </p>
            )}
            <p>
              <span className="tabular-nums">{legacyUnstampedCount}</span> legacy rows without a run stamp.
            </p>
          </div>
        </details>
        {sampleObservation.competitorUniverseSummary && (
          <details className="group/cu mt-2 border-t border-border/40 pt-2">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-2 [&::-webkit-details-marker]:hidden">
              <span className="text-[9px] text-muted-foreground/50 transition-transform group-open/cu:rotate-90">▶</span>
              Competitor sample context
            </summary>
            <div className="mt-2">
              <CompetitorUniverseSampleStrip summary={sampleObservation.competitorUniverseSummary} />
            </div>
          </details>
        )}
      </div>

      <div className="rounded-lg border border-border/60 bg-surface-inset/25 px-4 py-3 mb-6 text-[12px] text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">Each column: </span>
        <span className="text-foreground">Metric</span> = what was measured ·
        <span className="text-foreground"> Cause</span> = what Beacon thinks happened ·
        <span className="text-foreground"> Trust</span> = whether you confirmed it.
      </div>

      <div className="flex items-start gap-5 flex-wrap mb-6">
        {Object.keys(platformCounts).filter((k) => k !== "all").length > 1 && (
          <div className="rounded-lg border border-border/50 bg-surface-raised/30 px-4 py-3 shrink-0">
            <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-2">Platform mix</p>
            <PlatformSplit
              entries={Object.entries(platformCounts)
                .filter(([k]) => k !== "all")
                .map(([platform, count]) => ({
                  platform,
                  label: (PLATFORM_LABELS as Record<string, string>)[platform] ?? platform,
                  value: count,
                }))}
            />
          </div>
        )}
        {(confirmedCount > 0 || autoClearedCount > 0 || unresolvedCount > 0) && (
          <div className="rounded-lg border border-border/50 bg-surface-raised/30 px-4 py-3 shrink-0">
            <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-2">Attribution trust</p>
            <DonutRing
              segments={[
                ...(confirmedCount > 0 ? [{ label: "Locked", value: confirmedCount, color: "stroke-status-success" }] : []),
                ...(autoClearedCount > 0 ? [{ label: "Auto-cleared", value: autoClearedCount, color: "stroke-accent-primary" }] : []),
                ...(unresolvedCount > 0 ? [{ label: "Pending", value: unresolvedCount, color: "stroke-muted-foreground/50" }] : []),
              ]}
              size={80}
              thickness={8}
              centerLabel="Trust"
              centerValue={withDriver}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <TabFilter
          tabs={platformTabs.map((t) => ({
            ...t,
            count: platformCounts[t.value] ?? 0,
          }))}
          value={activePlatform}
          onChange={setActivePlatform}
        />

        <div className="flex items-center gap-1 text-[10px] ml-auto">
          <span className="text-muted-foreground font-medium mr-1">
            Driver:
          </span>
          <TrustFilterPill
            label="All"
            value="all"
            active={trustFilter}
            onClick={setTrustFilter}
          />
          <TrustFilterPill
            label="Review locked"
            value="confirmed"
            active={trustFilter}
            onClick={setTrustFilter}
          />
          <TrustFilterPill
            label="Auto-cleared"
            value="auto_cleared"
            active={trustFilter}
            onClick={setTrustFilter}
          />
          <TrustFilterPill
            label="Needs review"
            value="unresolved"
            active={trustFilter}
            onClick={setTrustFilter}
          />
          <TrustFilterPill
            label="No driver"
            value="none"
            active={trustFilter}
            onClick={setTrustFilter}
          />
        </div>
      </div>

      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-raised hover:bg-surface-raised">
              <TableHead className="text-[11px] font-medium">Date</TableHead>
              <TableHead className="text-[11px] font-medium">Metric</TableHead>
              <TableHead className="text-[11px] font-medium text-right">
                Value
              </TableHead>
              <TableHead className="text-[11px] font-medium text-right">
                Delta
              </TableHead>
              <TableHead className="text-[11px] font-medium">Topic</TableHead>
              <TableHead className="text-[11px] font-medium">
                Suggested cause
              </TableHead>
              <TableHead className="text-[11px] font-medium max-w-[140px]">
                Visibility run
              </TableHead>
              <TableHead className="text-[11px] font-medium">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => {
              const driver = drivers[r.id] ?? null;
              const isInverted =
                r.metric_type === "visibility_rank" ||
                r.metric_type === "average_position";

              return (
                <TableRow key={r.id}>
                  <TableCell className="text-[12px] text-muted-foreground whitespace-nowrap">
                    <Link
                      href={`/results/${r.id}`}
                      className="hover:text-accent-primary transition-colors"
                    >
                      {new Date(r.snapshot_date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </Link>
                    <span className="block text-[10px]">
                      {PLATFORM_LABELS[r.platform]}
                    </span>
                    <span className="block text-[9px] text-muted-foreground/70 mt-0.5">
                      Sample row
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px] font-medium">
                    <Link
                      href={`/results/${r.id}`}
                      className="hover:text-accent-primary transition-colors"
                    >
                      {METRIC_TYPE_LABELS[r.metric_type]}
                    </Link>
                  </TableCell>
                  <TableCell className="text-[13px] text-right tabular-nums font-semibold">
                    {r.metric_value}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeltaIndicator
                      value={r.delta_percentage}
                      invertColor={isInverted}
                    />
                  </TableCell>
                  <TableCell className="text-[12px] text-muted-foreground max-w-[120px] truncate">
                    {r.topic ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px] max-w-[200px]">
                    <DriverCell driver={driver} />
                  </TableCell>
                  <TableCell className="text-[10px] max-w-[160px] align-top">
                    {r.visibility_observation_run_id ? (
                      <Link
                        href={`/observations/${encodeURIComponent(r.visibility_observation_run_id)}`}
                        className="text-accent-primary hover:underline font-mono break-all leading-snug"
                      >
                        {r.visibility_observation_run_id.length > 36
                          ? `${r.visibility_observation_run_id.slice(0, 18)}…`
                          : r.visibility_observation_run_id}
                      </Link>
                    ) : resultVisibilityRowLegacyUnstamped(r) ? (
                      <span className="text-muted-foreground/80">
                        Unstamped import
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <TrustBadge driver={driver} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {sorted.length === 0 && (
        <div className="text-center py-8 text-[13px] text-muted-foreground">
          No results match the current filters.
        </div>
      )}
    </div>
  );
}

function DriverCell({ driver }: { driver: ResultDriverInfo | null }) {
  if (!driver) {
    return <span className="text-muted-foreground/50 text-[11px]">—</span>;
  }

  return (
    <div className="space-y-0.5">
      <Link
        href={`/changes/${driver.changeId}`}
        className="text-accent-primary hover:underline text-[12px] line-clamp-1 block"
      >
        {driver.changeName}
      </Link>
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {driver.score != null && (
          <span className="tabular-nums font-medium">
            {Math.round(driver.score)}
          </span>
        )}
        {driver.eventType && (
          <>
            {driver.score != null && <span>·</span>}
            <span className="capitalize">{driver.eventType}</span>
          </>
        )}
        <span>·</span>
        <span>{TIER_LABELS[driver.evidenceTier]}</span>
      </div>
    </div>
  );
}

function TrustBadge({ driver }: { driver: ResultDriverInfo | null }) {
  if (!driver) {
    return null;
  }
  const cfg = TRUST_CONFIG[driver.trust];
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${cfg.dot}`}
      />
      <span className={`text-[10px] font-medium ${cfg.text}`}>
        {cfg.label}
      </span>
    </span>
  );
}

function TrustFilterPill({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: string;
  active: string;
  onClick: (v: ResultDriverTrust | "all" | "none") => void;
}) {
  const isActive = active === value;
  return (
    <button
      onClick={() => onClick(value as ResultDriverTrust | "all" | "none")}
      className={`rounded border px-1.5 py-0.5 transition-colors ${
        isActive
          ? "border-accent-primary bg-accent-primary/10 text-accent-primary font-medium"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-surface-inset"
      }`}
    >
      {label}
    </button>
  );
}
