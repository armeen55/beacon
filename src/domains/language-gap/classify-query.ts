/**
 * language-gap/classify-query (2026-07-02, master plan item 24) - PURE.
 *
 * Classifies a search query by SCRIPT (what characters it is written in) and
 * LANGUAGE (what tongue it is really asking in). This is the foundation of
 * the Farsi / Finglish language-gap matrix: before we can say "this page gets
 * Farsi-script demand but has no Farsi content" we first need to know, for
 * every query, whether it arrived in the site's native script, in a Latin
 * transliteration of that language, or in plain English.
 *
 * TENANT-AGNOSTIC BY DESIGN: nothing here hardcodes "Persian" as a language.
 * Script detection is generic Unicode-range math (any tenant's native script
 * works the same way). Romanization/transliteration detection is driven by a
 * pluggable folding table (see variant-folding.ts) - the Persian table is the
 * first one shipped, not the only one this code can ever support. A Spanish-
 * restaurant tenant would get Spanish (native Latin script) vs English the
 * same way; a "Spanglish" table could plug in without touching this file.
 *
 * Deterministic, $0, no I/O, no LLM.
 */

export type QueryScript = "arabic_fa" | "latin" | "mixed" | "other";
export type QueryLanguage = "fa" | "finglish" | "en" | "unknown";

export type QueryClassification = {
  script: QueryScript;
  language: QueryLanguage;
  /** 0..1. High when the signal is unambiguous (all-Farsi-script, or a
   *  strong romanization-pattern match); low when we are guessing. */
  confidence: number;
};

/** Unicode ranges covering Arabic, Arabic Supplement, and Arabic Presentation
 *  Forms - the block Persian/Farsi script (and Arabic loanwords Farsi keeps)
 *  is written in. Persian adds four letters (پ چ ژ گ) that already live inside
 *  the base Arabic block, so one range test covers real-world Farsi text. */
const ARABIC_SCRIPT_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/u;
/** Basic Latin letters (the script Finglish/English queries are written in). */
const LATIN_LETTER_RE = /[A-Za-z]/;

/**
 * Persian romanization digraph/pattern signals - the spelling habits people
 * fall into when typing Farsi words with a Latin keyboard (no formal
 * transliteration standard is enforced, so these are the CONSISTENT tells,
 * not a lookup of exact words). Every pattern is anchored to a WORD START
 * (\b before the digraph) because that is where Farsi romanization actually
 * produces these clusters (kh-, gh-, ch- as a syllable onset); matching them
 * mid-word or word-final is exactly what produces false positives on
 * ordinary English words that happen to contain the same two letters
 * (cheetah's "ch"+"ee", genghis/khan's "gh"+"kh" mid/end-word):
 *
 *   - "kh-" for خ (khoresht, khaneh)
 *   - "gh-" for the uvular ق/غ (ghormeh, ghazal)
 *   - "ch-" for چ (chaharshanbe, chelo)
 *   - "aa" / "ee" / "oo" double-vowels standing in for the long vowels
 *     Persian marks with a single character (norooz, sabzi, aash) - kept
 *     un-anchored since these appear mid-word, but weighted lightly (see
 *     below) because English also uses them ("coffee", "book").
 *   - a digit standing in for a dropped letter/number word, the "leet"
 *     habit some Finglish typists use for the Farsi word for a number
 *     (4shanbe = chahar+shanbe, "4" reads as "chahar")
 *   - the "eh" word-final vowel Farsi speakers add to spell the short "e"
 *     sound English spelling would otherwise drop (chaharshanbeh, hafteh)
 */
/** Word-initial consonant-cluster tells: rare at the START of an English
 *  word (khaki/khan/ghost/ghee are the practical English exceptions), common
 *  at the start of a Finglish word. Each is a FULL signal on its own. */
const FINGLISH_ONSET_PATTERNS: readonly RegExp[] = [/\bkh/i, /\bgh/i, /\bch/i];
/** Mid-word double-vowel / word-final "eh" tells: real Persian signals, but
 *  also common in ordinary English ("coffee", "book", "moon") - each counts
 *  as only a HALF signal, so one alone never tips the call, but combined
 *  with an onset tell (or with each other) they corroborate it. */
const FINGLISH_VOWEL_PATTERNS: readonly RegExp[] = [/aa/i, /ee/i, /oo/i, /eh(?:[\s-]|$)/i];
/** A leading digit standing in for a Farsi number word (4shanbe, 3shanbeh). */
const FINGLISH_DIGIT_PREFIX_RE = /\b\d+\s*shanbe/i;

