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

export type TitleVariant = {
  title: string;
  score: number;
  signals: string[];
  /** Which generation strategy produced it (query-exact / list / differentiated / …). */
  strategy?: string;
  /** One short line on WHY this title — so the operator sees senior reasoning, not a template. */
  reason?: string;
};

/** Real page evidence that makes a title page-specific instead of a generic template. */
export type TitleExtras = {
  /** The page's current <title>, when known — drives a "trim under 60 chars" suggestion. */
  currentTitle?: string | null;
  /** The cited competitor's title, when on-topic — for a SERP-pattern variant (future). */
  competitorTitle?: string | null;
  /** Current GSC rank for the head query (context only). */
  position?: number | null;
  /** Current GSC impressions for the head query (context only). */
  impressions?: number | null;
  /** Other GSC queries this page ranks for (context only, for future enrichment). */
  secondaryQueries?: string[];
};

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

type TitleIntent = "list" | "definitional" | "comparison" | "entity";

/**
 * Classify the searcher's intent from the query so the title FRAMING fits — the fix
 * for "every page gets the same 'Complete Guide'". A list query ("best/top/names")
 * wants a numbered list; a question ("what/how") wants a guide/answer; a single
 * entity ("onager", "tehran") is best served by a concise descriptive title.
 */
function detectIntent(query: string): TitleIntent {
  const q = query.toLowerCase().trim();
  if (/\bvs\.?\b|\bversus\b|difference between/.test(q)) return "comparison";
  if (/^(what|who|why|how|when|where|which)\b/.test(q) || /\b(meaning|meanings|definition)\b/.test(q)) {
    return "definitional";
  }
  if (LIST_CUE.test(q)) return "list";
  return "entity";
}

function capFirst(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Trim an over-long title to the SERP limit at a word boundary, dropping trailing punctuation. */
function trimToLimit(title: string, max: number): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s|,:–—-]+$/u, "").trim();
}

/** Strategy → a small additive bonus so a concise descriptive title (or an
 *  evidence-derived one) is the default BEST, and a bare editorial framing never
 *  wins by default. Combined with intent-fit generation, this stops "Complete
 *  Guide" from being the universal top suggestion. */
const STRATEGY_BONUS: Record<string, number> = {
  // The clean exact-query title is the senior default BEST — concise + descriptive,
  // and inherently page-specific. It must beat a bare editorial framing ("X,
  // Explained" / "Complete Guide") so those never become the new universal template;
  // only a stronger evidence-based framing (a numbered list for list intent) overtakes it.
  "query-exact": 12,
  "trim-current": 11,
  list: 14,
  differentiated: 9,
  "beat-serp": 9,
  editorial: 0,
};

type RawCandidate = { title: string; strategy: string; reason: string };

/**
 * Generate page-specific title candidates whose FRAMING follows the query intent
 * and whose options carry a one-line reason — so the suggestions read like a
 * strategist's, not a fill-in-the-blank template. "Complete Guide" appears ONLY for
 * explainer/definitional intent (never as the universal default), list queries get a
 * numbered-list framing, and an over-long current title earns a concrete trim.
 */
function genCandidates(query: string, brand: string, extras?: TitleExtras): RawCandidate[] {
  const q = titleCase(query.trim());
  const b = (brand ?? "").trim();
  const suffix = b ? ` | ${b}` : "";
  const intent = detectIntent(query);
  const out: RawCandidate[] = [];
  const seen = new Set<string>();
  const add = (title: string, strategy: string, reason: string) => {
    const t = title.trim();
    if (!t) return;
    // Allow a brand suffix to push slightly past the SERP target, but not absurdly.
    if (t.length > TITLE_MAX + (b ? b.length + 3 : 0) + 4) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title: t, strategy, reason });
  };

  // 1) query-exact — Google's first recommendation: concise + descriptive.
  add(`${q}${suffix}`, "query-exact", "Matches the exact phrase searchers type.");

  // 2) intent-fit framing
  if (intent === "list") {
    if (!/^\d/.test(q)) add(`Top 10 ${q}${suffix}`, "list", "A numbered list earns clicks on “best/top/names” searches.");
    if (/\bnames?\b/i.test(query)) add(`${q} & Their Meanings${suffix}`, "differentiated", "Adds the “with meanings” angle name-searchers want.");
    else add(`${q}, Ranked${suffix}`, "differentiated", "Signals a ranked, scannable list.");
  } else if (intent === "definitional") {
    add(`${q}: A Complete Guide${suffix}`, "editorial", "A guide framing fits an explainer search.");
    if (/^(what|who|why|how|when|where|which)\b/i.test(query)) {
      add(`${capFirst(q)}?${suffix}`, "differentiated", "Mirrors the exact question searchers ask.");
    }
  } else if (intent === "comparison") {
    add(`${q}: Key Differences${suffix}`, "differentiated", "A comparison search wants the differences up front.");
    add(`${q}, Explained${suffix}`, "editorial", "Explainer framing for a comparison.");
  }

  // 3) evidence-based: trim an over-length current title (concrete + page-specific).
  const ct = extras?.currentTitle?.trim();
  if (ct && ct.length > TITLE_MAX) {
    const trimmed = trimToLimit(ct, TITLE_MAX);
    if (trimmed && trimmed.toLowerCase() !== `${q}${suffix}`.toLowerCase()) {
      add(trimmed, "trim-current", `Your title is ${ct.length} chars — trimmed under Google’s ~60-char limit so it isn’t cut off.`);
    }
  }

  // Always leave at least two options to pick between.
  if (out.length < 2) add(`${q}, Explained${suffix}`, "editorial", "An explainer framing if the page goes in depth.");

  return out;
}

/**
 * Scored, page-specific title variants WITH a strategy + reason on each — the
 * production entry point for the CTR Title Lab. Sorted best-first.
 */
export function buildTitleVariants(query: string, brand: string, extras?: TitleExtras): TitleVariant[] {
  return genCandidates(query, brand, extras)
    .map((c) => {
      const s = scoreTitle(c.title, query, brand);
      return { ...s, score: s.score + (STRATEGY_BONUS[c.strategy] ?? 0), strategy: c.strategy, reason: c.reason };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Page-specific title strings (intent + evidence aware). Kept for call-site
 * compatibility; the `extras`/legacy-year third arg is accepted (a number is
 * ignored — year-stuffing is boilerplate per Google title-link guidance).
 */
export function titleCandidates(query: string, brand: string, extras?: TitleExtras | number): string[] {
  const e = typeof extras === "object" && extras ? extras : undefined;
  return genCandidates(query, brand, e).map((c) => c.title);
}

/** The single best deterministic title for a query (≤60 chars when possible). */
export function bestTitle(query: string, brand: string, _year = 2026): string {
  void _year;
  return buildTitleVariants(query, brand)[0]?.title ?? `${titleCase(query)}${brand ? ` | ${brand}` : ""}`;
}
