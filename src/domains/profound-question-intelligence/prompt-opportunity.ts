/**
 * Profound Question Intelligence — PromptOpportunity builder (2026-06-26, PURE).
 *
 * The AEO core: turn raw Profound answers + query-fanouts (scoped to the tenant's
 * topic) into ONE opportunity per tracked AI prompt:
 *   "AI gets asked THIS, it expands into THESE fan-out queries, it cites THESE
 *    pages, and you (iranopedia.com) are/aren't among them — so do X."
 *
 * PURE / deterministic / no I/O / no hardcoding (domain + aliases + noise filter
 * are explicit args). Ownership is decided by the tenant's real DOMAIN being
 * cited (or brand named in mentions[]) — NEVER the borrowed account's tracked
 * brand (ChatGPT/openai.com). Verified against the live Iranopedia topic
 * 2026-06-26: 200 real prompts → 152 gaps.
 */

import type { ProfoundAnswerRow } from "@/lib/connectors/profound/client";

/** One fan-out row: a tracked prompt expands into a downstream search query. */
export type FanoutRow = { prompt: string; query: string; model: string | null };

/** A page AI cites for a prompt (full URL + host + how many answers cited it). */
export type CitedPage = { url: string; hostname: string; answers: number; isOwned: boolean };

export type PromptRecommendedMove =
  | "answer_block" // AI answers, competitors cited, you absent → add an extractable answer
  | "expand_page" // you're cited but weakly → strengthen the page that's already winning some
  | "create_page" // strong demand, you absent, no obvious owned page (set by the fusion layer)
  | "source_gap"; // AI answers but cites NOTHING → be the canonical source

export type PromptOpportunity = {
  /** Verbatim AI question. */
  prompt: string;
  /** Stable id when the answers carry one (often null → grouped by text). */
  promptId: string | null;
  /** Topic label the prompt belongs to. */
  topic: string | null;
  /** Distinct AI answers observed (across models) — the demand denominator. */
  executions: number;
  /** AI models that answered it (breadth of attention). */
  models: string[];
  /** Answers whose mentions[] named the owned brand. */
  ownMentionCount: number;
  /** Answers that cited the owned domain. */
  ownCitationCount: number;
  /** The owned URLs AI cited for this prompt (deduped). */
  ownCitedUrls: string[];
  /** Top cited PAGES for this prompt (owned + competitor, ranked, capped 5). */
  topCitedPages: CitedPage[];
  /** Competitor domains cited (non-owned, non-aggregator), ranked. */
  topCompetitorDomains: { hostname: string; answers: number }[];
  /** Downstream fan-out search queries this prompt expands into. */
  fanoutQueries: string[];
  /** A few example answer snippets (for operator context / LLM grounding). */
  rawAnswerExamples: string[];
  /** Profound theme tags seen on the answers. */
  tags: string[];
  /** 0..1 — share of answers that DIDN'T mention you (higher = bigger gap). */
  visibilityGap: number;
  /** 0..1 — share of answers that DIDN'T cite your domain. */
  citationGap: number;
  /** Attention weight: answers × distinct models × (1 + fanouts). Sort desc. */
  promptAttentionScore: number;
  /** Deterministic play. */
  recommendedMove: PromptRecommendedMove;
  /** Human-readable evidence string (operator trust). */
  evidence: string;
};

export type BuildPromptOpportunityArgs = {
  answers: ReadonlyArray<ProfoundAnswerRow>;
  fanouts?: ReadonlyArray<FanoutRow>;
  ownedDomain: string;
  ownedMentionAliases: ReadonlyArray<string>;
  /** Aggregator/social hosts that are NOT displaceable competitors. */
  directoryDomains?: ReadonlyArray<string>;
  /** Predicate to drop noise prompts (e.g. hackathon eval prompts). */
  isNoisePrompt?: (prompt: string) => boolean;
};

