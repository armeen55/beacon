/**
 * Results copy invariants - merged suite (Core 100K Phase 6).
 * Absorbs: proof-plain-vocabulary (C1-C4), proof-jargon-guard (item 69),
 * proof-summary-dollar-sentence (item 22 / E-38 won-dollar rule).
 *
 * Pins:
 *   - the six-word verdict vocabulary (Waiting / Leaning good / Leaning bad /
 *     Helped / Did not help / No clear change) and the plain primary line;
 *   - the source-level jargon guard: no lab word (baseline, treatment,
 *     reservation, experiment, control) or em/en dash in any operator-visible
 *     string on the /results surface;
 *   - the WON-DOLLAR RULE: a dollar clause renders only for real wins with a
 *     positive dollar value AND connected real revenue.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  proofBadgeLabel,
  proofBadgeMaturesOn,
} from "@/app/(shell)/results/proof-badge";
import { plainSearchHeadline } from "@/app/(shell)/results/proof-plain-search-line";
import { buildZeroMatureLeadSentence, buildProofHonestySentence } from "@/app/(shell)/results/proof-summary-section";
import type { MeasurementPresentation } from "@/domains/proof-gsc/measurement-maturity";

function pres(overrides: Partial<MeasurementPresentation>): MeasurementPresentation {
  return {
    maturity: "collecting",
    direction: "unknown",
    verdict: null,
    confidence: "low",
    headline: "",
    explanation: "",
    nextCheckpoint: null,
    requiredDataThrough: null,
    availableDataThrough: null,
    evidenceStrength: "tracking",
    attributionQuality: "clean",
    learningEligibility: false,
    basisDay: null,
    tone: "waiting",
    weatherCaveat: null,
    weatherQuarantined: false,
    weakComparisonCaveat: null,
    weakComparisonFlagged: false,
    seasonalInflectionCaveat: null,
    seasonalInflectionFlagged: false,
    recrawlPending: false,
    recrawlPendingCaveat: null,
    controlContaminationFlagged: false,
    controlContaminationCaveat: null,
    controlPoolHealthLine: null,
    ...overrides,
  };
}

describe("proofBadgeLabel - the six-word verdict vocabulary (C2)", () => {
  it("pre-verdict states read Waiting; checkpoints lean; mature results use exactly three final words", () => {
    expect(proofBadgeLabel(pres({ maturity: "scheduled" }))).toBe("Waiting");
    expect(proofBadgeLabel(pres({ maturity: "collecting" }))).toBe("Waiting");
    expect(proofBadgeLabel(pres({ maturity: "blocked_data" }))).toBe("Waiting");
    expect(proofBadgeLabel(pres({ maturity: "early_checkpoint", direction: "positive" }))).toBe("Leaning good");
    expect(proofBadgeLabel(pres({ maturity: "interim_checkpoint", direction: "negative" }))).toBe("Leaning bad");
    expect(proofBadgeLabel(pres({ maturity: "attribution_limited", direction: "positive" }))).toBe("Leaning good");
    expect(proofBadgeLabel(pres({ maturity: "mature_result", verdict: "helped" }))).toBe("Helped");
    expect(proofBadgeLabel(pres({ maturity: "mature_result", verdict: "did_not_help" }))).toBe("Did not help");
    expect(proofBadgeLabel(pres({ maturity: "mature_result", verdict: "no_lift" }))).toBe("No clear change");
    expect(proofBadgeLabel(pres({ maturity: "inconclusive" }))).toBe("No clear change");
  });

  it("the matures-on date shows before a verdict, never after", () => {
    expect(proofBadgeMaturesOn(pres({ maturity: "collecting", nextCheckpoint: "2026-07-10" }))).toBe("matures 2026-07-10");
    expect(proofBadgeMaturesOn(pres({ maturity: "mature_result", nextCheckpoint: null }))).toBeNull();
    expect(proofBadgeMaturesOn(pres({ maturity: "inconclusive", nextCheckpoint: "2026-07-10" }))).toBeNull();
  });
});

describe("plainSearchHeadline - plain primary line (C4)", () => {
  it("mature results read as a plain final call; pre-mature reads as a lean", () => {
    expect(plainSearchHeadline("positive", true)).toBe("This helped.");
    expect(plainSearchHeadline("negative", true)).toBe("This did not help.");
    expect(plainSearchHeadline("neutral", true)).toBe("No clear change.");
    expect(plainSearchHeadline("positive", false)).toBe("This is probably helping.");
    expect(plainSearchHeadline("negative", false)).toBe("This is probably hurting.");
    expect(plainSearchHeadline("unknown", false)).toBe("Not clear yet.");
  });
});

describe("buildZeroMatureLeadSentence - honest lead (C1)", () => {
  it("states the real count and soonest due date; handles unknown dates without inventing one", () => {
    expect(buildZeroMatureLeadSentence({ totalTracked: 25, matureTotal: 0, soonestLabel: "Saturday" })).toBe(
      "None of your 25 changes has a 28-day read yet. The first ones are due Saturday. Early signals below can still flip.",
    );
    expect(buildZeroMatureLeadSentence({ totalTracked: 3, matureTotal: 0, soonestLabel: null })).toBe(
      "None of your 3 changes has a 28-day read yet. Early signals below can still flip.",
    );
  });

  it("returns null once a mature result exists or with zero tracked changes", () => {
    expect(buildZeroMatureLeadSentence({ totalTracked: 10, matureTotal: 2, soonestLabel: "Friday" })).toBeNull();
    expect(buildZeroMatureLeadSentence({ totalTracked: 0, matureTotal: 0, soonestLabel: null })).toBeNull();
  });

  it("never calls a 28-day read final and never emits a dash (E-39 P1-1)", () => {
    const s = buildZeroMatureLeadSentence({ totalTracked: 25, matureTotal: 0, soonestLabel: "Saturday" })!;
    expect(s).not.toMatch(/\bfinal\b/i);
    expect(s).not.toMatch(/[–—]/);
  });
});

describe("buildProofHonestySentence - the won-dollar rule (item 22 / E-38)", () => {
  it("appends the dollar clause only for a real win with a positive value AND connected real revenue", () => {
    expect(
      buildProofHonestySentence({
        counts: { measuring: 1, helped: 2, noLift: 0, didNotHelp: 0 },
        winsDollarUsdPerMonth: 340,
        winsWithDollarCount: 1,
        soonestLabel: null,
        hasRealRevenue: true,
      }),
    ).toBe("1 measuring, 2 wins, worth about $340 a month at your rates.");
  });

  it("NEVER shows a dollar without real revenue connected, without a dollar-valued win, or on a non-positive sum", () => {
    const noRevenue = buildProofHonestySentence({
      counts: { measuring: 1, helped: 2, noLift: 0, didNotHelp: 0 },
      winsDollarUsdPerMonth: 340,
      winsWithDollarCount: 1,
      soonestLabel: null,
      hasRealRevenue: false,
    });
    expect(noRevenue).toBe("1 measuring, 2 wins.");
    const noWins = buildProofHonestySentence({
      counts: { measuring: 3, helped: 0, noLift: 1, didNotHelp: 0 },
      winsDollarUsdPerMonth: 50,
      winsWithDollarCount: 0,
      soonestLabel: null,
      hasRealRevenue: true,
    });
    expect(noWins).not.toMatch(/\$/);
    const negative = buildProofHonestySentence({
      counts: { measuring: 0, helped: 1, noLift: 0, didNotHelp: 0 },
      winsDollarUsdPerMonth: -20,
      winsWithDollarCount: 1,
      soonestLabel: null,
      hasRealRevenue: true,
    });
    expect(negative).not.toMatch(/\$/);
  });

  it("keeps the next-verdicts clause after the dollar clause, returns null with nothing to report, no dashes", () => {
    expect(
      buildProofHonestySentence({
        counts: { measuring: 2, helped: 1, noLift: 0, didNotHelp: 0 },
        winsDollarUsdPerMonth: 120,
        winsWithDollarCount: 1,
        soonestLabel: "Tuesday",
        hasRealRevenue: true,
      }),
    ).toBe("2 measuring, 1 win, worth about $120 a month at your rates, next verdicts Tuesday.");
    expect(
      buildProofHonestySentence({
        counts: { measuring: 0, helped: 0, noLift: 0, didNotHelp: 0 },
        winsDollarUsdPerMonth: 0,
        winsWithDollarCount: 0,
        soonestLabel: null,
        hasRealRevenue: false,
      }),
    ).toBeNull();
  });
});

/**
 * Source-level jargon guard (item 69): no operator-visible string on the /results
 * surface leaks a lab word or an em/en dash. Heuristic extraction, not a parser.
 */
