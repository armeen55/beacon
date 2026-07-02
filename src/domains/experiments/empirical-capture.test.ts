import { describe, expect, it } from "vitest";
import {
  realizedCaptureFraction,
  shrinkTowardMean,
  shrinkFamilyObservations,
  computeCaptureDistribution,
  blendCaptureBand,
  captureBandForFamily,
  MIN_SAMPLES,
  FULL_EMPIRICAL_SAMPLES,
  STATIC_LOW,
  STATIC_HIGH,
  PRECISION_SCALE,
  type CaptureObservation,
} from "./empirical-capture";

describe("realizedCaptureFraction", () => {
  it("divides the realized lift by the targeted gap", () => {
    expect(realizedCaptureFraction(20, 80)).toBe(0.25);
    expect(realizedCaptureFraction(60, 80)).toBe(0.75);
  });

  it("allows a capture above 1 (beat the whole gap) or negative (lost clicks) - never clips", () => {
    expect(realizedCaptureFraction(120, 80)).toBe(1.5);
    expect(realizedCaptureFraction(-10, 80)).toBe(-0.125);
  });

  it("returns null for a non-positive or non-finite gap (nothing to divide by)", () => {
    expect(realizedCaptureFraction(10, 0)).toBeNull();
    expect(realizedCaptureFraction(10, -5)).toBeNull();
    expect(realizedCaptureFraction(10, NaN)).toBeNull();
  });

  it("returns null for a non-finite actual", () => {
    expect(realizedCaptureFraction(NaN, 80)).toBeNull();
  });
});

describe("shrinkTowardMean - winner's-curse shrinkage direction", () => {
  it("pulls a low-impression observation almost fully to the family mean", () => {
    // n=0 -> weight 0 -> shrunk === mean exactly.
    expect(shrinkTowardMean(0.9, 0.3, 0)).toBe(0.3);
  });

  it("keeps a very-high-impression observation close to its own value", () => {
    const huge = PRECISION_SCALE * 999; // weight -> ~0.999
    const shrunk = shrinkTowardMean(0.9, 0.3, huge);
    expect(shrunk).toBeGreaterThan(0.899);
    expect(shrunk).toBeLessThan(0.9);
  });

  it("at n == PRECISION_SCALE, weight is exactly 0.5 (halfway between obs and mean)", () => {
    const shrunk = shrinkTowardMean(1.0, 0.0, PRECISION_SCALE);
    expect(shrunk).toBeCloseTo(0.5, 10);
  });

  it("shrinkage direction: an observation above the mean is always pulled DOWN toward it (never past)", () => {
    const shrunk = shrinkTowardMean(0.9, 0.3, 200);
    expect(shrunk).toBeLessThan(0.9);
    expect(shrunk).toBeGreaterThan(0.3);
  });

  it("shrinkage direction: an observation below the mean is always pulled UP toward it (never past)", () => {
    const shrunk = shrinkTowardMean(0.1, 0.5, 200);
    expect(shrunk).toBeGreaterThan(0.1);
    expect(shrunk).toBeLessThan(0.5);
  });

  it("an observation exactly at the mean is unchanged regardless of impressions", () => {
    expect(shrinkTowardMean(0.5, 0.5, 0)).toBe(0.5);
    expect(shrinkTowardMean(0.5, 0.5, 100000)).toBeCloseTo(0.5, 10);
  });

  it("treats non-finite or negative impressions as zero precision (full shrink)", () => {
    expect(shrinkTowardMean(0.9, 0.3, NaN)).toBe(0.3);
    expect(shrinkTowardMean(0.9, 0.3, -50)).toBe(0.3);
  });
});

