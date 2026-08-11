/**
 * decision/membership: THE ONE predicate that decides whether an observed AI answer BELONGS to the search a
 * page is being judged on. It exists because a shared everyday word does not. A live change attached the
 * answer to "what are the best places to visit in Iran" to a page judged on "iran flag", because both strings
 * carry the account's own subject word, and that answer then supported a component, a receipt line, a winning
 * page and a confidence sentence. One word an account puts on everything is not evidence about anything.
 *
 * THREE ROUTES IN, AND NOTHING ELSE:
 *   1. the question asked IS one of the case's exact searches (identity, never similarity);
 *   2. the PROVIDER itself reported running one of them to answer it (its own fan-out, not my wording);
 *   3. the account's stored research lineage records that one of those searches came OUT OF this exact
 *      answer: a durable identity carried on the keyword since the day it arrived, which is where a
 *      separately adjudicated relationship with stored provenance lands too. THE ANSWER, not the question:
 *      one tracked question is asked of several engines, so the same question id names several different
 *      answers with different fan-outs. Matching on the question id alone handed one engine's fan-out to
 *      another engine's answer, so the lineage must name the question AND the engine it was answered by,
 *      and a lineage row that recorded only the question names no single answer and opens no route.
 * A TRACKED PROMPT IS NEVER ITS OWN FAN-OUT: a fan-out entry equal to the question asked is discarded, so an echo of my own prompt can never pose as a search the assistant went and ran.
 *
 * Deliberately NOT a route: the case grouping over topics, which may merge two subjects on one shared strong token. That is the very join this predicate exists to refuse.
 *
 * PURE: no store, no clock, no model call.
 */

import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";

/** Only what membership is decided from, so the snapshot's own observation row satisfies it as it stands. */
type ObservedAnswer = { promptId: string; promptText: string; engine: string; fanOutQueries?: readonly string[] | null };

/** ONE ANSWER, named the way both sides actually recorded it: the question that was asked and the engine that
 *  answered it. The projected answer row carries no version and no slot, so those are not part of the key
 *  rather than being guessed at; the question and the engine are enough to tell two answers to one tracked
 *  question apart, which is the confusion this key exists to end. */
const answerKey = (promptId: string, engine: string): string => `${promptId.trim()}|${engine.trim().toLowerCase()}`;

/** The case an answer would have to belong to: its EXACT searches, and the lineage rows this account stored
 *  when those searches arrived. Both are read off evidence on file, never inferred from wording. A lineage
 *  row missing either half of the answer identity names no single answer and is dropped. */
type CaseIdentity = {
  queries: readonly string[];
  provenance?: readonly { promptId?: string | null; engine?: string | null }[];
};

/** PURE: does this answer belong to this case? Everything else is somebody else's evidence. */
export function observationJoinsCase(answer: ObservedAnswer, ofCase: CaseIdentity): boolean {
  const member = new Set(ofCase.queries.map(canonicalQueryKey).filter((q) => q.length > 0));
  if (member.size === 0) return false;
  const asked = canonicalQueryKey(answer.promptText);
  if (member.has(asked)) return true;
  if ((answer.fanOutQueries ?? []).some((q) => { const k = canonicalQueryKey(q); return k !== asked && member.has(k); })) return true;
  return (ofCase.provenance ?? []).some((o) => !!o.promptId && !!o.engine
    && answerKey(o.promptId, o.engine) === answerKey(answer.promptId, answer.engine));
}
