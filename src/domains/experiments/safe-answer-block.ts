/**
 * safe-answer-block (2026-06-30) — the third safe daily lever, and the highest factual-risk one, so
 * V1 is strictly EXTRACTIVE: it finds a page that already contains a direct, trustworthy answer to a
 * real question but BURIES it (not the page's lead sentence), and proposes MOVING that exact sentence
 * to the top. The "answer" is a verbatim slice of the page's own crawled body — no LLM, no
 * fabrication, no invented atom. A deterministic factual firewall additionally REJECTS surfacing
 * volatile facts (population/"currently"/recent-year current-status) and unsupported superlatives/
 * status claims ("largest"/"first"/"national"/"endangered"). If no airtight buried answer exists,
 * emit nothing. PURE, $0, no live fetch.
 */

import { classifyOneQuery, scoreAnswerForIntent, type QueryIntent } from "./answer-intent";

// Body-paragraph source is in DOCUMENT ORDER (extractor.ts: contentRoot.find("p").each).
const COPULA = /\b(is|are|was|were|refers to|describes|denotes|means|consists of)\b/i;
const DANGLE = /^(it|its|they|their|them|this|these|those|he|she|his|her|however|therefore|also|moreover|thus|then|in addition|such|furthermore|additionally|instead|meanwhile)\b/i;
const SENTENCE_END = /[.!?]$/;
// A "weak lead" answers WHERE/WHAT-IS-NEAR rather than WHAT-IS — and is a factual-accuracy hazard for
// an extractive lever (e.g. "Shiraz is home to Persepolis…" — Persepolis is NEAR, not IN, Shiraz). We
// never surface a containment/proximity/enumeration sentence as the page's lead answer.
const WEAK_ANSWER_LEAD = /\b(?:is|are|was|were)\s+(?:home to|located (?:in|near|within|on|at|close)|situated (?:in|near|on|at)|near|next to|close to|adjacent to|surrounded by|famous for|known for|renowned for|noted for|best known for|part of)\b/i;
// The intent-fit floor for a NON-definitional query (when/cost/how/where/who/list/compare): if no
// on-page sentence clears it, emit an honest GAP instead of moving a definition to the top for a
// question it does not answer. (A "what" query keeps the lenient definitional-then-topical fallback.)
const INTENT_MIN_FIT = 0.5;

