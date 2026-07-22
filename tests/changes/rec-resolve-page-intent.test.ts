/** Resolve-page-intent + topic fit (Core 100K Phase 6 merge; carries the operator-locked Cheetah/Pahlavi/Abbasid fixtures). */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { resolvePageIntent, canonicalizeUrl } from "@/domains/recommendations/resolve-page-intent";
import { NEEDS_NEW_PAGE, type ResolvedRecommendationCandidate } from "@/domains/recommendations/resolved-types";
import { type PageInventoryEntry } from "@/domains/recommendations/page-inventory";
import { type RecommendationCandidate } from "@/domains/recommendations/recommendation-types";
import { type PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import { type TrackedEntity } from "@/domains/tracked-entities/types";
import { scorePageTopicFit, classifyQueryIntent, TOPIC_FIT_FLOOR, INTENT_FIT_FLOOR, type PageTopicFitInput } from "@/domains/recommendations/page-topic-fit";
import { deriveRowTopicFit } from "@/domains/recommendations/topic-fit-from-evidence";
import { type RecommendationActionRow } from "@/domains/recommendations/recommendation-action-rows";
import { type EvidenceLine } from "@/domains/recommendation-intelligence/evidence-summary";

// ===== from tests/domains/recommendations/resolve-page-intent.test.ts =====
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

// ===== from tests/domains/recommendations/resolve-page-intent-phase2-8.test.ts =====
/**
 * Phase 2.8 (2026-04-24) — homepage thin-citation contract.
 *
 * Bug: when AI cited `ritzbuilders.com/` thinly (10–40% share) on specific
 * clusters like "Custom Home Builder Bay Area," the resolver's Layer 1
 * expand branch targeted the homepage directly. That's wrong — a thin
 * homepage citation means "AI knows the domain," not "homepage is the
 * right page for this cluster."
 *
 * Fix: before committing to homepage as the target, try the inventory for
 * a specific-page match. Homepage still wins when share ≥
 * STRENGTHEN_HIGH_CONFIDENCE_SHARE (0.6) or no specific match exists.
 */

function mkEntity_f1(
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

const RITZ_f1 = mkEntity_f1({
  id: "e-r",
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  entity_type: "brand",
  is_owned: true,
});

function mkObs_f1(
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

function mkCandidate_f1(
  overrides: Partial<RecommendationCandidate> & {
    stableKey: string;
    clusterLabel: string;
  },
): RecommendationCandidate {
  return {
    stableKey: overrides.stableKey,
    type: overrides.type ?? "create_cluster_page",
    title: overrides.title ?? `rec ${overrides.stableKey}`,
    description: overrides.description ?? "desc",
    affectedPromptIds: overrides.affectedPromptIds ?? ["p1", "p2", "p3", "p4", "p5"],
    clusterLabel: overrides.clusterLabel,
    // Preserve explicit null from the caller — `?? "topic"` would coerce it
    // to "topic" and break the brand-cluster tests.
    clusterKind:
      "clusterKind" in overrides && overrides.clusterKind !== undefined
        ? overrides.clusterKind
        : "topic",
    severity: overrides.severity ?? "high",
    effort: overrides.effort ?? "medium",
    evidence: {
      promptCount: 5,
      observationCount: 15,
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

// ── fixtures ──────────────────────────────────────────────────────────

const LUXURY_HUB: PageInventoryEntry = {
  url: "https://ritzbuilders.com/luxury-home-builder-bay-area",
  title: "Top Luxury Home Builders Bay Area 2026 | Ritz Builders",
  h1: "Ritz Builders Architect-Led Custom Home Builder in the Bay Area",
  metaDescription: null,
  h2s: [],
  routeType: "hub",
  detectedGeo: "bay area",
  detectedService: "design-build",
};

const CUSTOM_HUB: PageInventoryEntry = {
  url: "https://ritzbuilders.com/custom-home-builder-bay-area",
  title: "Best Custom Home Builders Bay Area 2026 | Ritz Builders",
  h1: "Best Custom Home Builders in the Bay Area for Fully Custom, Ground-Up Projects (2026)",
  metaDescription: null,
  h2s: [],
  routeType: "hub",
  detectedGeo: "bay area",
  detectedService: "design-build",
};

const DESIGN_BUILD: PageInventoryEntry = {
  url: "https://ritzbuilders.com/services/design-build",
  title: "Architect-Led Design-Build Bay Area | Luxury Custom Homes | Ritz Builders",
  h1: "Architect-Led Design-Build for Bay Area Luxury Custom Homes",
  metaDescription: null,
  h2s: [],
  routeType: "service",
  detectedGeo: "bay area",
  detectedService: "design-build",
};

const BUILD_ON_YOUR_LOT: PageInventoryEntry = {
  url: "https://ritzbuilders.com/services/build-on-your-lot",
  title: "Build on Your Lot Bay Area | Custom Home & Site Specialists",
  h1: "Luxury Custom Home Construction on Your Lot",
  metaDescription: null,
  h2s: [],
  routeType: "service",
  detectedGeo: "bay area",
  detectedService: "custom homes",
};

const ARCHITECT_PLANS: PageInventoryEntry = {
  url: "https://ritzbuilders.com/services/architect-provided-plans",
  title: "Bay Area Builders for Completed Architectural Plans | Ritz Builders",
  h1: "Already Have Architectural Plans? Bay Area Builders for High-End Custom Homes",
  metaDescription: null,
  h2s: [],
  routeType: "service",
  detectedGeo: "bay area",
  detectedService: "design-build",
};

const HOMEPAGE: PageInventoryEntry = {
  url: "https://ritzbuilders.com/",
  title: "Luxury Custom Home Builder Bay Area | Ritz Builders",
  h1: "Ritz Builders Architect-Led Custom Home Builder in the Bay Area",
  metaDescription: null,
  h2s: [],
  routeType: "home",
  detectedGeo: "bay area",
  detectedService: null,
};

const INVENTORY: PageInventoryEntry[] = [
  HOMEPAGE,
  LUXURY_HUB,
  CUSTOM_HUB,
  DESIGN_BUILD,
  BUILD_ON_YOUR_LOT,
  ARCHITECT_PLANS,
];

// Produce a set of observations where 1 of 5 cites the homepage (20% share,
// below STRENGTHEN_SHARE 0.4 but above EXPAND_SHARE 0.1) and the other 4
// cite nothing owned. This is the exact pattern that triggered "Expand /"
// on hosted. Observations are post-NATIVE_REGIME_START so they count.
function thinHomepageObservations(promptIds: string[]): PromptAnswerObservation[] {
  return promptIds.map((pid, i) =>
    mkObs_f1({
      id: `o-${pid}`,
      prompt_id: pid,
      observed_at: `2026-04-23T${String(10 + i).padStart(2, "0")}:00:00Z`,
      citation_urls:
        i === 0 ? ["https://ritzbuilders.com/"] : [`https://competitor${i}.com/`],
    }),
  );
}

// ── tests ─────────────────────────────────────────────────────────────

describe("Phase 2.8 — homepage thin citation does not target homepage", () => {
  it("Custom Home Builder cluster → /custom-home-builder-bay-area (not /)", () => {
    const promptIds = ["p1", "p2", "p3", "p4", "p5"];
    const candidate = mkCandidate_f1({
      stableKey: "custom",
      clusterLabel: "Custom Home Builder Bay Area",
      affectedPromptIds: promptIds,
    });
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations: thinHomepageObservations(promptIds),
      activeEntities: [RITZ_f1],
      pageInventory: INVENTORY,
    });
    expect(resolved.resolution.targetUrl).toBe(CUSTOM_HUB.url);
    expect(resolved.resolution.targetUrl).not.toBe(HOMEPAGE.url);
  });





  it("homepage still wins when cluster is brand-level (null kind, short label)", () => {
    // Brand cluster = short label + clusterKind=null (per buildPageInventory
    // isBrandCluster check). Inventory homepage penalty won't fire, so
    // inventory match returns homepage — and our Phase 2.8 guard rejects
    // homepage matches, falling through to Layer 1's homepage target.
    const promptIds = ["p1", "p2", "p3", "p4", "p5"];
    const candidate = mkCandidate_f1({
      stableKey: "brand",
      clusterLabel: "Ritz",
      clusterKind: null,
      affectedPromptIds: promptIds,
    });
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations: thinHomepageObservations(promptIds),
      activeEntities: [RITZ_f1],
      pageInventory: INVENTORY,
    });
    expect(resolved.resolution.targetUrl).toBe(HOMEPAGE.url);
  });

  it("homepage wins on high-confidence share even for specific clusters", () => {
    // If 4 of 5 observations cite homepage (80% ≥ 0.6), AI is saying
    // homepage IS the answer. Respect that — do NOT override via
    // inventory.
    const promptIds = ["p1", "p2", "p3", "p4", "p5"];
    const observations: PromptAnswerObservation[] = promptIds.map((pid, i) =>
      mkObs_f1({
        id: `o-${pid}`,
        prompt_id: pid,
        observed_at: `2026-04-23T${String(10 + i).padStart(2, "0")}:00:00Z`,
        citation_urls:
          i < 4
            ? ["https://ritzbuilders.com/"]
            : [`https://competitor${i}.com/`],
      }),
    );
    const candidate = mkCandidate_f1({
      stableKey: "high-share-home",
      clusterLabel: "Custom Home Builder Bay Area",
      affectedPromptIds: promptIds,
    });
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations,
      activeEntities: [RITZ_f1],
      pageInventory: INVENTORY,
    });
    expect(resolved.resolution.targetUrl).toBe(HOMEPAGE.url);
    expect(resolved.resolution.action).toBe("strengthen_existing_page");
  });

});

