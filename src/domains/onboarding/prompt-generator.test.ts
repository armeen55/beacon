/**
 * Behavioral tests — Gap E.1 prompt-generator (2026-05-07).
 *
 * Pure unit tests, no I/O. Pin the deterministic-template-only
 * generator contract: same input → same output, capped at 25, no
 * paid APIs touched, no Ritz-specific data hardcoded.
 */

import { describe, expect, it } from "vitest";
import type { ProjectMixTag } from "@/domains/tenants/types";
import {
  STARTER_PROMPT_MAX_COUNT,
  generateStarterPrompts,
  type StarterPromptInput,
  type PromptDraft,
} from "./prompt-generator";

const RICH_INPUT: StarterPromptInput = {
  businessName: "Acme Builders",
  domain: "acmebuilders.com",
  citiesServed: ["Atherton", "Menlo Park", "Los Altos"],
  projectMix: [
    "new_construction",
    "whole_home_remodel",
    "kitchen_bath",
  ] as ProjectMixTag[],
  competitors: ["De Mattei Construction", "Kasten", "Supple Homes"],
};

describe("generateStarterPrompts — cap + dedupe", () => {
  it("never exceeds STARTER_PROMPT_MAX_COUNT (=25)", () => {
    const r = generateStarterPrompts({
      businessName: "MaxBuilder",
      domain: "max.com",
      citiesServed: [
        "City1",
        "City2",
        "City3",
        "City4",
        "City5",
        "City6",
        "City7",
      ],
      projectMix: [
        "new_construction",
        "whole_home_remodel",
        "kitchen_bath",
        "adu_addition",
        "teardown_rebuild",
        "commercial_residential",
      ] as ProjectMixTag[],
      competitors: ["A", "B", "C", "D", "E", "F", "G"],
    });
    expect(r.length).toBeLessThanOrEqual(STARTER_PROMPT_MAX_COUNT);
    expect(r.length).toBe(STARTER_PROMPT_MAX_COUNT); // saturates
  });

  it("dedupes prompt text case-insensitively", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    const lower = new Set<string>();
    for (const p of r) {
      const k = p.text.toLowerCase();
      expect(lower.has(k)).toBe(false);
      lower.add(k);
    }
  });

  it("priority is a stable 1..N ordering", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    for (let i = 0; i < r.length; i += 1) {
      expect(r[i].priority).toBe(i + 1);
    }
  });
});

describe("generateStarterPrompts — determinism", () => {
  it("same input produces same output (no randomness, no Date.now)", () => {
    const a = generateStarterPrompts(RICH_INPUT);
    const b = generateStarterPrompts(RICH_INPUT);
    expect(a).toEqual(b);
  });

  it("output is JSON-serializable (pure data)", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    expect(() => JSON.stringify(r)).not.toThrow();
    const round = JSON.parse(JSON.stringify(r));
    expect(round).toEqual(r);
  });
});

describe("generateStarterPrompts — uses every input axis", () => {
  it("uses businessName in brand discovery prompts", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    const brand = r.filter((p) => p.cluster === "brand_discovery");
    expect(brand.length).toBeGreaterThanOrEqual(1);
    for (const p of brand) {
      expect(p.text).toContain("Acme Builders");
    }
  });

  it("uses competitors in competitor_comparison prompts", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    const comp = r.filter((p) => p.cluster === "competitor_comparison");
    expect(comp.length).toBeGreaterThan(0);
    const competitorsHit = new Set(
      comp.flatMap((p) =>
        RICH_INPUT.competitors.filter((c) => p.text.includes(c)),
      ),
    );
    // At least one of each competitor surfaced
    for (const c of RICH_INPUT.competitors) {
      expect(competitorsHit.has(c)).toBe(true);
    }
  });

  it("uses cities in service_in_city prompts (city_scope set)", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    const sic = r.filter((p) => p.cluster === "service_in_city");
    expect(sic.length).toBeGreaterThan(0);
    const citiesHit = new Set(sic.map((p) => p.city_scope));
    for (const c of RICH_INPUT.citiesServed) {
      expect(citiesHit.has(c)).toBe(true);
    }
  });

  it("uses every service tag (service_scope set on city + cost prompts)", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    const scoped = r.filter((p) => p.service_scope !== null);
    const tags = new Set(scoped.map((p) => p.service_scope));
    for (const t of RICH_INPUT.projectMix) {
      expect(tags.has(t)).toBe(true);
    }
  });

  it("strips ', CA' state abbreviation from prompt text", () => {
    const r = generateStarterPrompts({
      ...RICH_INPUT,
      citiesServed: ["Atherton, CA", "Menlo Park, CA"],
    });
    for (const p of r) {
      // Prompt text should never contain the ", CA" tail.
      expect(p.text).not.toMatch(/,\s*CA\b/);
    }
    // But the city_scope field preserves it (for downstream linking).
    const cityScopes = new Set(
      r.filter((p) => p.city_scope).map((p) => p.city_scope),
    );
    expect(cityScopes.has("Atherton, CA")).toBe(true);
  });
});

