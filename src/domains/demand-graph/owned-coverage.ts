/**
 * owned-coverage (2026-07-11) - the detector that stops the New Pages board (and
 * the keyword-library gap lane) from recommending a BRAND NEW page for a topic an
 * owned page already targets. Two PURE signals over already-loaded data:
 *
 *   (a) gsc_serving   an owned page already receives Google impressions for one of
 *                     the cluster's queries at ANY position (even page 5), so
 *                     Google itself already sends this query to a page of mine.
 *   (b) content       an owned page's title, H1, or URL slug topically matches the
 *                     cluster (phrase containment either direction, or a >= 2
 *                     distinguishing-token subset), so a page of mine is already
 *                     written about it.
 *
 * WHY THIS EXISTS: the citation gate (create-page-ownership-gate.ts) needs an AI
 * citation, and the ownership registry (ownership/registry.ts) needs either a
 * cannibalization case (2+ owned pages) or a top-10 SERP intent cluster. A single
 * owned page ranking at position 52 produces NEITHER signal, so a create_page card
 * for "nowruz persian new year" slipped through while Iranopedia's own /nowruz page
 * (title "Nowruz - Persian New Year") already targeted it. This detector closes
 * exactly that blind spot: any owned page, at any position, matched by serving OR
 * content.
 *
 * PURE / no I/O. The loader glue (owned-coverage-loader.ts) reads the GSC serving
 * rows and the owned-page title/h1 and hands both here.
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";

export type OwnedCoverageBasis = "gsc_serving" | "content";

/** One owned page's crawled content facts (page_snapshots projection). */
export type OwnedPageContent = {
  url: string;
  title: string | null;
  h1: string | null;
  /** Main-content word count from the latest crawl snapshot; null when the page
   *  was never crawled. Additive (2026-07-20): the redirect-safety gate reads it
   *  to tell a thin shell from a real standalone page. The coverage detector
   *  ignores it, so pre-existing callers are byte-identical. */
  wordCount?: number | null;
};

/** One GSC serving row: which owned page Google sends a query to, at any position. */
export type OwnedServingRow = {
  query: string;
  ownerPage: string | null;
  /** impression-weighted average position, or null when unknown. */
  position: number | null;
};

export type OwnedCoverageMatch = {
  /** The owned page that already covers this topic (full URL). */
  ownedUrl: string;
  /** The display path of that page ("/nowruz"), for the operator sentence. */
  ownedPath: string;
  basis: OwnedCoverageBasis;
  /** Best (lowest) GSC position when basis is gsc_serving; null for content. */
  position: number | null;
  /** The query (serving) or the title/h1/slug text (content) that matched. */
  matchedOn: string;
  /** First-person, dash-free sentence naming the owned page - safe to render. */
  sentence: string;
  /** First-person, dash-free detail explaining WHY it counts as covered. */
  detail: string;
};

// ---------------------------------------------------------------------------
// Normalization + matching (pure)
// ---------------------------------------------------------------------------

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** A phrase reduced to lowercased, de-accented, single-spaced words - the surface
 *  the "exact containment both directions" check runs over. URLs collapse to words. */
