/**
 * Slice 4.5.C.α₂ — `robots-blocks-ai-bots` Tier-2 sensitive
 * trigger predicate unit tests.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import type {
  IndexabilityVerdict,
  OwnedUrlIndexability,
} from "@/domains/indexability/types";
import { robotsBlocksAiBots } from "@/domains/recommendation-intelligence/triggers/robots-blocks-ai-bots";

function makeConfig(overrides: Partial<BusinessConfig> = {}): BusinessConfig {
  return {
    name: "Test",
    domain: "test.com",
    industry: "home-builder",
    phone: "",
    address: "",
    yelpBusinessId: "",
    houzzProfileUrl: "",
    angiProfileUrl: "",
    bbbProfileUrl: "",
    industryDirectoryProfileUrl: "",
    locations: ["Palo Alto"],
    services: ["custom home"],
    primaryCompetitors: [],
    keyPages: [],
    locationTerms: [],
    serviceTerms: [],
    directoryDomains: [],
    scanSettings: {
      preferredHour: 7,
      timezone: "UTC",
      scope: "priority",
      enabled: true,
    },
    urlPatterns: { city: "/locations/", service: "/services/" },
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/services/custom-homes",
    canonical_url: null,
    fetched_at: "2026-05-20T00:00:00Z",
    http_status: 200,
    title: "A title",
    meta_description: "A meta",
    h1: "An h1",
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
    content_hash: "x",
    headings_hash: "y",
    faq_hash: "z",
    schema_hash: "w",
    tenant_id: "tenant-a",
    ...overrides,
  };
}

function makeIndexability(
  verdict: IndexabilityVerdict,
  botFlags: {
    gptbot_allowed?: boolean | null;
    perplexitybot_allowed?: boolean | null;
    claudebot_allowed?: boolean | null;
    google_extended_allowed?: boolean | null;
  } = {},
): OwnedUrlIndexability {
  return {
    url: "https://example.com/services/custom-homes",
    composite_verdict: verdict,
    signals: {
      sitemap_membership: { in_sitemap: true, sitemap_url: null },
      robots_txt: {
        googlebot_allowed: true,
        gptbot_allowed: botFlags.gptbot_allowed ?? true,
        perplexitybot_allowed: botFlags.perplexitybot_allowed ?? true,
        claudebot_allowed: botFlags.claudebot_allowed ?? true,
        google_extended_allowed: botFlags.google_extended_allowed ?? true,
      },
      page_snapshot: {
        http_status: 200,
        canonical_url: null,
        has_canonical_mismatch: false,
        robots_meta: null,
        noindex_detected: false,
        fetched_at: "2026-05-20T00:00:00Z",
        extraction_certainty: "confirmed",
      },
      gsc: null,
    },
    last_computed_at: "2026-05-20T00:00:00Z",
    evidence_freshness_days: 0,
  };
}

describe("robotsBlocksAiBots predicate", () => {
  it("emits zero candidates when verdict is `ok`", () => {
    const out = robotsBlocksAiBots({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("ok"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits zero candidates when verdict is `blocked_by_robots_for_googlebot` (different verdict)", () => {
    const out = robotsBlocksAiBots({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("blocked_by_robots_for_googlebot"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits a single low-confidence candidate when verdict is `blocked_by_robots_for_ai` (1 bot blocked)", () => {
    const out = robotsBlocksAiBots({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("blocked_by_robots_for_ai", {
        gptbot_allowed: false,
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.trigger_signal).toBe("robots_blocks_ai_bots");
    expect(row.action_type).toBe("fix_robots");
    expect(row.confidence).toBe("low");
    expect(row.impact_estimate).toBe("high");
    expect(row.customer_copy).toBe(
      "Your robots.txt blocks this URL. Update the rule so AI search platforms and Googlebot can crawl this page.",
    );
    expect(row.evidence[0]!.detail ?? "").toContain("blocked_count=1/4");
    expect(row.evidence[0]!.detail ?? "").toContain("gptbot_allowed=false");
    expect(row.safety_flags).toEqual([]);
  });

  it("blocked_count=4/4 in evidence when all 4 AI bots are blocked (policy-likely)", () => {
    const out = robotsBlocksAiBots({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("blocked_by_robots_for_ai", {
        gptbot_allowed: false,
        perplexitybot_allowed: false,
        claudebot_allowed: false,
        google_extended_allowed: false,
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence[0]!.detail ?? "").toContain("blocked_count=4/4");
    // Confidence stays "low" regardless of count — operator
    // distinguishes 1-bot misconfig vs 4-bot policy via the
    // detail string.
    expect(out[0]!.confidence).toBe("low");
  });

  it("operator_evidence carries per-bot booleans for triage", () => {
    const out = robotsBlocksAiBots({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("blocked_by_robots_for_ai", {
        gptbot_allowed: false,
        perplexitybot_allowed: true,
        claudebot_allowed: true,
        google_extended_allowed: false,
      }),
      businessConfig: makeConfig(),
    });
    const opEv = out[0]!.operator_evidence;
    expect(opEv).toContain("gptbot_allowed=false");
    expect(opEv).toContain("perplexitybot_allowed=true");
    expect(opEv).toContain("claudebot_allowed=true");
    expect(opEv).toContain("google_extended_allowed=false");
    expect(opEv).toContain("blocked_count=2");
  });

  it("fires on homepage / city / service / project / hub", () => {
    const cfg = makeConfig();
    const urls = [
      "https://example.com/",
      "https://example.com/locations/palo-alto",
      "https://example.com/services/custom-homes",
      "https://example.com/projects/atherton-modern",
      "https://example.com/locations", // hub
    ];
    for (const url of urls) {
      const out = robotsBlocksAiBots({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url }),
        indexability: makeIndexability("blocked_by_robots_for_ai", {
          gptbot_allowed: false,
        }),
        businessConfig: cfg,
      });
      expect(out, `should fire on ${url}`).toHaveLength(1);
    }
  });

  it("SKIPS utility / other / technical_asset", () => {
    const cfg = makeConfig();
    const urls = [
      "https://example.com/privacy-policy", // utility
      "https://example.com/about-us", // utility
      "https://example.com/some-random-path", // other
      "https://example.com/llms.txt", // technical_asset
      "https://example.com/file.pdf", // technical_asset
    ];
    for (const url of urls) {
      const out = robotsBlocksAiBots({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url }),
        indexability: makeIndexability("blocked_by_robots_for_ai", {
          gptbot_allowed: false,
        }),
        businessConfig: cfg,
      });
      expect(out, `should skip ${url}`).toHaveLength(0);
    }
  });

  it("dedupe_key + cooldown_key differ from α₁ robots-blocks-googlebot keys (distinct topic_cluster_label)", async () => {
    const { robotsBlocksGooglebot } = await import(
      "@/domains/recommendation-intelligence/triggers/robots-blocks-googlebot"
    );
    const aiRow = robotsBlocksAiBots({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("blocked_by_robots_for_ai", {
        gptbot_allowed: false,
      }),
      businessConfig: makeConfig(),
    })[0]!;
    // Build an indexability fixture for the googlebot variant.
    const googlebotIndex: OwnedUrlIndexability = {
      ...makeIndexability("blocked_by_robots_for_googlebot"),
      signals: {
        ...makeIndexability("blocked_by_robots_for_googlebot").signals,
        robots_txt: {
          googlebot_allowed: false,
          gptbot_allowed: true,
          perplexitybot_allowed: true,
          claudebot_allowed: true,
          google_extended_allowed: true,
        },
      },
    };
    const ggRow = robotsBlocksGooglebot({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: googlebotIndex,
      businessConfig: makeConfig(),
    })[0]!;
    // Same tenant + same action_type + same target_url, but
    // distinct topic_cluster_label → distinct dedupe_keys.
    expect(aiRow.dedupe_key).not.toBe(ggRow.dedupe_key);
    // cooldown_key intentionally collapses across topic_cluster_label
    // (it's coarser by formula). That's fine.
    expect(aiRow.cooldown_key).toBe(ggRow.cooldown_key);
  });
});
