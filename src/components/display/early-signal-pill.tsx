/**
 * EarlySignalPill — surfaces the engine's `weak_signal` verdict to the
 * customer as "Early signs of lift."
 *
 * Context (T-EarlySignal, 2026-05-08):
 *   The URL Z-score engine (`url-verdict.ts`) emits `weak_signal` when
 *   `|z| ∈ [zBarWeakSignal=1.2, zBar=2.0)` AND sustain ≥ 5 of last 7 days
 *   AND the sparse-pre-window precondition is satisfied. The label
 *   string ("Early signs of lift") is operator-locked at
 *   `url-verdict.ts:VERDICT_LABEL` and MUST NOT be rendered as proof
 *   ("win", "confirmed", "validated"). This component renders only the
 *   approved label; callers cannot override it.
 *
 *   Pre-T-EarlySignal: `weak_signal` was visible only as a small NOTE
 *   on the "Change strength" math row inside the row-expand panel of
 *   `/changes` (`scorecard-client.tsx:945-950`), so a customer had to
 *   expand the math drilldown to see it. There was no headline pill,
 *   no row-level affordance, nothing on /today or /changes/[id]. This
 *   component is the smallest possible surfacing — it does NOT replace
 *   the AttributionStatusPill (which represents the natural-controls
 *   diff-in-diff engine, a separate signal). It renders alongside.
 *
 *   Honesty contract:
 *     - Renders ONLY when `verdict === "weak_signal"` — every other
 *       value renders `null`. No fallback, no defaults, no "early-ish"
 *       partial states.
 *     - Tone is amber/warning. Never green/success.
 *     - Label text is fetched from `VERDICT_LABEL` so the operator-
 *       locked customer-safe phrasing stays the source of truth.
 *
 *   Pure presentational. No server-only imports. Safe in client components.
 */

import { VERDICT_LABEL, type VerdictLabel } from "@/domains/attribution/url-verdict";

export function EarlySignalPill({
  verdict,
  compact = false,
}: {
  verdict: VerdictLabel | null | undefined;
  /** Slightly tighter padding for inline row use. */
  compact?: boolean;
}) {
  if (verdict !== "weak_signal") return null;

  const padding = compact ? "px-1.5 py-0.5" : "px-2 py-0.5";

  return (
    <span
      data-early-signal-pill="true"
      className={`inline-flex items-center gap-1 rounded-md border text-[11px] font-semibold border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 ${padding}`}
      title="Directional only — z-score above 1.2 but below the 2.0 strong-signal bar. Not yet proof; watch the post-change window over the next few days."
    >
      <span aria-hidden="true" className="text-[9px]">
        ↗
      </span>
      <span>{VERDICT_LABEL.weak_signal}</span>
    </span>
  );
}
