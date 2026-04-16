/**
 * CX2 prompt template + renderer tests.
 *
 * Validates:
 *   - Template library has ≥100 templates across all 5 strata
 *   - Every template has a valid content_hash
 *   - Renderer produces deterministic output for same tenant+date
 *   - Renderer fills variables correctly
 *   - Renderer caps at MAX_PROMPTS_PER_RUN
 *   - Comparative prompts are skipped when no competitors discovered
 */

import { describe, it, expect } from "vitest";
import {
  BUILDER_PROMPT_TEMPLATES,
  getTemplatesByStrata,
  getTemplateCount,
} from "@/domains/prompts/templates-local-builder";
import { renderPromptsForTenant } from "@/domains/prompts/renderer";
import { hashPromptTemplate } from "@/domains/prompts/contracts";
import type { BeaconTenant } from "@/domains/tenants/types";

function makeTenant(overrides?: Partial<BeaconTenant>): BeaconTenant {
  return {
    id: "tenant-test",
    slug: "test-builder",
    business_name: "Test Builders",
    domain: "testbuilders.com",
    segment: "local_residential_builder",
    project_mix: ["new_construction", "whole_home_remodel"],
    cities_served: ["Palo Alto", "Menlo Park"],
    budget_range: "1m_5m",
    signup_date: "2026-04-01T00:00:00Z",
    role: "beta_customer",
    tos_accepted_at: "2026-04-01T00:00:00Z",
    discovered_competitors: [],
    daily_budget_usd: 5.0,
    status: "active",
    email_frequency: "weekly",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("prompt template library", () => {
  it("has at least 100 templates", () => {
    expect(getTemplateCount()).toBeGreaterThanOrEqual(100);
  });

  it("covers all 5 strata", () => {
    const counts = getTemplatesByStrata();
    expect(counts.brand_category).toBeGreaterThanOrEqual(30);
    expect(counts.geography).toBeGreaterThanOrEqual(20);
    expect(counts.project_type).toBeGreaterThanOrEqual(15);
    expect(counts.long_tail).toBeGreaterThanOrEqual(10);
    expect(counts.comparative).toBeGreaterThanOrEqual(5);
  });

  it("every template has a stable content_hash", () => {
    for (const t of BUILDER_PROMPT_TEMPLATES) {
      expect(t.content_hash).toBe(hashPromptTemplate(t.template));
      expect(t.content_hash.length).toBe(16);
    }
  });

  it("all template IDs are unique", () => {
    const ids = BUILDER_PROMPT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every template has version 1", () => {
    for (const t of BUILDER_PROMPT_TEMPLATES) {
      expect(t.version).toBe(1);
    }
  });
});

describe("prompt renderer", () => {
  it("produces deterministic output for the same tenant + date", () => {
    const tenant = makeTenant();
    const a = renderPromptsForTenant({ tenant, date: "2026-04-15" });
    const b = renderPromptsForTenant({ tenant, date: "2026-04-15" });
    expect(a.map((r) => r.text)).toEqual(b.map((r) => r.text));
  });

  it("fills {city} from tenant.cities_served", () => {
    const tenant = makeTenant({ cities_served: ["Atherton"] });
    const prompts = renderPromptsForTenant({ tenant });
    const cityPrompts = prompts.filter((r) =>
      r.text.includes("Atherton"),
    );
    expect(cityPrompts.length).toBeGreaterThan(0);
  });

  it("fills {business} from tenant.business_name", () => {
    const tenant = makeTenant({
      business_name: "Test Builders",
      discovered_competitors: ["Competitor Co"],
    });
    // Use high cap so sampling doesn't drop the comparative prompts
    // that contain {business}
    const prompts = renderPromptsForTenant({ tenant, maxPrompts: 2000 });
    const namePrompts = prompts.filter((r) =>
      r.text.includes("Test Builders"),
    );
    expect(namePrompts.length).toBeGreaterThan(0);
  });

  it("caps output at maxPrompts", () => {
    const tenant = makeTenant({
      cities_served: [
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
        "H",
        "I",
        "J",
      ],
    });
    const prompts = renderPromptsForTenant({
      tenant,
      maxPrompts: 50,
    });
    expect(prompts.length).toBeLessThanOrEqual(50);
  });

  it("skips comparative prompts when no competitors discovered", () => {
    const tenant = makeTenant({ discovered_competitors: [] });
    const prompts = renderPromptsForTenant({ tenant });
    const comparative = prompts.filter(
      (r) => r.definition.strata === "comparative",
    );
    // Without competitors, comparative templates that use {competitor} are dropped
    const withCompetitor = comparative.filter(
      (r) => r.definition.template.includes("{competitor}"),
    );
    expect(withCompetitor.length).toBe(0);
  });

  it("includes comparative prompts when competitors are discovered", () => {
    const tenant = makeTenant({
      discovered_competitors: ["Supple Homes"],
    });
    // Use high cap so sampling doesn't drop comparative prompts
    const prompts = renderPromptsForTenant({ tenant, maxPrompts: 2000 });
    const comparative = prompts.filter((r) =>
      r.text.includes("Supple Homes"),
    );
    expect(comparative.length).toBeGreaterThan(0);
  });

  it("every rendered prompt references its PromptDefinition", () => {
    const tenant = makeTenant();
    const prompts = renderPromptsForTenant({ tenant, maxPrompts: 20 });
    for (const r of prompts) {
      expect(r.definition).toBeDefined();
      expect(r.definition.id).toBeTruthy();
      expect(r.definition.version).toBe(1);
      expect(r.definition.content_hash.length).toBe(16);
    }
  });
});
