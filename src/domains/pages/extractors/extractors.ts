/**
 * Sprint 6A.1 Phase 5 (2026-04-24) — Active extractor implementations.
 *
 * 13 active extractors (one per active ElementType in Phase 6A.1.3's
 * EXTRACTOR_REGISTRY) + 18 stubs for registered-but-inactive types.
 * All pure functions. All resilient to missing / malformed input —
 * zero throws for legitimately bad HTML, missing JSON-LD, empty
 * dictionaries, etc.
 *
 * Inputs:
 *   - `snapshot: PageSnapshot` — already-parsed fields from the
 *     existing `extractPageSnapshot` (title, meta_description,
 *     canonical_url, h1, h2_list, faqs, schema_types). Reuses that
 *     work to avoid duplicating cheerio logic.
 *   - `html: string` — raw HTML for things PageSnapshot doesn't
 *     expose (h3 text, internal-link href+anchor, schema property
 *     values, body text for mention matching).
 *   - `ctx: ExtractorContext` — page URL + dictionaries.
 *
 * Output per extractor: `ExtractedElement[]`. Dispatcher (Phase
 * 6A.1.6) wraps each with tenant_id / page_id / observed_at /
 * source_snapshot_id / id.
 *
 * No DB writes. No recommended_edits. No generators. No UI. No LLM.
 */

import { load as cheerioLoad } from "cheerio";
import type { PageSnapshot } from "../types";
import type { ElementType } from "./registry";
import { EXTRACTOR_REGISTRY } from "./registry";
import type { Extractor, ExtractedElement, ExtractorContext } from "./types";
import {
  positionalKey,
  singletonKey,
  schemaTypeKey,
  schemaPropertyKey,
  displayLabel,
} from "./element-key";

// ── Shared helpers ──────────────────────────────────────────────────────────

function ver(type: ElementType): number {
  return EXTRACTOR_REGISTRY[type].version;
}

/** Safe content normalization — trim; return null on empty. Used when
 *  the extractor's element_text should be null rather than "". */
function textOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return t.length === 0 ? null : t;
}

/** Try to parse an arbitrary JSON-LD block. Returns null on malformed
 *  input rather than throwing. Input may be string, array, or object —
 *  we always return the first usable node. */
