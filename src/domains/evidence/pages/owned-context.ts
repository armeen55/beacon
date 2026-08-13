import "server-only";

/**
 * pages/owned-context - the TARGETED read of what my own page actually says.
 *
 * A page crawled since 2026-08-03 carries `body_text`: the WHOLE de-chromed main content, capped at the
 * crawler's 100,000 character ceiling. This reader hands that back, in order, for a HANDFUL of explicitly
 * asked URLs, and says out loud how much of the page it is. A row from before that column existed carries
 * only the old bounded capture (20 paragraphs cut at 300 characters), and reads as `sample_only` forever,
 * because what is not in a sample is UNKNOWN, never absent.
 *
 * A wider ask is REFUSED rather than fanned out, and a failure fails closed to an EMPTY map, so a missing
 * body reads as "I do not have the page text", never as an empty page. WHOLE-PAGE JUDGEMENTS ARE IMPOSSIBLE
 * TO FAKE HERE: a diagnosis once judged what a page LACKS against a 1,200 character opening sample, so a
 * fact in paragraph nine read as missing. `pageContains` is the honest way to ask.
 */

import { log } from "@/lib/logger";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";

/** What my own page says, in its own words, with an honest account of how much of it I have. `fetchedAt`
 *  rides along so the caller judges staleness itself: a 46-day-old body is evidence with a date on it. */
export type OwnedPageBody = {
  url: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  /** Ordered headings AS STORED: the h1, then every h2, then every h3. */
  headings: string[];
  /** Ordered body passages EXACTLY as the store holds them, each one the crawler's own entry. */
  passages: string[];
  /** The opening passages joined, for callers that only ever wanted an opener. */
  openingSample: string | null;
  cardTexts: string[];
  faqs: { question: string; answer: string }[];
  entityNames: string[];
  internalLinks: { href: string; anchorText: string }[];
  fetchedAt: string | null;
  /** complete = the whole page is in this read. partial = a ceiling cut it, mine or the crawler's.
   *  sample_only = the CRAWLER itself kept a sample, so what is not here is UNKNOWN, never absent. */
  completeness: "complete" | "partial" | "sample_only";
  /** What I hold and what I do not, in plain words, with the numbers. */
  heldNote: string;
};

/** Three pages is the intended ask (one investigation's own pages). A wider ask is refused outright: this
 *  reader exists BECAUSE the whole-site read is too heavy. */
const MAX_URLS = 3;
/** The byte ceiling on ONE page's held content: roughly four times the largest capture the crawler can
 *  produce, so it truncates nothing real today and still bounds this read if the capture grows. */
const MAX_PAGE_CHARS = 48_000;
/** The CRAWLER's own caps (extractor.ts). A stored passage that reached the per paragraph limit was cut mid
 *  sentence, and a capture holding exactly the paragraph cap, or the card cap, stopped where the cap was rather
 *  than where the page ended. Any one of them is proof on its own that the capture is a sample of the page. */
const CRAWL_PARAGRAPH_CHARS = 300, CRAWL_CARDS = 20, CRAWL_PARAGRAPHS = 20;
/** The crawler's whole-page ceiling. A body_text that reached it was cut, so the read is partial. */
const CRAWL_BODY_TEXT_CHARS = 100_000;
/** What this reader takes from ONE row before the ceiling decides, deliberately far above what the crawler
 *  writes, so the CEILING is the real bound and the crawler's caps are only evidence. */
const MAX_PASSAGES = 200, MAX_PASSAGE_CHARS = 1_000;
const MAX_OPENING_CHARS = 1200, MAX_OPENING_PARAGRAPHS = 8;
const MAX_TITLE_CHARS = 200, MAX_META_CHARS = 320, MAX_ITEM_CHARS = 300;
const MAX_HEADINGS = 60, MAX_FAQS = 20, MAX_ENTITIES = 12, MAX_LINKS = 12;
/** A page keeps a snapshot history: read a few rows per URL newest-first and keep the newest. */
const MAX_ROWS = MAX_URLS * 8;
/** Every column of the capture that carries page CONTENT, and nothing else. */
const COLUMNS = "url, title, h1, meta_description, fetched_at, word_count, h2_list, h3_list, faqs, body_text, body_paragraph_sample, card_texts, schema_entity_names, internal_links";

type Row = {
  url?: string | null; title?: string | null; h1?: string | null; meta_description?: string | null;
  fetched_at?: string | null; word_count?: unknown; body_text?: unknown;
  h2_list?: unknown; h3_list?: unknown; faqs?: unknown;
  body_paragraph_sample?: unknown; card_texts?: unknown; schema_entity_names?: unknown; internal_links?: unknown;
};

/** The whole page as ordered passages, split on whitespace so no word is cut in half. The stored text is
 *  one whitespace-normalized run, and a caller reading passage by passage should still read sentences. */
function passagesFromFullText(full: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < full.length && out.length < MAX_PASSAGES) {
    let end = Math.min(at + MAX_PASSAGE_CHARS, full.length);
    if (end < full.length) {
      const space = full.lastIndexOf(" ", end);
      if (space > at) end = space;
    }
    out.push(full.slice(at, end).trim());
    at = end + 1;
  }
  return out.filter(Boolean);
}

