import "server-only";

/**
 * 2026-06-09 — "Steal this move" loader (derive-on-read).
 *
 * Assembles competitor moves from the durable change stores + citation
 * observations, then attaches the decision-loop tie-ins per move:
 *   • evidenceLine — this tenant's OWN history for the equivalent
 *     action, via the What-If engine (`simulateAction`). Only attached
 *     when it can genuinely speak (sample ≥ its floor); silence beats
 *     a hollow stat.
 *   • forecastLine — the cross-tenant peer forecast seam
 *     (`buildPeerMoveForecast`). Patterns are [] until tenant #2 +
 *     `BEACON_CROSS_TENANT_BRAIN`, so this is null today by design;
 *     the seam is wired so activation is a data flip, not a refactor.
 *
 * Soft-fails to an empty list — the customer section renders nothing
 * rather than an error.
 */

import { getPromptAnswerObservations } from "@/storage/canonical-store";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { getOutcomeRecords } from "@/domains/product/outcome-store";
import { simulateAction } from "@/domains/product/whatif-engine";
import { buildPeerMoveForecast } from "@/domains/product/move-forecast";

import { buildCompetitorCitationSeries } from "./citation-series";
import { detectCompetitorMoves } from "./detect-moves";
import { getCompetitorSitemapChangeHistory } from "./sitemap-changes-store";
import { getCompetitorStructuralChanges } from "./structural-changes-store";
import type { CompetitorMove } from "./types";

export type CompetitorMoveWithEvidence = CompetitorMove & {
  /** "In your own history: …" — only when simulateAction can speak. */
  evidenceLine: string | null;
  /** Peer forecast (gated; null until the brain is live). */
  forecastLine: string | null;
};

export async function loadCompetitorMoves(opts?: {
  now?: Date;
}): Promise<CompetitorMoveWithEvidence[]> {
  try {
    const now = opts?.now ?? new Date();
    const todayIso = now.toISOString().slice(0, 10);

    const [universe, sitemapChanges, structuralChanges, observations] =
      await Promise.all([
        loadCompetitorUniverseRuntime(),
        getCompetitorSitemapChangeHistory(),
        getCompetitorStructuralChanges(),
        getPromptAnswerObservations(),
      ]);
    if (universe.entries.length === 0) return [];

    const series = buildCompetitorCitationSeries(
      observations,
      universe.entries.map((e) => ({
        domain: e.domain,
        displayName: e.display_name,
      })),
    );

    const moves = detectCompetitorMoves({
      sitemapChanges,
      structuralChanges,
      series,
      todayIso,
    });
    if (moves.length === 0) return [];

    // Decision-loop tie-ins. One outcome read serves every move.
    let outcomes: Awaited<ReturnType<typeof getOutcomeRecords>> = [];
    try {
      outcomes = await getOutcomeRecords();
    } catch {
      outcomes = [];
    }

    return moves.map((move) => {
      let evidenceLine: string | null = null;
      let forecastLine: string | null = null;
      try {
        const sim = simulateAction(
          {
            action_type: move.action.actionType,
            target_page_url: null,
            target_topic: null,
            description: move.action.label,
          },
          outcomes,
        );
        if (sim.can_simulate) {
          evidenceLine = `In your own history: ${sim.explanation}`;
        }
        const forecast = buildPeerMoveForecast({
          actionType: move.action.actionType,
          thisTenantResult: sim,
          // Cross-tenant patterns flow here once the brain producer is
          // live (n ≥ 2 + gate). Empty today → forecast stays null.
          patterns: [],
        });
        if (forecast != null) forecastLine = forecast.line;
      } catch {
        /* evidence is garnish — never break the move list */
      }
      return { ...move, evidenceLine, forecastLine };
    });
  } catch {
    return [];
  }
}
