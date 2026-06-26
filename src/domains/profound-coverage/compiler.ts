/**
 * Profound Prompt-to-Page Coverage Compiler — PURE deterministic engine.
 *
 * Maps each tracked Profound AI prompt to the right Iranopedia page ACTION using
 * only the inputs handed in: prompt text, fan-outs, cited competitor pages, and
 * the tenant's owned pages (with their GSC/GA4/Clarity proof KPIs). No I/O, no
 * embeddings, no network, no hardcoded tenant facts (entities + competitor
 * domains are derived from the inputs). The single borrowed-account guard reused
 * is isProfoundNoisePrompt.
 *
 * Trust rule baked into ranking: a pure-Profound gap (a prompt with no GSC-backed
 * owned page behind it) must NOT outrank a GSC-backed existing-page move unless
 * MANY prompts/fan-outs agree AND the competitor citations are strong and
 * content-like. GSC demand is the ground truth; Profound is corroboration.
 */

import { isProfoundNoisePrompt } from "@/lib/connectors/profound/tenant-scope";
import type { PromptOpportunity } from "@/domains/profound-question-intelligence/prompt-opportunity";
import type {
  AeoActionPack,
  AeoPromptInput,
  OwnedPageCandidate,
  PromptIntent,
  PromptPageAssignment,
} from "@/domains/profound-coverage/types";

// ---------------------------------------------------------------------------
// Tokenization helpers (pure, deterministic).
// ---------------------------------------------------------------------------

/** Generic filler phrases stripped before tokenizing (longest first). */
const FILLER_PHRASES = [
  "best websites for",
  "best website for",
  "where can i find",
  "what are good",
  "what are the best",
  "what are some",
  "what is the best",
  "how do i",
  "how can i",
  "can you recommend",
  "please recommend",
  "tell me about",
  "give me a list of",
  "list of",
  "i want to",
  "i need to",
  "looking for",
];

/** Single-token stopwords removed after phrase stripping. */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "in", "on", "at", "and", "or", "is",
  "are", "was", "were", "be", "with", "about", "what", "who", "which", "that",
  "this", "these", "those", "as", "by", "from", "into", "good", "best", "top",
  "recommend", "find", "some", "any", "do", "i", "you", "me", "my", "can",
  "how", "where", "when", "list", "websites", "website", "site", "sites",
]);

const stripWww = (h: string): string => h.replace(/^www\./i, "").toLowerCase();

/** Host of a URL (no scheme tolerated), lowercased + www-stripped, or "". */
function hostOf(url: string): string {
  try {
    return stripWww(new URL(url.includes("://") ? url : `https://${url}`).hostname);
  } catch {
    return "";
  }
}

