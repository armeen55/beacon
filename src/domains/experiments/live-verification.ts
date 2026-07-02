/**
 * live-verification (2026-07-01) — DETERMINISTIC, lever-specific proof that a Daily Experiment
 * change is LIVE on the page. No LLM. A fresh raw fetch of the operator's own page (Wix SSR serves a
 * real <head> meta + <a> markup + body <p> in document order — verified) parsed with cheerio, then
 * exact normalized matching per lever. The empty-shell guard (pre-hydration Wix shell at HTTP 200)
 * is treated as an UNRELIABLE read (retryable), never as "the change is gone".
 *
 * Trust posture (hardened after adversarial review): a false POSITIVE (verified:true when the change
 * is NOT live) is the worst outcome — proof/reservations are created only after verified:true. So:
 *  - internal links match on ORIGIN+PATH (off-domain rejected) AND the anchor must live INSIDE the
 *    source paragraph (a sibling nav/sidebar link no longer satisfies it);
 *  - chrome (header/nav/footer/aside) and hidden (<p hidden>/aria-hidden/display:none) paragraphs are
 *    excluded so they cannot corrupt the answer "near top" index or supply a phantom link;
 *  - answer blocks require a near-whole-paragraph match (not an incidental substring);
 *  - a read with no rendered content (no paragraphs AND no links) is snapshot_stale, not "missing".
 * Nothing here writes. Fetch is injectable for tests.
 */
import "server-only";
import * as cheerio from "cheerio";
import { normalizePath, type PlannedExperimentRecord } from "./daily-plan-types";
import type { LiveVerificationResult, UnchangedCheck } from "./execution-state";

export type FetchedPage = { ok: true; html: string; status: number } | { ok: false; status?: number };
export type VerifyDeps = { fetchPage?: (url: string) => Promise<FetchedPage>; now?: () => Date };

const FETCH_TIMEOUT_MS = 20_000;
const ANSWER_TOP_MAX_INDEX = 1; // an answer is "promoted/near top" if it's the 1st or 2nd content paragraph
const ANSWER_PARAGRAPH_COVERAGE = 0.6; // the answer must be most of its paragraph, not an incidental substring

async function defaultFetchPage(url: string): Promise<FetchedPage> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "BeaconBot/1.0 (daily-experiment-verify)", Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const html = await res.text();
    return { ok: true, html, status: res.status };
  } catch {
    return { ok: false };
  }
}

function safeCodePoint(n: number): string {
  try { return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; } catch { return ""; }
}
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => safeCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => safeCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&hellip;/g, "…").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–");
}
/** Canonical text normalization: entity-decode, unify quote variants, collapse whitespace, lowercase. */
export function normText(s: string | null | undefined): string {
  if (!s) return "";
  return decodeEntities(s)
    .replace(/<[^>]*>/g, " ") // strip residual markup (e.g. RAWTEXT <title> with nested tags)
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type ParaBlock = { text: string; links: Array<{ href: string; anchor: string }> };
type ParsedPage = {
  title: string | null;
  metaDescription: string | null;
  metaCount: number;
  h1: string | null;
  paragraphs: string[]; // visible content-region <p>, document order
  contentParagraphs: string[]; // visible <p> with >= 8 words, document order
  paraBlocks: ParaBlock[]; // each visible <p> with its DESCENDANT anchors (for paragraph-scoped link checks)
  linkCount: number;
  /** Visible content-region section headings (h2 + h3), document order - the item-56 refresh
   *  lever verifies its new section against these. */
  headings: string[];
};

type CheerioRoot = ReturnType<typeof cheerio.load>;

function isHidden($: CheerioRoot, el: Parameters<CheerioRoot>[0]): boolean {
  const $el = $(el);
  if ($el.closest('[hidden], [aria-hidden="true"]').length > 0) return true;
  const hiddenStyle = (style: string | undefined) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style ?? "");
  if (hiddenStyle($el.attr("style"))) return true;
  return $el.parents().toArray().some((p) => hiddenStyle($(p).attr("style")));
}

