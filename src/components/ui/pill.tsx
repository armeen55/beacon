import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Pill - THE status chip primitive (FP6a). Every status chip in the app is
 * expressible with exactly these five intents plus one neutral fallback:
 *
 *   live      - the change is live on the site (soft green)
 *   waiting   - queued / waiting to ship or waiting on the operator (soft amber)
 *   measuring - live and collecting results, no verdict yet (soft blue,
 *               matches the existing status-info convention for
 *               Accepted / Measuring states)
 *   won       - a proven win, the one celebratory filled treatment
 *   attention - broken or hurting, act now (soft red)
 *   neutral   - counts and labels that carry no verdict (soft gray)
 *
 * Do not invent a new status word or color when one of these fits.
 * Tokens only; design-system-guard.test.ts enforces it.
 */
const pillVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-meta font-medium",
  {
    variants: {
      intent: {
        live: "border-status-success/25 bg-status-success-bg text-status-success",
        waiting: "border-status-warning/25 bg-status-warning-bg text-status-warning",
        measuring: "border-status-info/25 bg-status-info-bg text-status-info",
        won: "border-transparent bg-status-success text-background",
        attention: "border-status-danger/25 bg-status-danger-bg text-status-danger",
        neutral: "border-status-neutral/20 bg-status-neutral-bg text-status-neutral",
      },
    },
    defaultVariants: {
      intent: "neutral",
    },
  }
)

type PillIntent = NonNullable<VariantProps<typeof pillVariants>["intent"]>

function Pill({
  className,
  intent = "neutral",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof pillVariants>) {
  return (
    <span
      data-slot="pill"
      data-intent={intent}
      className={cn(pillVariants({ intent }), className)}
      {...props}
    />
  )
}

export { Pill, pillVariants }
export type { PillIntent }
