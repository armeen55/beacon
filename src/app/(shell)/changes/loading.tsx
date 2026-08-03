/** /changes route skeleton: the shape THIS page actually has now - a header and a short stack of change
 *  rows. It used to hold a strategy control, a daily panel and a New Pages board, none of which live here
 *  any more, so cold navigation drew one layout and then jumped to a different one. */
export default function WorklistLoading() {
  return (
    <div className="max-w-5xl space-y-6 animate-pulse" aria-busy="true" aria-label="Loading changes">
      <div className="space-y-2">
        <div className="h-7 w-40 rounded-md bg-muted/40" />
        <div className="h-4 w-full max-w-xl rounded-md bg-muted/25" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-24 rounded-2xl border border-border bg-surface-raised" />)}
      </div>
    </div>
  );
}
