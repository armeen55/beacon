import { describe, it, expect } from "vitest";
import { SEED_OWNER_TENANT_ID } from "@/lib/demo-mode";
import type { Result } from "@/domains/results/types";
import * as resultMode from "./result-mode";
import { classifyResultMode, partitionResultsByMode } from "./result-mode";

/**
 * Finding D (2026-07-18): result-mode used a process-global mutable
 * `visibilityPrefixes/visibilityPatterns` pair that a `configureVisibilityRules`
 * setter could flip for every later tenant in the same warm lambda, and the
 * Ritz-specific Bay-Area patterns applied to EVERY tenant globally. The mutable
 * state + setter are removed; the Bay-Area patterns apply only to the founder
 * tenant, resolved at call time (no shared state to mutate).
 */

function result(topic: string): Result {
  return { topic } as unknown as Result;
}

describe("result-mode — no cross-tenant mutable state (finding D)", () => {
  it("removed the configureVisibilityRules / resetVisibilityRules setters entirely", () => {
    // If these come back, so does the process-global mutation hazard.
    expect((resultMode as Record<string, unknown>).configureVisibilityRules).toBeUndefined();
    expect((resultMode as Record<string, unknown>).resetVisibilityRules).toBeUndefined();
  });

  it("applies the Ritz Bay-Area patterns ONLY to the founder tenant", () => {
    const bayArea = result("Custom Home Building (Bay Area)");
    // Founder → visibility (broad geo aggregate suppressed from attribution).
    expect(classifyResultMode(bayArea, SEED_OWNER_TENANT_ID)).toBe("visibility");
    // A different tenant → attribution: the Ritz pattern must NOT leak onto them.
    expect(classifyResultMode(bayArea, "tenant-iranopedia")).toBe("attribution");
    // No tenant supplied → generic rules only (Bay-Area not applied).
    expect(classifyResultMode(bayArea)).toBe("attribution");
  });

  it("applies the generic shield: prefix to every tenant", () => {
    const shielded = result("shield: broad topic");
    expect(classifyResultMode(shielded, SEED_OWNER_TENANT_ID)).toBe("visibility");
    expect(classifyResultMode(shielded, "tenant-iranopedia")).toBe("visibility");
    expect(classifyResultMode(shielded)).toBe("visibility");
  });

  it("classifying for one tenant cannot change classification for another (no shared state)", () => {
    const bayArea = result("Kitchen remodel bay area");
    // Interleave founder and non-founder calls: each is independent.
    expect(classifyResultMode(bayArea, SEED_OWNER_TENANT_ID)).toBe("visibility");
    expect(classifyResultMode(bayArea, "tenant-iranopedia")).toBe("attribution");
    expect(classifyResultMode(bayArea, SEED_OWNER_TENANT_ID)).toBe("visibility");
    expect(classifyResultMode(bayArea, "tenant-iranopedia")).toBe("attribution");
  });

  it("partitionResultsByMode threads the tenant to classification", () => {
    const results = [result("shield: x"), result("Nowruz history"), result("Deck build (Bay Area)")];
    const founder = partitionResultsByMode(results, SEED_OWNER_TENANT_ID);
    const other = partitionResultsByMode(results, "tenant-iranopedia");
    // Founder suppresses both shield: and the Bay-Area row.
    expect(founder.visibility).toHaveLength(2);
    expect(founder.attribution).toHaveLength(1);
    // Other tenant only suppresses shield: (Bay-Area is attribution-eligible).
    expect(other.visibility).toHaveLength(1);
    expect(other.attribution).toHaveLength(2);
  });
});
