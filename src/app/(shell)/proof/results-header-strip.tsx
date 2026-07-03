/**
 * ResultsHeaderStrip (2026-07-02, FP3) - the Results page's one-line count strip,
 * fed by the shared lifecycle loader (THE ONE-COUNT RULE in
 * domains/changes/lifecycle-counts.ts). The three numbers are computed by the SAME
 * splitLedgerLifecycle call that places every row into the Wins / What we learned /
 * In flight bands below, so the header can never promise a count the bands don't
 * show - and a Today link that says "16 measuring" lands on exactly 16 In flight.
 * Self-hides when nothing has shipped yet (the page's empty state covers that).
 */
export function ResultsHeaderStrip({
  measuring,
  decided,
  won,
}: {
  measuring: number;
  decided: number;
  won: number;
}) {
  const total = measuring + decided;
  if (total === 0) return null;
  return (
    <p
      data-results-header-strip="true"
      className="mt-2 text-[13px] text-foreground/80 tabular-nums"
    >
      You have shipped {total} change{total === 1 ? "" : "s"}. {decided} {decided === 1 ? "has" : "have"} a
      final read ({won} win{won === 1 ? "" : "s"}), and {measuring} {measuring === 1 ? "is" : "are"} still
      measuring below.
    </p>
  );
}
