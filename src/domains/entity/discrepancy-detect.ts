/**
 * AI Says vs Reality — conservative discrepancy detection.
 *
 * Compares what AI answers claim against what Beacon knows from owned data.
 * Only surfaces HIGH-CONFIDENCE structural mismatches:
 *
 * 1. Location not in owned data — AI mentions a location we don't serve
 * 2. Service not in owned data — AI mentions a service not present in snapshots
 * 3. Brand omitted — owned brand missing from answers where it should appear
 * 4. Competitor overrepresented — competitor appears far more than owned brand
 *
 * Language is deliberately conservative:
 * - "possible discrepancy"
 * - "may be missing"
 * - never "wrong" or "hallucinated"
 *
 * If data is insufficient, produces zero discrepancies rather than guessing.
 */

import "server-only";

import { getAnswerText } from "@/lib/persistence/cold-store";
import { readStore } from "@/lib/persistence/json-store";
import type { EntityIndex } from "./types";
import type {
  Discrepancy,
  DiscrepancyReport,
  DiscrepancyType,
} from "./discrepancy-types";

const MIN_ANSWERS_FOR_ANALYSIS = 20;
const MIN_LOCATION_MENTIONS = 3;
const MIN_SERVICE_MENTIONS = 3;
const OMISSION_THRESHOLD = 0.15;
const OVERREP_RATIO = 3;

function canonicalize(text: string): string {
  return text.trim().toLowerCase().replace(/['']/g, "'").replace(/\s+/g, " ");
}

/**
 * Detect discrepancies between AI answer content and owned entity data.
 */
export function detectDiscrepancies(
  entityIndex: EntityIndex,
): DiscrepancyReport {
  const now = new Date().toISOString();
  const discrepancies: Discrepancy[] = [];

  const paoStore = readStore<{
    id: string;
    mentions: string[];
    tracked_brand_mentioned: boolean | null;
    tracked_brand_cited: boolean | null;
    topic: string;
    platform: string;
  }>("prompt-answer-observations");

  if (paoStore.length < MIN_ANSWERS_FOR_ANALYSIS) {
    return {
      computed_at: now,
      total_answers_checked: paoStore.length,
      discrepancies: [],
      data_note: `Only ${paoStore.length} answers available — minimum ${MIN_ANSWERS_FOR_ANALYSIS} needed for discrepancy analysis.`,
    };
  }

  const ownedLocationsLower = new Set(entityIndex.owned_locations.map(canonicalize));
  const ownedServicesLower = new Set(entityIndex.owned_services.map(canonicalize));
  const ownedBrandLower = entityIndex.owned_brand
    ? canonicalize(entityIndex.owned_brand)
    : null;

  // Scan answer texts for location/service mentions not in owned data
  const locationMentionCounts = new Map<string, number>();
  const serviceMentionCounts = new Map<string, number>();
  let brandMentionedCount = 0;
  let brandNotMentionedCount = 0;
  const competitorMentionCounts = new Map<string, number>();
  let answersChecked = 0;

  // Well-known location and service terms for matching
  const knownLocationPatterns = buildLocationPatterns(ownedLocationsLower);
  const knownServicePatterns = buildServicePatterns(ownedServicesLower);

  for (const pao of paoStore) {
    const answerText = getAnswerText(pao.id);
    if (!answerText) continue;
    answersChecked++;

    const textLower = answerText.toLowerCase();

    // Track brand mention/omission
    if (pao.tracked_brand_mentioned) {
      brandMentionedCount++;
    } else {
      brandNotMentionedCount++;
    }

    // Track competitor mentions
    for (const mention of pao.mentions ?? []) {
      const mentionLower = canonicalize(mention);
      if (ownedBrandLower && (mentionLower === ownedBrandLower || mentionLower.includes(ownedBrandLower))) continue;
      competitorMentionCounts.set(mentionLower, (competitorMentionCounts.get(mentionLower) ?? 0) + 1);
    }

    // Scan for location terms in answer text not present in owned data
    for (const [loc, pattern] of knownLocationPatterns) {
      if (pattern.test(textLower) && !ownedLocationsLower.has(loc)) {
        locationMentionCounts.set(loc, (locationMentionCounts.get(loc) ?? 0) + 1);
      }
    }

    // Scan for service terms in answer text not present in owned data
    for (const [svc, pattern] of knownServicePatterns) {
      if (pattern.test(textLower) && !ownedServicesLower.has(svc)) {
        serviceMentionCounts.set(svc, (serviceMentionCounts.get(svc) ?? 0) + 1);
      }
    }
  }

  // Discrepancy 1: Locations mentioned in AI but not in owned pages
  for (const [loc, count] of locationMentionCounts) {
    if (count < MIN_LOCATION_MENTIONS) continue;
    discrepancies.push({
      id: `disc-loc-${loc.replace(/\s+/g, "-")}`,
      type: "location_not_in_owned",
      severity: count >= 10 ? "notable" : "minor",
      summary: `AI mentions "${loc}" but this location is not present in your page data`,
      detail: `Found in ${count} AI answer${count !== 1 ? "s" : ""}. Your owned pages do not list this location. If you serve this area, consider adding it to your site. If you don't, AI may be associating you with it incorrectly.`,
      evidence_count: count,
      confidence: count >= 8 ? "moderate" : "limited",
    });
  }

  // Discrepancy 2: Services mentioned in AI but not in owned pages
  for (const [svc, count] of serviceMentionCounts) {
    if (count < MIN_SERVICE_MENTIONS) continue;
    discrepancies.push({
      id: `disc-svc-${svc.replace(/\s+/g, "-")}`,
      type: "service_not_in_owned",
      severity: count >= 10 ? "notable" : "minor",
      summary: `AI mentions "${svc}" but this service is not present in your page data`,
      detail: `Found in ${count} AI answer${count !== 1 ? "s" : ""}. Your owned pages do not reference this service. If you offer it, consider adding structured content. If not, AI may be misattributing this capability.`,
      evidence_count: count,
      confidence: count >= 8 ? "moderate" : "limited",
    });
  }

  // Discrepancy 3: Brand omission — owned brand absent from significant share
  if (answersChecked >= MIN_ANSWERS_FOR_ANALYSIS && ownedBrandLower) {
    const omissionRate = brandNotMentionedCount / answersChecked;
    if (omissionRate >= OMISSION_THRESHOLD && brandNotMentionedCount >= 5) {
      discrepancies.push({
        id: "disc-brand-omitted",
        type: "brand_omitted",
        severity: omissionRate >= 0.5 ? "notable" : "minor",
        summary: `Your brand may be missing from ${Math.round(omissionRate * 100)}% of relevant AI answers`,
        detail: `Out of ${answersChecked} AI answers checked, ${brandNotMentionedCount} did not mention your brand. This may indicate gaps in brand visibility or content authority for the tracked topics.`,
        evidence_count: brandNotMentionedCount,
        confidence: answersChecked >= 100 ? "moderate" : "limited",
      });
    }
  }

  // Discrepancy 4: Competitor overrepresented
  if (ownedBrandLower && brandMentionedCount > 0) {
    for (const [comp, count] of competitorMentionCounts) {
      if (count < brandMentionedCount * OVERREP_RATIO) continue;
      if (count < 15) continue;

      const displayName = comp.replace(/\b\w/g, (c) => c.toUpperCase());
      discrepancies.push({
        id: `disc-overrep-${comp.replace(/\s+/g, "-").slice(0, 30)}`,
        type: "competitor_overrepresented",
        severity: "notable",
        summary: `"${displayName}" appears ${Math.round(count / brandMentionedCount)}× more than your brand in AI answers`,
        detail: `${displayName} mentioned ${count} times vs your brand ${brandMentionedCount} times across ${answersChecked} answers. This competitor may have stronger content authority or broader topic coverage in AI training data.`,
        evidence_count: count,
        confidence: "moderate",
      });
    }
  }

  discrepancies.sort((a, b) => {
    const sevOrder = { notable: 0, minor: 1 };
    return (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2) || b.evidence_count - a.evidence_count;
  });

  return {
    computed_at: now,
    total_answers_checked: answersChecked,
    discrepancies,
    data_note: answersChecked >= 100
      ? `Based on ${answersChecked} AI answers from imported data.`
      : `Based on ${answersChecked} AI answers — a larger dataset would improve confidence.`,
  };
}

