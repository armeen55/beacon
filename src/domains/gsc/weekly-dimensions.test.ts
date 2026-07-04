import { describe, it, expect } from "vitest";

import {
  APPEARANCE_MEANINGFUL_SHARE,
  APPEARANCE_MIN_TOTAL_IMPRESSIONS,
  COUNTRY_MIN_WEEKLY_CLICKS,
  appearanceShareOf,
  buildAppearanceDropLine,
  buildAppearanceLine,
  buildCountryLine,
  buildDeviceLine,
  buildWeeklyLens,
  deviceCtrGapSignalOf,
  plainAppearanceLabel,
  plainCountryLabel,
  shouldPullWeeklyDimensions,
  type GscWeeklyDimensionsSnapshot,
} from "./weekly-dimensions";

const BANNED_DASH = /[‒–—―]/;

const snap = (over: Partial<GscWeeklyDimensionsSnapshot> = {}): GscWeeklyDimensionsSnapshot => ({
  tenant_id: "tenant-a",
  property: "https://example.com/",
  weekStart: "2026-06-24",
  weekEnd: "2026-06-30",
  pulledAt: "2026-07-01T08:00:00.000Z",
  appearance: [
    { kind: "TPF_FAQ", clicks: 40, impressions: 1500 },
    { kind: "REVIEW_SNIPPET", clicks: 10, impressions: 500 },
  ],
  devices: [
    { device: "MOBILE", clicks: 140, impressions: 7000, position: 8.2 },
    { device: "DESKTOP", clicks: 100, impressions: 2500, position: 7.9 },
    { device: "TABLET", clicks: 10, impressions: 500, position: 8.5 },
  ],
  countries: [
    { code: "usa", clicks: 195, impressions: 7800 },
    { code: "irn", clicks: 27, impressions: 1400 },
    { code: "can", clicks: 15, impressions: 600 },
  ],
  ...over,
});

describe("shouldPullWeeklyDimensions (the weekly cadence rule)", () => {
  it("pulls when no snapshot exists yet", () => {
    expect(shouldPullWeeklyDimensions(null, "2026-06-30")).toBe(true);
  });

  it("skips inside the week, pulls at exactly 7 days", () => {
    expect(shouldPullWeeklyDimensions("2026-06-30", "2026-07-01")).toBe(false);
    expect(shouldPullWeeklyDimensions("2026-06-30", "2026-07-06")).toBe(false);
    expect(shouldPullWeeklyDimensions("2026-06-30", "2026-07-07")).toBe(true);
    expect(shouldPullWeeklyDimensions("2026-06-30", "2026-07-20")).toBe(true);
  });

  it("an unparseable stored date fails open (pull again, never wedge)", () => {
    expect(shouldPullWeeklyDimensions("not-a-date", "2026-07-01")).toBe(true);
  });
});

describe("plainAppearanceLabel (never a raw Google key on a surface)", () => {
  it("maps known kinds to plain words", () => {
    expect(plainAppearanceLabel("TPF_FAQ")).toBe("FAQ answers");
    expect(plainAppearanceLabel("REVIEW_SNIPPET")).toBe("review stars");
    expect(plainAppearanceLabel("RECIPE_FEATURE")).toBe("recipe cards");
  });

  it("unknown / future keys collapse to a generic phrase, never the key", () => {
    const label = plainAppearanceLabel("SOME_FUTURE_KEY");
    expect(label).toBe("special result styling");
    expect(label).not.toMatch(/[A-Z_]{4,}/);
  });
});

