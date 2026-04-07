import type { Result } from "@/domains/results/types";

export type ResultMode = "visibility" | "attribution";

const VISIBILITY_PREFIXES = ["shield:"];
const VISIBILITY_PATTERNS = [/\(bay\s*area\)/i, /bay\s+area$/i];

/**
 * Classify a result as visibility-only or attribution-eligible.
 *
 * Visibility: broad/fuzzy topics where causal attribution review would
 * create fake precision (Shield clusters, generic Bay Area aggregates).
 *
 * Attribution: city/topic-specific results with enough structural
 * anchors to support meaningful causal review.
 */
export function classifyResultMode(result: Result): ResultMode {
  const topic = (result.topic ?? "").toLowerCase().trim();
  if (!topic) return "visibility";

  for (const prefix of VISIBILITY_PREFIXES) {
    if (topic.startsWith(prefix)) return "visibility";
  }

  for (const pattern of VISIBILITY_PATTERNS) {
    if (pattern.test(topic)) return "visibility";
  }

  return "attribution";
}

export function partitionResultsByMode(results: Result[]): {
  attribution: Result[];
  visibility: Result[];
} {
  const attribution: Result[] = [];
  const visibility: Result[] = [];
  for (const r of results) {
    if (classifyResultMode(r) === "attribution") {
      attribution.push(r);
    } else {
      visibility.push(r);
    }
  }
  return { attribution, visibility };
}
