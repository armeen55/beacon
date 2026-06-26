/**
 * winner-patterns (2026-06-25, Sprint 6 · plan P9 Deep Teardown) — PURE (cheerio).
 *
 * The teardown already extracts structure (title/meta/headings/schema/word-count/
 * FAQ). The plan's P9 wants the DEEPER "why they win" signals the current extractor
 * misses: E-E-A-T (author byline + credentials, published/updated freshness),
 * AUTHORITY (outbound citations to other domains), and TRUST (review/rating schema).
 * This pulls those from already-fetched competitor HTML ($0, no extra request) and
 * compares your page to the winners to name what you're missing. Deterministic,
 * tenant-agnostic. Pinned by winner-patterns.test.ts.
 */

import { load as cheerioLoad } from "cheerio";

export type WinnerSignals = {
  wordCount: number;
  hasAuthorByline: boolean;
  hasAuthorCredentials: boolean;
  hasPublishedDate: boolean;
  hasUpdatedDate: boolean;
  /** distinct external domains linked to (a proxy for cited authority) */
  outboundCitations: number;
  hasReviewSchema: boolean;
  hasFaq: boolean;
};

const CREDENTIAL_RE = /\b(ph\.?d|m\.?d|dds|do|rn|cpa|esq|professor|board[- ]certified|licensed|years? of experience|expert)\b/i;
const BYLINE_RE = /\bby\s+[A-Z][a-z]+/;

function hostOf(href: string): string | null {
  const m = href.trim().match(/^https?:\/\/([^/?#]+)/i);
  if (!m) return null;
  return m[1].replace(/^www\./i, "").toLowerCase();
}

function jsonLdMentions(html: string, types: string[]): boolean {
  // Require the type to be the VALUE of an "@type" key (optionally inside an array),
  // not just both strings appearing somewhere — avoids false positives from the word
  // (e.g. "Review") in body text while a different @type sits elsewhere.
  const lc = html.toLowerCase();
  return types.some((t) => new RegExp(`"@type"\\s*:\\s*\\[?\\s*"${t.toLowerCase()}"`, "i").test(lc));
}

/** Extract the deep winner signals from page HTML. PURE. ownHost (the page's own
 *  domain) is excluded from the outbound-citation count. */
export function extractWinnerSignals(html: string, opts: { ownHost?: string | null } = {}): WinnerSignals {
  if (!html || typeof html !== "string") {
    return { wordCount: 0, hasAuthorByline: false, hasAuthorCredentials: false, hasPublishedDate: false, hasUpdatedDate: false, outboundCitations: 0, hasReviewSchema: false, hasFaq: false };
  }
  const $ = cheerioLoad(html);
  $("script,style,noscript").remove();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").filter(Boolean).length : 0;

  const ownHost = (opts.ownHost ?? "").replace(/^www\./i, "").toLowerCase();
  const externalHosts = new Set<string>();
  $("a[href]").each((_, el) => {
    const h = hostOf($(el).attr("href") ?? "");
    if (h && h !== ownHost) externalHosts.add(h);
  });

  const authorMarkup =
    $('[rel="author"], [itemprop="author"], [class*="author" i], [class*="byline" i], meta[name="author"]').length > 0;
  const hasAuthorByline = authorMarkup || BYLINE_RE.test(bodyText.slice(0, 4000));
  const authorRegion = $('[itemprop="author"], [class*="author" i], [class*="byline" i], [class*="bio" i]').text();
  const hasAuthorCredentials = CREDENTIAL_RE.test(authorRegion) || CREDENTIAL_RE.test(bodyText.slice(0, 4000));

  const hasPublishedDate =
    $('time, meta[property="article:published_time"], [itemprop="datePublished"]').length > 0;
  const hasUpdatedDate =
    $('meta[property="article:modified_time"], [itemprop="dateModified"]').length > 0 || /\b(updated|last reviewed)\b/i.test(bodyText.slice(0, 4000));

  const hasReviewSchema = jsonLdMentions(html, ["Review", "AggregateRating", "Rating"]);
  const hasFaq = jsonLdMentions(html, ["FAQPage"]) || $("details").length >= 2;

  return { wordCount, hasAuthorByline, hasAuthorCredentials, hasPublishedDate, hasUpdatedDate, outboundCitations: externalHosts.size, hasReviewSchema, hasFaq };
}

export type WinnerGap = { signal: keyof WinnerSignals | "wordCount"; label: string; winnersWithIt: number; total: number };

const SIGNAL_LABELS: Record<string, string> = {
  hasAuthorByline: "a clear author byline",
  hasAuthorCredentials: "author credentials / expertise (E-E-A-T)",
  hasPublishedDate: "a visible published date",
  hasUpdatedDate: "a freshness / last-updated date",
  outboundCitations: "outbound citations to authoritative sources",
  hasReviewSchema: "review / rating schema",
  hasFaq: "an FAQ section",
  wordCount: "comparable depth (word count)",
};

/**
 * Compare your page to the winners and name what the MAJORITY of winners have that
 * you lack. PURE. Returns gaps sorted by how common the signal is among winners.
 * Fail-closed: with no winners, returns []. wordCount gap fires only if you're
 * materially thinner than the winners' median.
 */
export function compareToWinners(yours: WinnerSignals | null, winners: WinnerSignals[]): WinnerGap[] {
  const valid = (winners ?? []).filter(Boolean);
  if (!yours || valid.length === 0) return [];
  const total = valid.length;
  const majority = Math.ceil(total / 2);
  const gaps: WinnerGap[] = [];

  const boolSignals: (keyof WinnerSignals)[] = ["hasAuthorByline", "hasAuthorCredentials", "hasPublishedDate", "hasUpdatedDate", "hasReviewSchema", "hasFaq"];
  for (const s of boolSignals) {
    const withIt = valid.filter((w) => w[s]).length;
    if (withIt >= majority && !yours[s]) gaps.push({ signal: s, label: SIGNAL_LABELS[s], winnersWithIt: withIt, total });
  }

  const citers = valid.filter((w) => w.outboundCitations >= 3).length;
  if (citers >= majority && yours.outboundCitations < 3) gaps.push({ signal: "outboundCitations", label: SIGNAL_LABELS.outboundCitations, winnersWithIt: citers, total });

  const medianWc = [...valid.map((w) => w.wordCount)].sort((a, b) => a - b)[Math.floor(total / 2)] ?? 0;
  if (medianWc > 300 && yours.wordCount < medianWc * 0.6) gaps.push({ signal: "wordCount", label: SIGNAL_LABELS.wordCount, winnersWithIt: total, total });

  return gaps.sort((a, b) => b.winnersWithIt - a.winnersWithIt);
}
