/**
 * Outcome tests for the EvidenceSnapshot kernel. These pin the CONTRACT
 * downstream Decisions consume — not the implementation. They prove:
 *   1. all six mandatory sources normalize in and each occupies a freshness slot;
 *   2. freshness/failure state is honest (failed ≠ empty ≠ dormant);
 *   3. existing-page evidence (owned metrics + content) and new-page evidence
 *      (competitor-cited topics with no owned page) are both present;
 *   4. the assembler is deterministic (same input → same snapshot + hash);
 *   5. native AI can fail soft / stay dormant without breaking the snapshot.
 */

import { describe, it, expect } from "vitest";

import {
  buildEvidenceSnapshot,
  hashSnapshot,
  MANDATORY_SOURCES,
  type EvidenceSnapshotInput,
  type EvidenceSourceKind,
} from "./snapshot";

const SCOPE = { tenantId: "t_iran", site: "iranopedia.com", builtAt: "2026-07-22T00:00:00.000Z" };

/** A fully-populated six-source fixture (existing owned page + a cited competitor). */
function fullInput(): EvidenceSnapshotInput {
  return {
    scope: SCOPE,
    gsc: {
      status: "fresh",
      lastSyncedAt: "2026-07-21T00:00:00.000Z",
      payload: [
        {
          url: "https://iranopedia.com/flag",
          clicks90d: 40,
          impressions90d: 4000,
          ctr90d: 0.01,
          position90d: 8.2,
          topQueries: [
            { query: "iran flag meaning", impressions: 3000, clicks: 30, position: 8 },
            { query: "iran flag colors", impressions: 1000, clicks: 10, position: 9 },
          ],
        },
        {
          url: "https://iranopedia.com/flag-history",
          clicks90d: 5,
          impressions90d: 900,
          ctr90d: 0.005,
          position90d: 14,
          topQueries: [{ query: "iran flag meaning", impressions: 900, clicks: 5, position: 14 }],
        },
      ],
    },
    ga4: {
      status: "fresh",
      lastSyncedAt: "2026-07-21T00:00:00.000Z",
      payload: [
        {
          url: "https://iranopedia.com/flag",
          sessions28d: 800,
          engaged28d: 500,
          conversions28d: 12,
          revenueUsd: 340,
        },
      ],
    },
    wix: {
      status: "fresh",
      lastSyncedAt: "2026-07-20T00:00:00.000Z",
      payload: [
        {
          url: "https://iranopedia.com/flag",
          title: "The Iran Flag: Meaning and Colors",
          metaDescription: "What the Iran flag means.",
          h1: "The Iran Flag",
          h2: ["Colors", "Emblem"],
          outline: ["Colors", "Emblem", "History"],
          schemaTypes: ["Article"],
          hasFaq: false,
          faqCount: 0,
          wordCount: 600,
          internalLinks: [],
          fetchedAt: "2026-07-20T00:00:00.000Z",
        },
        {
          url: "https://iranopedia.com/flag-history",
          title: "Iran Flag History Through the Ages",
          metaDescription: null,
          h1: "Iran Flag History",
          h2: ["Timeline"],
          outline: ["Timeline"],
          schemaTypes: [],
          hasFaq: false,
          faqCount: 0,
          wordCount: 300,
          internalLinks: [],
          fetchedAt: "2026-07-20T00:00:00.000Z",
        },
      ],
    },
    clarity: {
      status: "fresh",
      lastSyncedAt: "2026-07-21T00:00:00.000Z",
      payload: [
        {
          url: "https://iranopedia.com/flag",
          sessions: 800,
          rageClicks: 20,
          deadClicks: 10,
          quickbacks: 5,
          scriptErrors: 3,
          frictionScore: 36,
        },
      ],
    },
    dataforseo: {
      status: "fresh",
      lastSyncedAt: "2026-07-19T00:00:00.000Z",
      payload: [
        { query: "iran flag meaning", searchVolume: 5400, competition: 0.2, competitionLevel: "low" },
        { query: "buy iran flag", searchVolume: 880, competition: 0.8, competitionLevel: "high" },
      ],
    },
    nativeAi: {
      status: "fresh",
      lastSyncedAt: "2026-07-21T00:00:00.000Z",
      payload: {
        rowsScanned: 120,
        enginesSeen: ["chatgpt", "perplexity"],
        citedPages: [
          {
            url: "https://iranopedia.com/flag",
            isOwned: true,
            citationCount: 4,
            distinctPrompts: 3,
            engines: ["chatgpt"],
            examplePrompts: ["what does the iran flag mean"],
          },
          {
            url: "https://persianfood.example/kebab",
            isOwned: false,
            citationCount: 9,
            distinctPrompts: 6,
            engines: ["chatgpt", "perplexity"],
            examplePrompts: ["best persian kebab recipes", "how to make koobideh kebab"],
          },
        ],
        questions: [
          { text: "what does the emblem on the iran flag mean", weight: 5, sourcePrompts: ["p1", "p2"] },
          { text: "iran flag colors meaning", weight: 3, sourcePrompts: ["p3"] },
        ],
      },
    },
  };
}

