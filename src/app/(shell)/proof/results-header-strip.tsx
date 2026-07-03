/**
 * ResultsHeaderStrip (2026-07-02, FP3) - the one-line count strip, fed by the shared
 * lifecycle split (THE ONE-COUNT RULE in domains/changes/lifecycle-counts.ts). The
 * three numbers are computed by the SAME splitLedgerLifecycle call that places every
 * row into the Wins / What we learned / In flight bands, so the strip can never
 * promise a count the bands don't show - and a Today link that says "16 measuring"
 * lands on exactly 16 In flight. Self-hides when nothing has shipped yet.
 * FP8 (2026-07-02): now the counts line INSIDE the cumulative outcome strip
 * (../cumulative-outcome-strip.tsx), rendered on both Today and Results; classes
 * moved to the token type scale so the whole strip stays token-only.
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
      className="text-body text-foreground/80 tabular-nums"
    >
      You have shipped {total} change{total === 1 ? "" : "s"}. {decided} {decided === 1 ? "has" : "have"} a
      final read ({won} win{won === 1 ? "" : "s"}), and {measuring} {measuring === 1 ? "is" : "are"} still
      measuring below.
    </p>
  );
}
