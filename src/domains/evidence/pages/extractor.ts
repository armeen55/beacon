/**
 * Cheerio-based HTML extractor for owned page snapshots.
 * Pure function: HTML string in → structured PageSnapshot out.
 */

import { load as cheerioLoad } from "cheerio";
import { createHash } from "node:crypto";
import type { PageSnapshot } from "./types";
import { visibleFaqs } from "./types";
import { SCHEMA } from "./schema-validator";
import {
  locationRegexFrom,
  serviceRegexFrom,
} from "@/domains/account";

const hash = (input: string): string => createHash("sha256").update(input).digest("hex").slice(0, 16);
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

/** Stored main-content text is bounded; truncation is recorded, never full-page absence authority. */
const BODY_TEXT_CEILING = 100_000;

export function extractPageSnapshot(
  html: string,
  url: string,
  pageId: string,
  tenantId: string,
  httpStatus: number = 200,
  profile?: import("@/domains/account").BusinessProfile | null,
  /** Where the fetch landed after redirects. Defaults to the requested address. */
  finalUrl?: string | null,
  capture?: (mainHtml: string) => void,
): PageSnapshot {
  if (!tenantId) {
    throw new Error(
      `[extractPageSnapshot] tenantId required (url=${url}); pass currentTenantId() from the calling action or BEACON_TENANT_ID from the calling script.`,
    );
  }
  const $ = cheerioLoad(html);
  const schemaGraph = SCHEMA.read(html);
  const $content = cheerioLoad(html);
  $content("nav, footer, aside, script, style, noscript, svg, iframe, template, [hidden], [aria-hidden=true]").remove();
  $content("header").filter((_, el) => !$content(el).parents("main, article").length).remove();
  $content("[style]").filter((_, el) => {
    const node = $content(el), style = node.attr("style") ?? "", cards = node.children(".wixui-repeater__item");
    const wixList = node.is("fluid-columns-repeater[role=list]") && node.parents(".wixui-repeater").length > 0
      && /^\s*visibility\s*:\s*hidden\s*;?\s*$/i.test(style) && cards.length > 0 && cards.length === Number(node.attr("items"))
      && cards.toArray().every((card) => normalizeExtractedText($content(card).text()).split(/\s+/).length >= 5);
    return !wixList && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(style);
  }).remove();
  const mains = $content("main").filter((_, el) => $content(el).parents("main").length === 0), articles = $content("article");
  const contentRoot = mains.length ? mains : articles.length === 1 ? articles : $content("body");
  contentRoot.find("br, p, div, section, article, h1, h2, h3, h4, h5, h6, li, dt, dd, blockquote, pre, table, caption, tr, th, td, figure, figcaption, details, summary").each((_, el) => { $content(el).before(" ").after(" "); });
  const mainHtml = $content.html(contentRoot);
  capture?.(mainHtml);

  const title = $("title").first().text().trim() || null;
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() || null;
  const canonicalUrl = $('link[rel="canonical"]').attr("href")?.trim() || null;
  const robotsMeta =
    $('meta[name="robots"]').attr("content")?.trim() || null;

  const h1Nodes = contentRoot.find("h1"), h3Nodes = contentRoot.find("h3");
  const h1 = h1Nodes.first().text().trim() || null;
  const h1Count = h1Nodes.length;
  const headingTexts = (tag: string): string[] => contentRoot.find(tag).toArray().map((el) => normalizeExtractedText($content(el).text())).filter(Boolean);
  const h2List = headingTexts("h2");
  const h3Count = h3Nodes.length;
  const h3List = headingTexts("h3").slice(0, 30).map((text) => text.slice(0, 200));

  // ── FAQ extraction ──
  const faqs: PageSnapshot["faqs"] = [];
  const faqMaterial: string[] = [];
  const holdFaq = (question: string, answer: string, source: PageSnapshot["faqs"][number]["source"]): void => {
    faqs.push({ question, answer_excerpt: answer.slice(0, 200), source, ...(source !== "jsonld" ? { answer_text: normalizeExtractedText(answer), answer_complete: false } : {}) });
    faqMaterial.push(JSON.stringify([question, answer.replace(/\s+/g, " ").trim(), source]));
  };

  // Linked JSON-LD answers are observations, never proof of visible publication.
  for (const pair of SCHEMA.pairs(schemaGraph)) holdFaq(pair.question, pair.answer, "jsonld");

  // HTML <details>/<summary> pattern
  contentRoot.find("details").each((_, el) => {
    const q = $content(el).find("summary").first().text().trim();
    const a = $content(el).text().replace(q, "").trim();
    if (q && q.length > 5) {
      holdFaq(q, a, "html_details");
    }
  });

  // Heading-defined answers follow document order, not a builder's wrapper layout.
  contentRoot.each((_, root) => {
    type Node = ReturnType<typeof contentRoot.contents>[number];
    type Answer = { question: string; level: number; scope: Node; parts: string[] };
    let faqLevel: number | null = null;
    let faqScope: Node | null = null;
    let answers: Answer[] = [];
    const finish = (matches: (answer: Answer) => boolean = () => true) => {
      for (const answer of answers.filter(matches)) holdFaq(answer.question, normalizeExtractedText(answer.parts.join("")), "html_section");
      answers = answers.filter((answer) => !matches(answer));
    };
    const walk = (node: Node, scope: Node): void => {
      if (node.type === "text") { for (const answer of answers) answer.parts.push(node.data); return; }
      if (!("name" in node)) return;
      const tag = node.name.toLowerCase();
      const heading = /^h[1-6]$/.test(tag), level = heading ? Number(tag[1]) : 7;
      const text = heading || tag === "details" || /^(strong|b|dt)$/.test(tag) ? $content(node).text().trim() : "";
      const faq = heading && /frequently asked|\bfaq\b|common questions/i.test(text);
      const question = text.endsWith("?") && (heading || (faqLevel !== null && /^(strong|b|dt)$/.test(tag)));
      if (heading || question) {
        finish((answer) => level <= answer.level);
        if (heading && faqLevel !== null && level <= faqLevel) faqLevel = null;
        if (faq) { faqLevel = level; faqScope = scope; }
        for (const answer of answers) answer.parts.push(text);
        if (question) answers.push({ question: text, level, scope, parts: [] });
        return;
      }
      // Details already have an explicit pair; their descendants are not inferred again.
      if (tag === "details") { for (const answer of answers) answer.parts.push(text); return; }
      const independent = tag === "section" || tag === "article";
      if (tag === "article") { finish(); faqLevel = null; faqScope = null; }
      const childScope = independent ? node : scope;
      if ("children" in node) for (const child of node.children) walk(child, childScope);
      if (independent) finish((answer) => answer.scope === node);
      if (independent && faqScope === node) { faqLevel = null; faqScope = null; }
    };
    walk(root, root);
    finish();
  });

  // ── Schema types + structural audit + G8 spec validation ──
  const schemaTypes = schemaGraph.nodes.flatMap(SCHEMA.types);
  const schemaMaterial: string[] = [], jsonLd: string[] = [];
  const faqSchemaBlockCount = schemaGraph.nodes.filter((n) => SCHEMA.types(n).includes("FAQPage")).length;
  const structuralWarnings: string[] = [];
  const schemaValidationWarnings = SCHEMA.warnings(html);
  $("script").filter((_, el) => ($(el).attr("type") ?? "").trim().toLowerCase() === "application/ld+json").each((_, el) => {
    jsonLd.push($(el).html() || "");
    try {
      const data = JSON.parse($(el).html() || "");
      schemaMaterial.push(stableJson(data));
    } catch {
      schemaMaterial.push(JSON.stringify(["unparseable", $(el).html() || ""]));
      schemaValidationWarnings.push(
        "schema_critical:UNPARSEABLE: JSON-LD block did not parse as valid JSON.",
      );
    }
  });
  if (h1Count > 1) {
    structuralWarnings.push(`multiple_h1: ${h1Count} <h1> tags found - should have exactly one`);
  }
  const hasHtmlFaqs = visibleFaqs(faqs).length > 0;
  const hasFaqSchema = schemaTypes.includes("FAQPage");
  if (hasHtmlFaqs && !hasFaqSchema && !schemaGraph.unread) {
    structuralWarnings.push(`faq_without_schema: FAQ content in HTML but no FAQPage JSON-LD schema`);
  }

  // ── JSON-LD presence (checked before script removal for word count) ──

  const namedTypes = new Set(["Service", "Offer", "Product", "Organization", "LocalBusiness",
    "HomeAndConstructionBusiness", "BreadcrumbList", "ListItem", "ItemList", "Place", "CreativeWork", "WebPage", "Article"]);
  const schemaEntityNames = schemaGraph.nodes.filter((n) => SCHEMA.types(n).some((t) => namedTypes.has(t)))
    .map((n) => typeof n.name === "string" ? n.name.trim() : "").filter((n) => n.length >= 3 && n.length <= 100).slice(0, 20);

  // Paragraphs, cards, FAQ pairs and held body share the same pruned main-content root.
  const cardTexts: string[] = [];
  const MAX_PARAGRAPHS = 20;
  const MAX_PARAGRAPH_CHARS = 300;
  const MIN_PARAGRAPH_WORDS = 8;
  // Legacy samples are projections only; the source capture retains actual boundaries and links.
  const meaningful = (text: string) => text.split(/\s+/).filter(Boolean).length >= MIN_PARAGRAPH_WORDS;
  const samples = (selector: string, leaves = false): string[] => {
    const out: string[] = [];
    contentRoot.find(selector).each((_, el) => {
      if (out.length >= MAX_PARAGRAPHS) return false;
      if (leaves && $content(el).children().length) return;
      const text = normalizeExtractedText($content(el).text());
      if (meaningful(text) && (!leaves || !out.includes(text))) out.push(text);
    });
    return out;
  };
  const paragraphs = samples("p"), sample = paragraphs.length ? paragraphs : samples("div, span, li, dd, blockquote, figcaption", true);
  const bodyParagraphSample = sample.map((text) => text.slice(0, MAX_PARAGRAPH_CHARS));

  // Card / tile / item texts: <li>, <article>, or elements whose class
  // matches a card-pattern regex. Restricted to the content root.
  contentRoot.find("li, article, [class]").each((_, el) => {
    if (cardTexts.length >= 20) return;
    if (!$content(el).is("li, article") && !/\b(card|tile|item|neighborhood|service|offering)\b/i.test($content(el).attr("class") ?? "")) return;
    const text = normalizeExtractedText($content(el).text());
    // Skip items that are basically empty or just contain a link label.
    if (text.length < 8) return;
    cardTexts.push(text.slice(0, 120));
  });

  // ── Links ──
  // Classify by RESOLVED HOST, not a substring match. `href.includes(pageDomain)`
  // misclassified look-alike externals (e.g. "notmysite.com.evil.com" or
  // "?ref=mysite.com") as internal and ignored protocol-relative ("//cdn…")
  // links - inflating internal_link_count + polluting internal_links[].
  let internalLinkCount = 0;
  let externalLinks = 0;
  const stripWww = (h: string) => h.replace(/^www\./i, "").toLowerCase();
  const pageHost = (() => {
    try {
      return stripWww(new URL(url).hostname);
    } catch {
      return "";
    }
  })();
  const internalLinksArr: { href: string; anchor_text: string }[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    // Resolve against the page URL so relative + protocol-relative hrefs parse.
    let resolved: URL | null = null;
    try {
      resolved = new URL(href, url);
    } catch {
      resolved = null;
    }
    if (resolved && resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
    const isInternal = resolved != null && pageHost !== "" && stripWww(resolved.hostname) === pageHost;
    if (isInternal && resolved) {
      internalLinkCount++;
      // audit-wave4 #3: record EVERY internal link, not only text-anchored ones.
      // Image/icon-anchored links (empty text) were dropped from internal_links[]
      // while still counted, so a well-linked page read as an orphan downstream.
      // Fall back to the child <img> alt for the anchor label.
      const anchorText =
        $(el).text().trim() || ($(el).find("img").attr("alt") ?? "").trim();
      // Store internal links path-relative with their anchor text (may be "").
      internalLinksArr.push({ href: resolved.pathname, anchor_text: anchorText });
    } else if (resolved) {
      externalLinks++;
    }
  });

  // ── Table detection ──
  // Count meaningful tables (must have >1 row to filter decorative/layout tables)
  let tableCount = 0;
  $("table").each((_, el) => {
    const rows = $(el).find("tr").length;
    if (rows >= 2) tableCount++; // At least header + 1 data row
  });

  // Held text and FAQ publication authority use the same main-content scope.
  // Normalize block separators to spaces, never inject evidence or boundary-marker tokens.
  const flat = contentRoot.text().replace(/\s+/g, " ").trim();
  const wordCount = flat ? flat.split(/\s+/).length : 0;
  const bodyText = flat;
  const ghostHeadings = contentRoot.find("h1,h2,h3,h4,h5,h6").toArray().filter((el) => {
    const text = $content(el).text(); return !!text.trim() && !normalizeExtractedText(text);
  }).length;
  const readableProse = contentRoot.find("p,li,blockquote,dd,figcaption").toArray().some((el) => normalizeExtractedText($content(el).text()).split(/\s+/).filter(Boolean).length >= 4);
  const clientShell = ghostHeadings >= 3 && !readableProse && normalizeExtractedText(flat).split(/\s+/).filter(Boolean).length < 50;
  if (clientShell) structuralWarnings.push(`client_rendered_placeholders: ${ghostHeadings} headings contain no readable words; the visible page may have more content than this HTML.`);
  // Store the shared main-content projection with an explicit truncation warning.
  const bodyTextHeld = bodyText.slice(0, BODY_TEXT_CEILING);
  // A cut HTML string would invent repaired structure on parsing. Hold whole payload parts or mark missing.
  let captureRoom = BODY_TEXT_CEILING;
  const heldMain = mainHtml.length <= captureRoom ? mainHtml : "";
  captureRoom -= heldMain.length;
  const heldJsonLd = jsonLd.filter((block) => { if (block.length > captureRoom) return false; captureRoom -= block.length; return true; });
  const contentCapture = { version: 1 as const, mainHtml: heldMain, jsonLd: heldJsonLd, complete: !clientShell && heldMain === mainHtml && heldJsonLd.length === jsonLd.length };
  // Source revision includes observed client assets, so an unchanged shell cannot fund repeated rendered tasks.
  const assets = $("script[src],link[rel=stylesheet][href],link[rel=modulepreload][href]").toArray()
    .map((el) => $(el).attr("src") ?? $(el).attr("href") ?? "").filter(Boolean);
  const sourceRevision = hash(JSON.stringify([title, metaDescription, mainHtml, jsonLd, assets]));
  let faqRoom = BODY_TEXT_CEILING;
  for (const f of faqs) if (f.answer_text !== undefined) {
    const answer = f.answer_text;
    f.answer_complete = !!answer && answer.length <= faqRoom && bodyTextHeld.includes(answer);
    if (f.answer_complete) faqRoom -= answer.length;
    else delete f.answer_text;
  }
  if (bodyText.length > BODY_TEXT_CEILING) structuralWarnings.push(`body_text_truncated: kept the first ${BODY_TEXT_CEILING} characters of ${bodyText.length}`);

  // ── Location + service terms (from business config or inline defaults) ──
  // The caller supplies the account's loaded BusinessProfile (async reads
  // live upstream). Missing profile fails GENERIC: never-match, never
  // another business's vocabulary.
  const locationRegex = profile ? locationRegexFrom(profile) : /(?!)/g;
  const serviceRegex = profile ? serviceRegexFrom(profile) : /(?!)/g;
  const locationTerms = extractTermsByPattern(flat, locationRegex);
  const serviceTerms = extractTermsByPattern(flat, serviceRegex);

  // ── Canonical mismatch ──
  const hasCanonicalMismatch =
    canonicalUrl !== null && !urlsEquivalent(canonicalUrl, url);

  // ── Hashes ──
  // content_hash hashes the text I actually HOLD, so "unchanged" means the content on file is the
  // content on file, never a claim about bytes nobody kept.
  const dedupedSchemaTypes = [...new Set(schemaTypes)];
  const contentHash = hash(bodyTextHeld);
  const headingsHash = hash(JSON.stringify(["headings-v3", contentRoot.find("h1,h2,h3,h4,h5,h6").toArray().map((el) => [$content(el).prop("tagName")?.toLowerCase(), $content(el).text().trim()])]));
  const faqHash = hash(JSON.stringify(["answers-v2", faqMaterial]));
  const schemaHash = hash(JSON.stringify(["values-v2", schemaMaterial.sort()]));

  // ── Extraction certainty ── ONLY real body content confirms a read. JSON-LD used to vouch on its own,
  // so a client-rendered page with zero extracted words graded "confirmed" (the 500-surname page stored
  // as blank while ranking position 4.9): markup in the head proves nothing about the body a reader sees.
  const hasBodyContent = wordCount > 50;
  const extractionCertainty: "confirmed" | "uncertain" = hasBodyContent ? "confirmed" : "uncertain";

  return {
    id: `snap-${pageId}-${Date.now()}`,
    page_id: pageId,
    url,
    canonical_url: canonicalUrl,
    final_url: finalUrl === undefined ? url : finalUrl,
    fetched_at: new Date().toISOString(),
    http_status: httpStatus,
    title,
    meta_description: metaDescription,
    h1,
    h2_list: h2List,
    h3_count: h3Count,
    faqs,
    schema_types: dedupedSchemaTypes,
    location_terms: [...new Set(locationTerms)],
    service_terms: [...new Set(serviceTerms)],
    internal_link_count: internalLinkCount,
    external_link_count: externalLinks,
    internal_links: internalLinksArr.length > 0 ? internalLinksArr : undefined,
    word_count: wordCount,
    robots_meta: robotsMeta,
    has_canonical_mismatch: hasCanonicalMismatch,
    content_hash: contentHash,
    headings_hash: headingsHash,
    faq_hash: faqHash,
    schema_hash: schemaHash,
    extraction_certainty: extractionCertainty,
    faq_schema_block_count: faqSchemaBlockCount,
    structural_warnings: structuralWarnings.length > 0 ? structuralWarnings : undefined,
    schema_validation_warnings:
      schemaValidationWarnings.length > 0 ? schemaValidationWarnings : undefined,
    table_count: tableCount,
    // Plan A + B1 (2026-04-20): broader page-content extraction. All four
    // fields optional on the type so prior snapshots remain valid.
    h3_list: h3List.length > 0 ? h3List : undefined,
    // ALWAYS A STRING on a page this crawler read, even when the page's own words are none: an
    // absent column means a pre-2026-08-03 sample-era row, so writing undefined here made a
    // genuinely empty page indistinguishable from one we never held whole.
    body_text: bodyTextHeld,
    content_capture: { ...contentCapture, sourceRevision },
    body_paragraph_sample:
      bodyParagraphSample.length > 0 ? bodyParagraphSample : undefined,
    card_texts: cardTexts.length > 0 ? cardTexts : undefined,
    schema_entity_names:
      schemaEntityNames.length > 0 ? schemaEntityNames : undefined,
    tenant_id: tenantId,
  };
}

// ── Helpers ──

/**
 * N19 (2026-07-02): normalize extracted node text before word-counting it.
 * Some page builders (observed live on Wix) leave editor-placeholder <p>
 * tags containing nothing but a zero-width space (U+200B) or other
 * invisible whitespace where a paragraph used to be. `String.trim()` does
 * NOT strip U+200B, so without this a placeholder reads as "1 word" of
 * real text under a naive split. This strips the invisible characters
 * FIRST so those placeholders correctly collapse to an empty string and
 * fall below the word-count floor like any other empty node.
 */
function normalizeExtractedText(raw: string): string {
  return (raw ?? "")
    .replace(/[​‌‍﻿ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTermsByPattern(text: string, pattern: RegExp): string[] {
  const matches = text.match(pattern);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.toLowerCase().trim()))];
}

function urlsEquivalent(a: string, b: string): boolean {
  const normalize = (u: string) => {
    try {
      const parsed = new URL(u);
      return (
        parsed.hostname.replace(/^www\./, "").toLowerCase() +
        (parsed.pathname.replace(/\/+$/, "") || "/")
      );
    } catch {
      return u.toLowerCase().replace(/\/+$/, "");
    }
  };
  return normalize(a) === normalize(b);
}
