/**
 * Build the Answer Intelligence Index from observation data + answer texts.
 *
 * Extracts:
 * 1. Brand positioning (how AI describes the brand per topic)
 * 2. Visibility cells (mention/citation rates per topic×platform×date)
 * 3. Co-citation analysis (who appears with/without the brand)
 * 4. Narrative shifts (when AI answers change regarding the brand)
 *
 * Runs at import time. All inputs are already in memory at that point.
 */

import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { CitationObservation } from "@/domains/citation-observations/types";
import type {
  AnswerIntelligenceIndex,
  BrandPositioningByTopic,
  BrandDescriptor,
  CompetitorCoAppearance,
  VisibilityCell,
  CoCitationAnalysis,
  CoCitationCompetitor,
  CoCitationTopicBreakdown,
  NarrativeShift,
  NarrativeShiftType,
  TopicPlatformSummary,
} from "./types";

// ── Public API ──────────────────────────────────────────────────────

export function buildAnswerIntelligenceIndex(opts: {
  observations: PromptAnswerObservation[];
  answerTexts: Record<string, string>;
  brandName: string;
  ownedDomain: string;
}): AnswerIntelligenceIndex {
  const { observations, answerTexts, brandName, ownedDomain } = opts;

  const brandTokens = extractBrandTokens(brandName);
  const ownedDomainNorm = ownedDomain.toLowerCase().replace(/^www\./, "");

  let withText = 0;
  for (const o of observations) {
    if (answerTexts[o.id]) withText++;
  }

  const brandPositioning = buildBrandPositioning(
    observations,
    answerTexts,
    brandTokens,
    ownedDomainNorm,
  );

  const visibilityCells = buildVisibilityCells(observations, ownedDomainNorm);

  const coCitation = buildCoCitationAnalysis(observations, ownedDomainNorm);

  const narrativeShifts = buildNarrativeShifts(observations, brandTokens);

  const topicPlatformSummary = buildTopicPlatformSummary(
    visibilityCells,
    narrativeShifts,
  );

  return {
    built_at: new Date().toISOString(),
    brand_name: brandName,
    owned_domain: ownedDomain,
    total_observations: observations.length,
    total_with_answer_text: withText,
    brand_positioning: brandPositioning,
    visibility_cells: visibilityCells,
    co_citation: coCitation,
    narrative_shifts: narrativeShifts,
    topic_platform_summary: topicPlatformSummary,
  };
}

// ── Non-competitor domain filter ────────────────────────────────────
// Directories, platforms, and media sites that AI answers reference
// but are NOT actual business competitors. Suppressed from co-citation
// and co-appearing competitor lists.

const NON_COMPETITOR_DOMAINS = new Set([
  "reddit.com",
  "houzz.com",
  "yelp.com",
  "angi.com",
  "homeadvisor.com",
  "thumbtack.com",
  "buildzoom.com",
  "porch.com",
  "bark.com",
  "architecturaldigest.com",
  "diamondcertified.org",
  "generalcontractors.org",
  "homebuilderdigest.com",
  "sanfranciscoarchitects.org",
  "bbb.org",
  "google.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "youtube.com",
  "wikipedia.org",
  "forbes.com",
  "bloomberg.com",
  "nytimes.com",
  "wsj.com",
  "zillow.com",
  "realtor.com",
  "redfin.com",
  "nextdoor.com",
  "pinterest.com",
  "tiktok.com",
]);

function isNonCompetitorDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  if (NON_COMPETITOR_DOMAINS.has(d)) return true;
  // Generic directory patterns
  if (/^(?:best|top|find|local|my|the)[\w-]*\.(?:com|org|net)$/.test(d)) return true;
  return false;
}

// ── Brand token extraction ──────────────────────────────────────────

