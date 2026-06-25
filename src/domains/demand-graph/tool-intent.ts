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
  /** The asset's subject, tool-word stripped (e.g. "persian name"). */
  topic: string;
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
        topic,
        suggestion,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => b.impressions - a.impressions).slice(0, cap);
}

export type AssetSpec = {
  /** One-line what-it-does. */
  summary: string;
  /** What the user enters. */
  inputs: string[];
  /** What it returns. */
  outputs: string[];
  /** How to ship it (generic build paths — no vendor lock). */
  buildPath: string;
};

// Deterministic spec scaffolds per asset kind. Generic (no vertical hardcoding) —
// the topic is slotted in so the brief reads concretely for the operator/dev.
const SPEC_BY_KIND: Record<ToolKind, (topic: string) => AssetSpec> = {
  generator: (t) => ({
    summary: `Generate ${t || "results"} from a few user choices, with a copy/share button.`,
    inputs: ["A few constraint options (e.g. style, length, category)", "Optional seed/keyword"],
    outputs: [`A list of ${t || "generated"} options`, "Copy / regenerate / share controls"],
    buildPath: "Client-side widget (no backend needed) embedded on a dedicated page; or a serverless function if the list is large.",
  }),
  converter: (t) => ({
    summary: `Convert ${t || "values"} between formats instantly as the user types.`,
    inputs: ["Source value", "From / to units (or auto-detected)"],
    outputs: ["The converted value", "A short worked-example + reverse direction"],
    buildPath: "Pure client-side JS widget (instant, no backend) on a dedicated page.",
  }),
  calculator: (t) => ({
    summary: `Calculate ${t || "a result"} from the user's numbers, with the formula shown.`,
    inputs: ["The numeric fields the calculation needs"],
    outputs: ["The computed result", "A plain-English breakdown of how it was derived"],
    buildPath: "Client-side calculator widget on a dedicated page; show the formula for trust + AEO.",
  }),
  quiz: (t) => ({
    summary: `An interactive ${t || "quiz"} that returns a personalized result.`,
    inputs: ["5–8 multiple-choice questions"],
    outputs: ["A result archetype with a shareable summary", "Social share + retake controls"],
    buildPath: "Client-side quiz component (state in the browser) on a dedicated page.",
  }),
  checker: (t) => ({
    summary: `Check / validate ${t || "an input"} and return a clear pass/issue verdict.`,
    inputs: ["The thing to check (text, URL, value)"],
    outputs: ["A verdict + the specific issues found", "How to fix each"],
    buildPath: "Client-side validator (or serverless if it needs an external lookup) on a dedicated page.",
  }),
  estimator: (t) => ({
    summary: `Estimate ${t || "an outcome"} from the user's situation, with the assumptions shown.`,
    inputs: ["A few situational fields", "Optional ranges for sensitivity"],
    outputs: ["A range estimate", "The assumptions + what moves the number"],
    buildPath: "Client-side estimator widget on a dedicated page; surface assumptions for trust.",
  }),
  template: (t) => ({
    summary: `A fill-in ${t || "template"} the user can complete and download.`,
    inputs: ["A few personalization fields"],
    outputs: ["A completed, downloadable/printable document"],
    buildPath: "Client-side form → rendered doc (print/PDF) on a dedicated page.",
  }),
  tool: (t) => ({
    summary: `An interactive tool for ${t || "this task"}.`,
    inputs: ["The minimal inputs the task needs"],
    outputs: ["The result, copyable/shareable"],
    buildPath: "Start client-side on a dedicated page; add a serverless function only if it needs server data.",
  }),
};

/** Deterministic build brief for a tool opportunity — what it takes, what it
 *  returns, and how to ship it. Pure; the topic is the asset's subject. */
export function buildAssetSpec(kind: ToolKind, topic: string): AssetSpec {
  return (SPEC_BY_KIND[kind] ?? SPEC_BY_KIND.tool)((topic ?? "").trim());
}