describe("buildEvidenceSnapshot — six-source normalization", () => {
  it("represents all six mandatory sources with a freshness slot", () => {
    const snap = buildEvidenceSnapshot(fullInput());
    const seen = snap.sources.map((s) => s.source).sort();
    expect(seen).toEqual([...MANDATORY_SOURCES].sort());
    for (const s of snap.sources) expect(s.status).toBe("fresh");
  });

  it("joins GSC + GA4 + Wix + Clarity + AI onto ONE owned page by canonical URL", () => {
    const snap = buildEvidenceSnapshot(fullInput());
    const flag = snap.ownedPages.find((p) => p.url === "iranopedia.com/flag");
    expect(flag).toBeTruthy();
    expect(flag!.search?.clicks90d).toBe(40); // GSC
    expect(flag!.engagement?.revenueUsd).toBe(340); // GA4 revenue
    expect(flag!.content?.title).toBe("The Iran Flag: Meaning and Colors"); // Wix
    expect(flag!.friction?.frictionScore).toBe(36); // Clarity
    expect(flag!.aiCitations.count).toBe(4); // native AI
  });

  it("carries existing-page demand: GSC-served queries fused with DataForSEO volume", () => {
    const snap = buildEvidenceSnapshot(fullInput());
    const meaning = snap.keywordDemand.find((k) => k.query === "iran flag meaning");
    expect(meaning).toBeTruthy();
    expect(meaning!.searchVolume).toBe(5400); // DataForSEO
    expect(meaning!.gscImpressions).toBe(3900); // 3000 + 900 across both owned pages
    expect(meaning!.source).toBe("mixed"); // both sources agreed
  });

  it("surfaces AI-answer questions with owned-coverage status", () => {
    const snap = buildEvidenceSnapshot(fullInput());
    const q = snap.questionDemand.find((x) => x.question.includes("emblem"));
    expect(q).toBeTruthy();
    expect(q!.source).toBe("native_ai");
    expect(["answered", "unanswered"]).toContain(q!.coverageStatus);
  });

  it("produces new-page evidence: a cited competitor topic with no owned page", () => {
    const snap = buildEvidenceSnapshot(fullInput());
    expect(snap.competitors.some((c) => c.domain === "persianfood.example")).toBe(true);
    // The competitor is cited for a kebab topic no owned (flag) page covers.
    expect(snap.newPageOpportunities.length).toBeGreaterThan(0);
    const gapKinds = new Set(snap.contentGaps.map((g) => g.kind));
    expect(gapKinds.has("missing_page") || gapKinds.has("unanswered_question")).toBe(true);
  });

  it("detects cannibalization: two owned pages serving the same query", () => {
    const snap = buildEvidenceSnapshot(fullInput());
    const cannib = snap.cannibalization.find((c) => c.query === "iran flag meaning");
    expect(cannib).toBeTruthy();
    expect(cannib!.competingUrls).toEqual([
      "iranopedia.com/flag",
      "iranopedia.com/flag-history",
    ]);
  });

  it("classifies intent (buy → commercial, meaning → informational)", () => {
    const snap = buildEvidenceSnapshot(fullInput());
    const buy = snap.intentClusters.find((c) => c.queries.some((q) => q.includes("buy")));
    expect(buy?.intent).toBe("commercial");
  });

  it("is deterministic: same input → identical snapshot + hash", () => {
    const a = buildEvidenceSnapshot(fullInput());
    const b = buildEvidenceSnapshot(fullInput());
    expect(a).toEqual(b);
    expect(a.evidenceHash).toBe(b.evidenceHash);
  });

  it("hash ignores freshness timestamps but reacts to material evidence change", () => {
    const base = fullInput();
    const a = buildEvidenceSnapshot(base);
    const laterClock: EvidenceSnapshotInput = {
      ...base,
      gsc: { ...base.gsc, lastSyncedAt: "2099-01-01T00:00:00.000Z" },
    };
    expect(buildEvidenceSnapshot(laterClock).evidenceHash).toBe(a.evidenceHash);
    const changed: EvidenceSnapshotInput = {
      ...base,
      gsc: {
        ...base.gsc,
        payload: base.gsc.payload.map((p, i) =>
          i === 0 ? { ...p, clicks90d: 9999 } : p,
        ),
      },
    };
    expect(buildEvidenceSnapshot(changed).evidenceHash).not.toBe(a.evidenceHash);
  });
});