function extractBrandTokens(brandName: string): string[] {
  // "Ritz Builders" → ["ritz", "ritz builders"]
  const full = brandName.toLowerCase().trim();
  const words = full.split(/\s+/);
  const tokens = [full];
  // Add first word if multi-word brand (for "Ritz" matching "Ritz Builders")
  if (words.length > 1 && words[0].length >= 3) {
    tokens.push(words[0]);
  }
  return tokens;
}

// ── Section 1: Brand Positioning ────────────────────────────────────

function buildBrandPositioning(
  observations: PromptAnswerObservation[],
  answerTexts: Record<string, string>,
  brandTokens: string[],
  ownedDomain: string,
): BrandPositioningByTopic[] {
  // Group observations by topic
  const byTopic = new Map<
    string,
    {
      total: number;
      mentioned: number;
      cited: number;
      positions: number[];
      listSizes: number[];
      descriptorCounts: Map<string, { count: number; platforms: Set<string>; exampleId: string }>;
      competitorDomainCounts: Map<string, number>;
    }
  >();

  for (const o of observations) {
    const topic = o.topic;
    let acc = byTopic.get(topic);
    if (!acc) {
      acc = {
        total: 0,
        mentioned: 0,
        cited: 0,
        positions: [],
        listSizes: [],
        descriptorCounts: new Map(),
        competitorDomainCounts: new Map(),
      };
      byTopic.set(topic, acc);
    }

    acc.total++;
    if (o.tracked_brand_mentioned) acc.mentioned++;
    if (o.tracked_brand_cited) acc.cited++;

    if (o.tracked_brand_mentioned) {
      if (o.position != null) acc.positions.push(o.position);
      acc.listSizes.push(o.citation_count);

      // Extract descriptors from answer text
      const text = answerTexts[o.id];
      if (text) {
        const descriptors = extractBrandDescriptors(text, brandTokens);
        for (const d of descriptors) {
          const existing = acc.descriptorCounts.get(d);
          if (existing) {
            existing.count++;
            existing.platforms.add(o.platform);
          } else {
            acc.descriptorCounts.set(d, {
              count: 1,
              platforms: new Set([o.platform]),
              exampleId: o.id,
            });
          }
        }
      }

      // Track competitor co-appearance (domains other than owned; skip directories/platforms)
      for (const domain of o.citation_domains ?? []) {
        const d = domain.toLowerCase().replace(/^www\./, "");
        if (d === ownedDomain) continue;
        if (isNonCompetitorDomain(d)) continue;
        acc.competitorDomainCounts.set(
          d,
          (acc.competitorDomainCounts.get(d) ?? 0) + 1,
        );
      }
    }
  }

  const result: BrandPositioningByTopic[] = [];

  for (const [topic, acc] of byTopic) {
    // Top descriptors by count — only surface those seen in ≥ 2 distinct answers
    const sortedDescriptors = [...acc.descriptorCounts.entries()]
      .filter(([, data]) => data.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    const brandDescriptors: BrandDescriptor[] = sortedDescriptors.map(
      ([fragment, data]) => ({
        fragment,
        source_count: data.count,
        platforms: [...data.platforms],
        example_observation_id: data.exampleId,
      }),
    );

    // Top co-appearing competitors
    const sortedCompetitors = [...acc.competitorDomainCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const topCoAppearing: CompetitorCoAppearance[] = sortedCompetitors.map(
      ([domain, count]) => ({
        domain,
        co_appearance_count: count,
        total_appearances: count, // will be enriched in co-citation analysis
      }),
    );

    const avgPos =
      acc.positions.length > 0
        ? Math.round(
            (acc.positions.reduce((a, b) => a + b, 0) / acc.positions.length) *
              10,
          ) / 10
        : null;

    const avgListSize =
      acc.listSizes.length > 0
        ? Math.round(
            acc.listSizes.reduce((a, b) => a + b, 0) / acc.listSizes.length,
          )
        : null;

    result.push({
      topic,
      mention_count: acc.mentioned,
      total_observations: acc.total,
      mention_rate:
        acc.total > 0
          ? Math.round((acc.mentioned / acc.total) * 1000) / 1000
          : 0,
      citation_rate:
        acc.total > 0
          ? Math.round((acc.cited / acc.total) * 1000) / 1000
          : 0,
      brand_descriptors: brandDescriptors,
      top_co_appearing_competitors: topCoAppearing,
      avg_position_when_mentioned: avgPos,
      typical_list_size: avgListSize,
    });
  }

  return result.sort((a, b) => b.total_observations - a.total_observations);
}

// ── Brand descriptor extraction ─────────────────────────────────────

const STRIP_MARKDOWN_LINK = /\[([^\]]+)\]\([^)]+\)/g;
const STRIP_BOLD = /\*\*/g;
const STRIP_HEADING = /^#{1,4}\s+/gm;

