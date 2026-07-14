/**
 * One compact, tenant-explicit evidence packet for a single candidate move.
 * This is the convergence seam between Beacon's existing research producers
 * and the existing EvidencePacket -> PreparedMove path. It performs no I/O and
 * never ranks independently; callers pass already-cached research facts.
 */

import { createHash } from "node:crypto";

import { topicTokens } from "@/domains/evidence/relevance-gate";
import type { MoveCandidate } from "@/domains/demand-graph/build-graph";
import type { AeoEvidence } from "@/domains/demand-graph/profound-evidence-fusion";
import type { KeywordLibrary, KeywordLibraryRow, KeywordLibrarySource } from "./keyword-library";
import type { SerpPattern } from "@/domains/serp/research-enrichment";
import type { CloneBrief } from "@/domains/serp/clone-brief";
import type { UniverseQuestionRow } from "./question-universe";

export type ResearchEvidenceSource =
  | "gsc"
  | "keyword_volume"
  | "keyword_difficulty"
  | "live_serp"
  | "ai_answers"
  | "ai_citations"
  | "ai_fanout"
  | "competitor_teardown"
  | "paa";

export type DossierKeyword = {
  query: string;
  searchesPerMo: number | null;
  timesShownOnGoogle: number | null;
  clicks: number | null;
  yourPosition: number | null;
  difficulty: number | null;
  trend: KeywordLibraryRow["trend"];
  ownerPage: string | null;
  competitorOwners: string[];
  relatedQuestions: string[];
  sources: KeywordLibrarySource[];
  lastChecked: string | null;
};

export type DossierQuestion = {
  question: string;
  sources: UniverseQuestionRow["sources"];
  demandScore: number;
  priority: number;
  ownership: string | null;
  coverageStatus: UniverseQuestionRow["coverageStatus"];
};

export type DossierCloneBrief = {
  url: string;
  competitorDomain: string;
  trafficWeight: number;
  whatWins: string | null;
  teardownStatus: CloneBrief["teardownStatus"];
  demand: CloneBrief["demand"];
  coverageGaps: string[];
  buildPointer: CloneBrief["buildPointer"];
  summary: string;
};

export type ResearchDossier = {
  tenantId: string;
  moveKey: string;
  topic: string;
  targetUrl: string | null;
  keywords: DossierKeyword[];
  serpPatterns: SerpPattern[];
  questions: DossierQuestion[];
  ai: AeoEvidence | null;
  cloneBriefs: DossierCloneBrief[];
  evidenceSources: ResearchEvidenceSource[];
  builtAt: string;
  /** Stable over timestamps; changes only when material evidence changes. */
  evidenceHash: string;
};

export type ResearchCorpus = {
  keywordLibrary: KeywordLibrary;
  serpPatterns: Map<string, SerpPattern>;
  cloneBriefs: CloneBrief[];
  questions: UniverseQuestionRow[];
};

export type BuildResearchDossierInput = {
  tenantId: string;
  move: MoveCandidate;
  demandQueries: readonly { query: string; impressions: number }[];
  corpus: ResearchCorpus;
  nowIso: string;
};

const norm = (value: string): string => value.trim().toLocaleLowerCase("en-US");

