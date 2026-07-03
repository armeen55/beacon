/**
 * question-universe (2026-07-03, BEACON_500 R11 / N30 - the demand-ranked
 * question universe).
 *
 * PURE / no I/O / no LLM. Merges every question-shaped demand signal Beacon
 * already stores into ONE ranked list per tenant:
 *
 *   - "gsc"         real Google queries phrased as questions (who/what/how/...),
 *                   with their impressions and the page Google already sends them to.
 *   - "ai_fanout"   the sub-questions AI engines expand tenant prompts into
 *                   (Profound fanouts + Beacon's own 4-engine poll expansions,
 *                   already merged by load-fanout-seeds.ts).
 *   - "native_poll" the tenant's own tracked question library (tracked_prompts,
 *                   the nightly poll's corpus).
 *   - "paa"         questions Google renders under People also ask on SERPs
 *                   Beacon has captured (dataforseo_serp_history paa_questions).
 *
 * Each merged question carries: which sources back it, an honest demandScore
 * (impressions where GSC-backed, fanout frequency, PAA presence), the page
 * that owns it (the N2 ownership registry's verdict, else Google's own
 * impressions attribution), and whether that owner page actually ANSWERS it
 * (checked against the page's stored extracts: headings, FAQ questions, body
 * sample). Rank = demand x not-covered, so the top of the list is always
 * "real people ask this and nothing of ours answers it."
 *
 * Near-duplicate questions collapse via the SAME distinguishing-token
 * convention the N2 ownership registry resolver uses (topicTokens from
 * relevance-gate.ts + a strict smaller-side subset match), so "persian new
 * year 2026 date" and "when is persian new year 2026" are one question, but
 * a question differing by a real distinguishing token never collapses.
 *
 * The nightly sync rebuilds and persists this (question-universe-loader.ts);
 * this module is the fully unit-testable core. NOT the same module as
 * ai-visibility/question-universe.ts - that one picks the CAPPED nightly
 * poll set (what to ask engines, spend-bounded at 25); this one is the
 * uncapped-demand RESEARCH view (what people ask, who owns it, is it
 * answered) that feeds drafting, briefs, and the /prompts surface.
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";

export type QuestionDemandSource = "gsc" | "ai_fanout" | "native_poll" | "paa";

/**
 * Coverage of the question on its owner page's stored extracts.
 *   - answered:     a stored heading or FAQ question on the owner page is
 *                   dedicated to this question (strict token match).
 *   - partial:      the owner page's extracts mention all of the question's
 *                   distinguishing tokens, but no single section/FAQ owns it.
 *   - not_answered: the owner page's stored extracts do not cover it, or no
 *                   page owns the question at all.
 *   - unchecked:    a page owns it but Beacon has no stored extracts for that
 *                   page yet - honest abstention, never a verdict off missing
 *                   data (the plan's three states plus this honesty state).
 */
export type QuestionCoverageStatus = "answered" | "partial" | "not_answered" | "unchecked";

export type UniverseQuestionRow = {
  tenant_id: string;
  /** Stable id: fnv-1a over the normalized canonical question text. */
  id: string;
  /** Canonical phrasing: the highest-demand variant seen for this question. */
  question: string;
  /** Absorbed near-duplicate phrasings (capped, canonical excluded). */
  variants: string[];
  sources: QuestionDemandSource[];
  /** Summed GSC impressions across merged variants (0 when not GSC-backed).
   *  These are times SHOWN on Google, never "searches" (label rule). */
  gscImpressions: number;
  gscClicks: number;
  /** Summed AI fanout frequency across merged variants. */
  fanoutWeight: number;
  paaSeen: boolean;
  inNativeLibrary: boolean;
  demandScore: number;
  /** The page that owns this question (N2 registry verdict, else the page
   *  Google already sends the query's impressions to), or null when nothing
   *  owns it yet. */
  ownership: string | null;
  coverageStatus: QuestionCoverageStatus;
  /** Plain, first-person reason for the coverage call (safe to render). */
  coverageDetail: string | null;
  /** demandScore x not-covered factor - the rank key. */
  priority: number;
  builtAt: string;
};