/** Lowercase + strip punctuation to ascii-ish word tokens. */
function rawTokens(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ\s'-]/g, " ")
    .replace(/['-]+/g, "")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Content tokens: filler phrases + stopwords removed, deduped, order kept. */
function contentTokens(text: string): string[] {
  let s = ` ${(text || "").toLowerCase()} `;
  for (const phrase of FILLER_PHRASES) {
    s = s.split(` ${phrase} `).join(" ");
  }
  const toks = rawTokens(s).filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return [...new Set(toks)];
}

/** Slug tokens from a URL path (the last meaningful segment, hyphen-split). */
function slugTokens(url: string): string[] {
  try {
    const path = new URL(url.includes("://") ? url : `https://${url}`).pathname;
    const segs = path.split("/").map((s) => s.trim()).filter(Boolean);
    const last = segs[segs.length - 1] ?? "";
    return [...new Set(rawTokens(last.replace(/\.[a-z0-9]+$/i, "")).filter((t) => t.length > 1 && !STOPWORDS.has(t)))];
  } catch {
    return [];
  }
}

/** Jaccard-ish overlap of b's tokens covered, in [0,1] (recall of `target`). */
function coverage(target: string[], source: string[]): number {
  if (target.length === 0) return 0;
  const set = new Set(source);
  let hit = 0;
  for (const t of target) if (set.has(t)) hit += 1;
  return Math.round((hit / target.length) * 100) / 100;
}

/** Symmetric token overlap (intersection / union), in [0,1]. */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : Math.round((inter / union) * 100) / 100;
}

// ---------------------------------------------------------------------------
// normalizePrompt
// ---------------------------------------------------------------------------

/** Multiword entity candidates: title-cased or quoted phrases in the prompt. */
function extractEntities(prompt: string): string[] {
  const out = new Set<string>();
  const text = prompt || "";
  // Quoted phrases.
  for (const m of text.matchAll(/["']([^"']{2,})["']/g)) {
    const v = m[1]!.trim().toLowerCase();
    if (v) out.add(v);
  }
  // Runs of >=2 Capitalized words (proper nouns / named entities). Short
  // connective words ("the", "of", "and") inside a run are kept so multiword
  // entities like "Cyrus the Great" survive.
  for (const m of text.matchAll(/\b([A-Z][a-zA-Z]+(?:\s+(?:[A-Z][a-zA-Z]+|the|of|and|de|al))*\s+[A-Z][a-zA-Z]+)\b/g)) {
    const v = m[1]!.trim().toLowerCase();
    if (v) out.add(v);
  }
  return [...out];
}

const PERSON_HINT = /\b(who\s+(?:is|was|are)|biography|life of|born)\b/i;

/** Classify a prompt's intent by keyword heuristics (deterministic order). */
function classifyIntent(prompt: string, entities: string[]): PromptIntent {
  const p = ` ${(prompt || "").toLowerCase()} `;
  const has = (re: RegExp): boolean => re.test(p);

  if (has(/\b(buy|gift|gifts|price|prices|shop|shopping|purchase|order|store|for sale|cost of)\b/)) {
    return "product_commercial";
  }
  if (has(/\b(how to|how do|how can|step by step|guide to making|recipe for)\b/)) {
    return "how_to";
  }
  if (has(/\b(learn|phrases|translate|translation|farsi|persian language|speak persian|how to say|words for)\b/)) {
    return "language_translation";
  }
  if (has(/\b(history|ancient|origin|origins|invent|invented|empire|dynasty|historical)\b/)) {
    return "history";
  }
  if (has(/\b(visit|visiting|travel|cities|city|where to|places to|attractions|tourist|destinations|map of)\b/)) {
    return "travel_place";
  }
  if (has(/\b(culture|traditions|tradition|etiquette|customs|cultural|norms|holidays|festival|festivals)\b/)) {
    return "cultural_guide";
  }
  // Biography: a person-shaped prompt (named entity + who/bio hint).
  if (entities.length > 0 && PERSON_HINT.test(prompt || "")) {
    return "biography";
  }
  if (has(/\b(best|top|list of|examples of|types of|kinds of|popular)\b/)) {
    return "list";
  }
  if (has(/\b(what is|what was|what are|who is|who was|who are|define|meaning of|definition of)\b/)) {
    // "who is X" with an entity is a biography, already handled above.
    return "definition";
  }
  return "other";
}

/**
 * Normalize a prompt into content tokens, multiword entities, and an intent.
 * Pure: lowercases, strips punctuation, drops generic filler, preserves
 * multiword entities, and classifies intent by keyword heuristics.
 */
export function normalizePrompt(prompt: string): {
  tokens: string[];
  entities: string[];
  intent: PromptIntent;
} {
  const entities = extractEntities(prompt);
  return {
    tokens: contentTokens(prompt),
    entities,
    intent: classifyIntent(prompt, entities),
  };
}

// ---------------------------------------------------------------------------
// buildAeoPromptInputs
// ---------------------------------------------------------------------------

/**
 * Map upstream PromptOpportunity records into AeoPromptInput. Fills
 * answerSearchQueries from fan-outs (no separate source), rawAnswerThemes from
 * tags, and rawAnswerExample from the first raw example. Drops borrowed-account
 * noise prompts via isProfoundNoisePrompt.
 */
export function buildAeoPromptInputs(opportunities: PromptOpportunity[]): AeoPromptInput[] {
  const out: AeoPromptInput[] = [];
  for (const o of opportunities ?? []) {
    if (!o || !o.prompt || isProfoundNoisePrompt(o.prompt)) continue;
    out.push({
      promptId: o.promptId ?? null,
      prompt: o.prompt,
      topic: o.topic ?? null,
      tags: [...(o.tags ?? [])],
      models: [...(o.models ?? [])],
      executions: o.executions ?? 0,
      ownMentionCount: o.ownMentionCount ?? 0,
      ownCitationCount: o.ownCitationCount ?? 0,
      citationUrls: dedupeUrls((o.topCitedPages ?? []).map((p) => p.url).concat(o.ownCitedUrls ?? [])),
      topCitedPages: (o.topCitedPages ?? []).map((p) => ({
        url: p.url,
        hostname: p.hostname,
        answers: p.answers,
        isOwned: p.isOwned,
      })),
      topCitedDomains: (o.topCompetitorDomains ?? []).map((d) => ({ hostname: d.hostname, answers: d.answers })),
      fanoutQueries: [...(o.fanoutQueries ?? [])],
      answerSearchQueries: [...(o.fanoutQueries ?? [])],
      rawAnswerThemes: [...(o.tags ?? [])],
      rawAnswerExample: (o.rawAnswerExamples ?? [])[0] ?? null,
    });
  }
  return out;
}

function dedupeUrls(urls: string[]): string[] {
  return [...new Set((urls ?? []).map((u) => (u || "").trim()).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Ownership + competitor helpers
// ---------------------------------------------------------------------------

/**
 * Is this prompt already OWNED by the tenant? Ownership is decided ONLY by the
 * tenant's own brand mention or a cited page flagged isOwned upstream (which is
 * the tenant domain). A mention/citation of the borrowed tracked asset
 * (ChatGPT / openai.com) is NEVER ownership.
 */
function ownsPrompt(input: AeoPromptInput): boolean {
  if (input.ownMentionCount > 0 || input.ownCitationCount > 0) return true;
  return input.topCitedPages.some((p) => p.isOwned);
}

/** Competitor (non-owned) cited page URLs for this prompt, ranked, deduped. */
function competitorPages(input: AeoPromptInput): { url: string; hostname: string; answers: number }[] {
  return input.topCitedPages
    .filter((p) => !p.isOwned)
    .map((p) => ({ url: p.url, hostname: p.hostname, answers: p.answers }))
    .sort((a, b) => b.answers - a.answers || a.url.localeCompare(b.url));
}

/**
 * Are the competitor citations "content-like" and strong? Content-like = a real
 * page path (not a bare homepage) on a non-aggregator host; strong = at least
 * one such page cited by >= 2 answers OR >= 2 distinct content-like pages.
 */
const AGGREGATOR_HOSTS = new Set([
  "reddit.com", "youtube.com", "facebook.com", "instagram.com", "quora.com",
  "pinterest.com", "tiktok.com", "x.com", "twitter.com", "linkedin.com",
  "google.com", "bing.com", "yahoo.com",
]);

function isContentLikePage(url: string, hostname: string): boolean {
  if (AGGREGATOR_HOSTS.has(stripWww(hostname))) return false;
  try {
    const path = new URL(url.includes("://") ? url : `https://${url}`).pathname.replace(/\/+$/, "");
    return path.length > 1; // not a bare homepage
  } catch {
    return false;
  }
}

function competitorStrength(comp: { url: string; hostname: string; answers: number }[]): {
  contentLike: { url: string; hostname: string; answers: number }[];
  strong: boolean;
} {
  const contentLike = comp.filter((c) => isContentLikePage(c.url, c.hostname));
  const strong = contentLike.some((c) => c.answers >= 2) || contentLike.length >= 2;
  return { contentLike, strong };
}

// ---------------------------------------------------------------------------
// assignPromptToPage
// ---------------------------------------------------------------------------

type PageMatch = {
  page: OwnedPageCandidate;
  titleOverlap: number;
  h1Overlap: number;
  gscQueryOverlap: number;
  urlSlugOverlap: number;
  semanticTokenOverlap: number;
  /** Blended match strength used for ranking owned-page candidates. */
  score: number;
};

/** Score one owned page against the prompt's tokens. */
function scorePage(promptTokens: string[], promptText: string, page: OwnedPageCandidate): PageMatch {
  const titleToks = contentTokens(page.title ?? "");
  const h1Toks = contentTokens(page.h1 ?? "");
  const slugToks = slugTokens(page.url);
  const bodyToks = [...new Set([...titleToks, ...h1Toks, ...page.h2s.flatMap((h) => contentTokens(h)), ...contentTokens(page.metaDescription ?? "")])];

  const titleOverlap = coverage(promptTokens, titleToks);
  const h1Overlap = coverage(promptTokens, h1Toks);
  const urlSlugOverlap = coverage(promptTokens, slugToks);
  const semanticTokenOverlap = jaccard(promptTokens, bodyToks);

  // GSC overlap: does any GSC query for this page share the prompt's intent tokens?
  let gscQueryOverlap = 0;
  for (const q of page.gscQueries) {
    gscQueryOverlap = Math.max(gscQueryOverlap, coverage(promptTokens, contentTokens(q)));
  }

  // Blended owned-page match strength. Title + H1 + slug are structural signals;
  // GSC overlap proves the page already attracts the same demand.
  const score =
    titleOverlap * 0.32 +
    h1Overlap * 0.2 +
    urlSlugOverlap * 0.16 +
    semanticTokenOverlap * 0.12 +
    gscQueryOverlap * 0.2;

  return {
    page,
    titleOverlap,
    h1Overlap,
    gscQueryOverlap,
    urlSlugOverlap,
    semanticTokenOverlap,
    score: Math.round(score * 1000) / 1000,
  };
}

/** A page is a "real" match (not coincidental) at/above this blended score. */
const MATCH_THRESHOLD = 0.34;
/** Two owned pages both at/above this both genuinely cover the prompt. */
const DUAL_MATCH_THRESHOLD = 0.3;

/**
 * Assign a single prompt to a page action, deterministically, using token /
 * entity / slug / GSC-query / fan-out / competitor overlap (NO embeddings).
 *
 * Rules (in priority order):
 *  - noise / eval / meta prompt -> ignore_noise
 *  - product/commercial on an encyclopedia with no owned page -> ignore_noise
 *    (needsSerpValidation surfaced on the action pack)
 *  - two owned pages genuinely match -> internal_link_fix
 *  - one strong owned match -> existing_page
 *  - no owned match + competitors cited + topic clusters (>= 4) -> hub_page
 *  - no owned match + competitors cited -> new_page
 *  - no owned match + no competitor -> ignore_noise (nothing actionable)
 */
export function assignPromptToPage(
  input: AeoPromptInput,
  ownedPages: OwnedPageCandidate[],
  clusterCount: number,
): PromptPageAssignment {
  const { tokens, intent } = normalizePrompt(input.prompt);
  const comp = competitorPages(input);
  const { contentLike, strong: competitorsStrong } = competitorStrength(comp);
  const owns = ownsPrompt(input);

  const fanouts = [...new Set(input.fanoutQueries.map((f) => f.trim()).filter(Boolean))];
  const competitorPageUrls = comp.map((c) => c.url);

  // Fan-out overlap: share of fan-outs whose tokens are covered by the prompt
  // tokens (a proxy for "the prompt is the natural parent of these fan-outs").
  const fanoutOverlap = fanouts.length
    ? Math.round((fanouts.filter((f) => coverage(contentTokens(f), tokens) >= 0.5).length / fanouts.length) * 100) / 100
    : 0;

  // Competitor overlap: share of competitor pages that are content-like (the
  // displaceable surface area).
  const citationCompetitorOverlap = comp.length
    ? Math.round((contentLike.length / comp.length) * 100) / 100
    : 0;

  const baseSignals = (m: PageMatch | null): PromptPageAssignment["matchedSignals"] => ({
    titleOverlap: m?.titleOverlap ?? 0,
    h1Overlap: m?.h1Overlap ?? 0,
    gscQueryOverlap: m?.gscQueryOverlap ?? 0,
    urlSlugOverlap: m?.urlSlugOverlap ?? 0,
    fanoutOverlap,
    citationCompetitorOverlap,
    semanticTokenOverlap: m?.semanticTokenOverlap ?? 0,
  });

  const proofKpis = (page: OwnedPageCandidate | null): string[] => {
    if (!page) {
      return ["AI mentions of this prompt", "new-page impressions (GSC)", "first cited answer"];
    }
    const kpis = ["AI citation share for this prompt"];
    if (page.impressions90d > 0) kpis.push(`GSC clicks (now ${page.clicks90d}/90d)`, `avg position (now ${page.position90d ?? "n/a"})`);
    if (page.ga4Value > 0) kpis.push(`GA4 value (now ${Math.round(page.ga4Value)})`);
    if (page.clarityFriction > 0) kpis.push("Clarity friction down");
    return kpis;
  };

  // 1) Noise / eval / meta prompt.
  if (isProfoundNoisePrompt(input.prompt)) {
    return {
      promptId: input.promptId,
      prompt: input.prompt,
      assignment: "ignore_noise",
      targetUrl: null,
      confidence: "high",
      why: "Borrowed-account evaluation/meta prompt - not a real Iranopedia question.",
      intent,
      matchedSignals: baseSignals(null),
      missingCoverage: noCoverage(),
      topCompetitorPages: [],
      fanoutsToAnswer: [],
      proofKpis: [],
    };
  }

  // Score every owned page; keep the strongest matches.
  const matches = ownedPages
    .map((p) => scorePage(tokens, input.prompt, p))
    .sort((a, b) => b.score - a.score || a.page.url.localeCompare(b.page.url));
  const best = matches[0] ?? null;
  const second = matches[1] ?? null;

  // 2) Two owned pages genuinely cover the SAME prompt -> internal_link_fix.
  if (
    best && second &&
    best.score >= DUAL_MATCH_THRESHOLD &&
    second.score >= DUAL_MATCH_THRESHOLD
  ) {
    // Prefer the page with real GSC demand as the canonical target.
    const canonical = [best, second].sort(
      (a, b) => b.page.clicks90d - a.page.clicks90d || b.score - a.score || a.page.url.localeCompare(b.page.url),
    )[0]!;
    return {
      promptId: input.promptId,
      prompt: input.prompt,
      assignment: "internal_link_fix",
      targetUrl: canonical.page.url,
      confidence: best.score >= MATCH_THRESHOLD && second.score >= MATCH_THRESHOLD ? "high" : "medium",
      why:
        `Two owned pages both cover "${input.prompt}" (${best.page.url} and ${second.page.url}). ` +
        `Consolidate signals onto ${canonical.page.url} and cross-link to stop competing.`,
      intent,
      matchedSignals: baseSignals(canonical),
      missingCoverage: { ...noCoverage(), internalLinksMissing: true },
      topCompetitorPages: competitorPageUrls,
      fanoutsToAnswer: fanouts,
      proofKpis: proofKpis(canonical.page),
    };
  }

  // 3) One strong owned match -> existing_page.
  if (best && best.score >= MATCH_THRESHOLD) {
    const page = best.page;
    const directAnswerMissing = !owns; // owned page exists but AI does not cite us yet
    const depthMissing = page.wordCount < 600;
    const schemaMissing = !pageHasUsefulSchema(page, intent);
    return {
      promptId: input.promptId,
      prompt: input.prompt,
      assignment: "existing_page",
      targetUrl: page.url,
      confidence: best.gscQueryOverlap >= 0.5 || best.score >= 0.55 ? "high" : "medium",
      why:
        `Owned page ${page.url} already covers this` +
        (best.gscQueryOverlap > 0 ? ` (ranks for related GSC queries)` : ``) +
        `; ` + (directAnswerMissing ? "add an extractable answer so AI cites it." : "strengthen it to win more answers."),
      intent,
      matchedSignals: baseSignals(best),
      missingCoverage: {
        directAnswerMissing,
        fanoutsMissing: fanouts.length > 0,
        citedSourcesMissing: contentLike.length > 0,
        schemaMissing,
        depthMissing,
        internalLinksMissing: false,
      },
      topCompetitorPages: competitorPageUrls,
      fanoutsToAnswer: fanouts,
      proofKpis: proofKpis(page),
    };
  }

  // No owned page covers it from here on.

  // 4) Product / commercial on an encyclopedia with no owned page -> ignore as
  //    likely off-topic UGC/commercial. Surface SERP need on the action pack.
  if (intent === "product_commercial") {
    return {
      promptId: input.promptId,
      prompt: input.prompt,
      assignment: "ignore_noise",
      targetUrl: null,
      confidence: "low",
      why: "Commercial/transactional intent with no owned page - off-topic for an encyclopedia unless SERP shows informational content wins.",
      intent,
      matchedSignals: baseSignals(best && best.score > 0 ? best : null),
      missingCoverage: noCoverage(),
      topCompetitorPages: competitorPageUrls,
      fanoutsToAnswer: fanouts,
      proofKpis: [],
    };
  }

  // 5) No owned match + competitors cited.
  if (competitorsStrong) {
    // Hub when many sibling prompts share this topic AND no single owner exists.
    if (clusterCount >= 4) {
      return {
        promptId: input.promptId,
        prompt: input.prompt,
        assignment: "hub_page",
        targetUrl: null,
        confidence: clusterCount >= 6 ? "high" : "medium",
        why:
          `${clusterCount} related prompts cluster on "${input.topic ?? "this topic"}" with no owned owner - ` +
          `build a hub that answers the cluster and links to detail pages.`,
        intent,
        matchedSignals: baseSignals(null),
        missingCoverage: { ...allMissing(), depthMissing: true },
        topCompetitorPages: competitorPageUrls,
        fanoutsToAnswer: fanouts,
        proofKpis: proofKpis(null),
      };
    }
    return {
      promptId: input.promptId,
      prompt: input.prompt,
      assignment: "new_page",
      targetUrl: null,
      confidence: contentLike.some((c) => c.answers >= 2) ? "high" : "medium",
      why:
        `No owned page covers this and AI cites competitors (${contentLike.slice(0, 2).map((c) => c.hostname).join(", ")}) - ` +
        `create the canonical Iranopedia page.`,
      intent,
      matchedSignals: baseSignals(null),
      missingCoverage: allMissing(),
      topCompetitorPages: competitorPageUrls,
      fanoutsToAnswer: fanouts,
      proofKpis: proofKpis(null),
    };
  }

  // 6) No owned match + no displaceable competitor -> nothing actionable yet.
  return {
    promptId: input.promptId,
    prompt: input.prompt,
    assignment: "ignore_noise",
    targetUrl: null,
    confidence: "low",
    why: "No owned page and no content-like competitor cited - not enough signal to act (watch only).",
    intent,
    matchedSignals: baseSignals(best && best.score > 0 ? best : null),
    missingCoverage: noCoverage(),
    topCompetitorPages: competitorPageUrls,
    fanoutsToAnswer: fanouts,
    proofKpis: [],
  };
}

function noCoverage(): PromptPageAssignment["missingCoverage"] {
  return {
    directAnswerMissing: false,
    fanoutsMissing: false,
    citedSourcesMissing: false,
    schemaMissing: false,
    depthMissing: false,
    internalLinksMissing: false,
  };
}

function allMissing(): PromptPageAssignment["missingCoverage"] {
  return {
    directAnswerMissing: true,
    fanoutsMissing: true,
    citedSourcesMissing: true,
    schemaMissing: true,
    depthMissing: true,
    internalLinksMissing: false,
  };
}

/** Does the page already carry schema useful for this intent? */
function pageHasUsefulSchema(page: OwnedPageCandidate, intent: PromptIntent): boolean {
  const types = new Set(page.existingSchemaTypes.map((t) => t.toLowerCase()));
  if (types.has("faqpage")) return intent === "definition" || intent === "cultural_guide" || intent === "how_to";
  if (types.has("itemlist") && intent === "list") return true;
  if (types.has("article")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// compileCoverage
// ---------------------------------------------------------------------------

export type CompileCoverageOptions = {
  /**
   * Cached SERP verdicts keyed by prompt text (lowercased). "content" means the
   * SERP is informational (an encyclopedia can win) -> a commercial prompt may
   * be reconsidered; "commercial" confirms the ignore. Absent -> needsSerpValidation.
   */
  serpVerdicts?: Record<string, "content" | "commercial">;
};

export type CompileCoverageResult = {
  assignments: PromptPageAssignment[];
  actionPacks: AeoActionPack[];
  summary: {
    totalPrompts: number;
    existingPage: number;
    newPage: number;
    hubPage: number;
    internalLinkFix: number;
    ignoredNoise: number;
  };
};

/**
 * Compile all opportunities into deduped assignments + ranked action packs.
 *
 * Steps:
 *  1. Build AeoPromptInput (drops noise), collapse duplicate/near-identical prompts.
 *  2. Count topic clusters so a crowded topic with no owner can become a hub.
 *  3. Assign each unique prompt to a page action.
 *  4. Derive an AeoActionPack per actionable assignment + a priorityScore that
 *     blends demand (executions), attention (fan-outs), citation concentration,
 *     GSC demand + GA4 value (when an existing page matches), and Clarity
 *     friction as urgency.
 *
 * Trust rule: a pure-Profound gap (new_page/hub) cannot outrank a GSC-backed
 * existing-page move unless many prompts/fan-outs agree AND competitor citations
 * are strong + content-like. Enforced in priorityScore.
 */
export function compileCoverage(
  opportunities: PromptOpportunity[],
  ownedPages: OwnedPageCandidate[],
  opts: CompileCoverageOptions = {},
): CompileCoverageResult {
  const inputs = buildAeoPromptInputs(opportunities);

  // 1) Collapse duplicate / near-identical prompts (same content-token signature).
  const merged = dedupePrompts(inputs);

  // 2) Topic cluster counts: how many distinct prompts share a topic with no
  //    obvious single owner (used to promote hubs).
  const clusterByTopic = new Map<string, number>();
  for (const inp of merged) {
    const key = topicKey(inp);
    clusterByTopic.set(key, (clusterByTopic.get(key) ?? 0) + 1);
  }

  // 3) Assign each unique prompt.
  const assignments = merged.map((inp) =>
    assignPromptToPage(inp, ownedPages, clusterByTopic.get(topicKey(inp)) ?? 1),
  );

  // 4) Derive action packs (skip pure ignores). Reconsider commercial ignores
  //    when a cached SERP verdict says the intent is content.
  const inputByKey = new Map<string, AeoPromptInput>();
  for (const inp of merged) inputByKey.set(promptKey(inp), inp);

  const pageByUrl = new Map<string, OwnedPageCandidate>();
  for (const p of ownedPages) pageByUrl.set(p.url, p);

  const actionPacks: AeoActionPack[] = [];
  for (const a of assignments) {
    const inp = inputByKey.get(promptKey({ prompt: a.prompt } as AeoPromptInput));
    if (!inp) continue;

    const serp = opts.serpVerdicts?.[a.prompt.trim().toLowerCase()];
    const pack = deriveActionPack(a, inp, pageByUrl, serp);
    if (pack) actionPacks.push(pack);
  }

  actionPacks.sort((x, y) => y.priorityScore - x.priorityScore || x.prompt.localeCompare(y.prompt));

  const summary = {
    totalPrompts: assignments.length,
    existingPage: assignments.filter((a) => a.assignment === "existing_page").length,
    newPage: assignments.filter((a) => a.assignment === "new_page").length,
    hubPage: assignments.filter((a) => a.assignment === "hub_page").length,
    internalLinkFix: assignments.filter((a) => a.assignment === "internal_link_fix").length,
    ignoredNoise: assignments.filter((a) => a.assignment === "ignore_noise").length,
  };

  return { assignments, actionPacks, summary };
}

/** Content-token signature for dedupe (sorted tokens joined). */
function promptKey(input: AeoPromptInput): string {
  return contentTokens(input.prompt).slice().sort().join(" ");
}

function topicKey(input: AeoPromptInput): string {
  return (input.topic ?? "").trim().toLowerCase() || "__none__";
}

/**
 * Collapse duplicate / near-identical prompts. Two prompts with the same content
 * signature, OR a Jaccard token overlap >= 0.85, are merged: executions and
 * citations sum, fan-outs/competitors union, and the highest-execution variant's
 * text is kept as canonical.
 */
function dedupePrompts(inputs: AeoPromptInput[]): AeoPromptInput[] {
  const groups: AeoPromptInput[][] = [];
  const sigTokens: string[][] = [];

  for (const inp of inputs) {
    const toks = contentTokens(inp.prompt);
    let placed = false;
    for (let i = 0; i < groups.length; i++) {
      const exactSame = sigTokens[i]!.slice().sort().join(" ") === toks.slice().sort().join(" ");
      if (exactSame || jaccard(sigTokens[i]!, toks) >= 0.85) {
        groups[i]!.push(inp);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push([inp]);
      sigTokens.push(toks);
    }
  }

  return groups.map((g) => mergeGroup(g));
}

function mergeGroup(group: AeoPromptInput[]): AeoPromptInput {
  if (group.length === 1) return group[0]!;
  // Canonical = highest executions, then longest prompt for stability.
  const canonical = group.slice().sort(
    (a, b) => b.executions - a.executions || b.prompt.length - a.prompt.length || a.prompt.localeCompare(b.prompt),
  )[0]!;

  const fanouts = new Set<string>();
  const answerQueries = new Set<string>();
  const themes = new Set<string>();
  const tags = new Set<string>();
  const models = new Set<string>();
  const pagesByUrl = new Map<string, { url: string; hostname: string; answers: number; isOwned: boolean }>();
  const domainAnswers = new Map<string, { hostname: string; answers: number }>();
  const citationUrls = new Set<string>();

  let executions = 0;
  let ownMentionCount = 0;
  let ownCitationCount = 0;

  for (const g of group) {
    executions += g.executions;
    ownMentionCount += g.ownMentionCount;
    ownCitationCount += g.ownCitationCount;
    for (const f of g.fanoutQueries) fanouts.add(f);
    for (const q of g.answerSearchQueries) answerQueries.add(q);
    for (const t of g.rawAnswerThemes) themes.add(t);
    for (const t of g.tags) tags.add(t);
    for (const m of g.models) models.add(m);
    for (const u of g.citationUrls) citationUrls.add(u);
    for (const p of g.topCitedPages) {
      const prev = pagesByUrl.get(p.url);
      pagesByUrl.set(p.url, prev ? { ...prev, answers: prev.answers + p.answers } : { ...p });
    }
    for (const d of g.topCitedDomains) {
      const prev = domainAnswers.get(d.hostname);
      domainAnswers.set(d.hostname, prev ? { ...prev, answers: prev.answers + d.answers } : { ...d });
    }
  }

  return {
    ...canonical,
    executions,
    ownMentionCount,
    ownCitationCount,
    models: [...models].sort(),
    tags: [...tags].sort(),
    rawAnswerThemes: [...themes].sort(),
    fanoutQueries: [...fanouts],
    answerSearchQueries: [...answerQueries],
    citationUrls: [...citationUrls],
    topCitedPages: [...pagesByUrl.values()].sort((a, b) => b.answers - a.answers || a.url.localeCompare(b.url)),
    topCitedDomains: [...domainAnswers.values()].sort((a, b) => b.answers - a.answers || a.hostname.localeCompare(b.hostname)),
  };
}

// ---------------------------------------------------------------------------
// Action pack derivation + ranking
// ---------------------------------------------------------------------------

const ACTION_BY_ASSIGNMENT: Record<PromptPageAssignment["assignment"], AeoActionPack["action"]> = {
  existing_page: "add_answer_block",
  new_page: "create_new_page",
  hub_page: "create_hub",
  internal_link_fix: "add_internal_links",
  ignore_noise: "ignore",
};

function deriveActionPack(
  a: PromptPageAssignment,
  inp: AeoPromptInput,
  pageByUrl: Map<string, OwnedPageCandidate>,
  serp: "content" | "commercial" | undefined,
): AeoActionPack | null {
  // Commercial ignore reconsidered when SERP says the intent is content.
  let assignment = a.assignment;
  if (assignment === "ignore_noise" && a.intent === "product_commercial" && serp === "content") {
    // Treat as a new page if competitors are cited, else still skip.
    if (a.topCompetitorPages.length > 0) assignment = "new_page";
  }
  if (assignment === "ignore_noise") return null;

  const page = a.targetUrl ? pageByUrl.get(a.targetUrl) ?? null : null;
  let action = ACTION_BY_ASSIGNMENT[assignment];

  // existing_page nuance: thin page -> expand; two owned -> consolidate signal.
  if (assignment === "existing_page" && page) {
    if (page.wordCount < 400) action = "expand_existing_page";
    else action = "add_answer_block";
  }
  if (assignment === "internal_link_fix") {
    // If both pages are thin/overlapping heavily, consolidation is the move.
    action = "add_internal_links";
  }

  const fanouts = a.fanoutsToAnswer;
  const { intent } = a;
  const competitorContentLike = competitorPages(inp).filter((c) => isContentLikePage(c.url, c.hostname));

  const priorityScore = scorePriority(assignment, a, inp, page, competitorContentLike);

  const needsSerp =
    (a.intent === "product_commercial" && serp === undefined) ||
    (assignment === "new_page" && competitorContentLike.length < 2 && serp === undefined);

  const slug = action === "create_new_page" || action === "create_hub"
    ? slugify(inp.prompt, intent)
    : null;

  return {
    action,
    priorityScore,
    targetUrl: a.targetUrl,
    newPageSlug: action === "create_new_page" || action === "create_hub" ? slug : null,
    title: titleFor(action, inp.prompt, intent, page),
    h1: h1For(action, inp.prompt, intent, page),
    directAnswerBrief: directAnswerBrief(inp, intent),
    sectionsToAdd: sectionsFor(intent, fanouts),
    faqQuestions: faqFrom(fanouts),
    schemaRecommendation: schemaFor(intent, action),
    sourceReferences: dedupeUrls(competitorPages(inp).map((c) => c.url)).slice(0, 8),
    competitorPagesToBeat: a.topCompetitorPages.slice(0, 8),
    internalLinks: action === "add_internal_links" ? buildInternalLinks(a, page) : [],
    measurementPlan: a.proofKpis,
    evidence: buildEvidence(assignment, a, inp, page, competitorContentLike),
    needsSerpValidation: needsSerp,
    promptId: a.promptId,
    prompt: a.prompt,
  };
}

/**
 * Priority. GSC-backed existing-page moves get a demand floor from real traffic;
 * pure-Profound gaps (new_page/hub) are capped UNLESS many prompts/fan-outs
 * agree AND competitor citations are strong + content-like.
 */
function scorePriority(
  assignment: PromptPageAssignment["assignment"],
  a: PromptPageAssignment,
  inp: AeoPromptInput,
  page: OwnedPageCandidate | null,
  competitorContentLike: { url: string; hostname: string; answers: number }[],
): number {
  // Profound attention components (the only signal pure gaps have).
  const executions = Math.max(0, inp.executions);
  const fanoutCount = Math.min(inp.fanoutQueries.length, 12);
  const citationConcentration = competitorContentLike.reduce((m, c) => Math.max(m, c.answers), 0);
  const modelBreadth = Math.min(inp.models.length, 5);

  // Profound-only score: capped so a single weak gap (1 answer, no fan-outs,
  // weak citations) stays low, while a corroborated gap (many fan-outs +
  // multi-model + concentrated content citations) can clear the trust cap.
  let profound =
    executions * 4 +
    fanoutCount * 4 +
    citationConcentration * 4 +
    modelBreadth * 3;

  if (assignment === "existing_page" || assignment === "internal_link_fix") {
    // GSC/GA4 demand floor: real traffic dominates. This guarantees a GSC-backed
    // existing-page move sits above a comparable pure-Profound gap.
    const gsc = page
      ? Math.log10(1 + page.clicks90d) * 40 +
        Math.log10(1 + page.impressions90d) * 12 +
        Math.log10(1 + Math.max(0, page.ga4Value)) * 18 +
        Math.min(page.clarityFriction, 100) * 0.4 // friction = urgency
      : 0;
    return Math.round((gsc + profound) * 10) / 10;
  }

  // Pure-Profound gaps (new_page / hub_page): apply the trust cap.
  const manyAgree = inp.fanoutQueries.length >= 3 || (inp.executions >= 3 && inp.models.length >= 2);
  const strongContentCitations = competitorContentLike.some((c) => c.answers >= 2) || competitorContentLike.length >= 2;

  if (!(manyAgree && strongContentCitations)) {
    // Not enough corroboration: hard-cap below the lowest plausible GSC-backed move
    // so a weak gap can never leapfrog a page with real traffic.
    profound = Math.min(profound, 35);
  }

  // Hubs get a small multiplier for consolidating a whole cluster.
  if (assignment === "hub_page") profound *= 1.15;

  return Math.round(profound * 10) / 10;
}

function buildInternalLinks(a: PromptPageAssignment, page: OwnedPageCandidate | null): string[] {
  const links: string[] = [];
  if (page?.url) links.push(page.url);
  return [...new Set(links)];
}

function slugify(prompt: string, intent: PromptIntent): string {
  const toks = contentTokens(prompt).slice(0, 6);
  const base = toks.join("-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const prefix =
    intent === "list" ? "best-" :
    intent === "how_to" ? "how-to-" :
    intent === "travel_place" ? "guide-" :
    "";
  const slug = `${prefix}${base}`.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return slug || "new-page";
}

function titleFor(action: AeoActionPack["action"], prompt: string, intent: PromptIntent, page: OwnedPageCandidate | null): string | null {
  if (action === "add_internal_links") return page?.title ?? null;
  if (action === "add_answer_block" || action === "expand_existing_page") return page?.title ?? capitalize(prompt);
  const q = capitalize(prompt.replace(/[?]+$/, "").trim());
  if (action === "create_hub") return `${q} - Complete Guide`;
  return q;
}

function h1For(action: AeoActionPack["action"], prompt: string, intent: PromptIntent, page: OwnedPageCandidate | null): string | null {
  if (action === "add_internal_links") return page?.h1 ?? null;
  if (action === "add_answer_block" || action === "expand_existing_page") return page?.h1 ?? page?.title ?? capitalize(prompt);
  return capitalize(prompt.replace(/[?]+$/, "").trim());
}

function directAnswerBrief(inp: AeoPromptInput, intent: PromptIntent): string {
  const subject = capitalize(contentTokens(inp.prompt).slice(0, 5).join(" ")) || capitalize(inp.prompt);
  switch (intent) {
    case "definition":
      return `Open with a 1-2 sentence extractable definition answering "${inp.prompt}".`;
    case "list":
      return `Lead with a concise ranked list answering "${inp.prompt}", each item one line.`;
    case "biography":
      return `Open with who they are and why they matter, then key facts answering "${inp.prompt}".`;
    case "how_to":
      return `Lead with numbered steps answering "${inp.prompt}".`;
    case "travel_place":
      return `Open with the direct travel answer to "${inp.prompt}" (where/when/how).`;
    case "language_translation":
      return `Lead with the term/phrase, its Persian script, transliteration, and meaning for "${inp.prompt}".`;
    case "history":
      return `Open with the dated, sourced historical answer to "${inp.prompt}".`;
    default:
      return `Open with a direct, extractable answer to "${inp.prompt}" about ${subject}.`;
  }
}

function sectionsFor(intent: PromptIntent, fanouts: string[]): string[] {
  const base: string[] = [];
  switch (intent) {
    case "definition":
      base.push("Quick definition", "In depth", "Common questions");
      break;
    case "list":
      base.push("The list (ranked)", "How we chose", "Honorable mentions");
      break;
    case "biography":
      base.push("Overview", "Early life", "Career / contributions", "Legacy");
      break;
    case "how_to":
      base.push("Steps", "Tips", "Common mistakes");
      break;
    case "travel_place":
      base.push("Overview", "Top spots", "Getting there", "Best time to visit");
      break;
    case "language_translation":
      base.push("Key phrases", "Pronunciation", "Usage notes");
      break;
    case "history":
      base.push("Timeline", "Key events", "Significance");
      break;
    default:
      base.push("Overview", "Details", "FAQ");
  }
  // Promote fan-outs into dedicated sections (deduped against base).
  const lower = new Set(base.map((b) => b.toLowerCase()));
  for (const f of fanouts.slice(0, 6)) {
    const s = capitalize(f.replace(/[?]+$/, "").trim());
    if (s && !lower.has(s.toLowerCase())) {
      base.push(s);
      lower.add(s.toLowerCase());
    }
  }
  return base;
}

function faqFrom(fanouts: string[]): string[] {
  return [...new Set(
    fanouts
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => (/[?]\s*$/.test(f) ? f : `${capitalize(f)}?`)),
  )].slice(0, 8);
}

function schemaFor(intent: PromptIntent, action: AeoActionPack["action"]): AeoActionPack["schemaRecommendation"] {
  if (action === "add_internal_links") return "None";
  if (intent === "list") return "ItemList";
  if (intent === "definition" || intent === "cultural_guide" || intent === "how_to") return "FAQPage";
  return "Article";
}

function buildEvidence(
  assignment: PromptPageAssignment["assignment"],
  a: PromptPageAssignment,
  inp: AeoPromptInput,
  page: OwnedPageCandidate | null,
  competitorContentLike: { url: string; hostname: string; answers: number }[],
): string {
  const parts: string[] = [];
  parts.push(`${inp.executions} AI answer(s) across ${inp.models.length} model(s)`);
  parts.push(`${inp.fanoutQueries.length} fan-out(s)`);
  if (competitorContentLike.length) {
    parts.push(`competitors cited: ${competitorContentLike.slice(0, 3).map((c) => c.hostname).join(", ")}`);
  } else {
    parts.push("no content-like competitor cited");
  }
  if (page) {
    parts.push(`owned page ${page.url}: ${page.clicks90d} clicks / ${page.impressions90d} impr (90d)`);
    if (page.ga4Value > 0) parts.push(`GA4 value ${Math.round(page.ga4Value)}`);
    if (page.clarityFriction > 0) parts.push(`Clarity friction ${page.clarityFriction}`);
  }
  parts.push(`assignment=${assignment}`);
  return parts.join("; ");
}

function capitalize(s: string): string {
  const t = (s || "").trim();
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}
