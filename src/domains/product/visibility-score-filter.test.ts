import { describe, expect, it } from "vitest";
import { computeLeaderboard } from "./visibility-score";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

/**
 * Step 1.4 (master plan) — leaderboard integration with the entity
 * pollution filter. Asserts directories drop out of competitor rows
 * while real builders survive, and that name-only generic nouns are
 * filtered when no entity registry classifies them.
 */

const BRAND = "Ritz Builders";

function obs(opts: {
  date: string;
  brandMentioned: boolean;
  mentions?: string[];
  platform?: string;
}): PromptAnswerObservation {
  return {
    id: `obs-${opts.date}-${Math.random().toString(36).slice(2, 8)}`,
    prompt_id: "p-1",
    platform: opts.platform ?? "perplexity",
    observed_at: `${opts.date}T12:00:00Z`,
    answer_text: "",
    citations: [],
    citation_domains: [],
    mentions: opts.mentions ?? (opts.brandMentioned ? [BRAND] : []),
    tracked_brand_mentioned: opts.brandMentioned,
    tracked_brand_cited: false,
    position: 1,
    metadata: null,
  } as unknown as PromptAnswerObservation;
}

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

/**
 * Build a 14-day dense observation set:
 *   - days -27..-14 (previous window) — same mention pattern
 *   - days -13..0   (current window)  — same mention pattern
 * Each day: brand mentioned in 1 obs; competitors mentioned per `mix`.
 */
function buildObservations(
  windowEndDate: string,
  windowDays: number,
  mix: ReadonlyArray<string>,
): PromptAnswerObservation[] {
  const out: PromptAnswerObservation[] = [];
  const end = new Date(windowEndDate + "T00:00:00Z");
  for (let off = -(2 * windowDays - 1); off <= 0; off++) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() + off);
    const date = d.toISOString().slice(0, 10);
    out.push(obs({ date, brandMentioned: true }));
    for (const name of mix) {
      out.push(obs({ date, brandMentioned: false, mentions: [name] }));
    }
  }
  return out;
}

describe("computeLeaderboard — Step 1.4 entity pollution filter", () => {
  it("excludes Houzz from competitor rows when registry tags it directory_source", () => {
    const observations = buildObservations("2026-04-28", 7, [
      "Houzz",
      "De Mattei Construction",
    ]);
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
    const rows = computeLeaderboard({
      observations,
      brandAliases: [BRAND],
      windowEndDate: "2026-04-28",
      windowDays: 7,
      metric: "mention_rate",
      trackedEntities,
    });
    const names = rows.map((r) => r.name);
    expect(names).not.toContain("Houzz");
    expect(names).toContain("De Mattei Construction");
  });

  it("excludes Yelp / Angi / BuildZoom while keeping Kasten + Supple", () => {
    const observations = buildObservations("2026-04-28", 7, [
      "Yelp",
      "Angi",
      "BuildZoom",
      "Kasten Builders",
      "Supple Homes",
    ]);
    const trackedEntities: TrackedEntity[] = [
      entity({ name: "Yelp", entity_type: "directory_source", domain: "yelp.com" }),
      entity({ name: "Angi", entity_type: "directory_source", domain: "angi.com" }),
      entity({
        name: "BuildZoom",
        entity_type: "directory_source",
        domain: "buildzoom.com",
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
    ];
    const rows = computeLeaderboard({
      observations,
      brandAliases: [BRAND],
      windowEndDate: "2026-04-28",
      windowDays: 7,
      metric: "mention_rate",
      trackedEntities,
    });
    const names = rows.map((r) => r.name);
    expect(names).not.toContain("Yelp");
    expect(names).not.toContain("Angi");
    expect(names).not.toContain("BuildZoom");
    expect(names).toContain("Kasten Builders");
    expect(names).toContain("Supple Homes");
  });

  it('excludes "General Contractors" by name when no registry entry exists', () => {
    const observations = buildObservations("2026-04-28", 7, [
      "General Contractors",
      "De Mattei Construction",
    ]);
    // Note: no trackedEntities supplied — so the filter falls back to the
    // strict generic-noun list.
    const rows = computeLeaderboard({
      observations,
      brandAliases: [BRAND],
      windowEndDate: "2026-04-28",
      windowDays: 7,
      metric: "mention_rate",
      trackedEntities: [],
    });
    const names = rows.map((r) => r.name);
    expect(names).not.toContain("General Contractors");
    expect(names).toContain("De Mattei Construction");
  });

  it("KEEPS a real company with generic-ish name when metadata classifies it competitor", () => {
    // "Bay Builders" sounds generic, but registry has a real domain.
    const observations = buildObservations("2026-04-28", 7, ["Bay Builders"]);
    const trackedEntities: TrackedEntity[] = [
      entity({
        name: "Bay Builders",
        entity_type: "competitor",
        domain: "baybuilders.com",
      }),
    ];
    const rows = computeLeaderboard({
      observations,
      brandAliases: [BRAND],
      windowEndDate: "2026-04-28",
      windowDays: 7,
      metric: "mention_rate",
      trackedEntities,
    });
    const names = rows.map((r) => r.name);
    expect(names).toContain("Bay Builders");
  });

  it("brand row still renders when supplied filter excludes everything else", () => {
    const observations = buildObservations("2026-04-28", 7, [
      "Houzz",
      "Yelp",
      "Angi",
    ]);
    const trackedEntities: TrackedEntity[] = [
      entity({ name: "Houzz", entity_type: "directory_source", domain: "houzz.com" }),
      entity({ name: "Yelp", entity_type: "directory_source", domain: "yelp.com" }),
      entity({ name: "Angi", entity_type: "directory_source", domain: "angi.com" }),
    ];
    const rows = computeLeaderboard({
      observations,
      brandAliases: [BRAND],
      windowEndDate: "2026-04-28",
      windowDays: 7,
      metric: "mention_rate",
      trackedEntities,
    });
    const brand = rows.find((r) => r.isOwned);
    expect(brand).toBeDefined();
    // No competitors survive the filter.
    expect(rows.filter((r) => !r.isOwned)).toHaveLength(0);
  });

  it("legacy callers that don't pass trackedEntities preserve unfiltered behaviour", () => {
    // Only generic-noun names from the strict list should drop. Real-
    // named directories (without metadata) are kept — defensive default
    // for non-Today consumers.
    const observations = buildObservations("2026-04-28", 7, [
      "Houzz",
      "General Contractors",
    ]);
    const rows = computeLeaderboard({
      observations,
      brandAliases: [BRAND],
      windowEndDate: "2026-04-28",
      windowDays: 7,
      metric: "mention_rate",
      // trackedEntities omitted on purpose.
    });
    const names = rows.map((r) => r.name);
    // Houzz keeps because we have no metadata to classify it (legacy
    // safety) — Today always passes trackedEntities, so /today is fine.
    expect(names).toContain("Houzz");
    // Generic-noun list still drops "General Contractors" by name.
    expect(names).not.toContain("General Contractors");
  });
});
