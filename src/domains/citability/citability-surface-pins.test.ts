/**
 * Citability surface + wiring pins (2026-07-02, master plan item 26).
 *
 * Source-level pins: build-today-preview.ts reads the item-7 funnel and
 * wires the citability hint feed additively beside the other hint families,
 * the evidence brief gains the citability field, and the daily card renders
 * the deliverable-4 evidence line. Also the no-dash hard rule over every
 * touched source file.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PREVIEW = readFileSync(resolve(__dirname, "../experiments/build-today-preview.ts"), "utf8");
const BRIEF = readFileSync(resolve(__dirname, "../experiments/daily-evidence-brief.ts"), "utf8");
const CARD = readFileSync(resolve(__dirname, "../../app/(shell)/daily-experiments-section.tsx"), "utf8");
const MINER = readFileSync(resolve(__dirname, "mine-answer-patterns.ts"), "utf8");
const CLASSIFIER = readFileSync(resolve(__dirname, "pattern-classifier.ts"), "utf8");
const SCORE = readFileSync(resolve(__dirname, "citability-score.ts"), "utf8");
const HINTS = readFileSync(resolve(__dirname, "citability-hints.ts"), "utf8");
const STORE_CLASSIFICATION = readFileSync(resolve(__dirname, "../../lib/persistence/store-classification.ts"), "utf8");
const JSON_STORE = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");

describe("daily plan hint feed (build-today-preview)", () => {
  it("reads the item-7 crawl-citation funnel and wires the citability hint feed additively", () => {
    expect(PREVIEW).toContain('from "@/domains/ai-visibility/load-crawl-citation-funnel"');
    expect(PREVIEW).toContain("loadCrawlCitationFunnel(tenantId, slug)");
    expect(PREVIEW).toContain('from "@/domains/citability/citability-hints"');
    expect(PREVIEW).toContain("buildCitabilityHintNotes(citationFunnel");
    // Composes beside, does not replace, the other item hint feeds.
    expect(PREVIEW).toContain("buildSpikeHintNotes(querySpikes");
    expect(PREVIEW).toContain("buildSeasonalHintNotes(seasonalQueries");
    expect(PREVIEW).toContain("buildLanguageGapHintNotes(languageGaps");
  });

  it("attaches the citability evidence + roundtable voice using the profound (AI citations) teammate", () => {
    expect(PREVIEW).toContain("citabilityHintsByPath.get(normalizePath(c.url))");
    expect(PREVIEW).toContain('specialist: "profound"');
    expect(PREVIEW).toContain('label: "AI citability"');
    expect(PREVIEW).toContain("citability: { score: citabilityHint.score");
  });

  it("passes topFixes to the answer-block drafter's evidenceHints guidance", () => {
    expect(PREVIEW).toContain("citabilityHintsByPath.get(normalizePath(p.url))");
    expect(PREVIEW).toContain("evidenceHints: citability?.topFixes");
  });

  it("contains no em or en dashes anywhere in the citability wiring block", () => {
    const wireStart = PREVIEW.indexOf("Item 26 - the citability hint feed");
    const wireEnd = PREVIEW.indexOf("confidencePct: 70,", wireStart) + 40;
    expect(wireStart).toBeGreaterThan(-1);
    expect(PREVIEW.slice(wireStart, wireEnd)).not.toMatch(/[–—]/);
  });
});

describe("evidence brief carries the citability field", () => {
  it("DailyEvidenceBrief has an optional citability field with score, evidenceLine, topFixes", () => {
    expect(BRIEF).toContain("citability?: EvidenceCitability");
    expect(BRIEF).toContain("export type EvidenceCitability");
    expect(BRIEF).toContain("score: number");
    expect(BRIEF).toContain("evidenceLine: string");
    expect(BRIEF).toContain("topFixes: string[]");
  });
});

describe("daily card renders the deliverable-4 evidence line", () => {
  it("has a CitabilityEvidence component reading evidenceBrief.citability", () => {
    expect(CARD).toContain("function CitabilityEvidence");
    expect(CARD).toContain("e.evidenceBrief?.citability");
    expect(CARD).toContain("AI citability");
  });

  it("is wired into the How we know section beside the other evidence lines", () => {
    const howWeKnowStart = CARD.indexOf("function HowWeKnow");
    const section = CARD.slice(howWeKnowStart, howWeKnowStart + 2000);
    expect(section).toContain("<CompetitorSteal e={e} />");
    expect(section).toContain("<CitabilityEvidence e={e} />");
  });
});


describe("no em or en dashes anywhere in the citability module (hard rule)", () => {
  const files: Array<[string, string]> = [
    ["mine-answer-patterns.ts", MINER],
    ["pattern-classifier.ts", CLASSIFIER],
    ["citability-score.ts", SCORE],
    ["citability-hints.ts", HINTS],
  ];
  for (const [name, src] of files) {
    it(`${name} contains no em or en dashes`, () => {
      expect(src).not.toMatch(/[–—]/);
    });
  }
});
