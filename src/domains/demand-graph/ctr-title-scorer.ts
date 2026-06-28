/**
 * ctr-title-scorer (2026-06-24, L10) — a PURE, deterministic CTR title generator
 * for the EvidencePacket draft. NO LLM. Generates a few grounded title variants
 * from the target query + brand and scores them on click-driving signals SEO/CTR
 * practitioners rely on: the query tokens present (essential), a leading number /
 * list cue, a parenthetical qualifier, the length sweet spot (~50–60 chars), and a
 * generic power word. Returns the best-scoring variant. Year-stuffing is NOT a
 * signal (boilerplate per Google title-link guidance).
 *
 * Deterministic + testable: power/list cues are generic (not vertical/tenant
 * hardcoding). The LLM can later rewrite from here, but this stands on its own as
 * an honest, grounded suggestion.
 */

const POWER_WORDS = new Set([
  "complete", "ultimate", "essential", "definitive", "explained", "guide",
]);

/** Generic list-intent cues in a query → a "Top N / List of" title works. */
const LIST_CUE = /\b(best|top|list|names|ideas|examples|types|tips|ways)\b/i;

const TITLE_MIN = 35;
const TITLE_MAX = 60;
const TITLE_SWEET_LO = 48;
const TITLE_SWEET_HI = 60;

export type TitleVariant = { title: string; score: number; signals: string[] };

function titleCase(s: string): string {
  const small = new Set(["a", "an", "and", "the", "of", "for", "in", "on", "to", "vs", "or"]);
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) =>
      i > 0 && small.has(w.toLowerCase())
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

/** Score one candidate title against the query. Higher = more clickable. */
export function scoreTitle(title: string, query: string, brand: string): TitleVariant {
  const signals: string[] = [];
  let score = 0;
  const lower = title.toLowerCase();
  const qTokens = tokenize(query);

  // Essential: the query tokens must be present.
  const present = qTokens.filter((t) => lower.includes(t)).length;
  const coverage = qTokens.length ? present / qTokens.length : 0;
  score += Math.round(coverage * 40);
  if (coverage >= 0.99) signals.push("full-query");

  if (/^\d|\b\d{1,3}\b/.test(title)) {
    score += 12;
    signals.push("number");
  }
  if (/\(([^)]+)\)/.test(title)) {
    score += 8;
    signals.push("parenthetical");
  }
  // NOTE: no "year" bonus. Year-stuffing ("… (2026 Guide)") is boilerplate that
  // Google's title-link guidance warns against — it made one templated title win
  // on every page. Titles earn their score from query coverage + page-specific cues.
  if (tokenize(title).some((t) => POWER_WORDS.has(t))) {
    score += 6;
    signals.push("power-word");
  }
  if (brand && lower.includes(brand.toLowerCase())) {
    score += 5;
    signals.push("brand");
  }
  // Length: reward the sweet spot, penalize over the SERP limit.
  if (title.length > TITLE_MAX) {
    score -= (title.length - TITLE_MAX) * 2;
    signals.push("too-long");
  } else if (title.length >= TITLE_SWEET_LO && title.length <= TITLE_SWEET_HI) {
    score += 6;
    signals.push("length-sweet");
  } else if (title.length < TITLE_MIN) {
    score -= 4;
    signals.push("too-short");
  }

  return { title, score, signals };
}

/**
 * Generate grounded, page-specific title candidates — three distinct framings, not
 * six boilerplate templates dominated by "(YYYY Guide)". Per Google title-link
 * guidance: concise, descriptive, unique, no boilerplate/repetition.
 *   1. exact-query   — the plain descriptive title (Google's first recommendation)
 *   2. editorial     — one "complete guide" framing
 *   3. curiosity     — a benefit/explainer framing
 * List-intent queries also get a "Top N" variant. The `year` param is kept for
 * call-site compatibility but no longer stuffed into the title (it's boilerplate).
 */
export function titleCandidates(query: string, brand: string, _year?: number): string[] {
  void _year;
  const q = titleCase(query.trim());
  const b = brand.trim();
  const suffix = b ? ` | ${b}` : "";
  const out = new Set<string>();
  out.add(`${q}${suffix}`); // exact-query
  out.add(`${q}: A Complete Guide${suffix}`); // editorial
  out.add(`${q}, Explained${suffix}`); // curiosity / benefit
  if (LIST_CUE.test(query)) {
    out.add(`Top 10 ${q}${suffix}`);
  }
  return [...out];
}

/** The single best deterministic title for a query (≤60 chars when possible). */
export function bestTitle(query: string, brand: string, year = 2026): string {
  const scored = titleCandidates(query, brand, year)
    .map((t) => scoreTitle(t, query, brand))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.title ?? `${titleCase(query)}${brand ? ` | ${brand}` : ""}`;
}
