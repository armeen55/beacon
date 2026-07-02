/**
 * pooled-verdict-section (2026-07-02, master plan item 34) - static pin that the Results page
 * (page.tsx) actually renders the pooled batch line ABOVE the per-page rows, and that the
 * component itself self-hides on a null/absent verdict. The pooling MATH is pinned hard in
 * pooled-verdict.test.ts; this test only pins the wiring + self-hide contract at the render site,
 * mirroring proof-weather-caveat.test.ts's discipline exactly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function pageSrc(): string {
  return readFileSync(resolve(__dirname, "page.tsx"), "utf8");
}
function sectionSrc(): string {
  return readFileSync(resolve(__dirname, "pooled-verdict-section.tsx"), "utf8");
}

describe("Results page wires the pooled-verdict batch line (item 34)", () => {
  it("imports and renders PooledVerdictSection", () => {
    const s = pageSrc();
    expect(s).toContain("PooledVerdictSection");
    expect(s).toContain('from "./pooled-verdict-section"');
  });

  it("renders the batch line ABOVE the Measured outcomes per-page rows", () => {
    const s = pageSrc();
    const batchIdx = s.indexOf("<PooledVerdictSection");
    const measuredIdx = s.indexOf("Measured outcomes");
    expect(batchIdx).toBeGreaterThan(-1);
    expect(measuredIdx).toBeGreaterThan(-1);
    expect(batchIdx).toBeLessThan(measuredIdx);
  });

  it("has no em or en dash around the render block", () => {
    const s = pageSrc();
    const idx = s.indexOf("PooledVerdictSection");
    const around = s.slice(Math.max(0, idx - 400), idx + 200);
    expect(around).not.toMatch(/[–—]/);
  });
});

describe("PooledVerdictSection self-hides honestly (item 34)", () => {
  it("returns null on a missing tenant/store error (fail-soft)", () => {
    const s = sectionSrc();
    expect(s).toContain("catch");
    expect(s).toContain("return null");
  });

  it("returns null when there is no row or no sentence", () => {
    const s = sectionSrc();
    expect(s).toContain("!row || !row.sentence");
  });

  it("reads from the pooled-verdicts store, not from the per-page ledger", () => {
    const s = sectionSrc();
    expect(s).toContain("loadLatestPooledVerdict");
    expect(s).not.toContain("loadShippedChanges");
  });

  it("never emits an em or en dash anywhere in the component source", () => {
    const s = sectionSrc();
    expect(s).not.toMatch(/[–—]/);
  });
});