describe("appearanceShareOf + buildAppearanceLine", () => {
  it("share = styled impressions over the device total, and the line speaks in 1-in-N", () => {
    const s = snap();
    // styled 2000 / total 10000 = 0.2 -> "About 1 in 5"
    expect(appearanceShareOf(s)).toBeCloseTo(0.2, 5);
    const line = buildAppearanceLine(s)!;
    expect(line).toContain("About 1 in 5 of your Google appearances show with extra styling");
    expect(line).toContain("FAQ answers");
    expect(line).toContain("review stars");
    expect(line).not.toMatch(/searchAppearance|TPF_FAQ|REVIEW_SNIPPET/);
    expect(BANNED_DASH.test(line)).toBe(false);
  });

  it("stays silent below the meaningful-share floor", () => {
    const s = snap({ appearance: [{ kind: "TPF_FAQ", clicks: 1, impressions: 300 }] });
    // 300 / 10000 = 3 percent, under the 10 percent floor.
    expect(appearanceShareOf(s)).toBeLessThan(APPEARANCE_MEANINGFUL_SHARE);
    expect(buildAppearanceLine(s)).toBeNull();
  });

  it("stays silent when total appearances are under the volume floor", () => {
    const s = snap({
      devices: [{ device: "MOBILE", clicks: 5, impressions: APPEARANCE_MIN_TOTAL_IMPRESSIONS - 1, position: 5 }],
      appearance: [{ kind: "TPF_FAQ", clicks: 2, impressions: 200 }],
    });
    expect(appearanceShareOf(s)).toBeNull();
    expect(buildAppearanceLine(s)).toBeNull();
  });

  it("share clamps to 1 when styling kinds overlap on the same results", () => {
    const s = snap({
      appearance: [
        { kind: "TPF_FAQ", clicks: 40, impressions: 9000 },
        { kind: "REVIEW_SNIPPET", clicks: 10, impressions: 8000 },
      ],
    });
    expect(appearanceShareOf(s)).toBe(1);
  });
});

describe("buildAppearanceDropLine (the quiet styling-regression smell)", () => {
  const prior = snap({ weekStart: "2026-06-17", weekEnd: "2026-06-23" }); // share 0.2

  it("fires when the share falls to under 60 percent of last week's", () => {
    const current = snap({
      appearance: [{ kind: "TPF_FAQ", clicks: 10, impressions: 900 }], // 9 percent
    });
    const line = buildAppearanceDropLine(current, prior)!;
    expect(line).toContain("9 percent of your Google appearances this week");
    expect(line).toContain("down from 20 percent last week");
    expect(line).toContain("Google stopped reading some of your page styling");
    expect(BANNED_DASH.test(line)).toBe(false);
  });

  it("stays quiet on a hold or a small dip (12 percent vs 20 is not a 40 percent fall... it is, so use 13)", () => {
    // 0.2 * 0.6 = 0.12: exactly at the boundary must NOT fire (>= keeps quiet).
    const atBoundary = snap({ appearance: [{ kind: "TPF_FAQ", clicks: 10, impressions: 1200 }] });
    expect(buildAppearanceDropLine(atBoundary, prior)).toBeNull();
    // Just under the boundary fires.
    const justUnder = snap({ appearance: [{ kind: "TPF_FAQ", clicks: 10, impressions: 1150 }] });
    expect(buildAppearanceDropLine(justUnder, prior)).not.toBeNull();
  });

  it("never fires without a prior week or off a trivial prior share", () => {
    const current = snap({ appearance: [] });
    expect(buildAppearanceDropLine(current, null)).toBeNull();
    const tinyPrior = snap({ appearance: [{ kind: "TPF_FAQ", clicks: 1, impressions: 100 }] }); // 1 percent
    expect(buildAppearanceDropLine(current, tinyPrior)).toBeNull();
  });
});

describe("buildDeviceLine", () => {
  it("speaks the phone share of the week's visitors in tenths", () => {
    // 140 mobile of 250 total clicks -> 5.6 -> "6 in 10".
    expect(buildDeviceLine(snap())).toBe("6 in 10 of your Google visitors are on phones.");
  });

  it("handles the nearly-all and hardly-any edges without a broken '10 in 10'", () => {
    const allMobile = snap({
      devices: [
        { device: "MOBILE", clicks: 98, impressions: 5000, position: 8 },
        { device: "DESKTOP", clicks: 2, impressions: 100, position: 8 },
      ],
    });
    expect(buildDeviceLine(allMobile)).toBe("Nearly all of your Google visitors are on phones.");
    const noMobile = snap({
      devices: [
        { device: "MOBILE", clicks: 1, impressions: 100, position: 8 },
        { device: "DESKTOP", clicks: 99, impressions: 5000, position: 8 },
      ],
    });
    expect(buildDeviceLine(noMobile)).toContain("Hardly any of your Google visitors are on phones");
  });

  it("stays silent under the weekly click floor (a share over 12 clicks is noise)", () => {
    const thin = snap({
      devices: [
        { device: "MOBILE", clicks: 8, impressions: 300, position: 8 },
        { device: "DESKTOP", clicks: 4, impressions: 100, position: 8 },
      ],
    });
    expect(buildDeviceLine(thin)).toBeNull();
  });
});

