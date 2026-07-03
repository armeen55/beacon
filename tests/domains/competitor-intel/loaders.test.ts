/**
 * 2026-06-09 — Competitor-intel loader tests. All stores mocked. Pins:
 * end-to-end move assembly (history + observations → tiered move),
 * What-If evidence attachment (only when it can speak), the gated
 * peer-forecast seam (null today), and soft-fail-to-[] on any store throw.
 * (load-why-them.ts / loadWhyThemReports deleted 2026-07-02, UX5 legacy
 * sweep — zero production importers remained.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let _observations: unknown[] = [];
let _observationsThrow = false;
vi.mock("@/storage/canonical-store", () => ({
  getPromptAnswerObservations: async () => {
    if (_observationsThrow) throw new Error("store down");
    return _observations;
  },
}));

let _universeEntries: Array<{ domain: string; display_name: string }> = [
  { domain: "supplehomesinc.com", display_name: "Supple Homes" },
];
vi.mock("@/domains/competitors/universe-read", () => ({
  loadCompetitorUniverseRuntime: async () => ({
    origin: "configured_file",
    entries: _universeEntries.map((e, i) => ({ id: `c${i}`, status: "active", ...e })),
    domainToLabel: {},
    pin: { universe_version: 1, universe_fingerprint: "f", legacy_unversioned_file: false },
  }),
}));

let _sitemapHistory: unknown[] = [];
vi.mock("@/domains/competitor-intel/sitemap-changes-store", () => ({
  getCompetitorSitemapChangeHistory: async () => _sitemapHistory,
}));
let _structuralChanges: unknown[] = [];
vi.mock("@/domains/competitor-intel/structural-changes-store", () => ({
  getCompetitorStructuralChanges: async () => _structuralChanges,
}));

let _outcomes: unknown[] = [];
vi.mock("@/domains/product/outcome-store", () => ({
  getOutcomeRecords: async () => _outcomes,
}));

import { loadCompetitorMoves } from "@/domains/competitor-intel/load-moves";

const NOW = new Date("2026-06-20T12:00:00Z");

function sitemapAdd(over: Record<string, unknown> = {}) {
  return {
    domain: "supplehomesinc.com",
    displayName: "Supple Homes",
    type: "added",
    url: "https://supplehomesinc.com/adu-cost",
    path: "/adu-cost",
    lastmod: "2026-06-02",
    previousLastmod: null,
    detectedAt: "2026-06-03T08:00:00Z",
    ...over,
  };
}

function citedObs(over: Record<string, unknown> = {}) {
  return {
    id: "o1",
    prompt_id: "p1",
    platform: "chatgpt",
    observed_at: "2026-06-08T10:00:00Z",
    citation_urls: ["https://supplehomesinc.com/adu-cost"],
    citation_domains: ["supplehomesinc.com"],
    ...over,
  };
}

/** ≥5 positive outcomes whose detail maps to expand_page_coverage
 *  (ACTION_TO_REC_TYPES: topic_cluster_gap → "topic cluster gap"). */
function outcomeFixture(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    outcome_id: `out-${i}`,
    action_type: "recommendation_accepted",
    action_detail: "shipped a topic cluster gap page",
    rec_id: null,
    experiment_id: null,
    change_id: null,
    target_page: null,
    target_topic: null,
    started_at: "2026-05-01T00:00:00Z",
    resolved_at: "2026-05-20T00:00:00Z",
    verdict: "validated",
    citation_delta: 3,
    confidence: "high",
    source_signal_tier: "explicit",
    pattern_id: null,
  }));
}

beforeEach(() => {
  _observations = [];
  _observationsThrow = false;
  _universeEntries = [{ domain: "supplehomesinc.com", display_name: "Supple Homes" }];
  _sitemapHistory = [];
  _structuralChanges = [];
  _outcomes = [];
});

describe("loadCompetitorMoves", () => {
  it("returns [] with no universe / no changes", async () => {
    _universeEntries = [];
    expect(await loadCompetitorMoves({ now: NOW })).toEqual([]);
    _universeEntries = [{ domain: "supplehomesinc.com", display_name: "Supple Homes" }];
    expect(await loadCompetitorMoves({ now: NOW })).toEqual([]);
  });

  it("assembles a proven move from history + observations", async () => {
    _sitemapHistory = [sitemapAdd()];
    _observations = [
      citedObs(),
      citedObs({ id: "o2", observed_at: "2026-06-10T10:00:00Z", platform: "perplexity" }),
    ];
    const moves = await loadCompetitorMoves({ now: NOW });
    expect(moves).toHaveLength(1);
    const m = moves[0]!;
    expect(m.tier).toBe("proven");
    expect(m.displayName).toBe("Supple Homes");
    expect(m.line).toContain("AI started citing it 6 days later");
    expect(m.action.label).toBe("Publish your own cost guide");
    // no outcomes → What-If can't speak → no hollow stat
    expect(m.evidenceLine).toBeNull();
    // brain gated at n=1 → no forecast
    expect(m.forecastLine).toBeNull();
  });

  it("attaches the What-If evidence line when this tenant's history can speak", async () => {
    _sitemapHistory = [sitemapAdd()];
    _observations = [citedObs()];
    _outcomes = outcomeFixture(6);
    const moves = await loadCompetitorMoves({ now: NOW });
    expect(moves[0]!.evidenceLine).toMatch(
      /^In your own history: 100% of 6 similar past actions had positive outcomes\./,
    );
  });

  it("soft-fails to [] when a store throws", async () => {
    _sitemapHistory = [sitemapAdd()];
    _observationsThrow = true;
    expect(await loadCompetitorMoves({ now: NOW })).toEqual([]);
  });
});
