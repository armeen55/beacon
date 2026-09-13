import "server-only";

/** pages/owned-context - the TARGETED read of what my own page actually says, and which of its words are its own.
 *  A page crawled since 2026-08-03 carries `body_text`: the WHOLE de-chromed main content, capped at the crawler's 100,000 character ceiling. This reader hands that back, in order, for a HANDFUL of explicitly asked URLs, and says out loud how much of the page it is. A row from before that column existed carries only the old bounded capture (20 paragraphs cut at 300 characters), and reads as `sample_only` forever, because what is not in a sample is UNKNOWN, never absent.
 *  A wider ask is PAGED rather than refused, every asked page gets an answer, and a page with no body says WHY (nothing on file, or a read that failed), so a missing body is never mistaken for an empty page. WHOLE-PAGE JUDGEMENTS ARE IMPOSSIBLE TO FAKE HERE: a diagnosis once judged what a page LACKS against a 1,200 character opening sample, so a fact in paragraph nine read as missing. `pageContains` is the honest way to ask, and `templateSlotOf` is the honest way to ask which of the page's words its template siblings do not already carry. */

import { log } from "@/lib/logger";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { selectPageVersion } from "./page-version";
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
  /** EVERY stored word of the page, for word-containment checks only, never for prompting. Empty when the crawl kept no body_text. */
  vocabulary: string;
  cardTexts: string[];
  /** Visible HTML questions with sampled answers; markup-only assertions stay in the raw snapshot. */
  faqs: { question: string; answer: string; source: "html_details" | "html_section" }[];
  entityNames: string[];
  internalLinks: { href: string; anchorText: string }[];
  fetchedAt: string | null;
  /** complete = the whole page is in this read. partial = a ceiling cut it, mine or the crawler's.
   *  sample_only = the CRAWLER itself kept a sample, so what is not here is UNKNOWN, never absent. */
  completeness: "complete" | "partial" | "sample_only";
  /** THE PAGE VERSION THESE WORDS ARE. A stored fact records the hash it was checked against, so a caller can prove a fact is about the page as it reads NOW instead of a version that has since changed. Without it nothing downstream can bind the two. */
  contentHash: string | null;
  /** What I hold and what I do not, in plain words, with the numbers. */
  heldNote: string;
  /** WHICH CAPTURE THESE WORDS ARE (pages/page-version). `stale_known_good` = the newest read captured nothing and an older confirmed body stands in: it proves presence, never a current absence. Absent means current. */
  version?: ReturnType<typeof selectPageVersion>["state"];
  /** When the newest, blank read happened, on a stale body. */
  newestAt?: string | null;
};

/** ONE QUERY'S OWN WIDTH: one split's pages, whole, plus the page under work. Sized to the ladder's MAX_SPLIT_PAGES plus the page under work. It bounds a QUERY, never the caller's question: a wider ask is paged. */
const MAX_URLS = 7;
/** The byte ceiling on ONE page's held content: roughly four times the largest capture the crawler can
 *  produce, so it truncates nothing real today and still bounds this read if the capture grows. */
const MAX_PAGE_CHARS = 48_000;
const CRAWL_CARDS = 20;
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
const COLUMNS = "url, title, h1, meta_description, fetched_at, word_count, h2_list, h3_list, faqs, body_text, body_paragraph_sample, card_texts, schema_entity_names, internal_links, content_hash, extraction_certainty";

type Row = {
  extraction_certainty?: unknown;
  url?: string | null; title?: string | null; h1?: string | null; meta_description?: string | null;
  fetched_at?: string | null; word_count?: unknown; body_text?: unknown;
  h2_list?: unknown; h3_list?: unknown; faqs?: unknown;
  body_paragraph_sample?: unknown; card_texts?: unknown; schema_entity_names?: unknown; internal_links?: unknown;
  content_hash?: string | null;
};

/** The whole page as ordered passages, split on whitespace so no word is cut in half. The stored text is
 *  one whitespace-normalized run, and a caller reading passage by passage should still read sentences. */
function passagesFromFullText(full: string): string[] {
  const out: string[] = []; let at = 0;
  while (at < full.length && out.length < MAX_PASSAGES) {
    let end = Math.min(at + MAX_PASSAGE_CHARS, full.length);
    if (end < full.length) { const space = full.lastIndexOf(" ", end); if (space > at) end = space; }
    out.push(full.slice(at, end).trim()); at = end + 1;
  }
  return out.filter(Boolean);
}
const cap = (value: unknown, chars: number): string | null => { const s = typeof value === "string" ? value.trim() : ""; return s ? s.slice(0, chars) : null; };
const items = (value: unknown, max: number, chars: number): string[] => (Array.isArray(value) ? value : []).map((x) => cap(x, chars)).filter((x): x is string => !!x).slice(0, max);
const wordsIn = (parts: readonly string[]): number => parts.join(" ").split(/\s+/).filter(Boolean).length;