const cap = (value: unknown, chars: number): string | null => {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s.slice(0, chars) : null;
};

const items = (value: unknown, max: number, chars: number): string[] =>
  (Array.isArray(value) ? value : [])
    .map((x) => cap(x, chars))
    .filter((x): x is string => !!x)
    .slice(0, max);

const wordsIn = (parts: readonly string[]): number =>
  parts.join(" ").split(/\s+/).filter(Boolean).length;

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Every spelling of one page, so a stored trailing slash or a `www.` host cannot hide the row. Production
 *  stores `https://www.host/path` while the decision path asks for `https://host/path`, and matching on the
 *  ask alone found NOTHING: an empty map on every real call while the body sat in the table. */
function variantsOf(urls: string[]): string[] {
  const out = new Set<string>();
  for (const raw of urls) {
    // A SCHEME-LESS ASK IS THE NORMAL ASK. Coverage holds canonical keys ("own.com/page") and the research
    // run writes the row under its absolute address, so synthesising variants only for inputs that ALREADY
    // had a scheme returned zero rows: a page just read looked unread and was fetched again, forever.
    const schemes = /^https?:\/\//i.test(raw) ? [raw] : [raw, `https://${raw}`, `http://${raw}`];
    const hosts = schemes.flatMap((u) => [u, /^https?:\/\/www\./i.test(u) ? u.replace(/^(https?:\/\/)www\./i, "$1") : u.replace(/^(https?:\/\/)/i, "$1www.")]);
    for (const u of hosts) {
      out.add(u.endsWith("/") ? u.replace(/\/+$/, "") : `${u}/`);
      out.add(u.replace(/\/+$/, ""));
    }
  }
  return [...out];
}

/** PURE. One stored row as the complete useful content the store holds for that page, bounded, with the
 *  completeness verdict DERIVED from the crawler's own caps rather than assumed. */
function bodyOf(row: Row): OwnedPageBody {
  const title = cap(row.title, MAX_TITLE_CHARS), h1 = cap(row.h1, MAX_ITEM_CHARS);
  const headings = [...(h1 ? [h1] : []), ...items(row.h2_list, MAX_HEADINGS, MAX_ITEM_CHARS), ...items(row.h3_list, MAX_HEADINGS, MAX_ITEM_CHARS)].slice(0, MAX_HEADINGS);
  // A HEADING IS A LABEL FOR TEXT, NEVER THE TEXT, so headings can never stand in for body passages here.
  // THE WHOLE PAGE WHEN THE CRAWL KEPT IT: body_text is the de-chromed main content in full, so it replaces
  // the 20-paragraph sample outright. Only a row written before that column existed falls back to the sample.
  // THE COLUMN'S PRESENCE is what says the page was held whole, never its length: a page with
  // nothing to say holds an empty string, and reading that as "no body on file" would have called
  // a genuinely empty page a sample and left every absence unknowable on it.
  const held = typeof row.body_text === "string";
  const full = held ? (row.body_text as string).trim() : "";
  const stored = held
    ? passagesFromFullText(full)
    : items(row.body_paragraph_sample, MAX_PASSAGES, MAX_PASSAGE_CHARS);
  const cardTexts = items(row.card_texts, CRAWL_CARDS, MAX_ITEM_CHARS);
  const entityNames = items(row.schema_entity_names, MAX_ENTITIES, MAX_ITEM_CHARS);
  const faqs = (Array.isArray(row.faqs) ? row.faqs : []).slice(0, MAX_FAQS)
    .map((f) => { const q = (f ?? {}) as { question?: unknown; answer_excerpt?: unknown };
      return { question: cap(q.question, MAX_ITEM_CHARS) ?? "", answer: cap(q.answer_excerpt, MAX_ITEM_CHARS) ?? "" }; })
    .filter((f) => f.question);
  const internalLinks = (Array.isArray(row.internal_links) ? row.internal_links : []).slice(0, MAX_LINKS)
    .map((l) => { const link = (l ?? {}) as { href?: unknown; anchor_text?: unknown };
      return { href: cap(link.href, MAX_ITEM_CHARS) ?? "", anchorText: cap(link.anchor_text, MAX_ITEM_CHARS) ?? "" }; })
    .filter((l) => l.href);
  // THE CEILING, SPENT ON THE FIXED PARTS FIRST, then on passages in the order the page said them, so
  // truncation always records exactly how many of the store's passages made it in.
  const fixed = [title ?? "", cap(row.meta_description, MAX_META_CHARS) ?? "", ...headings, ...cardTexts, ...entityNames,
    ...faqs.flatMap((f) => [f.question, f.answer])].join(" ").length;
  const passages: string[] = [];
  let used = fixed;
  for (const p of stored) { if (used + p.length > MAX_PAGE_CHARS) break; passages.push(p); used += p.length; }
  const heldWords = wordsIn([...headings, ...passages, ...cardTexts, ...faqs.flatMap((f) => [f.question, f.answer])]);
  const pageWords = typeof row.word_count === "number" && row.word_count > 0 ? row.word_count : null;
  // WITH body_text THE PAGE IS HELD, so the only question left is whether a ceiling cut it: the crawler's at
  // 100,000 characters, or mine. WITHOUT it the capture is a sample whenever the crawler cut a paragraph mid
  // sentence, stopped at its own paragraph or card cap, or kept fewer words than the page it counted. No word
  // count on file proves nothing, so that is a sample too: an unprovable claim of completeness is exactly what
  // this type exists to prevent.
  const sampled = held
    ? false
    : stored.some((p) => p.length >= CRAWL_PARAGRAPH_CHARS) || stored.length === CRAWL_PARAGRAPHS
      || cardTexts.length >= CRAWL_CARDS || pageWords == null || heldWords < pageWords;
  const truncated = passages.length < stored.length || (full.length >= CRAWL_BODY_TEXT_CHARS);
  // TRUNCATION RECORDS EXACTLY WHAT IS HELD, whichever verdict it lands under, and says WHOSE ceiling cut it.
  const range = passages.length < stored.length
    ? ` I am holding passages 1 to ${passages.length} of the ${stored.length} on file; passages ${passages.length + 1} to ${stored.length} are past my ${MAX_PAGE_CHARS} character ceiling for one page.`
    : truncated
      ? ` This page is longer than the ${CRAWL_BODY_TEXT_CHARS} characters one crawl keeps, so the end of it is not on file.`
      : "";
  return {
    url: typeof row.url === "string" ? row.url : "",
    title, h1, metaDescription: cap(row.meta_description, MAX_META_CHARS), headings, passages,
    openingSample: passages.length === 0 ? null
      : cap(passages.slice(0, MAX_OPENING_PARAGRAPHS).join(" ").replace(/\s+/g, " "), MAX_OPENING_CHARS),
    cardTexts, faqs, entityNames, internalLinks,
    fetchedAt: typeof row.fetched_at === "string" ? row.fetched_at : null,
    completeness: sampled ? "sample_only" : truncated ? "partial" : "complete",
    heldNote: ((sampled
      ? `On file for this page: ${passages.length} stored passages and ${headings.length} headings, about ${heldWords} words of the ${pageWords ?? "unknown number of"} words its last crawl counted. The crawl keeps a sample, so anything not shown here is unknown, not missing: re-crawl the page before calling anything absent.`
      : truncated ? "" : `On file for this page: all ${heldWords} words its last crawl captured.`) + range).trim(),
  };
}

