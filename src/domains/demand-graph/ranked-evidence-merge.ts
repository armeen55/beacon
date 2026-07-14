import type { RankedUnifiedEntry } from "@/domains/allocator/unified-list";
import type { MoveCandidate } from "./build-graph";

function pathKey(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").toLowerCase() || "/";
  } catch {
    return url.toLowerCase();
  }
}

/** Add final-ranked research evidence to a graph move without changing its decision. */
export function mergeRankedEvidenceIntoGraphMove(
  move: MoveCandidate,
  entries: readonly RankedUnifiedEntry[],
): MoveCandidate {
  const ranked = entries.find((entry) => {
    if (!entry.graphBacked) return false;
    const pageMatch = entry.page && move.ownedUrl && pathKey(entry.page) === pathKey(move.ownedUrl);
    const queryMatch = entry.query.trim().toLocaleLowerCase("en-US") === move.label.trim().toLocaleLowerCase("en-US");
    return !!pageMatch || queryMatch;
  });
  if (!ranked) return move;
  return {
    ...move,
    competitorUrls: [...new Set([...ranked.competitorUrls, ...move.competitorUrls])].slice(0, 8),
    fanoutSeeds: [...new Set([...move.fanoutSeeds, ...ranked.fanoutSeeds])].slice(0, 16),
    aeoEvidence: move.aeoEvidence ?? ranked.aeoEvidence ?? undefined,
  };
}