describe("shrinkFamilyObservations", () => {
  it("empty input -> empty output", () => {
    expect(shrinkFamilyObservations([])).toEqual([]);
  });

  it("shrinks every observation toward the family's own raw mean", () => {
    const obs: CaptureObservation[] = [
      { actionFamily: "title", capture: 0.1, impressions: 50 },
      { actionFamily: "title", capture: 0.9, impressions: 50 },
    ];
    // raw mean = 0.5; both points get pulled toward 0.5, symmetric weight.
    const shrunk = shrinkFamilyObservations(obs);
    expect(shrunk[0]!.capture).toBeGreaterThan(0.1);
    expect(shrunk[0]!.capture).toBeLessThan(0.5);
    expect(shrunk[1]!.capture).toBeLessThan(0.9);
    expect(shrunk[1]!.capture).toBeGreaterThan(0.5);
    // symmetric inputs shrink symmetrically around the mean.
    expect(shrunk[0]!.capture + shrunk[1]!.capture).toBeCloseTo(1.0, 10);
  });

  it("preserves actionFamily on each shrunk observation", () => {
    const obs: CaptureObservation[] = [{ actionFamily: "answer_block", capture: 0.4, impressions: 10 }];
    expect(shrinkFamilyObservations(obs)[0]!.actionFamily).toBe("answer_block");
  });
});

describe("computeCaptureDistribution", () => {
  it("empty input -> empty map (the no-data identity case)", () => {
    expect(computeCaptureDistribution([]).size).toBe(0);
  });

  it("buckets observations by actionFamily independently", () => {
    const obs: CaptureObservation[] = [
      { actionFamily: "title", capture: 0.2, impressions: 1000 },
      { actionFamily: "title", capture: 0.3, impressions: 1000 },
      { actionFamily: "answer_block", capture: 0.6, impressions: 1000 },
    ];
    const dist = computeCaptureDistribution(obs);
    expect(dist.get("title")!.n).toBe(2);
    expect(dist.get("answer_block")!.n).toBe(1);
  });

  it("a single observation in a family yields p25 == p75 == that (shrunk) value", () => {
    const obs: CaptureObservation[] = [{ actionFamily: "title", capture: 0.5, impressions: 0 }];
    const dist = computeCaptureDistribution(obs);
    const band = dist.get("title")!;
    // n=0 impressions -> full shrink to the family's own mean (itself) -> unchanged.
    expect(band.p25).toBeCloseTo(0.5, 10);
    expect(band.p75).toBeCloseTo(0.5, 10);
    expect(band.n).toBe(1);
  });

  it("p25/p75 spread widens with more varied high-impression (low-shrink) observations", () => {
    const obs: CaptureObservation[] = Array.from({ length: 20 }, (_, i) => ({
      actionFamily: "title",
      capture: 0.1 + (i / 19) * 0.8, // spread 0.1..0.9
      impressions: 100000, // huge -> minimal shrink
    }));
    const band = computeCaptureDistribution(obs).get("title")!;
    expect(band.p75 - band.p25).toBeGreaterThan(0.3);
  });
});