/** Classify the SCRIPT of one query: which Unicode block(s) its letters use. */
export function classifyScript(query: string): QueryScript {
  const hasArabic = ARABIC_SCRIPT_RE.test(query);
  const hasLatin = LATIN_LETTER_RE.test(query);
  if (hasArabic && hasLatin) return "mixed";
  if (hasArabic) return "arabic_fa";
  if (hasLatin) return "latin";
  return "other";
}

/**
 * Finglish likelihood score over a Latin-script string: sums weighted
 * romanization signals (word-initial consonant clusters count full, mid-word
 * double-vowels count half, digit-for-word and known-root hits are near-
 * certain) - the more independent signals present, the more confidently this
 * is a transliterated Farsi query rather than plain English. Doubled so the
 * threshold comparisons in classifyQuery can stay integer-based.
 */
function finglishSignalScoreX2(lower: string, knownRoots: readonly string[]): number {
  let scoreX2 = 0;
  for (const pattern of FINGLISH_ONSET_PATTERNS) {
    if (pattern.test(lower)) scoreX2 += 2; // full signal
  }
  for (const pattern of FINGLISH_VOWEL_PATTERNS) {
    if (pattern.test(lower)) scoreX2 += 1; // half signal (English shares these)
  }
  if (FINGLISH_DIGIT_PREFIX_RE.test(lower)) scoreX2 += 4; // near-certain tell
  for (const root of knownRoots) {
    if (root && lower.includes(root)) {
      scoreX2 += 4; // a direct hit against a known romanization is a strong tell
      break;
    }
  }
  return scoreX2;
}

export type ClassifyQueryOptions = {
  /** Known Latin-script roots for the folding table's language (lowercased
   *  substrings such as "chaharshanbe", "norooz", "khoresht"). Optional - the
   *  digraph heuristics alone still catch most cases; passing the folding
   *  table's known roots sharpens confidence and catches short queries the
   *  digraph test would otherwise miss. */
  knownLatinRoots?: readonly string[];
};

/**
 * classifyQuery(q) -> {script, language, confidence}.
 *
 * - Any Farsi/Arabic-script letters present -> language "fa" (script
 *   "arabic_fa" if pure, "mixed" if Latin letters are also present, e.g. a
 *   brand name in English alongside a Farsi phrase).
 * - Pure Latin script: run the Finglish detector. Two or more independent
 *   romanization signals (or one near-certain tell, or a direct hit against a
 *   known root) -> "finglish". Otherwise -> "en".
 * - Empty / no letters at all -> "unknown", confidence 0.
 */
export function classifyQuery(query: string, options: ClassifyQueryOptions = {}): QueryClassification {
  const q = (query ?? "").trim();
  if (!q) return { script: "other", language: "unknown", confidence: 0 };

  const script = classifyScript(q);

  if (script === "arabic_fa") {
    return { script, language: "fa", confidence: 0.98 };
  }
  if (script === "mixed") {
    // Farsi-script letters dominate the language call even alongside Latin
    // characters (a brand name, a digit) - the query is still asking in Farsi.
    return { script, language: "fa", confidence: 0.85 };
  }
  if (script === "other") {
    // No letters at all (pure digits/punctuation) - nothing to classify.
    return { script, language: "unknown", confidence: 0 };
  }

  // Pure Latin script from here on - decide English vs Finglish.
  const lower = q.toLowerCase();
  const knownRoots = options.knownLatinRoots ?? [];
  const scoreX2 = finglishSignalScoreX2(lower, knownRoots);

  // Threshold is 4 (= 2 "full" signal points): either two word-initial onset
  // tells (kh-/gh-/ch-), one onset tell plus two vowel tells, or a single
  // near-certain tell (digit-prefix / known-root, each worth 4 on their own).
  // A single onset tell alone (2) or any number of vowel-only tells (each
  // worth 1, and vowel patterns alone are common in plain English: "coffee",
  // "book", "moon") never crosses this on their own.
  if (scoreX2 >= 4) {
    // Higher score -> higher confidence, capped so we never claim certainty
    // from a heuristic (a real transliteration standard does not exist).
    const confidence = Math.min(0.5 + scoreX2 * 0.06, 0.92);
    return { script: "latin", language: "finglish", confidence };
  }
  if (scoreX2 > 0) {
    // A lone soft signal (one onset tell, or vowel tells alone) is common in
    // ordinary English too ("teacher", "cheetah", "coffee") - too weak to
    // call Finglish by itself.
    return { script: "latin", language: "en", confidence: 0.55 };
  }
  return { script: "latin", language: "en", confidence: 0.8 };
}