// ===== from tests/domains/recommendations/resolve-page-intent-topic-fit.test.ts =====
/**
 * Expert-rec-engine GQA-4 (2026-06-16) — generation-time page/query intent fit
 * attached by resolvePageIntent against the FULL page snapshot.
 *
 * Pins the operator's acceptance behavior:
 *   • a legitimate related cluster→page match is preserved (shouldUse true);
 *   • an observation-led pick to a topically-UNRELATED page is flagged
 *     (shouldUse false) — generically, before ranking;
 *   • a new-page target (no inventory snapshot) → topicFit null (the row
 *     builder then falls back to its row-evidence proxy);
 *   • brand/locale terms come from the args (config), not baked.
 */



const RITZ_f2: TrackedEntity = {
  id: "e-r",
  name: "Site",
  account_id: "t",
  entity_type: "brand",
  domain: "example.com",
  url: null,
  aliases: [],
  location_scope: null,
  service_scope: null,
  is_owned: true,
  is_active: true,
  metadata: {},
  created_at: "2026-04-20T00:00:00Z",
  updated_at: "2026-04-20T00:00:00Z",
};

function mkCandidate_f2(o: Partial<RecommendationCandidate> & { stableKey: string }): RecommendationCandidate {
  return {
    stableKey: o.stableKey,
    type: o.type ?? "create_cluster_page",
    title: o.title ?? "rec",
    description: "desc",
    affectedPromptIds: o.affectedPromptIds ?? ["p1"],
    clusterLabel: o.clusterLabel ?? null,
    clusterKind: o.clusterKind ?? "topic",
    severity: o.severity ?? "high",
    effort: o.effort ?? "medium",
    evidence: {
      promptCount: 1,
      observationCount: 3,
      categoryBreakdown: {},
      dominantCompetitors: [],
      descriptorsNearBrand: [],
      maxSignalStrength: 60,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
    } as unknown as RecommendationCandidate["evidence"],
  };
}