/**
 * CONTAINS OR UNKNOWN. Does this page say `phrase` anywhere? "yes" is always trustworthy, because found is
 * found. "no" comes back ONLY when the whole page is held: a sample proves presence and can never prove
 * absence, so everything else is "unknown". That is what stops a whole-page verdict being written off a
 * fragment, which is how a fact in paragraph nine came to read as a gap.
 */
export function pageContains(page: OwnedPageBody | null | undefined, phrase: string): "yes" | "no" | "unknown" {
  const needle = norm(phrase ?? "");
  if (page == null || !needle) return "unknown";
  const hay = norm([page.title ?? "", page.h1 ?? "", page.metaDescription ?? "", ...page.headings, ...page.passages,
    ...page.cardTexts, ...page.faqs.flatMap((f) => [f.question, f.answer]), ...page.entityNames,
    ...page.internalLinks.map((l) => l.anchorText)].join(" \n "));
  if (hay.includes(needle)) return "yes";
  return page.completeness === "complete" ? "no" : "unknown";
}

/** The newest persisted content for each of `urls`, keyed by canonicalUrlKey. Scoped to `tenantId` in the
 *  query itself, never filtered after a wide read. An empty map means "I have no page text for you". */
export async function loadOwnedPageBodies(tenantId: string, urls: string[]): Promise<Map<string, OwnedPageBody>> {
  const out = new Map<string, OwnedPageBody>();
  const asked = (urls ?? []).map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean);
  if (!tenantId?.trim() || asked.length === 0) return out;
  if (asked.length > MAX_URLS) {
    log.warn("[owned-context] refused a page-body read wider than its bound", { asked: asked.length, max: MAX_URLS });
    return out;
  }
  const wanted = new Set(asked.map(canonicalUrlKey).filter(Boolean));
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("page_snapshots").select(COLUMNS)
      .eq("tenant_id", tenantId)
      .in("url", variantsOf(asked))
      .order("fetched_at", { ascending: false })
      .limit(MAX_ROWS);
    if (error) return out;
    for (const row of (data ?? []) as Row[]) {
      const key = canonicalUrlKey(typeof row.url === "string" ? row.url : "");
      if (!key || !wanted.has(key)) continue;
      const body = bodyOf(row);
      const prev = out.get(key);
      if (prev && (prev.fetchedAt ?? "") >= (body.fetchedAt ?? "")) continue;
      out.set(key, body);
    }
    return out;
  } catch (e) {
    log.warn("[owned-context] page-body read failed (fail-closed to no bodies)", {
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return new Map();
  }
}
