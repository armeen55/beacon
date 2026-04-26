import { describe, it, expect } from "vitest";
import { readObservationRunsMergedSync } from "@/domains/observations/observation-runs-merge";

describe("readObservationRunsMergedSync", () => {
  it("returns an array (reads disk each call)", async () => {
    const a = await readObservationRunsMergedSync();
    const b = await readObservationRunsMergedSync();
    expect(Array.isArray(a)).toBe(true);
    expect(Array.isArray(b)).toBe(true);
  });
});
