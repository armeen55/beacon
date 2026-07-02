import "server-only";

/**
 * citation-likelihood (2026-07-02, master plan item 50) - turns a page's target questions +
 * the retrieval index into an honest "who wins the answer race" report. For each question we
 * embed the query, rank it against every indexed chunk (owned + competitor) with retrieve.ts's
 * pure cosine math, and report where the tenant's own best passage lands.
 *
 * Question source priority (best evidence first, honest fallback):
 *   1. Fanout / tracked-prompt sub-queries that match this page (real AI-ask evidence)
 *   2. Top GSC queries for this exact page (real search demand)
 * Absent either source, the report is empty for that page - never a fabricated question.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { embedChunks, contentHashOf, type EmbedFn } from "./embeddings";
import { whoWins, type RetrievalCandidate, type RankedCandidate, type WhoWinsResult } from "./retrieve";
import { log } from "@/lib/logger";

export type QuestionSource = "fanout" | "gsc_query";

export type TargetQuestion = { question: string; source: QuestionSource };

export type PassageToBeat = { domain: string; excerpt: string };

export type QuestionCitationReport = {
  question: string;
  source: QuestionSource;
  /** 1-based rank of the tenant's own best passage, or null when the tenant has nothing
   *  indexed that's even a candidate for this question (honest silence, never a guess). */
  ownBestRank: number | null;
  totalCandidates: number;
  /** The passage currently beating the tenant's own best (or the outright winner, when the
   *  tenant has no indexed passage at all) - null only when there are zero candidates or the
   *  tenant already holds rank 1 (nothing left to beat). */
  passageToBeat: PassageToBeat | null;
  /** One first-person, plain-business sentence. Never contains an em/en dash. */
  sentence: string;
};

export type CitationLikelihoodReport = {
  pageUrl: string;
  questions: QuestionCitationReport[];
};

function domainOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max).trim()}...` : t;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** The passage the tenant needs to beat: nothing when they already hold rank 1, otherwise
 *  the overall #1 candidate (whether or not the tenant has any passage indexed at all). Pure. */
function pickBeatTarget(result: WhoWinsResult): RankedCandidate | null {
  if (result.ownBest && result.ownBest.rank === 1) return null;
  return result.topOverall;
}

/**
 * Turn one ranking result into the report row + honest sentence. Pure once the ranking is
 * already computed - no I/O here.
 */
export function buildQuestionReport(question: string, source: QuestionSource, result: WhoWinsResult): QuestionCitationReport {
  const beater = pickBeatTarget(result);
  const passageToBeat: PassageToBeat | null = beater ? { domain: domainOf(beater.pageUrl), excerpt: beater.chunkExcerpt.slice(0, 200) } : null;

  let sentence: string;
  if (result.totalCandidates === 0) {
    sentence = `For "${question}", I do not have any indexed passages yet. Run the answer-race check after indexing to see where you stand.`;
  } else if (!result.ownBest) {
    sentence = `For "${question}", none of your pages are indexed yet, so I cannot rank you. The passage currently winning is from ${passageToBeat?.domain ?? "a competitor"}.`;
  } else if (result.ownBest.rank === 1) {
    sentence = `For "${question}", your page's best passage ranks 1st of ${result.totalCandidates}. You are ahead right now.`;
  } else {
    const beaterDomain = passageToBeat?.domain ?? "a competitor";
    const excerptClause = passageToBeat?.excerpt ? `: "${truncate(passageToBeat.excerpt, 120)}"` : ".";
    sentence = `For "${question}", your page's best passage ranks ${ordinal(result.ownBest.rank)} of ${result.totalCandidates}. The passage to beat is ${beaterDomain}'s passage${excerptClause}`;
  }

  return {
    question,
    source,
    ownBestRank: result.ownBest?.rank ?? null,
    totalCandidates: result.totalCandidates,
    passageToBeat,
    sentence,
  };
}

/** Read all cached chunks for a tenant (owned + competitor) as retrieval candidates. Paged at
 *  1000 rows. Fail-soft -> []. */
