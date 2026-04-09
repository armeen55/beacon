/**
 * Recommendation Engine — synthesizes proven impact into specific next moves.
 *
 * Connects attribution-backed change impact to structural page gaps,
 * producing ranked, evidence-grounded recommendations for the operator.
 */

import type { ScorecardRowWithImpact } from "@/domains/attribution/change-impact";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { MinedPattern, PlaybookBrief } from "@/domains/pages/playbook";

export type RecommendationType = "replicate" | "strengthen" | "investigate";

export type BeaconRecommendation = {
  id: string;
  type: RecommendationType;
  headline: string;
  rationale: string;
  sourceEvidence: string;
  targetPageUrl: string | null;
  targetPagePath: string | null;
  sourceChangeId: string | null;
  confidence: "high" | "medium" | "low";
  priority: number;
};

// ---------------------------------------------------------------------------
// Pattern matching: link a proven change to a structural pattern
// ---------------------------------------------------------------------------

function matchChangeToPattern(
  change: ChangelogEntry,
  patterns: MinedPattern[],
): MinedPattern | null {
  const changeUrl = change.url?.replace(/\/+$/, "").toLowerCase();

  if (changeUrl) {
    for (const pattern of patterns) {
      if (
        pattern.sourcePages.some(
          (sp) => sp.url.replace(/\/+$/, "").toLowerCase() === changeUrl,
        )
      ) {
        return pattern;
      }
    }

    if (changeUrl.includes("/locations/")) {
      return patterns.find((p) => p.type === "city_page_module") ?? null;
    }
    if (changeUrl.includes("/services/")) {
      return patterns.find((p) => p.type === "service_page_module") ?? null;
    }
  }

  const desc = (change.change_description ?? "").toLowerCase();
  if (
    desc.includes("faq") ||
    desc.includes("schema") ||
    desc.includes("json-ld")
  ) {
    return patterns.find((p) => p.type === "faq_schema_package") ?? null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Core engine
// ---------------------------------------------------------------------------

export function computeRecommendations(opts: {
  impactRows: ScorecardRowWithImpact[];
  patterns: MinedPattern[];
  briefs: PlaybookBrief[];
}): BeaconRecommendation[] {
  const recs: BeaconRecommendation[] = [];

  const provenPositive = opts.impactRows.filter(
    (r) =>
      (r.verdict === "validated" || r.verdict === "partial") &&
      r.impact.direction === "positive" &&
      r.totalEventsLinked > 0,
  );

  const pagesWithProvenChange = new Set(
    provenPositive
      .filter((r) => r.change.url)
      .map((r) => r.change.url!.replace(/\/+$/, "").toLowerCase()),
  );

  // ── Replicate: proven changes × structural gaps ──

  const provenByPattern = new Map<string, ScorecardRowWithImpact[]>();

  for (const row of provenPositive) {
    const matched = matchChangeToPattern(row.change, opts.patterns);
    if (!matched) continue;
    const existing = provenByPattern.get(matched.id) ?? [];
    existing.push(row);
    provenByPattern.set(matched.id, existing);
  }

  const provenPatternIds = new Set(provenByPattern.keys());

  for (const brief of opts.briefs) {
    if (!provenPatternIds.has(brief.patternId)) continue;

    const briefUrl = brief.pageUrl.replace(/\/+$/, "").toLowerCase();
    if (pagesWithProvenChange.has(briefUrl)) continue;

    const provenChanges = provenByPattern.get(brief.patternId) ?? [];
    const bestProven = [...provenChanges].sort(
      (a, b) => (b.topScore ?? 0) - (a.topScore ?? 0),
    )[0];
    if (!bestProven) continue;

    const confidence: BeaconRecommendation["confidence"] =
      bestProven.verdict === "validated"
        ? "high"
        : bestProven.impact.confidence === "high"
          ? "high"
          : bestProven.impact.confidence === "medium"
            ? "medium"
            : "low";

    const platforms = bestProven.platforms
      .map((p) => PLATFORM_LABELS[p] ?? p)
      .join(", ");
    const topics = bestProven.topics.slice(0, 2).join(", ");

    recs.push({
      id: `rec-replicate-${brief.id}`,
      type: "replicate",
      headline: brief.title,
      rationale: `Proven: "${bestProven.change.asset_name}" (${bestProven.verdict}) drove visibility${topics ? ` for ${topics}` : ""}${platforms ? ` on ${platforms}` : ""}. This page has the same structural gap.`,
      sourceEvidence: `${bestProven.totalEventsLinked} event${bestProven.totalEventsLinked !== 1 ? "s" : ""}, score ${Math.round(bestProven.topScore ?? 0)}, ${bestProven.evidenceTier} evidence`,
      targetPageUrl: brief.pageUrl,
      targetPagePath: brief.pagePath,
      sourceChangeId: bestProven.change.id,
      confidence,
      priority:
        brief.priority + (confidence === "high" ? 500 : confidence === "medium" ? 200 : 0),
    });
  }

  // ── Strengthen: weak evidence with positive signal ──

  const weakPositive = opts.impactRows.filter(
    (r) =>
      r.totalEventsLinked > 0 &&
      r.impact.direction !== "negative" &&
      (r.evidenceTier === "weak" || r.evidenceTier === "inferred"),
  );

  for (const row of weakPositive) {
    const gaps: string[] = [];
    if (!row.change.url) gaps.push("no URL");
    if (
      !row.change.topic_targeted ||
      row.change.topic_targeted.length < 3
    )
      gaps.push("no topic");
    if (!row.change.hypothesis) gaps.push("no hypothesis");
    if (gaps.length === 0) continue;

    const suggestedTopic =
      row.topics[0] &&
      (!row.change.topic_targeted || row.change.topic_targeted.length < 3)
        ? row.topics[0]
        : null;

    const gapStr = gaps.join(", ");

    recs.push({
      id: `rec-strengthen-${row.change.id}`,
      type: "strengthen",
      headline: `Improve changelog: "${row.change.asset_name}"`,
      rationale: `${row.totalEventsLinked} linked event${row.totalEventsLinked !== 1 ? "s" : ""} but ${row.evidenceTier} evidence (${gapStr}). Filling gaps could unlock auto-resolution.${suggestedTopic ? ` Suggested topic: "${suggestedTopic}".` : ""}`,
      sourceEvidence: `${row.evidenceTier} tier, ${gapStr}`,
      targetPageUrl: row.change.url,
      targetPagePath:
        row.change.url?.replace(/^https?:\/\/[^/]+/, "") ?? null,
      sourceChangeId: row.change.id,
      confidence: row.totalEventsLinked >= 2 ? "medium" : "low",
      priority:
        300 + row.totalEventsLinked * 50 + (suggestedTopic ? 100 : 0),
    });
  }

  // ── Investigate: negative impact ──

  const negativeImpact = opts.impactRows.filter(
    (r) => r.impact.direction === "negative" && r.totalEventsLinked > 0,
  );

  for (const row of negativeImpact) {
    recs.push({
      id: `rec-investigate-${row.change.id}`,
      type: "investigate",
      headline: `Investigate: "${row.change.asset_name}"`,
      rationale: `Visibility declined after this change — ${row.totalEventsLinked} negative event${row.totalEventsLinked !== 1 ? "s" : ""}. Check for regression or external factors.`,
      sourceEvidence: `${row.totalEventsLinked} negative event${row.totalEventsLinked !== 1 ? "s" : ""}, ${row.topics.slice(0, 2).join(", ")}`,
      targetPageUrl: row.change.url,
      targetPagePath:
        row.change.url?.replace(/^https?:\/\/[^/]+/, "") ?? null,
      sourceChangeId: row.change.id,
      confidence: row.impact.confidence,
      priority: 800 + row.totalEventsLinked * 100,
    });
  }

  // ── Fallback: top structural briefs when no proven patterns exist ──

  if (!recs.some((r) => r.type === "replicate")) {
    for (const brief of opts.briefs.slice(0, 3)) {
      recs.push({
        id: `rec-explore-${brief.id}`,
        type: "replicate",
        headline: brief.title,
        rationale: `Structural gap: ${brief.gapTrigger}. Pattern "${brief.patternName}" observed on ${brief.sourcePages.length} page${brief.sourcePages.length !== 1 ? "s" : ""}.`,
        sourceEvidence: brief.patternEvidence.evidenceSummary,
        targetPageUrl: brief.pageUrl,
        targetPagePath: brief.pagePath,
        sourceChangeId: null,
        confidence:
          brief.patternEvidence.executionConfidence === "execution_validated"
            ? "high"
            : "medium",
        priority: brief.priority,
      });
    }
  }

  return recs.sort((a, b) => b.priority - a.priority);
}

const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  google_aio: "AI Overviews",
  perplexity: "Perplexity",
};
