import "server-only";

/** evidence/ai-visibility/answer-journeys - THE ANSWER ITSELF, for the few prompts a card is being written
 *  about. The snapshot's lean observation rows carry who was cited and never what the answer SAID, so every
 *  "cite the rival" card argued from a count. This is the narrow read behind real reasoning: for a bounded
 *  set of prompts, the stored answer text and the passage around the rival's citation, so a card can quote
 *  what the assistant actually drew on and an editor can write the treatment that addresses it. Bounded and
 *  $0: stored rows only, few prompts, text truncated at the source. */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
export type AnswerJourney = {
  promptId: string;
  engine: string;
  observedAt: string | null;
  /** The stored answer, truncated. */
  answerText: string;
  /** The passage around the first mention of the rival domain (or its bare name), when one is found. */
  citedPassage: string | null;
};

const ANSWER_CAP = 4_000, PASSAGE_RADIUS = 260;

/** The passage of `text` around the first occurrence of the rival's domain or bare name. Null = the answer
 *  never names it in prose (the citation rode a link list), which is itself a fact worth stating. */
export function passageAround(text: string, rivalDomain: string): string | null {
  const bare = rivalDomain.replace(/^www\./, "").replace(/\.(com|org|net|io|co|ir)$/i, "");
  const at = [rivalDomain, bare].map((n) => text.toLowerCase().indexOf(n.toLowerCase())).find((i) => i >= 0);
  if (at == null || at < 0) return null;
  const from = Math.max(0, at - PASSAGE_RADIUS), to = Math.min(text.length, at + PASSAGE_RADIUS);
  return `${from > 0 ? "..." : ""}${text.slice(from, to).replace(/\s+/g, " ").trim()}${to < text.length ? "..." : ""}`;
}

/** Up to `cap` stored answers for one prompt, newest first, each with the rival passage located. */
export async function readAnswerJourneys(tenantId: string, promptId: string, rivalDomain: string, cap = 3): Promise<AnswerJourney[]> {
  try {
    const { data, error } = await getSupabaseAdmin().from("ai_observations")
      .select("prompt_id, engine, completed_at, answer_text")
      .eq("tenant_id", tenantId).eq("prompt_id", promptId).eq("status", "completed")
      .not("answer_text", "is", null)
      .order("completed_at", { ascending: false }).limit(cap);
    if (error != null) { log.warn("[answer-journeys] read failed", { tenantId, promptId, error: error.message }); return []; }
    return ((data ?? []) as { prompt_id: string; engine: string; completed_at: string | null; answer_text: string | null }[])
      .filter((r) => (r.answer_text ?? "").trim().length > 0)
      .map((r) => {
        const text = (r.answer_text ?? "").slice(0, ANSWER_CAP);
        return { promptId: r.prompt_id, engine: r.engine, observedAt: r.completed_at,
          answerText: text, citedPassage: passageAround(text, rivalDomain) };
      });
  } catch (e) {
    log.warn("[answer-journeys] read threw", { tenantId, promptId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/** One-line provenance for a journey, for evidence hints. */
export const journeyLabel = (j: AnswerJourney): string =>
  `${j.engine}${j.observedAt ? `, ${j.observedAt.slice(0, 10)}` : ""}`;
