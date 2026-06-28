/**
 * Topic-label hygiene (2026-06-28 — New Pages quality gate, operator Phase 6).
 *
 * The demand graph derives create-page topics from cited prompts/fanouts, which can
 * surface (a) news/security headline fragments ("Chinese Iranian Hackers Keep Using
 * Boost"), (b) duplicated phrases ("Iranian Culture Iranian Culture Etiquette"), and
 * (c) too-generic one-word topics ("Gifts"). This module cleans the display label and
 * drops the junk before it reaches the New Pages board. PURE / tenant-agnostic — no
 * tenant vocabulary baked in (so it works for any site, per the no-hardcode contract).
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

const ACRONYM_FIX: Record<string, string> = {
  usa: "USA", uk: "UK", uae: "UAE", faq: "FAQ", diy: "DIY", ai: "AI",
  suv: "SUV", nyc: "NYC", la: "LA", us: "US",
};

function words(raw: string): string[] {
  return raw.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
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
  // De-duplicated word count: a single generic word is not a page topic.
  const distinct = dedupeWords(words(lower));
  if (distinct.length <= 1 && GENERIC_SINGLE_WORDS.has(distinct[0] ?? "")) return true;
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
