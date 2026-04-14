/**
 * Cheerio-based HTML extractor for owned page snapshots.
 * Pure function: HTML string in → structured PageSnapshot out.
 */

import { load as cheerioLoad } from "cheerio";
import { createHash } from "node:crypto";
import type { PageSnapshot, FaqItem } from "./types";

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function extractPageSnapshot(
  html: string,
  url: string,
  pageId: string,
  httpStatus: number = 200
): PageSnapshot {
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
            let answerParts: string[] = [];
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

  // ── Schema types + structural audit ──
  const schemaTypes: string[] = [];
  let faqSchemaBlockCount = 0;
  const structuralWarnings: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || "");
      collectSchemaTypes(data, schemaTypes);
      faqSchemaBlockCount += countFaqPageBlocks(data);
    } catch {
      // malformed
    }
  });
  if (faqSchemaBlockCount > 1) {
    structuralWarnings.push(`duplicate_faq_schema: ${faqSchemaBlockCount} FAQPage JSON-LD blocks found — likely duplicate`);
  }
  if (h1Count > 1) {
    structuralWarnings.push(`multiple_h1: ${h1Count} <h1> tags found — should have exactly one`);
  }
  // FAQ in HTML but no FAQPage JSON-LD
  const hasHtmlFaqs = faqs.some((f) => f.source === "html_section" || f.source === "html_details");
  const hasFaqSchema = schemaTypes.includes("FAQPage");
  if (hasHtmlFaqs && !hasFaqSchema) {
    structuralWarnings.push(`faq_without_schema: FAQ content in HTML but no FAQPage JSON-LD schema`);
  }

  // ── JSON-LD presence (checked before script removal for word count) ──
  const hasJsonLd = $('script[type="application/ld+json"]').length > 0;

  // ── Links ──
  let internalLinks = 0;
  let externalLinks = 0;
  const pageDomain = extractDomain(url);

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    if (href.startsWith("/") || href.startsWith(url) || (pageDomain && href.includes(pageDomain))) {
      internalLinks++;
    } else if (href.startsWith("http")) {
      externalLinks++;
    }
  });

  // ── Word count (body text only) ──
  $("script, style, noscript, svg, iframe").remove();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

  // ── Location + service terms (from business config or inline defaults) ──
  let locationRegex: RegExp;
  let serviceRegex: RegExp;
  try {
    const { getLocationRegex, getServiceRegex } = require("@/lib/business-config");
    locationRegex = getLocationRegex();
    serviceRegex = getServiceRegex();
  } catch {
    locationRegex = /\b(palo alto|menlo park|atherton|los altos|cupertino|saratoga|woodside|portola valley|mountain view|sunnyvale|san jose|bay area|silicon valley|emerald hills)\b/gi;
    serviceRegex = /\b(custom home|remodel|renovation|new construction|tear[ -]?down|rebuild|home builder|general contractor|addition|ADU|design[- ]build)\b/gi;
  }
  const locationTerms = extractTermsByPattern(bodyText, locationRegex);
  const serviceTerms = extractTermsByPattern(bodyText, serviceRegex);

  // ── Canonical mismatch ──
  const hasCanonicalMismatch =
    canonicalUrl !== null && !urlsEquivalent(canonicalUrl, url);

  // ── Hashes ──
  const dedupedSchemaTypes = [...new Set(schemaTypes)];
  const contentHash = hash(bodyText);
  const headingsHash = hash([h1 ?? "", ...h2List].join("|"));
  const faqHash = hash(faqs.map((f) => f.question).join("|"));
  const schemaHash = hash(dedupedSchemaTypes.sort().join("|"));

  // ── Extraction certainty ──
  // "confirmed" when we found JSON-LD or structural content; "uncertain" when
  // the page might rely on client-side rendering we can't verify from raw HTML.
  // Note: hasJsonLd was captured above before script removal for word count.
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
    internal_link_count: internalLinks,
    external_link_count: externalLinks,
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

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
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
