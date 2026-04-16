/**
 * Rank over time — placeholder for CX3.
 *
 * CX3 replaces this with the full rank chart screen:
 * line chart of AI mention rate vs top competitor over 30 days,
 * week-over-week delta, platform-segmented view, latest signal line.
 */

export default function RankPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Your Rank Over Time</h1>
      <p className="text-sm text-muted-foreground">
        This screen will show how your AI visibility is changing week over
        week, compared to your top competitor.
      </p>
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
        Coming in CX3 + CX6 — rank climb chart with daily rerun data
      </div>
    </div>
  );
}
