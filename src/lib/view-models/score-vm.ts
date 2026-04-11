/**
 * Beacon Score View Model — transforms score computation into chart-ready props.
 */

import type { ScoreViewProps, ScoreDimensionProps } from "@/components/viz/chart-types";
import type { BeaconScoreResult } from "@/domains/product/beacon-score-types";

export function scoreView(result: BeaconScoreResult): ScoreViewProps {
  return {
    dimensions: result.dimensions.map((d) => ({
      label: d.label,
      value: d.value,
      max: d.max,
      status: d.status,
    })),
    composite: result.composite,
    compositeStatus: result.composite_status,
  };
}

export function scoreDimensions(result: BeaconScoreResult): ScoreDimensionProps[] {
  return result.dimensions.map((d) => ({
    label: d.label,
    value: d.value,
    max: d.max,
    status: d.status,
  }));
}