const DEFAULT_DIRECTORY = [
  "reddit.com", "youtube.com", "facebook.com", "instagram.com", "quora.com",
  "pinterest.com", "tiktok.com", "x.com", "twitter.com", "linkedin.com",
  "google.com", "bing.com", "yahoo.com",
];

const stripWww = (h: string) => h.replace(/^www\./i, "").toLowerCase();
function hostOf(url: string): string {
  try {
    return stripWww(new URL(url.includes("://") ? url : `https://${url}`).hostname);
  } catch {
    return "";
  }
}
function isOwnedHost(host: string, ownedNorm: string): boolean {
  const h = stripWww(host);
  return !!ownedNorm && (h === ownedNorm || h.endsWith("." + ownedNorm));
}
function brandMentioned(mentions: ReadonlyArray<string>, aliases: ReadonlyArray<string>): boolean {
  const norm = aliases.map((a) => a.trim().toLowerCase()).filter(Boolean);
  return mentions.some((m) => norm.includes(m.trim().toLowerCase()));
}

export function buildPromptOpportunities(args: BuildPromptOpportunityArgs): PromptOpportunity[] {
  const ownedNorm = stripWww((args.ownedDomain || "").trim());
  const directory = new Set((args.directoryDomains ?? DEFAULT_DIRECTORY).map(stripWww));
  const isNoise = args.isNoisePrompt ?? (() => false);

  // Fan-out queries grouped by prompt text (case-insensitive).
  const fanoutByPrompt = new Map<string, Set<string>>();
  for (const f of args.fanouts ?? []) {
    const key = (f.prompt ?? "").trim().toLowerCase();
    const q = (f.query ?? "").trim();
    if (!key || !q) continue;
    if (!fanoutByPrompt.has(key)) fanoutByPrompt.set(key, new Set());
    fanoutByPrompt.get(key)!.add(q);
  }

  type Acc = {
    prompt: string;
    promptId: string | null;
    topic: string | null;
    total: number;
    ownMentioned: number;
    ownCited: number;
    models: Set<string>;
    themes: Set<string>;
    ownCitedUrls: Set<string>;
    /** url → distinct answers citing it. */
    pageAnswers: Map<string, number>;
    /** url → host (cache). */
    pageHost: Map<string, string>;
    examples: string[];
  };
  const byPrompt = new Map<string, Acc>();

  for (const a of args.answers) {
    const prompt = (a.prompt ?? "").trim();
    if (!prompt || isNoise(prompt)) continue;
    const key = (a.promptId ?? "").trim() || `text:${prompt.toLowerCase()}`;
    let acc = byPrompt.get(key);
    if (!acc) {
      acc = {
        prompt, promptId: a.promptId ?? null, topic: (a.topic ?? "").trim() || null,
        total: 0, ownMentioned: 0, ownCited: 0, models: new Set(), themes: new Set(),
        ownCitedUrls: new Set(), pageAnswers: new Map(), pageHost: new Map(), examples: [],
      };
      byPrompt.set(key, acc);
    }
    acc.total += 1;
    if (a.model) acc.models.add(a.model);
    for (const t of a.themes ?? []) acc.themes.add(t);
    if (brandMentioned(a.mentions, args.ownedMentionAliases)) acc.ownMentioned += 1;
    if (acc.examples.length < 3 && a.response) acc.examples.push(a.response.slice(0, 280));

    // Distinct cited URLs in THIS answer (one answer counts a page once).
    const urls = new Set((a.citationUrls ?? []).map((u) => u.trim()).filter(Boolean));
    let ownedHere = false;
    for (const url of urls) {
      const host = hostOf(url);
      if (!host) continue;
      if (isOwnedHost(host, ownedNorm)) {
        ownedHere = true;
        acc.ownCitedUrls.add(url);
      } else if (directory.has(host)) {
        continue; // aggregator — not a displaceable page
      }
      acc.pageAnswers.set(url, (acc.pageAnswers.get(url) ?? 0) + 1);
      acc.pageHost.set(url, host);
    }
    if (ownedHere) acc.ownCited += 1;
  }

  const out: PromptOpportunity[] = [];
  for (const acc of byPrompt.values()) {
    const topCitedPages: CitedPage[] = [...acc.pageAnswers.entries()]
      .map(([url, answers]) => ({ url, hostname: acc.pageHost.get(url) ?? hostOf(url), answers, isOwned: isOwnedHost(acc.pageHost.get(url) ?? "", ownedNorm) }))
      .sort((x, y) => y.answers - x.answers || x.hostname.localeCompare(y.hostname))
      .slice(0, 5);

    // Competitor domains: collapse non-owned pages to host, rank by answers.
    const compByHost = new Map<string, number>();
    for (const [url, answers] of acc.pageAnswers) {
      const host = acc.pageHost.get(url) ?? hostOf(url);
      if (!host || isOwnedHost(host, ownedNorm)) continue;
      compByHost.set(host, (compByHost.get(host) ?? 0) + answers);
    }
    const topCompetitorDomains = [...compByHost.entries()]
      .map(([hostname, answers]) => ({ hostname, answers }))
      .sort((x, y) => y.answers - x.answers || x.hostname.localeCompare(y.hostname))
      .slice(0, 8);

    const fanoutQueries = [...(fanoutByPrompt.get(acc.prompt.toLowerCase()) ?? [])].slice(0, 12);
    const ownPresent = acc.ownMentioned > 0 || acc.ownCited > 0;
    const anyCitations = acc.pageAnswers.size > 0;
    const hasCompetitor = topCompetitorDomains.length > 0;

    // Deterministic play.
    let recommendedMove: PromptRecommendedMove;
    if (!anyCitations) recommendedMove = "source_gap"; // AI answers but cites nobody
    else if (acc.ownCited > 0) recommendedMove = "expand_page"; // you're cited → strengthen
    else recommendedMove = "answer_block"; // absent + competitors cited → become citable

    const visibilityGap = acc.total > 0 ? 1 - acc.ownMentioned / acc.total : 1;
    const citationGap = acc.total > 0 ? 1 - acc.ownCited / acc.total : 1;
    const promptAttentionScore = Math.round(acc.total * Math.max(1, acc.models.size) * (1 + Math.min(fanoutQueries.length, 10)));

    out.push({
      prompt: acc.prompt,
      promptId: acc.promptId,
      topic: acc.topic,
      executions: acc.total,
      models: [...acc.models].sort(),
      ownMentionCount: acc.ownMentioned,
      ownCitationCount: acc.ownCited,
      ownCitedUrls: [...acc.ownCitedUrls],
      topCitedPages,
      topCompetitorDomains,
      fanoutQueries,
      rawAnswerExamples: acc.examples,
      tags: [...acc.themes].sort(),
      visibilityGap: Math.round(visibilityGap * 100) / 100,
      citationGap: Math.round(citationGap * 100) / 100,
      promptAttentionScore,
      recommendedMove,
      evidence:
        `prompt observed in ${acc.total} AI answer(s) across ${acc.models.size} model(s); ` +
        `own_mentions=${acc.ownMentioned} own_citations=${acc.ownCited}; ` +
        (hasCompetitor ? `top competitor=${topCompetitorDomains[0]!.hostname} (${topCompetitorDomains[0]!.answers}); ` : "no displaceable competitor cited; ") +
        `${fanoutQueries.length} fan-out queries; play=${recommendedMove}`,
    });
  }

  // Opportunities first by gap (absent), then by attention.
  out.sort((a, b) => {
    const aGap = a.recommendedMove !== "expand_page";
    const bGap = b.recommendedMove !== "expand_page";
    if (aGap !== bGap) return aGap ? -1 : 1;
    return b.promptAttentionScore - a.promptAttentionScore || a.prompt.localeCompare(b.prompt);
  });
  return out;
}