describe("plainCountryLabel (never a raw alpha-3 code on a surface)", () => {
  it("maps known codes to plain words", () => {
    expect(plainCountryLabel("usa")).toBe("the United States");
    expect(plainCountryLabel("IRN")).toBe("Iran");
    expect(plainCountryLabel("can")).toBe("Canada");
  });

  it("returns null for a code we cannot render (so the line skips it, never a raw code)", () => {
    expect(plainCountryLabel("xyz")).toBeNull();
    expect(plainCountryLabel("")).toBeNull();
  });
});

describe("buildCountryLine (R17c item 428, which markets your traffic comes from)", () => {
  it("names the top market and a meaningful second market in plain words", () => {
    // usa 195 of 237 clicks -> 82 percent; irn 27 -> 11 percent.
    const line = buildCountryLine(snap())!;
    expect(line).toBe(
      "Most of your Google traffic is from the United States (82 percent); Iran is your second market (11 percent).",
    );
    expect(line).not.toMatch(/\b(usa|irn|can)\b/);
    expect(BANNED_DASH.test(line)).toBe(false);
  });

  it("gives the one-clause version when there is no meaningful second market", () => {
    const s = snap({
      countries: [
        { code: "usa", clicks: 200, impressions: 8000 },
        { code: "can", clicks: 3, impressions: 100 }, // ~1.5 percent, under the floor
      ],
    });
    expect(buildCountryLine(s)).toBe("Most of your Google traffic is from the United States (99 percent).");
  });

  it("skips a second market with no plain name but still names the top", () => {
    const s = snap({
      countries: [
        { code: "usa", clicks: 150, impressions: 6000 },
        { code: "xyz", clicks: 50, impressions: 2000 }, // unknown code
      ],
    });
    expect(buildCountryLine(s)).toBe("Most of your Google traffic is from the United States (75 percent).");
  });

  it("self-hides when the top market has no plain name (never a raw code)", () => {
    const s = snap({ countries: [{ code: "xyz", clicks: 100, impressions: 4000 }] });
    expect(buildCountryLine(s)).toBeNull();
  });

  it("is empty-safe: absent country grain (older snapshot) and thin weeks stay silent", () => {
    expect(buildCountryLine(snap({ countries: undefined }))).toBeNull();
    expect(buildCountryLine(snap({ countries: [] }))).toBeNull();
    const thin = snap({
      countries: [{ code: "usa", clicks: COUNTRY_MIN_WEEKLY_CLICKS - 1, impressions: 400 }],
    });
    expect(buildCountryLine(thin)).toBeNull();
  });
});

describe("deviceCtrGapSignalOf", () => {
  it("extracts both device rows with computed click rates", () => {
    const sig = deviceCtrGapSignalOf(snap())!;
    expect(sig.mobileImpressions).toBe(7000);
    expect(sig.mobileCtr).toBeCloseTo(0.02, 5);
    expect(sig.desktopCtr).toBeCloseTo(0.04, 5);
    expect(sig.weekEnd).toBe("2026-06-30");
  });

  it("abstains (null) when either device row is missing", () => {
    const noDesktop = snap({ devices: [{ device: "MOBILE", clicks: 10, impressions: 500, position: 8 }] });
    expect(deviceCtrGapSignalOf(noDesktop)).toBeNull();
  });
});

describe("buildWeeklyLens", () => {
  it("assembles all lines from the newest snapshot and self-hides on nothing", () => {
    const lens = buildWeeklyLens(snap(), null)!;
    expect(lens.deviceLine).toContain("phones");
    expect(lens.countryLine).toContain("the United States");
    expect(lens.appearanceLine).toContain("extra styling");
    expect(lens.appearanceDropLine).toBeNull();
    expect(lens.deviceGap).not.toBeNull();
    expect(buildWeeklyLens(null, null)).toBeNull();
  });

  it("every rendered line is dash-clean and free of lab words", () => {
    const lens = buildWeeklyLens(snap(), snap({ weekEnd: "2026-06-23" }))!;
    for (const line of [lens.deviceLine, lens.countryLine, lens.appearanceLine, lens.appearanceDropLine]) {
      if (!line) continue;
      expect(BANNED_DASH.test(line)).toBe(false);
      expect(line).not.toMatch(/searchAppearance|impressions|CTR|dimension/i);
    }
  });
});
