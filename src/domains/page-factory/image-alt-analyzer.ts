/**
 * image-alt-analyzer (2026-06-25, Sprint 6) — find images missing/with-poor alt text
 * and propose deterministic alt copy. PURE / deterministic (cheerio parse only, no
 * network, no I/O).
 *
 * The audit flagged `add_image_alt_text` as registered-but-inactive (no PageSnapshot
 * image extractor) and "the highest-leverage commerce-adjacent win that needs no Wix
 * write." This is the extractor: given a page's HTML, list images that lack good alt
 * text + a suggested alt derived from the filename + page context. No fabrication —
 * suggestions are clearly derived, and decorative images are skipped.
 *
 * Pinned by image-alt-analyzer.test.ts.
 */

import { load as cheerioLoad } from "cheerio";

export type ImageAltFinding = {
  src: string;
  currentAlt: string | null;
  quality: "missing" | "empty" | "poor" | "ok";
  suggestedAlt: string | null;
  reason: string;
};

const GENERIC_ALT = new Set([
  "image", "img", "photo", "picture", "logo", "icon", "banner", "untitled", "screenshot", "graphic",
]);

function fileStem(src: string): string {
  try {
    const path = src.startsWith("http") ? new URL(src).pathname : src;
    const base = path.split("/").pop() ?? "";
    return base.replace(/\.[a-z0-9]+$/i, "");
  } catch {
    return src;
  }
}

/** A human alt suggestion from the filename + page context. Deterministic. */
export function suggestAltText(src: string, pageTitle?: string | null): string | null {
  const stem = fileStem(src)
    .replace(/[-_]+/g, " ")
    .replace(/\b\d{3,}\b/g, "") // drop long numeric ids (1920x1080, hashes)
    .replace(/\s+/g, " ")
    .trim();
  // A stem that's just digits/hash (no run of ≥3 consecutive letters → not a real
  // word) → fall back to the page title (still grounded, never invented).
  const meaningful = /[a-z]{3,}/i.test(stem) ? stem : "";
  const base = meaningful || (pageTitle ? pageTitle.trim() : "");
  if (!base) return null;
  const titled = base.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 100);
  return titled;
}

function classify(alt: string | null): ImageAltFinding["quality"] {
  if (alt == null) return "missing";
  const trimmed = alt.trim();
  if (trimmed.length === 0) return "empty";
  const lower = trimmed.toLowerCase();
  if (GENERIC_ALT.has(lower) || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(lower) || /^(img|image|dsc|screenshot)[\s_-]*\d*$/i.test(lower)) {
    return "poor";
  }
  return "ok";
}

/**
 * Extract images needing alt-text work from a page's HTML. PURE. Skips images
 * explicitly marked decorative (role=presentation / aria-hidden / alt=""), and
 * skips tiny tracking pixels by src hint. Capped.
 */
export function analyzeImageAlt(html: string, opts: { pageTitle?: string | null; max?: number } = {}): ImageAltFinding[] {
  const max = opts.max ?? 25;
  let $;
  try {
    $ = cheerioLoad(html);
  } catch {
    return [];
  }
  const out: ImageAltFinding[] = [];
  const seen = new Set<string>();
  $("img").each((_i, el) => {
    if (out.length >= max) return;
    const $el = $(el);
    const src = ($el.attr("src") || $el.attr("data-src") || "").trim();
    if (!src || seen.has(src)) return;
    // Decorative images are correctly alt="" — don't flag them.
    const role = ($el.attr("role") || "").toLowerCase();
    const ariaHidden = ($el.attr("aria-hidden") || "").toLowerCase() === "true";
    if (role === "presentation" || role === "none" || ariaHidden) return;
    // Skip likely tracking pixels / sprites.
    if (/pixel|spacer|1x1|tracking|beacon\.gif/i.test(src)) return;
    seen.add(src);

    const rawAlt = $el.attr("alt");
    const currentAlt = rawAlt == null ? null : rawAlt;
    const quality = classify(currentAlt ?? null);
    if (quality === "ok") return; // already good
    const suggestedAlt = suggestAltText(src, opts.pageTitle);
    out.push({
      src,
      currentAlt,
      quality,
      suggestedAlt,
      reason:
        quality === "missing"
          ? "No alt attribute — invisible to screen readers + image search."
          : quality === "empty"
          ? "Empty alt — fine ONLY if decorative; add descriptive alt if it conveys meaning."
          : "Generic/filename alt — replace with a descriptive phrase.",
    });
  });
  return out;
}

export function summarizeImageAlt(findings: ImageAltFinding[]): {
  total: number;
  missing: number;
  poor: number;
  withSuggestion: number;
} {
  return {
    total: findings.length,
    missing: findings.filter((f) => f.quality === "missing").length,
    poor: findings.filter((f) => f.quality === "poor").length,
    withSuggestion: findings.filter((f) => f.suggestedAlt != null).length,
  };
}
