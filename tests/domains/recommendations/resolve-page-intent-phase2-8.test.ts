import { describe, it, expect } from "vitest";

import { resolvePageIntent } from "@/domains/recommendations/resolve-page-intent";
import type { PageInventoryEntry } from "@/domains/recommendations/page-inventory";
import type { RecommendationCandidate } from "@/domains/recommendations/generate";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

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
    mkObs({
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
    const candidate = mkCandidate({
      stableKey: "custom",
      clusterLabel: "Custom Home Builder Bay Area",
      affectedPromptIds: promptIds,
    });
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations: thinHomepageObservations(promptIds),
      activeEntities: [RITZ],
      pageInventory: INVENTORY,
    });
    expect(resolved.resolution.targetUrl).toBe(CUSTOM_HUB.url);
    expect(resolved.resolution.targetUrl).not.toBe(HOMEPAGE.url);
  });

  it("Luxury Home Builder cluster → /luxury-home-builder-bay-area (not /)", () => {
    const promptIds = ["p1", "p2", "p3", "p4", "p5"];
    const candidate = mkCandidate({
      stableKey: "luxury",
      clusterLabel: "Luxury Home Builder Bay Area",
      affectedPromptIds: promptIds,
    });
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations: thinHomepageObservations(promptIds),
      activeEntities: [RITZ],
      pageInventory: INVENTORY,
    });
    expect(resolved.resolution.targetUrl).toBe(LUXURY_HUB.url);
  });

  it("Build on My Lot cluster → /services/build-on-your-lot (not /)", () => {
    const promptIds = ["p1", "p2", "p3", "p4", "p5"];
    const candidate = mkCandidate({
      stableKey: "bol",
      clusterLabel: "Build on My Lot / Empty Lot Builders Bay Area",
      affectedPromptIds: promptIds,
    });
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations: thinHomepageObservations(promptIds),
      activeEntities: [RITZ],
      pageInventory: INVENTORY,
    });
    expect(resolved.resolution.targetUrl).toBe(BUILD_ON_YOUR_LOT.url);
  });

  it("Architectural Plans cluster → /services/architect-provided-plans (not /)", () => {
    const promptIds = ["p1", "p2", "p3", "p4", "p5"];
    const candidate = mkCandidate({
      stableKey: "arch",
      clusterLabel: "Already Have Architectural Plans Bay Area",
      affectedPromptIds: promptIds,
    });
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations: thinHomepageObservations(promptIds),
      activeEntities: [RITZ],
      pageInventory: INVENTORY,
    });
    expect(resolved.resolution.targetUrl).toBe(ARCHITECT_PLANS.url);
  });

  it("Design-Build cluster → /services/design-build (not /)", () => {
    const promptIds = ["p1", "p2", "p3", "p4", "p5"];
    const candidate = mkCandidate({
      stableKey: "db",
      clusterLabel: "Best Design-Build Firm for Custom Homes Bay Area",
      affectedPromptIds: promptIds,
    });
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations: thinHomepageObservations(promptIds),
      activeEntities: [RITZ],
      pageInventory: INVENTORY,
    });
    expect(resolved.resolution.targetUrl).toBe(DESIGN_BUILD.url);
  });

  it("homepage still wins when cluster is brand-level (null kind, short label)", () => {
    // Brand cluster = short label + clusterKind=null (per buildPageInventory
    // isBrandCluster check). Inventory homepage penalty won't fire, so
    // inventory match returns homepage — and our Phase 2.8 guard rejects
    // homepage matches, falling through to Layer 1's homepage target.
    const promptIds = ["p1", "p2", "p3", "p4", "p5"];
    const candidate = mkCandidate({
      stableKey: "brand",
      clusterLabel: "Ritz",
      clusterKind: null,
      affectedPromptIds: promptIds,
    });
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations: thinHomepageObservations(promptIds),
      activeEntities: [RITZ],
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
      mkObs({
        id: `o-${pid}`,
        prompt_id: pid,
        observed_at: `2026-04-23T${String(10 + i).padStart(2, "0")}:00:00Z`,
        citation_urls:
          i < 4
            ? ["https://ritzbuilders.com/"]
            : [`https://competitor${i}.com/`],
      }),
    );
    const candidate = mkCandidate({
      stableKey: "high-share-home",
      clusterLabel: "Custom Home Builder Bay Area",
      affectedPromptIds: promptIds,
    });
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations,
      activeEntities: [RITZ],
      pageInventory: INVENTORY,
    });
    expect(resolved.resolution.targetUrl).toBe(HOMEPAGE.url);
    expect(resolved.resolution.action).toBe("strengthen_existing_page");
  });

  it("homepage wins when no inventory is provided (no alternative)", () => {
    const promptIds = ["p1", "p2", "p3", "p4", "p5"];
    const candidate = mkCandidate({
      stableKey: "no-inv",
      clusterLabel: "Custom Home Builder Bay Area",
      affectedPromptIds: promptIds,
    });
    const [resolved] = resolvePageIntent({
      candidates: [candidate],
      observations: thinHomepageObservations(promptIds),
      activeEntities: [RITZ],
      // no pageInventory
    });
    // No inventory → falls through to expand homepage as before.
    expect(resolved.resolution.targetUrl).toBe(HOMEPAGE.url);
    expect(resolved.resolution.action).toBe("expand_existing_page");
  });
});