function mkInv(o: Partial<PageInventoryEntry> & { url: string }): PageInventoryEntry {
  return {
    url: o.url,
    title: o.title ?? null,
    h1: o.h1 ?? null,
    metaDescription: o.metaDescription ?? null,
    h2s: o.h2s ?? [],
    routeType: o.routeType ?? "other",
    detectedGeo: o.detectedGeo ?? null,
    detectedService: o.detectedService ?? null,
  };
}

function mkObs_f2(promptId: string, citationUrl: string): PromptAnswerObservation {
  return {
    id: `o-${citationUrl}`,
    run_id: "r",
    prompt_id: promptId,
    observed_at: "2026-06-01T00:00:00Z",
    citation_urls: [citationUrl],
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: null,
    tracked_brand_cited: null,
    citation_count: 1,
    owned_citation_count: 1,
    citation_domains: ["example.com"],
    citation_categories: {},
    mentions: [],
    platform: "perplexity",
    topic: "",
    metadata: {},
    tenant_id: "t",
  } as PromptAnswerObservation;
}

describe("resolvePageIntent — generation-time topicFit", () => {
  it("preserves a legitimate related cluster→page match (shouldUse true)", () => {
    const url = canonicalizeUrl("https://example.com/persian-rug-cleaning")!;
    const [resolved] = resolvePageIntent({
      candidates: [mkCandidate_f2({ stableKey: "c1", clusterLabel: "Persian Rug Cleaning" })],
      observations: [],
      activeEntities: [RITZ_f2],
      pageInventory: [
        mkInv({
          url,
          title: "Persian Rug Cleaning Guide",
          h1: "Persian Rug Cleaning",
          metaDescription: "How to clean a persian rug.",
          h2s: ["Hand washing", "Drying a persian rug"],
        }),
      ],
    });
    expect(resolved.resolution.topicFit).not.toBeNull();
    expect(resolved.resolution.topicFit!.shouldUseQueryForOptimization).toBe(true);
  });

  it("flags an observation-led pick to a topically UNRELATED page (shouldUse false)", () => {
    const cheetahUrl = canonicalizeUrl("https://example.com/wildlife/asiatic-cheetah")!;
    const [resolved] = resolvePageIntent({
      // AI cited the cheetah page for a rug-cleaning cluster — wrong page.
      candidates: [
        mkCandidate_f2({
          stableKey: "c2",
          clusterLabel: "Persian Rug Cleaning",
          affectedPromptIds: ["p1", "p2", "p3"],
        }),
      ],
      observations: [
        mkObs_f2("p1", "https://example.com/wildlife/asiatic-cheetah"),
        mkObs_f2("p2", "https://example.com/wildlife/asiatic-cheetah"),
        mkObs_f2("p3", "https://example.com/wildlife/asiatic-cheetah"),
      ],
      activeEntities: [RITZ_f2],
      pageInventory: [
        mkInv({
          url: cheetahUrl,
          title: "Asiatic Cheetah Conservation in Iran",
          h1: "Saving the Asiatic Cheetah",
          metaDescription: "The last asiatic cheetahs.",
          h2s: ["Habitat", "Population"],
        }),
      ],
    });
    // It resolved to the cheetah page (observation-led), but the generation
    // fit catches that the rug-cleaning cluster doesn't fit that page.
    expect(resolved.resolution.targetUrl).toBe(cheetahUrl);
    expect(resolved.resolution.topicFit).not.toBeNull();
    expect(resolved.resolution.topicFit!.shouldUseQueryForOptimization).toBe(false);
  });

  it("a new-page target (no inventory snapshot) → topicFit null", () => {
    const [resolved] = resolvePageIntent({
      candidates: [mkCandidate_f2({ stableKey: "c3", clusterLabel: "Totally New Topic Cluster" })],
      observations: [],
      activeEntities: [RITZ_f2],
      pageInventory: [],
    });
    expect(resolved.resolution.topicFit ?? null).toBeNull();
  });
});

