import { describe, it, expect } from "vitest";
import {
  buildPersonBlock,
  composeContentArticleSchema,
} from "./draft-enrichment";
import type { PageSnapshot } from "@/domains/pages/types";
import type { RecommendationCandidateRow } from "./emitter/candidate-row";

// Minimal fixtures, only the fields the composers read. Neutral, invented
// person (no real public figure), per the slice's fixture rule.
function snap(partial: Partial<PageSnapshot>): PageSnapshot {
  return {
    schema_types: [],
    body_paragraph_sample: [],
    h2_list: [],
    ...partial,
  } as PageSnapshot;
}

function candidate(partial: Partial<RecommendationCandidateRow> = {}): RecommendationCandidateRow {
  return {
    tenant_id: "tenant-example",
    trigger_signal: "missing_schema_content",
    action_type: "add_schema",
    generator_kind: "deterministic",
    target_url: "https://example.com/people/jonas-kettering",
    topic_cluster_label: "Structured data",
    evidence: [],
    confidence: "medium",
    impact_estimate: "high",
    customer_copy: "",
    operator_evidence: "",
    dedupe_key: "x",
    cooldown_key: "y",
    created_from_signal_at: "2026-07-02T00:00:00.000Z",
    safety_flags: [],
    ...partial,
  } as RecommendationCandidateRow;
}

const BIOGRAPHY_SNAP = snap({
  title: "Jonas Kettering",
  h1: "Jonas Kettering",
  meta_description:
    "Jonas Kettering (1904-1978) was a poet known for his court odes.",
  body_paragraph_sample: [
    "Jonas Kettering (1904-1978) was a poet who wrote extensively about the seasons.",
  ],
});

describe("buildPersonBlock", () => {
  it("returns null for a non-biography page", () => {
    const nonBio = snap({
      title: "Best Persian Restaurants in Washington",
      h1: "Best Persian Restaurants in Washington",
    });
    expect(buildPersonBlock(nonBio, undefined)).toBeNull();
  });

  it("builds name + birthDate + jobTitle from the page's own extracted fields, no sameAs by default", () => {
    const block = buildPersonBlock(BIOGRAPHY_SNAP, undefined);
    expect(block).toEqual({
      "@type": "Person",
      name: "Jonas Kettering",
      birthDate: "1904",
      jobTitle: "poet",
    });
  });

  it("a name-shaped title with no corroborating body signal is not classified as biography at all (never guesses)", () => {
    const thin = snap({ title: "Reza Tabatabaei", h1: "Reza Tabatabaei" });
    expect(buildPersonBlock(thin, undefined)).toBeNull();
  });

  it("omits fields that could not be confidently extracted, keeping only what corroborated the classification", () => {
    const occupationOnly = snap({
      title: "Reza Tabatabaei",
      h1: "Reza Tabatabaei",
      body_paragraph_sample: ["Reza Tabatabaei is a sculptor based in Shiraz."],
    });
    const block = buildPersonBlock(occupationOnly, undefined);
    expect(block).toEqual({
      "@type": "Person",
      name: "Reza Tabatabaei",
      jobTitle: "sculptor",
    });
  });

  it("adds sameAs ONLY for a high-confidence Wikidata match", () => {
    const block = buildPersonBlock(BIOGRAPHY_SNAP, {
      confidence: "high",
      wikidataUrl: "https://www.wikidata.org/wiki/Q999001",
      wikipediaUrl: "https://en.wikipedia.org/wiki/Jonas_Kettering",
    });
    expect(block?.sameAs).toEqual([
      "https://www.wikidata.org/wiki/Q999001",
      "https://en.wikipedia.org/wiki/Jonas_Kettering",
    ]);
  });

  it("does NOT emit sameAs for a needs-confirm match", () => {
    const block = buildPersonBlock(BIOGRAPHY_SNAP, {
      confidence: "needs-confirm",
      wikidataUrl: "https://www.wikidata.org/wiki/Q999002",
      wikipediaUrl: null,
    });
    expect(block?.sameAs).toBeUndefined();
  });

  it("does NOT emit sameAs for a 'none' match", () => {
    const block = buildPersonBlock(BIOGRAPHY_SNAP, {
      confidence: "none",
      wikidataUrl: null,
      wikipediaUrl: null,
    });
    expect(block?.sameAs).toBeUndefined();
  });
});

describe("composeContentArticleSchema, Person alongside Article", () => {
  it("emits BOTH an Article and a Person JSON-LD script for a biography page", () => {
    const fill = composeContentArticleSchema(candidate(), BIOGRAPHY_SNAP, null);
    expect(fill).not.toBeNull();
    expect(fill!.proposed_text).toContain('"@type": "Article"');
    expect(fill!.proposed_text).toContain('"@type": "Person"');
    expect(fill!.proposed_text).toContain('"name": "Jonas Kettering"');
    expect(fill!.proposed_text).toContain('"birthDate": "1904"');
    expect(fill!.display_label).toContain("Person");
  });

  it("emits ONLY Article (no Person script) for a non-biography content page", () => {
    const nonBio = snap({
      title: "How Rice Is Traditionally Cooked",
      h1: "How Rice Is Traditionally Cooked",
      body_paragraph_sample: ["This page explains the traditional method."],
    });
    const fill = composeContentArticleSchema(candidate(), nonBio, null);
    expect(fill).not.toBeNull();
    expect(fill!.proposed_text).toContain('"@type": "Article"');
    expect(fill!.proposed_text).not.toContain('"@type": "Person"');
    expect(fill!.display_label).not.toContain("Person");
  });

  it("threads a high-confidence Wikidata match into the emitted Person sameAs", () => {
    const fill = composeContentArticleSchema(candidate(), BIOGRAPHY_SNAP, null, {
      confidence: "high",
      wikidataUrl: "https://www.wikidata.org/wiki/Q999001",
      wikipediaUrl: null,
    });
    expect(fill!.proposed_text).toContain('"sameAs"');
    expect(fill!.proposed_text).toContain("https://www.wikidata.org/wiki/Q999001");
  });

  it("never includes sameAs when the match is needs-confirm", () => {
    const fill = composeContentArticleSchema(candidate(), BIOGRAPHY_SNAP, null, {
      confidence: "needs-confirm",
      wikidataUrl: "https://www.wikidata.org/wiki/Q999002",
      wikipediaUrl: null,
    });
    expect(fill!.proposed_text).not.toContain('"sameAs"');
    expect(fill!.proposed_text).not.toContain("Q999002");
  });
});