function parseLive(html: string): ParsedPage {
  const $ = cheerio.load(html);
  const title = ($("title").first().text() || "").trim() || null;
  const metaEls = $('meta[name="description"]');
  const metaDescription = (metaEls.first().attr("content") ?? "").trim() || null;
  const h1 = ($("h1").first().text() || "").trim() || null;

  // Content scope: prefer <main>/<article>, else <body>; then strip chrome so nav/footer/aside <p>
  // and links can't corrupt placement or supply phantom links. Work on a clone (no mutation).
  let scopeSel = $("body");
  if ($("main").length) scopeSel = $("main").first();
  else if ($("article").length) scopeSel = $("article").first();
  const scope = scopeSel.clone();
  scope.find('header, nav, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]').remove();

  const paragraphs: string[] = [];
  const contentParagraphs: string[] = [];
  const paraBlocks: ParaBlock[] = [];
  scope.find("p").each((_, el) => {
    if (isHidden($, el)) return;
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (!t) return;
    paragraphs.push(t);
    if (t.split(/\s+/).length >= 8) contentParagraphs.push(t);
    const links: Array<{ href: string; anchor: string }> = [];
    $(el).find("a[href]").each((__, a) => { links.push({ href: $(a).attr("href") ?? "", anchor: $(a).text().replace(/\s+/g, " ").trim() }); });
    paraBlocks.push({ text: t, links });
  });
  let linkCount = 0;
  scope.find("a[href]").each(() => { linkCount += 1; });

  const headings: string[] = [];
  scope.find("h2, h3").each((_, el) => {
    if (isHidden($, el)) return;
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t) headings.push(t);
  });

  return { title, metaDescription, metaCount: metaEls.length, h1, paragraphs, contentParagraphs, paraBlocks, linkCount, headings };
}

/** Wix pre-hydration shell: HTTP 200 but title + h1 + meta all blank → unreliable read, retry. */
function isEmptyShell(p: ParsedPage): boolean {
  return !p.title && !p.h1 && !p.metaDescription;
}
/** No rendered content at all (body levers can't trust a positive OR negative here). */
function hasNoRenderedContent(p: ParsedPage): boolean {
  return p.contentParagraphs.length === 0 && p.linkCount === 0;
}

function ok(observedValue: string, method: string, source: string, now: Date, unchangedChecks: UnchangedCheck[] = []): LiveVerificationResult {
  const iso = now.toISOString();
  return { verified: true, observedAt: iso, observedValue, unchangedChecks, receipt: { verifiedAt: iso, method, observedValue, source } };
}

function resolvePath(href: string, pageUrl: string): string | null {
  try { return normalizePath(new URL(href, pageUrl).toString()); } catch { return null; }
}
function sameOrigin(href: string, pageUrl: string): boolean {
  try { return new URL(href, pageUrl).origin === new URL(pageUrl).origin; } catch { return false; }
}

/** Verify the experiment's change is live, deterministically, per lever. */
export async function verifyExperimentLive(exp: PlannedExperimentRecord, deps: VerifyDeps = {}): Promise<LiveVerificationResult> {
  const now = (deps.now ?? (() => new Date()))();
  const fetchPage = deps.fetchPage ?? defaultFetchPage;
  const url = exp.canonicalUrl || exp.url;

  const res = await fetchPage(url);
  if (!res.ok) return { verified: false, reason: "page_unreachable", expected: exp.proposedText, retryable: true };
  if (res.status < 200 || res.status >= 400) {
    return { verified: false, reason: "page_unreachable", expected: exp.proposedText, observed: `HTTP ${res.status}`, retryable: true };
  }
  const page = parseLive(res.html);
  if (res.status === 200 && isEmptyShell(page)) {
    return { verified: false, reason: "snapshot_stale", expected: exp.proposedText, observed: "empty pre-hydration shell (title/h1/meta all blank)", retryable: true };
  }

  const baseChecks: UnchangedCheck[] = [
    { field: "title", ok: !!page.title, detail: page.title ? "present" : "missing" },
    { field: "h1", ok: !!page.h1, detail: page.h1 ? "present" : "missing" },
  ];

  if (exp.lever === "meta") return verifyMeta(exp, page, now, baseChecks);
  if (exp.lever === "internal_link") return verifyInternalLink(exp, page, url, now, baseChecks);
  if (exp.lever === "answer_block") return verifyAnswerBlock(exp, page, now, baseChecks);
  if (exp.lever === "title") return verifyField(exp, page.title, "title", now, baseChecks);
  if (exp.lever === "h1") return verifyField(exp, page.h1, "h1", now, baseChecks);
  if (exp.lever === "refresh") return verifyRefreshSection(exp, page, now, baseChecks);
  return { verified: false, reason: "verification_source_unavailable", expected: exp.proposedText, retryable: false };
}