describe("generateStarterPrompts — sparse inputs", () => {
  it("works with one city, one service, one competitor", () => {
    const r = generateStarterPrompts({
      businessName: "Acme",
      domain: "acme.com",
      citiesServed: ["Atherton"],
      projectMix: ["kitchen_bath"] as ProjectMixTag[],
      competitors: ["De Mattei"],
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(STARTER_PROMPT_MAX_COUNT);
    expect(r.some((p) => p.cluster === "brand_discovery")).toBe(true);
    expect(r.some((p) => p.cluster === "competitor_comparison")).toBe(true);
    expect(r.some((p) => p.cluster === "service_in_city")).toBe(true);
  });

  it("works with zero competitors (still produces brand + service + cost)", () => {
    const r = generateStarterPrompts({
      businessName: "Acme",
      domain: "acme.com",
      citiesServed: ["Atherton"],
      projectMix: ["kitchen_bath"] as ProjectMixTag[],
      competitors: [],
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((p) => p.cluster === "competitor_comparison")).toBe(false);
    expect(r.some((p) => p.cluster === "brand_discovery")).toBe(true);
    expect(r.some((p) => p.cluster === "service_in_city")).toBe(true);
  });

  it("works with zero cities (skips city-scoped families, keeps brand + comp)", () => {
    const r = generateStarterPrompts({
      businessName: "Acme",
      domain: "acme.com",
      citiesServed: [],
      projectMix: ["kitchen_bath"] as ProjectMixTag[],
      competitors: ["De Mattei"],
    });
    expect(r.some((p) => p.cluster === "brand_discovery")).toBe(true);
    expect(r.some((p) => p.cluster === "competitor_comparison")).toBe(true);
    expect(r.some((p) => p.cluster === "service_in_city")).toBe(false);
    expect(r.some((p) => p.cluster === "cost_query")).toBe(false);
  });

  it("works with zero services (skips service families, keeps brand + comp)", () => {
    const r = generateStarterPrompts({
      businessName: "Acme",
      domain: "acme.com",
      citiesServed: ["Atherton"],
      projectMix: [],
      competitors: ["De Mattei"],
    });
    expect(r.some((p) => p.cluster === "brand_discovery")).toBe(true);
    expect(r.some((p) => p.cluster === "competitor_comparison")).toBe(true);
    expect(r.some((p) => p.cluster === "service_in_city")).toBe(false);
    expect(r.some((p) => p.cluster === "cost_query")).toBe(false);
  });

  it("works with zero of everything (returns empty)", () => {
    const r = generateStarterPrompts({
      businessName: "",
      domain: "",
      citiesServed: [],
      projectMix: [],
      competitors: [],
    });
    expect(r).toEqual([]);
  });

  it("works with only business name (just brand prompts)", () => {
    const r = generateStarterPrompts({
      businessName: "SoloShop",
      domain: "",
      citiesServed: [],
      projectMix: [],
      competitors: [],
    });
    expect(r.length).toBe(2);
    expect(r.every((p) => p.cluster === "brand_discovery")).toBe(true);
  });
});

describe("generateStarterPrompts — defense", () => {
  it("ignores unknown project_mix tags safely", () => {
    const r = generateStarterPrompts({
      businessName: "Acme",
      domain: "acme.com",
      citiesServed: ["Atherton"],
      projectMix: ["foo_bar", "kitchen_bath"] as unknown as ProjectMixTag[],
      competitors: [],
    });
    // Should still produce service prompts for the valid tag.
    const serviceScopes = new Set(
      r.filter((p) => p.service_scope).map((p) => p.service_scope),
    );
    expect(serviceScopes.has("kitchen_bath")).toBe(true);
    expect(serviceScopes.has("foo_bar" as ProjectMixTag)).toBe(false);
  });

  it("ignores blank / non-string entries in arrays", () => {
    const r = generateStarterPrompts({
      businessName: "Acme",
      domain: "acme.com",
      citiesServed: ["", " ", "Atherton"],
      projectMix: ["kitchen_bath"] as ProjectMixTag[],
      competitors: ["", "  ", "De Mattei"],
    });
    expect(r.some((p) => p.text.includes("Atherton"))).toBe(true);
    expect(r.some((p) => p.text.includes("De Mattei"))).toBe(true);
  });

  it("trims whitespace from prompt text (no double spaces, no leading/trailing)", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    for (const p of r) {
      expect(p.text).toBe(p.text.trim());
      expect(p.text).not.toMatch(/\s{2,}/); // no double spaces
    }
  });

  it("never emits an empty text string", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    for (const p of r) {
      expect(p.text.length).toBeGreaterThan(0);
    }
  });
});

describe("generateStarterPrompts — no Ritz/Beacon hardcoding", () => {
  // The generator must work with any tenant. Pin that the output for a
  // generic input does NOT contain Ritz-specific names, domains, or any
  // operator-tenant hint.
  const RITZ_TOKENS = [
    "Ritz",
    "ritzbuilders",
    "ritz-builders",
    "ritz-founder",
    "Beacon",
    "Atherton-93022",
  ];

  it("generic input never produces Ritz-specific tokens in text or rationale", () => {
    const r = generateStarterPrompts({
      businessName: "Acme Builders",
      domain: "acme.com",
      citiesServed: ["Atherton"],
      projectMix: ["kitchen_bath"] as ProjectMixTag[],
      competitors: ["De Mattei"],
    });
    for (const p of r) {
      for (const token of RITZ_TOKENS) {
        expect(p.text).not.toContain(token);
        expect(p.rationale).not.toContain(token);
      }
    }
  });
});

describe("generateStarterPrompts — customer-safe rationales", () => {
  it("rationale never leaks tenant/admin/RLS/schema/Supabase/cron/GitHub", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    const forbidden = [
      /\btenant\b/i,
      /\badmin\b/i,
      /\bRLS\b/,
      /\bschema\b/i,
      /\bsupabase\b/i,
      /\bcron\b/i,
      /\bgithub\b/i,
    ];
    for (const p of r) {
      for (const re of forbidden) {
        expect(p.rationale).not.toMatch(re);
      }
    }
  });

  it("every prompt has a non-empty rationale", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    for (const p of r) {
      expect(p.rationale.length).toBeGreaterThan(0);
    }
  });
});

