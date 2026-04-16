/**
 * CX5.5 — Move assembly.
 *
 * The complete pipeline: gaps → score → select → generate payloads → Moves.
 *
 * This is the SINGLE ENTRY POINT for producing customer-facing moves.
 * CX3's /audit page calls assembleMoves() and renders the result.
 * No other code path should produce moves.
 *
 * Each Move carries:
 *   - A headline and why (from the gap)
 *   - Population evidence (from global patterns, may be null)
 *   - Guided payload (paste-ready content)
 *   - Priority score + components (for ranking)
 *   - Target page + scope
 */

import type { BeaconTenant } from "@/domains/tenants/types";
import type { PageSnapshot, PageEntity } from "@/domains/pages/types";
import type { Move, PopulationEvidence } from "@/domains/global-patterns/contracts";
import type { ScoredMove } from "./types";
import { detectGaps } from "./gap-detector";
import { scoreAllGaps, selectTopMoves } from "./priority-scorer";
import { generatePayload, formatAsTicket } from "./payload-generators";
import { queryPattern, type PatternQueryResult } from "@/domains/global-patterns/query";
import type { PatternKey } from "@/domains/global-patterns/contracts";

// ---------------------------------------------------------------------------
// Move headline generation
// ---------------------------------------------------------------------------

function generateHeadline(scored: ScoredMove): string {
  const { gap } = scored;
  const pageLabel = gap.affected_page_count > 1
    ? `${gap.affected_page_count} pages`
    : gap.page_url;

  switch (gap.type) {
    case "missing_faq":
      return `Add FAQ section to ${pageLabel}`;
    case "insufficient_faq":
      return `Expand FAQ to 5-7 questions on ${pageLabel}`;
    case "missing_faq_schema":
      return `Add FAQPage schema to ${pageLabel}`;
    case "missing_comparison_table":
      return `Add builder comparison table to ${pageLabel}`;
    case "missing_schema":
      return `Add JSON-LD schema to ${pageLabel}`;
    case "missing_service_schema":
      return `Add Service schema to ${pageLabel}`;
    case "missing_localbusiness":
      return `Add LocalBusiness schema to ${pageLabel}`;
    case "low_internal_links":
      return `Improve internal linking on ${pageLabel}`;
    case "thin_content":
      return `Expand content on ${pageLabel}`;
    case "missing_h2_structure":
      return `Add section structure to ${pageLabel}`;
    case "duplicate_faq_schema":
      return `Fix duplicate FAQ schema on ${pageLabel}`;
    case "stale_content":
      return `Refresh content on ${pageLabel}`;
    default:
      return `Improve ${pageLabel}`;
  }
}

function generateWhy(scored: ScoredMove, evidence: PopulationEvidence | null): string {
  if (evidence && !evidence.seeded_warning) {
    return evidence.narrative;
  }
  if (evidence && evidence.seeded_warning) {
    return `${evidence.narrative}`;
  }
  // No pattern evidence — use gap-based reasoning
  const { gap } = scored;
  const platformLabel = gap.primary_platform === "chatgpt"
    ? "ChatGPT"
    : gap.primary_platform === "google_aio"
      ? "Google AI"
      : "Perplexity";
  return `${platformLabel} strongly favors pages with ${gap.target_state.toLowerCase()}. Fixing this gap increases your chances of being cited.`;
}

// ---------------------------------------------------------------------------
// Pattern lookup for a gap
// ---------------------------------------------------------------------------

function lookupPatternEvidence(scored: ScoredMove): PopulationEvidence | null {
  const key: PatternKey = {
    segment: "local_residential_builder",
    change_type: scored.gap.fix_change_type,
    platform: scored.gap.primary_platform,
    context_bin: "zero::established",
  };

  const result = queryPattern(key);
  if (!result) return null;

  return result.evidence;
}

// ---------------------------------------------------------------------------
// Main assembly
// ---------------------------------------------------------------------------

export type AssembledMoves = {
  moves: Move[];
  total_gaps_detected: number;
  total_scored: number;
};

/**
 * Assemble the top 3 moves for a tenant.
 *
 * This is the single entry point for producing customer-facing moves.
 * Every step of the pipeline is executed here:
 *   1. Detect structural gaps across all page snapshots
 *   2. Score each gap by citation impact, pattern confidence,
 *      severity, and page importance
 *   3. Select top 3 with diversity constraint (no two share the
 *      same fix_change_type)
 *   4. Generate paste-ready payloads for each selected move
 *   5. Assemble into Move objects ready for CX3's UI
 */
export function assembleMoves(opts: {
  tenant: BeaconTenant;
  snapshots: PageSnapshot[];
  pages: PageEntity[];
  citationCounts: Map<string, number>;
  moveCount?: number;
}): AssembledMoves {
  const { tenant, snapshots, pages, citationCounts, moveCount = 3 } = opts;

  // 1. Detect gaps
  const gaps = detectGaps({ snapshots, pages, citationCounts });

  // 2. Score
  const scored = scoreAllGaps(gaps, citationCounts);

  // 3. Select top N with diversity
  const topScored = selectTopMoves(scored, moveCount);

  // 4-5. Generate payloads + assemble Moves
  const moves: Move[] = topScored.map((sm, idx) => {
    const evidence = lookupPatternEvidence(sm);
    const payload = generatePayload({ gap: sm.gap, tenant });
    const ticket = formatAsTicket({
      gap: sm.gap,
      payload,
      populationNarrative: evidence?.narrative ?? null,
      format: "markdown",
    });

    return {
      id: `move-${tenant.id}-${idx + 1}-${sm.gap.type}`,
      headline: generateHeadline(sm),
      why: generateWhy(sm, evidence),
      target: sm.gap.page_url,
      action_class: sm.gap.fix_change_type,
      platform: sm.gap.primary_platform,
      priority: sm.priority,
      population_evidence: evidence,
      guided_payload: {
        ...payload,
        dev_ticket_markdown: ticket,
      },
      tenant_id: tenant.id,
    };
  });

  return {
    moves,
    total_gaps_detected: gaps.length,
    total_scored: scored.length,
  };
}