function cleanAnswerText(raw: string): string {
  return raw
    .replace(STRIP_MARKDOWN_LINK, "$1")
    .replace(STRIP_BOLD, "")
    .replace(STRIP_HEADING, "")
    .replace(/==/g, "");
}

function extractBrandDescriptors(
  rawText: string,
  brandTokens: string[],
): string[] {
  const text = cleanAnswerText(rawText);
  const descriptors: string[] = [];

  // Split into segments (sentences, list items, line breaks)
  const segments = text.split(/(?:\.\s+|\n+|(?:^|\n)\s*[-–—•]\s*)/);

  for (const segment of segments) {
    const lower = segment.toLowerCase();
    const matchToken = brandTokens.find((t) => lower.includes(t));
    if (!matchToken) continue;

    const idx = lower.indexOf(matchToken);
    const afterBrand = segment.slice(idx + matchToken.length).trim();

    // Pattern: "Brand: description" or "Brand — description" or "Brand is/are..."
    const descriptorMatch = afterBrand.match(
      /^(?:\s*(?:[:,\-–—]|is\s|are\s|was\s|has\s)\s*)(.+)/i,
    );

    if (!descriptorMatch) continue;
    let descriptor = descriptorMatch[1].trim().replace(/\s+/g, " ");

    // ── Quality gates (strict) ──

    // Skip competitor name fragments: starts with proper noun pattern
    if (/^[A-Z][a-z]+\s+[A-Z]/.test(descriptorMatch[1].trim())) continue;
    // Skip comma-separated lists (competitor name lists leak through)
    if ((descriptor.match(/,/g) ?? []).length >= 2 && descriptor.length < 120) continue;
    // Skip fragments that start with "and " — always a tail of a list
    if (/^and\s/i.test(descriptor)) continue;
    // Skip fragments ending with ".." — truncated extraction
    if (/\.\.$/.test(descriptor)) continue;
    // Skip fragments that are mostly proper nouns (competitor names)
    const words = descriptor.split(/\s+/);
    const capitalWords = words.filter((w) => /^[A-Z][a-z]/.test(w) && w.length > 2);
    if (capitalWords.length > words.length * 0.4 && words.length >= 3) continue;
    // Skip if contains parenthetical company references like "(e.g., Company Name)"
    if (/\b(?:inc\.|llc|corp\.|builders|construction)\b/i.test(descriptor) &&
        !/\b(?:design-build|architect|specializ|focus|known|custom|luxury)\b/i.test(descriptor)) continue;

    // Clean trailing noise
    descriptor = descriptor
      .replace(/[,;]?\s*(?:and|or|with|including|such as|alongside)\s*$/i, "")
      .replace(/[,;]\s*$/, "")
      .replace(/\s*\(.*?\)\s*$/, ""); // strip trailing parentheticals

    if (descriptor.length > 150) {
      descriptor = descriptor.slice(0, 150).replace(/\s+\S*$/, "");
    }

    if (descriptor.length >= 25 && descriptor.length <= 150) {
      descriptors.push(normalizeDescriptor(descriptor));
    }
  }

  return [...new Set(descriptors)];
}