describe("generateStarterPrompts — distribution at saturation", () => {
  it("at the 25-cap, brand + competitor families are preserved (high priority)", () => {
    const r = generateStarterPrompts({
      businessName: "MaxBuilder",
      domain: "max.com",
      citiesServed: [
        "City1",
        "City2",
        "City3",
        "City4",
        "City5",
        "City6",
      ],
      projectMix: [
        "new_construction",
        "whole_home_remodel",
        "kitchen_bath",
        "adu_addition",
        "teardown_rebuild",
        "commercial_residential",
      ] as ProjectMixTag[],
      competitors: ["A", "B", "C", "D", "E"],
    });
    expect(r.length).toBe(STARTER_PROMPT_MAX_COUNT);
    // High-priority families always present at saturation.
    expect(r.filter((p) => p.cluster === "brand_discovery").length).toBe(2);
    expect(r.filter((p) => p.cluster === "competitor_comparison").length).toBe(
      5,
    );
    // Service-in-city saturates the rest.
    const sic = r.filter((p) => p.cluster === "service_in_city");
    expect(sic.length).toBeGreaterThan(0);
  });
});

describe("generateStarterPrompts — output shape", () => {
  it("each draft has all required fields with correct types", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    for (const p of r) {
      expect(typeof p.text).toBe("string");
      expect(typeof p.cluster).toBe("string");
      expect(typeof p.category).toBe("string");
      expect(p.cluster).toBe(p.category); // 1:1 mapping in v0
      expect(typeof p.priority).toBe("number");
      expect(typeof p.rationale).toBe("string");
      // city_scope and service_scope can be null
      expect(p.city_scope === null || typeof p.city_scope === "string").toBe(
        true,
      );
      expect(
        p.service_scope === null || typeof p.service_scope === "string",
      ).toBe(true);
    }
  });

  it("brand_discovery prompts have no city/service scope", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    for (const p of r) {
      if (p.cluster === "brand_discovery") {
        expect(p.city_scope).toBeNull();
        expect(p.service_scope).toBeNull();
      }
    }
  });

  it("competitor_comparison prompts have no city/service scope", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    for (const p of r) {
      if (p.cluster === "competitor_comparison") {
        expect(p.city_scope).toBeNull();
        expect(p.service_scope).toBeNull();
      }
    }
  });

  it("service_in_city prompts always have BOTH city + service scope", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    for (const p of r) {
      if (p.cluster === "service_in_city") {
        expect(p.city_scope).not.toBeNull();
        expect(p.service_scope).not.toBeNull();
      }
    }
  });

  it("cost_query prompts always have BOTH city + service scope", () => {
    const r = generateStarterPrompts(RICH_INPUT);
    for (const p of r) {
      if (p.cluster === "cost_query") {
        expect(p.city_scope).not.toBeNull();
        expect(p.service_scope).not.toBeNull();
      }
    }
  });
});

