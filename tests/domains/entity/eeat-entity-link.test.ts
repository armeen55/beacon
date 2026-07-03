/**
 * Sitewide entity + sameAs detector tests (BEACON 500 P10, 2026-07-03).
 *
 * Covers: fires on a page naming a known entity with no link; EMPTY when the
 * page already links the entity; EMPTY when extraction is uncertain; no false
 * positive when the page names no known entity; dedupe by QID + cap; ranking;
 * and that the composed schema is valid JSON-LD (WebPage/about/sameAs).
 */

import { describe, expect, it } from "vitest";

import {
  classifyEntityLinkGaps,
  composeEntityAboutSchema,
  composeEntityAboutScript,
  MAX_ENTITY_LINK_PAGES,
} from "@/domains/entity/eeat-entity-link";
import type { EntityPageEntityJoin } from "@/domains/entity/eeat-input-types";
import type { KnownEntity } from "@/domains/entity/eeat-types";
import { validateSchema } from "@/domains/pages/schema-validator";

function entity(over: Partial<KnownEntity> = {}): KnownEntity {
  return {
    name: "Nowruz",
    qid: "Q11448",
    wikidataUrl: "https://www.wikidata.org/wiki/Q11448",
    wikipediaUrl: "https://en.wikipedia.org/wiki/Nowruz",
    confidence: "high",
    ...over,
  };
}

function page(over: Partial<EntityPageEntityJoin> = {}): EntityPageEntityJoin {
  return {
    url: "https://iranopedia.com/nowruz",
    schemaTypes: ["Article"],
    extractionCertain: true,
    namedEntities: [entity()],
    fetchedAt: "2026-07-03T00:00:00Z",
    ...over,
  };
}

describe("classifyEntityLinkGaps", () => {
  it("fires on a content page that names a known entity but does not link it", () => {
    const gaps = classifyEntityLinkGaps([page()]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.url).toBe("https://iranopedia.com/nowruz");
    expect(gaps[0]!.entities.map((e) => e.qid)).toEqual(["Q11448"]);
  });

  it("EMPTY when the page schema already links the entity's QID", () => {
    const gaps = classifyEntityLinkGaps([
      page({ schemaBlob: "Article https://www.wikidata.org/wiki/Q11448" }),
    ]);
    expect(gaps).toEqual([]);
  });

  it("EMPTY when the page schema already links the entity's Wikipedia URL", () => {
    const gaps = classifyEntityLinkGaps([
      page({ schemaBlob: "Article https://en.wikipedia.org/wiki/Nowruz" }),
    ]);
    expect(gaps).toEqual([]);
  });

  it("EMPTY when extraction was uncertain (a link could have been missed)", () => {
    const gaps = classifyEntityLinkGaps([page({ extractionCertain: false })]);
    expect(gaps).toEqual([]);
  });

  it("no false positive when the page names no known entity", () => {
    const gaps = classifyEntityLinkGaps([page({ namedEntities: [] })]);
    expect(gaps).toEqual([]);
  });

  it("EMPTY input -> EMPTY output", () => {
    expect(classifyEntityLinkGaps([])).toEqual([]);
  });

  it("dedupes entities by QID (case-insensitive) and caps per page", () => {
    const many: KnownEntity[] = [
      entity({ name: "Nowruz", qid: "Q11448" }),
      entity({ name: "nowruz festival", qid: "q11448" }), // dup QID
      entity({ name: "Persepolis", qid: "Q129072", wikidataUrl: "https://www.wikidata.org/wiki/Q129072" }),
      entity({ name: "Cyrus", qid: "Q8423", wikidataUrl: "https://www.wikidata.org/wiki/Q8423" }),
      entity({ name: "Darius", qid: "Q43395", wikidataUrl: "https://www.wikidata.org/wiki/Q43395" }),
      entity({ name: "Xerxes", qid: "Q129165", wikidataUrl: "https://www.wikidata.org/wiki/Q129165" }),
      entity({ name: "Zoroaster", qid: "Q42743", wikidataUrl: "https://www.wikidata.org/wiki/Q42743" }),
      entity({ name: "Ferdowsi", qid: "Q83428", wikidataUrl: "https://www.wikidata.org/wiki/Q83428" }),
    ];
    const gaps = classifyEntityLinkGaps([page({ namedEntities: many })]);
    expect(gaps).toHaveLength(1);
    const qids = gaps[0]!.entities.map((e) => e.qid.toLowerCase());
    expect(qids.filter((q) => q === "q11448")).toHaveLength(1); // deduped
    expect(gaps[0]!.entities.length).toBeLessThanOrEqual(6); // capped
  });

  it("ranks pages by number of unlinked entities and caps the page count", () => {
    const pages: EntityPageEntityJoin[] = [];
    for (let i = 0; i < MAX_ENTITY_LINK_PAGES + 3; i++) {
      pages.push(
        page({
          url: `https://iranopedia.com/p${i}`,
          namedEntities: [entity({ qid: `Q${1000 + i}`, wikidataUrl: `https://www.wikidata.org/wiki/Q${1000 + i}` })],
        }),
      );
    }
    // Give one page two entities so it ranks first.
    pages[5]!.namedEntities = [
      entity({ qid: "Q2001", wikidataUrl: "https://www.wikidata.org/wiki/Q2001" }),
      entity({ qid: "Q2002", wikidataUrl: "https://www.wikidata.org/wiki/Q2002" }),
    ];
    const gaps = classifyEntityLinkGaps(pages);
    expect(gaps).toHaveLength(MAX_ENTITY_LINK_PAGES);
    expect(gaps[0]!.entities.length).toBe(2); // richest page first
  });
});

describe("composeEntityAboutSchema", () => {
  it("composes valid JSON-LD (WebPage / about / sameAs) for a single entity", () => {
    const gaps = classifyEntityLinkGaps([page()]);
    const json = composeEntityAboutSchema(gaps[0]!);
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(parsed["@type"]).toBe("WebPage");
    expect(parsed.about["@type"]).toBe("Thing");
    expect(parsed.about["@id"]).toBe("https://www.wikidata.org/wiki/Q11448");
    expect(parsed.about.sameAs).toEqual([
      "https://www.wikidata.org/wiki/Q11448",
      "https://en.wikipedia.org/wiki/Nowruz",
    ]);
    // Valid per the scanner's own validator (no warnings for WebPage/Thing).
    expect(validateSchema(parsed)).toEqual([]);
  });

  it("emits an about ARRAY for a multi-entity page and stays valid JSON-LD", () => {
    const gap = classifyEntityLinkGaps([
      page({
        namedEntities: [
          entity({ name: "Nowruz", qid: "Q11448" }),
          entity({ name: "Persepolis", qid: "Q129072", wikidataUrl: "https://www.wikidata.org/wiki/Q129072", wikipediaUrl: null }),
        ],
      }),
    ])[0]!;
    const parsed = JSON.parse(composeEntityAboutSchema(gap)!);
    expect(Array.isArray(parsed.about)).toBe(true);
    expect(parsed.about).toHaveLength(2);
    // The one without a Wikipedia URL still carries the Wikidata sameAs.
    expect(parsed.about[1].sameAs).toEqual(["https://www.wikidata.org/wiki/Q129072"]);
    expect(validateSchema(parsed)).toEqual([]);
  });

  it("wraps the schema in a ready-to-paste <script> tag", () => {
    const gap = classifyEntityLinkGaps([page()])[0]!;
    const script = composeEntityAboutScript(gap);
    expect(script).toContain('<script type="application/ld+json">');
    expect(script).toContain("Q11448");
  });
});