function normalizeDescriptor(d: string): string {
  return d
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^(?:a|an|the)\s+/i, "")
    .trim();
}

// ── Section 2: Visibility Cells ─────────────────────────────────────

function buildVisibilityCells(
  observations: PromptAnswerObservation[],
  ownedDomain: string,
): VisibilityCell[] {
  type CellAcc = {
    total: number;
    mentioned: number;
    cited: number;
    positions: number[];
    ownedCitCounts: number[];
    competitorDomains: Map<string, number>;
  };

  const cells = new Map<string, CellAcc>();

  for (const o of observations) {
    const date = o.observed_at.slice(0, 10);
    const key = `${o.topic}|${o.platform}|${date}`;
    let acc = cells.get(key);
    if (!acc) {
      acc = {
        total: 0,
        mentioned: 0,
        cited: 0,
        positions: [],
        ownedCitCounts: [],
        competitorDomains: new Map(),
      };
      cells.set(key, acc);
    }

    acc.total++;
    if (o.tracked_brand_mentioned) acc.mentioned++;
    if (o.tracked_brand_cited) acc.cited++;
    if (o.position != null) acc.positions.push(o.position);
    acc.ownedCitCounts.push(o.owned_citation_count);

    for (const domain of o.citation_domains ?? []) {
      const d = domain.toLowerCase().replace(/^www\./, "");
      if (d === ownedDomain) continue;
      acc.competitorDomains.set(d, (acc.competitorDomains.get(d) ?? 0) + 1);
    }
  }

  const result: VisibilityCell[] = [];

  for (const [key, acc] of cells) {
    const [topic, platform, date] = key.split("|");

    const topCompetitors = [...acc.competitorDomains.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([domain, frequency]) => ({ domain, frequency }));

    const avgPos =
      acc.positions.length > 0
        ? Math.round(
            (acc.positions.reduce((a, b) => a + b, 0) / acc.positions.length) *
              10,
          ) / 10
        : null;

    const avgOwnedCit =
      acc.ownedCitCounts.length > 0
        ? Math.round(
            (acc.ownedCitCounts.reduce((a, b) => a + b, 0) /
              acc.ownedCitCounts.length) *
              10,
          ) / 10
        : 0;

    result.push({
      topic,
      platform,
      date,
      observation_count: acc.total,
      mention_count: acc.mentioned,
      citation_count: acc.cited,
      mention_rate:
        acc.total > 0
          ? Math.round((acc.mentioned / acc.total) * 1000) / 1000
          : 0,
      citation_rate:
        acc.total > 0
          ? Math.round((acc.cited / acc.total) * 1000) / 1000
          : 0,
      avg_position: avgPos,
      avg_owned_citation_count: avgOwnedCit,
      top_competitor_domains: topCompetitors,
    });
  }

  return result.sort((a, b) =>
    a.topic.localeCompare(b.topic) ||
    a.platform.localeCompare(b.platform) ||
    a.date.localeCompare(b.date),
  );
}

// ── Section 3: Co-Citation Analysis ─────────────────────────────────

