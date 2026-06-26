/**
 * extract-page-seo (2026-06-25, Sprint 6 · plan P8) — PURE (cheerio, no I/O).
 *
 * Pull the on-page SEO signals a product/collection audit needs straight out of
 * already-fetched HTML: <title>, meta description, and whether real JSON-LD schema
 * is present (Product/Offer for stores, Article for content). Deterministic. Feeds
 * product-seo-gaps so the image-alt scan (which already fetches the HTML) can also
 * report missing schema/meta/title — no extra requests, $0.
 *
 * Pinned by extract-page-seo.test.ts.
 */

import { load as cheerioLoad } from "cheerio";

export type PageSeoSignals = {
  title: string | null;
  metaDescription: string | null;
  hasProductSchema: boolean;
  hasArticleSchema: boolean;
};

/** Does any ld+json block declare one of these @type values? Tolerant of arrays,
 *  @graph, and whitespace in the JSON. PURE. */
function hasSchemaType(jsonLdBlocks: string[], types: string[]): boolean {
  const wanted = new Set(types.map((t) => t.toLowerCase()));
  for (const raw of jsonLdBlocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Malformed JSON → tolerant scan of THIS block, but still require the type to be
      // the value of an "@type" key (not just both strings present somewhere).
      const lc = raw.toLowerCase();
      if (types.some((t) => new RegExp(`"@type"\\s*:\\s*\\[?\\s*"${t.toLowerCase()}"`, "i").test(lc))) return true;
      continue;
    }
    const stack: unknown[] = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
      } else if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        const t = obj["@type"];
        if (typeof t === "string" && wanted.has(t.toLowerCase())) return true;
        if (Array.isArray(t) && t.some((x) => typeof x === "string" && wanted.has(x.toLowerCase()))) return true;
        for (const v of Object.values(obj)) if (v && typeof v === "object") stack.push(v);
      }
    }
  }
  return false;
}

/** Extract title / meta description / schema presence from page HTML. PURE. */
export function extractPageSeoSignals(html: string): PageSeoSignals {
  if (!html || typeof html !== "string") {
    return { title: null, metaDescription: null, hasProductSchema: false, hasArticleSchema: false };
  }
  const $ = cheerioLoad(html);
  const title = $("title").first().text().trim() || null;
  const metaDescription =
    ($('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "").trim() || null;

  const jsonLd: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).contents().text();
    if (txt && txt.trim()) jsonLd.push(txt.trim());
  });

  return {
    title,
    metaDescription,
    hasProductSchema: hasSchemaType(jsonLd, ["Product", "Offer", "AggregateOffer"]),
    hasArticleSchema: hasSchemaType(jsonLd, ["Article", "NewsArticle", "BlogPosting"]),
  };
}