// ===== from tests/domains/recommendations/page-topic-fit.test.ts =====
/**
 * Expert-rec-engine Slice 3 (2026-06-16) — page-topic intent-fit scorer.
 *
 * Pins the directive PHASE C / PHASE J contract DETERMINISTICALLY (no LLM):
 *   • an unrelated query/page mismatch is rejected GENERICALLY (no hardcoded
 *     example — token coverage ≈ 0 drives it),
 *   • a high-volume but WRONG-INTENT query cannot clear the optimize gate,
 *   • intent classification covers all six classes from universal markers,
 *   • brand/locale detection comes from PASSED-IN config, never baked,
 *   • an adjacent-but-not-main query surfaces a "consider a new page" risk.
 */



const recipePage: PageTopicFitInput["page"] = {
  title: "Authentic Persian Koobideh Kabob Recipe",
  h1: "Persian Koobideh Kabob",
  metaDescription:
    "How to make authentic Persian koobideh kabob — ground beef, sumac, onion, and a charcoal sear.",
  urlPath: "/persian-food/koobideh-kabob",
  collectionOrCategory: "Recipes",
};

describe("classifyQueryIntent — universal markers, config-driven brand/locale", () => {
  it("informational (question words / recipe)", () => {
    expect(classifyQueryIntent("how to make koobideh kabob")).toBe("informational");
    expect(classifyQueryIntent("koobideh kabob recipe")).toBe("informational");
  });
  it("transactional (buy/price/order)", () => {
    expect(classifyQueryIntent("buy persian rugs online")).toBe("transactional");
    expect(classifyQueryIntent("persian rug price")).toBe("transactional");
  });
  it("commercial (best/review/vs)", () => {
    expect(classifyQueryIntent("best persian rugs")).toBe("commercial");
    expect(classifyQueryIntent("tabriz vs kashan rugs")).toBe("commercial");
  });
  it("local (near me / passed-in locale term)", () => {
    expect(classifyQueryIntent("persian restaurant near me")).toBe("local");
    expect(
      classifyQueryIntent("persian restaurant westwood", { localeTerms: ["Westwood"] }),
    ).toBe("local");
  });
  it("navigational only when a config brand term DOMINATES the query", () => {
    expect(classifyQueryIntent("iranopedia", { brandTerms: ["Iranopedia"] })).toBe(
      "navigational",
    );
    // brand present but not dominant → stays commercial, not navigational
    expect(
      classifyQueryIntent("best iranopedia alternative", { brandTerms: ["Iranopedia"] }),
    ).toBe("commercial");
  });
  it("mixed for conflicting families and for marker-less bare nouns", () => {
    expect(classifyQueryIntent("how to buy persian rugs")).toBe("mixed"); // info + buy
    expect(classifyQueryIntent("persian rugs")).toBe("mixed"); // ambiguous
  });
});

