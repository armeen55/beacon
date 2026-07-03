/**
 * Entity + author (E-E-A-T) trigger tests (BEACON 500 P10, 2026-07-03).
 *
 * Covers all three pure predicates: they emit correct RecommendationCandidateRow
 * shapes on real gaps and are EMPTY on empty input (empty-safe pins), carry the
 * right action_type / confidence, and anchor on the right URL.
 */

import { describe, expect, it } from "vitest";

import {
  entityLinkGap,
  authorBylineGap,
  brandPresenceGap,
} from "@/domains/recommendation-intelligence/triggers/entity-eeat";
import type {
  EntityLinkGap,
  AuthorGap,
  BrandPresenceGap,
} from "@/domains/entity/eeat-types";

const SIGNAL_AT = "2026-07-03T00:00:00Z";

const entityGap: EntityLinkGap = {
  url: "https://iranopedia.com/nowruz",
  entities: [
    {
      name: "Nowruz",
      qid: "Q11448",
      wikidataUrl: "https://www.wikidata.org/wiki/Q11448",
      wikipediaUrl: "https://en.wikipedia.org/wiki/Nowruz",
      confidence: "high",
    },
  ],
  schemaTypes: ["Article"],
  fetchedAt: SIGNAL_AT,
};

const authorGap: AuthorGap = {
  url: "https://iranopedia.com/nowruz-guide",
  fetchedAt: SIGNAL_AT,
};

const brandGap: BrandPresenceGap = {
  siteRootUrl: "https://iranopedia.com/",
  brandName: "Iranopedia",
  domain: "iranopedia.com",
  gap: "no_org_schema",
  fetchedAt: SIGNAL_AT,
};

describe("entityLinkGap trigger", () => {
  it("emits one add_schema row per gap, page-anchored, medium confidence", () => {
    const rows = entityLinkGap({ tenantId: "t", gaps: [entityGap], signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.trigger_signal).toBe("entity_link_gap");
    expect(r.action_type).toBe("add_schema");
    expect(r.target_url).toBe("https://iranopedia.com/nowruz");
    expect(r.confidence).toBe("medium");
    expect(r.customer_copy).toContain("Nowruz");
    expect(r.operator_evidence).toContain("Q11448");
  });

  it("EMPTY on empty input (empty-safe pin)", () => {
    expect(entityLinkGap({ tenantId: "t", gaps: [], signalAt: SIGNAL_AT })).toEqual([]);
  });
});

describe("authorBylineGap trigger", () => {
  it("emits one add_answer_block DIRECTIVE per gap, page-anchored", () => {
    const rows = authorBylineGap({ tenantId: "t", gaps: [authorGap], signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.trigger_signal).toBe("author_byline_gap");
    expect(r.action_type).toBe("add_answer_block");
    expect(r.target_url).toBe("https://iranopedia.com/nowruz-guide");
    expect(r.confidence).toBe("medium");
    expect(r.customer_copy.toLowerCase()).toContain("who wrote this");
  });

  it("EMPTY on empty input (empty-safe pin)", () => {
    expect(authorBylineGap({ tenantId: "t", gaps: [], signalAt: SIGNAL_AT })).toEqual([]);
  });
});

describe("brandPresenceGap trigger", () => {
  it("emits exactly one add_schema row, site-root anchored", () => {
    const rows = brandPresenceGap({ tenantId: "t", gap: brandGap, signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.trigger_signal).toBe("brand_presence_gap");
    expect(r.action_type).toBe("add_schema");
    expect(r.target_url).toBe("https://iranopedia.com/");
    expect(r.confidence).toBe("medium");
    expect(r.customer_copy).toContain("Iranopedia");
  });

  it("EMPTY when the gap is null (well represented / self-hiding) (empty-safe pin)", () => {
    expect(brandPresenceGap({ tenantId: "t", gap: null, signalAt: SIGNAL_AT })).toEqual([]);
  });
});
