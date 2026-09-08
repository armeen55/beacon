/**
 * factual-entailment: a PURE, deterministic check that every checkable assertion in a draft is GROUNDED in
 * something this pass actually holds: the target page's own stored body, the evidence text handed to the drafter, or the query itself. Numbers and dates, named entities and superlatives are the three things a
 * model invents most readily and a reader can least easily catch.
 *
 * TWO OUTCOMES, AND ONLY ONE OF THEM BLOCKS. A VIOLATION is an assertion with no grounding anywhere: the draft
 * is unverified and its copy is withheld. A CORRECTION is a dated, sourced statement that contradicts what the
 * page says today, which is the whole point of some changes, so it is surfaced WITH the draft rather than used to reject it. No LLM, no I/O, no clock beyond the date the caller supplies.
 */
/** A dated, sourced fact Beacon already has on file (a connector row, a stored
 *  source, an evidence-packet entry with real provenance) - NOT the page's own
 *  text, which is handled separately via `pageBodyText`. Any claim backed by
 *  one of these is an ALLOWED CORRECTION even when it contradicts the page. */
export type AuthoritativeFact = {
  /** Where this fact comes from, plain English (e.g. "Search Console",
   *  "your GA4 connection", "the competitor page you cited"). Never a raw
   *  code - this string is shown to the operator verbatim. */
  source: string;
  /** ISO date (or a plain-English date string) the fact was observed/recorded. */
  date: string;
  /** The fact itself, in plain English, containing the number/entity/claim. */
  detail: string;
};

type FactualEntailmentInput = {
  /** The draft text to verify (answer block body, atomic-edit "after", etc). */
  draftText: string;
  /** The target page's OWN stored body text (page_snapshots body_paragraph_sample
   *  joined, N19). Null/empty when no snapshot body exists yet - the gate still
   *  runs against query + evidence + dated facts, it just has one less
   *  grounding source. The page is NOT authoritative over a dated correction. */
  pageBodyText?: string | null;
  /** Flattened evidence-packet / evidenceRefs text (numbers, facts, competitor
   *  teardown detail), the same kind of blob structured-drafter's firewall
   *  already builds from `grounded`. Undated - grounds a claim but never
   *  produces a "correction" finding (that requires a real date + source; see
   *  authoritativeFacts). */
  evidenceText?: string | null;
  /** The query/topic this draft answers - its own words are always "grounded"
   *  (e.g. a year mentioned in the query itself is not an invented fact). */
  query?: string | null;
  /** Dated, sourced facts Beacon already has on file. A claim backed by one of
   *  these is an allowed correction even when it contradicts the page body. */
  authoritativeFacts?: readonly AuthoritativeFact[];
  /** Reference year for allowing "this year / next year" style numbers, same
   *  convention as structured-drafter's `nowYear`. Defaults to the real year. */
  nowYear?: number;
};

type EntailmentFindingKind = "violation" | "correction";

type EntailmentFinding = {
  kind: EntailmentFindingKind;
  /** Plain-English, operator-facing line, never in the first person. For a violation: "This draft says
   *  ..., and that ... is not on your page ... Check it before you paste." For a
   *  correction: "This draft updates 'X' to 'Y' based on <source>, <date>.
   *  Your page currently says 'X'." */
  message: string;
  /** The dated source backing a correction. Always null on a violation. */
  source?: string;
  date?: string;
};

type FactualEntailmentResult = {
  /** True only when there are zero VIOLATIONS. Corrections do not block. */
  entailed: boolean;
  /** Unsupported-invention findings (blocks auto-publish). Plain-English. */
  violations: string[];
  /** Sourced-correction findings (does not block; caller may auto-publish
   *  and should show the explanation alongside the draft). */
  corrections: string[];
  /** Every finding, in the order detected, with full source/date detail -
   *  the structured form `violations`/`corrections` are flattened from. */
  findings: EntailmentFinding[];
};

// ── shared grounding-number logic (mirrors structured-drafter.ts's
//    runContentFirewalls exactly, so the two firewalls never disagree about
//    what counts as an invented number) ──────────────────────────────────────

const stripThousands = (s: string) => s.replace(/(?<=\d),(?=\d)/g, "");

