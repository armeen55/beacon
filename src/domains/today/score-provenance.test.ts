/**
 * Tests for src/domains/today/score-provenance.ts — Trust Sprint Mini-Phase
 * T3.1 (2026-05-06).
 *
 * The honesty contract: trust labels MUST track the audit findings. Any
 * builder that returns `trustworthy` on a known-directional surface
 * regresses the trust contract.
 */

import { describe, expect, it } from "vitest";
import {
  buildOverallVisibilityProvenance,
  buildMentionsTileProvenance,
  buildCitationsTileProvenance,
  buildPrimaryRateProvenance,
  buildCompetitorLeaderboardProvenance,
  buildPromptCategoryProvenance,
  buildShareCaptureProvenance,
  type ScoreProvenance,
} from "./score-provenance";

const REQUIRED_FIELDS: ReadonlyArray<keyof ScoreProvenance> = [
  "id",
  "label",
  "valueLabel",
  "trustLevel",
  "sourceLabel",
  "operatorDetail",
  "dateWindow",
  "platformRule",
  "numeratorLabel",
  "denominatorLabel",
  "caveats",
  "plainEnglish",
];

function assertCommonShape(p: ScoreProvenance): void {
  for (const field of REQUIRED_FIELDS) {
    expect(p, `${p.id}: missing field ${field}`).toHaveProperty(field);
  }
  expect(p.id).toMatch(/^[a-z][a-z0-9-]*$/);
  expect(p.caveats).toBeInstanceOf(Array);
  expect(typeof p.plainEnglish).toBe("string");
  expect(p.plainEnglish.length).toBeGreaterThan(0);
}

describe("score-provenance: required fields", () => {
  it("buildOverallVisibilityProvenance returns all required fields", () => {
    assertCommonShape(
      buildOverallVisibilityProvenance({
        scorePct: 23.4,
        windowDays: 14,
        windowTouchesPreCutover: false,
        hasPartialDays: false,
        hasProofDays: false,
      }),
    );
  });

  it("buildMentionsTileProvenance returns all required fields", () => {
    assertCommonShape(
      buildMentionsTileProvenance({
        value: 100,
        derivedKpiAvailable: true,
        asOfDate: "2026-05-06",
        isFallback: false,
        samplingStatus: "full",
      }),
    );
  });

  it("buildCitationsTileProvenance returns all required fields", () => {
    assertCommonShape(
      buildCitationsTileProvenance({
        value: 100,
        derivedKpiAvailable: true,
        asOfDate: "2026-05-06",
        isFallback: false,
        samplingStatus: "full",
      }),
    );
  });

  it("buildPrimaryRateProvenance returns all required fields", () => {
    assertCommonShape(
      buildPrimaryRateProvenance({
        platformLabel: "ChatGPT",
        latestRate: 0.42,
        latestDayObsCount: 99,
        windowDays: 14,
        sampleStatus: "enough",
      }),
    );
  });

  it("buildCompetitorLeaderboardProvenance returns all required fields", () => {
    assertCommonShape(
      buildCompetitorLeaderboardProvenance({
        windowDays: 14,
        windowTouchesPreCutover: false,
        rowCount: 5,
      }),
    );
  });

  it("buildPromptCategoryProvenance returns all required fields", () => {
    assertCommonShape(
      buildPromptCategoryProvenance({
        category: "winning",
        count: 3,
        lookbackDays: 7,
      }),
    );
  });

  it("buildShareCaptureProvenance returns all required fields", () => {
    assertCommonShape(buildShareCaptureProvenance({ visible: true }));
  });
});