function buildCoCitationAnalysis(
  observations: PromptAnswerObservation[],
  ownedDomain: string,
): CoCitationAnalysis {
  let withOwned = 0;
  let withoutOwned = 0;

  // Global competitor tracking
  const whenPresent = new Map<string, number>();
  const whenAbsent = new Map<string, number>();
  const totalAppearances = new Map<string, number>();

  // Per-topic tracking
  const topicAcc = new Map<
    string,
    {
      withOwned: number;
      withoutOwned: number;
      present: Map<string, number>;
      absent: Map<string, number>;
    }
  >();

  for (const o of observations) {
    const domains = (o.citation_domains ?? []).map((d) =>
      d.toLowerCase().replace(/^www\./, ""),
    );
    const hasOwned = domains.includes(ownedDomain);

    if (hasOwned) {
      withOwned++;
    } else {
      withoutOwned++;
    }

    // Topic accumulator
    let tAcc = topicAcc.get(o.topic);
    if (!tAcc) {
      tAcc = {
        withOwned: 0,
        withoutOwned: 0,
        present: new Map(),
        absent: new Map(),
      };
      topicAcc.set(o.topic, tAcc);
    }
    if (hasOwned) tAcc.withOwned++;
    else tAcc.withoutOwned++;

    for (const d of domains) {
      if (d === ownedDomain) continue;
      if (isNonCompetitorDomain(d)) continue;

      totalAppearances.set(d, (totalAppearances.get(d) ?? 0) + 1);

      if (hasOwned) {
        whenPresent.set(d, (whenPresent.get(d) ?? 0) + 1);
        tAcc.present.set(d, (tAcc.present.get(d) ?? 0) + 1);
      } else {
        whenAbsent.set(d, (whenAbsent.get(d) ?? 0) + 1);
        tAcc.absent.set(d, (tAcc.absent.get(d) ?? 0) + 1);
      }
    }
  }

  // Build competitor list sorted by total appearances
  const competitors: CoCitationCompetitor[] = [...totalAppearances.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([domain, total]) => {
      const present = whenPresent.get(domain) ?? 0;
      const absent = whenAbsent.get(domain) ?? 0;
      return {
        domain,
        when_owned_present: present,
        when_owned_absent: absent,
        total_answer_appearances: total,
        displacement_ratio: total > 0 ? Math.round((absent / total) * 1000) / 1000 : 0,
      };
    });

  // Build per-topic breakdown
  const byTopic: CoCitationTopicBreakdown[] = [...topicAcc.entries()]
    .map(([topic, acc]) => ({
      topic,
      answers_with_owned: acc.withOwned,
      answers_without_owned: acc.withoutOwned,
      top_when_present: topN(acc.present, 5),
      top_when_absent: topN(acc.absent, 5),
    }))
    .sort((a, b) => b.answers_with_owned + b.answers_without_owned - (a.answers_with_owned + a.answers_without_owned));

  return {
    owned_domain: ownedDomain,
    total_answers_with_owned: withOwned,
    total_answers_without_owned: withoutOwned,
    competitors,
    by_topic: byTopic,
  };
}

function topN(
  map: Map<string, number>,
  n: number,
): { domain: string; count: number }[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([domain, count]) => ({ domain, count }));
}

// ── Section 4: Narrative Shifts ─────────────────────────────────────