describe("blendCaptureBand - the three-tier blend (item 64 step 3)", () => {
  it("below MIN_SAMPLES: returns the static 25/75 band untouched, regardless of the empirical shape", () => {
    const thin = { actionFamily: "title", p25: 0.05, p75: 0.95, n: MIN_SAMPLES - 1 };
    const result = blendCaptureBand(thin);
    expect(result.low).toBe(STATIC_LOW);
    expect(result.high).toBe(STATIC_HIGH);
    expect(result.isEmpirical).toBe(false);
    expect(result.isFullyEmpirical).toBe(false);
  });

  it("undefined band (no history at all) -> static band, n = 0", () => {
    const result = blendCaptureBand(undefined);
    expect(result).toEqual({ low: STATIC_LOW, high: STATIC_HIGH, n: 0, isEmpirical: false, isFullyEmpirical: false });
  });

  it("at MIN_SAMPLES exactly: blend just starts (t=0), so it still reads as the static band numerically", () => {
    const band = { actionFamily: "title", p25: 0.15, p75: 0.4, n: MIN_SAMPLES };
    const result = blendCaptureBand(band);
    expect(result.low).toBeCloseTo(STATIC_LOW, 10);
    expect(result.high).toBeCloseTo(STATIC_HIGH, 10);
    // but it now COUNTS as empirical (n >= MIN_SAMPLES) even though the numbers haven't moved yet -
    // the prose can still honestly say "across our last 5 tests" once blending has begun.
    expect(result.isEmpirical).toBe(true);
    expect(result.isFullyEmpirical).toBe(false);
  });

  it("midway between MIN_SAMPLES and FULL_EMPIRICAL_SAMPLES: linearly interpolates low and high separately", () => {
    const mid = MIN_SAMPLES + (FULL_EMPIRICAL_SAMPLES - MIN_SAMPLES) / 2; // t = 0.5
    const band = { actionFamily: "title", p25: 0.15, p75: 0.4, n: mid };
    const result = blendCaptureBand(band);
    expect(result.low).toBeCloseTo((STATIC_LOW + 0.15) / 2, 10);
    expect(result.high).toBeCloseTo((STATIC_HIGH + 0.4) / 2, 10);
    expect(result.isEmpirical).toBe(true);
    expect(result.isFullyEmpirical).toBe(false);
  });

  it("at FULL_EMPIRICAL_SAMPLES and above: fully empirical, no static blend left", () => {
    const band = { actionFamily: "title", p25: 0.15, p75: 0.4, n: FULL_EMPIRICAL_SAMPLES };
    const result = blendCaptureBand(band);
    expect(result.low).toBe(0.15);
    expect(result.high).toBe(0.4);
    expect(result.isEmpirical).toBe(true);
    expect(result.isFullyEmpirical).toBe(true);

    const wayPast = blendCaptureBand({ actionFamily: "title", p25: 0.15, p75: 0.4, n: 1000 });
    expect(wayPast.low).toBe(0.15);
    expect(wayPast.high).toBe(0.4);
  });

  it("captureBandForFamily resolves through a distribution map by name, falling back to static for an unknown family", () => {
    const dist = new Map([["title", { actionFamily: "title", p25: 0.15, p75: 0.4, n: FULL_EMPIRICAL_SAMPLES }]]);
    expect(captureBandForFamily(dist, "title")).toEqual({ low: 0.15, high: 0.4, n: FULL_EMPIRICAL_SAMPLES, isEmpirical: true, isFullyEmpirical: true });
    expect(captureBandForFamily(dist, "answer_block")).toEqual({ low: STATIC_LOW, high: STATIC_HIGH, n: 0, isEmpirical: false, isFullyEmpirical: false });
  });
});

describe("overpromise regression case (the whole point of item 64)", () => {
  it("a family whose SETTLED history captured far less than the static 25/75 band pulls future forecasts DOWN, not up", () => {
    // 20 mature title tests, each on a decent-impression page, all capturing a modest 10-20%
    // of their targeted gap - much lower than the hardcoded 25-75% band always assumed.
    const obs: CaptureObservation[] = Array.from({ length: 20 }, (_, i) => ({
      actionFamily: "title",
      capture: 0.1 + (i % 5) * 0.02, // 0.10..0.18
      impressions: 5000,
    }));
    const dist = computeCaptureDistribution(obs);
    const band = blendCaptureBand(dist.get("title"));
    expect(band.isFullyEmpirical).toBe(true);
    // The learned band should sit BELOW the old static band on both ends - forecasts shrink
    // instead of chronically promising a 25-75% capture the ledger says never happens.
    expect(band.low).toBeLessThan(STATIC_LOW);
    expect(band.high).toBeLessThan(STATIC_HIGH);
  });

  it("winner's-curse shrinkage pulls a single lucky high-impression outlier back toward the rest of the family, so one great result cannot alone blow up the forecast", () => {
    // 9 modest, high-confidence results clustered low, plus 1 lucky-looking outlier.
    const modestObs: CaptureObservation[] = Array.from({ length: 9 }, () => ({
      actionFamily: "title",
      capture: 0.15,
      impressions: 8000,
    }));
    const outlier: CaptureObservation = { actionFamily: "title", capture: 1.4, impressions: 50 }; // thin traffic, huge apparent win
    const shrunkAll = shrinkFamilyObservations([...modestObs, outlier]);
    const shrunkOutlier = shrunkAll[shrunkAll.length - 1]!;
    // Even though the raw outlier claimed 140% capture, its thin impression volume means
    // shrinkage pulls it MUCH closer to the family mean than its raw value.
    expect(shrunkOutlier.capture).toBeLessThan(1.4);
    expect(shrunkOutlier.capture).toBeLessThan(0.5); // pulled most of the way back
  });
});
