import { cn } from "@/lib/utils"

/**
 * PageShell - THE page frame primitive (FP6a). Every route under (shell)
 * renders inside this so content width and the title row stop jumping
 * between pages.
 *
 * The (shell) layout already provides the outer gutter (mx-auto
 * max-w-[1120px] p-3 sm:p-6 lg:p-8); PageShell normalizes the content
 * column to max-w-5xl inside it and owns the single h1 (text-page, 20px).
 * A page has exactly one PageShell and no other h1.
 *
 *   title       - the page name, plain words
 *   description - optional one line under the title (text-body, muted)
 *   actions     - optional right side controls (Buttons, a Pill)
 *   children    - sections, stacked with a consistent gap-6
 */
type PageShellProps = {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}

function PageShell({
  title,
  description,
  actions,
  children,
  className,
}: PageShellProps) {
  return (
    <div
      data-slot="page-shell"
      className={cn("mx-auto w-full max-w-5xl", className)}
    >
      <header
        data-slot="page-shell-header"
        className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2"
      >
        <div className="min-w-0">
          <h1 className="text-page font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-body text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </header>
      <div data-slot="page-shell-content" className="mt-6 flex flex-col gap-6">
        {children}
      </div>
    </div>
  )
}

export { PageShell }
export type { PageShellProps }
