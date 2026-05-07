/**
 * onboarding-shell — Gap C.1 (2026-05-07).
 *
 * Shared layout for /onboard/* pages:
 *   - Centered, premium card layout (matches /signup styling)
 *   - "Step N of 4" indicator
 *   - Title + optional sub-copy
 *   - Children slot for the step's actual form
 *
 * Pure layout — no data fetch, no client interactivity. Each onboarding
 * page composes this with its own form/placeholder content.
 */

import Link from "next/link";

export const ONBOARDING_TOTAL_STEPS = 4;

export type OnboardingStepId = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<OnboardingStepId, string> = {
  1: "Business",
  2: "Service area",
  3: "Competitors",
  4: "Review",
};

export function OnboardingShell({
  step,
  title,
  subtitle,
  children,
}: {
  step: OnboardingStepId;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-8">
        <OnboardingStepIndicator current={step} />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="text-[14px] text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {children}
        <p className="text-[12px] text-muted-foreground pt-2">
          Need to step out?{" "}
          <Link href="/login" className="underline">
            Save and sign out
          </Link>
        </p>
      </div>
    </div>
  );
}

function OnboardingStepIndicator({ current }: { current: OnboardingStepId }) {
  return (
    <div
      className="flex items-center gap-2"
      aria-label={`Step ${current} of ${ONBOARDING_TOTAL_STEPS}: ${STEP_LABELS[current]}`}
    >
      {([1, 2, 3, 4] as OnboardingStepId[]).map((n) => {
        const isCurrent = n === current;
        const isDone = n < current;
        return (
          <div
            key={n}
            className="flex items-center gap-2"
            aria-current={isCurrent ? "step" : undefined}
          >
            <div
              className={
                "h-2 w-8 rounded-full transition-colors " +
                (isDone || isCurrent
                  ? "bg-foreground"
                  : "bg-foreground/15")
              }
            />
          </div>
        );
      })}
      <span className="ml-2 text-[12px] text-muted-foreground tabular-nums">
        Step {current} of {ONBOARDING_TOTAL_STEPS}
      </span>
    </div>
  );
}