describe("generateStarterPrompts — output type narrowing helper", () => {
  it("PromptDraft type is fully exported (compile-time check via cast)", () => {
    const sample: PromptDraft = {
      text: "x",
      cluster: "brand_discovery",
      city_scope: null,
      service_scope: null,
      category: "brand_discovery",
      priority: 1,
      rationale: "y",
    };
    expect(sample.text).toBe("x");
  });
});

// ── North-star onboarding (2026-06-11): SITE-DERIVED services/industry ──

describe("generateStarterPrompts — site-derived services (vertical-agnostic)", () => {
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
    expect(texts).toContain("best catering in Tucson");
    expect(texts).toContain("best taco bar in Tucson");
    expect(texts).toContain("how much does catering cost in Tucson");
  });

  it("region codes never become prompt cities ('best catering in AZ' is banned)", () => {
    const texts = generateStarterPrompts(restaurant).map((d) => d.text);
    expect(texts.some((t) => / in AZ$/.test(t))).toBe(false);
  });

  it("derived prompts carry city_scope but a null service_scope (not a ProjectMixTag)", () => {
    const derived = generateStarterPrompts(restaurant).filter((d) =>
      d.text.includes("taco bar"),
    );
    expect(derived.length).toBeGreaterThan(0);
    for (const d of derived) {
      expect(d.city_scope).toBe("Tucson");
      expect(d.service_scope).toBeNull();
    }
  });

  it("no cities → no derived service-in-city prompts (brand-only is honest)", () => {
    const texts = generateStarterPrompts({
      ...restaurant,
      citiesServed: [],
    }).map((d) => d.text);
    expect(texts.some((t) => t.startsWith("best "))).toBe(false);
    expect(texts).toContain("La Palma Taqueria reviews");
  });

  it("derived phrases that duplicate builder-tag prompts never double-emit", () => {
    const drafts = generateStarterPrompts({
      businessName: "Acme Builders",
      domain: "acme.com",
      citiesServed: ["Boerne"],
      projectMix: ["whole_home_remodel"],
      competitors: [],
      derivedServices: ["home remodel"], // same phrase the tag emits
      industry: null,
    });
    const matching = drafts.filter((d) => d.text === "best home remodel in Boerne");
    expect(matching).toHaveLength(1);
  });

  it("stays deterministic and ≤25 with derived inputs", () => {
    const a = generateStarterPrompts(restaurant);
    const b = generateStarterPrompts(restaurant);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(25);
  });
});
