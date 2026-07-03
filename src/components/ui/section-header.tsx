import { cn } from "@/lib/utils"

/**
 * SectionHeader - THE section title primitive (FP6a). The audit found five
 * sibling section headers on one screen with five different sizes; this
 * component allows exactly two hierarchy levels:
 *
 *   h2 (default) - a page section, text-section (16px)
 *   h3           - a subsection inside a section or card, text-sub (14px)
 *
 * Optional pieces: a muted count next to the title, a one line sub under it,
 * and an action slot on the right (a Button or a link, not another title).
 */
type SectionHeaderProps = {
  title: string
  count?: number
  action?: React.ReactNode
  sub?: string
  level?: "h2" | "h3"
  className?: string
}

function SectionHeader({
  title,
  count,
  action,
  sub,
  level = "h2",
  className,
}: SectionHeaderProps) {
  const Heading = level
  return (
    <div
      data-slot="section-header"
      data-level={level}
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1",
        className
      )}
    >
      <div className="min-w-0">
        <Heading
          className={cn(
            "font-semibold text-foreground",
            level === "h2" ? "text-section" : "text-sub"
          )}
        >
          {title}
          {typeof count === "number" ? (
            <span className="ml-2 text-meta font-normal tabular-nums text-muted-foreground">
              {count}
            </span>
          ) : null}
        </Heading>
        {sub ? (
          <p className="mt-0.5 text-body text-muted-foreground">{sub}</p>
        ) : null}
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      ) : null}
    </div>
  )
}

export { SectionHeader }
export type { SectionHeaderProps }
