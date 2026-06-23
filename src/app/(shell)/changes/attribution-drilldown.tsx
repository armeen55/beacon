/**
 * Attribution drilldown panel — renders a `StoredChangeOutcome` from the
 * Phase 2C store. This is the primary attribution surface on the /changes/[id]
 * detail page and replaces the legacy verdict-led block.
 *
 * Discipline:
 *   - `computed` outcomes show adjusted_lift + per-platform + control reference.
 *   - `weak_estimate` / `no_controls` show RAW treated deltas with a visible
 *     caveat strip; no adjusted_lift field is ever rendered.
 *   - `unsupported_scope` / `insufficient_*` / `ineligible_*` / `zero_signal`
 *     render a muted "why not computed" strip with the rationale + warnings.
 *   - Treated-only sparkline for every outcome that has window data.
 *   - Control-reference sparkline ONLY when status === "computed" (matches the
 *     store invariant — prevents implying a benchmark cohort on weak runs).
 *
 * Pure presentational. No server-only imports so both server and client
 * components can mount it.
 */

import type { StoredChangeOutcome, SparklineData, ControlSparklinePoint, TreatedSparklinePoint } from "@/domains/attribution/change-outcome-store";
import type { PlatformLift, RawPrePost } from "@/domains/attribution/natural-controls";
import { buildProofSentence, type ProofTone } from "@/domains/attribution/proof-sentence";
import { AttributionStatusPill } from "./attribution-status-pill";

