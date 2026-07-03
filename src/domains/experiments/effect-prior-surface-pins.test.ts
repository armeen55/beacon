/**
 * Effect-size prior + sustainable-control-pool surface/wiring pins
 * (BEACON_500 R5: N15 + N16, 2026-07-03). Mirrors learned-prior-surface-pins.test.ts.
 *
 * Source-level pins: the nightly planner and the worklist demand-graph ranking both
 * consume the SAME bounded [0.8, 1.3] effect-size multiplier
 * (src/domains/learning/effect-size-prior.ts) through the SAME gated ledger loader
 * (load-experiment-outcomes.ts) - never a re-implementation. The pick card shows the
 * magnitude tag when a real bucket fired. The planner receives the last-clean-donor
 * holds; the Results expander renders the pool-health line. No-dash hard rule over
 * every touched surface.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PLANNER = readFileSync(resolve(__dirname, "./daily-experiment-planner.ts"), "utf8");
const PREVIEW = readFileSync(resolve(__dirname, "./build-today-preview.ts"), "utf8");
const PLAN_RECORD = readFileSync(resolve(__dirname, "./build-daily-plan-record.ts"), "utf8");
const TYPES = readFileSync(resolve(__dirname, "./daily-plan-types.ts"), "utf8");
const CARD = readFileSync(resolve(__dirname, "../../app/(shell)/daily-experiments-section.tsx"), "utf8");
const LOAD_GRAPH = readFileSync(resolve(__dirname, "../demand-graph/load-graph.ts"), "utf8");
const RESULTS_PAGE = readFileSync(resolve(__dirname, "../../app/(shell)/results/page.tsx"), "utf8");
const LOADER = readFileSync(resolve(__dirname, "../learning/load-experiment-outcomes.ts"), "utf8");

describe("N15 - the worklist graph applies the effect-size prior at the same post-score seam", () => {
  it("load-graph imports the apply function and the gated loader (never a re-implementation)", () => {
    expect(LOAD_GRAPH).toContain('from "@/domains/learning/effect-size-prior"');
    expect(LOAD_GRAPH).toContain("loadEffectObservations");
    expect(LOAD_GRAPH).toContain("applyEffectSizePriorToMoves(moves, effectObservations");
  });

  it("applies AFTER the win-rate prior, inside its own fail-soft block", () => {
    const winRateIdx = LOAD_GRAPH.indexOf("applyExperimentPriorToMoves(graph.moves");
    const effectIdx = LOAD_GRAPH.indexOf("applyEffectSizePriorToMoves(moves");
    expect(winRateIdx).toBeGreaterThan(-1);
    expect(effectIdx).toBeGreaterThan(winRateIdx);
    const block = LOAD_GRAPH.slice(LOAD_GRAPH.indexOf("R5 / N15 - EFFECT-SIZE REWEIGHT"), effectIdx + 800);
    expect(block).toContain("catch {");
  });
});

describe("N15 - the nightly planner consumes the same prior", () => {
  it("imports the effect-size clamp constants and folds effectFactor into scoreCandidate", () => {
    expect(PLANNER).toContain('from "@/domains/learning/effect-size-prior"');
    expect(PLANNER).toContain("EFFECT_MIN_MULTIPLIER");
    expect(PLANNER).toContain("EFFECT_MAX_MULTIPLIER");
    const idx = PLANNER.indexOf("export function scoreCandidate");
    const body = PLANNER.slice(idx, idx + 2000);
    expect(body).toContain("effectPriorScoreFactor(c.effectPrior)");
    expect(body).toContain("* effectFactor");
  });

  it("build-today-preview resolves the prior from the ALREADY-LOADED ledger before planning", () => {
    expect(PREVIEW).toContain("gateRecordsToEffectObservations(tenantId, ledger)");
    expect(PREVIEW).toContain("computeEffectSizeTable(effectObservations, now)");
    expect(PREVIEW).toContain("c.effectPrior = resolveEffectPrior(");
    const wireIdx = PREVIEW.indexOf("R5 / N15 - THE EFFECT-SIZE PRIOR");
    const planIdx = PREVIEW.indexOf("planDailyExperiments({");
    expect(wireIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeGreaterThan(wireIdx);
  });

  it("the prior survives freezing into the persisted plan record", () => {
    expect(TYPES).toContain('effectPrior?: import("@/domains/learning/effect-size-prior").EffectPrior');
    expect(PLAN_RECORD).toContain("effectPrior: c.effectPrior");
  });
});

describe("N15 - the pick card surfaces the magnitude tag (self-hiding)", () => {
  it("defines EffectSizeTag gated on a real tag string, dash-stripped", () => {
    expect(CARD).toContain("function EffectSizeTag");
    const idx = CARD.indexOf("function EffectSizeTag");
    const block = CARD.slice(idx, idx + 600);
    expect(block).toContain("if (!p || !p.tag) return null");
    expect(block).toContain("stripBannedDashes(p.tag)");
  });

  it("renders on BOTH the preview and the accepted/execution card", () => {
    expect(CARD.split("<EffectSizeTag e={e} />").length - 1).toBe(2);
  });
});

describe("N16 - the planner receives the last-clean-donor holds", () => {
  it("build-today-preview computes holds from the contamination attach and passes them in", () => {
    expect(PREVIEW).toContain("attachControlContaminationForLedger(tenantId, ledger)");
    expect(PREVIEW).toContain("computeLastCleanDonorHolds(ledger, contaminationById)");
    expect(PREVIEW).toContain("lastCleanDonorHolds });");
    const holdIdx = PREVIEW.indexOf("N16 (R5) - THE LAST-CLEAN-DONOR HOLD");
    expect(holdIdx).toBeGreaterThan(-1);
    expect(PREVIEW.slice(holdIdx, holdIdx + 1400)).toContain("catch {");
  });

  it("the planner exposes the last_clean_donor reason with a plain sentence slot", () => {
    expect(PLANNER).toContain('"last_clean_donor"');
    expect(PLANNER).toContain("lastCleanDonorHolds?: LastCleanDonorHoldLookup");
  });
});

describe("N16 - the Results expander renders the pool-health line", () => {
  it("threads poolHealthLine into the presentation and renders it in See the math", () => {
    expect(RESULTS_PAGE).toContain("controlPoolHealthLine: contaminationById.get(l.id)?.poolHealthLine ?? null");
    expect(RESULTS_PAGE).toContain("pres?.controlPoolHealthLine ? <p>{pres.controlPoolHealthLine}</p> : null");
  });
});

describe("no em or en dashes in any touched wiring block", () => {
  it("keeps the new blocks dash-clean", () => {
    for (const [source, marker] of [
      [PREVIEW, "R5 / N15 - THE EFFECT-SIZE PRIOR"],
      [PREVIEW, "N16 (R5) - THE LAST-CLEAN-DONOR HOLD"],
      [PLANNER, "N16 (R5) - SUSTAINABLE CONTROL POOL"],
      [LOADER, "R5 / N15 (2026-07-03) - map explicit ledger rows"],
    ] as const) {
      const idx = source.indexOf(marker);
      expect(idx).toBeGreaterThan(-1);
      expect(source.slice(idx, idx + 1600)).not.toMatch(/[–—]/);
    }
  });
});