/** W5 stop-ship F2 (2026-07-09): exported additively so source-authority.ts's
 *  `findSupportingSpan` shares the EXACT same grounded-number semantics this
 *  gate uses (thousands normalized, year-adjacent + 7/14/28 proof windows
 *  allowed) - the span verifier and this entailment gate must never disagree
 *  about what counts as grounded. Behavior unchanged for every existing caller. */
export function groundedNumberSet(grounded: string, nowYear: number): Set<string> {
  const set = new Set(stripThousands(grounded).match(/\d+/g) ?? []);
  for (const y of [nowYear - 1, nowYear, nowYear + 1]) set.add(String(y));
  // Proof-window methodology constants (7/14/28-day measurement) are structural language, not factual claims about the page's subject.
  for (const w of [7, 14, 28]) set.add(String(w));
  return set;
}

/** W5 stop-ship F2: exported additively (see groundedNumberSet). Multi-digit
 *  numbers in a text, thousands-separators normalized. */
export function draftNumbers(text: string): string[] {
  return (stripThousands(text).match(/\d+/g) ?? []).filter((n) => n.length >= 2);
}

// ── named-entity extraction (lightweight, no NLP dependency) ────────────────

/** Common sentence-initial / generic capitalized words that are NOT entities on
 *  their own - excluding these keeps the check from flagging every sentence
 *  opener as an "unsupported entity". Deliberately generic English function
 *  words, not tenant vocabulary (English-first product; no per-tenant lists). */
const GENERIC_CAPITALIZED = new Set([
  "the", "a", "an", "this", "that", "these", "those", "it", "its", "in", "on",
  "at", "for", "with", "and", "or", "but", "as", "of", "to", "from", "by",
  "is", "are", "was", "were", "has", "have", "had", "will", "would", "can",
  "could", "should", "may", "might", "one", "two", "three", "some", "many",
  "most", "each", "every", "today", "here", "there", "what", "who", "when",
  "where", "why", "how", "faq", "q", "a.", "we", "you", "your", "our", "i",
  "they", "he", "she", "new", "old", "top", "best", "guide", "complete",
  // Generic marketing / section-header vocabulary common in titles and metas ("Top Picks", "Travel Guide", "Practical Info", "Fun Facts") - these are
  // boilerplate structure words, not proper-noun claims, no matter how many of them appear adjacent to each other in a title.
  "picks", "info", "information", "guide", "guides", "tips", "facts", "fact",
  "fun", "travel", "practical", "overview", "basics", "essentials", "faqs",
  "shop", "shopping", "exclusive", "sale", "deal", "deals", "collection",
]);

/** Strip a trailing site-brand suffix from a title/meta before entity
 *  extraction ("Persian Onager | iranopedia", "Nowruz - MySite") - almost
 *  every title on every site appends its own brand name this way, and it is
 *  never a "fabricated" claim (it is the site's own name, trivially true).
 *  Generic on purpose - no hardcoded brand list (English-first, no
 *  tenant-specific vocabulary): any short trailing segment after the LAST
 *  "|" or " - " separator is dropped, capped at 3 words so a real multi-word
 *  subtitle before a colon is never eaten. */
function stripTrailingBrandSuffix(text: string): string {
  const sepIdx = Math.max(text.lastIndexOf("|"), text.lastIndexOf(" - "));
  if (sepIdx < 0) return text;
  const suffix = text.slice(sepIdx + 1).trim();
  if (suffix.split(/\s+/).length <= 3) return text.slice(0, sepIdx).trim();
  return text;
}

/** True when most words in the text are capitalized - a title/headline
 *  ("Persian New Year: 3000 Years of Nowruz Traditions in Iran") rather than
 *  sentence-case prose. Title Case capitalizes ordinary marketing/section
 *  words too ("Shop", "Exclusive", "History", "Fun Facts"), so NEITHER a
 *  multi-word run NOR a lone capitalized word there is a reliable proper-noun
 *  signal the way it is in sentence-case prose - ground-truth verification
 *  against real Iranopedia titles (N8, 2026-07-02) found single generic words
 *  ("Shop", "History", "Facts") and the site's own brand suffix ("Iranopedia")
 *  false-flagged on nearly every real title. Titles only check spans of 2+
 *  words - the real risk in a title is a fabricated multi-word proper noun
 *  ("Queen Farah Pahlavi"), not an ordinary word that happens to be
 *  capitalized because the whole string is Title Case. */