const RESULTS_DIR = resolve(process.cwd(), "src/app/(shell)/results");

const FILES = [
  "page.tsx",
  "proof-ledger-client.tsx",
  "proof-summary-section.tsx",
  "forecast-calibration-section.tsx",
  "../../../domains/experiments/forecast-receipts.ts",
  "../changes/changes-v2-client.tsx",
] as const;

const BANNED_WORDS = [/\bbaselines?\b/i, /\btreatments?\b/i, /\breservations?\b/i, /\bexperiments?\b/i, /\bcontrols?\b/i];
const BANNED_DASHES = /[–—]/;

function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  return noBlocks
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/\s.*$/, "$1"))
    .join("\n");
}

function stripImportExportLines(src: string): string {
  return src
    .split("\n")
    .map((line) => (/^\s*(import|export)\b.*\bfrom\b/.test(line) ? "" : line))
    .join("\n");
}

function extractStringLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  for (const m of src.matchAll(re)) {
    const body = m[1] ?? m[2] ?? m[3] ?? "";
    out.push(body.replace(/\$\{[^}]*\}/g, " "));
  }
  return out;
}

function extractJsxText(src: string): string[] {
  const out: string[] = [];
  for (const rawLine of src.split("\n")) {
    for (const m of rawLine.matchAll(/>([^<>]+)</g)) {
      out.push(m[1]!.replace(/\{[^{}]*\}/g, " "));
    }
    const line = rawLine.trim().replace(/\{[^{}]*\}/g, " ");
    const looksLikeProse =
      /[A-Za-z]{3}/.test(line) &&
      !/[<>{}=]/.test(line) &&
      !/[;,(]\s*$/.test(line) &&
      !/[\w)\]]\??\.[A-Za-z_$]/.test(line) &&
      !/^(import|export|const|let|var|return|function|if|else|for|while|switch|case|type|interface|async|await|break|continue|throw|new)\b/.test(
        line,
      );
    if (looksLikeProse) out.push(line);
  }
  return out;
}

function visibleSegmentsOf(file: string): string[] {
  const src = stripComments(readFileSync(resolve(RESULTS_DIR, file), "utf8"));
  return [...extractStringLiterals(stripImportExportLines(src)), ...extractJsxText(src)];
}

describe("proof surface - plain business language guard (item 69)", () => {
  for (const file of FILES) {
    it(`${file}: no lab jargon and no em/en dash in any visible segment`, () => {
      for (const seg of visibleSegmentsOf(file)) {
        expect(seg, `"${seg}" in ${file} contains an em or en dash`).not.toMatch(BANNED_DASHES);
        for (const word of BANNED_WORDS) {
          expect(seg, `"${seg}" in ${file} matches banned word ${word}`).not.toMatch(word);
        }
      }
    });
  }

  it("extraction heuristic still sees real page text (self-check against vacuous passes)", () => {
    const joined = visibleSegmentsOf("page.tsx").join("\n");
    expect(joined).toContain("Measured outcomes");
    expect(joined).toContain("What we learned");
    expect(joined).toContain("comparison page");
    expect(visibleSegmentsOf("proof-summary-section.tsx").join("\n")).toContain("Proof at a glance");
  });
});
