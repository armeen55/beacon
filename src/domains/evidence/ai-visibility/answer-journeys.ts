import "server-only";

/** evidence/ai-visibility/answer-journeys - THE ANSWER ITSELF, for the prompts a card is being written
 *  about. The snapshot's canonical window carries ONE newest row per question and engine, which is the right
 *  window for "where do we stand" and the wrong one for "why": a card written off it said none of three
 *  answers credited this site while the record held fifty-four answers, two of them citing it by name
 *  (operator, 2026-08-17). So this is the narrow read behind real reasoning: for ONE prompt, the stored
 *  answers with their whole journey (engine, prompt version, reporting day, citations, retrieved pages,
 *  fan-outs, brand mentions) plus the account's own standing across them. A page an engine RETRIEVED and did
 *  not cite is a different diagnosis from a page it never saw, and only this read can tell them apart.
 *  Bounded and $0: stored rows only, one batched read per 20 prompts, text truncated at the source. */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { citesOwnSite } from "./canonicalize-citation-url";

type Link = { url: string; domain: string; title?: string | null };

type AnswerJourney = {
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
  /** Engines that keep fetching this site and mostly do not credit it: retrieved on at least two answers and
   *  cited on fewer than half of those. Zero citations is not the bar, because one credit in eight retrievals
   *  is the same story and the real record looks like that. */
  retrievedNotCitedEngines: string[];
};

const ANSWER_CAP = 4_000, PASSAGE_RADIUS = 260, JOURNEY_CAP = 40, BATCH_PROMPTS = 20;

/** The passage of `text` around the first occurrence of the rival's domain or bare name. Null = the answer
 *  never names it in prose (the citation rode a link list), which is itself a fact worth stating. */
function passageAround(text: string, rivalDomain: string): string | null {
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

/** Each selected prompt gets its own newest 40, even when another prompt has thousands of answers.
 *  A failed chunk is explicit: callers must hold those cases, never treat a failed read as zero citations. */
export async function readAnswerJourneysBatch(tenantId: string, site: string,
  selected: readonly { promptId: string; rivalDomain: string }[]): Promise<{ rows: Map<string, AnswerJourney[]>; failed: Set<string> }> {
  const rows = new Map<string, AnswerJourney[]>(), failed = new Set<string>();
  const domains = new Map(selected.map((one) => [one.promptId, one.rivalDomain]));
  const ids = [...domains.keys()].filter(Boolean);
  for (let offset = 0; offset < ids.length; offset += BATCH_PROMPTS) {
    const chunk = ids.slice(offset, offset + BATCH_PROMPTS), allowed = new Set(chunk);
    try {
      const { data, error } = await getSupabaseAdmin().rpc("read_answer_journeys_batch", {
        p_tenant_id: tenantId, p_site: site, p_prompt_ids: chunk });
      if (error || !Array.isArray(data)) throw new Error(error?.message ?? "missing batch rows");
      const grouped = new Map(chunk.map((id) => [id, [] as AnswerJourney[]]));
      for (const raw of data as Row[]) {
        if (!allowed.has(raw.prompt_id) || typeof raw.answer_text !== "string" || !raw.answer_text.trim()
          || typeof raw.engine !== "string" || (grouped.get(raw.prompt_id)?.length ?? JOURNEY_CAP) >= JOURNEY_CAP)
          throw new Error("batch identity, shape or per-prompt bound changed");
        const text = raw.answer_text.slice(0, ANSWER_CAP), j = raw.journey ?? {};
        const citations = links(j.cited_sources), retrieved = links(j.retrieved_results);
        grouped.get(raw.prompt_id)!.push({ promptId: raw.prompt_id, promptVersion: raw.prompt_version,
          engine: raw.engine, observedAt: raw.completed_at, reportingDay: raw.reporting_day,
          answerText: text, citedPassage: passageAround(text, domains.get(raw.prompt_id)!),
          citations, retrieved, fanOuts: strings(j.fan_outs), brandMentions: strings(j.brand_mentions),
          ownCited: citesOwnSite(citations, site), ownRetrieved: citesOwnSite(retrieved, site) });
      }
      for (const id of chunk) if (grouped.get(id)!.length > 0) rows.set(id, grouped.get(id)!); else failed.add(id);
    } catch (e) {
      chunk.forEach((id) => failed.add(id));
      log.warn("[answer-journeys] batch read failed", { tenantId, prompts: chunk.length,
        error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { rows, failed };
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
    retrievedNotCitedEngines: [...byEngine.entries()].filter(([, e]) => e.retrieved >= 2 && e.cited * 2 < e.retrieved).map(([k]) => k).sort(),
  };
}

/** One-line provenance for a journey, for evidence hints. */
export const journeyLabel = (j: AnswerJourney): string =>
  `${j.engine}${j.observedAt ? `, ${j.observedAt.slice(0, 10)}` : ""}`;
