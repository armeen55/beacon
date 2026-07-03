/**
 * draft-alt-text (2026-07-03, BEACON_500 P24 image-SEO lane, v1 248) - the pure,
 * deterministic alt-text drafter.
 *
 * PURE / no I/O / no LLM. Given an image's filename plus the page context we
 * already scanned (the page title, the H1, and the page's top Google search
 * term), produce a short, human-readable description a screen reader and Google
 * Images can use. Deterministic by construction: the SAME inputs always yield
 * the SAME draft, so the trigger's copy is reproducible and testable.
 *
 * Strategy, in order of preference (best signal first):
 *   1. The image FILENAME, cleaned into words ("persian-koobideh-kabob.jpg" ->
 *      "Persian koobideh kabob"). This is the most image-specific signal and is
 *      what a photographer named the file.
 *   2. When the filename is generic/uninformative (IMG_1234, photo, hero,
 *      banner, a hash, dimensions, stock-id) fall back to the surrounding
 *      HEADING (H1) or the PAGE TITLE, which describes what the picture is on a
 *      page about.
 *   3. When nothing usable exists, return null - we NEVER invent a description
 *      out of thin air (honest abstention beats a wrong alt).
 *
 * Never fabricates content that is not grounded in the filename or page context.
 * No em or en dashes; plain words only.
 */

/** Words that make a filename uninformative on their own (camera dumps, CMS
 *  defaults, layout roles). Lowercase, matched as whole tokens. */
const GENERIC_FILENAME_TOKENS = new Set<string>([
  "img",
  "image",
  "images",
  "photo",
  "photos",
  "pic",
  "pics",
  "picture",
  "dsc",
  "dscn",
  "screenshot",
  "screen",
  "shot",
  "hero",
  "banner",
  "bg",
  "background",
  "thumb",
  "thumbnail",
  "logo",
  "icon",
  "favicon",
  "header",
  "footer",
  "cover",
  "default",
  "placeholder",
  "untitled",
  "final",
  "copy",
  "edit",
  "edited",
  "asset",
  "media",
  "upload",
  "uploads",
  "file",
]);

/** Trailing size / density / cms suffixes that carry no meaning. */
function stripNoiseSuffixes(tokens: string[]): string[] {
  return tokens.filter((t) => {
    if (t.length === 0) return false;
    // single stray characters left after splitting (e.g. the "x" in 2048x1024)
    if (t.length === 1) return false;
    // pure numbers (1234, 2048) - camera counters, dimensions, ids
    if (/^\d+$/.test(t)) return false;
    // dimension-ish (1920x1080)
    if (/^\d+x\d+$/.test(t)) return false;
    // density / scale markers (2x, 3x, 1x)
    if (/^\d+x$/.test(t)) return false;
    // long hex hashes (cms content-addressed names)
    if (/^[0-9a-f]{8,}$/i.test(t)) return false;
    // scaled markers wix/cms leaves (e.g. "w", "h", "scaled")
    if (t === "scaled" || t === "resized" || t === "small" || t === "large" || t === "medium") {
      return false;
    }
    return true;
  });
}

/** The bare filename (no directory, no extension, no query string). */
function baseNameFromSrc(src: string): string {
  let s = src;
  // drop query + fragment
  const q = s.search(/[?#]/);
  if (q >= 0) s = s.slice(0, q);
  // last path segment
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(slash + 1);
  // drop a single trailing extension
  s = s.replace(/\.[a-z0-9]{2,5}$/i, "");
  return s;
}

/** Tokenize a filename into human words, dropping noise + generic tokens. */
function meaningfulFilenameWords(src: string): string[] {
  const base = baseNameFromSrc(src);
  if (!base) return [];
  // split on separators + camelCase boundaries + letter/digit boundaries so a
  // camera dump like "DSC00001" or "IMG2024" splits into a generic prefix + a
  // pure-number token (both then dropped), not one opaque word.
  const raw = base
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .split(/[\s_\-.+%]+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  const denoised = stripNoiseSuffixes(raw);
  const meaningful = denoised.filter((w) => !GENERIC_FILENAME_TOKENS.has(w));
  return meaningful;
}

/** Title-case a short phrase (first word capitalized; keeps the rest lower so a
 *  filename-derived phrase reads like a caption, not a headline). */
function toSentenceCase(words: string[]): string {
  if (words.length === 0) return "";
  const joined = words.join(" ").trim();
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** Clean a heading/title into a short phrase (trim, collapse whitespace, cap
 *  length). Strips a trailing site-name suffix ("Page | Brand" -> "Page"). */
function cleanContextPhrase(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/\s+/g, " ").trim();
  if (!s) return null;
  // Drop a "| Brand" or " - Brand" style suffix (common in <title>).
  const sep = s.search(/\s[|–—-]\s/);
  if (sep > 0) s = s.slice(0, sep).trim();
  return s.length > 0 ? s : null;
}

const MAX_ALT_WORDS = 12;
const MAX_ALT_CHARS = 100;

function clampAlt(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  let out = words.slice(0, MAX_ALT_WORDS).join(" ");
  if (out.length > MAX_ALT_CHARS) out = out.slice(0, MAX_ALT_CHARS).trim();
  return out;
}

export type DraftAltContext = {
  /** The image src (used for the filename signal). */
  src: string;
  /** The page's H1 text, if any. */
  h1: string | null;
  /** The page's <title>, if any. */
  pageTitle: string | null;
  /** The page's top Google search term for the page, if known (best last-resort
   *  grounding: the words people actually search that land here). */
  topQuery?: string | null;
};

/**
 * Draft a short alt description for one image, deterministically. Returns null
 * when no grounded description can be formed (never invents one). Pure.
 */
export function draftAltText(ctx: DraftAltContext): string | null {
  // 1. Filename words (most image-specific).
  const fileWords = meaningfulFilenameWords(ctx.src);
  if (fileWords.length >= 1) {
    const phrase = toSentenceCase(fileWords);
    if (phrase.length >= 2) return clampAlt(phrase);
  }

  // 2. Surrounding heading, then page title (describes what the page - and so
  //    the picture on it - is about).
  const h1 = cleanContextPhrase(ctx.h1);
  if (h1) return clampAlt(h1);
  const title = cleanContextPhrase(ctx.pageTitle);
  if (title) return clampAlt(title);

  // 3. The page's top search term, as a last grounded resort.
  const query = cleanContextPhrase(ctx.topQuery ?? null);
  if (query) return clampAlt(toSentenceCase(query.toLowerCase().split(/\s+/)));

  // Nothing grounded -> abstain (honest; the trigger will skip this image).
  return null;
}
