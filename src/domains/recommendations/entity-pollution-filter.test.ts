import { describe, expect, it } from "vitest";
import {
  buildEntityLookupByName,
  isDirectoryEntity,
  makeCompetitorRankingFilter,
  shouldExcludeFromCompetitorRanking,
  DIRECTORY_DOMAINS_FOR_FILTER,
} from "./entity-pollution-filter";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

function entity(overrides: Partial<TrackedEntity>): TrackedEntity {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2, 6)}`,
    account_id: "acct-test",
    entity_type: overrides.entity_type ?? "competitor",
    name: overrides.name ?? "Sample Co",
    aliases: overrides.aliases,
    domain: overrides.domain ?? null,
    url: null,
    location_scope: null,
    service_scope: null,
    is_owned: overrides.is_owned ?? false,
    is_active: overrides.is_active ?? true,
    metadata: overrides.metadata ?? {},
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("isDirectoryEntity", () => {
  it("flags entity_type='directory_source'", () => {
    expect(
      isDirectoryEntity(
        entity({ name: "Houzz", entity_type: "directory_source" }),
      ),
    ).toBe(true);
  });

  it("flags blocklisted domains regardless of entity_type", () => {
    // Defensive: even if registry mistypes Houzz as "competitor", domain
    // check still excludes it from competitor ranking.
    expect(
      isDirectoryEntity(
        entity({ name: "Houzz", entity_type: "competitor", domain: "houzz.com" }),
      ),
    ).toBe(true);
  });

  it("normalizes www.- prefix on domains", () => {
    expect(
      isDirectoryEntity(
        entity({ name: "Yelp", entity_type: "competitor", domain: "www.yelp.com" }),
      ),
    ).toBe(true);
  });

  it("returns false for real builders", () => {
    expect(
      isDirectoryEntity(
        entity({
          name: "De Mattei Construction",
          entity_type: "competitor",
          domain: "demattei.com",
        }),
      ),
    ).toBe(false);
  });
});

describe("shouldExcludeFromCompetitorRanking — Step 1.4", () => {
  // ── Directories ─────────────────────────────────────────────────────
  it("excludes Houzz when metadata says directory_source", () => {
    expect(
      shouldExcludeFromCompetitorRanking(
        "Houzz",
        entity({ name: "Houzz", entity_type: "directory_source", domain: "houzz.com" }),
      ),
    ).toBe(true);
  });

  it("excludes Yelp / Angi / BuildZoom by entity_type", () => {
    for (const e of [
      entity({ name: "Yelp", entity_type: "directory_source", domain: "yelp.com" }),
      entity({ name: "Angi", entity_type: "directory_source", domain: "angi.com" }),
      entity({
        name: "BuildZoom",
        entity_type: "directory_source",
        domain: "buildzoom.com",
      }),
    ]) {
      expect(shouldExcludeFromCompetitorRanking(e.name, e)).toBe(true);
    }
  });

  // ── Real competitors ────────────────────────────────────────────────
  it("keeps De Mattei / Kasten / Supple Homes when metadata says competitor", () => {
    for (const e of [
      entity({
        name: "De Mattei Construction",
        entity_type: "competitor",
        domain: "demattei.com",
      }),
      entity({
        name: "Kasten Builders",
        entity_type: "competitor",
        domain: "kastenbuilders.com",
      }),
      entity({
        name: "Supple Homes",
        entity_type: "competitor",
        domain: "supplehomesinc.com",
      }),
    ]) {
      expect(shouldExcludeFromCompetitorRanking(e.name, e)).toBe(false);
    }
  });

  // ── Generic nouns ───────────────────────────────────────────────────
  it("excludes 'General Contractors' when no entity is supplied", () => {
    expect(shouldExcludeFromCompetitorRanking("General Contractors")).toBe(
      true,
    );
  });

  it("excludes 'Local Contractors' / 'Home Builders' / 'Architects' by name fallback", () => {
    expect(shouldExcludeFromCompetitorRanking("Local Contractors")).toBe(true);
    expect(shouldExcludeFromCompetitorRanking("Home Builders")).toBe(true);
    expect(shouldExcludeFromCompetitorRanking("Architects")).toBe(true);
  });

  it("is case-insensitive on the generic-noun list", () => {
    expect(shouldExcludeFromCompetitorRanking("general CONTRACTORS")).toBe(
      true,
    );
    expect(shouldExcludeFromCompetitorRanking("  Bay Area Builders  ")).toBe(
      true,
    );
  });

  // ── Real business with generic-ish name (the hard case) ─────────────
  it("KEEPS 'Bay Builders' when metadata indicates a real competitor", () => {
    // Generic-sounding name but registry has it tagged as a real builder
    // with a domain. Trust metadata over name heuristics (rule #2 in the
    // operator brief).
    expect(
      shouldExcludeFromCompetitorRanking(
        "Bay Builders",
        entity({
          name: "Bay Builders",
          entity_type: "competitor",
          domain: "baybuilders.com",
        }),
      ),
    ).toBe(false);
  });

  it("KEEPS 'Custom Home US' when registry tags it competitor + domain", () => {
    expect(
      shouldExcludeFromCompetitorRanking(
        "Custom Home US",
        entity({
          name: "Custom Home US",
          entity_type: "competitor",
          domain: "customhome.us",
        }),
      ),
    ).toBe(false);
  });

  // ── Unknown mention with no entity row ──────────────────────────────
  it("keeps a real-named mention with no entity row (e.g. 'De Mattei')", () => {
    expect(shouldExcludeFromCompetitorRanking("De Mattei")).toBe(false);
  });

  // ── Domain blocklist sanity ─────────────────────────────────────────
  it("DIRECTORY_DOMAINS_FOR_FILTER stays aligned with audit blocklist", () => {
    // Spot-check the eight names the founder explicitly named.
    for (const d of [
      "houzz.com",
      "yelp.com",
      "angi.com",
      "thumbtack.com",
      "bbb.org",
      "buildzoom.com",
      "homeadvisor.com",
      "generalcontractors.org",
    ]) {
      expect(DIRECTORY_DOMAINS_FOR_FILTER.has(d)).toBe(true);
    }
  });
});

describe("makeCompetitorRankingFilter — predicate factory", () => {
  it("returns true for ranking-eligible names, false for excluded", () => {
    const trackedEntities: TrackedEntity[] = [
      entity({
        name: "Houzz",
        entity_type: "directory_source",
        domain: "houzz.com",
      }),
      entity({
        name: "De Mattei Construction",
        entity_type: "competitor",
        domain: "demattei.com",
      }),
    ];
    const filter = makeCompetitorRankingFilter(trackedEntities);
    expect(filter("Houzz")).toBe(false); // excluded
    expect(filter("De Mattei Construction")).toBe(true); // kept
    expect(filter("General Contractors")).toBe(false); // generic noun, no entity
    expect(filter("Mystery Builder")).toBe(true); // real-named, no entity → kept
  });

  it("resolves aliases through the lookup", () => {
    const trackedEntities: TrackedEntity[] = [
      entity({
        name: "Houzz",
        entity_type: "directory_source",
        domain: "houzz.com",
        aliases: ["HOUZZ", "houzz.com"],
      }),
    ];
    const filter = makeCompetitorRankingFilter(trackedEntities);
    expect(filter("HOUZZ")).toBe(false);
    expect(filter("houzz.com")).toBe(false);
  });
});

describe("buildEntityLookupByName", () => {
  it("indexes by normalized name and aliases", () => {
    const lookup = buildEntityLookupByName([
      entity({ name: "Acme Builders", aliases: ["Acme", "acme construction"] }),
    ]);
    expect(lookup.has("acme builders")).toBe(true);
    expect(lookup.has("acme")).toBe(true);
    expect(lookup.has("acme construction")).toBe(true);
  });

  it("first-write-wins on collisions", () => {
    const a = entity({ id: "first", name: "Same Name" });
    const b = entity({ id: "second", name: "Same Name" });
    const lookup = buildEntityLookupByName([a, b]);
    expect(lookup.get("same name")?.id).toBe("first");
  });
});
