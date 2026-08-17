import "server-only";

/** evidence/ai-visibility/answer-journeys - THE ANSWER ITSELF, for the few prompts a card is being written
 *  about. The snapshot's canonical window carries ONE newest row per question and engine, which is the right
 *  window for "where do we stand" and the wrong one for "why": a card written off it said none of three
 *  answers credited this site while the record held fifty-four answers, two of them citing it by name
 *  (operator, 2026-08-17). So this is the narrow read behind real reasoning: for ONE prompt, the stored
 *  answers with their whole journey (engine, prompt version, reporting day, citations, retrieved pages,
 *  fan-outs, brand mentions) plus the account's own standing across them. A page an engine RETRIEVED and did
 *  not cite is a different diagnosis from a page it never saw, and only this read can tell them apart.
 *  Bounded and $0: stored rows only, one prompt, text truncated at the source. */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { citesOwnSite } from "./canonicalize-citation-url";

type Link = { url: string; domain: string; title?: string | null };

export type AnswerJourney = {
  promptId: string;
  promptVersion: number | null;
  engine: string;
  observedAt: string | null;
  reportingDay: string | null;
  /** The stored answer, truncated. */
  answerText: string;
  /** The passage around the first mention of the rival domain (or its bare name), when one is found. */
  citedPassage: string | null;
  citations: Link[];
  /** The pages the engine reported it RETRIEVED, whether or not it credited them. */
  retrieved: Link[];
  fanOuts: string[];
  brandMentions: string[];
  /** This account's own site, in this answer's citations and in what it retrieved. */
  ownCited: boolean;
  ownRetrieved: boolean;
};

/** WHERE THE ACCOUNT ACTUALLY STANDS on one question, across every stored answer this read reached. Counted,
 *  never inferred from the newest row: `cited` above zero with `citedNewest` false is a site that HAS been
 *  credited and is not being credited now, which no single-window read can say. */
type AnswerStanding = {
  answers: number;
  cited: number;
  retrieved: number;
  /** The newest answer that credited this site, or null. */
  lastCitedAt: string | null;
  engines: string[];
  /** Engines that retrieved the site on at least one answer and credited it on none of them. */
  retrievedNotCitedEngines: string[];
};

const ANSWER_CAP = 4_000, PASSAGE_RADIUS = 260, JOURNEY_CAP = 40;

/** The passage of `text` around the first occurrence of the rival's domain or bare name. Null = the answer
 *  never names it in prose (the citation rode a link list), which is itself a fact worth stating. */
export function passageAround(text: string, rivalDomain: string): string | null {
  const bare = rivalDomain.replace(/^www\./, "").replace(/\.(com|org|net|io|co|ir)$/i, "");
  const at = [rivalDomain, bare].map((n) => text.toLowerCase().indexOf(n.toLowerCase())).find((i) => i >= 0);
  if (at == null || at < 0) return null;
  const from = Math.max(0, at - PASSAGE_RADIUS), to = Math.min(text.length, at + PASSAGE_RADIUS);
  return `${from > 0 ? "..." : ""}${text.slice(from, to).replace(/\s+/g, " ").trim()}${to < text.length ? "..." : ""}`;
}

const links = (raw: unknown): Link[] => Array.isArray(raw)
  ? raw.map((r) => (r && typeof r === "object" ? r as Record<string, unknown> : {}))
    .map((r) => ({ url: String(r.url ?? ""), domain: String(r.domain ?? ""), title: (r.title as string | null) ?? null }))
    .filter((l) => l.url.length > 0)
  : [];
const strings = (raw: unknown): string[] => Array.isArray(raw) ? raw.map((r) => String(r)).filter((s) => s.length > 0) : [];

type Row = { prompt_id: string; prompt_version: number | null; engine: string; completed_at: string | null;
  reporting_day: string | null; answer_text: string | null; journey: Record<string, unknown> | null };

/** Up to `cap` stored answers for one prompt, newest first, each with its whole journey and the rival passage
 *  located. `site` is the account's own bare host, so each answer can say whether it credited or merely
 *  retrieved this account. Empty on any failure, which is logged: a read that did not happen is never an
 *  account whose answers say nothing. */
export async function readAnswerJourneys(tenantId: string, promptId: string, rivalDomain: string,
  cap = 3, site?: string): Promise<AnswerJourney[]> {
  try {
    const { data, error } = await getSupabaseAdmin().from("ai_observations")
      .select("prompt_id, prompt_version, engine, completed_at, reporting_day, answer_text, journey")
      .eq("tenant_id", tenantId).eq("prompt_id", promptId).eq("status", "completed")
      .not("answer_text", "is", null)
      .order("completed_at", { ascending: false }).limit(Math.min(cap, JOURNEY_CAP));
    if (error != null) { log.warn("[answer-journeys] read failed", { tenantId, promptId, error: error.message }); return []; }
    return ((data ?? []) as Row[])
      .filter((r) => (r.answer_text ?? "").trim().length > 0)
      .map((r) => {
        const text = (r.answer_text ?? "").slice(0, ANSWER_CAP);
        const j = r.journey ?? {};
        const citations = links(j.cited_sources), retrieved = links(j.retrieved_results);
        return { promptId: r.prompt_id, promptVersion: r.prompt_version, engine: r.engine,
          observedAt: r.completed_at, reportingDay: r.reporting_day,
          answerText: text, citedPassage: passageAround(text, rivalDomain),
          citations, retrieved, fanOuts: strings(j.fan_outs), brandMentions: strings(j.brand_mentions),
          ownCited: !!site && citesOwnSite(citations, site),
          ownRetrieved: !!site && citesOwnSite(retrieved, site) };
      });
  } catch (e) {
    log.warn("[answer-journeys] read threw", { tenantId, promptId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/** WHAT THE WHOLE STORED RECORD SAYS about one question, from the journeys handed in. PURE: the caller owns
 *  the read and its bound, so this can never widen a query behind anybody's back. */
export function standingOf(journeys: readonly AnswerJourney[]): AnswerStanding {
  const cited = journeys.filter((j) => j.ownCited);
  const byEngine = new Map<string, { cited: number; retrieved: number }>();
  for (const j of journeys) {
    const e = byEngine.get(j.engine) ?? { cited: 0, retrieved: 0 };
    if (j.ownCited) e.cited += 1;
    if (j.ownRetrieved) e.retrieved += 1;
    byEngine.set(j.engine, e);
  }
  return {
    answers: journeys.length,
    cited: cited.length,
    retrieved: journeys.filter((j) => j.ownRetrieved).length,
    lastCitedAt: cited.map((j) => j.observedAt).filter((t): t is string => !!t).sort().at(-1) ?? null,
    engines: [...byEngine.keys()].sort(),
    retrievedNotCitedEngines: [...byEngine.entries()].filter(([, e]) => e.retrieved > 0 && e.cited === 0).map(([k]) => k).sort(),
  };
}

/** One-line provenance for a journey, for evidence hints. */
export const journeyLabel = (j: AnswerJourney): string =>
  `${j.engine}${j.observedAt ? `, ${j.observedAt.slice(0, 10)}` : ""}`;
