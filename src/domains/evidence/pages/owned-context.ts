import "server-only";
import { load } from "cheerio";

/** Tenant-scoped page body reader. Every missing read is typed; samples cannot prove absence. */

import { log } from "@/lib/logger";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { selectPageVersion } from "./page-version";
import { selectedSnapshots } from "@/lib/persistence/repositories/snapshot-reader";
import { visibleFaqs, type PageSnapshot } from "./types";
import { sectionsFrom } from "@/domains/evidence/funnel/research-evidence";

/** Saved page body with version, coverage, and source structure. */
export type OwnedPageBody = {
  pageId?: string; captureId?: string; latestCaptureId?: string; captureStates?: Record<string, unknown>[]; url: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  headings: string[];
  passages: string[];
  answerPassages?: string[];
  passageMeta?: { id: string; heading: string | null }[];
  openingSample: string | null;
  vocabulary: string;
  cardTexts: string[];
  faqs: { question: string; answer: string; source: "html_details" | "html_section"; answerComplete?: boolean }[];
  entityNames: string[];
  internalLinks: { href: string; anchorText: string }[];
  /** Exact editable paragraph and following link component from a coherent captured DOM. */
  linkedParagraphs?: { text: string; links: { href: string; anchor: string }[] }[];
  capturedLinks?: { href: string; anchor: string }[];
  sourceCapture?: PageSnapshot["content_capture"];
  fetchedAt: string | null;
  /** Only complete permits whole-page absence claims. */
  completeness: "complete" | "partial" | "sample_only";
  contentHash: string | null;
  heldNote: string;
  version?: ReturnType<typeof selectPageVersion>["state"];
  newestAt?: string | null;
};

/** Bound one query, then page wider asks. */
const MAX_URLS = 7;
const MAX_PAGE_CHARS = 48_000;
const CRAWL_CARDS = 20;
const CRAWL_BODY_TEXT_CHARS = 100_000;
const MAX_PASSAGES = 200, MAX_PASSAGE_CHARS = 1_000;
const MAX_OPENING_CHARS = 1200, MAX_OPENING_PARAGRAPHS = 8;
const MAX_TITLE_CHARS = 200, MAX_META_CHARS = 320, MAX_ITEM_CHARS = 300;
const MAX_HEADINGS = 60, MAX_FAQS = 20, MAX_ENTITIES = 12, MAX_LINKS = 12;
const COLUMNS = "id, page_id, url, title, h1, meta_description, fetched_at, word_count, h2_list, h3_list, faqs, body_text, body_paragraph_sample, card_texts, schema_entity_names, internal_links, content_hash, extraction_certainty, content_capture";

type Row = Partial<Record<keyof PageSnapshot, unknown>> & Pick<Partial<PageSnapshot>, "url" | "fetched_at">;

/** Stable heading-path passage IDs survive recrawls that leave structure unchanged. */
function passagesOf(full: string, row: Row, capture: PageSnapshot["content_capture"] | undefined): { id: string; heading: string | null; text: string }[] {
  const slug = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "section";
  const parts = (text: string): string[] => { const out: string[] = []; let held = "";
    for (const unit of text.split("\n").flatMap((b) => (b.length > MAX_PASSAGE_CHARS ? b.split(/(?<=[.!?])\s+/) : [b]))) { if (!unit) continue;
      if (held && held.length + 1 + unit.length > MAX_PASSAGE_CHARS) { out.push(held); held = unit; } else held = held ? `${held} ${unit}` : unit; }
    if (held) out.push(held); return out; };
  const path: string[] = [], seen = new Map<string, number>(), out: { id: string; heading: string | null; text: string }[] = [];
  for (const s of sectionsFrom(full, { h1: cap(row.h1, MAX_ITEM_CHARS), h2: items(row.h2_list, MAX_HEADINGS, MAX_ITEM_CHARS), h3: items(row.h3_list, MAX_HEADINGS, MAX_ITEM_CHARS) }, capture)) {
    if (s.level > 0) { path.splice(s.level - 1); path[s.level - 1] = slug(s.heading ?? ""); }
    const key = s.level === 0 ? "opening" : path.filter(Boolean).join("/"), n = (seen.get(key) ?? 0) + 1; seen.set(key, n);
    // Part 0 preserves the heading in the joined page text.
    if (s.level > 0 && s.heading) out.push({ id: `${key}${n > 1 ? `~${n}` : ""}#0`, heading: s.heading, text: s.heading });
    for (const [i, text] of parts(s.text).entries()) out.push({ id: `${key}${n > 1 ? `~${n}` : ""}#${i + 1}`, heading: s.heading, text });
  }
  return out;
}
const cap = (value: unknown, chars: number): string | null => { const s = typeof value === "string" ? value.trim() : ""; return s ? s.slice(0, chars) : null; };
const items = (value: unknown, max: number, chars: number): string[] => (Array.isArray(value) ? value : []).map((x) => cap(x, chars)).filter((x): x is string => !!x).slice(0, max);

