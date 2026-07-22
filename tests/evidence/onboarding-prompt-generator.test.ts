/**
 * STARTER PROMPT GENERATOR (Core 100K Phase 6 merged suite).
 * Boundary cases carried from the retired file:
 *   src/domains/onboarding/prompt-generator.test.ts
 * Pins kept: deterministic template-only generation (same input, same output),
 * 25-cap with brand+competitor families preserved at saturation, no Ritz or
 * Beacon hardcoding, customer-safe rationales (no tenant/admin/schema leaks),
 * vertical-agnostic site-derived services, region codes never become cities.
 */
import { describe, expect, it } from "vitest";
import type { ProjectMixTag } from "@/domains/tenants/types";
import {
  STARTER_PROMPT_MAX_COUNT,
  generateStarterPrompts,
  type StarterPromptInput,
} from "@/domains/onboarding/prompt-generator";

const RICH_INPUT: StarterPromptInput = {
  businessName: "Acme Builders",
  domain: "acmebuilders.com",
  citiesServed: ["Atherton", "Menlo Park", "Los Altos"],
  projectMix: ["new_construction", "whole_home_remodel", "kitchen_bath"] as ProjectMixTag[],
  competitors: ["De Mattei Construction", "Kasten", "Supple Homes"],
};

describe("cap, dedupe, determinism", () => {
  it("never exceeds the 25-cap, dedupes case-insensitively, priority is stable 1..N", () => {
    const r = generateStarterPrompts({
      businessName: "MaxBuilder",
      domain: "max.com",
      citiesServed: ["City1", "City2", "City3", "City4", "City5", "City6", "City7"],
      projectMix: [
        "new_construction", "whole_home_remodel", "kitchen_bath",
        "adu_addition", "teardown_rebuild", "commercial_residential",
      ] as ProjectMixTag[],
      competitors: ["A", "B", "C", "D", "E", "F", "G"],
    });
    expect(r.length).toBe(STARTER_PROMPT_MAX_COUNT);

    const rich = generateStarterPrompts(RICH_INPUT);
    const lower = new Set<string>();
    for (const p of rich) {
      const k = p.text.toLowerCase();
      expect(lower.has(k)).toBe(false);
      lower.add(k);
    }
    for (let i = 0; i < rich.length; i += 1) expect(rich[i].priority).toBe(i + 1);
  });

  it("same input produces same JSON-serializable output (no randomness, no Date.now)", () => {
    const a = generateStarterPrompts(RICH_INPUT);
    const b = generateStarterPrompts(RICH_INPUT);
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("at saturation, brand + competitor families are preserved (high priority)", () => {
    const r = generateStarterPrompts({
      businessName: "MaxBuilder",
      domain: "max.com",
      citiesServed: ["City1", "City2", "City3", "City4", "City5", "City6"],
      projectMix: [
        "new_construction", "whole_home_remodel", "kitchen_bath",
        "adu_addition", "teardown_rebuild", "commercial_residential",
      ] as ProjectMixTag[],
      competitors: ["A", "B", "C", "D", "E"],
    });
    expect(r.filter((p) => p.cluster === "brand_discovery").length).toBe(2);
    expect(r.filter((p) => p.cluster === "competitor_comparison").length).toBe(5);
  });
});

describe("uses every input axis; sparse inputs stay honest", () => {
  it("every competitor, city, and service tag surfaces; ', CA' stripped from text but kept in scope", () => {
    const r = generateStarterPrompts({ ...RICH_INPUT, citiesServed: ["Atherton, CA", "Menlo Park, CA"] });
    for (const p of r) expect(p.text).not.toMatch(/,\s*CA\b/);
    expect(new Set(r.filter((p) => p.city_scope).map((p) => p.city_scope)).has("Atherton, CA")).toBe(true);

    const rich = generateStarterPrompts(RICH_INPUT);
    for (const c of RICH_INPUT.competitors) {
      expect(rich.some((p) => p.cluster === "competitor_comparison" && p.text.includes(c))).toBe(true);
    }
    const tags = new Set(rich.filter((p) => p.service_scope !== null).map((p) => p.service_scope));
    for (const t of RICH_INPUT.projectMix) expect(tags.has(t)).toBe(true);
  });

  it("zero cities/services skips those families; zero everything returns []; name-only yields 2 brand prompts", () => {
    const noCity = generateStarterPrompts({
      businessName: "Acme", domain: "acme.com", citiesServed: [],
      projectMix: ["kitchen_bath"] as ProjectMixTag[], competitors: ["De Mattei"],
    });
    expect(noCity.some((p) => p.cluster === "service_in_city")).toBe(false);
    expect(noCity.some((p) => p.cluster === "brand_discovery")).toBe(true);

    expect(
      generateStarterPrompts({ businessName: "", domain: "", citiesServed: [], projectMix: [], competitors: [] }),
    ).toEqual([]);

    const solo = generateStarterPrompts({
      businessName: "SoloShop", domain: "", citiesServed: [], projectMix: [], competitors: [],
    });
    expect(solo.length).toBe(2);
    expect(solo.every((p) => p.cluster === "brand_discovery")).toBe(true);
  });

  it("ignores unknown tags and blank entries; never emits empty or double-spaced text", () => {
    const r = generateStarterPrompts({
      businessName: "Acme", domain: "acme.com", citiesServed: ["", " ", "Atherton"],
      projectMix: ["foo_bar", "kitchen_bath"] as unknown as ProjectMixTag[], competitors: ["", "De Mattei"],
    });
    const scopes = new Set(r.filter((p) => p.service_scope).map((p) => p.service_scope));
    expect(scopes.has("kitchen_bath")).toBe(true);
    expect(scopes.has("foo_bar" as ProjectMixTag)).toBe(false);
    for (const p of r) {
      expect(p.text.length).toBeGreaterThan(0);
      expect(p.text).toBe(p.text.trim());
      expect(p.text).not.toMatch(/\s{2,}/);
    }
  });
});

describe("no hardcoding + customer-safe rationales", () => {
  it("generic input never produces Ritz/Beacon tokens in text or rationale", () => {
    const r = generateStarterPrompts({
      businessName: "Acme Builders", domain: "acme.com", citiesServed: ["Atherton"],
      projectMix: ["kitchen_bath"] as ProjectMixTag[], competitors: ["De Mattei"],
    });
    for (const p of r) {
      for (const token of ["Ritz", "ritzbuilders", "ritz-founder", "Beacon"]) {
        expect(p.text).not.toContain(token);
        expect(p.rationale).not.toContain(token);
      }
    }
  });

  it("rationales are non-empty and never leak tenant/admin/RLS/schema/supabase/cron/github", () => {
    const forbidden = [/\btenant\b/i, /\badmin\b/i, /\bRLS\b/, /\bschema\b/i, /\bsupabase\b/i, /\bcron\b/i, /\bgithub\b/i];
    for (const p of generateStarterPrompts(RICH_INPUT)) {
      expect(p.rationale.length).toBeGreaterThan(0);
      for (const re of forbidden) expect(p.rationale).not.toMatch(re);
    }
  });

  it("scope shape: brand/competitor prompts unscoped; service_in_city + cost_query carry BOTH scopes", () => {
    for (const p of generateStarterPrompts(RICH_INPUT)) {
      if (p.cluster === "brand_discovery" || p.cluster === "competitor_comparison") {
        expect(p.city_scope).toBeNull();
        expect(p.service_scope).toBeNull();
      }
      if (p.cluster === "service_in_city" || p.cluster === "cost_query") {
        expect(p.city_scope).not.toBeNull();
        expect(p.service_scope).not.toBeNull();
      }
    }
  });
});

describe("site-derived services (vertical-agnostic)", () => {
  const restaurant = {
    businessName: "La Palma Taqueria",
    domain: "lapalma.com",
    citiesServed: ["Tucson", "AZ"],
    projectMix: [],
    competitors: [],
    derivedServices: ["catering", "taco bar"],
    industry: "restaurant",
  };

  it("a NON-builder business gets real service-in-city prompts from its own site", () => {
    const texts = generateStarterPrompts(restaurant).map((d) => d.text);
    expect(texts).toContain("best restaurant in Tucson");
    expect(texts).toContain("best taco bar in Tucson");
    expect(texts).toContain("how much does catering cost in Tucson");
  });

  it("region codes never become prompt cities; no cities means brand-only (honest)", () => {
    const texts = generateStarterPrompts(restaurant).map((d) => d.text);
    expect(texts.some((t) => / in AZ$/.test(t))).toBe(false);
    const noCities = generateStarterPrompts({ ...restaurant, citiesServed: [] }).map((d) => d.text);
    expect(noCities.some((t) => t.startsWith("best "))).toBe(false);
    expect(noCities).toContain("La Palma Taqueria reviews");
  });

  it("derived phrases that duplicate builder-tag prompts never double-emit; stays deterministic and capped", () => {
    const drafts = generateStarterPrompts({
      businessName: "Acme Builders", domain: "acme.com", citiesServed: ["Boerne"],
      projectMix: ["whole_home_remodel"], competitors: [],
      derivedServices: ["home remodel"], industry: null,
    });
    expect(drafts.filter((d) => d.text === "best home remodel in Boerne")).toHaveLength(1);
    const a = generateStarterPrompts(restaurant);
    expect(a).toEqual(generateStarterPrompts(restaurant));
    expect(a.length).toBeLessThanOrEqual(25);
  });
});