describe("scorePageTopicFit — generic mismatch rejection (mission #1)", () => {
  it("rejects a totally unrelated query for a page GENERICALLY (no hardcoded rule)", () => {
    // Directive's spirit: a time/utility query must not optimize an animal
    // conservation page. Driven purely by ≈0 token coverage.
    const fit = scorePageTopicFit({
      page: {
        title: "Asiatic Cheetah Conservation in Iran",
        h1: "Saving the Asiatic Cheetah",
        urlPath: "/wildlife/asiatic-cheetah",
      },
      query: "current time in tehran now",
    });
    expect(fit.topicMatchScore).toBeLessThan(TOPIC_FIT_FLOOR);
    expect(fit.shouldUseQueryForOptimization).toBe(false);
    expect(fit.mismatchRisks.length).toBeGreaterThan(0);
    expect(fit.mismatchRisks[0]).toContain("dedicated page");
  });

  it("accepts a strong, on-topic, intent-aligned query", () => {
    const fit = scorePageTopicFit({
      page: recipePage,
      query: "koobideh kabob recipe",
    });
    expect(fit.topicMatchScore).toBeGreaterThanOrEqual(TOPIC_FIT_FLOOR);
    expect(fit.intentMatchScore).toBeGreaterThanOrEqual(INTENT_FIT_FLOOR);
    expect(fit.shouldUseQueryForOptimization).toBe(true);
    expect(fit.intentClass).toBe("informational");
  });
});

describe("scorePageTopicFit — high-volume but WRONG-INTENT cannot clear the gate", () => {
  it("a transactional query on an informational recipe page fails the intent gate", () => {
    // The page's topic overlaps ('koobideh kabob'), but the query intent is
    // transactional ('price') while the page is an informational recipe —
    // Beacon must not chase it just because the words overlap.
    const fit = scorePageTopicFit({
      page: recipePage,
      query: "koobideh kabob price",
    });
    expect(fit.topicMatchScore).toBeGreaterThanOrEqual(TOPIC_FIT_FLOOR); // words overlap
    expect(fit.intentClass).toBe("transactional");
    expect(fit.intentMatchScore).toBeLessThan(INTENT_FIT_FLOOR); // but intent conflicts
    expect(fit.shouldUseQueryForOptimization).toBe(false);
    expect(fit.mismatchRisks.some((r) => r.includes("transactional"))).toBe(true);
  });

  it("keywordIntentHint reconciles the query intent when provided", () => {
    const fit = scorePageTopicFit({
      page: recipePage,
      query: "koobideh kabob", // bare → mixed without a hint
      keywordIntentHint: "informational",
    });
    expect(fit.intentClass).toBe("informational");
  });
});

