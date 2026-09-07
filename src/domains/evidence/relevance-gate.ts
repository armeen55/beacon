/**
 * relevance-gate (2026-06-28, Evidence Relevance + Source Truth) - a PURE, deterministic
 * gate that decides whether one evidence atom (a competitor URL, a "what wins" teardown,
 * an internal-link target, an AI prompt) is actually ON-TOPIC for a Move before it reaches
 * a customer-facing card. No LLM, no I/O.
 *
 * The trust problem it kills: the demand graph, AI answers and GSC cannibalization
 * sometimes join a real Move to junk evidence, a city guide to a snack listicle or a
 * product page to a recipe aggregator.
 *
 * The core rule: two topics are related ONLY if they share a DISTINGUISHING token. What
 * is generic HERE is universal language (stopwords + SEO filler) and nothing else: an
 * account's own ubiquitous vocabulary is derived from its OWN corpus by weakAnchorTokens,
 * so this file carries no vertical and works for any business. Plus: social / forum /
 * marketplace / recipe domains are noise unless the topic itself is about them.
 */

type RelevanceReason =
  | "relevant"
  | "weak_topic_fit"
  | "social_noise"
  | "generic_only_overlap"
  | "competitor_topic_mismatch"
  | "bad_internal_link_target"
  | "empty";

type RelevanceVerdict = {
  relevant: boolean;
  /** 0..1 overlap of distinguishing tokens. */
  score: number;
  reason: RelevanceReason;
  sharedTerms: string[];
};

/** UNIVERSAL language only: structural stopwords plus SEO filler that means the same
 *  thing in every vertical. No account's subject words live here, ever: a hardcoded
 *  vertical list would erase exactly the words that make one customer's topics distinct
 *  (and it silently did). Per-account ubiquity is weakAnchorTokens' job. */
const GENERIC = new Set([
  "the", "a", "an", "of", "in", "to", "and", "or", "for", "with", "on", "at", "by",
  "is", "are", "be", "your", "you", "it", "this", "that", "from", "as", "how", "what",
  "why", "when", "where", "who", "vs", "near", "me", "best", "top", "guide", "complete",
  "ultimate", "list", "page", "pages", "online", "free", "new", "all", "more", "about",
  "into", "out", "up", "do", "does", "can", "will", "vs.",
  // SUPERLATIVES AND SIZE WORDS ARE NOT SUBJECTS. "most", "famous" and "popular" mean the same thing in every
  // vertical and attach to anything, and counting them as a tie is how a question about the country's famous
  // landmarks came to be answered on a page about rice and stew: three shared words, none of them a subject.
  // A candidate must tie on content nouns or it ties on nothing.
  // "main" is NOT here: "main dishes" is a real subject and this list may never eat one.
  "most", "famous", "popular", "common", "great", "greatest", "biggest", "largest",
  "major", "important", "different", "various", "type", "types", "kind", "kinds", "thing",
  "things", "good", "better", "known", "must", "some", "many", "other", "another", "every",
  // DEMONSTRATIVES ARE NOT SUBJECTS EITHER. "this" and "that" were here and their plurals were not, so "these accessory types" carried "these" as a content token and a
  // sentence could be refused for a word that names nothing.
  "these", "those",
  // AND NEITHER IS ANY OTHER BARE FUNCTION WORD (reviewer, 2026-09-05). "are there cobras in iran" tokenized to ["there","cobra","iran"], so a page that says outright that the Caspian
  // cobra lives in Iran was one third short of naming what the searcher named, and the coverage rule needed a ratio purely to forgive that one word. These are closed-class English:
  // existential and locative pro-forms, relative and interrogative words, pronouns, auxiliaries and the conjunctions and adverbs that join them. Not one of them can be the subject of
  // anything, in any vertical or language, so dropping them makes every reader of these tokens more exact and none of them looser. Deliberately absent: "before" and "after", which name a
  // period and are what "iran flag before 1979" is actually asking about; "may" and "might", also a month and a noun; "even", "still", "same" and "own", which lead real subjects.
  "there", "here", "any", "each", "both", "such", "which", "whom", "whose", "whether", "they", "them", "their",
  "she", "her", "hers", "his", "him", "its", "was", "were", "been", "has", "have", "had", "did", "should",
  "would", "could", "shall", "but", "nor", "because", "while", "than", "then", "too", "very", "also", "only",
  "again", "once", "ever", "never", "not",
]);