function safeParseJsonLd(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Iterate the JSON-LD wrapper shape: an array of graphs, a single
 *  object with @graph, or a single object. Yields each top-level
 *  node. Tolerates arbitrary nesting; callers recurse further. */
function* walkJsonLdTopLevel(
  root: unknown,
): Generator<Record<string, unknown>> {
  if (Array.isArray(root)) {
    for (const item of root) {
      if (item && typeof item === "object") {
        yield* walkJsonLdTopLevel(item);
      }
    }
    return;
  }
  if (root && typeof root === "object") {
    const obj = root as Record<string, unknown>;
    if (Array.isArray(obj["@graph"])) {
      for (const item of obj["@graph"] as unknown[]) {
        if (item && typeof item === "object") {
          yield* walkJsonLdTopLevel(item);
        }
      }
    } else {
      yield obj;
    }
  }
}

/** Pull the string @type(s) from a JSON-LD node. May be string or
 *  array; returns a string array either way. */
function schemaTypesOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

// ── 1. Title ────────────────────────────────────────────────────────────────
export const extractTitle: Extractor = (snapshot) => {
  const content = textOrNull(snapshot.title);
  if (!content) return [];
  return [
    {
      elementType: "title",
      elementKey: singletonKey("title", content),
      displayLabel: displayLabel({ elementType: "title", content }),
      elementText: content,
      elementMetadata: {},
      extractorVersion: ver("title"),
    },
  ];
};

// ── 2. Meta description ─────────────────────────────────────────────────────
export const extractMeta: Extractor = (snapshot) => {
  const content = textOrNull(snapshot.meta_description);
  if (!content) return [];
  return [
    {
      elementType: "meta",
      elementKey: singletonKey("meta", content),
      displayLabel: displayLabel({ elementType: "meta", content }),
      elementText: content,
      elementMetadata: {},
      extractorVersion: ver("meta"),
    },
  ];
};

// ── 3. Canonical ────────────────────────────────────────────────────────────
export const extractCanonical: Extractor = (snapshot) => {
  const content = textOrNull(snapshot.canonical_url);
  if (!content) return [];
  return [
    {
      elementType: "canonical",
      elementKey: singletonKey("canonical", content),
      displayLabel: displayLabel({ elementType: "canonical", content }),
      elementText: content,
      elementMetadata: {},
      extractorVersion: ver("canonical"),
    },
  ];
};

// ── 4. H1 ───────────────────────────────────────────────────────────────────
export const extractH1: Extractor = (snapshot) => {
  const content = textOrNull(snapshot.h1);
  if (!content) return [];
  return [
    {
      elementType: "h1",
      elementKey: positionalKey("h1", 0, content),
      displayLabel: displayLabel({
        elementType: "h1",
        position: 0,
        content,
      }),
      elementText: content,
      elementMetadata: {},
      extractorVersion: ver("h1"),
    },
  ];
};

// ── 5. H2 (full text + position) ────────────────────────────────────────────
export const extractH2: Extractor = (snapshot) => {
  const list = snapshot.h2_list ?? [];
  const out: ExtractedElement[] = [];
  for (let i = 0; i < list.length; i++) {
    const content = textOrNull(list[i]);
    if (!content) continue;
    out.push({
      elementType: "h2",
      elementKey: positionalKey("h2", i, content),
      displayLabel: displayLabel({
        elementType: "h2",
        position: i,
        content,
      }),
      elementText: content,
      elementMetadata: {},
      extractorVersion: ver("h2"),
    });
  }
  return out;
};

// ── 6. H3 (parsed directly from HTML — snapshot has count only) ─────────────
export const extractH3: Extractor = (_snapshot, html) => {
  if (!html) return [];
  const $ = cheerioLoad(html);
  const out: ExtractedElement[] = [];
  $("h3").each((i, el) => {
    if (i >= 30) return; // cap parallel to existing snapshot extractor
    const content = textOrNull($(el).text());
    if (!content) return;
    out.push({
      elementType: "h3",
      elementKey: positionalKey("h3", i, content),
      displayLabel: displayLabel({
        elementType: "h3",
        position: i,
        content,
      }),
      elementText: content,
      elementMetadata: {},
      extractorVersion: ver("h3"),
    });
  });
  return out;
};

// ── 7/8. FAQ (question + answer, both html-visible and jsonld sources) ──────
export const extractFaqQuestion: Extractor = (snapshot) => {
  const faqs = snapshot.faqs ?? [];
  const out: ExtractedElement[] = [];
  for (let i = 0; i < faqs.length; i++) {
    const q = textOrNull(faqs[i].question);
    if (!q) continue;
    out.push({
      elementType: "faq_question",
      elementKey: positionalKey("faq_question", i, q),
      displayLabel: displayLabel({
        elementType: "faq_question",
        position: i,
        content: q,
      }),
      elementText: q,
      elementMetadata: {
        source: faqs[i].source, // jsonld | html_details | html_section
      },
      extractorVersion: ver("faq_question"),
    });
  }
  return out;
};

export const extractFaqAnswer: Extractor = (snapshot) => {
  const faqs = snapshot.faqs ?? [];
  const out: ExtractedElement[] = [];
  for (let i = 0; i < faqs.length; i++) {
    const a = textOrNull(faqs[i].answer_excerpt);
    if (!a) continue;
    out.push({
      elementType: "faq_answer",
      elementKey: positionalKey("faq_answer", i, a),
      displayLabel: displayLabel({
        elementType: "faq_answer",
        position: i,
        content: a,
      }),
      elementText: a,
      elementMetadata: {
        source: faqs[i].source,
        question: faqs[i].question, // pair lookup
      },
      extractorVersion: ver("faq_answer"),
    });
  }
  return out;
};

// ── 9. Schema @type (one row per distinct type on the page) ─────────────────
export const extractSchemaType: Extractor = (snapshot) => {
  const types = snapshot.schema_types ?? [];
  const seen = new Set<string>();
  const out: ExtractedElement[] = [];
  for (const t of types) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push({
      elementType: "schema_type",
      elementKey: schemaTypeKey(t),
      displayLabel: displayLabel({ elementType: "schema_type", content: t }),
      elementText: t,
      elementMetadata: {},
      extractorVersion: ver("schema_type"),
    });
  }
  return out;
};

// ── 10. Schema property (recurse JSON-LD, emit string leaves) ───────────────

