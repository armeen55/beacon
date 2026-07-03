/**
 * Sitewide entity + sameAs detector (BEACON 500 P10 v1 118/218, 2026-07-03).
 *
 * THE GAP: a content page's own text names an entity Google ALREADY knows in
 * its Knowledge Graph (Beacon resolved that name to a Wikidata QID in the
 * shipped biography-QID slice), but the page carries no entity schema linking
 * to it. Adding a WebPage `about` block with `sameAs` (the QID + Wikipedia URL)
 * connects the page to the topic in the engines' own language, which is exactly
 * how AI answer engines confirm what a page is about before citing it.
 *
 * This EXTENDS the shipped Wikidata work: buildPersonBlock (draft-enrichment)
 * already emits a Person `sameAs` for a biography page's SUBJECT. This detector
 * generalizes that to ANY content page naming ANY known entity (a place, a
 * festival, a concept, a person), and composes the `sameAs` block for pages the
 * biography path never touches.
 *
 * PURE. No I/O, no LLM, no tenant hardcoding. The loader pre-joins each page to
 * the known entities its title/H1/H2 name (from the tenant's Wikidata cache);
 * this module decides which of those are UNLINKED and composes the JSON-LD.
 */

import type { EntityLinkGap, KnownEntity } from "./eeat-types";
import type { EntityPageEntityJoin } from "./eeat-input-types";

/** How many entities one card links at once (a focused, honest set). */
const MAX_ENTITIES_PER_PAGE = 6;
/** How many pages get an entity-link card in one run (highest-signal first). */
export const MAX_ENTITY_LINK_PAGES = 8;

/**
 * True when the page's schema ALREADY references the given entity's QID or
 * Wikipedia URL anywhere in its raw schema strings. The loader passes the raw
 * lower-cased schema @type strings AND (when available) any sameAs values it
 * captured; a conservative substring check keeps us from proposing a link the
 * page already carries. Comparison is lower-cased.
 */
function alreadyLinks(entity: KnownEntity, schemaBlob: string): boolean {
  const blob = schemaBlob.toLowerCase();
  if (entity.qid && blob.includes(entity.qid.toLowerCase())) return true;
  if (entity.wikipediaUrl && blob.includes(entity.wikipediaUrl.toLowerCase())) {
    return true;
  }
  // wikidata.org/wiki/<QID> form.
  if (entity.wikidataUrl && blob.includes(entity.wikidataUrl.toLowerCase())) {
    return true;
  }
  return false;
}

/**
 * Deduplicate a list of known entities by QID (case-insensitive), preserving
 * order (first mention wins), and cap the result.
 */
function dedupeEntities(entities: ReadonlyArray<KnownEntity>): KnownEntity[] {
  const seen = new Set<string>();
  const out: KnownEntity[] = [];
  for (const e of entities) {
    const key = e.qid.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= MAX_ENTITIES_PER_PAGE) break;
  }
  return out;
}

/**
 * Classify each pre-joined page into an EntityLinkGap when it names one or more
 * known entities it does not already reference. Pages whose extraction was
 * uncertain are skipped (a missed JSON-LD block could hide an existing link).
 *
 * Ranked so the pages naming the MOST unlinked entities come first, then capped
 * at MAX_ENTITY_LINK_PAGES for a focused daily set. Empty in -> empty out.
 */
export function classifyEntityLinkGaps(
  pages: ReadonlyArray<EntityPageEntityJoin>,
): EntityLinkGap[] {
  const gaps: EntityLinkGap[] = [];
  for (const page of pages) {
    if (!page.extractionCertain) continue;
    if (page.namedEntities.length === 0) continue;

    const schemaBlob = page.schemaBlob ?? page.schemaTypes.join(" ");
    const unlinked = dedupeEntities(
      page.namedEntities.filter((e) => !alreadyLinks(e, schemaBlob)),
    );
    if (unlinked.length === 0) continue;

    gaps.push({
      url: page.url,
      entities: unlinked,
      schemaTypes: page.schemaTypes,
      fetchedAt: page.fetchedAt,
    });
  }
  gaps.sort((a, b) => b.entities.length - a.entities.length);
  return gaps.slice(0, MAX_ENTITY_LINK_PAGES);
}

/**
 * Compose the ready-to-paste JSON-LD for one entity-link gap: a WebPage node
 * whose `about` lists each named entity with a stable @id, its human name, and
 * a `sameAs` array (the Wikidata QID URL + the Wikipedia URL when known). This
 * is the schema that tells Google "this page is about THIS Knowledge-Graph
 * thing". Deterministic, valid JSON-LD, never invents a link.
 *
 * Returns the pretty-printed JSON string, or null when there are no entities.
 */
export function composeEntityAboutSchema(gap: EntityLinkGap): string | null {
  if (gap.entities.length === 0) return null;

  const about = gap.entities.map((e) => {
    const sameAs = [e.wikidataUrl, e.wikipediaUrl].filter(
      (u): u is string => typeof u === "string" && u.length > 0,
    );
    return {
      "@type": "Thing",
      "@id": e.wikidataUrl,
      name: e.name,
      ...(sameAs.length > 0 ? { sameAs } : {}),
    };
  });

  const doc = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": gap.url,
    url: gap.url,
    about: about.length === 1 ? about[0] : about,
  };
  return JSON.stringify(doc, null, 2);
}

/** The ready-to-paste <script> tag wrapping the entity `about` schema (or null). */
export function composeEntityAboutScript(gap: EntityLinkGap): string | null {
  const json = composeEntityAboutSchema(gap);
  if (!json) return null;
  return `<script type="application/ld+json">\n${json}\n</script>`;
}
