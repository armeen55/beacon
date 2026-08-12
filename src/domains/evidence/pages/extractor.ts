/**
 * Cheerio-based HTML extractor for owned page snapshots.
 * Pure function: HTML string in → structured PageSnapshot out.
 */

import { load as cheerioLoad } from "cheerio";
import { createHash } from "node:crypto";
import type { PageSnapshot, FaqItem } from "./types";
import { validateSchemaToStrings } from "./schema-validator";
import {
  locationRegexFrom,
  serviceRegexFrom,
} from "@/domains/account";

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/** The per-page ceiling on stored main-content text. 100k characters is roughly 15,000 words: past
 *  any real page, and a hard bound on one row whatever a generator emits. */
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
): PageSnapshot {
  if (!tenantId) {
    throw new Error(
      `[extractPageSnapshot] tenantId required (url=${url}); pass currentTenantId() from the calling action or BEACON_TENANT_ID from the calling script.`,
    );
  }
  const $ = cheerioLoad(html);

  const title = $("title").first().text().trim() || null;
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() || null;
  const canonicalUrl = $('link[rel="canonical"]').attr("href")?.trim() || null;
  const robotsMeta =
    $('meta[name="robots"]').attr("content")?.trim() || null;

  const h1 = $("h1").first().text().trim() || null;
  const h1Count = $("h1").length;
  const h2List: string[] = [];
  $("h2").each((_, el) => {
    const text = $(el).text().trim();
    if (text) h2List.push(text);
  });
  const h3Count = $("h3").length;

  // Plan A + B1 (2026-04-20): capture H3 text (not just count) parallel to
  // h2_list. Cap at 30 entries, 200 chars each.
  const h3List: string[] = [];
  $("h3").each((_, el) => {
    if (h3List.length >= 30) return;
    const text = $(el).text().trim();
    if (text) h3List.push(text.slice(0, 200));
  });

  // ── FAQ extraction ──
  const faqs: FaqItem[] = [];

  // JSON-LD FAQPage schema
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || "");
      const items = extractFaqFromJsonLd(data);
      for (const item of items) faqs.push(item);
    } catch {
      // malformed JSON-LD
    }
  });

  // HTML <details>/<summary> pattern
  $("details").each((_, el) => {
    const q = $(el).find("summary").first().text().trim();
    const a = $(el).text().replace(q, "").trim();
    if (q && q.length > 5) {
      faqs.push({ question: q, answer_excerpt: a.slice(0, 200), source: "html_details" });
    }
  });

  // Heading-based FAQ sections (h2/h3 parent + h3 question children)
  $("h2, h3").each((_, el) => {
    const tag = (el as unknown as { tagName: string }).tagName?.toLowerCase();
    const text = $(el).text().trim().toLowerCase();
    if (
      text.includes("frequently asked") ||
      text.includes("faq") ||
      text.includes("common questions")
    ) {
      let sibling = $(el).next();
      const stopTag = tag === "h3" ? "h2" : undefined;
      while (sibling.length) {
        const sibTag = (sibling[0] as unknown as { tagName: string }).tagName?.toLowerCase();

        if (stopTag && sibTag === stopTag) break;
        if (sibTag === "h2" && tag === "h2") break;

        // h3 headings ending with ? are FAQ questions
        if (sibTag === "h3") {
          const qText = sibling.text().trim();
          if (qText.endsWith("?")) {
            const answerParts: string[] = [];
            let ansNext = sibling.next();
            while (ansNext.length) {
              const ansTag = (ansNext[0] as unknown as { tagName: string }).tagName?.toLowerCase();
              if (ansTag === "h2" || ansTag === "h3") break;
              answerParts.push(ansNext.text().trim());
              ansNext = ansNext.next();
            }
            faqs.push({
              question: qText,
              answer_excerpt: answerParts.join(" ").slice(0, 200),
              source: "html_section",
            });
            sibling = ansNext;
            continue;
          }
        }

        // Also check strong/b/dt inside block-level siblings
        const possibleQ = sibling.find("strong, b, dt").first().text().trim();
        if (possibleQ && possibleQ.endsWith("?")) {
          faqs.push({
            question: possibleQ,
            answer_excerpt: sibling.text().replace(possibleQ, "").trim().slice(0, 200),
            source: "html_section",
          });
        }
        sibling = sibling.next();
      }
    }
  });

  // ── Schema types + structural audit + G8 spec validation ──
  const schemaTypes: string[] = [];
  let faqSchemaBlockCount = 0;
  const structuralWarnings: string[] = [];
  const schemaValidationWarnings: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || "");
      collectSchemaTypes(data, schemaTypes);
      faqSchemaBlockCount += countFaqPageBlocks(data);
      // G8: validate this block's structured data against Google rich-result specs.
      // Warnings are appended as strings; empty / all-valid blocks contribute
      // nothing. Pure function - no side effects outside this array.
      schemaValidationWarnings.push(...validateSchemaToStrings(data));
    } catch {
      // malformed
      schemaValidationWarnings.push(
        "schema_critical:UNPARSEABLE: JSON-LD block did not parse as valid JSON.",
      );
    }
  });
  if (faqSchemaBlockCount > 1) {
    structuralWarnings.push(`duplicate_faq_schema: ${faqSchemaBlockCount} FAQPage JSON-LD blocks found - likely duplicate`);
  }
  if (h1Count > 1) {
    structuralWarnings.push(`multiple_h1: ${h1Count} <h1> tags found - should have exactly one`);
  }
  // FAQ in HTML but no FAQPage JSON-LD
  const hasHtmlFaqs = faqs.some((f) => f.source === "html_section" || f.source === "html_details");
  const hasFaqSchema = schemaTypes.includes("FAQPage");
  if (hasHtmlFaqs && !hasFaqSchema) {
    structuralWarnings.push(`faq_without_schema: FAQ content in HTML but no FAQPage JSON-LD schema`);
  }

  // ── JSON-LD presence (checked before script removal for word count) ──
  const hasJsonLd = $('script[type="application/ld+json"]').length > 0;

  // Plan A + B1 (2026-04-20): schema entity names. Distinct from
  // schema_types (which only captures @type). Harvest .name fields from
  // Service/Offer/Organization/BreadcrumbList/ListItem entities so that a
  // Service named "Whole-Home Remodel" contributes to coverage text.
  const schemaEntityNames: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || "");
      collectSchemaEntityNames(data, schemaEntityNames);
    } catch {
      // malformed - already tracked in schema_validation_warnings
    }
  });

  // The ORDERED PARAGRAPH VIEW of the content area (prefer <main>/<article>; fall back to <body>
  // minus nav/footer/header/aside). Boilerplate is excluded so cross-page menus never read as
  // covered topics. body_text below holds the whole thing; this stays the paragraph-shaped read.
  // The block-level fallback exists because some builders render body copy in leaf <span>/<div>
  // nodes with zero <p> tags at all, and it fires ONLY when the <p> pass found nothing usable.
  const bodyParagraphSample: string[] = [];
  const cardTexts: string[] = [];
  const MAX_PARAGRAPHS = 20;
  const MAX_PARAGRAPH_CHARS = 300;
  const MIN_PARAGRAPH_WORDS = 8;
  {
    const $clone = cheerioLoad($.html());
    // Remove non-content regions before content extraction. Removing these
    // from the clone (not the main $) means word_count and other downstream
    // extractors are unaffected by this cleanup.
    $clone("nav, footer, header, aside, script, style, noscript, svg, iframe").remove();

    // Prefer <main>/<article> if present; otherwise fall back to the body
    // of the pruned clone.
    const mainCount = $clone("main").length;
    const articleCount = $clone("article").length;
    const contentRoot =
      mainCount > 0
        ? $clone("main").first()
        : articleCount > 0
          ? $clone("article").first()
          : $clone("body");

    // Body paragraph sample: pick <p> nodes inside the content root with
    // >= MIN_PARAGRAPH_WORDS words (drop captions, tiny footers, empty divs
    // with <p>, and editor-placeholder <p> tags that hold only a zero-width
    // space or other invisible whitespace).
    contentRoot.find("p").each((_, el) => {
      if (bodyParagraphSample.length >= MAX_PARAGRAPHS) return;
      const text = normalizeExtractedText($clone(el).text());
      const words = text.split(/\s+/).filter(Boolean).length;
      if (words < MIN_PARAGRAPH_WORDS) return;
      bodyParagraphSample.push(text.slice(0, MAX_PARAGRAPH_CHARS));
    });

    // Fallback: no usable <p> paragraphs were found, but the content root
    // may still carry real prose in block-level divs/spans/list items (the
    // "list-heavy Wix page" shape) rather than <p> tags at all. Walk LEAF
    // block elements only (no element children) in document order. This
    // is what keeps the fallback from re-emitting the same sentence once
    // per wrapper <div> on deeply-nested builder markup, since only the
    // innermost node carries the text directly. A generic word-count floor
    // (not a class-name allowlist) keeps this tenant-generic: it works on
    // any CMS's block markup, not just one vendor's naming convention.
    if (bodyParagraphSample.length === 0) {
      const BLOCK_FALLBACK_SELECTOR = "div, span, li, dd, blockquote, figcaption";
      const seenText = new Set<string>();
      contentRoot.find(BLOCK_FALLBACK_SELECTOR).each((_, el) => {
        if (bodyParagraphSample.length >= MAX_PARAGRAPHS) return;
        const hasElementChildren = $clone(el).children().length > 0;
        if (hasElementChildren) return; // not a leaf; its text is counted via descendants
        const text = normalizeExtractedText($clone(el).text());
        const words = text.split(/\s+/).filter(Boolean).length;
        if (words < MIN_PARAGRAPH_WORDS) return;
        if (seenText.has(text)) return; // dedupe identical repeated card/label text
        seenText.add(text);
        bodyParagraphSample.push(text.slice(0, MAX_PARAGRAPH_CHARS));
      });
    }

    // Card / tile / item texts: <li>, <article>, or elements whose class
    // matches a card-pattern regex. Restricted to the content root.
    const CARD_CLASS_RE = /\b(card|tile|item|neighborhood|service|offering)\b/i;
    contentRoot.find("li, article, [class]").each((_, el) => {
      if (cardTexts.length >= 20) return;
      const tag = (el as unknown as { tagName: string }).tagName?.toLowerCase();
      const className = ($clone(el).attr("class") ?? "").toString();
      const isCard =
        tag === "li" ||
        tag === "article" ||
        CARD_CLASS_RE.test(className);
      if (!isCard) return;
      const text = normalizeExtractedText($clone(el).text());
      // Skip items that are basically empty or just contain a link label.
      if (text.length < 8) return;
      cardTexts.push(text.slice(0, 120));
    });
  }

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

  // ── Main content text (page CONTENT only) ── Chrome and non-text nodes are pruned on a fresh clone, so
  // shared menus never inflate the count, mask a thin page, or disturb the main $.
  const $wc = cheerioLoad($.html());
  $wc("nav, header, footer, aside, script, style, noscript, svg, iframe").remove();
  const bodyText = $wc("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;
  // THE WHOLE PAGE, KEPT (2026-08-03). The 20x300-char paragraph sample could prove a phrase was
  // PRESENT and never that it was absent, so every whole-page judgement was unprovable. body_text
  // holds the same de-chromed text the word count is taken from, under one explicit ceiling, and
  // a cut is RECORDED rather than silently swallowed.
  const bodyTextHeld = bodyText.slice(0, BODY_TEXT_CEILING);
  if (bodyText.length > BODY_TEXT_CEILING) {
    structuralWarnings.push(
      `body_text_truncated: kept the first ${BODY_TEXT_CEILING} characters of ${bodyText.length}`,
    );
  }

  // ── Location + service terms (from business config or inline defaults) ──
  // The caller supplies the account's loaded BusinessProfile (async reads
  // live upstream). Missing profile fails GENERIC: never-match, never
  // another business's vocabulary.
  const locationRegex = profile ? locationRegexFrom(profile) : /(?!)/g;
  const serviceRegex = profile ? serviceRegexFrom(profile) : /(?!)/g;
  const locationTerms = extractTermsByPattern(bodyText, locationRegex);
  const serviceTerms = extractTermsByPattern(bodyText, serviceRegex);

  // ── Canonical mismatch ──
  const hasCanonicalMismatch =
    canonicalUrl !== null && !urlsEquivalent(canonicalUrl, url);

  // ── Hashes ──
  // content_hash hashes the text I actually HOLD, so "unchanged" means the content on file is the
  // content on file, never a claim about bytes nobody kept.
  const dedupedSchemaTypes = [...new Set(schemaTypes)];
  const contentHash = hash(bodyTextHeld);
  const headingsHash = hash([h1 ?? "", ...h2List].join("|"));
  const faqHash = hash(faqs.map((f) => f.question).join("|"));
  const schemaHash = hash(dedupedSchemaTypes.sort().join("|"));

  // ── Extraction certainty ── "confirmed" on JSON-LD or real body content; "uncertain" when the page may
  // rely on client-side rendering raw HTML cannot verify.
  const hasBodyContent = wordCount > 50;
  const extractionCertainty: import("./types").ExtractionCertainty =
    hasJsonLd || (hasBodyContent && (faqs.length > 0 || schemaTypes.length > 0))
      ? "confirmed"
      : hasBodyContent
        ? "confirmed"
        : "uncertain";

  return {
    id: `snap-${pageId}-${Date.now()}`,
    page_id: pageId,
    url,
    canonical_url: canonicalUrl,
    final_url: finalUrl ?? url,
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
    body_paragraph_sample:
      bodyParagraphSample.length > 0 ? bodyParagraphSample : undefined,
    card_texts: cardTexts.length > 0 ? cardTexts : undefined,
    schema_entity_names:
      schemaEntityNames.length > 0 ? schemaEntityNames : undefined,
    tenant_id: tenantId,
  };
}

