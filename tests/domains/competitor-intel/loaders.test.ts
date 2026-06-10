/**
 * 2026-06-09 — Competitor-intel loader tests. All stores mocked. Pins:
 * end-to-end move assembly (history + observations → tiered move),
 * What-If evidence attachment (only when it can speak), the gated
 * peer-forecast seam (null today), why-them report assembly, and
 * soft-fail-to-[] on any store throw.
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

let _evidenceIndex: unknown = null;
vi.mock("@/domains/pages/citation-evidence-store", () => ({
  getCitationEvidenceIndex: async () => _evidenceIndex,
}));

const _competitorSnapshots = new Map<string, unknown>();
vi.mock("@/domains/pages/competitor-page-snapshots", () => ({
  getCompetitorPageSnapshotsByUrl: async () => _competitorSnapshots,
}));

let _ourSnapshots: unknown[] = [];
vi.mock("@/domains/pages/snapshot-store", () => ({
  getPageSnapshots: async () => _ourSnapshots,
}));

let _prompts: Array<{ id: string; prompt_text: string }> = [];
vi.mock("@/domains/prompts/prompt-library", () => ({
  getPromptLibrary: async () => _prompts,
}));

import { loadCompetitorMoves } from "@/domains/competitor-intel/load-moves";
import { loadWhyThemReports } from "@/domains/competitor-intel/load-why-them";

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
  _evidenceIndex = null;
  _competitorSnapshots.clear();
  _ourSnapshots = [];
  _prompts = [];
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

function evidenceIndexFixture() {
  return {
    built_at: "2026-06-09T00:00:00Z",
    total_citations_processed: 10,
    by_page_and_topic: [
      {
        page_id: "pg1",
        page_url: "https://supplehomesinc.com/adu-cost-guide",
        domain: "supplehomesinc.com",
        topic: "adu",
        is_owned: false,
        total_citations: 5,
        distinct_answers: 4,
        distinct_prompts: 3,
        by_platform: {},
        first_observed_at: "2026-05-01T00:00:00Z",
        last_observed_at: "2026-06-08T00:00:00Z",
      },
      {
        page_id: "pg2",
        page_url: "https://ritzbuilders.com/adu",
        domain: "ritzbuilders.com",
        topic: "adu",
        is_owned: true,
        total_citations: 9,
        distinct_answers: 9,
        distinct_prompts: 9,
        by_platform: {},
        first_observed_at: "2026-05-01T00:00:00Z",
        last_observed_at: "2026-06-08T00:00:00Z",
      },
    ],
    by_topic: [],
    page_to_topics: {},
  };
}

describe("loadWhyThemReports", () => {
  it("assembles a report for the top-cited rival (gaps + prompts + descriptors)", async () => {
    _evidenceIndex = evidenceIndexFixture();
    _competitorSnapshots.set("https://supplehomesinc.com/adu-cost-guide", {
      id: "comp-snap-t-x",
      tenant_id: "t",
      url: "https://supplehomesinc.com/adu-cost-guide",
      canonical_url: null,
      fetched_at: "2026-06-08T00:00:00Z",
      http_status: 200,
      title: "ADU Cost Guide",
      meta_description: "Real costs.",
      h1: "ADU Cost Guide",
      h2_list: ["ADU Cost Breakdown"],
      faq_questions: ["How much does an ADU cost?"],
      extraction_certainty: "confirmed",
    });
    _ourSnapshots = [
      {
        id: "s1",
        page_id: "pg",
        url: "https://ritzbuilders.com/adu-construction",
        canonical_url: null,
        fetched_at: "2026-06-01T00:00:00Z",
        http_status: 200,
        title: "ADU Construction",
        meta_description: "We build ADUs.",
        h1: "ADU Builders",
        h2_list: ["Our ADU Process"],
        h3_count: 0,
        faqs: [],
        schema_types: [],
        location_terms: [],
        service_terms: ["adu"],
        internal_link_count: 0,
        external_link_count: 0,
        word_count: 500,
        robots_meta: null,
        has_canonical_mismatch: false,
        content_hash: "h",
        headings_hash: "h",
        faq_hash: "h",
        schema_hash: "h",
      },
    ];
    _observations = [
      citedObs({ citation_rank: null, competitor_descriptor_windows: { "Supple Homes": ["luxury"] } }),
    ];
    _prompts = [{ id: "p1", prompt_text: "Who builds the best ADUs in Palo Alto?" }];

    const reports = await loadWhyThemReports();
    expect(reports).toHaveLength(1);
    const r = reports[0]!;
    expect(r.displayName).toBe("Supple Homes");
    expect(r.theirUrl).toBe("https://supplehomesinc.com/adu-cost-guide");
    expect(r.equivalentPageUrl).toBe("https://ritzbuilders.com/adu-construction");
    expect(r.gaps.map((g) => g.dimension)).toContain("faq");
    expect(r.prompts[0]!.promptText).toBe("Who builds the best ADUs in Palo Alto?");
    expect(r.prompts[0]!.ourRank).toBeNull(); // the loss, surfaced
    expect(r.descriptors.theirs).toContain("luxury");
  });

  it("returns [] when index missing, and suppresses below the citation floor", async () => {
    expect(await loadWhyThemReports()).toEqual([]);
    const thin = evidenceIndexFixture();
    (thin.by_page_and_topic[0] as { total_citations: number }).total_citations = 1;
    _evidenceIndex = thin;
    _observations = [citedObs()];
    _prompts = [{ id: "p1", prompt_text: "Q?" }];
    expect(await loadWhyThemReports()).toEqual([]);
  });
});