/** Ask for all stored spellings of a canonical URL. */
function variantsOf(urls: string[]): string[] {
  const out = new Set<string>();
  for (const raw of urls) {
    const schemes = /^https?:\/\//i.test(raw) ? [raw] : [raw, `https://${raw}`, `http://${raw}`];
    const hosts = schemes.flatMap((u) => [u, /^https?:\/\/www\./i.test(u) ? u.replace(/^(https?:\/\/)www\./i, "$1") : u.replace(/^(https?:\/\/)/i, "$1www.")]);
    for (const u of hosts) {
      out.add(u.endsWith("/") ? u.replace(/\/+$/, "") : `${u}/`);
      out.add(u.replace(/\/+$/, ""));
    }
  }
  return [...out];
}

/** Derive bounded content coverage from the stored capture. */
function bodyOf(row: Row): OwnedPageBody {
  const raw = row.content_capture as PageSnapshot["content_capture"];
  const sourceCapture = raw?.version === 1 && typeof raw.mainHtml === "string" && typeof raw.complete === "boolean"
    && Array.isArray(raw.jsonLd) && raw.jsonLd.every((block) => typeof block === "string")
    && raw.mainHtml.length + raw.jsonLd.reduce((n, block) => n + block.length, 0) <= CRAWL_BODY_TEXT_CHARS ? raw : undefined;
  const title = cap(row.title, MAX_TITLE_CHARS), h1 = cap(row.h1, MAX_ITEM_CHARS);
  const parsed = (() => { try { return sourceCapture?.mainHtml && /<[a-z][\w-]*(?:\s[^<>]*)?>/i.test(sourceCapture.mainHtml) ? load(sourceCapture.mainHtml) : undefined; } catch { return undefined; } })();
  const source = parsed && typeof row.body_text === "string" && parsed.root().text().replace(/\s+/g, " ").trim() === row.body_text.trim() ? parsed : undefined;
  const linkedParagraphs: NonNullable<OwnedPageBody["linkedParagraphs"]> = [];
  const capturedLinks: NonNullable<OwnedPageBody["capturedLinks"]> = [];
  if (source && sourceCapture?.complete) {
    const nodes = source("p,a,h1,h2,h3,h4,h5,h6").toArray(), flat = (s: string) => s.replace(/\s+/g, " ").trim();
    source("a[href]").each((_i, node) => { const href = source(node).attr("href"), anchor = flat(source(node).text()); if (href && anchor) capturedLinks.push({ href, anchor }); });
    for (let i = 0; i < nodes.length; i += 1) {
      if (nodes[i]!.tagName !== "p") continue;
      const text = flat(source(nodes[i]).text()), links: { href: string; anchor: string }[] = [];
      if (!text) continue;
      for (const node of nodes.slice(i + 1)) {
        if (node.tagName !== "a" || source(node).closest("p").length) break;
        const from = [nodes[i], ...source(nodes[i]).parents().toArray()].slice(0, 6), to = [node, ...source(node).parents().toArray()].slice(0, 6);
        if (!from.some((ancestor, depth) => depth > 0 && to.indexOf(ancestor) > 0 && to.indexOf(ancestor) < 6 && (!source(ancestor).is("main,body,html") || depth === 1 && to.indexOf(ancestor) === 1))) break;
        const href = source(node).attr("href"), anchor = flat(source(node).text());
        if (!href || !anchor) break;
        links.push({ href, anchor });
      }
      if (links.length) linkedParagraphs.push({ text, links });
    }
  }
  const headings = source ? items(source("h1,h2,h3,h4,h5,h6").toArray().map((el) => source(el).text()), MAX_HEADINGS, MAX_ITEM_CHARS)
    : [...(h1 ? [h1] : []), ...items(row.h2_list, MAX_HEADINGS, MAX_ITEM_CHARS), ...items(row.h3_list, MAX_HEADINGS, MAX_ITEM_CHARS)].slice(0, MAX_HEADINGS);
  // Stored body text takes precedence over legacy paragraph samples.
  const held = typeof row.body_text === "string";
  const full = held ? (row.body_text as string).trim() : "";
  const units = held ? passagesOf(full, row, source ? sourceCapture : undefined) : items(row.body_paragraph_sample, MAX_PASSAGES, MAX_PASSAGE_CHARS).map((text, i) => ({ id: `sample#${i + 1}`, heading: null, text })), stored = units.map((u) => u.text);
  const cardTexts = items(row.card_texts, CRAWL_CARDS, MAX_ITEM_CHARS);
  const entityNames = items(row.schema_entity_names, MAX_ENTITIES, MAX_ITEM_CHARS);
  const internalLinks = (Array.isArray(row.internal_links) ? row.internal_links : []).slice(0, MAX_LINKS)
    .map((l) => { const link = (l ?? {}) as { href?: unknown; anchor_text?: unknown };
      return { href: cap(link.href, MAX_ITEM_CHARS) ?? "", anchorText: cap(link.anchor_text, MAX_ITEM_CHARS) ?? "" }; })
    .filter((l) => l.href);
  // Spend the reader ceiling on fixed fields, then passages in document order.
  let fixed = [title ?? "", cap(row.meta_description, MAX_META_CHARS) ?? "", ...headings, ...cardTexts, ...entityNames].join(" ").length;
  const faqs: OwnedPageBody["faqs"] = [];
  for (const f of visibleFaqs(row.faqs).slice(0, MAX_FAQS)) {
    const question = f.question.trim(), complete = f.answer_complete === true && typeof f.answer_text === "string";
    const original = complete ? f.answer_text!.trim() : cap(f.answer_excerpt, MAX_ITEM_CHARS) ?? "";
    const answer = original.slice(0, Math.max(0, MAX_PAGE_CHARS - fixed - question.length));
    if (question && answer) { faqs.push({ question, answer, source: f.source, answerComplete: complete && answer.length === original.length }); fixed += question.length + answer.length; }
  }
  const passages: string[] = [];
  let used = fixed;
  for (const p of stored) { if (used + p.length > MAX_PAGE_CHARS) break; passages.push(p); used += p.length; }
  const answerPassages = passages.filter((_text, i) => !units[i]?.id.endsWith("#0"));
  const heldWords = passages.join(" ").split(/\s+/).filter(Boolean).length;
  const pageWords = typeof row.word_count === "number" && row.word_count > 0 ? row.word_count : null;
  // Confirmed empty bodies are real reads; an unqualified blank or excerpts cannot prove absence.
  const sampled = !held || (full.length === 0 && row.extraction_certainty !== "confirmed");
  const sourceConflict = !!full && !!sourceCapture && !source, truncated = sourceConflict || !sourceCapture || sourceCapture.complete === false || passages.length < stored.length || (full.length >= CRAWL_BODY_TEXT_CHARS);
  const range = passages.length < stored.length
    ? ` Passages 1 to ${passages.length} of the ${stored.length} on file are held here; passages ${passages.length + 1} to ${stored.length} are past the ${MAX_PAGE_CHARS} character ceiling for one page.`
    : sourceConflict ? " The stored source structure disagrees with the held body text; reconcile that capture before judging or replacing the whole page."
    : !sourceCapture ? " The saved text has no complete source-structure capture; unseen structure and content remain unknown. Reconcile the capture before judging or replacing the whole page."
    : sourceCapture.complete === false ? " The saved main-content capture is incomplete; uncaptured content is unknown, not absent. Reconcile that capture before judging or replacing the whole page." : truncated
      ? ` This page is longer than the ${CRAWL_BODY_TEXT_CHARS} characters one crawl keeps, so the end of it is not on file.`
      : "";
  return {
    url: typeof row.url === "string" ? row.url : "",
    title, h1, metaDescription: cap(row.meta_description, MAX_META_CHARS), headings, passages, answerPassages, passageMeta: units.slice(0, passages.length).map(({ id, heading }) => ({ id, heading })),
    openingSample: cap(answerPassages.slice(0, MAX_OPENING_PARAGRAPHS).join(" ").replace(/\s+/g, " "), MAX_OPENING_CHARS),
    vocabulary: full, cardTexts, faqs, entityNames, internalLinks, ...(linkedParagraphs.length ? { linkedParagraphs } : {}), ...(capturedLinks.length ? { capturedLinks } : {}), ...(sourceCapture ? { sourceCapture } : {}),
    fetchedAt: typeof row.fetched_at === "string" ? row.fetched_at : null,
    completeness: sampled ? "sample_only" : truncated ? "partial" : "complete",
    contentHash: typeof row.content_hash === "string" ? row.content_hash : null,
    heldNote: ((sampled
      ? `On file for this page: ${passages.length} stored passages and ${headings.length} headings, about ${heldWords} words of the ${pageWords ?? "unknown number of"} words its last crawl counted. The crawl keeps a sample, so anything not shown here is unknown, not missing: re-crawl the page before calling anything absent.`
      : truncated ? "" : `On file for this page: all ${heldWords} words its last crawl captured.`) + range).trim(),
  };
}