/** THE WORDS THAT CARRY A RELATION RATHER THAN A SUBJECT, and the only vocabulary in this product that decides whether two texts are about the same QUESTION rather than the same topic. A period, a comparison, a rank, a meaning and a defining role are what a searcher asks ABOUT a subject, so a text that shares every subject word and matches none of these is answering a different question: "iran flag before 1979" is won by pages about the flag since 1979, and their sections and entities briefed a writer about the wrong period while reading as the pattern that wins. It lived privately in decision/diagnosis, where the demand classifier proved it over 227 pages; it is HERE because Evidence may not import Decision and a second copy of a vocabulary is the defect this codebase keeps paying for. Universal English relation words only: no account subject, no vertical, no page family. Two of them, "largest" and "vs", are struck out of `topicTokens` above, so they can decide whether a phrase asks something and can never be a token another text must carry. */
export const RELATIONAL = /\b(?:before|after|meanings?|capital|largest|national|differences?|versus|vs\.?)\b/i;

/** A NAVIGATION LABEL A PAGE REPEATS AROUND ITS CONTENT, matched WHOLE: the words a reader clicks past rather than
 *  reads. ONE DEFINITION FOR EVERY DOOR (campaign review, 2026-09-05). Three copies of this vocabulary stood: the
 *  replacement door and the writer's door read `FURNITURE_AT` in decision/proof, the thin-page comparison read a
 *  prefix-matching `FURNITURE` in decision/drafted-copy, and the content comparison in evidence/comparison read
 *  NEITHER, so one word of a winner's own chrome ("Newsletter", "Related articles", "Categories") minted a paid
 *  observation, flipped the ranking-loss verdict to "names", reached the writer as a briefing line and became a paid
 *  factual-source need. It lives HERE because Evidence may not import Decision and because a second copy of a
 *  vocabulary is the defect this codebase keeps paying for. UNIVERSAL ENGLISH ONLY: the account token "iranopedia"
 *  stood in the old copy from an earlier round and is RETIRED here, because a site's own name is not a navigation
 *  word and no tenant string may decide what any account's pages carry. Matched whole rather than as a prefix, so an
 *  ordinary sentence or heading that merely contains one of these words survives. AND AN ENCYCLOPEDIA'S OWN APPARATUS IS
 *  FURNITURE TOO (production 03:01Z, 2026-09-06): "Gallery", "Notes" and "References" reached a change as three of the eight things a page was missing, and a gallery, a note list, a reference list, a bibliography and a footnote block are what a reference work prints AROUND its content in every vertical, so none of them is a section another page owes a reader. Whole labels still, so "References to the 1979 flag" is untouched. AND "CONTACT" IS A COMMON NOUN BEFORE IT IS A NAVIGATION WORD (journey review, 2026-09-07): the label rule reads up to four words after it, which suppressed the account's own "Contact <site>" chrome as intended but would take a heading about contact lenses, contact sports or contact tracing with it, so those readings are excepted by name. */
export const FURNITURE_LABEL =
  /^\s*(?:explore more|related(?: (?:articles?|posts?|pages?|topics?))?|you may also like|more(?: (?:from|like|articles?))?|read more|learn more|see also|gallery|galleries|notes?|references?|external links?|further reading|bibliograph(?:y|ies)|citations?|sources?|footnotes?|share(?: this)?|categor(?:y|ies)|tags?|menu|navigation(?: menu)?|footer|header|sidebar|newsletter|subscribe|follow(?: us)?|contact(?:\s+(?!lens|lenses|sports?|tracing|dermatitis|angles?)\S+){0,4}|get in touch|sign ?up|log ?in|book now|shop(?: now)?|table of contents|contents|on this page|in this article|jump to|quick links|home|search|contact(?: us)?|about(?: us)?|comments?|advertisements?|privacy(?: policy)?|terms(?: of (?:use|service))?)\s*$/i;

/** Domains that are noise for editorial intent (social / forum / UGC / recipe-aggregator /
 *  marketplace), suppressed unless the Move topic is explicitly about them. */
const NOISE_DOMAINS = [
  "facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com", "youtube.com",
  "pinterest.com", "reddit.com", "quora.com", "linkedin.com", "tumblr.com",
  "tasteatlas.com", "researchgate.net", "academia.edu", "amazon.com", "etsy.com",
  "ebay.com", "aliexpress.com", "yelp.com", "tripadvisor.com",
];

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Distinguishing tokens of a topic/title/slug: lowercased, de-accented, singularized,
 *  with stopwords + generic brand terms removed and tokens < 3 chars dropped. */
export function topicTokens(text: string | null | undefined, opts?: { keepRepeats?: boolean }): string[] {
  if (!text) return [];
  const raw = stripDiacritics(String(text).toLowerCase())
    .replace(/https?:\/\/[^\s]*/g, (u) => u.replace(/[^a-z0-9]+/g, " ")) // URL → words
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (let t of raw) {
    if (t.length < 3) continue;
    // ASKED BEFORE THE STEM AND AFTER IT. The stem runs first, so "famous" became "famou" and walked past a
    // list that names it: a universal word survived as a subject because of how it is spelled.
    if (GENERIC.has(t)) continue;
    // crude singularize: names→name, numbers→number, snacks→snack, cities→city
    if (t.endsWith("ies") && t.length > 4) t = t.slice(0, -3) + "y";
    else if (t.endsWith("ses") && t.length > 4) t = t.slice(0, -2);
    else if (t.endsWith("s") && !t.endsWith("ss") && t.length > 3) t = t.slice(0, -1);
    if (GENERIC.has(t)) continue;
    out.push(t);
  }
  return opts?.keepRepeats === true ? out : [...new Set(out)];
}

