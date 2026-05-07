/**
 * <WhyThisVerdict> — Trust Sprint Mini-Phase T3.2 (2026-05-06).
 *
 * Compact `<details>` disclosure that explains a /changes verdict in
 * plain English. Mirrors the T3.1 `<WhyThisNumber>` pattern but for
 * attribution verdicts (helping / hurting / nothing_yet / too_early /
 * not_enough_data / not_enough_native_baseline / not_implemented).
 *
 * Customer copy stays in the `<summary>` and the body's first paragraph
 * + caveats. Operator-only debug detail (raw Z-score, mu_pre/mu_post,
 * sustain counts, anchor_source) is hidden behind a nested `<details>`
 * "Operator detail" toggle so it never leaks to the customer-facing
 * surface.
 *
 * Trust badge:
 *   trustworthy → green "Trustworthy" (used for abstains)
 *   directional → amber "Directional" (default for helping / hurting)
 *   unreliable  → red "Unreliable"   (helping/hurting on contaminated dates
 *                                     or with sparse pre-window)
 *
 * Honesty contract: the trust badge color and label MUST reflect the
 * provenance object's `trustLevel`. The architecture invariant
 * `tests/architecture/verdict-provenance-trust-labels.test.ts` enforces
 * this contract — the customer summary line must NEVER print a raw
 * Z-score (Greek notation, σ, μ, etc.).
 */

import type {
  VerdictProvenance,
  VerdictTrustLevel,
} from "@/domains/attribution/verdict-provenance";

const TRUST_BADGE_LABEL: Record<VerdictTrustLevel, string> = {
  trustworthy: "Trustworthy",
  directional: "Directional",
  unreliable: "Unreliable",
};

const TRUST_BADGE_CLASS: Record<VerdictTrustLevel, string> = {
  trustworthy:
    "bg-status-success/15 text-status-success border-status-success/30",
  directional:
    "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  unreliable:
    "bg-status-danger/15 text-status-danger border-status-danger/30",
};

export function WhyThisVerdict({
  provenance,
}: {
  provenance: VerdictProvenance;
}) {
  const badge = TRUST_BADGE_LABEL[provenance.trustLevel];
  const badgeClass = TRUST_BADGE_CLASS[provenance.trustLevel];

  return (
    <details
      className="group block text-[12px] leading-relaxed"
      data-why-this-verdict="true"
      data-verdict-id={provenance.id}
      data-trust-level={provenance.trustLevel}
    >
      <summary
        className="cursor-pointer select-none list-none inline-flex items-center gap-1.5 text-muted-foreground/80 hover:text-muted-foreground"
        aria-label={`Why this verdict? ${provenance.label}`}
      >
        <span aria-hidden="true" className="text-[10px]">›</span>
        <span className="underline decoration-dotted underline-offset-2">
          Why this verdict?
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${badgeClass}`}
          data-trust-badge={provenance.trustLevel}
        >
          {badge}
        </span>
      </summary>

      <div className="mt-2 ml-2 max-w-prose space-y-2.5 text-foreground/90 border-l-2 border-muted/40 pl-3">
        <p className="text-[12px] text-foreground/95 leading-relaxed">
          {provenance.plainEnglish}
        </p>

        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-[11px]">
          {provenance.anchorDate ? (
            <>
              <dt className="text-muted-foreground/60">Anchor date</dt>
              <dd>
                {provenance.anchorDate}
                {provenance.anchorSource === "live_at" ? (
                  <span className="ml-1.5 text-[10px] text-muted-foreground/60">
                    (live-at scan timestamp)
                  </span>
                ) : provenance.anchorSource === "timestamp" ? (
                  <span className="ml-1.5 text-[10px] text-amber-700 dark:text-amber-400">
                    (changelog timestamp — no live-at scan available)
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}

          <dt className="text-muted-foreground/60">Before window</dt>
          <dd>{provenance.preWindowLabel}</dd>

          <dt className="text-muted-foreground/60">After window</dt>
          <dd>{provenance.postWindowLabel}</dd>

          {provenance.normalRangeLabel ? (
            <>
              <dt className="text-muted-foreground/60">Daily rate</dt>
              <dd>{provenance.normalRangeLabel}</dd>
            </>
          ) : null}

          {provenance.changeStrengthLabel ? (
            <>
              <dt className="text-muted-foreground/60">Signal strength</dt>
              <dd>{provenance.changeStrengthLabel}</dd>
            </>
          ) : null}

          {provenance.sustainLabel ? (
            <>
              <dt className="text-muted-foreground/60">Sustain</dt>
              <dd>{provenance.sustainLabel}</dd>
            </>
          ) : null}
        </dl>

        {provenance.caveats.length > 0 ? (
          <ul className="list-disc list-outside ml-4 space-y-0.5 text-[11px] text-amber-700 dark:text-amber-400">
            {provenance.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        ) : null}

        <details className="mt-1.5 text-[10px] text-muted-foreground/60">
          <summary className="cursor-pointer select-none list-none underline decoration-dotted underline-offset-2 hover:text-muted-foreground/80">
            Operator detail
          </summary>
          <ul className="mt-1 ml-3 space-y-0.5 list-disc list-outside text-[10px] text-muted-foreground/70">
            {provenance.operatorDetail.map((d, i) => (
              <li key={i} className="break-all font-mono">
                {d}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </details>
  );
}
