/**
 * Synthetic-lift injection for the FNR/MDE suite (protocol Section 3).
 * Multiplicative lifts applied to POST window daily rows only, at the daily
 * level so weekday pattern and autocorrelation are preserved. The tapered
 * variant ramps the lift linearly over the first 7 post days (recrawl and
 * reindex lag). Clicks lane scales clicks; CTR lane scales clicks holding
 * impressions fixed (CTR moves by construction). Clicks never exceed
 * impressions and never go below zero.
 */

import type { WindowAgg } from "./types";

export type InjectionVariant = "instant" | "tapered";

export function injectedDailyClicks(args: {
  clicks: ReadonlyArray<number>;
  impressions: ReadonlyArray<number>;
  /** Multiplicative lift, e.g. 0.2 for +20 percent, -0.2 for -20 percent. */
  delta: number;
  variant: InjectionVariant;
}): number[] {
  return args.clicks.map((c, i) => {
    const ramp = args.variant === "tapered" ? Math.min(1, (i + 1) / 7) : 1;
    let v = Math.round(c * (1 + args.delta * ramp));
    if (v < 0) v = 0;
    const impr = args.impressions[i] ?? 0;
    if (impr > 0 && v > impr) v = impr;
    return v;
  });
}

/** Post-window aggregate from injected dailies (impressions unchanged). */
export function injectedPostAgg(args: {
  clicks: ReadonlyArray<number>;
  impressions: ReadonlyArray<number>;
  delta: number;
  variant: InjectionVariant;
  windowDays: number;
}): WindowAgg {
  const injected = injectedDailyClicks(args);
  const clicks = injected.reduce((s, c) => s + c, 0);
  const impressions = args.impressions.reduce((s, x) => s + x, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: 0,
    daysCovered: injected.length,
    windowDays: args.windowDays,
  };
}