function urlKey(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
    return `${parsed.hostname.replace(/^www\./i, "").toLowerCase()}${parsed.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
  }
}

function tokenMatch(a: string, b: string): number {
  const left = new Set(topicTokens(a));
  const right = new Set(topicTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  if (shared < 2) return 0;
  return shared / Math.min(left.size, right.size);
}

function bestTopicMatch(candidate: string, topics: readonly string[]): number {
  const candidateNorm = norm(candidate);
  let best = 0;
  for (const topic of topics) {
    if (!topic.trim()) continue;
    if (candidateNorm === norm(topic)) return 1;
    best = Math.max(best, tokenMatch(candidate, topic));
  }
  return best;
}

function demandMagnitude(row: KeywordLibraryRow): number {
  return Math.max(row.searchesPerMo ?? 0, row.timesShownPerMo ?? 0);
}

function compactKeyword(row: KeywordLibraryRow): DossierKeyword {
  return {
    query: row.keyword,
    searchesPerMo: row.searchesPerMo,
    timesShownOnGoogle: row.timesShownPerMo,
    clicks: row.clicks,
    yourPosition: row.yourPosition,
    difficulty: row.difficulty,
    trend: row.trend,
    ownerPage: row.ownerPage,
    competitorOwners: row.competitorOwners.slice(0, 5),
    relatedQuestions: row.relatedQuestions.slice(0, 8),
    sources: [...row.sources],
    lastChecked: row.lastChecked,
  };
}

function compactClone(brief: CloneBrief): DossierCloneBrief {
  return {
    url: brief.url,
    competitorDomain: brief.competitorDomain,
    trafficWeight: brief.trafficWeight,
    whatWins: brief.whatWins,
    teardownStatus: brief.teardownStatus,
    demand: brief.demand.slice(0, 5),
    coverageGaps: brief.coverageGaps.slice(0, 6),
    buildPointer: brief.buildPointer,
    summary: brief.summary.slice(0, 500),
  };
}

function dossierHash(input: Omit<ResearchDossier, "builtAt" | "evidenceHash">): string {
  const stable = {
    ...input,
    keywords: input.keywords.map(({ lastChecked: _lastChecked, ...row }) => row),
    serpPatterns: input.serpPatterns.map(({ fetchedAt: _fetchedAt, ...pattern }) => pattern),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

export function buildResearchDossier(input: BuildResearchDossierInput): ResearchDossier {
  const { tenantId, move, corpus, nowIso } = input;
  const targetKey = urlKey(move.ownedUrl);
  const topics = [
    move.label,
    ...input.demandQueries.map((row) => row.query),
    ...move.fanoutSeeds,
    ...(move.aeoEvidence?.prompts ?? []),
    ...(move.aeoEvidence?.fanoutQueries ?? []),
  ].filter(Boolean);

  const keywordMatches = corpus.keywordLibrary.rows
    .map((row) => {
      const ownerMatch = !!targetKey && urlKey(row.ownerPage) === targetKey;
      const topicScore = bestTopicMatch(row.keyword, topics);
      return { row, ownerMatch, topicScore };
    })
    .filter((match) => match.ownerMatch || match.topicScore >= 0.6)
    .sort((a, b) =>
      Number(b.ownerMatch) - Number(a.ownerMatch) ||
      b.topicScore - a.topicScore ||
      demandMagnitude(b.row) - demandMagnitude(a.row) ||
      a.row.keyword.localeCompare(b.row.keyword),
    )
    .slice(0, 12)
    .map((match) => compactKeyword(match.row));

  const exactPatternTerms = new Set([
    ...topics.map(norm),
    ...keywordMatches.map((row) => norm(row.query)),
  ]);
  const serpPatterns = [...corpus.serpPatterns.entries()]
    .filter(([query]) => exactPatternTerms.has(norm(query)))
    .map(([, pattern]) => pattern)
    .sort((a, b) => bestTopicMatch(b.query, topics) - bestTopicMatch(a.query, topics))
    .slice(0, 4);

  const cloneBriefs = corpus.cloneBriefs
    .map((brief) => {
      const labels = [
        brief.buildPointer?.label ?? "",
        ...brief.demand.map((row) => row.keyword),
      ];
      return { brief, score: Math.max(...labels.map((label) => bestTopicMatch(label, topics)), 0) };
    })
    .filter((match) => match.score >= 0.6)
    .sort((a, b) => b.score - a.score || b.brief.trafficWeight - a.brief.trafficWeight)
    .slice(0, 3)
    .map((match) => compactClone(match.brief));

  const questions = corpus.questions
    .map((row) => {
      const ownerMatch = !!targetKey && urlKey(row.ownership) === targetKey;
      return { row, ownerMatch, topicScore: bestTopicMatch(row.question, topics) };
    })
    .filter((match) => match.ownerMatch || match.topicScore >= 0.6)
    .sort((a, b) =>
      Number(b.row.coverageStatus !== "answered") - Number(a.row.coverageStatus !== "answered") ||
      Number(b.ownerMatch) - Number(a.ownerMatch) ||
      b.row.priority - a.row.priority ||
      b.topicScore - a.topicScore,
    )
    .slice(0, 10)
    .map(({ row }) => ({
      question: row.question,
      sources: [...row.sources],
      demandScore: row.demandScore,
      priority: row.priority,
      ownership: row.ownership,
      coverageStatus: row.coverageStatus,
    }));

  const sources = new Set<ResearchEvidenceSource>();
  for (const keyword of keywordMatches) {
    if (keyword.sources.includes("gsc")) sources.add("gsc");
    if (keyword.sources.includes("dataforseo_demand")) sources.add("keyword_volume");
    if (keyword.sources.includes("dataforseo_difficulty")) sources.add("keyword_difficulty");
    if (keyword.sources.includes("serp_history")) sources.add("live_serp");
    if (keyword.relatedQuestions.length > 0) sources.add("paa");
  }
  if (serpPatterns.length > 0) sources.add("live_serp");
  if (cloneBriefs.some((brief) => brief.teardownStatus === "torn_down")) sources.add("competitor_teardown");
  if (move.aeoEvidence) {
    if (move.aeoEvidence.promptCount > 0) sources.add("ai_answers");
    if (move.aeoEvidence.fanoutQueries.length > 0) sources.add("ai_fanout");
    if (move.aeoEvidence.topCitedPages.length > 0) sources.add("ai_citations");
  }
  if (questions.some((row) => row.sources.includes("paa"))) sources.add("paa");

  const stable: Omit<ResearchDossier, "builtAt" | "evidenceHash"> = {
    tenantId,
    moveKey: move.demandKey,
    topic: move.label,
    targetUrl: move.ownedUrl,
    keywords: keywordMatches,
    serpPatterns,
    questions,
    ai: move.aeoEvidence ?? null,
    cloneBriefs,
    evidenceSources: [...sources].sort(),
  };
  return { ...stable, builtAt: nowIso, evidenceHash: dossierHash(stable) };
}

export function researchDossierHints(dossier: ResearchDossier | null | undefined): string[] {
  if (!dossier) return [];
  const hints: string[] = [];
  const topKeywords = dossier.keywords.slice(0, 4);
  for (const row of topKeywords) {
    const facts = [
      row.searchesPerMo != null ? `${row.searchesPerMo.toLocaleString("en-US")} searches/month` : null,
      row.timesShownOnGoogle != null ? `${row.timesShownOnGoogle.toLocaleString("en-US")} Google impressions` : null,
      row.yourPosition != null ? `your position ${Math.round(row.yourPosition)}` : null,
      row.difficulty != null ? `difficulty ${Math.round(row.difficulty)}/100` : null,
    ].filter(Boolean);
    if (facts.length > 0) hints.push(`Keyword evidence for "${row.query}": ${facts.join(", ")}.`);
  }
  for (const pattern of dossier.serpPatterns.slice(0, 2)) {
    hints.push(
      `Live Google results for "${pattern.query}" favor ${pattern.titlePattern}; ${pattern.elementImplication}. ` +
      `Winning domains: ${pattern.winningDomains.slice(0, 4).join(", ") || "not captured"}.`,
    );
  }
  if (dossier.ai) {
    const domains = dossier.ai.topCitedDomains.slice(0, 4).map((row) => `${row.hostname} (${row.answers})`).join(", ");
    hints.push(
      `AI evidence: ${dossier.ai.promptCount} matched prompts, ${dossier.ai.fanoutQueries.length} fan-out questions, ` +
      `${dossier.ai.ownCitationCount} owned citations, ${dossier.ai.competitorCitationCount} competitor citations` +
      `${domains ? `; top cited competitors: ${domains}` : ""}. Preferred content shape: ${dossier.ai.recommendedContentShape}.`,
    );
  }
  for (const brief of dossier.cloneBriefs.slice(0, 2)) {
    hints.push(`Competitor reverse-engineering: ${brief.summary}`);
  }
  const unanswered = dossier.questions
    .filter((row) => row.coverageStatus !== "answered")
    .slice(0, 6)
    .map((row) => row.question);
  if (unanswered.length > 0) hints.push(`Questions this move should answer: ${unanswered.join("; ")}.`);
  return hints.slice(0, 12);
}

export function dossierReferenceCandidates(dossier: ResearchDossier | null | undefined): string[] {
  if (!dossier) return [];
  return [...new Set([
    ...dossier.cloneBriefs.map((brief) => brief.url),
    ...(dossier.ai?.topCitedPages ?? []).filter((page) => !page.isOwned).map((page) => page.url),
  ].filter(Boolean))].slice(0, 10);
}