/** The crawler now keeps list boundaries, so its own bullet is dropped here before anything is matched: what a page CONTAINS is exactly what it contained before the boundaries went in. */

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
  // Column presence chooses the representation; nonempty captured content establishes its scope below.
  const held = typeof row.body_text === "string";
  const full = held ? (row.body_text as string).trim() : "";
  const stored = held
    ? passagesFromFullText(full)
    : items(row.body_paragraph_sample, MAX_PASSAGES, MAX_PASSAGE_CHARS);
  const cardTexts = items(row.card_texts, CRAWL_CARDS, MAX_ITEM_CHARS);
  const entityNames = items(row.schema_entity_names, MAX_ENTITIES, MAX_ITEM_CHARS);
  const faqs: OwnedPageBody["faqs"] = (Array.isArray(row.faqs) ? row.faqs : [])
    .filter((f) => f?.source === "html_details" || f?.source === "html_section")
    .map((f) => ({ question: cap(f.question, MAX_ITEM_CHARS) ?? "", answer: cap(f.answer_excerpt, MAX_ITEM_CHARS) ?? "", source: f.source }))
    .filter((f) => f.question).slice(0, MAX_FAQS);
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
  // Only a nonempty held body proves capture scope; metadata and excerpts cannot reconstruct a whole page.
  const sampled = !held || full.length === 0;
  const truncated = passages.length < stored.length || (full.length >= CRAWL_BODY_TEXT_CHARS);
  // TRUNCATION RECORDS EXACTLY WHAT IS HELD, whichever verdict it lands under, and says WHOSE ceiling cut it.
  const range = passages.length < stored.length
    ? ` Passages 1 to ${passages.length} of the ${stored.length} on file are held here; passages ${passages.length + 1} to ${stored.length} are past the ${MAX_PAGE_CHARS} character ceiling for one page.`
    : truncated
      ? ` This page is longer than the ${CRAWL_BODY_TEXT_CHARS} characters one crawl keeps, so the end of it is not on file.`
      : "";
  return {
    url: typeof row.url === "string" ? row.url : "",
    title, h1, metaDescription: cap(row.meta_description, MAX_META_CHARS), headings, passages,
    openingSample: passages.length === 0 ? null
      : cap(passages.slice(0, MAX_OPENING_PARAGRAPHS).join(" ").replace(/\s+/g, " "), MAX_OPENING_CHARS),
    vocabulary: full, cardTexts, faqs, entityNames, internalLinks,
    fetchedAt: typeof row.fetched_at === "string" ? row.fetched_at : null,
    completeness: sampled ? "sample_only" : truncated ? "partial" : "complete",
    contentHash: typeof row.content_hash === "string" ? row.content_hash : null,
    heldNote: ((sampled
      ? `On file for this page: ${passages.length} stored passages and ${headings.length} headings, about ${heldWords} words of the ${pageWords ?? "unknown number of"} words its last crawl counted. The crawl keeps a sample, so anything not shown here is unknown, not missing: re-crawl the page before calling anything absent.`
      : truncated ? "" : `On file for this page: all ${heldWords} words its last crawl captured.`) + range).trim(),
  };
}

/** The newest persisted content for each of `urls`, keyed by canonicalUrlKey. Scoped to `tenantId` in the query itself, never filtered after a wide read.
 *
 *  EVERY PAGE ASKED FOR GETS AN ANSWER, and the WIDTH BOUNDS ONE QUERY RATHER THAN THE QUESTION. A wider ask used to be refused outright and answered with an EMPTY map, which every reader downstream reads as "this page
 *  has no text", so asking for eight pages made all eight look blank and a whole-page judgement was taken off nothing at all. The ask is PAGED now, with no ceiling on it, and a chunk that could not be read never erases
 *  the chunks that did: what landed is returned. WHY A PAGE IS ABSENT IS TYPED rather than left to the caller to guess: pass `misses` and every asked key that produced no body lands in it as `no_capture` (nothing is on
 *  file for that page) or `read_failed` (the store could not be read, so its content is UNKNOWN and never absent). An empty capture never overwrites a known body: pages/page-version decides which capture is the page. */