describe("score-provenance: trust-label honesty contract (audit-anchored)", () => {
  it("composite visibility is NEVER labeled trustworthy (no sampling gate; mixes regimes)", () => {
    for (const cfg of [
      { hasPartialDays: false, hasProofDays: false, windowTouchesPreCutover: false },
      { hasPartialDays: true,  hasProofDays: false, windowTouchesPreCutover: false },
      { hasPartialDays: false, hasProofDays: true,  windowTouchesPreCutover: false },
      { hasPartialDays: false, hasProofDays: false, windowTouchesPreCutover: true  },
    ]) {
      const p = buildOverallVisibilityProvenance({
        scorePct: 50,
        windowDays: 14,
        ...cfg,
      });
      expect(p.trustLevel, JSON.stringify(cfg)).not.toBe("trustworthy");
      expect(p.trustLevel).toBe("directional");
    }
  });

  it("mentions/citations are NEVER labeled trustworthy while fallback risk exists", () => {
    // Both branches: derived-available AND derived-missing-fallback must be directional.
    for (const derivedKpiAvailable of [true, false]) {
      const m = buildMentionsTileProvenance({
        value: 100,
        derivedKpiAvailable,
        asOfDate: "2026-05-06",
        isFallback: false,
        samplingStatus: "full",
      });
      const c = buildCitationsTileProvenance({
        value: 200,
        derivedKpiAvailable,
        asOfDate: "2026-05-06",
        isFallback: false,
        samplingStatus: "full",
      });
      expect(m.trustLevel).toBe("directional");
      expect(c.trustLevel).toBe("directional");
    }
  });

  it("ChatGPT primary % is labeled directional (latest-day rate, not window average)", () => {
    const p = buildPrimaryRateProvenance({
      platformLabel: "ChatGPT",
      latestRate: 0.42,
      latestDayObsCount: 100,
      windowDays: 14,
      sampleStatus: "enough",
    });
    expect(p.trustLevel).toBe("directional");
  });

  it("Perplexity primary % is labeled directional", () => {
    const p = buildPrimaryRateProvenance({
      platformLabel: "Perplexity",
      latestRate: 0.55,
      latestDayObsCount: 100,
      windowDays: 14,
      sampleStatus: "enough",
    });
    expect(p.trustLevel).toBe("directional");
  });

  it("competitor leaderboard is labeled directional (brand vs competitor formula asymmetry)", () => {
    const p = buildCompetitorLeaderboardProvenance({
      windowDays: 14,
      windowTouchesPreCutover: false,
      rowCount: 5,
    });
    expect(p.trustLevel).toBe("directional");
  });

  it("prompt category 'winning' is labeled trustworthy (≥3 obs floor + native regime guard)", () => {
    const p = buildPromptCategoryProvenance({
      category: "winning",
      count: 3,
      lookbackDays: 7,
    });
    expect(p.trustLevel).toBe("trustworthy");
  });

  it("prompt category 'early' is labeled trustworthy", () => {
    const p = buildPromptCategoryProvenance({
      category: "early",
      count: 5,
      lookbackDays: 7,
    });
    expect(p.trustLevel).toBe("trustworthy");
  });

  it("prompt category 'absent', 'close', 'outranked' are directional (no pollution-filter on classifier)", () => {
    for (const category of ["absent", "close", "outranked"] as const) {
      const p = buildPromptCategoryProvenance({
        category,
        count: 5,
        lookbackDays: 7,
      });
      expect(p.trustLevel, category).toBe("directional");
    }
  });

  it("share-capture banner is labeled UNRELIABLE (coincidence detector)", () => {
    const p = buildShareCaptureProvenance({ visible: true });
    expect(p.trustLevel).toBe("unreliable");
  });
});

