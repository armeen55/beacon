/**
 * research-evidence (integrity closure, Agent B) - the funnel's snapshot-facing
 * evidence contract. PURE types (no I/O, no server-only) so both the pure
 * EvidenceSnapshot kernel and the server-only funnel projector share one shape:
 * retained keyword metrics WITH intent, exact AI observations with tri-state
 * citations, per-query SERP evidence, winning pages with TRUE per-page
 * provenance, and the research receipt.
 */

export type ResearchEngine = "chatgpt" | "gemini" | "claude" | "perplexity";

type ResearchKeyword = {
  query: string;
  searchVolume: number | null;
  competition: number | null;
  competitionLevel: "low" | "medium" | "high" | null;
  intent: string | null;
};

type ResearchCitation = { url: string; domain: string; title: string | null };

type ResearchAiObservation = {
  promptId: string;
  /** The REAL prompt text observed (never a prompt id surfaced as evidence). */
  promptText: string;
  engine: string;
  modelRequested: string | null;
  modelServed: string | null;
  /** Provider-REPORTED web-search state; null = not reported. */
  webSearchReported: boolean | null;
  /** true = citations were observable on this path; false = not observable. */
  citationsObserved: boolean;
  /** null = not observable; [] = observed zero; nonempty = real citations. */
  citations: ResearchCitation[] | null;
  /** null = not observable on this path. */
  fanOutQueries: string[] | null;
  observedAt: string;
};

type ResearchSerpEvidence = {
  query: string;
  organic: { rank: number; domain: string; url: string; title: string | null }[];
  aiOverview: ResearchCitation[];
  aiMode: ResearchCitation[];
  paa: { question: string; answeringDomain: string | null }[];
  related: string[];
};

type ResearchAppearanceKind = "serp_organic" | "ai_overview" | "ai_mode" | "ai_answer";

/** ONE winning-page appearance with its ACTUAL source (never the global engine
 *  list): a real query or a real prompt id + prompt text, its engine, its rank. */
export type ResearchWinningAppearance = {
  kind: ResearchAppearanceKind;
  query: string | null;
  promptId: string | null;
  promptText: string | null;
  engine: string | null;
  rank: number | null;
  citedUrl: string;
  observedAt: string;
  modelServed: string | null;
};

export type ResearchPageExtract = {
  title: string | null;
  h1: string | null;
  wordCount: number;
  headings: string[];
  faqCount: number;
};

type ResearchWinningPage = {
  url: string;
  domain: string;
  /** engines of THIS page's OWN appearances only. */
  engines: string[];
  /** real appearance prompt texts (never a prompt id). */
  examplePrompts: string[];
  appearances: ResearchWinningAppearance[];
  extract: ResearchPageExtract | null;
};

type ResearchReceipt = {
  researched: number;
  retained: number;
  stale: number;
  missing: number;
  cached: number;
  spentUsd: number;
  freshestObservationAt: string | null;
};

export type FunnelResearchEvidence = {
  retainedKeywords: ResearchKeyword[];
  aiObservations: ResearchAiObservation[];
  serpEvidence: ResearchSerpEvidence[];
  winningPages: ResearchWinningPage[];
  receipt: ResearchReceipt;
};

export function emptyResearchEvidence(): FunnelResearchEvidence {
  return {
    retainedKeywords: [],
    aiObservations: [],
    serpEvidence: [],
    winningPages: [],
    receipt: { researched: 0, retained: 0, stale: 0, missing: 0, cached: 0, spentUsd: 0, freshestObservationAt: null },
  };
}
