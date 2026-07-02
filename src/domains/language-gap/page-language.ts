/**
 * language-gap/page-language (2026-07-02, master plan item 24) - the page-side
 * half of the language-gap matrix: does an owned page actually carry content
 * in the script the query demand is asking for?
 *
 * Reads text Beacon already crawled into page_snapshots (title, meta
 * description, h1, h2s, body paragraph sample, FAQ text) - no new fetch, no
 * new Supabase table, bounded to whatever getPageSnapshots() already returns.
 * classifyScript from classify-query.ts (the same Unicode-range test the
 * query classifier uses) decides, letter by letter, how much of that text is
 * in the tenant's native script versus Latin.
 *
 * TENANT-AGNOSTIC: this only ever asks "how much of this page's text is in
 * the ARABIC_FA script block versus Latin" - it does not know the word
 * "Persian". A future non-Farsi tenant would need a different script-ratio
 * test plugged into classifyScript's script argument, not a rewrite of this
 * file's shape.
 */

import { classifyScript } from "./classify-query";

export type PageTextSource = {
  url: string;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  h2_list?: string[];
  body_paragraph_sample?: string[];
  faqs?: Array<{ question?: string | null; answer?: string | null }>;
};

export type PageLanguageProfile = {
  page: string;
  /** True when a meaningful share of the page's own text is in the
   *  Farsi/Arabic script block (not just a single stray character). */
  hasFarsiContent: boolean;
  /** Share (0..1) of scriptable letters (Farsi + Latin, punctuation/digits
   *  excluded) that fall in the Farsi/Arabic block. */
  farsiRatio: number;
  /** Total scriptable letters counted (Farsi + Latin combined) - lets a
   *  caller distinguish "truly zero Farsi text" from "almost no text at
   *  all" (a thin/empty page should not be treated the same as a
   *  confidently-all-English one). */
  lettersSampled: number;
};

/** A page needs at least this many farsi/latin letters counted before its
 *  ratio is trusted; thinner pages are reported with lettersSampled below
 *  this and callers should treat farsiRatio as low-confidence. */
export const MIN_LETTERS_FOR_CONFIDENT_RATIO = 40;
/** A page counts as "has Farsi content" once at least this share of its
 *  scriptable letters are Farsi-script (deliberately low: even a handful of
 *  interspersed Farsi words/phrases inside an English page is real Farsi
 *  content worth crediting, not full-page-only). */
const FARSI_CONTENT_MIN_RATIO = 0.03;

const ARABIC_RANGE_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/gu;
const LATIN_RANGE_RE = /[A-Za-z]/g;

/** Count Farsi-script vs Latin-script letters in one string. PURE. */
function countScripts(text: string | null | undefined): { farsi: number; latin: number } {
  if (!text) return { farsi: 0, latin: 0 };
  const farsi = text.match(ARABIC_RANGE_RE)?.length ?? 0;
  const latin = text.match(LATIN_RANGE_RE)?.length ?? 0;
  return { farsi, latin };
}

/** Concatenate every text field a snapshot carries into one sample for
 *  script counting. Order does not matter for a letter-count ratio. */
function collectPageText(s: PageTextSource): string {
  const parts: string[] = [s.title ?? "", s.meta_description ?? "", s.h1 ?? "", ...(s.h2_list ?? []), ...(s.body_paragraph_sample ?? [])];
  for (const f of s.faqs ?? []) {
    if (f.question) parts.push(f.question);
    if (f.answer) parts.push(f.answer);
  }
  return parts.join(" ");
}

/**
 * Build one page's language profile from its crawled snapshot text. PURE -
 * no I/O. `classifyScript` on the concatenated text also feeds the ratio
 * math (reused import keeps the "what counts as Farsi script" definition in
 * exactly one place across the query and page sides of the matrix).
 */
export function classifyPageLanguage(s: PageTextSource): PageLanguageProfile {
  const text = collectPageText(s);
  const { farsi, latin } = countScripts(text);
  const lettersSampled = farsi + latin;
  const farsiRatio = lettersSampled > 0 ? farsi / lettersSampled : 0;
  return {
    page: s.url,
    hasFarsiContent: farsiRatio >= FARSI_CONTENT_MIN_RATIO && farsi > 0,
    farsiRatio,
    lettersSampled,
  };
}

/**
 * Build the per-page language profile map for every owned page. Bounded by
 * whatever `snapshots` the caller already read (no new I/O here) - the
 * standard pattern every pure builder in this domain follows (build-today-
 * preview.ts already loads page_snapshots once and passes it around).
 */
export function classifyPageLanguages(snapshots: PageTextSource[]): Map<string, PageLanguageProfile> {
  const out = new Map<string, PageLanguageProfile>();
  for (const s of snapshots) {
    if (!s.url) continue;
    out.set(s.url, classifyPageLanguage(s));
  }
  return out;
}

/** Re-exported so callers that only need the raw script test (rare) do not
 *  need a second import path. */
export { classifyScript };
