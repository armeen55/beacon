import "server-only";

/**
 * ask/composer (BEACON_500 item 59) - turns a fact dossier into ONE first-person
 * teammate answer. Tries the budget-gated structured LLM first (callStructuredLLM with
 * the "ask_answer" schema, registered in llm/schemas.ts); the numeric-fidelity firewall
 * inside callStructuredLLM rejects any number in the answer that is not present in the
 * grounded fact text, so a hallucinated figure can never reach the operator. When the
 * LLM is off, over budget, or fails validation twice, falls back to a deterministic
 * template answer built directly from the top facts - the operator ALWAYS gets a real,
 * sourced answer, never a spinner or an error.
 */

import { callStructuredLLM, type CompleteFn } from "@/domains/llm/structured-drafter";
import { teammateOf } from "@/domains/team/identity";
import { isDeterministicQuestionShape } from "./router";
import type { AskDossier, AskFact } from "./types";
import type { AskAnswer, AskCitedFact } from "./types";

const CLASS_LABEL: Record<AskDossier["questionClass"], string> = {
  page_specific: "this page",
  page_ranking: "which pages rank highest by that metric",
  site_trend: "the site's traffic",
  ai_visibility: "how AI answers mention us",
  measurement: "what we shipped and measured",
  competitor: "who else AI is citing",
  plan: "what is planned next",
  keyword_next: "which keyword to chase next",
  system_health: "whether anything is broken right now",
};

function askAnswerSystemPrompt(): string {
  return [
    "You are one specialist on a small SEO/AI-visibility team, answering the site owner's question in first person (I/we).",
    'Return ONLY a JSON object: {"speaker": one of gsc|ga4|clarity|profound|dataforseo|wix|llm|commerce_asset|proof, "answer": string, "citedFacts": [{"fact": string, "href": string}]}.',
    "Rules: answer the question DIRECTLY in 2-5 sentences, plain business English, first person.",
    "Use ONLY the facts provided below - never invent a number, date, or claim that is not in them.",
    "Each fact below is given as: FACT TEXT | HREF. Every citedFacts entry must copy the FACT TEXT exactly as written (no numbering, no brackets, no source label, no added words) and pair it with its own exact HREF - do not paraphrase, prefix, or annotate a cited fact.",
    "If the facts do not fully answer the question, say plainly what you do know and what you do not.",
    "No hedging filler, no jargon (experiment, control, SERP, baseline), no em dashes or en dashes, no exclamation marks, no square brackets.",
  ].join(" ");
}

function factsToPrompt(dossier: AskDossier): string {
  return dossier.facts.map((f) => `${f.value} | ${f.href}`).join("\n");
}

/** The deterministic fallback: a plain template built directly from the top facts, with
 *  no paraphrasing risk since every sentence is a fact's own value verbatim. Always
 *  returns an answer - even an empty dossier gets an honest "I do not have data yet"
 *  answer instead of a blank screen. */
export function fallbackAnswer(question: string, dossier: AskDossier): AskAnswer {
  const speaker = defaultSpeakerForClass(dossier);
  if (!dossier.hasData || dossier.facts.length === 0) {
    return {
      speaker,
      answer: `I do not have enough live data yet to answer that about ${CLASS_LABEL[dossier.questionClass]}. Once more data syncs, ask me again.`,
      citedFacts: [],
      source: "fallback",
    };
  }

  const top = dossier.facts.slice(0, 3);
  let answer = `Here is what I know about ${CLASS_LABEL[dossier.questionClass]}: ${top.map((f) => f.value).join(" ")}`;
  // W9 slice 1 (2026-07-09) - when a fact carries freshness/provenance (set by a
  // fact-provider registry wiring, providers/registry.ts), say plainly how current the
  // data is and which specialist read it, so a deterministic answer never reads as an
  // unsourced guess. Additive: most facts still carry neither field, so most answers
  // are unchanged.
  const freshnessClause = buildFreshnessClause(top);
  if (freshnessClause) answer += ` ${freshnessClause}`;
  answer = answer.slice(0, 1200);
  const citedFacts: AskCitedFact[] = top.map((f) => ({ fact: f.value, href: f.href }));
  return { speaker, answer, citedFacts, source: "fallback" };
}

/** Plain-English "data through <date>, from <specialist>" clause, built only when a
 *  fact actually carries freshness/provenance metadata. Returns "" (never null/undefined)
 *  when nothing to add, so callers can string-concat unconditionally. */
function buildFreshnessClause(facts: AskFact[]): string {
  const fresh = facts.find((f) => f.freshnessIso);
  if (!fresh?.freshnessIso) return "";
  const label = teammateOf(fresh.source).name;
  return `Data through ${fresh.freshnessIso.slice(0, 10)}, from my ${label} read.`;
}

function defaultSpeakerForClass(dossier: AskDossier): AskAnswer["speaker"] {
  return dossier.facts[0]?.source ?? "llm";
}

/**
 * Compose the answer for one question. Budget-gated LLM first, deterministic fallback
 * always available. `complete` is injectable for tests (matches structured-drafter's
 * own test seam) so this never makes a real network call in vitest.
 */
export async function composeAskAnswer(
  question: string,
  dossier: AskDossier,
  opts: { complete?: CompleteFn; now?: Date } = {},
): Promise<AskAnswer> {
  if (!dossier.hasData) return fallbackAnswer(question, dossier);

  // W9 slice 1 (2026-07-09) - locked operator decision: deterministic count/rank/list
  // questions bypass the LLM outright, every time, not only as a budget/failure
  // fallback. The facts already say the number/order/list in plain English; composing
  // further through the LLM only risks the numeric-fidelity firewall for zero benefit.
  if (isDeterministicQuestionShape(question, dossier.questionClass)) {
    return fallbackAnswer(question, dossier);
  }

  const grounded = factsToPrompt(dossier);
  const user = [`Question: "${question}"`, "", "Facts I have:", grounded, "", "Return the JSON now."].join("\n");

  const result = await callStructuredLLM({
    kind: "ask_answer",
    system: askAnswerSystemPrompt(),
    user,
    grounded,
    projectedCostUsd: 0.01,
    maxTokens: 1200,
    timeoutMs: 45_000,
    complete: opts.complete,
    now: opts.now,
  });

  if (result.status !== "drafted") {
    return fallbackAnswer(question, dossier);
  }

  // Guard against a fabricated href even though the firewall already checked numbers:
  // only keep citedFacts whose href matches a fact we actually provided (a made-up link
  // would send the operator nowhere real). Drop, never crash, on a mismatch.
  const validHrefs = new Set(dossier.facts.map((f) => f.href));
  const citedFacts = result.value.citedFacts.filter((c) => validHrefs.has(c.href));
  if (citedFacts.length === 0) return fallbackAnswer(question, dossier);

  return {
    speaker: result.value.speaker,
    answer: result.value.answer,
    citedFacts,
    source: "llm",
  };
}

/** Exposed for tests: verifies the identity lookup never crashes on the speaker key
 *  an LLM returns (teammateOf tolerates unknown keys). */
export { teammateOf };
