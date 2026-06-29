/**
 * relevance-gate (2026-06-28 — Evidence Relevance + Source Truth) — a PURE, deterministic
 * gate that decides whether one evidence atom (a competitor URL, a "what wins" teardown,
 * an internal-link target, an AI prompt) is actually ON-TOPIC for a Move before it reaches
 * a customer-facing card. No LLM, no I/O.
 *
 * The trust problem it kills: the demand graph + Profound + GSC cannibalization sometimes
 * join a real Move to junk evidence — Tehran → "Iranian Snacks" for "capital of Iran",
 * Safavid Flag → a TasteAtlas eggplant URL, Persian Numbers → baby-name competitor pages.
 *
 * The core rule: two topics are related ONLY if they share a DISTINGUISHING token — not
 * just a generic brand term like "iran"/"persian". "Tehran" and "Iranian Snacks" share
 * only the (stripped) generic "iranian", so the join is suppressed. Plus: social / forum /
 * marketplace / recipe domains are noise unless the topic itself is about them.
 */

export type RelevanceReason =
  | "relevant"
  | "weak_topic_fit"
  | "social_noise"
  | "generic_only_overlap"
  | "competitor_topic_mismatch"
  | "bad_internal_link_target"
  | "empty";

export type RelevanceVerdict = {
  relevant: boolean;
  /** 0..1 overlap of distinguishing tokens. */
  score: number;
  reason: RelevanceReason;
  sharedTerms: string[];
};

/** Stopwords + GENERIC brand/SEO terms that must NOT count as a topic match on their own.
 *  "iran"/"persian" alone don't make two pages related on an Iranian-culture site. */
const GENERIC = new Set([
  // structural stopwords
  "the", "a", "an", "of", "in", "to", "and", "or", "for", "with", "on", "at", "by",
  "is", "are", "be", "your", "you", "it", "this", "that", "from", "as", "how", "what",
  "why", "when", "where", "who", "vs", "near", "me", "best", "top", "guide", "complete",
  "ultimate", "list", "page", "pages", "online", "free", "new", "all", "more", "about",
  "into", "out", "up", "do", "does", "can", "will", "vs.",
  // brand / vertical-context terms (too generic alone on this tenant)
  "iran", "iranian", "iranians", "persia", "persian", "persians", "farsi",
]);

/** Domains that are noise for editorial intent (social / forum / UGC / recipe-aggregator /
 *  marketplace) — suppressed unless the Move topic is explicitly about them. */
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
export function topicTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const raw = stripDiacritics(String(text).toLowerCase())
    .replace(/https?:\/\/[^\s]*/g, (u) => u.replace(/[^a-z0-9]+/g, " ")) // URL → words
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (let t of raw) {
    if (t.length < 3) continue;
    // crude singularize: names→name, numbers→number, snacks→snack, cities→city
    if (t.endsWith("ies") && t.length > 4) t = t.slice(0, -3) + "y";
    else if (t.endsWith("ses") && t.length > 4) t = t.slice(0, -2);
    else if (t.endsWith("s") && !t.endsWith("ss") && t.length > 3) t = t.slice(0, -1);
    if (GENERIC.has(t)) continue;
    out.push(t);
  }
  return [...new Set(out)];
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

/** Core: do two topic strings share a distinguishing token? */
export function scoreTopicMatch(a: string | null | undefined, b: string | null | undefined): RelevanceVerdict {
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

/** Gate a competitor / "what wins" / SERP-winner evidence atom against a Move topic. */
export function competitorRelevance(
  moveTopic: string,
  candidate: { url?: string | null; title?: string | null },
  opts: { allowNoiseDomain?: boolean } = {},
): RelevanceVerdict {
  const url = candidate.url ?? "";
  if (url && isNoiseDomain(url) && !opts.allowNoiseDomain) {
    return { relevant: false, score: 0, reason: "social_noise", sharedTerms: [] };
  }
  // Match the topic against the URL slug + the title (whichever carries the subject).
  const haystack = [candidate.title ?? "", url].filter(Boolean).join(" ");
  const v = scoreTopicMatch(moveTopic, haystack);
  if (!v.relevant) return { ...v, reason: "competitor_topic_mismatch" };
  return v;
}

/** Gate an internal-link / cannibalization target page against a Move topic. The target
 *  page must be topically related to the source — never link Tehran → "Iranian Snacks". */
export function internalLinkRelevance(moveTopic: string, targetLabelOrUrl: string): RelevanceVerdict {
  const v = scoreTopicMatch(moveTopic, targetLabelOrUrl);
  if (!v.relevant) return { ...v, reason: "bad_internal_link_target" };
  return v;
}

/** Gate an AI prompt against a Move topic (the prompt must be about the same subject). */
export function promptRelevance(moveTopic: string, prompt: string): RelevanceVerdict {
  const v = scoreTopicMatch(moveTopic, prompt);
  if (!v.relevant && v.reason === "weak_topic_fit") return { ...v, reason: "generic_only_overlap" };
  return v;
}
