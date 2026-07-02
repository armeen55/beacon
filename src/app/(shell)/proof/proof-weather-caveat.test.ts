/**
 * proof-weather-caveat (2026-07-02, master plan item 32) - static pin that the
 * Results page (page.tsx) actually renders the algorithm-weather caveat line
 * computed by measurement-maturity.ts, and that it feeds buildMeasurementPresentation
 * shockWindows sourced from the detected-changepoint store. The caveat SENTENCE
 * math itself is pinned hard in measurement-maturity.test.ts and
 * algorithm-weather.test.ts; this test only pins the wiring at the render site so a
 * future refactor can't silently drop the line from the page.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function src(): string {
  return readFileSync(resolve(__dirname, "page.tsx"), "utf8");
}

describe("Results page wires the algorithm-weather guard (item 32)", () => {
  it("loads the tenant's detected changepoints and builds shock windows", () => {
    const s = src();
    expect(s).toContain("loadDetectedChangepoints");
    expect(s).toContain("buildShockWindows");
  });

  it("passes shockWindows into buildMeasurementPresentation", () => {
    const s = src();
    const call = s.slice(s.indexOf("buildMeasurementPresentation({"), s.indexOf("buildMeasurementPresentation({") + 600);
    expect(call).toContain("shockWindows");
  });

  it("renders pres.weatherCaveat as a visible line on the row", () => {
    const s = src();
    expect(s).toContain("pres?.weatherCaveat");
  });

  it("has no em or en dash around the caveat render block", () => {
    const s = src();
    const idx = s.indexOf("weatherCaveat");
    const around = s.slice(Math.max(0, idx - 400), idx + 200);
    expect(around).not.toMatch(/[–—]/);
  });
});