/** Page every tenant-scoped ask and distinguish absent captures from failed reads. */
export async function loadOwnedPageBodies(tenantId: string, urls: string[], misses?: Map<string, "no_capture" | "read_failed">): Promise<Map<string, OwnedPageBody>> {
  const out = new Map<string, OwnedPageBody>();
  // Deduplicate aliases before applying the per-query width.
  const seen = new Set<string>(), asked: string[] = [];
  for (const u of urls ?? []) { const s = typeof u === "string" ? u.trim() : "", k = s ? canonicalUrlKey(s) : ""; if (k && !seen.has(k)) { seen.add(k); asked.push(s); } }
  if (!tenantId?.trim() || asked.length === 0) return out;
  const wanted = new Set(asked.map(canonicalUrlKey).filter(Boolean));
  const captures = new Map<string, Row[]>();
  const failed = new Set<string>();
  for (let at = 0; at < asked.length; at += MAX_URLS) {
    const slice = asked.slice(at, at + MAX_URLS);
    try {
      const rows = await selectedSnapshots<PageSnapshot>(tenantId, COLUMNS, variantsOf(slice), { retainPreviousTrusted: true });
      for (const row of rows) {
        const key = canonicalUrlKey(row.url);
        if (wanted.has(key)) captures.set(key, [...(captures.get(key) ?? []), row]);
      }
    } catch (e) {
      for (const u of slice) failed.add(canonicalUrlKey(u));
      log.warn("[owned-context] one page-body chunk could not be read; its pages are unknown and the rest still answer", { pages: slice.length, error: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    }
  }
  for (const [key, rows] of captures) {
    const v = selectPageVersion(rows, (r) => ({ fetchedAt: typeof r.fetched_at === "string" ? r.fetched_at : null, words: typeof r.word_count === "number" && r.word_count > 0 ? r.word_count : typeof r.body_text === "string" ? r.body_text.trim().split(/\s+/).filter(Boolean).length : 0, bodyHeld: typeof r.body_text === "string", certainty: typeof r.extraction_certainty === "string" ? r.extraction_certainty : null, contentIdentity: typeof r.content_hash === "string" ? r.content_hash : null }));
    if (!v.content) continue;
    const body = bodyOf(v.content), newestAt = v.conflict && typeof (v.current as Row | null)?.fetched_at === "string" ? ((v.current as Row).fetched_at as string) : null;
    out.set(key, { ...body, pageId: typeof v.content.page_id === "string" ? v.content.page_id : undefined, captureId: typeof v.content.id === "string" ? v.content.id : undefined, latestCaptureId: typeof v.current?.id === "string" ? v.current.id : undefined, captureStates: rows, version: v.state, newestAt, ...(v.conflict ? { heldNote: `${body.heldNote} ${v.conflictKind === "collapse" ? `The newest read of this page, ${newestAt?.slice(0, 10) ?? "recently"}, captured sharply less content than the preceding trusted read; one more agreeing capture is required before treating that apparent deletion as current.` : `The newest read of this page, ${newestAt?.slice(0, 10) ?? "recently"}, captured no words Beacon can trust.`} These are the words captured ${body.fetchedAt?.slice(0, 10) ?? "earlier"}. They prove what the page said then, never what it lacks now.` } : {}) });
  }
  if (misses) for (const key of wanted) if (!out.has(key)) misses.set(key, failed.has(key) ? "read_failed" : "no_capture");
  return out;
}