/** Item 56 - refresh lever: the proposed SECTION HEADING must appear as a visible h2/h3 in the
 *  content region. Exact normalized match preferred; a heading that merely CONTAINS the proposed
 *  text also passes (an operator pasting "2026 Pricing" under "2026 Pricing in Iran" still
 *  shipped the section). */
function verifyRefreshSection(exp: PlannedExperimentRecord, page: ParsedPage, now: Date, base: UnchangedCheck[]): LiveVerificationResult {
  const expected = exp.proposedText;
  const target = normText(expected);
  if (!target) return { verified: false, reason: "verification_source_unavailable", expected, retryable: false };
  if (hasNoRenderedContent(page) && page.headings.length === 0) {
    return { verified: false, reason: "snapshot_stale", expected, observed: "no rendered content", retryable: true };
  }
  const exact = page.headings.find((h) => normText(h) === target);
  const containing = exact ?? page.headings.find((h) => normText(h).includes(target));
  if (containing) {
    return ok(containing, exact ? "section-heading-exact-match" : "section-heading-contains", "body:h2,h3", now, [
      ...base,
      { field: "headings_present", ok: true, detail: `${page.headings.length} section heading(s) on the page` },
    ]);
  }
  return { verified: false, reason: "expected_text_missing", expected, observed: page.headings.slice(0, 8).join(" | ") || "no section headings found", retryable: true };
}

function verifyMeta(exp: PlannedExperimentRecord, page: ParsedPage, now: Date, base: UnchangedCheck[]): LiveVerificationResult {
  const expected = exp.proposedText;
  const old = exp.currentText;
  if (page.metaCount > 1) {
    return { verified: false, reason: "multiple_values_found", expected, observed: `${page.metaCount} meta description tags`, retryable: false };
  }
  if (!page.metaDescription) return { verified: false, reason: "expected_text_missing", expected, retryable: true };
  if (normText(page.metaDescription) === normText(expected)) {
    return ok(page.metaDescription, "meta-exact-match", "head:meta[name=description]", now, [...base, { field: "meta_count", ok: true, detail: "single description tag" }]);
  }
  if (old && normText(page.metaDescription) === normText(old)) {
    return { verified: false, reason: "old_text_still_present", expected, observed: page.metaDescription, retryable: true };
  }
  return { verified: false, reason: "expected_text_missing", expected, observed: page.metaDescription, retryable: true };
}

function verifyField(exp: PlannedExperimentRecord, observed: string | null, field: string, now: Date, base: UnchangedCheck[]): LiveVerificationResult {
  const expected = exp.proposedText;
  if (!observed) return { verified: false, reason: "expected_text_missing", expected, retryable: true };
  if (normText(observed) === normText(expected)) return ok(observed, `${field}-exact-match`, `head:${field}`, now, base);
  if (exp.currentText && normText(observed) === normText(exp.currentText)) {
    return { verified: false, reason: "old_text_still_present", expected, observed, retryable: true };
  }
  return { verified: false, reason: "expected_text_missing", expected, observed, retryable: true };
}