describe("score-provenance: customer-safe copy invariants", () => {
  it("sourceLabel never contains raw SQL or table names (those live in operatorDetail only)", () => {
    const FORBIDDEN_IN_SOURCE = [
      "prompt_answer_observations",
      "daily_metric_snapshots",
      "recommended_edits",
      "tracked_prompts",
      "tracked_entities",
      "SELECT",
      "FROM ",
      "WHERE ",
      "JOIN ",
      "tenantRepo",
    ];
    const probes: ScoreProvenance[] = [
      buildOverallVisibilityProvenance({
        scorePct: 50,
        windowDays: 14,
        windowTouchesPreCutover: false,
        hasPartialDays: false,
        hasProofDays: false,
      }),
      buildMentionsTileProvenance({
        value: 100,
        derivedKpiAvailable: true,
        asOfDate: "2026-05-06",
        isFallback: false,
        samplingStatus: "full",
      }),
      buildMentionsTileProvenance({
        value: 100,
        derivedKpiAvailable: false, // fallback path — must not leak SQL
        asOfDate: null,
        isFallback: false,
        samplingStatus: null,
      }),
      buildCitationsTileProvenance({
        value: 200,
        derivedKpiAvailable: true,
        asOfDate: "2026-05-06",
        isFallback: false,
        samplingStatus: "full",
      }),
      buildPrimaryRateProvenance({
        platformLabel: "ChatGPT",
        latestRate: 0.42,
        latestDayObsCount: 100,
        windowDays: 14,
        sampleStatus: "enough",
      }),
      buildCompetitorLeaderboardProvenance({
        windowDays: 14,
        windowTouchesPreCutover: false,
        rowCount: 5,
      }),
      buildPromptCategoryProvenance({
        category: "winning",
        count: 3,
        lookbackDays: 7,
      }),
      buildShareCaptureProvenance({ visible: true }),
    ];
    for (const p of probes) {
      for (const forbidden of FORBIDDEN_IN_SOURCE) {
        expect(p.sourceLabel, `${p.id} sourceLabel leaks "${forbidden}"`).not.toContain(forbidden);
        expect(p.label, `${p.id} label leaks "${forbidden}"`).not.toContain(forbidden);
        expect(p.dateWindow, `${p.id} dateWindow leaks "${forbidden}"`).not.toContain(forbidden);
        expect(p.platformRule, `${p.id} platformRule leaks "${forbidden}"`).not.toContain(forbidden);
        expect(p.numeratorLabel, `${p.id} numeratorLabel leaks "${forbidden}"`).not.toContain(forbidden);
        expect(p.denominatorLabel, `${p.id} denominatorLabel leaks "${forbidden}"`).not.toContain(forbidden);
        expect(p.plainEnglish, `${p.id} plainEnglish leaks "${forbidden}"`).not.toContain(forbidden);
        for (const c of p.caveats) {
          expect(c, `${p.id} caveat leaks "${forbidden}"`).not.toContain(forbidden);
        }
      }
    }
  });

  it("operatorDetail intentionally documents file:line + table — that's the debug field", () => {
    // Inverse check: at least ONE customer-facing field must NOT contain table names,
    // AND the operatorDetail is allowed to contain them. This invariant pins the
    // contract that table names live ONLY in operatorDetail.
    const p = buildOverallVisibilityProvenance({
      scorePct: 50,
      windowDays: 14,
      windowTouchesPreCutover: false,
      hasPartialDays: false,
      hasProofDays: false,
    });
    expect(p.operatorDetail).toContain("prompt_answer_observations");
    expect(p.sourceLabel).not.toContain("prompt_answer_observations");
  });

  it("no raw UUIDs in any customer-facing field", () => {
    const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
    const probes: ScoreProvenance[] = [
      buildOverallVisibilityProvenance({
        scorePct: 50,
        windowDays: 14,
        windowTouchesPreCutover: false,
        hasPartialDays: false,
        hasProofDays: false,
      }),
      buildMentionsTileProvenance({
        value: 100,
        derivedKpiAvailable: true,
        asOfDate: "2026-05-06",
        isFallback: false,
        samplingStatus: "full",
      }),
      buildPrimaryRateProvenance({
        platformLabel: "ChatGPT",
        latestRate: 0.42,
        latestDayObsCount: 100,
        windowDays: 14,
        sampleStatus: "enough",
      }),
      buildCompetitorLeaderboardProvenance({
        windowDays: 14,
        windowTouchesPreCutover: false,
        rowCount: 5,
      }),
    ];
    for (const p of probes) {
      const customerFields = [
        p.label,
        p.valueLabel,
        p.sourceLabel,
        p.dateWindow,
        p.platformRule,
        p.numeratorLabel,
        p.denominatorLabel,
        p.plainEnglish,
        ...p.caveats,
      ];
      for (const field of customerFields) {
        expect(field, `${p.id}: UUID leak in "${field}"`).not.toMatch(UUID_PATTERN);
      }
    }
  });
});

