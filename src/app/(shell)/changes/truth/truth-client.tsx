"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type {
  ChangeEvent,
  EventAttribution,
  SiteMovementEvent,
} from "@/domains/events/types";

export type TruthChild = {
  id: string;
  timestamp: string;
  url: string | null;
  description: string;
  oldVerdict: string | null;
};

export type TruthRow = {
  event: ChangeEvent;
  attribution: EventAttribution | null;
  children: TruthChild[];
  oldVerdictCounts: Record<string, number>;
  oldDominant: string | null;
  movement: SiteMovementEvent | null;
};

export function TruthList({ rows }: { rows: TruthRow[] }) {
  return (
    <div className="divide-y divide-border/40 rounded-lg border border-border/60 overflow-hidden">
      {rows.map((row) => (
        <TruthRowItem key={row.event.id} row={row} />
      ))}
      {rows.length === 0 && (
        <p className="px-5 py-8 text-center text-[12px] text-muted-foreground">
          No events. Run{" "}
          <code className="font-mono text-[11px] bg-surface-inset/50 px-1 py-0.5 rounded">
            npx tsx scripts/validate-ritz-truth.ts
          </code>{" "}
          to generate them.
        </p>
      )}
    </div>
  );
}

function TruthRowItem({ row }: { row: TruthRow }) {
  const [open, setOpen] = useState(false);
  const { event, attribution, children, oldVerdictCounts, oldDominant } = row;

  const diverges = isDivergent(attribution?.verdict ?? null, oldDominant);

  return (
    <div className="bg-surface-raised/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex flex-col gap-2 text-left hover:bg-surface-inset/30 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ScopePill scope={event.scope} />
            <span className="text-[11px] font-mono text-muted-foreground shrink-0">
              {event.event_type.replace(/_/g, " ")}
            </span>
            <span className="text-[12px] text-foreground truncate" title={event.label}>
              {event.label}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {event.started_at === event.ended_at
              ? event.started_at
              : `${event.started_at} → ${event.ended_at}`}
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-[11px]">
          {/* New verdict */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 shrink-0">
              New
            </span>
            {attribution ? (
              <>
                <VerdictPill verdict={attribution.verdict} isNew />
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  conf {(attribution.confidence * 100).toFixed(0)}%
                </span>
                <ConfidenceSourcePill source={attribution.evidence.confidence_source} />
              </>
            ) : (
              <span className="text-[10px] text-muted-foreground">—</span>
            )}
          </div>

          <div
            className={cn(
              "text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded",
              diverges
                ? "text-status-warning bg-status-warning/10 border border-status-warning/30"
                : "text-muted-foreground/50",
            )}
          >
            {diverges ? "diverges" : "agree"}
          </div>

          {/* Old URL-level rollup */}
          <div className="flex items-center gap-1.5 justify-end flex-wrap text-right">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 shrink-0">
              Old
            </span>
            {children.length === 0 ? (
              <span className="text-[10px] text-muted-foreground">—</span>
            ) : Object.entries(oldVerdictCounts).length === 0 ? (
              <span className="text-[10px] text-muted-foreground">
                {children.length} child{children.length === 1 ? "" : "ren"} · no legacy verdict
              </span>
            ) : (
              <>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {children.length} child{children.length === 1 ? "" : "ren"}
                </span>
                {Object.entries(oldVerdictCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([v, n]) => (
                    <span
                      key={v}
                      className="text-[10px] tabular-nums px-1.5 py-0.5 rounded border border-border/50 bg-surface-inset/40"
                    >
                      {n} {v}
                    </span>
                  ))}
              </>
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-border/40 bg-surface-inset/20 px-4 py-4 text-[11px] space-y-4">
          {/* New-side narrative */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              New model
            </h3>
            {attribution ? (
              <div className="space-y-1 leading-relaxed">
                <p className="text-foreground/90">{attribution.evidence.narrative}</p>
                <p className="text-muted-foreground tabular-nums text-[10px]">
                  c_timing {attribution.evidence.c_timing.toFixed(2)} ·
                  c_scope {attribution.evidence.c_scope.toFixed(2)} ·
                  c_magnitude {attribution.evidence.c_magnitude.toFixed(2)}
                  {row.movement && (
                    <>
                      {" · movement "}
                      <span className="font-mono">{row.movement.id}</span>
                      {" "}
                      {row.movement.prev_count}→{row.movement.count}{" "}
                      ({row.movement.delta_abs >= 0 ? "+" : ""}
                      {row.movement.delta_abs})
                    </>
                  )}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">No attribution recorded.</p>
            )}
          </section>

          {/* Old-side child table */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              Legacy URL-level verdicts for this event&apos;s child rows
            </h3>
            {children.length === 0 ? (
              <p className="text-muted-foreground">No child rows.</p>
            ) : (
              <div className="overflow-x-auto rounded border border-border/50">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-surface-inset/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="text-left px-2 py-1.5 font-medium">Date</th>
                      <th className="text-left px-2 py-1.5 font-medium">URL</th>
                      <th className="text-left px-2 py-1.5 font-medium">Description</th>
                      <th className="text-left px-2 py-1.5 font-medium">Old</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {children.map((c) => (
                      <tr key={c.id} className="hover:bg-surface-inset/20">
                        <td className="px-2 py-1.5 text-muted-foreground tabular-nums whitespace-nowrap">
                          {c.timestamp.slice(0, 10)}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-foreground/80 truncate max-w-[220px]" title={c.url ?? ""}>
                          {c.url ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 text-foreground/80 truncate max-w-[360px]" title={c.description}>
                          {c.description}
                        </td>
                        <td className="px-2 py-1.5">
                          {c.oldVerdict ? (
                            <VerdictPill verdict={c.oldVerdict} isNew={false} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pills
// ---------------------------------------------------------------------------

function ScopePill({ scope }: { scope: ChangeEvent["scope"] }) {
  const map: Record<ChangeEvent["scope"], { label: string; cls: string }> = {
    compound_launch: {
      label: "launch",
      cls: "text-accent-primary bg-accent-primary/10 border-accent-primary/30",
    },
    sitewide_rollout: {
      label: "sitewide",
      cls: "text-status-info bg-status-info/10 border-status-info/30",
    },
    page_level: {
      label: "page",
      cls: "text-muted-foreground bg-surface-inset/60 border-border/50",
    },
  };
  const { label, cls } = map[scope];
  return (
    <span className={cn("text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0", cls)}>
      {label}
    </span>
  );
}

/**
 * 2026-05-06 demo-path fix — verdict label map.
 *
 * Pre-fix the pill rendered `verdict.replace(/_/g, " ")`, surfacing
 * raw enum values like `verified_live_too_early`, `verdict_off`,
 * `not_found_after_7d` to a customer-visible drawer. Map below
 * humanizes every known verdict value into operator-friendly copy.
 * Unknown values fall back to the underscore-stripped form (still
 * better than nothing) so a future verdict added to the union doesn't
 * crash the UI; an architecture invariant pins that the rendered
 * output never contains any of the raw underscore-shaped enum strings.
 */
const VERDICT_LABEL: Record<string, string> = {
  helping: "Helping",
  hurting: "Hurting",
  degrading: "Degrading",
  promising: "Promising",
  landed_fast: "Landed fast",
  landed_normal: "Landed",
  landed_slow: "Landed slowly",
  never_landed: "Not yet live",
  attributed_high: "Strong impact",
  attributed_medium: "Moderate impact",
  attributed_low: "Weak impact",
  verified_live_too_early: "Too early to tell",
  verified_live_baked: "Confirmed live",
  verdict_off: "Verdict revised",
  not_found_after_7d: "Not yet live (after 7 days)",
};

function humanizeVerdict(v: string): string {
  return VERDICT_LABEL[v] ?? v.replace(/_/g, " ");
}

function VerdictPill({ verdict, isNew }: { verdict: string; isNew: boolean }) {
  const tone = verdictTone(verdict);
  return (
    <span
      className={cn(
        "text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded border whitespace-nowrap",
        toneClass(tone),
        !isNew && "opacity-85",
      )}
    >
      {humanizeVerdict(verdict)}
    </span>
  );
}

/**
 * 2026-05-06 demo-path fix — confidence-source label map + plain-English tooltip.
 * Pre-fix the pill rendered `seed_prior` as `SEED PRIOR` (Tailwind `uppercase`)
 * with tooltip referencing "v1 static edit-type heuristic" — internal
 * versioning + dev jargon. Map + tooltip humanized below.
 */
const CONFIDENCE_SOURCE_LABEL: Record<"measured" | "seed_prior" | "inference", string> = {
  measured: "Measured",
  seed_prior: "Default estimate",
  inference: "Inferred",
};
const CONFIDENCE_SOURCE_TOOLTIP: Record<"measured" | "seed_prior" | "inference", string> = {
  measured: "Based on observed post-change citation data for this URL.",
  seed_prior:
    "Default estimate based on edit type. Beacon will refine this as your history grows.",
  inference: "Inferred from page-level alignment without direct measurement.",
};

function ConfidenceSourcePill({ source }: { source: "measured" | "seed_prior" | "inference" }) {
  const map: Record<typeof source, string> = {
    measured: "text-status-success bg-status-success/10 border-status-success/30",
    seed_prior: "text-status-warning bg-status-warning/10 border-status-warning/30",
    inference: "text-muted-foreground bg-surface-inset/60 border-border/50",
  };
  return (
    <span
      className={cn(
        "text-[9px] tracking-wider px-1 py-0.5 rounded border",
        map[source],
      )}
      title={CONFIDENCE_SOURCE_TOOLTIP[source]}
    >
      {CONFIDENCE_SOURCE_LABEL[source]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tones
// ---------------------------------------------------------------------------

type Tone = "good" | "warn" | "bad" | "neutral";

function verdictTone(v: string): Tone {
  switch (v) {
    case "helping":
    case "landed_fast":
    case "landed_normal":
    case "promising":
    case "attributed_high":
      return "good";
    case "attributed_medium":
    case "landed_slow":
      return "warn";
    case "hurting":
    case "degrading":
    case "never_landed":
      return "bad";
    default:
      return "neutral";
  }
}

function toneClass(t: Tone): string {
  switch (t) {
    case "good":
      return "text-status-success bg-status-success/10 border-status-success/30";
    case "warn":
      return "text-status-warning bg-status-warning/10 border-status-warning/30";
    case "bad":
      return "text-status-danger bg-status-danger/10 border-status-danger/30";
    case "neutral":
      return "text-muted-foreground bg-surface-inset/60 border-border/50";
  }
}

/**
 * Divergence: new-model verdict and dominant-old verdict don't land in the
 * same tone bucket (good vs. bad, etc.). Many events have no legacy verdicts
 * at all (null-URL sitewide rows never got written to url-change-outcomes);
 * those are treated as "agree" — not a divergence.
 */
function isDivergent(newV: string | null, oldV: string | null): boolean {
  if (!newV || !oldV) return false;
  return verdictTone(newV) !== verdictTone(oldV);
}