export function AttributionDrilldown({ outcome }: { outcome: StoredChangeOutcome }) {
  const { status, confidence } = outcome;

  return (
    <section
      className="rounded-lg border border-border bg-surface px-5 py-4 mb-6"
      aria-label="Attribution drilldown"
    >
      <Header outcome={outcome} />

      {/* Plain-English proof — the customer-facing headline. The technical
          rationale + diff-in-diff blocks below are the supporting "math". */}
      <ProofLead outcome={outcome} />

      {/* Single-line engine rationale (technical; supports the headline) */}
      <p className="mt-3 text-[12px] text-foreground-secondary leading-relaxed">
        {outcome.rationale}
      </p>

      {/* Per-status body */}
      {status === "computed" && outcome.computed && (
        <ComputedBody outcome={outcome} />
      )}
      {outcome.raw && (
        <RawBody outcome={outcome} />
      )}
      {outcome.computed === null && outcome.raw === null && (
        <NotComputedBody outcome={outcome} />
      )}

      {/* Warnings (always shown if present) */}
      {outcome.warnings.length > 0 && <WarningsList warnings={outcome.warnings} />}

      {/* Sparklines (when window + treated series exist) */}
      {outcome.sparklines && <SparklinesRow sparklines={outcome.sparklines} />}

      {/* Excluded reasons (operator drilldown — aggregate + per-platform) */}
      {(Object.keys(outcome.excluded_reasons).length > 0 ||
        Object.keys(outcome.excluded_reasons_by_platform).length > 0) && (
        <ExclusionsBlock outcome={outcome} />
      )}

      {/* Bundle + pair context */}
      {(outcome.child_tags.length > 0 || outcome.paired_with.length > 0) && (
        <BundleContext outcome={outcome} />
      )}

      {/* Meta */}
      <MetaFooter outcome={outcome} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Plain-English proof lead — the customer-facing headline sentence
// ---------------------------------------------------------------------------

const PROOF_TONE_CLASS: Record<ProofTone, string> = {
  helping: "text-status-success",
  hurting: "text-status-danger",
  flat: "text-foreground-secondary",
  watching: "text-status-warning",
  none: "text-muted-foreground",
};

function ProofLead({ outcome }: { outcome: StoredChangeOutcome }) {
  const proof = buildProofSentence(outcome);
  return (
    <div className="mt-3" data-proof-sentence={proof.tone}>
      <p
        className={`text-[15px] font-semibold leading-snug ${PROOF_TONE_CLASS[proof.tone]}`}
      >
        {proof.headline}
      </p>
      {proof.sub && (
        <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
          {proof.sub}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({ outcome }: { outcome: StoredChangeOutcome }) {
  const { treatment_date, url, url_type, primary_bucket } = outcome;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <AttributionStatusPill status={outcome.status} confidence={outcome.confidence} />
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {primary_bucket}
          </span>
        </div>
        <div className="mt-2 text-[13px] text-foreground">
          <span className="font-mono text-[12px]">{url ?? "(no url — site-wide / global)"}</span>
          {url_type && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              {url_type}
            </span>
          )}
        </div>
      </div>
      <div className="text-right text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
        <div>Treatment: {treatment_date}</div>
        {outcome.pre_window && outcome.post_window && (
          <div className="mt-0.5 text-[10px]">
            pre {outcome.pre_window.start} → {outcome.pre_window.end} · post {outcome.post_window.start} → {outcome.post_window.end}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Computed body (adjusted_lift, per-platform)
// ---------------------------------------------------------------------------

function ComputedBody({ outcome }: { outcome: StoredChangeOutcome }) {
  const c = outcome.computed!;
  return (
    <div className="mt-4 rounded-md border border-accent-primary/20 bg-accent-primary/[0.03] px-4 py-3">
      <p className="text-[10px] font-semibold text-accent-primary uppercase tracking-wider">
        Diff-in-differences estimate
      </p>
      <OverallLine lift={c.overall} />
      {c.per_platform.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold text-foreground-secondary uppercase tracking-wider mb-1.5">
            Per platform
          </p>
          <PlatformTable lifts={c.per_platform} />
        </div>
      )}
    </div>
  );
}

function OverallLine({ lift }: { lift: PlatformLift }) {
  const rel = lift.relative_lift === null ? "—" : `${(lift.relative_lift * 100).toFixed(0)}%`;
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 tabular-nums">
      <span className="text-[22px] font-semibold text-foreground">
        {lift.adjusted_lift > 0 ? "+" : ""}
        {lift.adjusted_lift} <span className="text-[11px] text-muted-foreground">cit/day</span>
      </span>
      <span className="text-[12px] text-foreground-secondary">
        adjusted lift · <span className="font-semibold">{rel}</span> vs baseline
      </span>
      <span className="text-[11px] text-muted-foreground ml-auto">
        N<sub>controls</sub>={lift.controls_used} · treated Δ={lift.treated_delta} · control Δ={lift.control_delta}
      </span>
    </div>
  );
}

function PlatformTable({ lifts }: { lifts: PlatformLift[] }) {
  return (
    <table className="w-full text-[11px] border-collapse">
      <thead>
        <tr className="border-b border-border/60 text-muted-foreground">
          <th className="text-left py-1 font-medium">Platform</th>
          <th className="text-right py-1 font-medium tabular-nums">Adjusted</th>
          <th className="text-right py-1 font-medium tabular-nums">Relative</th>
          <th className="text-right py-1 font-medium tabular-nums">Treated Δ</th>
          <th className="text-right py-1 font-medium tabular-nums">Control Δ</th>
          <th className="text-right py-1 font-medium tabular-nums">Controls</th>
        </tr>
      </thead>
      <tbody>
        {lifts.map((l) => (
          <tr key={l.platform} className="border-b border-border/30 last:border-b-0">
            <td className="py-1 font-medium">{l.platform}</td>
            <td className="py-1 text-right tabular-nums">
              {l.adjusted_lift > 0 ? "+" : ""}
              {l.adjusted_lift}
            </td>
            <td className="py-1 text-right tabular-nums text-muted-foreground">
              {l.relative_lift === null ? "—" : `${(l.relative_lift * 100).toFixed(0)}%`}
            </td>
            <td className="py-1 text-right tabular-nums text-muted-foreground">
              {l.treated_delta > 0 ? "+" : ""}
              {l.treated_delta}
            </td>
            <td className="py-1 text-right tabular-nums text-muted-foreground">
              {l.control_delta > 0 ? "+" : ""}
              {l.control_delta}
            </td>
            <td className="py-1 text-right tabular-nums text-muted-foreground">{l.controls_used}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Raw body (weak_estimate / no_controls / insufficient_post_data)
// ---------------------------------------------------------------------------

function RawBody({ outcome }: { outcome: StoredChangeOutcome }) {
  const r = outcome.raw!;
  return (
    <div className="mt-4 rounded-md border border-status-warning/30 bg-status-warning/[0.04] px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-sm border border-status-warning/40 bg-status-warning/10 text-status-warning px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
          raw only
        </span>
        <p className="text-[10px] font-semibold text-status-warning uppercase tracking-wider">
          Not a causal estimate
        </p>
      </div>
      <p className="mt-2 text-[11px] text-foreground-secondary leading-relaxed italic">
        {r.overall.caveat}
      </p>
      <RawOverallLine raw={r.overall} />
      {r.per_platform.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold text-foreground-secondary uppercase tracking-wider mb-1.5">
            Per platform (raw only)
          </p>
          <RawPlatformTable raws={r.per_platform} />
        </div>
      )}
    </div>
  );
}

function RawOverallLine({ raw }: { raw: RawPrePost }) {
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 tabular-nums">
      <span className="text-[18px] font-semibold text-foreground-secondary">
        treated Δ = {raw.treated_delta > 0 ? "+" : ""}
        {raw.treated_delta} <span className="text-[11px] text-muted-foreground">cit/day</span>
      </span>
      <span className="text-[11px] text-muted-foreground">
        pre {raw.treated_pre_avg} → post {raw.treated_post_avg} · days observed pre={raw.pre_days_observed} post={raw.post_days_observed}
      </span>
    </div>
  );
}

function RawPlatformTable({ raws }: { raws: RawPrePost[] }) {
  return (
    <table className="w-full text-[11px] border-collapse">
      <thead>
        <tr className="border-b border-border/60 text-muted-foreground">
          <th className="text-left py-1 font-medium">Platform</th>
          <th className="text-right py-1 font-medium tabular-nums">Treated Δ (raw)</th>
          <th className="text-right py-1 font-medium tabular-nums">Pre</th>
          <th className="text-right py-1 font-medium tabular-nums">Post</th>
        </tr>
      </thead>
      <tbody>
        {raws.map((r) => (
          <tr key={r.platform} className="border-b border-border/30 last:border-b-0">
            <td className="py-1 font-medium">{r.platform}</td>
            <td className="py-1 text-right tabular-nums text-foreground-secondary">
              {r.treated_delta > 0 ? "+" : ""}
              {r.treated_delta}
            </td>
            <td className="py-1 text-right tabular-nums text-muted-foreground">{r.treated_pre_avg}</td>
            <td className="py-1 text-right tabular-nums text-muted-foreground">{r.treated_post_avg}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Not computed (unsupported / ineligible / insufficient / zero_signal)
// ---------------------------------------------------------------------------

function NotComputedBody({ outcome }: { outcome: StoredChangeOutcome }) {
  return (
    <div className="mt-4 rounded-md border border-border bg-surface-inset/40 px-4 py-3">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        No URL-level estimate produced
      </p>
      <p className="mt-1.5 text-[12px] text-foreground-secondary leading-relaxed">
        {statusExplanation(outcome.status)}
      </p>
    </div>
  );
}

function statusExplanation(status: StoredChangeOutcome["status"]): string {
  switch (status) {
    case "unsupported_scope":
      return "This change affects your whole site or things off your site, so Beacon can't measure it by comparing one page to similar pages.";
    case "insufficient_baseline":
      return "There isn't enough history for this page before the change to know what 'normal' looked like.";
    case "insufficient_post_data":
      return "Not enough time has passed since the change. Refresh your connected data over the next week or two, then check again.";
    case "zero_signal":
      return "This page wasn't mentioned by AI before or after the change, so there's nothing to compare.";
    case "ineligible_layer":
      return "This entry is a note or a status update, not an edit to a page, so there's nothing to measure here.";
    case "ineligible_event":
      return "Beacon can't measure this one (the description is vague or the page address is missing). Add more detail to measure it.";
    default:
      return "Beacon couldn't measure the result of this change.";
  }
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

function WarningsList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-[10px] font-semibold text-foreground-secondary uppercase tracking-wider mb-1">
        Warnings
      </p>
      <ul className="space-y-0.5">
        {warnings.map((w, i) => (
          <li key={i} className="text-[11px] text-foreground-secondary leading-snug pl-3 border-l-2 border-status-warning/40">
            {w}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparklines
// ---------------------------------------------------------------------------

function SparklinesRow({ sparklines }: { sparklines: SparklineData }) {
  return (
    <div className="mt-4 rounded-md border border-border/60 bg-surface-inset/20 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-foreground-secondary uppercase tracking-wider">
          Citation trajectory
        </p>
        <p className="text-[9px] text-muted-foreground">
          vertical line = treatment ({sparklines.treatment_date})
          {sparklines.control_reference && ` · orange dashed = control cohort mean (N=${sparklines.control_urls.length})`}
        </p>
      </div>
      <Sparkline sparklines={sparklines} />
      {sparklines.control_reference === null && sparklines.control_urls.length === 0 && (
        <p className="mt-2 text-[10px] text-muted-foreground italic">
          No control reference shown — attribution did not reach computed status.
        </p>
      )}
    </div>
  );
}

/** Inline SVG sparkline with optional control-reference overlay. */
function Sparkline({ sparklines }: { sparklines: SparklineData }) {
  const { treated, control_reference, treatment_date } = sparklines;
  if (treated.length === 0) return null;

  const W = 640;
  const H = 80;
  const padX = 4;
  const padY = 6;

  const treatedCounts = treated.map((d) => d.count);
  const controlMeans = control_reference?.map((d) => d.mean) ?? [];
  const maxY = Math.max(1, ...treatedCounts, ...controlMeans);

  const xForIndex = (i: number) => padX + (i / Math.max(1, treated.length - 1)) * (W - 2 * padX);
  const yForValue = (v: number) => H - padY - (v / maxY) * (H - 2 * padY);

  const treatedPath = treated.map((d, i) => `${i === 0 ? "M" : "L"}${xForIndex(i).toFixed(1)},${yForValue(d.count).toFixed(1)}`).join(" ");

  let controlPath = "";
  if (control_reference && control_reference.length === treated.length) {
    controlPath = control_reference
      .map((d, i) => `${i === 0 ? "M" : "L"}${xForIndex(i).toFixed(1)},${yForValue(d.mean).toFixed(1)}`)
      .join(" ");
  }

  const treatmentIdx = treated.findIndex((d) => d.date === treatment_date);
  const treatmentX = treatmentIdx >= 0 ? xForIndex(treatmentIdx) : null;

  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Daily citation trajectory">
        {/* Zero line */}
        <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="2 3" />
        {/* Control reference (dashed) */}
        {controlPath && (
          <path d={controlPath} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.85} />
        )}
        {/* Treated series */}
        <path d={treatedPath} fill="none" stroke="currentColor" strokeWidth={1.75} />
        {treated.map((d, i) => (
          <circle key={i} cx={xForIndex(i)} cy={yForValue(d.count)} r={1.5} fill="currentColor" />
        ))}
        {/* Treatment date vertical */}
        {treatmentX !== null && (
          <line x1={treatmentX} y1={padY} x2={treatmentX} y2={H - padY} stroke="#ef4444" strokeWidth={1.25} strokeDasharray="3 2" opacity={0.8} />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground tabular-nums">
        <span>{treated[0]?.date}</span>
        <span>treated max = {Math.max(...treatedCounts)}</span>
        <span>{treated[treated.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exclusions block
// ---------------------------------------------------------------------------

function ExclusionsBlock({ outcome }: { outcome: StoredChangeOutcome }) {
  const agg = outcome.excluded_reasons;
  const byPlatform = outcome.excluded_reasons_by_platform;
  return (
    <details className="mt-3 text-[11px]">
      <summary className="cursor-pointer select-none text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground-secondary">
        Control exclusions ({outcome.excluded_control_count} candidates rejected)
      </summary>
      <div className="mt-2 pl-3 border-l-2 border-border/60 space-y-2">
        {Object.keys(agg).length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-foreground-secondary uppercase tracking-wider">Aggregate pool</p>
            <ReasonList reasons={agg} />
          </div>
        )}
        {Object.keys(byPlatform).length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-foreground-secondary uppercase tracking-wider">Per-platform pool</p>
            <div className="space-y-1.5 mt-1">
              {Object.entries(byPlatform).map(([platform, reasons]) => (
                <div key={platform} className="pl-2 border-l border-border/40">
                  <p className="text-[10px] font-medium">{platform}</p>
                  <ReasonList reasons={reasons} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function ReasonList({ reasons }: { reasons: Record<string, number> }) {
  const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <p className="text-[11px] text-muted-foreground italic">(none)</p>;
  return (
    <ul className="mt-1 space-y-0.5">
      {entries.map(([reason, count]) => (
        <li key={reason} className="text-[11px] text-foreground-secondary flex justify-between gap-4">
          <span className="font-mono">{reason}</span>
          <span className="tabular-nums text-muted-foreground">{count}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Bundle / pair context
// ---------------------------------------------------------------------------

function BundleContext({ outcome }: { outcome: StoredChangeOutcome }) {
  return (
    <div className="mt-3 text-[11px] text-muted-foreground space-y-0.5">
      {outcome.child_tags.length > 0 && (
        <p>
          <span className="text-foreground-secondary font-semibold">Bundle children:</span>{" "}
          {outcome.child_tags.map((t, i) => (
            <span key={t}>
              {i > 0 && ", "}
              <span className="font-mono text-[10px]">{t}</span>
            </span>
          ))}
        </p>
      )}
      {outcome.paired_with.length > 0 && (
        <p>
          <span className="text-foreground-secondary font-semibold">Paired with:</span>{" "}
          <span className="font-mono text-[10px]">{outcome.paired_with.join(", ")}</span>
        </p>
      )}
      {outcome.bundle_parent_id && (
        <p>
          <span className="text-foreground-secondary font-semibold">Parent event:</span>{" "}
          <span className="font-mono text-[10px]">{outcome.bundle_parent_id}</span>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function MetaFooter({ outcome }: { outcome: StoredChangeOutcome }) {
  return (
    <p className="mt-3 text-[9px] text-muted-foreground/80 tabular-nums">
      classifier={outcome.classifier_version} · computed_at={outcome.computed_at.slice(0, 19)}Z · stored_at={outcome.stored_at.slice(0, 19)}Z
    </p>
  );
}

// Re-exports for consumers that want the sub-pieces (none expected right now)
export type { SparklineData, TreatedSparklinePoint, ControlSparklinePoint };
