import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "./types";
import { normalizeCompetitorDomain } from "./universe-normalize";
import type { CompetitorUniverseRuntime } from "./universe-types";

export type OpportunityCompetitorBasis = {
  headline: string;
  detail: string;
};

/**
 * Honest label for whether linked competitor entities overlap the configured universe.
 */
export function opportunityCompetitorBasis(
  opp: Opportunity,
  entityCompetitors: Competitor[],
  universe: CompetitorUniverseRuntime
): OpportunityCompetitorBasis {
  const linked = entityCompetitors.filter((c) =>
    opp.competitor_ids.includes(c.id)
  );
  if (linked.length === 0) {
    return {
      headline: "No competitor entities linked",
      detail:
        "This opportunity does not reference competitor rows — treat competitive framing as narrative unless you attach entities.",
    };
  }

  const domainHits: string[] = [];
  const domainMiss: string[] = [];
  for (const c of linked) {
    const k = normalizeCompetitorDomain(c.domain);
    if (universe.domainToLabel[k]) domainHits.push(c.name);
    else domainMiss.push(c.name);
  }

  if (universe.origin === "empty_import_mode" && !Object.keys(universe.domainToLabel).length) {
    return {
      headline: "Sample / entity linkage only",
      detail: `Linked competitors: ${linked.map((c) => c.name).join(", ")}. No workspace competitor universe is configured — these are imported or seed entity rows, not a declared tracked set.`,
    };
  }

  if (domainHits.length > 0 && domainMiss.length === 0) {
    return {
      headline: "Grounded in configured competitor universe",
      detail: `Linked competitors (${domainHits.join(", ")}) match active configured hostnames.`,
    };
  }
  if (domainHits.length > 0 && domainMiss.length > 0) {
    return {
      headline: "Mixed: configured + other entities",
      detail: `Matches universe: ${domainHits.join(", ")}. Not in configured universe file: ${domainMiss.join(", ")} — keep sample/entity scope explicit.`,
    };
  }
  return {
    headline: "Linked entities not in configured universe",
    detail: `${linked.map((c) => c.name).join(", ")} — add their hostnames to competitor-universe.json if you intend to track them as first-class competitors.`,
  };
}
