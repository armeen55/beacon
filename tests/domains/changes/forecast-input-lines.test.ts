/**
 * forecast-input-lines (R14b) - pins the change-row "See the math" disclosure:
 * the opportunity-math inputs (times shown, current position, curve basis) in
 * plain words, and the honest omission of inputs that do not exist.
 */
import { describe, expect, it } from "vitest";
import { buildForecastInputLines } from "@/domains/changes/canonical-change";
import { buildCanonicalChanges } from "@/domains/changes/build-canonical-changes";

describe("buildForecastInputLines", () => {
  it("names all three inputs when present", () => {
    expect(
      buildForecastInputLines({
        impressions90d: 5400,
        currentPosition: 6.4,
        curveBasis: "your own click rates at each Google position",
      }),
    ).toEqual([
      "Shown on Google 5,400 times in the last 90 days for its top search.",
      "Ranked about number 6 on Google today.",
      "Sized from your own click rates at each Google position.",
    ]);
  });

  it("omits missing inputs instead of inventing them", () => {
    expect(
      buildForecastInputLines({
        impressions90d: null,
        currentPosition: null,
        curveBasis: "your own click rates at each Google position",
      }),
    ).toEqual(["Sized from your own click rates at each Google position."]);
  });

  it("never emits an em or en dash or a lab word", () => {
    const lines = buildForecastInputLines({
      impressions90d: 100,
      currentPosition: 3,
      curveBasis: "your own click rates at each Google position",
    }).join(" ");
    expect(lines).not.toMatch(/[‒–—―]/);
    expect(lines).not.toMatch(/\b(experiment|control|baseline|treatment|SERP)\b/i);
  });
});

describe("build-canonical-changes threads forecastInputs (R14b)", () => {
  const baseMove = {
    id: "m1",
    actionType: "edit_title",
    actionTone: "clicks",
    query: "persian cats",
    targetUrl: "https://example.com/persian-cats",
    pageLabel: "Persian cats",
    why: "Tighten the title",
  };

  it("a SIZED forecast carries its raw inputs", () => {
    const changes = buildCanonicalChanges({
      tenantId: "t1",
      moves: [
        {
          ...baseMove,
          topQueryPosition: 6,
          topQueryImpressions90d: 9000,
          topQueryClicks90d: 90,
        },
      ],
      plan: null,
      reservations: [],
    });
    const c = changes.find((x) => x.pagePath.includes("persian-cats"))!;
    expect(c.expectedOutcomeLow).not.toBeNull();
    expect(c.forecastInputs).toEqual({
      impressions90d: 9000,
      currentPosition: 6,
      curveBasis: "your own click rates at each Google position",
    });
  });

  it("an honest-fallback (unsized) forecast carries none", () => {
    const changes = buildCanonicalChanges({
      tenantId: "t1",
      moves: [{ ...baseMove, topQueryPosition: null, topQueryImpressions90d: null }],
      plan: null,
      reservations: [],
    });
    const c = changes.find((x) => x.pagePath.includes("persian-cats"))!;
    expect(c.expectedOutcomeLow ?? null).toBeNull();
    expect(c.forecastInputs ?? null).toBeNull();
  });
});