export type QuestionUniverseStats = {
  total: number;
  bySource: Record<QuestionDemandSource, number>;
  answered: number;
  partial: number;
  notAnswered: number;
  unchecked: number;
  mergedAway: number;
};

export type QuestionUniverse = {
  rows: UniverseQuestionRow[];
  stats: QuestionUniverseStats;
};

// ---------------------------------------------------------------------------
// Scoring constants - documented so the demand number is always explainable.
// ---------------------------------------------------------------------------

/** Each unit of AI fanout frequency counts as this many demand points (an AI
 *  engine repeatedly expanding into a question is real demand, but it has no
 *  impressions scale of its own). */
export const FANOUT_WEIGHT_POINTS = 20;
/** Flat demand points when Google renders the question under People also ask
 *  (Google itself decided people ask this). */
export const PAA_PRESENCE_POINTS = 40;
/** Flat demand points when the question is in the tenant's own tracked
 *  library (curated intent, weakest external-demand evidence). */
export const NATIVE_LIBRARY_POINTS = 10;

/** Rank multiplier per coverage status: demand x not-covered. An answered
 *  question keeps its demand number but sinks to the bottom of the ranking. */
const COVERAGE_FACTOR: Record<QuestionCoverageStatus, number> = {
  not_answered: 1,
  unchecked: 0.8,
  partial: 0.5,
  answered: 0,
};

/** Hard cap so a persisted universe can never grow unbounded. */
export const MAX_UNIVERSE_ROWS = 300;
const MAX_VARIANTS_PER_ROW = 6;

// ---------------------------------------------------------------------------
// Question shape + normalization
// ---------------------------------------------------------------------------

const QUESTION_LEAD_RE =
  /^(who|whom|whose|what|when|where|why|how|which|is|are|was|were|can|could|do|does|did|should|will|would)\b/i;

/** Is this text phrased as a question (a leading question word, or a literal
 *  question mark)? The GSC lane only admits question-shaped queries; the other
 *  three lanes are question corpora already. */
export function isQuestionShaped(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (t.includes("?")) return true;
  return QUESTION_LEAD_RE.test(t);
}

