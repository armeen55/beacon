/**
 * T0c render pins - the deadman banner on Today, rendered for real via
 * renderToStaticMarkup in its three states: quiet (self-hidden), stalled
 * (standalone banner), and joined (one sentence inside the existing
 * data-pipe alert - never a second widget).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { DeadmanVerdict } from "@/domains/ops/deadman";
import type { PipelineHealthRow } from "@/domains/ops/pipeline-health-store";

let health: PipelineHealthRow | null = null;
let verdict: DeadmanVerdict | null = null;

vi.mock("@/domains/ops/pipeline-health-store", () => ({
  readPipelineHealth: async () => health,
}));
vi.mock("@/domains/ops/deadman-view", () => ({
  loadDeadmanVerdict: async () => verdict,
}));

import { OpsPipelineSection } from "./ops-pipeline-section";

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

function stalledVerdict(): DeadmanVerdict {
  return {
    overall: "stalled",
    jobs: [],
    siteDown: false,
    siteSentence: null,
    alarm: true,
    sentences: [
      "The nightly results check has not run since Jul 3, 2:30 AM. It was due again this morning. Check the Connections page.",
    ],
  };
}

function brokenPipe(): PipelineHealthRow {
  return {
    tenant_id: "tenant-iranopedia",
    checked_at: "2026-07-06T12:10:00.000Z",
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
});

describe("OpsPipelineSection + deadman (T0c)", () => {
  it("healthy state: renders nothing at all (self-hiding banner)", async () => {
    health = null;
    verdict = quietVerdict();
    const html = renderToStaticMarkup(await OpsPipelineSection({ tenantId: "tenant-iranopedia" }));
    expect(html).toBe("");
  });

  it("stalled state: the standalone banner with the plain worst-case sentence", async () => {
    health = null;
    verdict = stalledVerdict();
    const html = renderToStaticMarkup(await OpsPipelineSection({ tenantId: "tenant-iranopedia" }));
    expect(html).toContain("My overnight work is not running");
    expect(html).toContain(
      "The nightly results check has not run since Jul 3, 2:30 AM. It was due again this morning. Check the Connections page.",
    );
    expect(html).toContain('data-deadman-line="true"');
    expect(html).toContain('href="/settings/connectors"');
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("both alarms: ONE alert block - the deadman sentence joins the data-pipe alert", async () => {
    health = brokenPipe();
    verdict = stalledVerdict();
    const html = renderToStaticMarkup(await OpsPipelineSection({ tenantId: "tenant-iranopedia" }));
    // One section, the pipe heading, both messages inside it.
    expect(html.match(/<section/g)).toHaveLength(1);
    expect(html).toContain("Your data pipe needs attention");
    expect(html).not.toContain("My overnight work is not running");
    expect(html).toContain("Search Console is connected but last night&#x27;s sync wrote 0 rows.");
    expect(html).toContain("The nightly results check has not run since Jul 3, 2:30 AM.");
    expect(html).toContain('data-deadman-line="true"');
  });

  it("pipe alarm alone still renders exactly the pre-T0c alert (no deadman line)", async () => {
    health = brokenPipe();
    verdict = quietVerdict();
    const html = renderToStaticMarkup(await OpsPipelineSection({ tenantId: "tenant-iranopedia" }));
    expect(html).toContain("Your data pipe needs attention");
    expect(html).toContain("I checked");
    expect(html).not.toContain("data-deadman-line");
  });

  it("site-down: the 'your site did not answer' sentence rides the same banner", async () => {
    health = null;
    verdict = {
      ...stalledVerdict(),
      siteDown: true,
      siteSentence:
        "Your site did not answer the last two times I checked. I last tried Jul 6, 2:10 AM. Check that your site is up before anything else.",
      sentences: [
        "Your site did not answer the last two times I checked. I last tried Jul 6, 2:10 AM. Check that your site is up before anything else.",
        "The nightly results check has not run since Jul 3, 2:30 AM. It was due again this morning. Check the Connections page.",
      ],
    };
    const html = renderToStaticMarkup(await OpsPipelineSection({ tenantId: "tenant-iranopedia" }));
    expect(html).toContain("Your site did not answer the last two times I checked.");
    expect(html.match(/data-deadman-line="true"/g)).toHaveLength(2);
  });
});
