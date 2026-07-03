/**
 * js-shell (2026-07-03, BEACON_500 R19 / N22 - dual-fetch content verification,
 * the honest heuristic half).
 *
 * PURE / no I/O. N22's full ambition is to compare what is in the RAW HTML
 * (source) against what a RENDERED fetch shows and flag content that only
 * appears after JavaScript runs. A true headless render is out of scope without
 * a browser in this runtime, so this detects the JS-SHELL SMELL instead: a page
 * whose SERVER HTML the crawler already fetched carries almost no real body
 * text yet is a substantial page (has a title/H1 and real Google demand). That
 * pattern - a near-empty <body> in the source HTML behind a client app - means
 * the visible content is injected by JavaScript and MAY be invisible to AI
 * crawlers and older bots that do not run JS.
 *
 * HONEST BY CONSTRUCTION: this detects the SMELL, it does not run a headless
 * render. The card says exactly that. It never claims the content IS invisible,
 * only that it appears after JavaScript and is worth checking.
 *
 * The crawler's stored snapshot already gives us the source-HTML view:
 *   - word_count: the extractor's body word count from the SERVER HTML.
 *   - body_paragraph_sample: the ordered main-content excerpt (empty when the
 *     server HTML had no usable paragraphs - the exact JS-shell tell).
 *   - title / h1: proof the page is a real destination (a genuinely blank page
 *     has neither).
 * A page that clears the demand floor but has near-zero source-HTML body text
 * despite having a title/H1 is the flag.
 *
 * Demand-gated (same reasoning as buried-page / lifecycle): Beacon only raises
 * this for pages that actually earn Google searches, where a crawler seeing an
 * empty page costs real citations. Byte-identical when nothing qualifies. No em
 * or en dashes.
 *
 * The customer sentence comes from the shared, vocab-scanned copy template
 * (customer-copy-templates.ts, pure) so it passes the same forbidden-vocab
 * invariant every other card does.
 */

import { jsShellContentCopy } from "@/domains/recommendation-intelligence/customer-copy-templates";

export type JsShellPageInput = {
  /** Canonical page URL - the identity used across every signal map. */
  url: string;
  /** Body word count from the SERVER HTML (the extractor's count). */
  wordCount: number;
  /** Number of usable main-content paragraph/block excerpts the extractor pulled
   *  from the SERVER HTML. 0 is the classic JS-shell tell (no real body text in
   *  source). */
  bodyExcerptCount: number;
  /** The page has a real title in the source HTML (proof it is a destination). */
  hasTitle: boolean;
  /** The page has a real H1 in the source HTML. */
  hasH1: boolean;
  /** HTTP status of the last fetch (>=400 pages are excluded - a dead page is a
   *  status fix, not a JS-shell finding). */
  httpStatus: number;
  /** Google impressions over the trailing 90 days (the demand gate). */
  impressions90d: number;
};

export type JsShellFinding = {
  url: string;
  /** Plain first-person-safe sentence, dash-free, honest about the heuristic. */
  reason: string;
  /** Operator-only structured trace. */
  evidence: string;
};

/** A page needs at least this many 90-day impressions before a JS-shell flag is
 *  worth raising - below this the fix would not pay for itself. */
export const JS_SHELL_MIN_IMPRESSIONS_90D = 100;
/** At or below this many source-HTML body words a page reads as a shell (the
 *  server HTML carried essentially no readable content). Deliberately low so a
 *  genuinely short-but-real page is never flagged - this is the "empty body"
 *  case, not the "thin page" case (thin pages are the lifecycle engine's job). */
export const JS_SHELL_MAX_BODY_WORDS = 40;

/** Path (or the whole URL when unparseable) for the customer sentence. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    return url;
  }
}

/**
 * Does this page smell like a JS shell? True when it clears the demand floor, is
 * a healthy destination (title or H1 present, status < 400), yet its SERVER HTML
 * carried almost no body text (near-zero word count AND zero usable paragraph
 * excerpts). Both body signals must be near-empty so a page whose extractor
 * merely missed the <main> selector (excerptCount 0 but a real word count) is
 * not falsely flagged. Pure.
 */
export function looksLikeJsShell(page: JsShellPageInput): boolean {
  if (page.httpStatus >= 400) return false;
  if (page.impressions90d < JS_SHELL_MIN_IMPRESSIONS_90D) return false;
  // A real destination: it must have a title or H1 in the source (a truly blank
  // URL has neither and is a different problem, not a JS shell).
  if (!page.hasTitle && !page.hasH1) return false;
  // The JS-shell tell: near-empty source body on BOTH signals.
  return page.wordCount <= JS_SHELL_MAX_BODY_WORDS && page.bodyExcerptCount === 0;
}

/**
 * Build a JS-shell finding for one page (or null when it does not smell like a
 * shell). Pure. The sentence is honest about the heuristic - it detects the
 * smell, it does not run a headless render.
 */
export function classifyJsShell(page: JsShellPageInput): JsShellFinding | null {
  if (!looksLikeJsShell(page)) return null;
  const path = pathOf(page.url);
  return {
    url: page.url,
    reason: jsShellContentCopy(path),
    evidence:
      "js_shell: word_count=" +
      String(page.wordCount) +
      " (<= " +
      String(JS_SHELL_MAX_BODY_WORDS) +
      "); body_excerpt_count=0; has_title=" +
      String(page.hasTitle) +
      "; has_h1=" +
      String(page.hasH1) +
      "; impressions_90d=" +
      String(page.impressions90d) +
      " (heuristic: smell only, no headless render)",
  };
}