function verifyInternalLink(exp: PlannedExperimentRecord, page: ParsedPage, pageUrl: string, now: Date, base: UnchangedCheck[]): LiveVerificationResult {
  if (exp.detail.kind !== "internal_link") return { verified: false, reason: "verification_source_unavailable", expected: exp.proposedText, retryable: false };
  const { anchorText, destinationUrl } = exp.detail;
  const expected = `link "${anchorText}" → ${destinationUrl}`;
  // The source sentence is mandatory — the link wraps text inside it. Without it we cannot prove placement.
  if (!exp.currentText?.trim()) return { verified: false, reason: "verification_source_unavailable", expected, retryable: false };
  if (hasNoRenderedContent(page)) return { verified: false, reason: "snapshot_stale", expected, observed: "no rendered content", retryable: true };

  // Locate the source paragraph; the matching anchor MUST be a descendant of it (not a sibling nav link).
  const src = normText(exp.currentText);
  const srcBlock = page.paraBlocks.find((b) => normText(b.text).includes(src));
  if (!srcBlock) return { verified: false, reason: "expected_text_missing", expected: exp.currentText, observed: "source sentence not found", retryable: true };

  const destPath = resolvePath(destinationUrl, pageUrl);
  const pagePath = normalizePath(pageUrl);
  const anchorMatches = srcBlock.links.filter((l) => normText(l.anchor) === normText(anchorText));
  if (anchorMatches.length === 0) return { verified: false, reason: "link_missing", expected, observed: "no matching anchor inside the source sentence", retryable: true };

  // ORIGIN+PATH match, same-origin only (an off-domain href with the same path must NOT verify).
  const good = anchorMatches.filter((l) => {
    const p = resolvePath(l.href, pageUrl);
    return sameOrigin(l.href, pageUrl) && p != null && destPath != null && p === destPath && p !== pagePath;
  });
  if (good.length === 0) {
    const observedHrefs = anchorMatches.map((l) => l.href).join(", ");
    return { verified: false, reason: "wrong_destination", expected, observed: observedHrefs || "anchor present, destination mismatch", retryable: true };
  }
  return ok(expected, "internal-link-in-source-paragraph", "body:p>a[href]", now, [
    ...base,
    { field: "matching_links", ok: good.length === 1, detail: `${good.length} link(s) in the source sentence` },
  ]);
}

function verifyAnswerBlock(exp: PlannedExperimentRecord, page: ParsedPage, now: Date, base: UnchangedCheck[]): LiveVerificationResult {
  const sentence = exp.proposedText || exp.currentText;
  const expected = `answer near top: "${sentence}"`;
  const target = normText(sentence);
  if (!target) return { verified: false, reason: "verification_source_unavailable", expected, retryable: false };
  if (hasNoRenderedContent(page)) return { verified: false, reason: "snapshot_stale", expected, observed: "no rendered content", retryable: true };

  // The answer must be (most of) a whole paragraph — not an incidental substring of a long paragraph.
  const matches = (p: string) => {
    const n = normText(p);
    if (!n.includes(target)) return false;
    return n === target || n.startsWith(target) || target.length / n.length >= ANSWER_PARAGRAPH_COVERAGE;
  };
  const idx = page.contentParagraphs.findIndex(matches);
  if (idx === -1) {
    return { verified: false, reason: "expected_text_missing", expected, observed: "answer sentence not found as a content paragraph", retryable: true };
  }
  if (idx > ANSWER_TOP_MAX_INDEX) {
    return { verified: false, reason: "answer_not_at_expected_location", expected, observed: `answer is content paragraph #${idx + 1} (still buried)`, retryable: true };
  }
  const occurrences = page.contentParagraphs.filter(matches).length;
  return ok(sentence, "answer-block-top-paragraph", `body:p#${idx + 1}`, now, [
    ...base,
    { field: "position", ok: true, detail: `content paragraph #${idx + 1}` },
    { field: "occurrences", ok: occurrences === 1, detail: `${occurrences} occurrence(s)` },
  ]);
}
