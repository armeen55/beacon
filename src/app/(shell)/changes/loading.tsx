export default function ChangesLoading() {
  const rows = Array.from({ length: 8 }, (_, i) => i);

  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading changes">
      {/* PageHeader — matches Changes page.tsx */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-36 rounded-md bg-muted/40" />
          <div className="h-4 w-full max-w-lg rounded-md bg-muted/25" />
          <div className="h-4 w-[72%] max-w-md rounded-md bg-muted/20" />
        </div>
      </div>

      {/* “At a glance” snapshot */}
      <div className="mb-6 rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4">
        <div className="mb-2 h-3 w-24 rounded bg-muted/25" />
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div className="h-4 w-28 rounded bg-muted/30" />
          <div className="h-4 w-40 rounded bg-muted/25" />
          <div className="h-4 w-36 rounded bg-muted/20" />
        </div>
      </div>

      {/* Outcome category tabs (ScorecardTable) */}
      <div className="mb-4 flex items-center gap-1 overflow-x-auto border-b border-border/40 pb-2">
        <div className="h-8 w-28 shrink-0 rounded-md bg-muted/30" />
        <div className="h-8 w-36 shrink-0 rounded-md bg-muted/25" />
        <div className="h-8 w-32 shrink-0 rounded-md bg-muted/25" />
        <div className="h-8 w-40 shrink-0 rounded-md bg-muted/25" />
        <div className="h-8 w-24 shrink-0 rounded-md bg-muted/20" />
      </div>

      {/* Outcome mix summary strip */}
      <div className="mb-4 rounded-md border border-border/50 bg-surface-inset/20 px-3 py-2">
        <div className="h-3 w-40 rounded bg-muted/25" />
        <div className="mt-2 flex flex-wrap gap-2 border-t border-border/40 pt-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-5 w-16 rounded-full bg-muted/20" />
          ))}
        </div>
      </div>

      {/* Refine filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
        <div className="h-3 w-10 rounded bg-muted/30" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-7 w-[7.5rem] rounded-md border border-border/60 bg-surface-inset/30" />
        ))}
        <div className="ml-auto h-3 w-24 rounded bg-muted/20" />
      </div>

      {/* Scorecard table */}
      <div className="overflow-hidden rounded-lg border border-border/70">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border bg-surface-inset">
              {["When", "Work", "Outcome", "Score", "Events", "Linked", "Match", "Lift", "Next"].map((label) => (
                <th key={label} className="px-2.5 py-1.5 text-left">
                  <div className="h-2.5 w-[70%] max-w-[4.5rem] rounded bg-muted/35" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                <td className="px-2.5 py-2 align-top">
                  <div className="h-3 w-10 rounded bg-muted/25" />
                </td>
                <td className="max-w-[300px] px-2.5 py-2 align-top">
                  <div className="h-3.5 w-full rounded bg-muted/35" />
                  <div className="mt-1.5 h-2.5 w-[90%] rounded bg-muted/20" />
                  <div className="mt-1 h-2 w-[75%] rounded bg-muted/15" />
                </td>
                <td className="whitespace-nowrap px-2.5 py-2 align-top">
                  <div className="h-5 w-16 rounded-md bg-muted/30" />
                  <div className="mt-1 flex items-center gap-1">
                    <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted/40" />
                    <div className="h-2 w-12 rounded bg-muted/20" />
                  </div>
                </td>
                <td className="whitespace-nowrap px-2.5 py-2 align-top">
                  <div className="h-3.5 w-8 rounded bg-muted/30" />
                </td>
                <td className="whitespace-nowrap px-2.5 py-2 align-top">
                  <div className="h-3.5 w-5 rounded bg-muted/25" />
                </td>
                <td className="px-2.5 py-2 align-top">
                  <div className="h-3.5 w-6 rounded bg-muted/25" />
                </td>
                <td className="whitespace-nowrap px-2.5 py-2 align-top">
                  <div className="h-3 w-14 rounded bg-muted/20" />
                </td>
                <td className="whitespace-nowrap px-2.5 py-2 align-top">
                  <div className="h-3 w-10 rounded bg-muted/25" />
                </td>
                <td className="px-2.5 py-2 align-top">
                  <div className="h-3 w-20 rounded bg-muted/20" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
