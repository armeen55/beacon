/**
 * Topic-label hygiene (2026-06-28 — New Pages quality gate, operator Phase 6; hardened
 * 2026-07-02 UX0 — grammar sanity).
 *
 * The demand graph derives create-page topics from cited prompts/fanouts, which can
 * surface (a) news/security headline fragments ("Chinese Iranian Hackers Keep Using
 * Boost"), (b) duplicated phrases ("Iranian Culture Iranian Culture Etiquette"), (c)
 * too-generic one-word topics ("Gifts"), and (d) label assembly concatenating junk
 * tokens into an ungrammatical fragment ("Deadly Misconceptions About Iran Hear
 * Cross" — an orphan verb + a dangling word from a mangled URL-slug join). This module
 * cleans the display label and drops the junk before it reaches the New Pages board.
 * PURE / tenant-agnostic — no tenant vocabulary baked in (so it works for any site,
 * per the no-hardcode contract).
 */

// Headline / news / security / spam markers — a topic containing these is a scraped
// fragment, not a page someone would build.
const JUNK_MARKERS = [
  "hacker", "hackers", "malware", "phishing", "ransomware", "exploit",
  "cyberattack", "data breach", "keep using", "boost", "lawsuit", "arrested",
  "breaking news", "click here", "buy now", "coupon code",
];

// One-word topics this generic are not real page concepts on their own.
const GENERIC_SINGLE_WORDS = new Set([
  "gifts", "gift", "tips", "guide", "guides", "ideas", "news", "blog", "blogs",
  "products", "product", "services", "service", "about", "home", "info", "stuff",
  "things", "list", "lists", "review", "reviews", "deals",
]);

// A real page topic is a noun phrase; it never legitimately ENDS on a bare
// imperative/present-tense verb (a title-assembly bug leaves these dangling —
// operator ground-truth: "...Hear Cross"). Generic English verbs only, no tenant
// vocabulary. Deliberately excludes words that double as nouns in common topic
// phrases (e.g. "guide", "watch" as a noun) to avoid false rejects.
const ORPHAN_VERBS = new Set([
  "hear", "read", "see", "click", "learn", "cross", "keep", "make", "get", "go",
  "come", "did", "does", "do", "was", "were", "has", "have", "had", "is", "are",
  "be", "been", "being", "will", "would", "should", "could", "can", "may", "might",
  "must", "shall", "let", "says", "said", "tell", "told", "ask", "asked",
]);

const ACRONYM_FIX: Record<string, string> = {
  usa: "USA", uk: "UK", uae: "UAE", faq: "FAQ", diy: "DIY", ai: "AI",
  suv: "SUV", nyc: "NYC", la: "LA", us: "US",
};

function words(raw: string): string[] {
  return raw.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
}

/** True when a label's own grammar marks it as an unparseable/mangled fragment
 *  (title-assembly concatenated junk tokens) — a real page topic is a noun phrase
 *  and never trails off on a bare verb. Exported separately from `isJunkTopic` so
 *  callers that only care about grammar sanity (not the fuller junk/generic rules)
 *  can check it directly. */
export function isUnparseableLabel(raw: string): boolean {
  const ws = dedupeWords(words((raw ?? "").trim()));
  if (ws.length < 2) return false; // too short to judge grammar; other rules handle single words
  const last = ws[ws.length - 1]!.toLowerCase().replace(/[^a-z]/g, "");
  return ORPHAN_VERBS.has(last);
}

/** True when a topic is scraped junk / a slug fragment / too generic to build. */
export function isJunkTopic(raw: string): boolean {
  const t = (raw ?? "").trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (JUNK_MARKERS.some((m) => lower.includes(m))) return true;
  // URL / slug garbage (query chars, or a long hyphen-slug that was never humanized).
  if (/[/?#=]/.test(t)) return true;
  if (/^[a-z0-9]+(?:-[a-z0-9]+){3,}$/.test(t)) return true;
  // Grammar sanity (2026-07-02): a label assembled from concatenated junk tokens
  // that trails off on a bare verb is not a buildable page topic — reject it here
  // rather than letting a broken title reach the board.
  if (isUnparseableLabel(t)) return true;
  // De-duplicated word count: a single generic word is not a page topic.
  const distinct = dedupeWords(words(lower));
  if (distinct.length <= 1 && GENERIC_SINGLE_WORDS.has(distinct[0] ?? "")) return true;
  // A topic that LEADS with a generic filler word is a scraped fragment, not a page
  // concept: "Things Iran Highlights", "List Iranians", "Gifts for ...". A real page
  // names its subject first ("Persian wedding guide"), not a filler ("List ...").
  if (distinct.length > 1 && GENERIC_SINGLE_WORDS.has(distinct[0] ?? "")) return true;
  return false;
}

/** Keep each distinct word once (case-insensitive), preserving order — collapses
 *  "Iranian Culture Iranian Culture Etiquette" → "Iranian Culture Etiquette". */
function dedupeWords(ws: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of ws) {
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

function titleCaseWord(w: string): string {
  const fix = ACRONYM_FIX[w.toLowerCase()];
  if (fix) return fix;
  if (w.length <= 2 && /^[a-z]+$/i.test(w)) return w.toLowerCase(); // of, to, in...
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Clean a raw topic label for display: collapse duplicate words, fix casing +
 *  acronyms, trim. Does NOT invent tenant-specific words (no "Persian" prefix). */
export function cleanTopicLabel(raw: string): string {
  const deduped = dedupeWords(words(raw));
  if (deduped.length === 0) return raw.trim();
  const titled = deduped.map((w, i) =>
    // Always capitalize the first word; small connectors stay lowercase mid-phrase.
    i === 0 ? capitalizeFirst(titleCaseWord(w)) : titleCaseWord(w),
  );
  return titled.join(" ");
}

function capitalizeFirst(w: string): string {
  if (ACRONYM_FIX[w.toLowerCase()]) return w; // already an acronym
  return w.charAt(0).toUpperCase() + w.slice(1);
}
