import { describe, it, expect } from "vitest";
import { detectSpikes, describeSpike } from "./spike-detector";

describe("detectSpikes", () => {
  it("flags a sharp WoW jump as a spike (high when ≥+100%)", () => {
    const out = detectSpikes([{ label: "nowruz gifts", weeks: [100, 110, 300] }]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("spike");
    expect(out[0].severity).toBe("high"); // 110→300 = +172%
    expect(out[0].jumpPct).toBeGreaterThan(1);
  });

  it("flags emergence from a zero baseline as `emerging` (no % guess)", () => {
    const out = detectSpikes([{ label: "new topic", weeks: [0, 0, 80] }]);
    expect(out[0].kind).toBe("emerging");
    expect(out[0].jumpPct).toBeNull();
  });

  it("ignores slow drift below the spike threshold", () => {
    expect(detectSpikes([{ label: "steady", weeks: [100, 105, 110] }])).toHaveLength(0);
  });

  it("ignores noise below minRecent", () => {
    expect(detectSpikes([{ label: "tiny", weeks: [1, 2, 5] }])).toHaveLength(0);
  });

  it("needs ≥2 weeks (fail-closed)", () => {
    expect(detectSpikes([{ label: "one", weeks: [500] }])).toHaveLength(0);
  });

  it("surfaces collapses only when asked", () => {
    const s = [{ label: "crash", weeks: [500, 480, 100] }];
    expect(detectSpikes(s)).toHaveLength(0);
    const c = detectSpikes(s, { includeCollapse: true });
    expect(c[0].kind).toBe("collapse");
  });

  it("ranks high severity first, then by magnitude", () => {
    const out = detectSpikes([
      { label: "medium", weeks: [100, 150] }, // +50%
      { label: "huge", weeks: [100, 400] }, // +300%
    ]);
    expect(out[0].label).toBe("huge");
  });
});

describe("describeSpike", () => {
  it("emerging copy mentions fresh demand", () => {
    expect(describeSpike({ label: "x", kind: "emerging", recentValue: 80, priorValue: 0, jumpPct: null, severity: "medium" })).toMatch(/New demand/);
  });
  it("spike copy shows the percentage", () => {
    expect(describeSpike({ label: "x", kind: "spike", recentValue: 300, priorValue: 110, jumpPct: 1.72, severity: "high" })).toMatch(/\+172%/);
  });
});