// ── Helpers ──

function extractFaqFromJsonLd(data: unknown): FaqItem[] {
  const items: FaqItem[] = [];
  if (!data || typeof data !== "object") return items;

  // Handle top-level arrays: [{...}, {...}, {...FAQPage...}]
  if (Array.isArray(data)) {
    for (const node of data) {
      items.push(...extractFaqFromJsonLd(node));
    }
    return items;
  }

  const obj = data as Record<string, unknown>;

  const typeIsFaqPage =
    obj["@type"] === "FAQPage" ||
    (Array.isArray(obj["@type"]) && (obj["@type"] as string[]).includes("FAQPage"));
  if (typeIsFaqPage && Array.isArray(obj.mainEntity)) {
    for (const entity of obj.mainEntity) {
      if (typeof entity === "object" && entity !== null) {
        const e = entity as Record<string, unknown>;
        const q = String(e.name ?? "").trim();
        const accepted = e.acceptedAnswer as Record<string, unknown> | undefined;
        const a = String(accepted?.text ?? "").trim();
        if (q) items.push({ question: q, answer_excerpt: a.slice(0, 200), source: "jsonld" });
      }
    }
  }

  if (Array.isArray(obj["@graph"])) {
    for (const node of obj["@graph"]) {
      items.push(...extractFaqFromJsonLd(node));
    }
  }

  return items;
}