export async function loadOwnedPageBodies(tenantId: string, urls: string[], misses?: Map<string, "no_capture" | "read_failed">): Promise<Map<string, OwnedPageBody>> {
  const out = new Map<string, OwnedPageBody>();
  // ONE PAGE IS ONE SLOT. The bound counted STRINGS, so an absolute address and its own canonical key spent two of
  // three slots on one page and a two-page split could tip a caller over the bound. Deduped on the key this reader
  // already matches rows by, first spelling kept, so the bound counts the pages actually being asked for.
  const seen = new Set<string>(), asked: string[] = [];
  for (const u of urls ?? []) { const s = typeof u === "string" ? u.trim() : "", k = s ? canonicalUrlKey(s) : ""; if (k && !seen.has(k)) { seen.add(k); asked.push(s); } }
  if (!tenantId?.trim() || asked.length === 0) return out;
  const wanted = new Set(asked.map(canonicalUrlKey).filter(Boolean));
  const captures = new Map<string, Row[]>();
  const failed = new Set<string>();
  for (let at = 0; at < asked.length; at += MAX_URLS) {
    const slice = asked.slice(at, at + MAX_URLS);
    try {
      let pending = slice; /* A CAPPED READ IS RE-ASKED FOR WHAT IT LEFT UNANSWERED (reviewer, 2026-09-05): one row budget per chunk, ordered newest first across every page in it, let two pages with dozens of stored versions take the whole budget, so three pages with three captures each came back with no row at all, were reported as never captured, and the sibling rule fell silent on them and let a refused description through. A read cut at the budget asks again for the pages it did not answer; a page still unanswered after a cut that answered nothing new is UNKNOWN, never absent. */
      for (let round = 0; pending.length > 0 && round < 3; round += 1) {
        const { data, error } = await getSupabaseAdmin().from("page_snapshots").select(COLUMNS).eq("tenant_id", tenantId).in("url", variantsOf(pending)).order("fetched_at", { ascending: false }).limit(MAX_ROWS);
        if (error) throw new Error(error.message ?? String(error));
        // ONE RULE FOR WHICH CAPTURE IS THE PAGE (pages/page-version), the same one the snapshot loader applies, so the writer and the diagnosis can never hold two different pages under one address.
        for (const row of (data ?? []) as Row[]) { const key = canonicalUrlKey(typeof row.url === "string" ? row.url : ""); if (key && wanted.has(key)) captures.set(key, [...(captures.get(key) ?? []), row]); }
        const capped = (data ?? []).length >= MAX_ROWS, left = pending.filter((u) => !captures.has(canonicalUrlKey(u)));
        if (!capped || left.length === 0) break; // the read was not cut short, or every page it was asked for answered: what is still absent has no capture
        if (left.length === pending.length || round === 2) { for (const u of left) failed.add(canonicalUrlKey(u)); break; } // a cut read that answered none of the pages it was asked for, or the third cut in a row: those pages are unknown this pass
        pending = left;
      }
    } catch (e) {
      // THIS CHUNK ALONE IS UNKNOWN. Failing the whole read closed threw away pages that were genuinely in hand and told the caller they had no text, which is the very lie this reader exists to prevent.
      for (const u of slice) failed.add(canonicalUrlKey(u));
      log.warn("[owned-context] one page-body chunk could not be read; its pages are unknown and the rest still answer", { pages: slice.length, error: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    }
  }
  for (const [key, rows] of captures) {
    const v = selectPageVersion(rows, (r) => ({ fetchedAt: typeof r.fetched_at === "string" ? r.fetched_at : null, words: typeof r.word_count === "number" && r.word_count > 0 ? r.word_count : typeof r.body_text === "string" ? r.body_text.trim().split(/\s+/).filter(Boolean).length : 0, bodyHeld: typeof r.body_text === "string", certainty: typeof r.extraction_certainty === "string" ? r.extraction_certainty : null }));
    if (!v.content) continue;
    const body = bodyOf(v.content), newestAt = v.conflict && typeof (v.current as Row | null)?.fetched_at === "string" ? ((v.current as Row).fetched_at as string) : null;
    out.set(key, { ...body, version: v.state, newestAt, ...(v.conflict ? { heldNote: `${body.heldNote} The newest read of this page, ${newestAt?.slice(0, 10) ?? "recently"}, captured no words; these are the words captured ${body.fetchedAt?.slice(0, 10) ?? "earlier"}. They prove what the page said then, never what it lacks now.` } : {}) });
  }
  // AND THE ASKED PAGES THAT PRODUCED NO BODY SAY WHY, one typed word each, so "nothing is on file" is never confused with "the store could not be read".
  if (misses) for (const key of wanted) if (!out.has(key)) misses.set(key, failed.has(key) ? "read_failed" : "no_capture");
  return out;
}
