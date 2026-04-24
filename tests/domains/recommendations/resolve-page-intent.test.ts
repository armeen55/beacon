import { describe, it, expect } from "vitest";

import {
  resolvePageIntent,
  canonicalizeUrl,
} from "@/domains/recommendations/resolve-page-intent";
import {
  NEEDS_NEW_PAGE,
  type ResolvedRecommendationCandidate,
} from "@/domains/recommendations/resolved-types";
import type { PageInventoryEntry } from "@/domains/recommendations/page-inventory";
import type { RecommendationCandidate } from "@/domains/recommendations/generate";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

function mkEntity(
  overrides: Partial<TrackedEntity> & { id: string; name: string },
): TrackedEntity {
  return {
    account_id: "ritz",
    entity_type: "competitor",
    domain: null,
    url: null,
    aliases: [],
    location_scope: null,
    service_scope: null,
    is_owned: false,
    is_active: true,
    metadata: {},
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

const RITZ = mkEntity({
  id: "e-r",
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  entity_type: "brand",
  is_owned: true,
});

function mkObs(
  overrides: Partial<PromptAnswerObservation> & {
    id: string;
    prompt_id: string;
    observed_at: string;
  },
): PromptAnswerObservation {
  return {
    run_id: "r",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: null,
    tracked_brand_cited: null,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    platform: "perplexity",
    topic: "",
    metadata: {},
    tenant_id: "t",
    ...overrides,
  };
}

function mkCandidate(
  overrides: Partial<RecommendationCandidate> & { stableKey: string },
): RecommendationCandidate {
  return {
    stableKey: overrides.stableKey,
    type: overrides.type ?? "create_cluster_page",
    title: overrides.title ?? `rec ${overrides.stableKey}`,
    description: overrides.description ?? "desc",
    affectedPromptIds: overrides.affectedPromptIds ?? ["p1", "p2", "p3"],
    clusterLabel: overrides.clusterLabel ?? "Palo Alto",
    clusterKind: overrides.clusterKind ?? "geo",
    severity: overrides.severity ?? "high",
    effort: overrides.effort ?? "medium",
    evidence: {
      promptCount: 3,
      observationCount: 9,
      categoryBreakdown: { outranked: 3 },
      dominantCompetitors: [],
      descriptorsNearBrand: [],
      maxSignalStrength: 60,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
      ...overrides.evidence,
    },
  };
}

describe("resolvePageIntent — observation-led resolver", () => {
  it("strengthens an existing page when AI cites it on most cluster prompts", () => {
    const candidate = mkCandidate({ stableKey: "k1" });
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p1",
        observed_at: "2026-04-23T10:00:00Z",
        citation_urls: ["https://ritzbuilders.com/locations/palo-alto/"],
      }),
      mkObs({
        id: "o2",
        prompt_id: "p2",
        observed_at: "2026-04-23T10:01:00Z",
        citation_urls: ["https://ritzbuilders.com/locations/palo-alto"],
      }),
      mkObs({
        id: "o3",
        prompt_id: "p3",
        observed_at: "2026-04-23T10:02:00Z",
        citation_urls: ["https://www.ritzbuilders.com/locations/palo-alto/"],
      }),
    ];
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations,
      activeEntities: [RITZ],
    });

    expect(resolved.resolution.action).toBe("strengthen_existing_page");
    expect(resolved.resolution.targetUrl).toBe(
      "https://ritzbuilders.com/locations/palo-alto",
    );
    expect(resolved.resolution.confidence).toBe("high");
    expect(resolved.resolution.tier).toBe("observation");
    expect(resolved.resolution.cannibalization).toBeNull();
  });

  it("expands when an owned URL is cited but thinly (≥10% but <40%)", () => {
    const candidate = mkCandidate({
      stableKey: "k2",
      affectedPromptIds: ["p1", "p2", "p3", "p4", "p5"],
    });
    // Cite the URL on 1 of 5 observations (20% share) = expand territory.
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p1",
        observed_at: "2026-04-23T10:00:00Z",
        citation_urls: ["https://ritzbuilders.com/locations/palo-alto/"],
      }),
      mkObs({
        id: "o2",
        prompt_id: "p2",
        observed_at: "2026-04-23T10:01:00Z",
        citation_urls: [],
      }),
      mkObs({
        id: "o3",
        prompt_id: "p3",
        observed_at: "2026-04-23T10:02:00Z",
        citation_urls: [],
      }),
      mkObs({
        id: "o4",
        prompt_id: "p4",
        observed_at: "2026-04-23T10:03:00Z",
        citation_urls: [],
      }),
      mkObs({
        id: "o5",
        prompt_id: "p5",
        observed_at: "2026-04-23T10:04:00Z",
        citation_urls: [],
      }),
    ];
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations,
      activeEntities: [RITZ],
    });
    expect(resolved.resolution.action).toBe("expand_existing_page");
    expect(resolved.resolution.targetUrl).toBe(
      "https://ritzbuilders.com/locations/palo-alto",
    );
  });

  it("flags cannibalization when ≥2 owned URLs each take ≥20% of citations", () => {
    const candidate = mkCandidate({
      stableKey: "k3",
      affectedPromptIds: ["p1", "p2", "p3", "p4"],
    });
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p1",
        observed_at: "2026-04-23T10:00:00Z",
        citation_urls: ["https://ritzbuilders.com/custom-home-builder-bay-area/"],
      }),
      mkObs({
        id: "o2",
        prompt_id: "p2",
        observed_at: "2026-04-23T10:01:00Z",
        citation_urls: ["https://ritzbuilders.com/custom-home-builder-bay-area/"],
      }),
      mkObs({
        id: "o3",
        prompt_id: "p3",
        observed_at: "2026-04-23T10:02:00Z",
        citation_urls: ["https://ritzbuilders.com/luxury-home-builder-bay-area/"],
      }),
      mkObs({
        id: "o4",
        prompt_id: "p4",
        observed_at: "2026-04-23T10:03:00Z",
        citation_urls: ["https://ritzbuilders.com/luxury-home-builder-bay-area/"],
      }),
    ];
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations,
      activeEntities: [RITZ],
    });
    expect(resolved.resolution.action).toBe("merge_or_dedupe");
    expect(resolved.resolution.motive).toBe("resolve_cannibalization");
    expect(resolved.resolution.cannibalization).not.toBeNull();
    expect(resolved.resolution.cannibalization?.length).toBeGreaterThanOrEqual(1);
  });

  it("creates new page when observations exist but no owned URL is cited", () => {
    const candidate = mkCandidate({ stableKey: "k4" });
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p1",
        observed_at: "2026-04-23T10:00:00Z",
        citation_urls: ["https://baybuilders.com/los-altos"],
      }),
      mkObs({
        id: "o2",
        prompt_id: "p2",
        observed_at: "2026-04-23T10:01:00Z",
        citation_urls: ["https://houzz.com/pro/xyz"],
      }),
      mkObs({
        id: "o3",
        prompt_id: "p3",
        observed_at: "2026-04-23T10:02:00Z",
        citation_urls: ["https://thumbtack.com/home-builders"],
      }),
    ];
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations,
      activeEntities: [RITZ],
    });
    expect(resolved.resolution.action).toBe("create_new_page");
    expect(resolved.resolution.targetUrl).toBe(NEEDS_NEW_PAGE);
    expect(resolved.resolution.tier).toBe("observation");
  });

  it("falls through to deterministic_only tier when no native observations", () => {
    const candidate = mkCandidate({ stableKey: "k5" });
    const observations = [
      // Pre-pivot observation — should be filtered out.
      mkObs({
        id: "old",
        prompt_id: "p1",
        observed_at: "2026-04-15T10:00:00Z",
        citation_urls: ["https://ritzbuilders.com/locations/palo-alto/"],
      }),
    ];
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations,
      activeEntities: [RITZ],
    });
    expect(resolved.resolution.action).toBe("create_new_page");
    expect(resolved.resolution.targetUrl).toBe(NEEDS_NEW_PAGE);
    expect(resolved.resolution.tier).toBe("deterministic_only");
    expect(resolved.resolution.confidence).toBe("low");
  });

  it("passes watch_winning_cluster through with action=watch", () => {
    const candidate = mkCandidate({
      stableKey: "k6",
      type: "watch_winning_cluster",
      severity: "low",
      effort: "low",
      evidence: {
        promptCount: 3,
        observationCount: 9,
        categoryBreakdown: { winning: 3 },
        dominantCompetitors: [],
        descriptorsNearBrand: [],
        maxSignalStrength: 80,
        primaryCompetitors: [],
        brandPrimaryPromptCount: 3,
        fragmentedPromptCount: 0,
      },
    });
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations: [],
      activeEntities: [RITZ],
    });
    expect(resolved.resolution.action).toBe("watch");
    expect(resolved.resolution.motive).toBe("defend_winning_cluster");
  });

  it("treats www.domain and domain as the same host", () => {
    const candidate = mkCandidate({ stableKey: "k7" });
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p1",
        observed_at: "2026-04-23T10:00:00Z",
        citation_urls: ["https://www.ritzbuilders.com/locations/palo-alto/"],
      }),
      mkObs({
        id: "o2",
        prompt_id: "p2",
        observed_at: "2026-04-23T10:01:00Z",
        citation_urls: ["http://ritzbuilders.com/locations/palo-alto"],
      }),
      mkObs({
        id: "o3",
        prompt_id: "p3",
        observed_at: "2026-04-23T10:02:00Z",
        citation_urls: ["https://ritzbuilders.com/locations/palo-alto/?utm_source=x"],
      }),
    ];
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations,
      activeEntities: [RITZ],
    });
    // All three URLs canonicalize to the same key → 3/3 = 100%.
    expect(resolved.resolution.action).toBe("strengthen_existing_page");
    expect(resolved.resolution.targetUrl).toBe(
      "https://ritzbuilders.com/locations/palo-alto",
    );
    expect(resolved.resolution.confidence).toBe("high");
  });

  it("includes evidence refs with URL citation counts + top competitor when present", () => {
    const candidate = mkCandidate({
      stableKey: "k8",
      evidence: {
        promptCount: 3,
        observationCount: 9,
        categoryBreakdown: { outranked: 3 },
        dominantCompetitors: ["Bay Builders"],
        descriptorsNearBrand: [],
        maxSignalStrength: 70,
        primaryCompetitors: [
          {
            name: "Bay Builders",
            promptsWherePrimary: 2,
            totalAffectedPrompts: 3,
          },
        ],
        brandPrimaryPromptCount: 0,
        fragmentedPromptCount: 0,
      },
    });
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p1",
        observed_at: "2026-04-23T10:00:00Z",
        citation_urls: ["https://ritzbuilders.com/locations/palo-alto/"],
      }),
      mkObs({
        id: "o2",
        prompt_id: "p2",
        observed_at: "2026-04-23T10:01:00Z",
        citation_urls: ["https://ritzbuilders.com/locations/palo-alto/"],
      }),
      mkObs({
        id: "o3",
        prompt_id: "p3",
        observed_at: "2026-04-23T10:02:00Z",
        citation_urls: ["https://ritzbuilders.com/locations/palo-alto/"],
      }),
    ];
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations,
      activeEntities: [RITZ],
    });
    const refs = resolved.resolution.evidenceRefs;
    expect(refs.some((r) => r.type === "url")).toBe(true);
    expect(refs.some((r) => r.type === "competitor")).toBe(true);
    expect(refs.some((r) => r.type === "prompt")).toBe(true);
    // When the top competitor is primary on ≥50% of prompts, motive flips
    // to counter_competitor regardless of category mix.
    expect(resolved.resolution.motive).toBe("counter_competitor");
  });

  it("motive defaults to capture_absent_cluster when absent dominates and no competitor majority", () => {
    const candidate = mkCandidate({
      stableKey: "k9",
      evidence: {
        promptCount: 3,
        observationCount: 9,
        categoryBreakdown: { absent: 3 },
        dominantCompetitors: [],
        descriptorsNearBrand: [],
        maxSignalStrength: 50,
        primaryCompetitors: [],
        brandPrimaryPromptCount: 0,
        fragmentedPromptCount: 0,
      },
    });
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations: [],
      activeEntities: [RITZ],
    });
    expect(resolved.resolution.motive).toBe("capture_absent_cluster");
  });

  it("canonicalizeUrl strips www, lowercases, trims trailing slash, drops query/fragment", () => {
    expect(canonicalizeUrl("https://www.ritzbuilders.com/locations/palo-alto/")).toBe(
      "https://ritzbuilders.com/locations/palo-alto",
    );
    expect(canonicalizeUrl("http://ritzbuilders.com/locations/palo-alto?x=1#y")).toBe(
      "https://ritzbuilders.com/locations/palo-alto",
    );
    expect(canonicalizeUrl("https://RITZBUILDERS.COM/X")).toBe(
      "https://ritzbuilders.com/X",
    );
    expect(canonicalizeUrl("not-a-url")).toBeNull();
  });

  it("treats owned subdomains as owned", () => {
    const candidate = mkCandidate({ stableKey: "k10" });
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p1",
        observed_at: "2026-04-23T10:00:00Z",
        citation_urls: ["https://blog.ritzbuilders.com/palo-alto-renovations"],
      }),
      mkObs({
        id: "o2",
        prompt_id: "p2",
        observed_at: "2026-04-23T10:01:00Z",
        citation_urls: ["https://blog.ritzbuilders.com/palo-alto-renovations"],
      }),
      mkObs({
        id: "o3",
        prompt_id: "p3",
        observed_at: "2026-04-23T10:02:00Z",
        citation_urls: ["https://blog.ritzbuilders.com/palo-alto-renovations"],
      }),
    ];
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations,
      activeEntities: [RITZ],
    });
    expect(resolved.resolution.action).toBe("strengthen_existing_page");
    expect(resolved.resolution.targetUrl).toBe(
      "https://blog.ritzbuilders.com/palo-alto-renovations",
    );
  });

  it("Layer 2: falls back to inventory when observations are silent AND a page strongly matches", () => {
    const candidate = mkCandidate({
      stableKey: "k-los-altos",
      clusterLabel: "Los Altos",
      clusterKind: "geo",
    });
    const inventory: PageInventoryEntry[] = [
      {
        url: "https://ritzbuilders.com/locations/los-altos",
        title: "Los Altos Custom Home Builder",
        h1: "Los Altos Custom Home Builder",
        metaDescription: null,
        h2s: [],
        routeType: "location",
        detectedGeo: "Los Altos",
        detectedService: "Custom Home Builder",
      },
    ];
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations: [],
      activeEntities: [RITZ],
      pageInventory: inventory,
    });
    expect(resolved.resolution.action).toBe("strengthen_existing_page");
    expect(resolved.resolution.tier).toBe("inventory");
    expect(resolved.resolution.targetUrl).toBe(
      "https://ritzbuilders.com/locations/los-altos",
    );
  });

  it("Layer 2: observations exist but cite no owned URL — inventory still rescues create → strengthen", () => {
    const candidate = mkCandidate({
      stableKey: "k-palo-alto",
      clusterLabel: "Palo Alto",
      clusterKind: "geo",
    });
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p1",
        observed_at: "2026-04-23T10:00:00Z",
        citation_urls: ["https://houzz.com/pro/xyz"],
      }),
      mkObs({
        id: "o2",
        prompt_id: "p2",
        observed_at: "2026-04-23T10:01:00Z",
        citation_urls: ["https://baybuilders.com/palo-alto"],
      }),
      mkObs({
        id: "o3",
        prompt_id: "p3",
        observed_at: "2026-04-23T10:02:00Z",
        citation_urls: [],
      }),
    ];
    const inventory: PageInventoryEntry[] = [
      {
        url: "https://ritzbuilders.com/locations/palo-alto",
        title: "Palo Alto Custom Home Builder | Ritz Builders",
        h1: "Palo Alto Custom Home Builder",
        metaDescription: null,
        h2s: [],
        routeType: "location",
        detectedGeo: "Palo Alto",
        detectedService: "Custom Home Builder",
      },
    ];
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations,
      activeEntities: [RITZ],
      pageInventory: inventory,
    });
    expect(resolved.resolution.action).toBe("strengthen_existing_page");
    expect(resolved.resolution.tier).toBe("inventory");
    expect(resolved.resolution.targetUrl).toBe(
      "https://ritzbuilders.com/locations/palo-alto",
    );
  });

  it("Layer 2: low-confidence match does NOT trigger — stays create_new_page", () => {
    const candidate = mkCandidate({
      stableKey: "k-obscure",
      clusterLabel: "Obscure Unrelated Cluster",
      clusterKind: "topic",
    });
    const inventory: PageInventoryEntry[] = [
      {
        url: "https://ritzbuilders.com/services/whole-home-remodel",
        title: "Whole Home Remodel",
        h1: "Whole Home Remodel",
        metaDescription: null,
        h2s: [],
        routeType: "service",
        detectedGeo: null,
        detectedService: "Whole Home Remodel",
      },
    ];
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations: [
        mkObs({
          id: "o1",
          prompt_id: "p1",
          observed_at: "2026-04-23T10:00:00Z",
          citation_urls: ["https://thirdparty.com"],
        }),
      ],
      activeEntities: [RITZ],
      pageInventory: inventory,
    });
    expect(resolved.resolution.action).toBe("create_new_page");
    expect(resolved.resolution.tier).toBe("observation");
    expect(resolved.resolution.targetUrl).toBe(NEEDS_NEW_PAGE);
  });

  it("resolves multiple candidates in a single call without cross-contamination", () => {
    const c1 = mkCandidate({ stableKey: "c1", affectedPromptIds: ["p1"] });
    const c2 = mkCandidate({ stableKey: "c2", affectedPromptIds: ["p9"] });
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p1",
        observed_at: "2026-04-23T10:00:00Z",
        citation_urls: ["https://ritzbuilders.com/locations/palo-alto/"],
      }),
      // c2's prompt has no observations.
    ];
    const resolved = resolvePageIntent({
      candidates: [c1, c2],
      observations,
      activeEntities: [RITZ],
    });
    const byKey: Record<string, ResolvedRecommendationCandidate> = {};
    for (const r of resolved) byKey[r.stableKey] = r;
    expect(byKey.c1.resolution.action).toBe("strengthen_existing_page");
    expect(byKey.c2.resolution.tier).toBe("deterministic_only");
  });
});