function normalizeQuestionText(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function universeQuestionId(text: string): string {
  return `uq-${fnv1a(normalizeQuestionText(text))}`;
}

/**
 * The registry-convention near-duplicate test: normalized equality, or every
 * distinguishing token of the SMALLER side present in the larger side (the
 * exact subset rule resolveOwner uses), with a 2-token floor on the smaller
 * side so one shared generic-ish token never collapses two real questions.
 * Single-token questions only collapse on exact token-set equality.
 */
export function isNearDuplicateQuestion(a: string, b: string): boolean {
  const na = normalizeQuestionText(a);
  const nb = normalizeQuestionText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return tokenNearDup(new Set(topicTokens(a)), new Set(topicTokens(b)));
}

/** The token half of the near-dup rule, over precomputed token sets (the
 *  builder calls this in a loop; re-tokenizing there would be quadratic). */
function tokenNearDup(ta: ReadonlySet<string>, tb: ReadonlySet<string>): boolean {
  if (ta.size === 0 || tb.size === 0) return false;
  const [smaller, larger] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let shared = 0;
  for (const t of smaller) if (larger.has(t)) shared += 1;
  if (shared !== smaller.size) return false;
  if (smaller.size === 1) return ta.size === tb.size; // exact 1-token equality only
  return true;
}

// ---------------------------------------------------------------------------
// Coverage detection (pure over stored extracts)
// ---------------------------------------------------------------------------

/** The owner page's stored extracts (page_snapshots projection: h2_list,
 *  faqs[].question, body_paragraph_sample + card_texts joined). */
export type OwnerPageExtract = {
  url: string;
  headings: string[];
  faqQuestions: string[];
  bodyText: string | null;
};

function tokensOf(text: string): Set<string> {
  return new Set(topicTokens(text));
}

/** Does a single structural item (heading / stored FAQ question) OWN this
 *  question? Strict smaller-side subset, 2-token floor (mirrors the near-dup
 *  rule so "a section dedicated to it" means one consistent thing). */
function structuralMatch(qTokens: ReadonlySet<string>, item: string): boolean {
  const iTokens = tokensOf(item);
  if (qTokens.size === 0 || iTokens.size === 0) return false;
  const [smaller, larger] = qTokens.size <= iTokens.size ? [qTokens, iTokens] : [iTokens, qTokens];
  let shared = 0;
  for (const t of smaller) if (larger.has(t)) shared += 1;
  if (smaller.size === 1) return shared === 1 && qTokens.size === iTokens.size;
  return shared === smaller.size && smaller.size >= 2;
}

export function coverageFor(
  question: string,
  extract: OwnerPageExtract | null | undefined,
): { status: QuestionCoverageStatus; detail: string | null } {
  if (!extract) {
    return { status: "unchecked", detail: "I have not read the owner page yet, so I can not check this one." };
  }
  const qTokens = tokensOf(question);
  if (qTokens.size === 0) {
    return { status: "unchecked", detail: "The question is too generic to check against the page." };
  }
  const structural = [...(extract.headings ?? []), ...(extract.faqQuestions ?? [])].filter(Boolean);
  const owningItem = structural.find((item) => structuralMatch(qTokens, item));
  if (owningItem) {
    return { status: "answered", detail: `The page has a section for it ("${owningItem.trim()}").` };
  }
  const combined = [structural.join(" "), extract.bodyText ?? ""].join(" ");
  const combinedTokens = tokensOf(combined);
  let covered = 0;
  for (const t of qTokens) if (combinedTokens.has(t)) covered += 1;
  if (covered === qTokens.size) {
    return { status: "partial", detail: "The page mentions all the key words, but no section is dedicated to the question." };
  }
  return { status: "not_answered", detail: "The page never covers this question." };
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export type GscQuestionInput = {
  query: string;
  impressions: number;
  clicks: number;
  ownerPage: string | null;
};

export type FanoutQuestionInput = { subQuery: string; weight: number };
export type NativeLibraryQuestionInput = { text: string };
export type PaaQuestionInput = { question: string };

/** The N2 registry resolver, injected so this module stays pure (the loader
 *  wraps resolveOwner(registry, q)). Null = registry unavailable. */
export type OwnerResolverFn = (questionOrTopic: string) => string | null;

export type BuildQuestionUniverseArgs = {
  tenantId: string;
  gscQueries?: readonly GscQuestionInput[];
  fanoutSeeds?: readonly FanoutQuestionInput[];
  nativeLibrary?: readonly NativeLibraryQuestionInput[];
  paaQuestions?: readonly PaaQuestionInput[];
  /** N2 ownership registry lookup; falls back to the GSC impressions owner. */
  resolveOwnerFor?: OwnerResolverFn | null;
  /** Stored extracts for candidate owner pages, keyed by lowercased URL. */
  ownerExtracts?: ReadonlyMap<string, OwnerPageExtract>;
  now?: Date;
  cap?: number;
};

type Accumulating = {
  canonical: string;
  variants: string[];
  tokens: Set<string>;
  norm: string;
  sources: Set<QuestionDemandSource>;
  gscImpressions: number;
  gscClicks: number;
  fanoutWeight: number;
  paaSeen: boolean;
  inNativeLibrary: boolean;
  gscOwner: string | null;
  gscOwnerImpressions: number;
};

export function buildQuestionUniverse(args: BuildQuestionUniverseArgs): QuestionUniverse {
  const cap = Math.max(1, Math.min(args.cap ?? MAX_UNIVERSE_ROWS, MAX_UNIVERSE_ROWS));
  const now = args.now ?? new Date();
  const builtAt = now.toISOString();

  // Candidate order is a deterministic demand order so the FIRST phrasing a
  // cluster sees (its canonical text) is the highest-evidence variant:
  // GSC (impressions desc) -> PAA -> fanouts (weight desc) -> library.
  type Candidate = {
    text: string;
    source: QuestionDemandSource;
    impressions: number;
    clicks: number;
    weight: number;
    ownerPage: string | null;
  };
  const candidates: Candidate[] = [];

  const gsc = [...(args.gscQueries ?? [])]
    .filter((q) => isQuestionShaped(q.query))
    .sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));
  for (const q of gsc) {
    candidates.push({ text: q.query, source: "gsc", impressions: Math.max(0, q.impressions), clicks: Math.max(0, q.clicks), weight: 0, ownerPage: q.ownerPage });
  }
  const paaSeen = new Set<string>();
  for (const p of args.paaQuestions ?? []) {
    const norm = normalizeQuestionText(p.question);
    if (!norm || paaSeen.has(norm)) continue;
    paaSeen.add(norm);
    candidates.push({ text: p.question, source: "paa", impressions: 0, clicks: 0, weight: 0, ownerPage: null });
  }
  const fanouts = [...(args.fanoutSeeds ?? [])].sort((a, b) => b.weight - a.weight || a.subQuery.localeCompare(b.subQuery));
  for (const f of fanouts) {
    candidates.push({ text: f.subQuery, source: "ai_fanout", impressions: 0, clicks: 0, weight: Math.max(0, f.weight), ownerPage: null });
  }
  for (const l of args.nativeLibrary ?? []) {
    candidates.push({ text: l.text, source: "native_poll", impressions: 0, clicks: 0, weight: 0, ownerPage: null });
  }

  const clusters: Accumulating[] = [];
  let mergedAway = 0;

  for (const c of candidates) {
    const text = (c.text ?? "").trim();
    const norm = normalizeQuestionText(text);
    if (!norm || norm.length < 4) continue;
    const tokens = tokensOf(text);
    const existing = clusters.find((cl) => cl.norm === norm || tokenNearDup(cl.tokens, tokens));
    const target =
      existing ??
      ((): Accumulating => {
        const fresh: Accumulating = {
          canonical: text,
          variants: [],
          tokens,
          norm,
          sources: new Set(),
          gscImpressions: 0,
          gscClicks: 0,
          fanoutWeight: 0,
          paaSeen: false,
          inNativeLibrary: false,
          gscOwner: null,
          gscOwnerImpressions: -1,
        };
        clusters.push(fresh);
        return fresh;
      })();
    if (existing) {
      mergedAway += 1;
      if (existing.norm !== norm && !existing.variants.includes(text) && existing.variants.length < MAX_VARIANTS_PER_ROW) {
        existing.variants.push(text);
      }
    }
    target.sources.add(c.source);
    target.gscImpressions += c.impressions;
    target.gscClicks += c.clicks;
    target.fanoutWeight += c.weight;
    if (c.source === "paa") target.paaSeen = true;
    if (c.source === "native_poll") target.inNativeLibrary = true;
    if (c.ownerPage && c.impressions > target.gscOwnerImpressions) {
      target.gscOwner = c.ownerPage;
      target.gscOwnerImpressions = c.impressions;
    }
  }

  const rows: UniverseQuestionRow[] = clusters.map((cl) => {
    const demandScore = Math.round(
      cl.gscImpressions +
        cl.fanoutWeight * FANOUT_WEIGHT_POINTS +
        (cl.paaSeen ? PAA_PRESENCE_POINTS : 0) +
        (cl.inNativeLibrary ? NATIVE_LIBRARY_POINTS : 0),
    );
    const registryOwner = args.resolveOwnerFor ? args.resolveOwnerFor(cl.canonical) : null;
    const ownership = registryOwner ?? cl.gscOwner ?? null;
    const extract = ownership ? (args.ownerExtracts?.get(ownership.toLowerCase()) ?? null) : null;
    const coverage = ownership
      ? coverageFor(cl.canonical, extract)
      : { status: "not_answered" as const, detail: "No page of ours owns this question yet." };
    return {
      tenant_id: args.tenantId,
      id: universeQuestionId(cl.canonical),
      question: cl.canonical,
      variants: cl.variants,
      sources: (["gsc", "ai_fanout", "native_poll", "paa"] as const).filter((s) => cl.sources.has(s)),
      gscImpressions: cl.gscImpressions,
      gscClicks: cl.gscClicks,
      fanoutWeight: cl.fanoutWeight,
      paaSeen: cl.paaSeen,
      inNativeLibrary: cl.inNativeLibrary,
      demandScore,
      ownership,
      coverageStatus: coverage.status,
      coverageDetail: coverage.detail,
      priority: Math.round(demandScore * COVERAGE_FACTOR[coverage.status]),
      builtAt,
    };
  });

  rows.sort((a, b) => b.priority - a.priority || b.demandScore - a.demandScore || a.question.localeCompare(b.question));
  const capped = rows.slice(0, cap);

  const stats: QuestionUniverseStats = {
    total: capped.length,
    bySource: { gsc: 0, ai_fanout: 0, native_poll: 0, paa: 0 },
    answered: 0,
    partial: 0,
    notAnswered: 0,
    unchecked: 0,
    mergedAway,
  };
  for (const r of capped) {
    for (const s of r.sources) stats.bySource[s] += 1;
    if (r.coverageStatus === "answered") stats.answered += 1;
    else if (r.coverageStatus === "partial") stats.partial += 1;
    else if (r.coverageStatus === "not_answered") stats.notAnswered += 1;
    else stats.unchecked += 1;
  }

  return { rows: capped, stats };
}

