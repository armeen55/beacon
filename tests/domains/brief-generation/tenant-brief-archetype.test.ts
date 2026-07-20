import { describe, expect, it } from "vitest";
import {
  deriveOpportunityBriefType,
  buildProposedBriefs,
} from "@/domains/brief-generation/builders";
import { getTemplate } from "@/domains/brief-generation/templates";
import type { Opportunity } from "@/domains/opportunities/types";

function makePromotedOpportunity(
  overrides: Partial<Opportunity> = {},
): Opportunity {
  return {
    id: "opp-tenant-archetype",
    title: "History of Tehran",
    description: "Promoted from expansion engine",
    query_text: "history of Tehran",
    platforms: ["all"],
    intent_type: "informational",
    city: "Atherton",
    topic: "history of Tehran",
    tags: [],
    current_status: "new",
    priority: "high",
    estimated_impact: "medium",
    effort: "medium",
    confidence: "medium",
    source: "ai_suggestion",
    baseline_position: null,
    target_position: null,
    target_url: null,
    competitor_ids: [],
    primary_competitor_id: null,
    linked_brief_ids: [],
    linked_changelog_ids: [],
    related_opportunity_ids: [],
    identified_at: "2026-07-01T00:00:00.000Z",
    activated_at: null,
    captured_at: null,
    last_verified_at: null,
    assessed_at: null,
    deferred_at: null,
    deferred_until: null,
    closed_at: null,
    close_reason: null,
    regressed_at: null,
    lost_at: null,
    notes: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    tenant_id: "tenant-test",
    ...overrides,
  };
}

const templateContext = {
  targetCity: "Tehran",
  targetTopic: "history of Tehran",
  patternLabel: null,
  patternSuccessRate: null,
  opportunityLabel: "History of Tehran",
  hasCaveats: false,
  caveats: [],
};

describe("tenant-aware proposed brief archetypes", () => {
  it("does not turn an editorial city subject into a local-service expansion", () => {
    expect(deriveOpportunityBriefType("Tehran", "content_publisher")).toBe(
      "new_page",
    );
    expect(deriveOpportunityBriefType("Tehran", "saas")).toBe("new_page");
    expect(deriveOpportunityBriefType("Tehran")).toBe("new_page");
  });

  it("keeps city expansion only for an explicitly local-service tenant", () => {
    expect(deriveOpportunityBriefType("Atherton", "local_service")).toBe(
      "coverage_expansion",
    );
    expect(deriveOpportunityBriefType(null, "local_service")).toBe("new_page");
  });

  it("keeps the neutral new-page template free of mandatory local-business proof", () => {
    const template = getTemplate("new_page", templateContext);
    const text = JSON.stringify(template);
    expect(text).not.toMatch(/accurate NAP|areaServed|local proof points|doorway-page/i);
    expect(text).toContain("Article");
  });

  // The standalone /briefs/proposed page that used to source-scan this
  // wiring was retired to a redirect stub (see src/app/(shell)/briefs/page.tsx,
  // 2026-07-20) — the ranked Changes list is now the one execution surface,
  // and the proposed-briefs *page* wiring this case pinned no longer exists.
  // Brief generation itself (src/domains/brief-generation/compute.ts,
  // deferred for a later retirement slice) still threads the tenant's
  // business type all the way from computeProposedBriefs -> buildProposedBriefs
  // -> deriveOpportunityBriefType, so this case now pins that domain-level
  // threading directly instead of scanning page source.
  it("threads the tenant business type from buildProposedBriefs into the derived brief archetype", () => {
    const promotedOpportunity = makePromotedOpportunity();

    const localService = buildProposedBriefs(
      [],
      [],
      [],
      [promotedOpportunity],
      [],
      "local_service",
    );
    expect(localService).toHaveLength(1);
    expect(localService[0].briefType).toBe("coverage_expansion");

    const saas = buildProposedBriefs(
      [],
      [],
      [],
      [promotedOpportunity],
      [],
      "saas",
    );
    expect(saas).toHaveLength(1);
    expect(saas[0].briefType).toBe("new_page");

    const noBusinessType = buildProposedBriefs(
      [],
      [],
      [],
      [promotedOpportunity],
      [],
    );
    expect(noBusinessType).toHaveLength(1);
    expect(noBusinessType[0].briefType).toBe("new_page");
  });
});
