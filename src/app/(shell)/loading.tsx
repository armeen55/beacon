export default function ShellLoading() {
  return (
    <div className="space-y-8 animate-pulse" aria-busy="true" aria-label="Loading">
      <section className="space-y-3">
        <div className="h-7 w-48 max-w-full rounded-md bg-muted/40" />
        <div className="h-4 w-full max-w-md rounded-md bg-muted/25" />
      </section>
      <section className="space-y-4 rounded-lg border border-border/60 bg-surface-inset/30 p-6">
        <div className="h-4 w-3/4 max-w-lg rounded-md bg-muted/35" />
        <div className="h-4 w-full rounded-md bg-muted/25" />
        <div className="h-4 w-[83%] max-w-xl rounded-md bg-muted/25" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="h-24 rounded-md bg-muted/20" />
          <div className="h-24 rounded-md bg-muted/20" />
        </div>
      </section>
    </div>
  );
}
