/**
 * asset-spec (2026-06-24, Step 5) — the ASSET engine's deterministic core. When a
 * Move is a `missing_tool` gap (a competitor offers an interactive tool/calculator
 * you lack, OR a tool-intent query), this classifies WHAT to build and HOW, with
 * NO LLM. The detailed inputs/outputs/formula are left to a later, gated LLM pass;
 * this is the grounded skeleton that makes the asset Move actionable today.
 *
 * Iranopedia assets the operator flagged as huge: Persian name→meaning generator,
 * Farsi number / Jalali-date converters, Nowruz countdown + Haft-sin checklist,
 * transliteration tool, "Farsi vs Persian?" quiz. Ritz: cost calculator, ADU
 * feasibility checker, project-timeline estimator. The classifier is generic
 * (intent cues, NOT vertical hardcoding) so it works for any tenant.
 */

export type AssetKind =
  | "calculator"
  | "converter"
  | "generator"
  | "quiz"
  | "checklist"
  | "interactive_table"
  | "tool";

export type AssetSpec = {
  kind: AssetKind;
  title: string;
  rationale: string;
  /** Where/how to build it on a Wix-hosted site (generic). */
  buildPath: string;
  /** Brief for the later (gated) LLM pass to spec inputs/outputs/logic. */
  briefForLLM: string;
};

/** Intent cues per kind — generic, ordered by specificity (first match wins). */
const KIND_CUES: Array<{ kind: AssetKind; re: RegExp }> = [
  { kind: "converter", re: /\bconvert(er)?\b|\bto\s+(gregorian|jalali|farsi|english|usd|metric)\b|\bjalali\b|\btranslit/i },
  { kind: "calculator", re: /\bcalculator\b|\bcalc\b|\bcost\b|\bprice\b|\bestimate\b|\bbudget\b|how much|\broi\b|\bpayment\b/i },
  { kind: "quiz", re: /\bquiz\b|\btest\b|which\s+\w+\s+(are|should)|\bare you\b|personality/i },
  { kind: "checklist", re: /\bchecklist\b|\bsteps\b|\bhow to\b|\bplan(ner)?\b|\bcountdown\b|\bguide\b/i },
  { kind: "generator", re: /\bgenerator\b|\bname(s)?\b|\bideas\b|\brandom\b|\bpicker\b/i },
  { kind: "interactive_table", re: /\blist\b|\btable\b|\bcompare\b|\bcomparison\b|\bvs\b|\bdirectory\b|\branking\b/i },
];

export function inferAssetKind(query: string, competitorTitle?: string | null): AssetKind {
  const hay = `${query} ${competitorTitle ?? ""}`.toLowerCase();
  for (const { kind, re } of KIND_CUES) {
    if (re.test(hay)) return kind;
  }
  return "tool";
}

const KIND_LABEL: Record<AssetKind, string> = {
  calculator: "Calculator",
  converter: "Converter",
  generator: "Generator",
  quiz: "Quiz",
  checklist: "Interactive checklist",
  interactive_table: "Interactive/filterable table",
  tool: "Interactive tool",
};

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function buildAssetSpec(
  query: string,
  brand: string,
  opts?: { competitorDomain?: string | null; competitorTitle?: string | null },
): AssetSpec {
  const kind = inferAssetKind(query, opts?.competitorTitle);
  const label = KIND_LABEL[kind];
  const subject = titleCase(query.trim());
  const comp = opts?.competitorDomain ? ` ${opts.competitorDomain} has one; out-build it.` : "";
  return {
    kind,
    title: `${subject} ${label}`.trim(),
    rationale: `An interactive ${kind.replace("_", " ")} for "${query}" earns links + AI citations + engagement that a static page can't.${comp}`,
    buildPath:
      "Build on Wix as a custom element / Velo widget embedded in the page, an interactive form, or a small external micro-app linked from the page.",
    briefForLLM: `Spec a ${kind.replace("_", " ")} for "${query}" (${brand}): exact inputs, outputs, and the formula/logic/data it needs. Keep it self-contained + embeddable.`,
  };
}
