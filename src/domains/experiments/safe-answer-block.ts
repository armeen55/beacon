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

// Body-paragraph source is in DOCUMENT ORDER (extractor.ts: contentRoot.find("p").each).
const COPULA = /\b(is|are|was|were|refers to|describes|denotes|means|consists of)\b/i;
const DANGLE = /^(it|its|they|their|them|this|these|those|he|she|his|her|however|therefore|also|moreover|thus|then|in addition|such|furthermore|additionally|instead|meanwhile)\b/i;
const SENTENCE_END = /[.!?]$/;

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
  operation: "move_existing_text" | "copy_existing_text";
  supportMode: "exact_sentence";
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

  // Scan in document order for the FIRST direct-answer sentence: entity head appears in the opening,
  // a copula appears early, it doesn't start with a dangling pronoun, and it's a complete sentence.
  for (let pi = 0; pi < paras.length; pi++) {
    const ss = sentences(paras[pi]);
    for (let si = 0; si < ss.length; si++) {
      const sent = ss[si];
      const opening = sent.split(/\s+/).slice(0, 8).join(" ").toLowerCase();
      // whole-word head match (don't let "art" match "Bharat"/"particle")
      if (!new RegExp(`\\b${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(opening)) continue;
      if (!COPULA.test(sent.split(/\s+/).slice(0, 10).join(" "))) continue;
      if (DANGLE.test(sent)) continue;
      if (!SENTENCE_END.test(sent)) continue; // complete sentence only
      const words = sent.split(/\s+/).length;
      if (words < 6 || words > 45) continue; // standalone, not a fragment, not a paragraph
      // Already prominent? The page's lead sentence already answers → no gap.
      if (pi === 0 && si === 0) return null;
      const factualSafety = checkAnswerFactualSafety(sent, [sent]);
      if (!factualSafety.passed) return null; // volatile/superlative → emit nothing (airtight)
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
  }
  return null;
}
