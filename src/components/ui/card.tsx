import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Card - THE container primitive (FP6a). The design audit found 294 distinct
 * card-container class combos under (shell); every one of them is one of
 * these three variants plus a padding step.
 *
 *   default - standard content card (bg-card, visible border)
 *   quiet   - secondary / supporting card (raised surface, subtle border)
 *   alert   - something is broken or hurting and needs the operator now
 *
 * Colors come from the globals.css token system only. Never add a raw
 * tailwind palette class here (design-system-guard.test.ts enforces it).
 */
const cardVariants = cva("rounded-xl border", {
  variants: {
    variant: {
      default: "border-border bg-card text-card-foreground",
      quiet: "border-border-subtle bg-surface-raised text-card-foreground",
      alert: "border-status-danger/30 bg-status-danger-bg text-card-foreground",
    },
    padding: {
      none: "p-0",
      sm: "p-3",
      md: "p-4",
      lg: "p-6",
    },
  },
  defaultVariants: {
    variant: "default",
    padding: "md",
  },
})

function Card({
  className,
  variant = "default",
  padding = "md",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="card"
      data-variant={variant}
      className={cn(cardVariants({ variant, padding }), className)}
      {...props}
    />
  )
}

export { Card, cardVariants }