function buildLocationPatterns(ownedLocations: Set<string>): Map<string, RegExp> {
  // Common Bay Area / California location terms to check against
  const candidates = [
    "san francisco", "oakland", "berkeley", "fremont", "redwood city",
    "santa clara", "milpitas", "campbell", "saratoga", "los gatos",
    "woodside", "portola valley", "half moon bay", "san mateo", "burlingame",
    "foster city", "belmont", "san carlos", "hillsborough", "daly city",
    "pacifica", "walnut creek", "pleasanton", "livermore", "dublin",
    "danville", "san ramon", "concord", "hayward", "union city",
    "newark", "santa cruz", "gilroy", "morgan hill", "scotts valley",
    "capitola", "watsonville", "aptos", "cupertino", "menlo park",
    "palo alto", "mountain view", "sunnyvale", "los altos", "atherton",
    "san jose", "bay area", "silicon valley",
  ];

  const patterns = new Map<string, RegExp>();
  for (const loc of candidates) {
    if (ownedLocations.has(loc)) continue;
    try {
      patterns.set(loc, new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
    } catch {
      // skip invalid patterns
    }
  }
  return patterns;
}

function buildServicePatterns(ownedServices: Set<string>): Map<string, RegExp> {
  const candidates = [
    "kitchen remodel", "bathroom remodel", "room addition", "garage conversion",
    "landscaping", "pool construction", "roofing", "foundation repair",
    "electrical work", "plumbing", "hvac", "solar installation",
    "deck building", "fence installation", "painting", "flooring",
    "window replacement", "siding", "insulation", "demolition",
    "commercial construction", "tenant improvement", "grading",
    "retaining wall", "seismic retrofit", "smart home",
  ];

  const patterns = new Map<string, RegExp>();
  for (const svc of candidates) {
    if (ownedServices.has(svc)) continue;
    try {
      patterns.set(svc, new RegExp(`\\b${svc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
    } catch {
      // skip
    }
  }
  return patterns;
}