function isTitleCase(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  if (words.length < 3) return false;
  const capitalized = words.filter((w) => /^[A-Z]/.test(w)).length;
  return capitalized / words.length >= 0.6;
}

/** A run of 1-4 capitalized words (proper-noun-shaped span), e.g. "Iran",
 *  "Persian Gulf", "Asiatic Cheetah". Skips a span that is only the first word
 *  of a sentence AND a single generic word (avoids flagging "The" / "This" as
 *  an entity). In title-cased text (see isTitleCase), single-word spans are
 *  dropped entirely - see isTitleCase for why. Returns unique spans,
 *  longest-first so a multi-word entity is checked as a whole before its
 *  component words. */
export function extractCapitalizedSpans(text: string): string[] {
  const titleCased = isTitleCase(text), scanned = (titleCased ? stripTrailingBrandSuffix(text) : text).replace(/^\s*\|.*\|\s*\r?\n\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/gm, "").replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/gm, "");
  // A CAPITAL THAT ONLY MEANS "A SENTENCE STARTS HERE" IS NOT PART OF A NAME. Glued to the proper noun beside
  // it, it invented entities no page could ever ground: "No Achaemenid flag has survived" was refused because
  // the site does not print "No Achaemenid", though it prints Achaemenid on every line. A sentence-initial
  // span is checked from its SECOND word, so the real name is what has to be found and a genuinely invented
  // one still is. Nothing is loosened mid-sentence, where a capital does carry a claim.
  // THE SAME PRINCIPLE FINISHES THE JOB ON A LONE WORD: a single sentence-initial span has no capital except the sentence's own, so it is dropped, not looked up ("Common", "Distinct", "Key" each cost a deliverable). A list line and a bullet open a sentence too; mid-sentence a lone capital carries a claim and is still checked.
  const initial = (i: number): boolean => i === 0 || /(?:[.!?:]["')\]]?\s+|\n\s*(?:[-*•]|#{1,6})\s+|^\s*#{1,6}\s+)$/.test(scanned.slice(0, i));
  // A NAME DOES NOT RUN ACROSS A LINE BREAK: `\s+` swallowed it, so "...to Iran\nThese are..." was reported as one invented entity, `Iran These`, and refused a page.
  const spans = [...scanned.matchAll(/\b[A-Z][a-zA-Z'-]*(?:[ \t]+[A-Z][a-zA-Z'-]*){0,3}\b/g)].map((m) =>
    !initial(m.index) ? m[0] : m[0].includes(" ") ? m[0].slice(m[0].indexOf(" ") + 1) : "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of spans) {
    const span = raw.trim();
    if (!span) continue;
    const words = span.split(/\s+/);
    if (titleCased && words.length === 1) continue;
    // Single-word spans that are common generic/function words never count.
    if (words.length === 1 && GENERIC_CAPITALIZED.has(span.toLowerCase())) continue;
    // A multi-word span made ENTIRELY of generic marketing/section words ("Top Picks", "Travel Guide") is boilerplate structure, not a proper
    // noun - only a span with at least one non-generic word can be a claim.
    if (words.length > 1 && words.every((w) => GENERIC_CAPITALIZED.has(w.toLowerCase()))) continue;
    const key = span.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(span);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Simple plural fold ("traditions" -> "tradition", "years" -> "year") so a
 *  title's plural noun matches a page body's singular mention of the same
 *  word, mirroring the same depluralize used for relevance matching in
 *  evidence-packet.ts (kept as a tiny local copy - no cross-import - since
 *  that module is out of this item's ownership scope). */
function depluralize(w: string): string {
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

function haystackHasWord(word: string, haystackLower: string): boolean {
  if (haystackLower.includes(word)) return true;
  const bare = word.replace(/['\u2019]s?$/, ""), folded = depluralize(bare); // AN APOSTROPHE OF POSSESSION IS NOT PART OF A NAME (live, the 12:00Z tick of 2026-09-05): the sourced pre-1979 flag answer was funded, drafted twice for $0.0099 and refused for naming Iran's, on a page whose every line prints Iran. A possessive belongs to the sentence's grammar, exactly as a hyphen and a plural already do here.
  return (bare !== word && haystackLower.includes(bare)) || (folded !== word && haystackLower.includes(folded));
}

/** True when `entity` (case-insensitive) appears as a substring of `haystack`,
 *  OR every MEANINGFUL word of a multi-word entity appears somewhere in the
 *  haystack (loose match - "Asiatic Cheetah" grounded by a haystack that
 *  separately says "the Asiatic subspecies" and "cheetah population" still
 *  counts, since the underlying fact is present even if not
 *  verbatim-adjacent). Generic words (GENERIC_CAPITALIZED - "New", "Old",
 *  "Top"...) are dropped from the component check the same way they are
 *  dropped from standalone spans, so "Persian New Year" grounds on
 *  "Persian"+"Year" without requiring the page to also contain the word
 *  "new". Singular/plural folded on both the whole span and each word. */
export function entityGrounded(entity: string, haystackLower: string): boolean {
  const lower = entity.toLowerCase();
  if (haystackHasWord(lower, haystackLower)) return true;
  // A HYPHEN IS A SPACE FOR FINDING A NAME: whitespace alone left "white-bellied" one word, so the two-word fallback never ran and a page printing "White Bellied Sea Eagle" could not ground its own bird.
  const words = lower
    .split(/[\s‐-―-]+/)
    .filter((w) => w.length > 2 && !GENERIC_CAPITALIZED.has(w));
  // WHAT IS LEFT AFTER THE GENERIC WORDS IS THE NAME, AND IT IS ASKED ABOUT RATHER THAN REFUSED: requiring two survivors refused "Common Persian" on a page printing Persian on every line, the filter having left exactly the word that carries the claim. Nothing left at all means furniture ("Top Picks"), which is not a name.
  if (words.length === 0) return true;
  return words.every((w) => haystackHasWord(w, haystackLower));
}

// ── superlative check (mirrors draft-quality.ts's STRONG_SUPERLATIVE net,
//    slightly broadened to also catch "the first" / "the tallest" etc, since
//    THOSE specifically need a source sentence, not just a marketing flag) ──

const SUPERLATIVE_CLAIM =
  /\bthe\s+(?:best|only|first|largest|biggest|oldest|newest|tallest|smallest|highest|lowest|longest|shortest|most\s+\w+|world'?s\s+(?:best|largest|oldest|first|leading|tallest))\b/gi;

/** W5 trust-230 (2026-07-09): exported additively so source-authority.ts's
 *  per-claim coverage check treats a superlative sentence as PROTECTED (it
 *  needs a source) using the exact same net this gate uses - the two must
 *  never disagree about what counts as a superlative. Behavior unchanged for
 *  every existing caller. */
export function findSuperlatives(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(SUPERLATIVE_CLAIM)) out.add(m[0].toLowerCase());
  return [...out];
}

// ── the gate ─────────────────────────────────────────────────────────────────

/** Find the FIRST authoritative fact whose detail contains `needle` (case-
 *  insensitive substring). Null when none matches. Facts are checked in the
 *  order supplied - callers should put the most relevant/recent fact first
 *  when it matters which one is cited. */
function findAuthoritativeMatch(
  needle: string,
  facts: readonly AuthoritativeFact[],
): AuthoritativeFact | null {
  const lower = needle.toLowerCase();
  for (const f of facts) {
    if (f.detail.toLowerCase().includes(lower)) return f;
  }
  return null;
}

/**
 * Verify every factual claim in `draftText` is entailed - either grounded (the page body, evidence, query, or a dated fact already contains it), a sourced
 * CORRECTION (contradicts the page but a dated authoritative fact backs the draft's version), or an unsupported INVENTION (found nowhere - a violation).
 * Pure. Returns findings in plain, operator-facing English, never a code or a lint label.
 */
export function checkFactualEntailment(input: FactualEntailmentInput): FactualEntailmentResult {
  const draft = (input.draftText ?? "").trim();
  if (!draft) {
    return { entailed: true, violations: [], corrections: [], findings: [] };
  }

  const nowYear = input.nowYear ?? new Date().getFullYear();
  const pageBody = (input.pageBodyText ?? "").trim();
  const evidence = (input.evidenceText ?? "").trim();
  const query = (input.query ?? "").trim();
  const facts = input.authoritativeFacts ?? [];
  const factsText = facts.map((f) => f.detail).join(" ");
  // "grounded" is page body + evidence + query ONLY - a dated authoritative fact is checked SEPARATELY (see findAuthoritativeMatch below) so a claim
  // backed ONLY by a fact is reported as a "correction", not silently merged into ordinary grounding. Without this separation a claim contradicting a
  // stale page could never be told apart from one that simply already agrees with the page.
  const grounded = [query, pageBody, evidence].filter(Boolean).join(" ");
  const groundedLower = grounded.toLowerCase();
  const groundedOrFactsBlob = [grounded, factsText].filter(Boolean).join(" ");

  // With NO grounding text and NO dated facts at all, this gate has nothing to check claims against - that is an evidence-floor problem (every structured
  // draft already requires evidenceRefs.min(1) upstream), not a per-claim entailment failure, so it abstains rather than flagging every number/entity/superlative as invented.
  if (!groundedOrFactsBlob) {
    return { entailed: true, violations: [], corrections: [], findings: [] };
  }

  const findings: EntailmentFinding[] = [];

  // 1. Numbers / dates - every multi-digit number must be grounded somewhere,
  //    OR backed by a dated authoritative fact (a correction to a stale page).
  const groundedNums = groundedNumberSet(grounded, nowYear);
  const inventedNums = [...new Set(draftNumbers(draft))].filter((n) => !groundedNums.has(n));
  for (const n of inventedNums) {
    const fact = findAuthoritativeMatch(n, facts);
    if (fact) {
      findings.push({
        kind: "correction",
        message: `This draft updates a number to "${n}" based on ${fact.source}, ${fact.date}. Your page does not currently show that number.`,
        source: fact.source,
        date: fact.date,
      });
    } else {
      findings.push({
        kind: "violation",
        message: `This draft says "${n}", and that number is not on your page or in the evidence read for it. Check it before you paste.`,
      });
    }
  }

  // 2. Named entities - every proper-noun-shaped span must appear in the page
  //    body, the query, the evidence, or a dated authoritative fact.
  const entities = extractCapitalizedSpans(draft);
  const alreadyFlaggedNumbers = new Set(inventedNums);
  for (const entity of entities) {
    // Skip a span that is purely a number-adjacent token already covered above.
    if (/^\d+$/.test(entity) || alreadyFlaggedNumbers.has(entity)) continue;
    if (entityGrounded(entity, groundedLower)) continue;
    const fact = findAuthoritativeMatch(entity, facts);
    if (fact) {
      findings.push({
        kind: "correction",
        message: `This draft names "${entity}", based on ${fact.source}, ${fact.date}. Your page does not currently mention that.`,
        source: fact.source,
        date: fact.date,
      });
    } else {
      findings.push({
        kind: "violation",
        message: `This draft names "${entity}", and that name is not on your page, in the query, or in the evidence read for it. Check it before you paste.`,
      });
    }
  }

  // 3. Superlatives - "the largest/first/only ..." needs a source sentence:
  //    the same phrase must be findable on the page, in the evidence, or in a
  //    dated authoritative fact. A superlative asserted from nothing is the
  //    riskiest kind of unsupported claim; a dated, sourced one is a correction.
  const superlatives = findSuperlatives(draft);
  for (const phrase of superlatives) {
    if (groundedLower.includes(phrase)) continue;
    const fact = findAuthoritativeMatch(phrase, facts);
    if (fact) {
      findings.push({
        kind: "correction",
        message: `This draft claims "${phrase}", based on ${fact.source}, ${fact.date}. Your page does not currently make that claim.`,
        source: fact.source,
        date: fact.date,
      });
    } else {
      findings.push({
        kind: "violation",
        message: `This draft claims "${phrase}", and no source on your page or in the evidence read for it stands behind that superlative. Check it before you paste.`,
      });
    }
  }

  // Cap each bucket at a readable number - the FIRST few are always the most actionable; a wall of 20 lines would bury the operator, not help them.
  const violations = findings.filter((f) => f.kind === "violation").map((f) => f.message).slice(0, 5);
  const corrections = findings.filter((f) => f.kind === "correction").map((f) => f.message).slice(0, 5);
  return { entailed: violations.length === 0, violations, corrections, findings };
}
