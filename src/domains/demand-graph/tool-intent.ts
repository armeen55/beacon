/**
 * tool-intent (2026-06-25, §5/§8 asset engine) — PURE, deterministic detection of
 * INTERACTIVE-ASSET demand in a tenant's own search queries. A query like "farsi
 * number converter" or "persian name generator" is a user asking for a TOOL, not
 * an article — a calculator/converter/generator/quiz the site could own to earn
 * links + AI citations + conversions (the §8 asset ideas, found from real demand
 * rather than guessed). No LLM, no tenant hardcoding (generic tool vocabulary).
 */

export type ToolKind =
  | "converter"
  | "calculator"
  | "generator"
  | "quiz"
  | "checker"
  | "estimator"
  | "template"
  | "tool";

// Generic tool-intent vocabulary → the asset kind it implies. Order matters only
// for display; matching is whole-word, case-insensitive.
const TOOL_WORDS: Array<{ re: RegExp; kind: ToolKind }> = [
  { re: /\bconvert(er|or)?\b/i, kind: "converter" },
  { re: /\bcalculat(or|e)\b/i, kind: "calculator" },
  { re: /\bgenerat(or|e)\b/i, kind: "generator" },
  { re: /\bquiz\b/i, kind: "quiz" },
  { re: /\b(check(er)?|validator|lookup)\b/i, kind: "checker" },
  { re: /\bestimat(or|e)\b/i, kind: "estimator" },
  { re: /\b(template|worksheet|planner|checklist)\b/i, kind: "template" },
  { re: /\b(tool|widget)\b/i, kind: "tool" },
];

export type ToolIntent = { isToolIntent: boolean; kind: ToolKind | null };

/** Classify a single query's tool intent (the first vocabulary match wins). */
export function detectToolIntent(query: string): ToolIntent {
  const q = (query ?? "").toLowerCase();
  if (!q.trim()) return { isToolIntent: false, kind: null };
  for (const { re, kind } of TOOL_WORDS) {
    if (re.test(q)) return { isToolIntent: true, kind };
  }
  return { isToolIntent: false, kind: null };
}

export type ToolQueryInput = { query: string; impressions: number; clicks: number };

export type ToolOpportunity = {
  query: string;
  kind: ToolKind;
  impressions: number;
  clicks: number;
  /** Suggested asset, e.g. "Persian Name generator". */
  suggestion: string;
};

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build ranked tool/asset opportunities from a tenant's queries: keep the
 * tool-intent ones, dedupe by (kind + the topic the tool is about), rank by
 * impressions (demand). `minImpressions` filters noise.
 */
export function buildToolOpportunities(
  queries: ToolQueryInput[],
  opts: { minImpressions?: number; cap?: number } = {},
): ToolOpportunity[] {
  const minImpressions = opts.minImpressions ?? 50;
  const cap = opts.cap ?? 6;
  const byKey = new Map<string, ToolOpportunity>();

  for (const q of queries) {
    if ((q.impressions ?? 0) < minImpressions) continue;
    const intent = detectToolIntent(q.query);
    if (!intent.isToolIntent || !intent.kind) continue;
    // Topic = the query with the tool word stripped, so "farsi number converter"
    // and "convert farsi numbers" collapse to one converter opportunity.
    const topic = q.query
      .toLowerCase()
      .replace(TOOL_WORDS.find((t) => t.kind === intent.kind)!.re, "")
      .replace(/\s+/g, " ")
      .trim();
    const key = `${intent.kind}:${topic}`;
    const suggestion = `${titleCase(topic || q.query)} ${intent.kind}`.replace(/\s+/g, " ").trim();
    const existing = byKey.get(key);
    if (!existing || q.impressions > existing.impressions) {
      byKey.set(key, {
        query: q.query,
        kind: intent.kind,
        impressions: q.impressions,
        clicks: q.clicks,
        suggestion,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => b.impressions - a.impressions).slice(0, cap);
}
