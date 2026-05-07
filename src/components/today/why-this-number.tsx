/**
 * <WhyThisNumber> — Trust Sprint Mini-Phase T3.1 (2026-05-06).
 *
 * Compact `<details>` disclosure that explains a /today number in plain
 * English. Takes a `ScoreProvenance` object built by one of the pure
 * builders in `src/domains/today/score-provenance.ts`.
 *
 * Customer copy stays in the `<summary>` and the body's first paragraph.
 * Operator-only debug detail (raw table names, file:line citations) is
 * hidden behind a nested `<details>` "Operator detail" toggle so it
 * never leaks to the customer-facing surface.
 *
 * Trust badge:
 *   trustworthy → green "Trustworthy"
 *   directional → amber "Directional"
 *   unreliable  → red "Unreliable"
 *
 * Honesty contract: the trust badge color and label MUST reflect the
 * provenance object's `trustLevel`. The architecture invariant test
 * `tests/architecture/score-provenance-trust-labels.test.ts` enforces
 * this — cosmetic rebrand of `directional` to "Looks great" is a
 * regression.
 */

import type { ScoreProvenance, ScoreTrustLevel } from "@/domains/today/score-provenance";

const TRUST_BADGE_LABEL: Record<ScoreTrustLevel, string> = {
  trustworthy: "Trustworthy",
  directional: "Directional",
  unreliable: "Unreliable",
};

const TRUST_BADGE_CLASS: Record<ScoreTrustLevel, string> = {
  trustworthy:
    "bg-status-success/15 text-status-success border-status-success/30",
  directional:
    "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  unreliable:
    "bg-status-danger/15 text-status-danger border-status-danger/30",
};

export function WhyThisNumber({
  provenance,
  /** When true, render only the disclosure chevron (no header label) — used inline next to a value. */
  compact = false,
}: {
  provenance: ScoreProvenance;
  compact?: boolean;
}) {
  const badge = TRUST_BADGE_LABEL[provenance.trustLevel];
  const badgeClass = TRUST_BADGE_CLASS[provenance.trustLevel];

  return (
    <details
      className="group inline-block text-[11px] leading-relaxed"
      data-why-this-number="true"
      data-score-id={provenance.id}
      data-trust-level={provenance.trustLevel}
    >
      <summary
        className="cursor-pointer select-none list-none inline-flex items-center gap-1.5 text-muted-foreground/70 hover:text-muted-foreground"
        aria-label={`Why this number? ${provenance.label}`}
      >
        <span aria-hidden="true" className="text-[10px]">›</span>
        {compact ? (
          <span className="underline decoration-dotted underline-offset-2">
            Why this number?
          </span>
        ) : (
          <span>
            <span className="underline decoration-dotted underline-offset-2">
              Why this number?
            </span>
          </span>
        )}
      </summary>

      <div className="mt-2 ml-2 max-w-prose space-y-2 text-foreground/90 border-l-2 border-muted/40 pl-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-medium">{provenance.label}</span>
          <span
            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${badgeClass}`}
            data-trust-badge={provenance.trustLevel}
          >
            {badge}
          </span>
        </div>

        <p className="text-[11px] text-muted-foreground/90">
          {provenance.plainEnglish}
        </p>

        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-muted-foreground/60">Source</dt>
          <dd>{provenance.sourceLabel}</dd>

          <dt className="text-muted-foreground/60">Window</dt>
          <dd>{provenance.dateWindow}</dd>

          <dt className="text-muted-foreground/60">Platforms</dt>
          <dd>{provenance.platformRule}</dd>

          <dt className="text-muted-foreground/60">Counted</dt>
          <dd>
            {provenance.numeratorLabel}
            {provenance.numeratorValue != null
              ? ` (${provenance.numeratorValue.toLocaleString("en-US")})`
              : ""}
          </dd>

          <dt className="text-muted-foreground/60">Out of</dt>
          <dd>
            {provenance.denominatorLabel}
            {provenance.denominatorValue != null
              ? ` (${provenance.denominatorValue.toLocaleString("en-US")})`
              : ""}
          </dd>

          {provenance.samplingStatus ? (
            <>
              <dt className="text-muted-foreground/60">Coverage</dt>
              <dd className="capitalize">{provenance.samplingStatus}</dd>
            </>
          ) : null}
        </dl>

        {provenance.caveats.length > 0 ? (
          <ul className="list-disc list-outside ml-4 space-y-0.5 text-[11px] text-muted-foreground/90">
            {provenance.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        ) : null}

        <details className="mt-1.5 text-[10px] text-muted-foreground/60">
          <summary className="cursor-pointer select-none list-none underline decoration-dotted underline-offset-2 hover:text-muted-foreground/80">
            Operator detail
          </summary>
          <code className="block whitespace-pre-wrap break-all mt-1 text-[10px] text-muted-foreground/70">
            {provenance.operatorDetail}
          </code>
        </details>
      </div>
    </details>
  );
}
