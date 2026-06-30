import "server-only";
import { cache } from "react";

import { type EvidenceSource } from "./types";
import { loadMovesWorklist } from "@/app/(shell)/moves/moves-data";
import type { TodayMove } from "@/app/(shell)/today-moves-data";

/**
 * Today cockpit data (2026-06-27) — the homepage is now a SIMPLE ActionPack
 * cockpit: "here are the 3 things to do now, here's the bigger list, here's
 * what's new + prepared." One brain (ActionPack), not a 20-section research
 * museum. Read-only, cached/durable only — NO live Profound/DataForSEO, no SEMrush.
 */
export type TodayCockpit = {
  /** The top 3 moves (rich card), ActionPack-ranked. */
  topThree: TodayMove[];
  /** The bigger worklist headline (links to /moves). */
  biggestOpportunities: {
    totalMoves: number;
    demandAtStake: number;
    citationsContested: number;
  };
  /** Create-page / hub opportunities (the New Pages board count). */
  newPagesCount: number;
  /** Moves with a ready draft/brief. */
  preparedMovesCount: number;
  /** Moves a cached DataForSEO SERP verdict validated (build). */
  aiValidatedCount: number;
  /** Per-source coverage (Search / AI / DataForSEO / GA4 / Clarity / teardown). */
  sourceCoverage: Record<EvidenceSource, number>;
  /** Learning-loop proof status (measuring / won / lost + headline). */
  proofStatus: { measuring: number; won: number; lost: number; headline: string | null };
  /** Loud degradation — never a silent-empty cockpit. */
  warnings: string[];
};

async function loadUncached(): Promise<TodayCockpit> {
  // The Today cockpit reads ONLY the cross-request worklist surface snapshot (cached,
  // ~3ms warm). That snapshot is built FROM the ActionPack worklist + carries the few
  // pack-derived counts the cockpit needs (`cockpit`), so Today no longer rebuilds the
  // ~20s ActionPack worklist on its critical path. Fail-soft: no surface → loud warning.
  const worklist = await loadMovesWorklist().catch(() => null);

  const warnings: string[] = [];
  if (!worklist) warnings.push("Canonical worklist unavailable — connect/refresh your sources.");

  const cockpit = worklist?.cockpit ?? null;
  const preparedMovesCount = worklist?.stats.preparedReady ?? 0;
  const aiValidatedCount = cockpit?.aiValidatedCount ?? 0;
  const newPagesCount = cockpit?.newPagesCount ?? 0;

  const topThree = (worklist?.moves ?? []).slice(0, 3);
  if (worklist && worklist.moves.length === 0 && newPagesCount === 0) {
    warnings.push("No moves yet — once your Search + AI demand data syncs, Beacon's ranked moves appear here.");
  }

  return {
    topThree,
    biggestOpportunities: {
      totalMoves: worklist?.stats.movesReady ?? 0,
      demandAtStake: worklist?.stats.demandAtStake ?? 0,
      citationsContested: worklist?.stats.citationsContested ?? 0,
    },
    newPagesCount,
    preparedMovesCount,
    aiValidatedCount,
    sourceCoverage: (cockpit?.sourceCoverage ?? {
      rank_revenue: 0, profound: 0, dataforseo: 0, gsc: 0, ga4: 0, clarity: 0, competitor_teardown: 0,
    }) as Record<EvidenceSource, number>,
    proofStatus: worklist?.learning ?? { measuring: 0, won: 0, lost: 0, headline: null },
    warnings,
  };
}

/** Request-memoized Today cockpit — reads the cached worklist surface only (no rebuild). */
export const loadTodayCockpit = cache(async (): Promise<TodayCockpit> => loadUncached());
