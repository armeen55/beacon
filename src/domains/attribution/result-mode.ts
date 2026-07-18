import type { Result } from "@/domains/results/types";
import { SEED_OWNER_TENANT_ID } from "@/lib/demo-mode";

export type ResultMode = "visibility" | "attribution";

/**
 * The `shield:` topic prefix is a generic, tenant-agnostic marker for
 * broad/fuzzy topics that produce fake-precision attribution — it applies to
 * every tenant.
 */
const VISIBILITY_PREFIXES = ["shield:"];

/**
 * Bay-Area geographic aggregates. These are RITZ-SPECIFIC (the founder tenant
 * is a Bay-Area builder); a Persian encyclopedia has no "bay area" topics.
 * Finding D (2026-07-18): these were process-global defaults mutated through a
 * `configureVisibilityRules()` setter that ONE tenant's import could flip for
 * every later tenant in the same warm lambda. That mutable module state (and
 * its unused setter/reset pair) is removed; the patterns are now resolved at
 * call time and only apply to the founder tenant, never globally.
 */
const FOUNDER_VISIBILITY_PATTERNS = [/\(bay\s*area\)/i, /bay\s+area$/i];

/** Resolve the visibility rules for a given tenant. No shared mutable state:
 *  every call recomputes from constants, so one tenant can never reconfigure
 *  classification for another. */
function visibilityRulesFor(tenantId?: string): { prefixes: string[]; patterns: RegExp[] } {
  const patterns = tenantId === SEED_OWNER_TENANT_ID ? FOUNDER_VISIBILITY_PATTERNS : [];
  return { prefixes: VISIBILITY_PREFIXES, patterns };
}

/**
 * Classify a result as visibility-only or attribution-eligible.
 *
 * Visibility: broad/fuzzy topics where causal attribution review would
 * create fake precision.
 *
 * Attribution: topic-specific results with enough structural anchors
 * to support meaningful causal review.
 *
 * `tenantId` (finding D) selects the tenant's rules at call time. Omitted or
 * non-founder → only the generic `shield:` prefix applies; the Ritz Bay-Area
 * patterns are added only for the founder tenant.
 */
export function classifyResultMode(result: Result, tenantId?: string): ResultMode {
  const topic = (result.topic ?? "").toLowerCase().trim();
  if (!topic) return "visibility";

  const { prefixes, patterns } = visibilityRulesFor(tenantId);

  for (const prefix of prefixes) {
    if (topic.startsWith(prefix)) return "visibility";
  }

  for (const pattern of patterns) {
    if (pattern.test(topic)) return "visibility";
  }

  return "attribution";
}

export function partitionResultsByMode(
  results: Result[],
  tenantId?: string,
): {
  attribution: Result[];
  visibility: Result[];
} {
  const attribution: Result[] = [];
  const visibility: Result[] = [];
  for (const r of results) {
    if (classifyResultMode(r, tenantId) === "attribution") {
      attribution.push(r);
    } else {
      visibility.push(r);
    }
  }
  return { attribution, visibility };
}
