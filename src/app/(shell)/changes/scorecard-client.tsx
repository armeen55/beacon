"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { ScorecardRowWithImpact } from "@/domains/attribution/change-impact";
import type { UrlVerdict } from "@/domains/attribution/url-verdict";
// Note: UrlVerdict type is retained on EnrichedChangeRow because the internal
// row-expand panel ("Explain this verdict") still renders the legacy Z-score
// math. The primary drilldown at /changes/[id] is the source of truth for
// attribution status.
import { AttributionStatusPill } from "./attribution-status-pill";

/**
 * A single row on the /changes page.
 * - `scorecard` = the legacy per-change row with topic event attributions
 *   (kept for drill-down context only; NOT used for the verdict).
 * - `urlVerdict` = the URL-level Z-score verdict (the new primary signal).
 *   null when the change has no URL (site-wide).
 * - `seriesPreview` = trimmed dense daily series around the change date for
 *   optional sparkline rendering in the expand panel.
 * - `hasUrl` = convenience; `false` means site-wide / untracked.
 * - `readyOn` = dynamic "Ready on [date]" prediction from the URL pattern
 *   brain, attached only when the verdict is `too_early`. Tells the
 *   operator when to check back for a landed verdict.
 */
export type EnrichedChangeRow = {
  scorecard: ScorecardRowWithImpact;
  urlVerdict: UrlVerdict | null;
  seriesPreview: Array<{ date: string; count: number }> | null;
  hasUrl: boolean;
  readyOn?: ReadyOnPrediction | null;
};

/**
 * G5 — "Ready on [date]" block shown on too-early rows. Sourced from the
 * URL pattern brain (`url-change-patterns.json`) when a matching bucket
 * exists, else a transparent fallback.
 */
export type ReadyOnPrediction = {
  /** ISO date string for when first verdict read-out is expected. */
  readyDate: string;
  /** Days from the change timestamp until readyDate. */
  daysFromChange: number;
  /** Bucket we derived from, or null when falling back. */
  patternId: string | null;
  /** Helping-count in bucket. 0 = fallback triggered. */
  helpingCount: number;
  /** Total sample count in the bucket. */
  sampleCount: number;
  /** Confidence tier of the bucket (null when fallback). */
  confidenceTier: "high" | "medium" | "low" | null;
  /** Plain-English sentence ready for render. */
  narrative: string;
};

// Phase 2C cleanup — status-based filter (replaces legacy helping/hurting model).
// "other" bundles the remaining rare statuses so operators have a catch-all without
// a chip explosion. Changes with no stored outcome fall under "no_data".
type StatusFilter =
  | "all"
  | "computed"
  | "weak_estimate"
  | "no_controls"
  | "unsupported_scope"
  | "insufficient_baseline"
  | "other"
  | "no_data";

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: "All",
  computed: "Computed",
  weak_estimate: "Weak estimate",
  no_controls: "No controls",
  unsupported_scope: "Unsupported",
  insufficient_baseline: "No baseline",
  other: "Other",
  no_data: "No data",
};

const OTHER_STATUSES = new Set([
  "insufficient_post_data",
  "zero_signal",
  "ineligible_layer",
  "ineligible_event",
]);

const PLATFORM_SHORT: Record<string, string> = {
  chatgpt: "GPT",
  google_aio: "AIO",
  perplexity: "Pplx",
};

