import { describe, expect, it } from "vitest";

import { assembleLifecycleInputs } from "./load-lifecycle-inputs";
import type { PageSnapshot } from "@/domains/pages/types";
import type { GscPageSignal, GscDecaySignal } from "@/domains/recommendation-intelligence/gsc-page-signals";
import type { PageAuthority } from "@/domains/linkgraph/internal-pagerank";
import type { OwnershipRegistry, OwnerEntry } from "@/domains/ownership/registry";

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "id",
    page_id: "pid",
    url: "https://x.com/a",
    canonical_url: null,
    fetched_at: "2026-07-01T00:00:00Z",
    http_status: 200,
    title: "A",
    meta_description: null,
    h1: "A",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 100,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "",
    headings_hash: "",
    faq_hash: "",
    schema_hash: "",
    tenant_id: "t",
    ...over,
  };
}

function gsc(over: Partial<GscPageSignal> = {}): GscPageSignal {
  return {
    page: "https://x.com/a",
    clicks90d: 0,
    impressions90d: 0,
    ctr90d: 0,
    position90d: 0,
    topQueries: [],
    ...over,
  };
}

const authority = (over: Partial<PageAuthority> = {}): PageAuthority => ({
  url: "https://x.com/a",
  authorityScore: 0.1,
  clickDepth: 2,
  orphaned: false,
  inboundCount: 3,
  ...over,
});

describe("assembleLifecycleInputs", () => {
  it("joins GSC impressions and authority inbound counts by canonical url", () => {
    const r = assembleLifecycleInputs({
      snapshots: [snap({ url: "https://x.com/a" })],
      gscSignals: new Map([["https://x.com/a", gsc({ impressions90d: 500, clicks90d: 40 })]]),
      gscDecaySignals: new Map(),
      authorities: [authority({ url: "https://x.com/a", inboundCount: 7 })],
      lastmodByUrl: new Map(),
      registry: null,
    });
    expect(r.lifecyclePages[0]!.impressions90d).toBe(500);
    expect(r.lifecyclePages[0]!.clicks90d).toBe(40);
    expect(r.lifecyclePages[0]!.inboundCount).toBe(7);
    expect(r.impressionsByUrl.get("https://x.com/a")).toBe(500);
  });

  it("inboundCount is null when the page is absent from the authority snapshot", () => {
    const r = assembleLifecycleInputs({
      snapshots: [snap({ url: "https://x.com/a" })],
      gscSignals: new Map(),
      gscDecaySignals: new Map(),
      authorities: [],
      lastmodByUrl: new Map(),
      registry: null,
    });
    expect(r.lifecyclePages[0]!.inboundCount).toBeNull();
  });

  it("demandCollapsed is null with no decay signal, and true when the split-window signal decays", () => {
    const decaying: GscDecaySignal = {
      page: "https://x.com/a",
      clicksNow: 5,
      positionNow: 12,
      impressionsNow: 100,
      clicksPrior: 100,
      positionPrior: 4,
      impressionsPrior: 400,
      windowNowEnd: "2026-07-09",
    };
    const withDecay = assembleLifecycleInputs({
      snapshots: [snap({ url: "https://x.com/a" })],
      gscSignals: new Map(),
      gscDecaySignals: new Map([["https://x.com/a", decaying]]),
      authorities: [],
      lastmodByUrl: new Map(),
      registry: null,
    });
    expect(withDecay.lifecyclePages[0]!.demandCollapsed).toBe(true);

    const noDecay = assembleLifecycleInputs({
      snapshots: [snap({ url: "https://x.com/a" })],
      gscSignals: new Map(),
      gscDecaySignals: new Map(),
      authorities: [],
      lastmodByUrl: new Map(),
      registry: null,
    });
    expect(noDecay.lifecyclePages[0]!.demandCollapsed).toBeNull();
  });

  it("joins lastmod by the normalized (lowercase, no trailing slash) url", () => {
    const r = assembleLifecycleInputs({
      snapshots: [snap({ url: "https://x.com/Page/" })],
      gscSignals: new Map(),
      gscDecaySignals: new Map(),
      authorities: [],
      lastmodByUrl: new Map([["https://x.com/page", "2020-01-01"]]),
      registry: null,
    });
    expect(r.lifecyclePages[0]!.lastmod).toBe("2020-01-01");
  });

  it("carries snapshot technical + js-shell fields through", () => {
    const r = assembleLifecycleInputs({
      snapshots: [
        snap({
          url: "https://x.com/a",
          robots_meta: "noindex",
          has_canonical_mismatch: true,
          word_count: 5,
          body_paragraph_sample: [],
          title: "Real",
          h1: "",
        }),
      ],
      gscSignals: new Map([["https://x.com/a", gsc({ impressions90d: 200 })]]),
      gscDecaySignals: new Map(),
      authorities: [],
      lastmodByUrl: new Map(),
      registry: null,
    });
    expect(r.technicalPages[0]!.robotsMeta).toBe("noindex");
    expect(r.technicalPages[0]!.hasCanonicalMismatch).toBe(true);
    expect(r.jsShellPages[0]!.bodyExcerptCount).toBe(0);
    expect(r.jsShellPages[0]!.hasTitle).toBe(true);
    expect(r.jsShellPages[0]!.hasH1).toBe(false);
  });

  it("builds merge conflicts from the registry's gsc_ranks conflicts with owner share", () => {
    const entry: OwnerEntry = {
      key: "persian cats",
      owner: "https://x.com/persian-cats",
      basis: "gsc_ranks",
      contenders: [{ url: "https://x.com/persian-cat", share: 0.1, position: 8 }],
      confidence: "high",
      reason: "",
    };
    const registry: OwnershipRegistry = {
      byQuery: new Map(),
      conflicts: [entry],
      coverage: { totalQueries: 1, gscBasisCount: 1, serpClusterBasisCount: 0, unresolvedCount: 0 },
    };
    const r = assembleLifecycleInputs({
      snapshots: [],
      gscSignals: new Map(),
      gscDecaySignals: new Map(),
      authorities: [],
      lastmodByUrl: new Map(),
      registry,
    });
    expect(r.mergeConflicts).toHaveLength(1);
    expect(r.mergeConflicts[0]!.ownerUrl).toBe("https://x.com/persian-cats");
    expect(r.mergeConflicts[0]!.foldUrl).toBe("https://x.com/persian-cat");
    // owner share = 1 - contender share total = 0.9
    expect(r.mergeConflicts[0]!.ownerShare).toBeCloseTo(0.9, 5);
  });

  it("ignores serp_cluster-basis conflicts (only gsc_ranks build merge conflicts here)", () => {
    const entry: OwnerEntry = {
      key: "x",
      owner: "https://x.com/o",
      basis: "serp_cluster",
      contenders: [{ url: "https://x.com/c", share: 0.5, position: 5 }],
      confidence: "medium",
      reason: "",
    };
    const registry: OwnershipRegistry = {
      byQuery: new Map(),
      conflicts: [entry],
      coverage: { totalQueries: 1, gscBasisCount: 0, serpClusterBasisCount: 1, unresolvedCount: 0 },
    };
    const r = assembleLifecycleInputs({
      snapshots: [],
      gscSignals: new Map(),
      gscDecaySignals: new Map(),
      authorities: [],
      lastmodByUrl: new Map(),
      registry,
    });
    expect(r.mergeConflicts).toEqual([]);
  });
});