function buildNarrativeShifts(
  observations: PromptAnswerObservation[],
  brandTokens: string[],
): NarrativeShift[] {
  // Group by prompt_id + platform, sort by date
  const byPromptPlatform = new Map<string, PromptAnswerObservation[]>();

  for (const o of observations) {
    const key = `${o.prompt_id}|${o.platform}`;
    let arr = byPromptPlatform.get(key);
    if (!arr) {
      arr = [];
      byPromptPlatform.set(key, arr);
    }
    arr.push(o);
  }

  const shifts: NarrativeShift[] = [];

  for (const [, group] of byPromptPlatform) {
    // Sort by date ascending
    group.sort((a, b) => a.observed_at.localeCompare(b.observed_at));

    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1];
      const curr = group[i];

      // Skip if same answer (no change)
      if (prev.answer_hash === curr.answer_hash) continue;

      let shiftType: NarrativeShiftType | null = null;
      let detail = "";

      // Brand gained/lost
      if (!prev.tracked_brand_mentioned && curr.tracked_brand_mentioned) {
        shiftType = "brand_gained";
        detail = `Brand appeared in ${curr.platform} answer for "${curr.topic}"`;
      } else if (prev.tracked_brand_mentioned && !curr.tracked_brand_mentioned) {
        shiftType = "brand_lost";
        detail = `Brand dropped from ${curr.platform} answer for "${curr.topic}"`;
      }
      // Position changes (only when mentioned in both)
      else if (
        prev.tracked_brand_mentioned &&
        curr.tracked_brand_mentioned &&
        prev.position != null &&
        curr.position != null
      ) {
        const delta = curr.position - prev.position;
        if (delta <= -2) {
          shiftType = "position_improved";
          detail = `Brand moved from position ${prev.position} to ${curr.position} on ${curr.platform} for "${curr.topic}"`;
        } else if (delta >= 2) {
          shiftType = "position_declined";
          detail = `Brand dropped from position ${prev.position} to ${curr.position} on ${curr.platform} for "${curr.topic}"`;
        }
      }

      if (shiftType) {
        shifts.push({
          prompt_id: curr.prompt_id,
          topic: curr.topic,
          platform: curr.platform,
          shift_type: shiftType,
          from_date: prev.observed_at.slice(0, 10),
          to_date: curr.observed_at.slice(0, 10),
          from_mentioned: prev.tracked_brand_mentioned ?? false,
          to_mentioned: curr.tracked_brand_mentioned ?? false,
          from_position: prev.position,
          to_position: curr.position,
          from_observation_id: prev.id,
          to_observation_id: curr.id,
          detail,
        });
      }
    }
  }

  // Sort by date descending (most recent first)
  return shifts.sort((a, b) => b.to_date.localeCompare(a.to_date));
}

// ── Section 5: Topic-Platform Summary ───────────────────────────────

function buildTopicPlatformSummary(
  cells: VisibilityCell[],
  shifts: NarrativeShift[],
): Record<string, Record<string, TopicPlatformSummary>> {
  // Group cells by topic+platform
  const grouped = new Map<string, VisibilityCell[]>();
  for (const c of cells) {
    const key = `${c.topic}|${c.platform}`;
    let arr = grouped.get(key);
    if (!arr) {
      arr = [];
      grouped.set(key, arr);
    }
    arr.push(c);
  }

  // Count shifts by topic+platform
  const shiftCounts = new Map<string, number>();
  for (const s of shifts) {
    const key = `${s.topic}|${s.platform}`;
    shiftCounts.set(key, (shiftCounts.get(key) ?? 0) + 1);
  }

  const result: Record<string, Record<string, TopicPlatformSummary>> = {};

  for (const [key, group] of grouped) {
    const [topic, platform] = key.split("|");

    // Sort by date ascending
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));

    const latest = sorted[sorted.length - 1];

    // Compute 7d / prior-7d averages
    const dates = sorted.map((c) => c.date);
    const uniqueDates = [...new Set(dates)].sort();
    const last7Dates = uniqueDates.slice(-7);
    const prior7Dates = uniqueDates.slice(-14, -7);

    const avgRate = (ds: string[]): number => {
      const matching = sorted.filter((c) => ds.includes(c.date));
      if (matching.length === 0) return 0;
      return (
        Math.round(
          (matching.reduce((s, c) => s + c.mention_rate, 0) /
            matching.length) *
            1000,
        ) / 1000
      );
    };

    const rate7d = avgRate(last7Dates);
    const ratePrior7d = avgRate(prior7Dates);

    let trend: "up" | "down" | "stable" = "stable";
    const diff = rate7d - ratePrior7d;
    if (diff > 0.05) trend = "up";
    else if (diff < -0.05) trend = "down";

    if (!result[topic]) result[topic] = {};
    result[topic][platform] = {
      latest_mention_rate: latest.mention_rate,
      latest_citation_rate: latest.citation_rate,
      trend_direction: trend,
      mention_rate_7d: rate7d,
      mention_rate_prior_7d: ratePrior7d,
      total_narrative_shifts: shiftCounts.get(key) ?? 0,
    };
  }

  return result;
}
