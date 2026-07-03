import { cn } from "@/lib/utils"

/**
 * EmptyState - THE honest empty state primitive (FP6a). No icon, no
 * illustration. A bare zero or a blank box is never allowed on a surface;
 * instead say what would make this section non-empty and, when there is
 * one, the operator's next step.
 *
 *   headline - one plain sentence: what is empty and why
 *              ("No changes are measuring yet.")
 *   nextStep - optional one line: what makes it non-empty
 *              ("Ship a move from the worklist and it will show up here.")
 */
type EmptyStateProps = {
  headline: string
  nextStep?: string
  className?: string
}

function EmptyState({ headline, nextStep, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "rounded-xl border border-dashed border-border bg-surface-inset px-4 py-6 text-center",
        className
      )}
    >
      <p className="text-body font-medium text-foreground-secondary">
        {headline}
      </p>
      {nextStep ? (
        <p className="mt-1 text-body text-muted-foreground">{nextStep}</p>
      ) : null}
    </div>
  )
}

export { EmptyState }
export type { EmptyStateProps }
