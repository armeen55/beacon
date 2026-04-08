import type { Result } from "@/domains/results/types";

export type ResultMode = "visibility" | "attribution";

/**
 * Default visibility patterns. These can be overridden per-tenant.
 * Currently includes common broad-topic prefixes and geographic
 * aggregates that produce unreliable attribution.
 */
const DEFAULT_VISIBILITY_PREFIXES = ["shield:"];
const DEFAULT_VISIBILITY_PATTERNS = [/\(bay\s*area\)/i, /bay\s+area$/i];

let visibilityPrefixes = DEFAULT_VISIBILITY_PREFIXES;
let visibilityPatterns = DEFAULT_VISIBILITY_PATTERNS;

/**
 * Override the visibility classification rules.
 * Call this during import setup if the tenant has custom taxonomy.
 */
export function configureVisibilityRules(config: {
  prefixes?: string[];
  patterns?: RegExp[];
}) {
  if (config.prefixes) visibilityPrefixes = config.prefixes;
  if (config.patterns) visibilityPatterns = config.patterns;
}

export function resetVisibilityRules() {
  visibilityPrefixes = DEFAULT_VISIBILITY_PREFIXES;
  visibilityPatterns = DEFAULT_VISIBILITY_PATTERNS;
}

/**
 * Classify a result as visibility-only or attribution-eligible.
 *
 * Visibility: broad/fuzzy topics where causal attribution review would
 * create fake precision.
 *
 * Attribution: topic-specific results with enough structural anchors
 * to support meaningful causal review.
 */
export function classifyResultMode(result: Result): ResultMode {
  const topic = (result.topic ?? "").toLowerCase().trim();
  if (!topic) return "visibility";

  for (const prefix of visibilityPrefixes) {
    if (topic.startsWith(prefix)) return "visibility";
  }

  for (const pattern of visibilityPatterns) {
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