describe("buildEvidenceSnapshot — honest source states", () => {
  function emptyInput(): EvidenceSnapshotInput {
    const empty = <T>(payload: T) => ({ status: "empty" as const, lastSyncedAt: null, payload });
    return {
      scope: SCOPE,
      gsc: empty([]),
      ga4: empty([]),
      wix: empty([]),
      clarity: empty([]),
      dataforseo: empty([]),
      nativeAi: {
        status: "dormant",
        lastSyncedAt: null,
        payload: { citedPages: [], questions: [], rowsScanned: 0, enginesSeen: [] },
      },
    };
  }

  it("keeps all six slots even when every source is empty/dormant", () => {
    const snap = buildEvidenceSnapshot(emptyInput());
    expect(snap.sources).toHaveLength(6);
    expect(snap.ownedPages).toHaveLength(0);
    expect(snap.newPageOpportunities).toHaveLength(0);
    const byKind = new Map<EvidenceSourceKind, string>(
      snap.sources.map((s) => [s.source, s.status]),
    );
    expect(byKind.get("native_ai")).toBe("dormant");
    expect(byKind.get("gsc")).toBe("empty");
  });

  it("distinguishes a FAILED source from an EMPTY one, with a plain note", () => {
    const input = emptyInput();
    input.ga4 = {
      status: "failed",
      lastSyncedAt: null,
      note: "GA4 read errored this run.",
      payload: [],
    };
    const snap = buildEvidenceSnapshot(input);
    const ga4 = snap.sources.find((s) => s.source === "ga4")!;
    expect(ga4.status).toBe("failed");
    expect(ga4.note).toBe("GA4 read errored this run.");
    const gsc = snap.sources.find((s) => s.source === "gsc")!;
    expect(gsc.status).toBe("empty");
    expect(gsc.note).not.toBe(ga4.note);
  });

  it("native AI dormant does not break the rest of the snapshot", () => {
    const input = fullInput();
    input.nativeAi = {
      status: "dormant",
      lastSyncedAt: null,
      payload: { citedPages: [], questions: [], rowsScanned: 0, enginesSeen: [] },
    };
    const snap = buildEvidenceSnapshot(input);
    expect(snap.sources.find((s) => s.source === "native_ai")!.status).toBe("dormant");
    expect(snap.ownedPages.length).toBe(2); // owned evidence still assembled
    expect(snap.competitors.length).toBe(0); // no AI citations → no competitors
    expect(snap.aiCitations.rowsScanned).toBe(0);
  });
});

describe("hashSnapshot", () => {
  it("is a stable 16-char hex digest", () => {
    const snap = buildEvidenceSnapshot(fullInput());
    const { evidenceHash: _h, ...rest } = snap;
    void _h;
    expect(snap.evidenceHash).toMatch(/^[0-9a-f]{16}$/);
    expect(hashSnapshot(rest)).toBe(snap.evidenceHash);
  });
});
