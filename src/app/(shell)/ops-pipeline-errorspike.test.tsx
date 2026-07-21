/**
 * N39 render pins - the error-spike line on Today, rendered for real via
 * renderToStaticMarkup in BOTH states: quiet (self-hidden, section renders
 * nothing extra) and spiking (one honest sentence that JOINS the existing
 * machinery alert block - never a second widget).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { DeadmanVerdict } from "@/domains/ops/deadman";
import type { PipelineHealthRow } from "@/domains/ops/pipeline-health-store";

let health: PipelineHealthRow | null = null;
let verdict: DeadmanVerdict | null = null;
let spike: string | null = null;

vi.mock("@/domains/ops/pipeline-health-store", () => ({
  readPipelineHealth: async () => health,
}));
vi.mock("@/domains/ops/deadman-view", () => ({
  loadDeadmanVerdict: async () => verdict,
}));
vi.mock("@/domains/ops/error-spike", () => ({
  loadErrorSpikeLine: async () => spike,
}));

import { OpsPipelineSection } from "./ops-pipeline-section";

const SPIKE_SENTENCE =
  "Something failed 14 times since yesterday, mostly on the connected-source refresh. Details are on the Diagnostics page.";

function quietVerdict(): DeadmanVerdict {
  return {
    overall: "healthy",
    jobs: [],
    siteDown: false,
    siteSentence: null,
    alarm: false,
    sentences: [],
  };
}

function brokenPipe(): PipelineHealthRow {
  return {
    tenant_id: "tenant-iranopedia",
    checked_at: "2026-07-03T12:10:00.000Z",
    violations: [
      {
        stage: "gsc_sync",
        sentence: "Search Console is connected but last night's sync wrote 0 rows.",
        expected: "> 0 rows in the last 48h",
        actual: "0 rows",
      },
    ],
    summary: {
      gscRecentRows: 0,
      ga4RecentRows: null,
      profoundRecentRows: null,
      planCandidates: null,
      graphNodes: null,
      graphMoves: null,
    },
  };
}

beforeEach(() => {
  health = null;
  verdict = null;
  spike = null;
});

describe("OpsPipelineSection + error spike (N39)", () => {
  it("QUIET state: no spike, healthy machinery renders nothing at all", async () => {
    verdict = quietVerdict();
    spike = null;
    const html = renderToStaticMarkup(await OpsPipelineSection({ tenantId: "tenant-iranopedia" }));
    expect(html).toBe("");
  });

  it("SPIKE state: spike alone renders the block with the honest sentence + Diagnostics link", async () => {
    verdict = quietVerdict();
    spike = SPIKE_SENTENCE;
    const html = renderToStaticMarkup(await OpsPipelineSection({ tenantId: "tenant-iranopedia" }));
    expect(html).toContain("Some of my background work kept failing");
    expect(html).toContain("Something failed 14 times since yesterday, mostly on the connected-source refresh.");
    expect(html).toContain("Details are on the Diagnostics page.");
    expect(html).toContain('href="/diagnostics"');
    expect(html).toContain('data-error-spike="true"');
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("one-widget rule: spike + broken pipe render ONE section, spike line inside it", async () => {
    health = brokenPipe();
    verdict = quietVerdict();
    spike = SPIKE_SENTENCE;
    const html = renderToStaticMarkup(await OpsPipelineSection({ tenantId: "tenant-iranopedia" }));
    expect(html.match(/<section/g)).toHaveLength(1);
    expect(html).toContain("Your data pipe needs attention");
    expect(html).not.toContain("Some of my background work kept failing");
    expect(html).toContain('data-error-spike="true"');
  });

  it("no spike + broken pipe: exactly the existing alert, no spike row", async () => {
    health = brokenPipe();
    verdict = quietVerdict();
    spike = null;
    const html = renderToStaticMarkup(await OpsPipelineSection({ tenantId: "tenant-iranopedia" }));
    expect(html).toContain("Your data pipe needs attention");
    expect(html).not.toContain("data-error-spike");
  });
});