export function ScorecardTable({
  rows,
  allTopics: _allTopics,
  allPlatforms: _allPlatforms,
  coverageState,
  outcomesById,
}: {
  rows: EnrichedChangeRow[];
  /** Reserved for future per-topic filter in drill-down. */
  allTopics?: string[];
  /** Reserved for future per-platform filter in drill-down. */
  allPlatforms?: string[];
  coverageState?: import("@/lib/coverage-state").CoverageState;
  /**
   * Phase 2C — stored attribution outcomes keyed by change_id. When present,
   * each row renders the new attribution status pill (computed / weak_estimate /
   * no_controls / unsupported_scope / ...) in place of the legacy verdict pill.
   */
  outcomesById?: Record<string, import("@/domains/attribution/change-outcome-store").StoredChangeOutcome>;
}) {
  const [filter, setFilter] = useState<StatusFilter>("all");

  const statusOf = (row: EnrichedChangeRow): StatusFilter => {
    const outcome = outcomesById?.[row.scorecard.change.id];
    if (!outcome) return "no_data";
    const s = outcome.status;
    if (s === "computed" || s === "weak_estimate" || s === "no_controls" || s === "unsupported_scope" || s === "insufficient_baseline") {
      return s;
    }
    if (OTHER_STATUSES.has(s)) return "other";
    return "no_data";
  };

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => statusOf(r) === filter);
    // statusOf depends on outcomesById — include in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, outcomesById]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: rows.length,
      computed: 0,
      weak_estimate: 0,
      no_controls: 0,
      unsupported_scope: 0,
      insufficient_baseline: 0,
      other: 0,
      no_data: 0,
    };
    for (const r of rows) {
      c[statusOf(r)] += 1;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, outcomesById]);

  const filterOptions: StatusFilter[] = [
    "all",
    "computed",
    "weak_estimate",
    "no_controls",
    "unsupported_scope",
    "insufficient_baseline",
    "other",
    "no_data",
  ];

  return (
    <div>
      {/* Attribution status filter chips */}
      <div className="flex items-center gap-1 mb-4 border-b border-border/40 pb-2 overflow-x-auto">
        {filterOptions
          .filter((key) => key === "all" || counts[key] > 0)
          .map((key) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                filter === key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-inset/50"
              }`}
            >
              {STATUS_FILTER_LABEL[key]}
              <span className="ml-1.5 text-[10px] opacity-60 tabular-nums">
                {counts[key]}
              </span>
            </button>
          ))}
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {filtered.length}/{rows.length}
        </span>
      </div>

      <div className="border border-border/70 rounded-lg overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border bg-surface-inset text-[10px] text-muted-foreground">
              <th className="text-left px-2.5 py-1.5 font-medium w-[90px]">When</th>
              <th className="text-left px-2.5 py-1.5 font-medium">Change</th>
              <th className="text-left px-2.5 py-1.5 font-medium w-[120px]">Status</th>
              <th className="text-left px-2.5 py-1.5 font-medium w-[80px] tabular-nums">
                Delta
              </th>
              <th className="w-[32px]" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <ChangeRow
                key={row.scorecard.change.id}
                row={row}
                outcome={outcomesById?.[row.scorecard.change.id]}
              />
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-[13px] text-muted-foreground">
          No changes match this filter.
        </div>
      )}

      {coverageState === "stale" || coverageState === "critical" ? (
        <p className="mt-3 text-[10px] text-status-warning/70">
          Coverage state is {coverageState} — attribution may reflect stale
          data until the next import.
        </p>
      ) : null}
    </div>
  );
}

function ChangeRow({
  row,
  outcome,
}: {
  row: EnrichedChangeRow;
  outcome?: import("@/domains/attribution/change-outcome-store").StoredChangeOutcome;
}) {
  const [open, setOpen] = useState(false);
  const ch = row.scorecard.change;
  const dateStr = new Date(ch.timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  // Phase 2C: read delta from the new store when status === "computed"; for
  // weak_estimate / no_controls, show the RAW treated delta explicitly labeled
  // "raw" so it cannot be misread as adjusted/causal. For all other statuses
  // (insufficient / ineligible / unsupported / zero_signal): em-dash.
  const delta =
    outcome?.status === "computed" ? outcome.computed!.overall.relative_lift : null;
  const deltaAbs =
    outcome?.status === "computed"
      ? outcome.computed!.overall.adjusted_lift
      : outcome?.raw?.overall.treated_delta ?? null;
  const deltaIsRaw = outcome?.status !== "computed" && outcome?.raw !== null && outcome?.raw !== undefined;
  const deltaStr = (() => {
    if (delta == null) return "—";
    const pct = Math.round(delta * 100);
    return pct > 0 ? `+${pct}%` : `${pct}%`;
  })();
  // Intentionally NOT colored green/red — attribution is not a pass/fail judgment.
  // Computed results get accent-primary to signal "measured"; raw stays muted so it
  // cannot be misread as a causal signal.
  const deltaColor = delta == null ? "text-muted-foreground" : "text-accent-primary";

  return (
    <>
      <tr
        className={`border-b border-border hover:bg-surface-inset/50 transition-colors cursor-pointer ${
          open ? "bg-surface-inset/30" : ""
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-2.5 py-2 text-muted-foreground tabular-nums whitespace-nowrap align-top text-[11px]">
          <span>{dateStr}</span>
          {ch.source_system && (
            <span
              className={`block text-[8px] mt-0.5 ${
                ch.source_system === "scan_detection" ||
                ch.source_system === "scan_promoted"
                  ? "text-amber-500"
                  : "text-muted-foreground/50"
              }`}
            >
              {ch.source_system === "scan_detection"
                ? "scan · auto-caught"
                : ch.source_system === "scan_promoted"
                  ? "scan"
                  : "imported"}
            </span>
          )}
        </td>
        <td className="px-2.5 py-2 align-top max-w-[380px]">
          <Link
            href={`/changes/${ch.id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-accent-primary transition-colors"
          >
            <p className="font-medium text-[12px] leading-snug line-clamp-2">
              {ch.asset_name}
            </p>
            <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5 leading-snug">
              {ch.change_description}
            </p>
            {ch.url ? (
              <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5 truncate max-w-[340px]">
                {ch.url}
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5 italic">
                Site-wide infra
              </p>
            )}
          </Link>
        </td>
        <td className="px-2.5 py-2 align-top whitespace-nowrap">
          {outcome ? (
            <AttributionStatusPill status={outcome.status} confidence={outcome.confidence} compact />
          ) : row.hasUrl ? (
            <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground bg-surface-inset/60 border-border/60">
              No data
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground bg-surface-inset/60 border-border/60">
              Site-wide
            </span>
          )}
        </td>
        <td className="px-2.5 py-2 align-top whitespace-nowrap tabular-nums">
          <span className={`text-[12px] font-semibold ${deltaColor}`}>
            {deltaStr}
          </span>
          {deltaAbs != null && Math.abs(deltaAbs) >= 0.1 && (
            <span className="block text-[9px] text-muted-foreground mt-0.5">
              {deltaIsRaw && <span className="mr-0.5 uppercase tracking-wider">raw</span>}
              {deltaAbs > 0 ? "+" : ""}
              {deltaAbs.toFixed(1)}/day
            </span>
          )}
        </td>
        <td className="px-2.5 py-2 align-top text-muted-foreground text-[12px] select-none">
          {open ? "▾" : "▸"}
        </td>
      </tr>
      {open && <ExpandPanel row={row} />}
    </>
  );
}

function ExpandPanel({ row }: { row: EnrichedChangeRow }) {
  const v = row.urlVerdict;
  const sc = row.scorecard;
  const isTooEarly = v?.verdict === "too_early";
  const ro = row.readyOn ?? null;

  return (
    <tr className="border-b border-border bg-surface-inset/20">
      <td colSpan={5} className="px-4 py-4">
        {/* G5: Ready-on block for Too-early rows. Honest fallback when the
            pattern brain has zero helping samples for this edit type. */}
        {isTooEarly && ro && (
          <div className="mb-4 rounded-md border border-accent-primary/30 bg-accent-primary/[0.03] px-3 py-2.5">
            <p className="text-[10px] font-semibold text-accent-primary uppercase tracking-wide">
              Check again on this date to evaluate impact
            </p>
            <p className="text-[13px] font-semibold text-foreground mt-1">
              {formatReadyDate(ro.readyDate)} ·{" "}
              <span className="text-muted-foreground font-normal">
                {ro.daysFromChange}d from change
              </span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
              {ro.narrative}{" "}
              <span className="text-muted-foreground/70">
                (Open this page on that date and the watcher will refresh.)
              </span>
            </p>
            {ro.patternId && (
              <p className="text-[10px] text-muted-foreground/70 mt-1.5 font-mono">
                pattern: {ro.patternId} · {ro.sampleCount} sample
                {ro.sampleCount === 1 ? "" : "s"}
                {ro.confidenceTier && ` · ${ro.confidenceTier} confidence`}
              </p>
            )}
          </div>
        )}
        <div className="grid md:grid-cols-[1fr_1fr] gap-5">
          {/* Left: Explain this verdict (URL-level math) */}
          <section>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Explain this verdict
            </p>
            {!row.hasUrl ? (
              <p className="text-[12px] text-muted-foreground italic">
                This change has no URL — site-wide changes aren&apos;t tracked
                per-URL. Look at the topic breakdown on the right for whether
                any prompts moved.
              </p>
            ) : !v ? (
              <p className="text-[12px] text-muted-foreground italic">
                No citation data found for this URL yet. Either the page
                isn&apos;t cited anywhere in your Profound prompts, or the URL
                doesn&apos;t match any indexed page.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-[12px] leading-relaxed text-foreground">
                  {v.explanation.summary}
                </p>
                <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-[11px] font-mono leading-relaxed">
                  <MathRow
                    label="μ_pre (baseline mean)"
                    value={`${v.explanation.math.mu_pre}/day`}
                    note={`${v.explanation.math.baseline_days_used}d window`}
                  />
                  <MathRow
                    label="σ_pre (baseline noise)"
                    value={`${v.explanation.math.sigma_pre_used.toFixed(2)}`}
                    note={
                      v.explanation.math.sigma_pre_raw < 1
                        ? `raw ${v.explanation.math.sigma_pre_raw.toFixed(2)} → floored to 1`
                        : undefined
                    }
                  />
                  <MathRow
                    label="μ_post (after change)"
                    value={`${v.explanation.math.mu_post}/day`}
                    note={`${v.explanation.math.post_days_used}d window`}
                  />
                  <MathRow
                    label="z-score"
                    value={`${v.explanation.math.z > 0 ? "+" : ""}${v.explanation.math.z.toFixed(2)}`}
                    note={
                      Math.abs(v.explanation.math.z) >= 2
                        ? "≥ ±2 significance"
                        : "below ±2 bar"
                    }
                  />
                  <MathRow
                    label="sustain (last 7d)"
                    value={`↑${v.explanation.math.sustain_up} / ↓${v.explanation.math.sustain_down}`}
                    note={
                      v.explanation.math.sustain_up >= 5
                        ? "5/7 up → sustained"
                        : v.explanation.math.sustain_down >= 5
                          ? "5/7 down → sustained"
                          : "no sustained direction"
                    }
                  />
                </div>
                <p className="text-[10px] text-muted-foreground italic">
                  Confidence: <span className="font-medium">{v.confidence}</span>
                </p>
              </div>
            )}
          </section>

          {/* Right: Topic & platform drill-down from legacy scorecard data */}
          <section>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Topic &amp; platform drill-down
            </p>
            {sc.eventAttributions.length === 0 ? (
              <p className="text-[12px] text-muted-foreground italic">
                No attribution events matched this change — either too early,
                or no tracked topic moved around the change date.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {sc.eventAttributions.slice(0, 8).map((ea, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-[11px] text-muted-foreground"
                  >
                    <span
                      className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                        ea.role === "primary"
                          ? "bg-status-success/10 text-status-success"
                          : ea.role === "contributing"
                            ? "bg-status-warning/10 text-status-warning"
                            : "bg-surface-inset text-muted-foreground"
                      }`}
                    >
                      {ea.role === "primary"
                        ? "Primary"
                        : ea.role === "contributing"
                          ? "Also"
                          : "Maybe"}
                    </span>
                    <span className="text-[10px] font-medium text-foreground">
                      {PLATFORM_SHORT[ea.event.platform] ?? ea.event.platform}
                    </span>
                    <span className="truncate flex-1">{ea.event.topic}</span>
                  </li>
                ))}
                {sc.eventAttributions.length > 8 && (
                  <li className="text-[10px] text-muted-foreground/70">
                    +{sc.eventAttributions.length - 8} more…
                  </li>
                )}
              </ul>
            )}

            {sc.topics.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Targeted topics
                </p>
                <div className="flex flex-wrap gap-1">
                  {sc.topics.map((t) => (
                    <span
                      key={t}
                      className="text-[10px] rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-border/40">
              <Link
                href={`/changes/${sc.change.id}`}
                className="text-[11px] font-semibold text-accent-primary hover:underline"
              >
                Open full detail page →
              </Link>
            </div>
          </section>
        </div>
      </td>
    </tr>
  );
}

function formatReadyDate(iso: string): string {
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function MathRow({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-muted-foreground min-w-[140px]">{label}</span>
      <span className="text-foreground font-semibold">{value}</span>
      {note && (
        <span className="text-muted-foreground/70 text-[10px] ml-auto">
          {note}
        </span>
      )}
    </div>
  );
}
