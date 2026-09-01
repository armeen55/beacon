/** /results loading skeleton, drawn to the Brain: the title row, the belief block, then the field beside its inspector.
 *  Painted only on a true cold navigation; a saved surface paints the real belief in its place. */
export default function ProofLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8 animate-pulse" aria-busy="true" aria-label="Loading results">
      <div className="mb-5 flex items-start justify-between gap-4"><div className="h-8 w-28 rounded-md bg-muted/40" /><div className="h-6 w-40 shrink-0 rounded-md bg-muted/20" /></div>
      <div className="mb-5 space-y-2"><div className="h-3 w-40 rounded bg-muted/20" /><div className="h-7 w-3/4 rounded bg-muted/35" /><div className="h-3 w-2/3 rounded bg-muted/20" /><div className="h-3 w-1/2 rounded bg-muted/20" /></div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="h-64 rounded-xl border border-border-subtle bg-muted/10" /><div className="h-64 rounded-xl border border-border-subtle bg-muted/10" /></div>
    </div>
  );
}
