/**
 * ChangeDetailV2Client — /changes/[id] 5-act proof brief.
 *
 * Bundle (2026-05-11) — `/changes/[id]` redesign per the maximum-depth
 * UI audit (`~/.claude/plans/i-want-a-maximum-depth-curried-curry.md`).
 *
 * Replaces the legacy data-rich detail page (8 stacked cards: Outcome
 * summary, Evidence tier, Impact assessment with Confidence /
 * Direction / Why / What to do next, Replicate, Strengthen, Expected
 * outcome, Attribution chain) with a customer-shaped narrative:
 *
 *   Header  → back link + ONE result pill + title + URL + date
 *   Act 1   → What changed (plain-English description, URL, date)
 *   Act 2   → What Beacon expected (hypothesis or honest fallback)
 *   Act 3   → What happened after (result + one-sentence summary +
 *             optional sparkline)
 *   Act 4   → Evidence (humanized outcome events, no raw enums)
 *   Act 5   → What to do next (CTAs driven by pill kind + rec
 *             linkage)
 *
 * Pure presentation. The server page (page.tsx) resolves all data and
 * feeds typed props in. No new fetches, no server actions wired
 * here, no domain logic changes.
 *
 * Customer-vocabulary contract (forbidden-vocabulary guardrail):
 *   • No "Z-score" / "evidence tier" / "lifecycle classification" /
 *     "resolver tier" / "evidence_hash" / raw event enum names.
 *   • Result pill is one of the 7-set: Helping / Hurting / Too early
 *     / No signal yet / Needs review / Live / Watching.
 *   • Event labels read as plain English; raw `first_appearance` /
 *     etc. NEVER appear in rendered text.
 */
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { ProofPill } from "@/domains/changes/proof-timeline/result-pill";
import type {
  HumanizedEvent,
  EventTone,
} from "@/domains/changes/proof-timeline/event-humanizer";
import type { NextActionCta } from "@/domains/changes/proof-timeline/next-action";

import { ChangesV2ResultPill } from "@/components/changes/v2/changes-v2-result-pill";

export type ChangeDetailV2Props = {
  /** Plain-English title for the change. */
  title: string;
  /** Customer-friendly target URL when present. */
  targetUrl: string | null;
  /** ISO timestamp of when the change shipped. */
  shippedAt: string;
  /** Resolved result pill — same shape as the timeline pill. */
  pill: ProofPill;
  /** Already-humanized hypothesis text. `null` triggers the calm
   *  "Beacon will use this as a baseline" fallback. */
  hypothesis: string | null;
  /** Plain-language source of the hypothesis (already resolved). */
  hypothesisSource: "operator" | "recommendation" | "inferred" | null;
  /** Pattern-timing rewrite ("Similar changes usually show signal
   *  around day N."), null when there's no readyOn prediction. */
  patternTimingNarrative: string | null;
  /** Already-humanized outcome events. Empty array renders the calm
   *  "No outcome events yet" message inside Act 4. */
  events: ReadonlyArray<HumanizedEvent>;
  /** Optional sparkline points for Act 3 — date + count is enough
   *  for an honest visualization. */
  sparkline: ReadonlyArray<{ date: string; count: number }>;
  /** Tracked-platform labels involved in this change. Renders as
   *  light chips in Act 3 when present. */
  platformLabels: ReadonlyArray<string>;
  /** Truth tag for Act 1's provenance line: was this row stamped as
   *  Beacon-recommended? */
  beaconRecommended: boolean;
  /** Ordered Act 5 CTAs from the next-action resolver. */
  nextActions: ReadonlyArray<NextActionCta>;
};