// ---------------------------------------------------------------------------
// Consumer helpers (pure) - the seams the drafters / briefs / surfaces use.
// ---------------------------------------------------------------------------

/** Rows not yet answered anywhere, best first (the "no one answers this well"
 *  view). Partial counts as uncovered (a mention is not an answer); answered
 *  rows never appear. */
export function uncoveredQuestions(rows: readonly UniverseQuestionRow[], limit = 5): UniverseQuestionRow[] {
  return rows
    .filter((r) => r.coverageStatus === "not_answered" || r.coverageStatus === "partial")
    .sort((a, b) => b.priority - a.priority || b.demandScore - a.demandScore || a.question.localeCompare(b.question))
    .slice(0, Math.max(0, limit));
}

/**
 * The drafter seed seam: top uncovered universe questions relevant to a
 * page's topic (>= 1 shared distinguishing token with the topic label /
 * query), excluding near-duplicates of questions the caller already has.
 *
 * CONTRACT (pinned): returns [] when the universe is empty - callers merge
 * with `seeds.length > 0 ? merge : existing`, so an empty universe leaves
 * every consumer byte-identical to before this feature existed.
 */
export function seedQuestionsForTopic(
  rows: readonly UniverseQuestionRow[],
  topic: string,
  opts: { existing?: readonly string[]; limit?: number } = {},
): string[] {
  if (rows.length === 0) return [];
  const limit = Math.max(0, opts.limit ?? 5);
  const topicTok = tokensOf(topic);
  if (topicTok.size === 0 || limit === 0) return [];
  const existing = opts.existing ?? [];
  const out: string[] = [];
  for (const r of uncoveredQuestions(rows, rows.length)) {
    if (out.length >= limit) break;
    const qTok = r.question ? tokensOf(r.question) : new Set<string>();
    let shared = 0;
    for (const t of qTok) if (topicTok.has(t)) shared += 1;
    if (shared === 0) continue;
    if (existing.some((e) => isNearDuplicateQuestion(e, r.question))) continue;
    if (out.some((e) => isNearDuplicateQuestion(e, r.question))) continue;
    out.push(r.question);
  }
  return out;
}

/** Plain-words source line for one row ("shown on Google 340 times in the
 *  last 90 days; AI engines expand into this"). Impressions are always
 *  "shown on Google", never "searches" (the keyword-library label rule). */
export function describeQuestionSources(row: UniverseQuestionRow): string {
  const parts: string[] = [];
  if (row.gscImpressions > 0) {
    parts.push(`shown on Google ${row.gscImpressions.toLocaleString()} times in the last 90 days`);
  }
  if (row.sources.includes("ai_fanout")) parts.push("AI engines expand into this when they answer");
  if (row.paaSeen) parts.push("Google lists it under People also ask");
  if (row.inNativeLibrary) parts.push("one of the questions I already track");
  return parts.join("; ");
}