/** Plan A + B1 (2026-04-20): harvest `.name` fields from common JSON-LD
 *  entity types that carry editorial labels. Same recursive walk style as
 *  `collectSchemaTypes`. Capped so a list-heavy page (BreadcrumbList,
 *  ItemList) doesn't explode the set. */
function collectSchemaEntityNames(data: unknown, out: string[]): void {
  if (out.length >= 20) return;
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data)) {
    for (const node of data) {
      if (out.length >= 20) return;
      collectSchemaEntityNames(node, out);
    }
    return;
  }
  const obj = data as Record<string, unknown>;
  const rawType = obj["@type"];
  const types = Array.isArray(rawType)
    ? (rawType as unknown[])
    : typeof rawType === "string"
      ? [rawType]
      : [];
  const ENTITY_TYPES_WITH_NAMES = new Set([
    "Service", "Offer", "Product", "Organization", "LocalBusiness",
    "HomeAndConstructionBusiness", "BreadcrumbList", "ListItem",
    "ItemList", "Place", "CreativeWork", "WebPage", "Article",
  ]);
  const isNamedType = types.some(
    (t) => typeof t === "string" && ENTITY_TYPES_WITH_NAMES.has(t),
  );
  if (isNamedType && typeof obj.name === "string") {
    const name = obj.name.trim();
    if (name.length >= 3 && name.length <= 100) out.push(name.slice(0, 100));
  }
  if (Array.isArray(obj["@graph"])) {
    for (const node of obj["@graph"]) {
      if (out.length >= 20) return;
      collectSchemaEntityNames(node, out);
    }
  }
  if (Array.isArray(obj.itemListElement)) {
    for (const node of obj.itemListElement) {
      if (out.length >= 20) return;
      collectSchemaEntityNames(node, out);
    }
  }
}

function collectSchemaTypes(data: unknown, types: string[]): void {
  if (!data || typeof data !== "object") return;

  // Handle top-level arrays: [{...}, {...}, {...}]
  if (Array.isArray(data)) {
    for (const node of data) collectSchemaTypes(node, types);
    return;
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj["@type"] === "string") {
    types.push(obj["@type"]);
  } else if (Array.isArray(obj["@type"])) {
    for (const t of obj["@type"]) {
      if (typeof t === "string") types.push(t);
    }
  }

  if (Array.isArray(obj["@graph"])) {
    for (const node of obj["@graph"]) collectSchemaTypes(node, types);
  }
}

function countFaqPageBlocks(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  if (Array.isArray(data)) {
    let count = 0;
    for (const node of data) count += countFaqPageBlocks(node);
    return count;
  }
  const obj = data as Record<string, unknown>;
  const isFaq =
    obj["@type"] === "FAQPage" ||
    (Array.isArray(obj["@type"]) && (obj["@type"] as string[]).includes("FAQPage"));
  let count = isFaq ? 1 : 0;
  if (Array.isArray(obj["@graph"])) {
    for (const node of obj["@graph"]) count += countFaqPageBlocks(node);
  }
  return count;
}


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