export function ChangeDetailV2Client(props: ChangeDetailV2Props) {
  const {
    title,
    targetUrl,
    shippedAt,
    pill,
    hypothesis,
    hypothesisSource,
    patternTimingNarrative,
    events,
    sparkline,
    platformLabels,
    beaconRecommended,
    nextActions,
  } = props;

  const formattedShippedAt = formatLongDate(shippedAt);

  return (
    <div
      className="max-w-3xl space-y-6"
      data-change-detail-layout="v2-proof-brief"
    >
      {/* Header */}
      <header data-change-detail-header="true">
        <Link
          href="/changes?v2=1"
          className="inline-flex items-center text-[12px] font-medium text-muted-foreground hover:text-foreground"
          data-change-detail-back="true"
        >
          ← Changes
        </Link>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1
              className="text-[18px] font-semibold tracking-tight text-foreground leading-snug"
              data-change-detail-title="true"
            >
              {title}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
              {targetUrl && (
                <span
                  className="font-mono truncate max-w-[360px]"
                  data-change-detail-url="true"
                  title={targetUrl}
                >
                  {targetUrl}
                </span>
              )}
              <span
                className="tabular-nums"
                data-change-detail-date="true"
              >
                {formattedShippedAt}
              </span>
              {beaconRecommended && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-accent-primary/35 bg-accent-primary/[0.06] px-2 py-0.5 text-[11px] font-medium text-accent-primary"
                  data-change-detail-recommended="true"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-primary" />
                  Beacon recommended
                </span>
              )}
            </div>
          </div>
          <ChangesV2ResultPill pill={pill} />
        </div>
        <p
          className="mt-2 text-[12.5px] leading-relaxed text-foreground/80"
          data-change-detail-result-summary="true"
        >
          {pill.blurb}
        </p>
      </header>

      {/* Act 1 — What changed */}
      <Act number={1} label="What changed">
        <p
          className="text-[13.5px] leading-relaxed text-foreground"
          data-change-detail-act1-body="true"
        >
          {title}
        </p>
        {targetUrl && (
          <p className="mt-2 text-[12px] font-mono text-muted-foreground break-all">
            {targetUrl}
          </p>
        )}
        <p className="mt-2 text-[12px] text-muted-foreground">
          Shipped on{" "}
          <span className="font-medium text-foreground">
            {formattedShippedAt}
          </span>
          .
        </p>
      </Act>

      {/* Act 2 — What Beacon expected */}
      <Act number={2} label="What Beacon expected">
        {hypothesis ? (
          <>
            <p
              className="text-[13px] leading-relaxed text-foreground"
              data-change-detail-act2-hypothesis="true"
            >
              {hypothesis}
            </p>
            {hypothesisSource && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Source:{" "}
                <span className="font-medium text-foreground/80">
                  {HYPOTHESIS_SOURCE_LABEL[hypothesisSource]}
                </span>
                .
              </p>
            )}
          </>
        ) : (
          <p
            className="text-[12.5px] leading-relaxed text-muted-foreground"
            data-change-detail-act2-fallback="true"
          >
            Beacon is using this change as a baseline for future
            comparisons.
          </p>
        )}
      </Act>

      {/* Act 3 — What happened after */}
      <Act number={3} label="What happened after">
        <div className="flex items-center gap-2">
          <ChangesV2ResultPill pill={pill} />
          <span className="text-[13px] font-medium text-foreground">
            {pill.label}.
          </span>
        </div>
        <p
          className="mt-2 text-[13px] leading-relaxed text-foreground/80"
          data-change-detail-act3-blurb="true"
        >
          {pill.blurb}
        </p>
        {patternTimingNarrative && (
          <p
            className="mt-1.5 text-[11.5px] text-muted-foreground leading-relaxed"
            data-change-detail-act3-pattern-timing="true"
          >
            {patternTimingNarrative}
          </p>
        )}
        {platformLabels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {platformLabels.map((label) => (
              <span
                key={label}
                className="inline-flex items-center rounded-full border border-border/60 bg-surface-inset/60 px-2 py-0.5 text-[11px] font-medium text-foreground/75"
                data-change-detail-act3-platform="true"
              >
                {label}
              </span>
            ))}
          </div>
        )}
        {sparkline.length > 0 && (
          <Sparkline points={sparkline} />
        )}
      </Act>

      {/* Act 4 — Evidence */}
      <Act number={4} label="Evidence">
        {events.length === 0 ? (
          <p
            className="text-[12.5px] leading-relaxed text-muted-foreground"
            data-change-detail-act4-empty="true"
          >
            No outcome events linked yet — Beacon is still watching for
            the next AI reading.
          </p>
        ) : (
          <ul
            className="space-y-2.5"
            data-change-detail-act4-events="true"
            aria-label="Outcome events"
          >
            {events.map((event, i) => (
              <EvidenceRow key={`${event.kind}-${event.date}-${i}`} event={event} />
            ))}
          </ul>
        )}
      </Act>

      {/* Act 5 — What to do next */}
      <Act number={5} label="What to do next">
        <div
          className="flex flex-wrap items-center gap-3"
          data-change-detail-act5-ctas="true"
        >
          {nextActions.map((cta, i) => (
            <NextActionLink key={`${cta.kind}-${i}`} cta={cta} />
          ))}
        </div>
      </Act>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Act wrapper
