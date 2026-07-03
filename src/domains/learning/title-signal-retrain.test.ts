/**
 * title-signal-retrain (R9 / P3) - pins the retrain clamp and the thin-data
 * self-neutralization: without >= 3 settled title tests (overall AND per signal)
 * the scorer's weights are provably byte-identical to the untouched defaults.
 */
import { describe, expect, it } from "vitest";

import {
  MIN_TILT_SAMPLES,
  TILT_MAX_MULTIPLIER,
  TILT_MIN_MULTIPLIER,
  computeTitleSignalTilts,
  retrainedTitleWeights,
  type TitleSignalObservation,
} from "./title-signal-retrain";
import {
  BASE_TITLE_SIGNAL_WEIGHTS,
  buildTitleVariants,
  scoreTitle,
} from "@/domains/demand-graph/ctr-title-scorer";

const NOW = new Date("2026-07-03T00:00:00Z");
const SETTLED = "2026-07-01T00:00:00.000Z"; // fresh: recency weight ~1

function obs(signals: string[], relativeLift: number, settledAt = SETTLED): TitleSignalObservation {
  return { signals, relativeLift, settledAt };
}

describe("thin-data pin - the retrain self-neutralizes without real evidence", () => {
  it(`under ${MIN_TILT_SAMPLES} settled tests overall = no tilts at all`, () => {
    expect(computeTitleSignalTilts([], NOW)).toEqual({});
    expect(computeTitleSignalTilts([obs(["number"], 0.8), obs(["number"], 0.9)], NOW)).toEqual({});
  });

  it(`a signal carried by fewer than ${MIN_TILT_SAMPLES} tests stays neutral even when the ledger is deep`, () => {
    const observations = [
      obs(["number"], 0.9),
      obs(["number"], 0.8),
      obs([], 0.1),
      obs([], 0),
      obs([], -0.1),
    ];
    const tilts = computeTitleSignalTilts(observations, NOW);
    expect(tilts.number).toBeUndefined(); // only 2 carriers
  });

  it("empty tilts return the base weights object ITSELF - the scorer is byte-identical", () => {
    const weights = retrainedTitleWeights({});
    expect(weights).toBe(BASE_TITLE_SIGNAL_WEIGHTS);
    const title = "10 Best Persian Cat Names (With Meanings)";
    expect(scoreTitle(title, "persian cat names", "Iranopedia", weights)).toEqual(
      scoreTitle(title, "persian cat names", "Iranopedia"),
    );
    expect(buildTitleVariants("persian cat names", "Iranopedia", undefined, weights)).toEqual(
      buildTitleVariants("persian cat names", "Iranopedia"),
    );
  });

  it("non-retrainable signals (full-query, too-long) never produce a tilt", () => {
    const observations = [
      obs(["full-query"], 0.9),
      obs(["full-query"], 0.9),
      obs(["full-query"], 0.9),
      obs(["too-long"], -0.9),
      obs(["too-long"], -0.9),
      obs(["too-long"], -0.9),
    ];
    expect(computeTitleSignalTilts(observations, NOW)).toEqual({});
  });
});

describe("direction - the tenant's own wins tilt the weights the right way", () => {
  it("number-led titles that keep winning HERE earn the number cue more weight", () => {
    const observations = [
      obs(["number"], 0.6),
      obs(["number"], 0.5),
      obs(["number"], 0.7),
      obs([], 0),
      obs([], -0.05),
      obs([], 0.05),
    ];
    const tilts = computeTitleSignalTilts(observations, NOW);
    expect(tilts.number).toBeGreaterThan(1);
    const weights = retrainedTitleWeights(tilts);
    expect(weights.number).toBeGreaterThan(BASE_TITLE_SIGNAL_WEIGHTS.number);
    // untouched signals stay exactly at base
    expect(weights.brand).toBe(BASE_TITLE_SIGNAL_WEIGHTS.brand);
    expect(weights.lengthSweet).toBe(BASE_TITLE_SIGNAL_WEIGHTS.lengthSweet);
  });

  it("a losing signal loses weight (bounded)", () => {
    const observations = [
      obs(["power-word"], -0.5),
      obs(["power-word"], -0.6),
      obs(["power-word"], -0.4),
      obs([], 0.2),
      obs([], 0.3),
      obs([], 0.25),
    ];
    const tilts = computeTitleSignalTilts(observations, NOW);
    expect(tilts.powerWord).toBeLessThan(1);
    expect(tilts.powerWord).toBeGreaterThanOrEqual(TILT_MIN_MULTIPLIER);
    const weights = retrainedTitleWeights(tilts);
    expect(weights.powerWord).toBeLessThan(BASE_TITLE_SIGNAL_WEIGHTS.powerWord);
    expect(weights.powerWord).toBeGreaterThanOrEqual(BASE_TITLE_SIGNAL_WEIGHTS.powerWord * TILT_MIN_MULTIPLIER);
  });
});

describe("clamp - a tilt influences, never rewrites the scorer", () => {
  it(`extreme lifts clamp every multiplier to [${TILT_MIN_MULTIPLIER}, ${TILT_MAX_MULTIPLIER}]`, () => {
    const winners = Array.from({ length: 10 }, () => obs(["number"], 1));
    const losers = Array.from({ length: 10 }, () => obs(["brand"], -1));
    const tilts = computeTitleSignalTilts([...winners, ...losers], NOW);
    for (const m of Object.values(tilts)) {
      expect(m).toBeGreaterThanOrEqual(TILT_MIN_MULTIPLIER);
      expect(m).toBeLessThanOrEqual(TILT_MAX_MULTIPLIER);
    }
    const weights = retrainedTitleWeights(tilts);
    expect(weights.number).toBeLessThanOrEqual(BASE_TITLE_SIGNAL_WEIGHTS.number * TILT_MAX_MULTIPLIER);
    expect(weights.brand).toBeGreaterThanOrEqual(BASE_TITLE_SIGNAL_WEIGHTS.brand * TILT_MIN_MULTIPLIER);
  });

  it("retrainedTitleWeights defensively re-clamps a caller-supplied out-of-band tilt", () => {
    const weights = retrainedTitleWeights({ number: 99, brand: 0.01 });
    expect(weights.number).toBe(Math.round(BASE_TITLE_SIGNAL_WEIGHTS.number * TILT_MAX_MULTIPLIER * 100) / 100);
    expect(weights.brand).toBe(Math.round(BASE_TITLE_SIGNAL_WEIGHTS.brand * TILT_MIN_MULTIPLIER * 100) / 100);
  });

  it("a retrained scorer still ranks by real signals - the tilt shifts scores boundedly", () => {
    const tilted = retrainedTitleWeights({ number: TILT_MAX_MULTIPLIER });
    const query = "persian cat names";
    const withNumber = "10 Persian Cat Names";
    const base = scoreTitle(withNumber, query, "");
    const retrained = scoreTitle(withNumber, query, "", tilted);
    // exactly the weight delta, nothing else moved
    expect(retrained.score - base.score).toBeCloseTo(tilted.number - BASE_TITLE_SIGNAL_WEIGHTS.number, 10);
    expect(retrained.signals).toEqual(base.signals);
  });
});