describe("scorePageTopicFit — adjacent topic surfaces a 'new page' nudge", () => {
  it("a topically-adjacent query not in the title/H1 flags a softer risk", () => {
    const fit = scorePageTopicFit({
      page: recipePage,
      // related to Persian food but the page is specifically koobideh
      query: "persian ghormeh sabzi stew",
    });
    // It should NOT be a confident target for THIS page.
    expect(fit.shouldUseQueryForOptimization).toBe(false);
    expect(fit.mismatchRisks.length).toBeGreaterThan(0);
  });
});

describe("scorePageTopicFit — output contract", () => {
  it("returns the full PHASE C JSON shape with bounded scores", () => {
    const fit = scorePageTopicFit({ page: recipePage, query: "koobideh kabob recipe" });
    expect(fit).toMatchObject({
      pageTopic: expect.any(String),
      queryIntent: expect.stringContaining("koobideh"),
      intentClass: expect.any(String),
      matchExplanation: expect.any(String),
    });
    expect(fit.topicMatchScore).toBeGreaterThanOrEqual(0);
    expect(fit.topicMatchScore).toBeLessThanOrEqual(100);
    expect(fit.intentMatchScore).toBeGreaterThanOrEqual(0);
    expect(fit.intentMatchScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(fit.mismatchRisks)).toBe(true);
  });
});

// ===== from tests/domains/recommendations/topic-fit-from-evidence.test.ts =====
/**
 * Expert-rec-engine PHASE I (2026-06-16) — deriveRowTopicFit adapter.
 * Pins that a live row's intent-fit is derived from the evidence it carries:
 * primary query precedence (GSC → tracked prompt; the SEMrush fallback was
 * removed with the SEMrush connector, 2026-06), supporting-query context, and
 * null when there's no quotable query.
 */



function row(overrides: {
  targetLabel?: string;
  targetUrl?: string | null;
  gsc?: EvidenceLine[];
}): RecommendationActionRow {
  return {
    targetLabel: overrides.targetLabel ?? "Persian Rug Cleaning page",
    targetUrl: overrides.targetUrl ?? "https://example.com/persian-rug-cleaning",
    detail: {
      gscEvidenceLines: overrides.gsc ?? [],
    },
    // The adapter only reads the fields above; the rest of the row shape is
    // irrelevant to this pure derivation.
  } as unknown as RecommendationActionRow;
}

const gscLine = (q: string): EvidenceLine => ({
  key: "headline_query",
  value: `“${q}”`,
  label: "shown · rank #6",
});

describe("deriveRowTopicFit", () => {
  it("uses the GSC headline query as the primary target", () => {
    const fit = deriveRowTopicFit(
      row({ gsc: [gscLine("persian rug cleaning cost"), gscLine("persian rug repair")] }),
      [],
    );
    expect(fit).not.toBeNull();
    expect(fit!.queryIntent).toContain("persian rug cleaning cost");
  });

  it("falls back to a tracked prompt when GSC evidence is absent", () => {
    // (The SEMrush keyword fallback was removed with the SEMrush connector, 2026-06.)
    const promptOnly = deriveRowTopicFit(row({}), ["how to wash a persian rug"]);
    expect(promptOnly!.queryIntent).toContain("how to wash a persian rug");
  });

  it("returns null when the row carries no quotable query", () => {
    expect(deriveRowTopicFit(row({}), [])).toBeNull();
  });

  it("passes brand/locale terms through to intent classification", () => {
    // A brand-dominant query with the tenant brand term → navigational.
    const fit = deriveRowTopicFit(row({ gsc: [gscLine("iranopedia")] }), [], {
      brandTerms: ["Iranopedia"],
    });
    expect(fit!.intentClass).toBe("navigational");
  });

  it("scores a strong fit for an on-topic query and surfaces a mismatch otherwise", () => {
    const onTopic = deriveRowTopicFit(
      row({ targetUrl: "https://x.com/persian-rug-cleaning", gsc: [gscLine("persian rug cleaning")] }),
      ["persian rug cleaning tips"],
    );
    expect(onTopic!.topicMatchScore).toBeGreaterThan(0);

    const offTopic = deriveRowTopicFit(
      row({ targetLabel: "Asiatic Cheetah page", targetUrl: "https://x.com/wildlife/cheetah", gsc: [gscLine("current time in tehran")] }),
      [],
    );
    expect(offTopic!.shouldUseQueryForOptimization).toBe(false);
  });
});
