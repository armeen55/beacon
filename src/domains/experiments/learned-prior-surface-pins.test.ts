/**
 * Learned-prior surface + wiring pins (2026-07-02, master plan item 47).
 *
 * Source-level pins: the nightly planner's scoreCandidate now folds in the SAME bounded
 * [0.85, 1.15] multiplier the worklist's demand-graph ranking already applies
 * (src/domains/learning/experiment-prior.ts), loaded via loadExperimentOutcomes (decided-only,
 * maturity/weather/parallel-trends gated) - never a re-implementation of that gating. The pick
 * card shows the learnedPrior tag when one exists. Also the no-dash hard rule over every
 * touched surface.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PLANNER = readFileSync(resolve(__dirname, "./daily-experiment-planner.ts"), "utf8");
const PREVIEW = readFileSync(resolve(__dirname, "./build-today-preview.ts"), "utf8");
const PLAN_RECORD = readFileSync(resolve(__dirname, "./build-daily-plan-record.ts"), "utf8");
const CARD = readFileSync(resolve(__dirname, "../../app/(shell)/daily-experiments-section.tsx"), "utf8");
const TYPES = readFileSync(resolve(__dirname, "./daily-plan-types.ts"), "utf8");

describe("daily-experiment-planner.ts - the prior is a real, bounded score factor", () => {
  it("imports the SAME bounded multiplier constants the worklist ranking uses (no re-derivation)", () => {
    expect(PLANNER).toContain('from "@/domains/learning/experiment-prior"');
    expect(PLANNER).toContain("MIN_MULTIPLIER");
    expect(PLANNER).toContain("MAX_MULTIPLIER");
  });

  it("scoreCandidate multiplies in the learned-prior factor alongside the team/power factors", () => {
    const idx = PLANNER.indexOf("export function scoreCandidate");
    const body = PLANNER.slice(idx, idx + 1500);
    expect(body).toContain("learnedPriorScoreFactor(c.learnedPrior)");
    expect(body).toContain("teamFactor");
    expect(body).toContain("powerFactor");
    expect(body).toContain("priorFactor");
  });

  it("defensively clamps the factor to the bounded band", () => {
    expect(PLANNER).toContain("Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, prior.multiplier))");
  });
});

describe("build-today-preview.ts - loads outcomes exactly like the worklist does", () => {
  it("reuses loadExperimentOutcomes (the decided-only, maturity-gated loader), never a fresh query", () => {
    expect(PREVIEW).toContain('from "@/domains/learning/load-experiment-outcomes"');
    expect(PREVIEW).toContain("loadExperimentOutcomes(tenantId)");
  });

  it("resolves the SAME dimension keys (actionType/pageType/queryCluster) the worklist graph uses", () => {
    expect(PREVIEW).toContain("computeDimPriors(outcomes)");
    expect(PREVIEW).toContain("resolvePrior(");
    expect(PREVIEW).toContain("canonicalMoveType(c.actionFamily)");
    expect(PREVIEW).toContain("pageTypeFromUrl(c.url)");
    expect(PREVIEW).toContain("queryClusterKey(c.targetQuery)");
  });

  it("attaches learnedPrior additively, never blocking the plan on a learning-layer failure", () => {
    const idx = PREVIEW.indexOf("Item 47 - WIRE THE LEARNED PRIORS");
    expect(idx).toBeGreaterThan(-1);
    const block = PREVIEW.slice(idx, idx + 1600);
    expect(block).toContain("c.learnedPrior = resolvePrior(");
    expect(block).toContain("catch {");
  });

  it("runs before the planner call, so scoreCandidate sees the prior on every candidate", () => {
    const wireIdx = PREVIEW.indexOf("Item 47 - WIRE THE LEARNED PRIORS");
    const planIdx = PREVIEW.indexOf("planDailyExperiments({");
    expect(wireIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeGreaterThan(wireIdx);
  });

  it("contains no em or en dashes in the item-47 wiring block", () => {
    const start = PREVIEW.indexOf("Item 47 - WIRE THE LEARNED PRIORS");
    const end = PREVIEW.indexOf("never let the learning layer block", start) + 80;
    expect(PREVIEW.slice(start, end)).not.toMatch(/[–—]/);
  });
});

describe("plan record + types - the prior survives freezing into the persisted plan", () => {
  it("daily-plan-types.ts carries learnedPrior on the frozen PlannedExperimentRecord", () => {
    expect(TYPES).toContain("learnedPrior?: import(\"@/domains/learning/experiment-prior\").LearnedPrior");
  });

  it("build-daily-plan-record.ts threads it through from the candidate", () => {
    expect(PLAN_RECORD).toContain("learnedPrior: c.learnedPrior");
  });
});

describe("daily card - the learnedPrior tag renders on the pick card itself", () => {
  it("defines a dedicated tag component gated on a real tag string", () => {
    expect(CARD).toContain("function LearnedPriorTag");
    expect(CARD).toContain("if (!p || !p.tag) return null");
  });

  it("is rendered on BOTH the preview and the accepted/execution card", () => {
    const occurrences = CARD.split("<LearnedPriorTag e={e} />").length - 1;
    expect(occurrences).toBe(2);
  });

  it("runs the tag through the shared dash-stripper before render", () => {
    const idx = CARD.indexOf("function LearnedPriorTag");
    const block = CARD.slice(idx, idx + 500);
    expect(block).toContain("stripBannedDashes(p.tag)");
  });
});