const MAX_SCHEMA_PROPERTIES_PER_SNAPSHOT = 100;
const MAX_SCHEMA_VALUE_LENGTH = 500;

export const extractSchemaProperty: Extractor = (_snapshot, html) => {
  if (!html) return [];
  const $ = cheerioLoad(html);
  const out: ExtractedElement[] = [];
  let emitted = 0;

  const addProperty = (
    topType: string,
    path: Array<string | number>,
    value: string,
  ): void => {
    if (emitted >= MAX_SCHEMA_PROPERTIES_PER_SNAPSHOT) return;
    const trimmed = value.trim().slice(0, MAX_SCHEMA_VALUE_LENGTH);
    if (!trimmed) return;
    out.push({
      elementType: "schema_property",
      elementKey: schemaPropertyKey(topType, path, trimmed),
      displayLabel: displayLabel({
        elementType: "schema_property",
        content: `${topType}${renderPath(path)}`,
      }),
      elementText: trimmed,
      elementMetadata: { schemaType: topType, path },
      extractorVersion: ver("schema_property"),
    });
    emitted += 1;
  };

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    const parsed = safeParseJsonLd(raw);
    if (!parsed) return;
    for (const node of walkJsonLdTopLevel(parsed)) {
      const types = schemaTypesOf(node);
      const topType = types[0]; // canonical type for this node
      if (!topType) continue;
      walkProperties(node, [], topType, addProperty);
    }
  });

  return out;
};

function renderPath(path: Array<string | number>): string {
  return path
    .map((seg) => (typeof seg === "number" ? `[${seg}]` : `.${seg}`))
    .join("");
}

function walkProperties(
  node: unknown,
  path: Array<string | number>,
  topType: string,
  emit: (topType: string, path: Array<string | number>, value: string) => void,
): void {
  if (node == null) return;
  if (typeof node === "string") {
    if (path.length > 0) emit(topType, path, node);
    return;
  }
  if (typeof node === "number" || typeof node === "boolean") {
    if (path.length > 0) emit(topType, path, String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walkProperties(node[i], [...path, i], topType, emit);
    }
    return;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      // Skip JSON-LD keywords from the emitted path — they're schema
      // structure markers, not semantic properties.
      if (key === "@type" || key === "@context" || key === "@id") continue;
      walkProperties(obj[key], [...path, key], topType, emit);
    }
  }
}

// ── 11. Internal link (cheerio parse; same-origin filter + normalize) ───────
export const extractInternalLink: Extractor = (_snapshot, html, ctx) => {
  if (!html) return [];
  let pageOrigin: string | null = null;
  try {
    pageOrigin = new URL(ctx.pageUrl).origin;
  } catch {
    return [];
  }
  const $ = cheerioLoad(html);
  const out: ExtractedElement[] = [];
  let idx = 0;
  $("a[href]").each((_, el) => {
    const rawHref = ($(el).attr("href") ?? "").trim();
    if (!rawHref) return;
    // Skip non-navigational hrefs
    if (
      rawHref.startsWith("#") ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:") ||
      rawHref.startsWith("javascript:")
    ) {
      return;
    }
    // Resolve relative to page URL
    let resolved: URL;
    try {
      resolved = new URL(rawHref, ctx.pageUrl);
    } catch {
      return;
    }
    // Same-origin filter — external_link extractor is registered-but-
    // inactive in v1.
    if (resolved.origin !== pageOrigin) return;
    const normalizedHref = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    const anchor = $(el).text().trim();
    // Content for hashing combines the normalized href and the anchor
    // so two links with the same href but different anchor text get
    // distinct keys (reasonable — operator sees them as different
    // choices).
    const content = `${normalizedHref}|${anchor}`;
    out.push({
      elementType: "internal_link",
      elementKey: positionalKey("internal_link", idx, content),
      displayLabel: displayLabel({
        elementType: "internal_link",
        position: idx,
        content: anchor ? `${anchor} → ${normalizedHref}` : normalizedHref,
      }),
      elementText: anchor || null,
      elementMetadata: {
        href: normalizedHref,
        anchor,
      },
      extractorVersion: ver("internal_link"),
    });
    idx += 1;
  });
  return out;
};

// ── 12/13. City + service mentions (dictionary-driven) ──────────────────────

