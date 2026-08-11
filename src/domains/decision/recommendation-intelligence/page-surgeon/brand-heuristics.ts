/**
 * brand-heuristics (2026-07-21) - the two pure site-brand helpers the Page Surgeon Ready path still needs after the trigger->promotion producer pipeline was retired. Relocated verbatim from the deleted
 * recommendation-intelligence/draft-enrichment.ts: consumed by assemble-packet's title context (the packet owner).
 *   - inferBrandSuffix: infer the site's title-suffix brand from its own
 *     pages (assemble-packet).
 */

import type { PageSnapshot } from "@/domains/evidence/pages/types";

// The em-dash and en-dash separators are matched DATA (real site titles use them), written as unicode escapes so no literal dash appears in source.
const TITLE_SUFFIX_SEPARATORS = [" | ", " \u2014 ", " \u2013 ", " :: "];

/**
 * Universal CMS placeholder strings (Wix/WordPress/Squarespace template defaults). A heading/title equal to one of these is template residue, not content - never use it as a draft base, never treat it as a
 * brand. Platform hygiene, not vertical vocabulary.
 */
const CMS_PLACEHOLDER_TEXTS: ReadonlySet<string> = new Set([
  "page title",
  "untitled",
  "untitled page",
  "new page",
  "title",
  "heading",
  "your title here",
  "add a title",
]);

function isCmsPlaceholder(text: string): boolean {
  return CMS_PLACEHOLDER_TEXTS.has(text.trim().toLowerCase());
}

function firstPathSegment(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0] ?? "";
  return path.split("/").filter((s) => s.length > 0)[0] ?? "";
}

/**
 * Infer the site's brand/title suffix from its own pages. A tail only counts as the BRAND when it behaves like one:
 *   - appears on >=3 titled pages, AND
 *   - spans >=2 distinct first path segments.
 * A collection/category tail (e.g. every "/iran-animals/..." dynamic page ending "| Iran Animals & Wildlife") fails the diversity test - caught
 * live on Wix dynamic pages, where the most COMMON tail is usually a collection name, not the site. Returns null when nothing qualifies; drafts simply go suffix-less.
 */
export function inferBrandSuffix(
  snapshots: Iterable<PageSnapshot>,
): { separator: string; suffix: string } | null {
  const counts = new Map<
    string,
    { separator: string; suffix: string; n: number; segments: Set<string> }
  >();
  for (const s of snapshots) {
    const title = s.title?.trim();
    if (!title) continue;
    for (const sep of TITLE_SUFFIX_SEPARATORS) {
      const idx = title.lastIndexOf(sep);
      if (idx <= 0) continue;
      const suffix = title.slice(idx + sep.length).trim();
      if (suffix.length === 0 || suffix.length > 60 || isCmsPlaceholder(suffix)) continue;
      const key = `${sep}::${suffix.toLowerCase()}`;
      const cur = counts.get(key);
      if (cur) {
        cur.n++;
        cur.segments.add(firstPathSegment(s.url));
      } else {
        counts.set(key, {
          separator: sep,
          suffix,
          n: 1,
          segments: new Set([firstPathSegment(s.url)]),
        });
      }
      break; // one suffix per title - the last separator wins
    }
  }
  let best: { separator: string; suffix: string; n: number } | null = null;
  for (const c of counts.values()) {
    if (c.n >= 3 && c.segments.size >= 2 && (best === null || c.n > best.n)) {
      best = c;
    }
  }
  return best ? { separator: best.separator, suffix: best.suffix } : null;
}
