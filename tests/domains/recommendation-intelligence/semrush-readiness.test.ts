/**
 * Trust audit G (2026-06-16) — SEMrush evidence-model READINESS.
 *
 * The model must be able to ACCEPT richer SEMrush market data (volume, KD,
 * related keywords, phrase questions, URL organic keywords, competitor/gap)
 * WITHOUT wiring it into confidence or letting it override GSC first-party
 * truth. These tests pin that the type carries the fields and that they are
 * OPTIONAL (default-absent), so nothing changes at runtime until the connector
 * populates them. No confidence wiring is asserted here — by design.
 */

import { describe, it, expect } from "vitest";

import type {
  SemrushPageSignal,
  SemrushKeywordSignal,
  SemrushCompetitorGap,
} from "@/domains/recommendation-intelligence/semrush-page-signals";

const kw = (keyword: string, over: Partial<SemrushKeywordSignal> = {}): SemrushKeywordSignal => ({
  keyword,
  position: 7,
  volume: 480,
  difficulty: 32,
  intent: "informational",
  ...over,
});

describe("SemrushPageSignal — accepts directional market evidence (readiness)", () => {
  it("carries volume / KD / URL organic keywords today", () => {
    const sig: SemrushPageSignal = {
      page: "https://iranopedia.com/persian-rugs/mashhad-rug",
      keywords: [kw("mashhad rug", { position: 6, volume: 1200, difficulty: 41 })],
      strikingDistance: [kw("mashhad rug")],
    };
    expect(sig.keywords[0]!.volume).toBe(1200);
    expect(sig.keywords[0]!.difficulty).toBe(41); // KD
  });

  it("ACCEPTS related keywords, phrase questions, and competitor gaps", () => {
    const gap: SemrushCompetitorGap = {
      keyword: "best persian rug type",
      volume: 320,
      difficulty: 28,
      competitorDomain: "rival.example",
      competitorPosition: 3,
      ourPosition: null, // a genuine gap — we don't rank
    };
    const sig: SemrushPageSignal = {
      page: "https://iranopedia.com/persian-rugs/mashhad-rug",
      keywords: [kw("mashhad rug")],
      strikingDistance: [],
      relatedKeywords: [kw("mashhad carpet"), kw("khorasan rug")],
      questionKeywords: [kw("what is a mashhad rug", { intent: "informational" })],
      competitorGaps: [gap],
    };
    expect(sig.relatedKeywords).toHaveLength(2);
    expect(sig.questionKeywords?.[0]!.keyword).toContain("what is");
    expect(sig.competitorGaps?.[0]!.ourPosition).toBeNull();
  });

  it("the directional fields are OPTIONAL — a minimal signal is still valid", () => {
    const sig: SemrushPageSignal = {
      page: "https://iranopedia.com/x",
      keywords: [],
      strikingDistance: [],
    };
    expect(sig.relatedKeywords).toBeUndefined();
    expect(sig.questionKeywords).toBeUndefined();
    expect(sig.competitorGaps).toBeUndefined();
  });
});