export function domainOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isNoiseDomain(url: string): boolean {
  const d = domainOf(url);
  return !!d && NOISE_DOMAINS.some((n) => d === n || d.endsWith(`.${n}`));
}

/**
 * CANONICAL QUERY IDENTITY (query fidelity closure, 2026-07-26). Two queries are
 * the SAME research subject only when their full normalized token multisets are
 * identical: "baby male names" and "baby names male" join (same words, any
 * order), while "national flag 1979" and "political revolution 1979" never
 * collapse (different words). ALL tokens count, stopwords included and every
 * script (a Persian or Cyrillic modifier is a modifier). KNOWN LIMIT, accepted:
 * a multiset cannot tell directions apart ("usd to eur" = "eur to usd"); no live
 * query hits it and a thesaurus is out of bounds. Used for volume joins and
 * dedupe ONLY; SERP observation identity stays the exact normalized string. Pure.
 */
export function canonicalQueryKey(query: string | null | undefined): string {
  if (!query) return "";
  return stripDiacritics(String(query).toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean).sort().join(" ");
}

/**
 * WEAK ANCHORS (relevance convergence slice, 2026-07-26). A token that recurs
 * across most of an account's own phrases ("plumbing" for a plumber, "dental"
 * for a dentist) matches nearly everything that account touches, so it proves
 * nothing about TOPICAL fit: on its own it let huge-volume news queries pass the
 * research filter and let a broad prompt "support" an unrelated page. Derived
 * per account from its OWN corpus, never hardcoded. Pure.
 * A token is weak when it appears in >= ceil(40% of phrases) and at least 3.
 */
export function weakAnchorTokens(phrases: ReadonlyArray<string | null | undefined>): Set<string> {
  const freq = new Map<string, number>();
  let docs = 0;
  for (const p of phrases) {
    const toks = topicTokens(p);
    if (toks.length === 0) continue;
    docs += 1;
    for (const t of toks) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const cut = Math.max(3, Math.ceil(docs * 0.4));
  const weak = new Set<string>();
  for (const [t, n] of freq) if (n >= cut) weak.add(t);
  return weak;
}

/** TEMPLATE CHROME. A heading the site prints on nearly every page is furniture: a menu rail, an FAQ block,
 *  a shop strip, a footer brand line. Two pages wearing "Explore More" are not two pages wearing one name,
 *  and a page whose only tie to a search is furniture has not earned that search. A heading carried by >= 30
 *  percent of the pages read (at least two) is furniture. Compared lowercased and space-collapsed. Pure. */
export function templateHeadings(pages: ReadonlyArray<ReadonlyArray<string>>): ReadonlySet<string> {
  const freq = new Map<string, number>();
  for (const headings of pages) {
    for (const h of new Set(headings.map((x) => x.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))) {
      freq.set(h, (freq.get(h) ?? 0) + 1);
    }
  }
  const cut = Math.max(2, Math.ceil(pages.length * 0.3));
  return new Set([...freq].filter(([, n]) => n >= cut).map(([h]) => h));
}

/** Anchor-aware topical match: relevant ONLY when the two texts share at least
 *  one token that is NOT a weak anchor (or normalize identically). A shared
 *  weak token alone is the exact failure this slice removes. Pure. */
export function anchoredTopicMatch(a: string | null | undefined, b: string | null | undefined, weak: ReadonlySet<string>): RelevanceVerdict {
  const v = scoreTopicMatch(a, b);
  if (!v.relevant) return v;
  const strong = v.sharedTerms.filter((t) => !weak.has(t));
  if (strong.length === 0) return { relevant: false, score: 0, reason: "weak_topic_fit", sharedTerms: v.sharedTerms };
  return { ...v, sharedTerms: strong };
}

/** Core: do two topic strings share a distinguishing token? */
function scoreTopicMatch(a: string | null | undefined, b: string | null | undefined): RelevanceVerdict {
  const ta = topicTokens(a);
  const tb = topicTokens(b);
  if (ta.length === 0 || tb.length === 0) {
    return { relevant: false, score: 0, reason: "empty", sharedTerms: [] };
  }
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t));
  if (shared.length === 0) {
    return { relevant: false, score: 0, reason: "weak_topic_fit", sharedTerms: [] };
  }
  const score = shared.length / Math.min(ta.length, tb.length);
  return { relevant: true, score, reason: "relevant", sharedTerms: shared };
}