// ─────────────────────────────────────────────────────────────────────

function Act({
  number,
  label,
  children,
}: {
  number: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-lg border border-border/60 bg-surface-base px-4 py-4"
      data-change-detail-act={`act-${number}`}
      aria-label={`Act ${number}: ${label}`}
    >
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        Act {number} · {label}
      </p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Evidence row
// ─────────────────────────────────────────────────────────────────────

const TONE_BORDER: Record<EventTone, string> = {
  success: "border-l-status-success/60",
  danger: "border-l-status-danger/60",
  muted: "border-l-border",
};

const TONE_DOT: Record<EventTone, string> = {
  success: "bg-status-success",
  danger: "bg-status-danger",
  muted: "bg-muted-foreground/60",
};

function EvidenceRow({ event }: { event: HumanizedEvent }) {
  return (
    <li
      data-change-detail-event-kind={event.kind}
      data-change-detail-event-tone={event.tone}
      className={cn(
        "rounded-md border border-border/60 bg-surface-inset/30 px-3 py-2 border-l-[3px]",
        TONE_BORDER[event.tone],
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[event.tone])} />
        <span className="text-[12.5px] font-medium text-foreground">
          {event.label}
        </span>
        <span className="text-[11px] text-muted-foreground">·</span>
        <span className="text-[11px] text-muted-foreground">
          {event.platformLabel}
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {formatShortDate(event.date)}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
        {event.summary}
      </p>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Next-action CTA
// ─────────────────────────────────────────────────────────────────────

function NextActionLink({ cta }: { cta: NextActionCta }) {
  const isPrimary = cta.emphasis === "primary";
  return (
    <Link
      href={cta.href}
      data-change-detail-cta={cta.kind}
      data-change-detail-cta-emphasis={cta.emphasis}
      className={cn(
        "inline-flex items-center rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
        isPrimary
          ? "bg-accent-primary text-accent-primary-foreground hover:bg-accent-primary/90"
          : "border border-border/60 text-foreground/80 hover:bg-surface-inset/50",
      )}
    >
      {cta.label}
      {isPrimary && <span className="ml-1">→</span>}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sparkline (Act 3)
// ─────────────────────────────────────────────────────────────────────

function Sparkline({
  points,
}: {
  points: ReadonlyArray<{ date: string; count: number }>;
}) {
  const max = Math.max(0, ...points.map((p) => p.count));
  const min = Math.min(0, ...points.map((p) => p.count));
  const range = max - min || 1;
  const width = 240;
  const height = 36;
  const stepX = points.length > 1 ? width / (points.length - 1) : width;

  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p.count - min) / range) * height;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="mt-3" data-change-detail-act3-sparkline="true">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="text-accent-primary"
        aria-label="Citation count over time"
      >
        <path d={path} stroke="currentColor" strokeWidth={1.5} fill="none" />
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const HYPOTHESIS_SOURCE_LABEL: Record<
  NonNullable<ChangeDetailV2Props["hypothesisSource"]>,
  string
> = {
  operator: "You wrote this",
  recommendation: "From a Beacon recommendation",
  inferred: "Auto-inferred from the edit type",
};

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