async function readAllChunks(tenantId: string): Promise<RetrievalCandidate[]> {
  if (!isSupabaseConfigured()) return [];
  const out: RetrievalCandidate[] = [];
  try {
    const sb = getSupabaseAdmin();
    let from = 0;
    const PAGE = 1000;
    for (;;) {
      const { data, error } = await sb
        .from("retrieval_chunks")
        .select("source, page_url, chunk_text, embedding")
        .eq("tenant_id", tenantId)
        .range(from, from + PAGE - 1);
      if (error || !data) break;
      for (const r of data as { source: "owned" | "competitor"; page_url: string; chunk_text: string; embedding: number[] }[]) {
        if (Array.isArray(r.embedding)) {
          out.push({ source: r.source, pageUrl: r.page_url, chunkExcerpt: r.chunk_text, embedding: r.embedding });
        }
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  } catch (e) {
    log.warn?.("[retrieval-twin] chunk read failed (non-fatal)", { error: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

export type CitationLikelihoodDeps = {
  loadFanoutQuestions: (tenantId: string, pageUrl: string) => Promise<string[]>;
  loadGscQuestions: (tenantId: string, pageUrl: string) => Promise<string[]>;
  readChunks: (tenantId: string) => Promise<RetrievalCandidate[]>;
  /** Test seam only - default is the real embedChunks with its default OpenAI client. */
  embed?: EmbedFn;
};

async function defaultLoadFanoutQuestions(tenantId: string, pageUrl: string): Promise<string[]> {
  try {
    const { loadFanoutSeedsForTenant, fanoutSeedsForNode } = await import("@/domains/demand-graph/load-fanout-seeds");
    const seeds = await loadFanoutSeedsForTenant(tenantId);
    if (seeds.length === 0) return [];
    // We don't have the page's demand-node label here, so approximate it from the URL slug -
    // fanoutSeedsForNode falls back to [] on no token overlap, which is the honest outcome
    // when the slug shares nothing with any real sub-query (never a fabricated match).
    const label = pageUrl.split("/").filter(Boolean).pop()?.replace(/[-_]/g, " ") ?? "";
    return fanoutSeedsForNode(label, [], seeds, 6);
  } catch {
    return [];
  }
}

async function defaultLoadGscQuestions(tenantId: string, pageUrl: string): Promise<string[]> {
  try {
    const { loadTopQueriesForPages } = await import("@/domains/recommendation-intelligence/gsc-page-queries");
    const byPage = await loadTopQueriesForPages(tenantId, [pageUrl]);
    const rows = byPage.get(pageUrl) ?? [];
    return rows.map((r) => r.query).slice(0, 6);
  } catch {
    return [];
  }
}

const defaultDeps: CitationLikelihoodDeps = {
  loadFanoutQuestions: defaultLoadFanoutQuestions,
  loadGscQuestions: defaultLoadGscQuestions,
  readChunks: readAllChunks,
};

/** Cache-key prefix so a question embedding never collides with a page-chunk embedding that
 *  happens to share identical text. */
function queryContentHash(question: string): string {
  return contentHashOf(`query:${question}`);
}

/**
 * Build the full citation-likelihood report for one page: its target questions (fanout first,
 * GSC fallback), each ranked against the tenant's indexed chunks. Fail-soft throughout - a
 * question that can't be embedded is dropped from the report rather than crashing it.
 */
export async function buildCitationLikelihoodReport(
  tenantId: string,
  pageUrl: string,
  depsOverride: Partial<CitationLikelihoodDeps> = {},
): Promise<CitationLikelihoodReport> {
  const deps = { ...defaultDeps, ...depsOverride };
  const canonicalUrl = canonicalizeCitationUrl(pageUrl) || pageUrl;

  const fanoutQs = await deps.loadFanoutQuestions(tenantId, canonicalUrl).catch(() => [] as string[]);
  // GSC's own gsc_daily_rows.page column stores whatever exact URL form Google reports
  // (often WITH "www."), so the GSC query lookup must use the caller's ORIGINAL pageUrl,
  // never the www-stripped canonical form - canonicalizing here silently zeroed every GSC
  // match (a real bug caught by a live run against tenant-iranopedia's own GSC data).
  const questions: TargetQuestion[] =
    fanoutQs.length > 0
      ? fanoutQs.map((q) => ({ question: q, source: "fanout" as const }))
      : (await deps.loadGscQuestions(tenantId, pageUrl).catch(() => [] as string[])).map((q) => ({ question: q, source: "gsc_query" as const }));

  if (questions.length === 0) return { pageUrl: canonicalUrl, questions: [] };

  const candidates = await deps.readChunks(tenantId).catch(() => [] as RetrievalCandidate[]);
  if (candidates.length === 0) return { pageUrl: canonicalUrl, questions: [] };

  // Embed the questions themselves through the SAME budgeted/cached path as page chunks - a
  // query embedding is cached by its own content hash, so re-running this report for the same
  // question (a very common operator action) costs $0 after the first time.
  const embedInputs = questions.map((q) => ({ id: queryContentHash(q.question), source: "owned" as const, pageUrl: canonicalUrl, chunkText: q.question }));
  const embedResult = await embedChunks(tenantId, embedInputs, deps.embed ? { embed: deps.embed } : {});

  const embeddingByQuestion = new Map(embedResult.embedded.map((e) => [e.chunkText, e.embedding]));

  const reports: QuestionCitationReport[] = [];
  for (const q of questions) {
    const qEmbedding = embeddingByQuestion.get(q.question);
    if (!qEmbedding) continue; // embedding failed/skipped for this question - drop it, don't fabricate
    const result = whoWins(qEmbedding, candidates);
    reports.push(buildQuestionReport(q.question, q.source, result));
  }

  return { pageUrl: canonicalUrl, questions: reports };
}
