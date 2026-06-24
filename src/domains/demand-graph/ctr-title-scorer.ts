/**
 * ctr-title-scorer (2026-06-24, L10) — a PURE, deterministic CTR title generator
 * for the EvidencePacket draft. NO LLM. Generates a few grounded title variants
 * from the target query + brand and scores them on click-driving signals SEO/CTR
 * practitioners rely on: the query tokens present (essential), a leading number /
 * list cue, a parenthetical qualifier, the current year, the length sweet spot
 * (~50–60 chars), and a generic power word. Returns the best-scoring variant.
 *
 * Deterministic + testable: the year is an explicit input (no Date dependency),
 * power/list cues are generic (not vertical/tenant hardcoding). The LLM can later
 * rewrite from here, but this stands on its own as an honest, grounded suggestion.
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
  if (/\b20\d\d\b/.test(title)) {
    score += 8;
    signals.push("year");
  }
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

/** Generate grounded title candidates for a query + brand + year. */
export function titleCandidates(query: string, brand: string, year: number): string[] {
  const q = titleCase(query.trim());
  const b = brand.trim();
  const suffix = b ? ` | ${b}` : "";
  const out = new Set<string>();
  out.add(`${q}${suffix}`);
  out.add(`${q}: The Complete Guide${suffix}`);
  out.add(`${q} (${year} Guide)${suffix}`);
  out.add(`${q} Explained${suffix}`);
  if (LIST_CUE.test(query)) {
    out.add(`Top 10 ${q}${suffix}`);
    out.add(`${q}: The Complete List${suffix}`);
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