// Factual-safety patterns — surfacing these to the lead answer needs editorial/freshness checks the
// lever can't do, so V1 rejects them outright (airtight over comprehensive).
const VOLATILE = /\b(currently|as of|right now|nowadays|to date|present[- ]day|population|populated|populace|residents|inhabitants|inhabited|demographic|census)\b/i;
const BIG_NUMBER = /\b\d{1,3}(?:,\d{3})+\b/; // 1,184,788 — comma-formatted population-scale figures
const POP_NUMBER = /\b\d+(?:\.\d+)?\s*(?:million|billion|thousand|crore|lakh)\b/i; // "2 million", "88 million", "1.8 million"
const RECENT_YEAR_STATUS = /\b(?:in|since|as of|by)\s+20[2-9]\d\b/i; // "as of 2024" current-status
const SUPERLATIVE = /\b(largest|biggest|smallest|oldest|newest|longest|tallest|highest|only|first|finest|greatest|leading|foremost|official|national|world['’]?s|critically endangered|endangered|extinct|vulnerable)\b/i;
const SUPERLATIVE_PHRASE = /\b(the most|the best|the largest|the oldest|the first|the only)\b/i;

const ENTITY_STOP = new Set([
  "the", "a", "an", "of", "and", "in", "on", "for", "to", "iran", "iranian", "persian", "rug",
  "rugs", "flag", "flags", "history", "guide", "city", "cities", "empire", "dynasty", "caliphate",
]);
/** The distinctive head token of a page's entity (from its slug label). */
export function entityHead(label: string): string | null {
  const t = label.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !ENTITY_STOP.has(w));
  return t[0] ?? null;
}

function sentences(paragraph: string): string[] {
  return paragraph.match(/[^.!?]+[.!?]+(\s|$)|\S[^.!?]*$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

function capTokens(s: string): Set<string> {
  // crude proper-noun / number atoms (skip the leading word, which is always capitalized)
  const out = new Set<string>();
  const words = s.split(/\s+/);
  words.forEach((w, i) => {
    const clean = w.replace(/[^A-Za-z0-9–-]/g, "");
    if (!clean) return;
    if (/\d/.test(clean)) out.add(clean.toLowerCase());
    else if (i > 0 && /^[A-Z]/.test(clean) && clean.length > 2) out.add(clean.toLowerCase());
  });
  return out;
}

export type AnswerFactualSafety = {
  volatileClaims: string[];
  superlatives: string[];
  unsupportedNumbers: string[];
  unsupportedNames: string[];
  passed: boolean;
  reasons: string[];
};

/** Reject volatile/superlative content, and (for any non-exact answer) any atom not present in the
 *  source. For an exact move, `answer` IS a source sentence → atom checks trivially pass. */
export function checkAnswerFactualSafety(answer: string, sourceSentences: string[]): AnswerFactualSafety {
  const reasons: string[] = [];
  const volatileClaims = [VOLATILE, BIG_NUMBER, POP_NUMBER, RECENT_YEAR_STATUS].flatMap((re) => answer.match(re) ?? []);
  const superlatives = [SUPERLATIVE, SUPERLATIVE_PHRASE].flatMap((re) => answer.match(re) ?? []);
  const sourceAtoms = new Set<string>(sourceSentences.flatMap((s) => [...capTokens(s)]));
  const answerAtoms = [...capTokens(answer)];
  const unsupported = answerAtoms.filter((a) => !sourceAtoms.has(a));
  const unsupportedNumbers = unsupported.filter((a) => /\d/.test(a));
  const unsupportedNames = unsupported.filter((a) => !/\d/.test(a));
  if (volatileClaims.length) reasons.push(`volatile: ${volatileClaims.join(", ")}`);
  if (superlatives.length) reasons.push(`unsupported superlative/status: ${superlatives.join(", ")}`);
  if (unsupportedNumbers.length) reasons.push(`unsupported number(s): ${unsupportedNumbers.join(", ")}`);
  if (unsupportedNames.length) reasons.push(`unsupported entity(ies): ${unsupportedNames.join(", ")}`);
  return {
    volatileClaims, superlatives, unsupportedNumbers, unsupportedNames,
    passed: volatileClaims.length === 0 && superlatives.length === 0 && unsupportedNumbers.length === 0 && unsupportedNames.length === 0,
    reasons,
  };
}

export type SafeAnswerBlockProposal = {
  question: string;
  answerText: string; // verbatim source sentence (the exact buried answer)
  sourceSentence: string;
  paragraphIndex: number;
  sentenceIndex: number;
  operation: "move_existing_text" | "copy_existing_text" | "add_new_text";
  supportMode: "exact_sentence" | "written_answer";
  proposedLocation: "below_h1";
  exactInstruction: string;
  rollbackInstruction: string;
  factualSafety: AnswerFactualSafety;
  fetchedAt?: string;
};

/**
 * Propose a safe, extractive answer block. PURE. Returns null unless the page contains a direct,
 * standalone, firewall-clean answer sentence that is currently BURIED (not the lead sentence).
 */
export function proposeSafeAnswerBlock(input: {
  label: string;
  h1: string | null;
  topQuery: string;
  bodyParagraphs: string[];
  fetchedAt?: string;
}): SafeAnswerBlockProposal | null {
  const head = entityHead(input.h1 && entityHead(input.h1) ? input.h1 : input.label) ?? entityHead(input.label);
  if (!head) return null;
  const paras = input.bodyParagraphs.map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length >= 40);
  if (paras.length === 0) return null;

  // Scan in document order, COLLECTING every direct-answer sentence (entity head in the opening, a
  // copula early, not dangling, complete, standalone, firewall-clean, and NOT a weak where/near lead).
  // Then prefer a DEFINITIONAL sentence ("X is a/an/the …") over any other — a definition answers the
  // page's primary intent, an enumeration/proximity sentence does not (and risks a geography error).
  const headRe = new RegExp(`\\b${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  type Cand = { sent: string; pi: number; si: number };
  const cands: Cand[] = [];
  for (let pi = 0; pi < paras.length; pi++) {
    const ss = sentences(paras[pi]);
    for (let si = 0; si < ss.length; si++) {
      const sent = ss[si];
      const opening = sent.split(/\s+/).slice(0, 8).join(" ").toLowerCase();
      if (!headRe.test(opening)) continue; // whole-word head match (don't let "art" match "Bharat")
      if (!COPULA.test(sent.split(/\s+/).slice(0, 10).join(" "))) continue;
      if (DANGLE.test(sent)) continue;
      if (!SENTENCE_END.test(sent)) continue; // complete sentence only
      const words = sent.split(/\s+/).length;
      if (words < 6 || words > 45) continue; // standalone, not a fragment, not a paragraph
      if (pi === 0 && si === 0) return null; // page already leads with this answer → no gap
      if (WEAK_ANSWER_LEAD.test(sent)) continue; // "is home to / located near / famous for …" — not a definition
      if (!checkAnswerFactualSafety(sent, [sent]).passed) continue; // volatile/superlative → skip this one
      cands.push({ sent, pi, si });
    }
  }
  if (cands.length === 0) return null; // no airtight, definitional-grade buried answer → emit nothing
  // REASONING (2026-06-30) — match the answer to what people ACTUALLY search, not just "is it a
  // definition". The old code blindly preferred the first DEFINITIONAL sentence and ignored topQuery,
  // so "chaharshanbe suri 2026" (a WHEN/date query) surfaced the festival's *definition* instead of a
  // date. We now classify the top query's intent (answer-intent.ts) and pick the firewall-clean
  // candidate that best ANSWERS it (a date for "when", a definition for "what", …). For a
  // non-definitional intent, if nothing on the page answers the real question we emit an honest GAP
  // (null) rather than promoting a definition — the LLM writer / operator fills that gap. "what"
  // keeps the prior lenient behavior (a topical sentence is an acceptable fallback).
  const intent = classifyOneQuery(input.topQuery);
  const ranked = cands
    .map((c) => ({ c, fit: scoreAnswerForIntent(c.sent, intent) }))
    .sort((a, b) => b.fit - a.fit || a.c.pi - b.c.pi || a.c.si - b.c.si);
  const top = ranked[0]!;
  if (intent !== "what" && top.fit < INTENT_MIN_FIT) return null; // page answers the wrong question → gap
  const { sent, pi, si } = top.c;
  const factualSafety = checkAnswerFactualSafety(sent, [sent]);
  const operation = si === 0 ? "move_existing_text" : "copy_existing_text"; // clean move only when it's a whole paragraph's lead
  // Clean the entity for the question: drop separator + "by <Brand>" suffixes ("Finglish by
  // Iranopedia" → "Finglish") but keep legitimate "X by the Y" (lowercase next word) titles.
  const entity = (input.h1 || input.label).replace(/\s*(?:[|·•\-–—].*|\bby\b\s+[A-Z].*)$/, "").trim() || input.label;
  const question = `What is ${entity}?`;
  const exactInstruction = operation === "move_existing_text"
    ? `Wix CMS → page body → find this exact sentence: "${sent}" → MOVE it directly below the H1 (above the first descriptive paragraph). Do not change the title, meta, H1, remaining body, links, or schema.`
    : `Wix CMS → page body → copy this exact sentence to a short answer line directly below the H1: "${sent}" — leave the original in place. Do not change the title, meta, H1, other body, links, or schema.`;
  const rollbackInstruction = operation === "move_existing_text"
    ? `Move the sentence back to paragraph ${pi + 1} where it was.`
    : `Delete the answer line below the H1 (the original sentence stays untouched).`;
  return {
    question, answerText: sent, sourceSentence: sent, paragraphIndex: pi, sentenceIndex: si,
    operation, supportMode: "exact_sentence", proposedLocation: "below_h1",
    exactInstruction, rollbackInstruction, factualSafety, fetchedAt: input.fetchedAt,
  };
}

/** A page that LACKS an on-page answer to what people actually search — the LLM should WRITE one. */
export type AnswerGap = {
  /** The plain question the page should answer first (e.g. "When is Chaharshanbe Suri?"). */
  question: string;
  /** The dominant intent (when/cost/how/…) the written answer must satisfy. */
  intent: QueryIntent;
  /** The clean entity label (for grounding + display). */
  entity: string;
};

const INTENT_QUESTION: Record<QueryIntent, (e: string) => string> = {
  when: (e) => `When is ${e}?`,
  cost: (e) => `How much does ${e} cost?`,
  how: (e) => `How do you do ${e}?`,
  where: (e) => `Where is ${e}?`,
  who: (e) => `Who is ${e}?`,
  list: (e) => `What are the best ${e}?`,
  compare: (e) => `${e}: what is the difference?`,
  what: (e) => `What is ${e}?`,
};

/**
 * Detect an ANSWER GAP: the page has a clear entity + demand, but no firewall-clean on-page sentence
 * answers the top query's intent AND it does not already lead with such an answer. Returns the
 * question + intent the LLM should WRITE (grounded in the page body), which the operator approves
 * before it goes live. Returns null when the page already answers well (the extractive lever handles
 * it) or there is no usable entity/body. PURE, $0 — the LLM write happens in the async caller.
 */
export function proposeAnswerGap(input: {
  label: string;
  h1: string | null;
  topQuery: string;
  bodyParagraphs: string[];
}): AnswerGap | null {
  const entity = (input.h1 || input.label).replace(/\s*(?:[|·•\-–—].*|\bby\b\s+[A-Z].*)$/, "").trim() || input.label;
  const head = entityHead(input.h1 && entityHead(input.h1) ? input.h1 : input.label) ?? entityHead(input.label);
  if (!head || !entity) return null;
  const paras = input.bodyParagraphs.map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length >= 40);
  if (paras.length === 0) return null;

  const intent = classifyOneQuery(input.topQuery);
  // Already leads with an intent-matching answer? no gap (the top of the page is fine).
  const firstSent = sentences(paras[0])[0] ?? "";
  if (firstSent && scoreAnswerForIntent(firstSent, intent) >= INTENT_MIN_FIT) return null;
  // A buried extractive answer exists? the extractive lever handles it — not a write gap.
  if (proposeSafeAnswerBlock(input)) return null;

  return { question: INTENT_QUESTION[intent](entity), intent, entity };
}

/**
 * Build an "add a written answer" proposal from an LLM-written sentence (the daily batch's D-2 path).
 * The operation is add_new_text: the operator ADDS this new short answer line below the H1 (there is
 * no source sentence to move). Verification is identical to the extractive case (the text must appear
 * as a near-top content paragraph), so no verifier change is needed. The written text was already
 * numeric-fidelity + safety firewalled by the structured drafter at write time.
 */
export function buildWrittenAnswerProposal(args: {
  question: string;
  writtenText: string;
  fetchedAt?: string;
}): SafeAnswerBlockProposal {
  const t = args.writtenText.trim();
  return {
    question: args.question,
    answerText: t,
    sourceSentence: t,
    paragraphIndex: -1,
    sentenceIndex: -1,
    operation: "add_new_text",
    supportMode: "written_answer",
    proposedLocation: "below_h1",
    exactInstruction: `Wix CMS → page body → ADD this new short answer line directly below the H1 (above the first paragraph): "${t}". Do not change the title, meta, H1, other body, links, or schema.`,
    rollbackInstruction: `Delete the answer line you added below the H1.`,
    factualSafety: { passed: true, reasons: ["written by the LLM under the numeric-fidelity and safety firewall at draft time"], volatileClaims: [], superlatives: [], unsupportedNumbers: [], unsupportedNames: [] },
    fetchedAt: args.fetchedAt,
  };
}
