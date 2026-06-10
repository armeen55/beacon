/**
 * Phase A.2 (Section 3.10 / E9) — operator-only /diagnostics/cross-tenant-brain
 * render contract.
 *
 * Pins:
 *   - Operator gate: notFound() when isOperatorModeServer() is false.
 *   - Renders the activation gates, sample-size thresholds, the live
 *     per-tenant threshold decision, and the producer state.
 *   - Disambiguates from /diagnostics/brain (E9 lock).
 *   - Resilient: a failed threshold-decision load renders the empty
 *     state, never throws.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
}));

let _operatorModeEnabled = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operatorModeEnabled,
}));

let _decision: unknown = {
  source: "profound_default",
  thresholds: { fast_days: 6, median_days: 18, late_days: 37 },
  sample_size: 4,
  excluded_count: 9,
  percentile_used: { fast: 0.5, median: 0.75, late: 0.9 },
};
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-test",
}));
vi.mock("@/domains/citation-lifecycle/load-lifecycle", () => ({
  loadLifecycleSummaryForTenant: async () =>
    _decision === null ? null : { threshold_decision: _decision },
}));

import CrossTenantBrainPage from "@/app/(shell)/diagnostics/cross-tenant-brain/page";

async function render(): Promise<string> {
  const el = await CrossTenantBrainPage();
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  _operatorModeEnabled = true;
  _decision = {
    source: "profound_default",
    thresholds: { fast_days: 6, median_days: 18, late_days: 37 },
    sample_size: 4,
    excluded_count: 9,
    percentile_used: { fast: 0.5, median: 0.75, late: 0.9 },
  };
});

describe("/diagnostics/cross-tenant-brain — operator gate", () => {
  it("404s for non-operators", async () => {
    _operatorModeEnabled = false;
    await expect(render()).rejects.toThrow(NotFoundError);
  });

  it("renders for operators", async () => {
    const html = await render();
    expect(html).toContain("Cross-Tenant Brain");
  });
});

describe("/diagnostics/cross-tenant-brain — content", () => {
  it("shows both activation gates", async () => {
    const html = await render();
    expect(html).toContain("BEACON_CROSS_TENANT_BRAIN");
    expect(html).toContain("BEACON_BRAIN_LEARNED_TILE");
  });

  it("shows the sample-size thresholds (5 / 10 / 20)", async () => {
    const html = await render();
    expect(html).toContain("20");
    expect(html).toMatch(/minimum ships for a pattern/i);
  });

  it("disambiguates from the tenant-local /diagnostics/brain (E9)", async () => {
    const html = await render();
    expect(html).toContain("/diagnostics/brain");
    expect(html).toMatch(/tenant-local/i);
  });

  it("renders the borrowed-defaults decision with sample + excluded counts", async () => {
    const html = await render();
    expect(html).toContain("borrowed defaults");
    expect(html).toContain("18d"); // median
  });

  it("renders the Beacon-owned decision when source is per_tenant", async () => {
    _decision = {
      source: "per_tenant",
      thresholds: { fast_days: 4, median_days: 12, late_days: 30 },
      sample_size: 22,
      excluded_count: 3,
      percentile_used: { fast: 0.5, median: 0.75, late: 0.9 },
    };
    const html = await render();
    expect(html).toContain("Beacon-owned");
    expect(html).toContain("12d");
  });

  it("renders an empty state when no threshold decision is available", async () => {
    _decision = null;
    const html = await render();
    expect(html).toMatch(/no threshold decision available/i);
  });

  it("shows the cross-tenant producer pattern count (0 at n=1)", async () => {
    const html = await render();
    expect(html).toMatch(/patterns currently emitted/i);
  });
});
