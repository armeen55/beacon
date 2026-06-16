import Link from "next/link";

import type {
  GoldenPathState,
  GoldenPathStep,
  GoldenPathStepKey,
} from "@/domains/today/golden-path";

/**
 * MAX_SEO_AEO audit P0 #6 — Phase 6 (final): the daily GOLDEN PATH strip.
 *
 * Renders the composed `GoldenPathState` (from `golden-path.ts`) as one
 * horizontal stepper at the TOP of the /today cockpit — Refresh → Review →
 * Approve → Verify → Learn — so the operator can "just open it and auto-flow."
 *
 * Pure presentational: props in, JSX out. No data fetch, no env read, no clock
 * branching — the composer already decided every status + the focus step. The
 * CURRENT step gets a primary CTA that deep-links to the ALREADY-BUILT control
 * for that step (this component reimplements no action):
 *
 *   refresh → /settings/connectors  (connect + the one-click "Refresh my data")
 *   review  → /recommendations      (the review queue)
 *   approve → /recommendations?status=accepted (the approve/publish queue)
 *   verify  → /changes              (push receipts / confirming-live view)
 *   learn   → /changes              (proven outcomes / what your changes drove)
 *
 * White-label, honest, plain-English. Mobile-friendly (the row wraps). Reuses
 * the existing card / border / status-color classes. Carries
 * `data-golden-path-step` + `data-golden-path-current` so a render test (and
 * the operator's eye) can find the focus.
 */

type StepCta = { href: string; label: string };

/** The existing control each step's CURRENT-state CTA links to. */
const STEP_CTA: Record<GoldenPathStepKey, StepCta> = {
  refresh: { href: "/settings/connectors", label: "Refresh data" },
  review: { href: "/recommendations", label: "Review recommendations" },
  approve: {
    href: "/recommendations?status=accepted",
    label: "Publish approved",
  },
  verify: { href: "/changes", label: "Confirm live" },
  learn: { href: "/changes", label: "See results" },
};

/**
 * Per-status visual tokens. `done` = success-green check; `current` =
 * accent-highlighted number; `blocked` = amber number; `upcoming` = muted
 * number. Reuses the same `status-*` / `accent-primary` palette the rest of
 * Today uses, so the strip reads as one with the cockpit.
 */
function stepTokens(status: GoldenPathStep["status"]): {
  badge: string;
  card: string;
  labelClass: string;
} {
  switch (status) {
    case "done":
      return {
        badge:
          "border-status-success/50 bg-status-success/[0.12] text-status-success",
        card: "border-status-success/30 bg-status-success/[0.04]",
        labelClass: "text-foreground",
      };
    case "current":
      return {
        badge:
          "border-accent-primary bg-accent-primary/15 text-accent-primary font-semibold",
        card: "border-accent-primary/50 bg-accent-primary/[0.06]",
        labelClass: "text-foreground font-semibold",
      };
    case "blocked":
      return {
        badge:
          "border-status-warning/60 bg-status-warning/[0.12] text-status-warning",
        card: "border-status-warning/40 bg-status-warning/[0.05]",
        labelClass: "text-foreground",
      };
    case "upcoming":
    default:
      return {
        badge: "border-border/60 bg-background text-muted-foreground",
        card: "border-border/40 bg-surface-inset/10",
        labelClass: "text-muted-foreground",
      };
  }
}

function StepCard({
  step,
  index,
  isCurrent,
}: {
  step: GoldenPathStep;
  index: number;
  isCurrent: boolean;
}) {
  const tokens = stepTokens(step.status);
  const cta = isCurrent ? STEP_CTA[step.key] : null;
  return (
    <li
      data-golden-path-step={step.key}
      data-golden-path-status={step.status}
      data-golden-path-current={isCurrent ? "true" : undefined}
      className={`flex min-w-[150px] flex-1 flex-col gap-2 rounded-lg border px-3 py-3 ${tokens.card}`}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[12px] ${tokens.badge}`}
        >
          {step.status === "done" ? "✓" : index + 1}
        </span>
        <span className={`text-[13px] tracking-tight ${tokens.labelClass}`}>
          {step.label}
        </span>
      </div>
      <p className="text-[12px] leading-snug text-muted-foreground">
        {step.detail}
      </p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-auto inline-flex min-h-[36px] w-fit items-center gap-1 rounded-md border border-accent-primary/40 bg-background px-2.5 py-1.5 text-[12px] font-medium text-accent-primary transition-colors hover:border-accent-primary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
        >
          {cta.label}
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}
    </li>
  );
}

export function GoldenPathStrip({ state }: { state: GoldenPathState }) {
  return (
    <section
      data-golden-path="true"
      aria-label="Your daily flow"
      className="rounded-lg border border-border/60 bg-surface-inset/20 px-4 py-3"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[12px] font-semibold tracking-tight text-foreground">
          Your daily flow
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Refresh → Review → Approve → Verify → Learn
        </p>
      </div>
      <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {state.steps.map((step, index) => (
          <StepCard
            key={step.key}
            step={step}
            index={index}
            isCurrent={step.key === state.currentStepKey}
          />
        ))}
      </ol>
    </section>
  );
}