describe("score-provenance: caveat surfacing", () => {
  it("partial-day windows surface a caveat about partial coverage", () => {
    const p = buildOverallVisibilityProvenance({
      scorePct: 50,
      windowDays: 14,
      windowTouchesPreCutover: false,
      hasPartialDays: true,
      hasProofDays: false,
    });
    expect(p.caveats.some((c) => c.toLowerCase().includes("partial"))).toBe(true);
  });

  it("pre-cutover windows surface a caveat about historical data", () => {
    const p = buildOverallVisibilityProvenance({
      scorePct: 50,
      windowDays: 30,
      windowTouchesPreCutover: true,
      hasPartialDays: false,
      hasProofDays: false,
    });
    expect(
      p.caveats.some((c) => c.toLowerCase().includes("historical") || c.toLowerCase().includes("cutover") || c.toLowerCase().includes("native")),
    ).toBe(true);
    expect(p.includesImportedData).toBe(true);
  });

  it("primary-rate surfaces a caveat about latest-day-only semantics", () => {
    const p = buildPrimaryRateProvenance({
      platformLabel: "ChatGPT",
      latestRate: 0.5,
      latestDayObsCount: 100,
      windowDays: 14,
      sampleStatus: "enough",
    });
    expect(p.caveats.some((c) => c.toLowerCase().includes("latest"))).toBe(true);
  });

  it("primary-rate with thin sample surfaces a thin-sample caveat", () => {
    const p = buildPrimaryRateProvenance({
      platformLabel: "ChatGPT",
      latestRate: 1.0,
      latestDayObsCount: 1,
      windowDays: 14,
      sampleStatus: "thin",
    });
    expect(p.caveats.some((c) => c.toLowerCase().includes("thin") || c.toLowerCase().includes("volatile"))).toBe(true);
  });

  it("primary-rate with sub-80 latest day surfaces a partial-day caveat", () => {
    const p = buildPrimaryRateProvenance({
      platformLabel: "ChatGPT",
      latestRate: 0.5,
      latestDayObsCount: 99,
      windowDays: 14,
      sampleStatus: "enough",
    });
    expect(p.caveats.some((c) => c.includes("99"))).toBe(true);
  });

  it("competitor leaderboard surfaces the brand-vs-competitor formula asymmetry caveat", () => {
    const p = buildCompetitorLeaderboardProvenance({
      windowDays: 14,
      windowTouchesPreCutover: false,
      rowCount: 5,
    });
    expect(
      p.caveats.some(
        (c) => c.toLowerCase().includes("composite") && c.toLowerCase().includes("flat"),
      ),
    ).toBe(true);
  });

  it("share-capture surfaces the coincidence-not-causal caveat", () => {
    const p = buildShareCaptureProvenance({ visible: true });
    expect(
      p.caveats.some(
        (c) => c.toLowerCase().includes("coincidence") || c.toLowerCase().includes("not"),
      ),
    ).toBe(true);
  });
});

describe("score-provenance: plainEnglish honesty", () => {
  it("directional surfaces include the word 'directional' in plainEnglish", () => {
    const probes = [
      buildOverallVisibilityProvenance({
        scorePct: 50,
        windowDays: 14,
        windowTouchesPreCutover: false,
        hasPartialDays: false,
        hasProofDays: false,
      }),
      buildPrimaryRateProvenance({
        platformLabel: "ChatGPT",
        latestRate: 0.5,
        latestDayObsCount: 100,
        windowDays: 14,
        sampleStatus: "enough",
      }),
      buildCompetitorLeaderboardProvenance({
        windowDays: 14,
        windowTouchesPreCutover: false,
        rowCount: 5,
      }),
    ];
    for (const p of probes) {
      expect(p.trustLevel).toBe("directional");
      expect(p.plainEnglish.toLowerCase()).toContain("directional");
    }
  });

  it("trustworthy surfaces include the word 'trustworthy' in plainEnglish", () => {
    const p = buildPromptCategoryProvenance({
      category: "winning",
      count: 3,
      lookbackDays: 7,
    });
    expect(p.plainEnglish.toLowerCase()).toContain("trustworthy");
  });

  it("unreliable surfaces include 'unreliable' in plainEnglish", () => {
    const p = buildShareCaptureProvenance({ visible: true });
    expect(p.plainEnglish.toLowerCase()).toContain("unreliable");
  });
});