function extractBodyText(html: string): string {
  if (!html) return "";
  const $ = cheerioLoad(html);
  // Remove boilerplate that would bleed cross-page mentions into every URL.
  $("nav, header, footer, aside, script, style, noscript").remove();
  const main = $("main, article").first();
  const source = main.length > 0 ? main : $("body");
  return source
    .text()
    .replace(/\s+/g, " ")
    .trim();
}

function countMentions(bodyText: string, term: string): number {
  const trimmed = term.trim();
  if (!trimmed) return 0;
  // Word-boundary match, case-insensitive. Escape regex specials.
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "gi");
  const matches = bodyText.match(re);
  return matches ? matches.length : 0;
}

function makeMentionExtractor(
  elementType: "city_mention" | "service_mention",
  dictionaryKey: keyof Pick<
    ExtractorContext,
    "cityDictionary" | "serviceDictionary"
  >,
): Extractor {
  return (_snapshot, html, ctx) => {
    const dict = ctx[dictionaryKey] ?? [];
    if (dict.length === 0) return [];
    const body = extractBodyText(html);
    if (!body) return [];
    const out: ExtractedElement[] = [];
    let idx = 0;
    for (const term of dict) {
      const occurrences = countMentions(body, term);
      if (occurrences < 1) continue;
      out.push({
        elementType,
        elementKey: positionalKey(elementType, idx, term),
        displayLabel: displayLabel({
          elementType,
          position: idx,
          content: term,
        }),
        elementText: term,
        elementMetadata: { occurrences },
        extractorVersion: ver(elementType),
      });
      idx += 1;
    }
    return out;
  };
}

export const extractCityMention: Extractor = makeMentionExtractor(
  "city_mention",
  "cityDictionary",
);

export const extractServiceMention: Extractor = makeMentionExtractor(
  "service_mention",
  "serviceDictionary",
);

// ── Inactive extractor stubs (return [] until Sprint 6A.2 flips them) ───────
// These exist so the dispatcher's type-level map over EXTRACTOR_REGISTRY is
// total. Each returns an empty array — dispatcher respects the registry's
// `active: false` flag and doesn't invoke them anyway, but the stubs keep
// the map exhaustive and a future activation is a single line change.
const emptyExtractor: Extractor = () => [];

/**
 * Complete ElementType → Extractor map. Not exported from the
 * registry module per Phase 6A.1.3's data-only invariant — kept here
 * in the implementation module instead. Dispatcher reads this map
 * but guards on EXTRACTOR_REGISTRY[type].active before invoking.
 */
export const EXTRACTORS: Record<ElementType, Extractor> = {
  // Active v1
  title: extractTitle,
  meta: extractMeta,
  canonical: extractCanonical,
  h1: extractH1,
  h2: extractH2,
  h3: extractH3,
  faq_question: extractFaqQuestion,
  faq_answer: extractFaqAnswer,
  schema_type: extractSchemaType,
  schema_property: extractSchemaProperty,
  internal_link: extractInternalLink,
  city_mention: extractCityMention,
  service_mention: extractServiceMention,
  // Inactive (stubbed) — registered in EXTRACTOR_REGISTRY with
  // active: false; flipped to real extractors in Sprint 6A.2.
  og_title: emptyExtractor,
  og_desc: emptyExtractor,
  external_link: emptyExtractor,
  entity_mention: emptyExtractor,
  competitor_mention: emptyExtractor,
  table: emptyExtractor,
  table_row: emptyExtractor,
  list: emptyExtractor,
  cta: emptyExtractor,
  testimonial: emptyExtractor,
  proof: emptyExtractor,
  project_card: emptyExtractor,
  answer_block: emptyExtractor,
  comparison_block: emptyExtractor,
  cost_section: emptyExtractor,
  timeline_section: emptyExtractor,
  service_area_grid: emptyExtractor,
  external_citation: emptyExtractor,
};

// Re-export shared types for convenience at this barrel's boundary.
export type { ExtractorContext, ExtractedElement, Extractor } from "./types";

/** Explicit marker for tests — total number of extractors in the map. */
export const EXTRACTOR_MAP_SIZE = Object.keys(EXTRACTORS).length;

/** Explicit marker for tests — PageSnapshot import touch so the
 *  `import type` isn't elided when the module is analyzed for
 *  surface shape. */
export type _PageSnapshot = PageSnapshot;
