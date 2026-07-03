/**
 * BeaconLearnedTile (R23 P15, 2026-07-03) - the visible "Beacon learned" surface.
 * ONE calm card that states, in first person with a concrete number, what the
 * measured results actually taught Beacon and how it changed the ranking.
 *
 * SELF-HIDING: renders NOTHING (returns null) until buildBeaconLearnedSummary
 * hands it a non-null sentence, which only happens once there are enough decided
 * outcomes to say something honest. So a fresh tenant sees no empty "still
 * learning" shell - the tile simply is not there yet.
 *
 * Tokens only (design-system-guard): Card primitive + text tokens, no raw palette.
 * Beacon voice lives in the sentence itself (built in beacon-learned-summary.ts);
 * this component only frames it.
 */

import { Card } from "@/components/ui/card";
import type { BeaconLearnedSummary } from "./beacon-learned-summary";

export function BeaconLearnedTile({ summary }: { summary: BeaconLearnedSummary }) {
  if (!summary.sentence) return null;
  return (
    <Card
      variant="quiet"
      padding="md"
      data-tile="beacon-learned"
      className="space-y-1.5"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-status-success-bg text-status-success text-meta"
        >
          {/* upward spark - a win, in the token success color */}
          &#8593;
        </span>
        <h3 className="text-label font-semibold text-foreground">What Beacon learned</h3>
      </div>
      <p className="text-body text-card-foreground">{summary.sentence}</p>
      <p data-receipt-line="true" className="text-meta text-muted-foreground">
        From {summary.decidedTotal} of your changes that have finished measuring.
      </p>
    </Card>
  );
}
