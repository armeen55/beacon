/**
 * Attribution status pill — replaces the legacy "helping / hurting / nothing yet"
 * verdict pill on the /changes list and detail surfaces.
 *
 * Pure presentational. No server-only imports so it works in both server
 * components and the scorecard client component.
 *
 * Visual discipline:
 *   - `computed` is the ONLY status that gets colored to imply a signal strength.
 *   - `weak_estimate` and `no_controls` get neutral / warning styling that
 *     visually signals "not a causal estimate."
 *   - ineligible / unsupported / insufficient statuses get muted styling.
 *   - Confidence is appended when the pill is `computed` (never otherwise —
 *     the engine forces low confidence for every other status, so showing it
 *     would be redundant and visually noisy).
 */

import type { ResultStatus, ConfidenceTier } from "@/domains/attribution/natural-controls";

type Tone = "muted" | "neutral" | "warning" | "info";

const STATUS_LABEL: Record<ResultStatus, string> = {
  computed: "Computed",
  weak_estimate: "Weak estimate",
  no_controls: "No controls",
  unsupported_scope: "Unsupported scope",
  insufficient_baseline: "No baseline",
  insufficient_post_data: "Too early",
  zero_signal: "No signal",
  ineligible_layer: "Not a change",
  ineligible_event: "Ineligible",
};

const STATUS_TONE: Record<ResultStatus, Tone> = {
  computed: "info", // the only non-neutral color; still deliberately NOT green
  weak_estimate: "warning",
  no_controls: "warning",
  unsupported_scope: "muted",
  insufficient_baseline: "muted",
  insufficient_post_data: "muted",
  zero_signal: "muted",
  ineligible_layer: "muted",
  ineligible_event: "muted",
};

const TONE_CLASS: Record<Tone, string> = {
  // Not green. Not red. Attribution never implies "good/bad" — it implies "measured/not measured".
  info: "text-accent-primary bg-accent-primary/10 border-accent-primary/30",
  warning: "text-status-warning bg-status-warning/10 border-status-warning/30",
  neutral: "text-foreground-secondary bg-surface-inset border-border",
  muted: "text-muted-foreground bg-surface-inset/60 border-border/60",
};

const CONFIDENCE_LABEL: Record<ConfidenceTier, string> = {
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
};

export function AttributionStatusPill({
  status,
  confidence,
  compact = false,
}: {
  status: ResultStatus;
  confidence: ConfidenceTier;
  /** Shorter form for list rows. Omits the confidence suffix for non-computed statuses. */
  compact?: boolean;
}) {
  const tone = STATUS_TONE[status];
  const label = STATUS_LABEL[status];
  const showConfidence = status === "computed"; // only computed earns a confidence tag
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[tone]}`}
      title={`attribution status: ${label}${showConfidence ? ` (confidence: ${confidence})` : ""}`}
    >
      <span>{label}</span>
      {showConfidence && !compact && (
        <span className="text-[9px] font-medium opacity-80 tabular-nums tracking-wider">
          · {CONFIDENCE_LABEL[confidence]}
        </span>
      )}
    </span>
  );
}