function normalizePhrase(text: string | null | undefined): string {
  if (!text) return "";
  return stripDiacritics(String(text).toLowerCase())
    .replace(/https?:\/\/[^\s]*/g, (u) => u.replace(/[^a-z0-9]+/g, " "))
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(phrase: string): number {
  return phrase ? phrase.split(" ").length : 0;
}

/**
 * Two topics match when EITHER:
 *   (P) phrase containment: the shorter normalized phrase (>= 2 words AND carrying
 *       at least one distinguishing content token) appears as a contiguous run of
 *       words inside the longer one. This is the "persian new year matches a title
 *       containing Persian New Year" rule the task asks for, independent of the
 *       stopword stripping that would otherwise reduce "persian new year" to a
 *       single generic token.
 *   (T) token subset: the smaller distinguishing-token set (>= 2 tokens) is fully
 *       contained in the larger - the same convention the ownership registry and
 *       question universe already use, so a reordered/pluralized variant still
 *       matches even when the phrases are not contiguous.
 */
export function topicsOverlap(a: string, b: string): boolean {
  const na = normalizePhrase(a);
  const nb = normalizePhrase(b);
  if (!na || !nb) return false;

  // (P) contiguous phrase containment, either direction.
  const [small, large] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (wordCount(small) >= 2 && topicTokens(small).length >= 1) {
    if (` ${large} `.includes(` ${small} `)) return true;
  }

  // (T) distinguishing-token subset, either direction (>= 2-token floor).
  const ta = new Set(topicTokens(a));
  const tb = new Set(topicTokens(b));
  if (ta.size === 0 || tb.size === 0) return false;
  const [ss, ll] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (ss.size < 2) return false;
  for (const t of ss) if (!ll.has(t)) return false;
  return true;
}

/** The display path for an owned URL ("/nowruz"), used in the operator sentence. */
export function ownedPagePath(url: string): string {
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const u = new URL(withScheme);
    const p = u.pathname.replace(/\/+$/, "");
    return p || "/";
  } catch {
    const afterHost = url.replace(/^https?:\/\//i, "");
    const slash = afterHost.indexOf("/");
    if (slash < 0) return "/";
    const p = afterHost.slice(slash).replace(/\/+$/, "");
    return p || "/";
  }
}

/** The slug words of an owned URL ("/nowruz-persian-new-year" -> "nowruz persian new year"). */
function slugWords(url: string): string {
  const path = ownedPagePath(url);
  const last = path.split("/").filter(Boolean).pop() ?? "";
  return last.replace(/[^a-z0-9]+/gi, " ").trim();
}

function watchingSentence(path: string): string {
  return `You already have ${path} for this topic. I would improve that page before building a new one.`;
}

function servingDetail(path: string, query: string, position: number | null): string {
  const pos = position != null && position > 0 ? ` at position ${Math.round(position)}` : "";
  return `I already show up on Google for "${query}"${pos}, and ${path} is the page that gets it.`;
}

function contentDetail(path: string, kind: string, text: string): string {
  return `The ${kind} on ${path} already reads "${text.trim()}".`;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export type OwnedCoverageInput = {
  serving: readonly OwnedServingRow[];
  ownedPages: readonly OwnedPageContent[];
};

/**
 * Does an owned page already cover this one topic? GSC serving is checked first
 * (Google's own attribution is the strongest signal), then owned content. Returns
 * null when nothing of mine covers it - the honest "this really is a gap" answer.
 */
export function detectOwnedCoverageForTopic(topic: string, input: OwnedCoverageInput): OwnedCoverageMatch | null {
  if (!topic || !topic.trim()) return null;

  // (a) gsc_serving: the owned page Google already sends a matching query to, best
  // (lowest) position first, so the sentence names the page most likely to win.
  let bestServing: { url: string; position: number | null; query: string } | null = null;
  for (const row of input.serving) {
    if (!row.ownerPage || !row.query) continue;
    if (!topicsOverlap(topic, row.query)) continue;
    const pos = row.position ?? Infinity;
    if (bestServing === null || pos < (bestServing.position ?? Infinity)) {
      bestServing = { url: row.ownerPage, position: row.position, query: row.query };
    }
  }
  if (bestServing) {
    const path = ownedPagePath(bestServing.url);
    return {
      ownedUrl: bestServing.url,
      ownedPath: path,
      basis: "gsc_serving",
      position: bestServing.position,
      matchedOn: bestServing.query,
      sentence: watchingSentence(path),
      detail: servingDetail(path, bestServing.query, bestServing.position),
    };
  }

  // (b) content: an owned page whose title / H1 / slug topically matches. Pick the
  // strongest (title beats H1 beats slug) so the detail names the clearest evidence.
  let bestContent: { url: string; kind: string; text: string } | null = null;
  for (const page of input.ownedPages) {
    if (!page.url) continue;
    const candidates: { kind: string; text: string }[] = [];
    if (page.title && page.title.trim()) candidates.push({ kind: "title", text: page.title });
    if (page.h1 && page.h1.trim()) candidates.push({ kind: "H1", text: page.h1 });
    const slug = slugWords(page.url);
    if (slug) candidates.push({ kind: "page address", text: slug });
    for (const c of candidates) {
      if (topicsOverlap(topic, c.text)) {
        // First title/H1/slug wins per page (candidates are already best-first); the
        // first matching page across the set wins overall (stable input order).
        bestContent = { url: page.url, kind: c.kind, text: c.text };
        break;
      }
    }
    if (bestContent) break;
  }
  if (bestContent) {
    const path = ownedPagePath(bestContent.url);
    return {
      ownedUrl: bestContent.url,
      ownedPath: path,
      basis: "content",
      position: null,
      matchedOn: `${bestContent.kind}: ${bestContent.text.trim()}`,
      sentence: watchingSentence(path),
      detail: contentDetail(path, bestContent.kind, bestContent.text),
    };
  }
  return null;
}

export type CardOwnedCoverage = {
  /** Set when the card's OWN topic or its demand-driving keyword is already owned:
   *  the card must demote to the watching state and prefer the owned page. */
  primary: OwnedCoverageMatch | null;
  /** "Also covers" topics an owned page targets: the card may stay (its primary
   *  intent is distinct) but must drop these from "Also covers" and acknowledge the
   *  owned page. Empty when `primary` is set (a demoted card needs no per-topic list). */
  coveredAlsoCovers: { topic: string; match: OwnedCoverageMatch }[];
};

/**
 * The card-level verdict. `coreTopics` are the card's headline topic plus its
 * demand-driving keyword; if ANY is owned the card demotes to watching (default (a)).
 * Otherwise the "Also covers" topics are checked so the card can drop the ones an
 * owned page already targets and acknowledge them (case (b)).
 */
export function detectOwnedCoverageForCard(args: {
  coreTopics: readonly string[];
  alsoCovers: readonly string[];
  serving: readonly OwnedServingRow[];
  ownedPages: readonly OwnedPageContent[];
}): CardOwnedCoverage {
  const input: OwnedCoverageInput = { serving: args.serving, ownedPages: args.ownedPages };

  let primary: OwnedCoverageMatch | null = null;
  for (const t of args.coreTopics) {
    const m = detectOwnedCoverageForTopic(t, input);
    if (!m) continue;
    // A serving match (Google's own attribution) is preferred over a content match.
    if (!primary || (primary.basis === "content" && m.basis === "gsc_serving")) primary = m;
  }

  const coveredAlsoCovers: { topic: string; match: OwnedCoverageMatch }[] = [];
  if (!primary) {
    const seen = new Set<string>();
    for (const t of args.alsoCovers) {
      if (!t || seen.has(t)) continue;
      seen.add(t);
      const m = detectOwnedCoverageForTopic(t, input);
      if (m) coveredAlsoCovers.push({ topic: t, match: m });
    }
  }

  return { primary, coveredAlsoCovers };
}

/** The first-person acknowledgment line for a create card that stays but must not
 *  double an owned page (case (b)). Names the owned page and the covered topics. */
export function acknowledgeSentence(match: OwnedCoverageMatch, coveredTopics: readonly string[]): string {
  const topics = coveredTopics.filter(Boolean);
  const named = topics.slice(0, 2).join(" and ");
  const remainder = topics.length > 2 ? ` and ${topics.length - 2} more related topic${topics.length === 3 ? "" : "s"}` : "";
  const topicClause = topics.length > 0 ? ` for ${named}${remainder}` : "";
  return `I already have ${match.ownedPath}${topicClause}, so this new page should target something different and not repeat it.`;
}
