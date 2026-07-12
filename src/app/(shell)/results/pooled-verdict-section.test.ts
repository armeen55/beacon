/**
 * pooled-verdict-section (2026-07-02, master plan item 34) - static pin that the Results page
 * (page.tsx) actually renders the pooled batch line ABOVE the per-page rows, and that the
 * component itself self-hides on a null/absent verdict. The pooling MATH is pinned hard in
 * pooled-verdict.test.ts; this test only pins the wiring + self-hide contract at the render site,
 * mirroring proof-weather-caveat.test.ts's discipline exactly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PooledVerdictRow } from "@/domains/proof-gsc/pooled-verdict-store";
import {
  TEST_CALIBRATED_POOLED_VERSION,
  registerTestCalibratedPooledVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";

// The section reads ONE tenant + ONE latest pooled row; both are mocked so the render tests below
// exercise only the calibration quarantine gate. Mirrors pooled-verdict-runner.test.ts's mock
// style (a top-level mutable the async factory returns at call time).
let latestRow: PooledVerdictRow | null = null;
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-a",
}));
vi.mock("@/domains/proof-gsc/pooled-verdict-store", () => ({
  loadLatestPooledVerdict: async () => latestRow,
}));

import { PooledVerdictSection } from "./pooled-verdict-section";

function pageSrc(): string {
  return readFileSync(resolve(__dirname, "page.tsx"), "utf8");
}
function sectionSrc(): string {
  return readFileSync(resolve(__dirname, "pooled-verdict-section.tsx"), "utf8");
}

function pooledRow(over: Partial<PooledVerdictRow> = {}): PooledVerdictRow {
  return {
    tenant_id: "tenant-a",
    plan_id: "plan1",
    plan_date: "2026-06-30",
    action_family: "meta",
    computed_at: "2026-07-02T00:00:00.000Z",
    n: 6,
    pooled_lift_pct: 9,
    standard_error: 2,
    z_score: 4.5,
    permutation_p: 0.03,
    verdict: "helped",
    calibrationVersion: null,
    sentence: "As a group: this batch of 6 changes is up about 9 percent vs comparison pages.",
    pages: ["/a", "/b", "/c", "/d", "/e", "/f"],
    ...over,
  };
}

describe("Results page wires the pooled-verdict batch line (item 34)", () => {
  it("imports and renders PooledVerdictSection", () => {
    const s = pageSrc();
    expect(s).toContain("PooledVerdictSection");
    expect(s).toContain('from "./pooled-verdict-section"');
  });

  it("renders the batch line ABOVE the Measured outcomes per-page rows", () => {
    // W2-A (2026-07-02): the section renders through the page-level deadline wrapper
    // (BoundedSection) so a wedged read can never strand its Suspense boundary; the
    // pin now targets that render call instead of a bare JSX tag.
    const s = pageSrc();
    const batchIdx = s.indexOf("PooledVerdictSection()");
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

describe("PooledVerdictSection - fail-closed calibration quarantine gate (2026-07-11)", () => {
  afterEach(() => {
    clearTestCalibratedVersions();
    latestRow = null;
  });

  it("renders nothing for an uncertified row (calibrationVersion null - every row today)", async () => {
    latestRow = pooledRow({ calibrationVersion: null });
    expect(await PooledVerdictSection()).toBeNull();
  });

  it("renders nothing for an unknown / unregistered version (fail-closed)", async () => {
    latestRow = pooledRow({ calibrationVersion: "made-up-pooled-v9" });
    expect(await PooledVerdictSection()).toBeNull();
  });

  it("renders the batch line normally for a row stamped with a registered version", async () => {
    registerTestCalibratedPooledVersion();
    latestRow = pooledRow({ calibrationVersion: TEST_CALIBRATED_POOLED_VERSION });
    const el = await PooledVerdictSection();
    expect(el).not.toBeNull();
    const html = renderToStaticMarkup(el as ReactElement);
    expect(html).toContain("up about 9 percent");
    expect(html).toContain("Pooled from 6 pages");
  });

  it("keeps an uncertified win quarantined even when the verdict says helped", async () => {
    latestRow = pooledRow({ verdict: "helped", calibrationVersion: null });
    expect(await PooledVerdictSection()).toBeNull();
  });
});
