import { describe, it, expect } from "vitest";
import {
  buildDailySnapshotsFromObservations,
  entityToScopeId,
} from "./build-from-observations";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

function makeObs(
  overrides: Partial<PromptAnswerObservation> = {},
): PromptAnswerObservation {
  return {
    id: "obs-default",
    prompt_id: "p-default",
    run_id: "run-default",
    answer_hash: "hash-default",
    position: null,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    observed_at: "2026-04-22T22:00:00Z",
    platform: "perplexity",
    topic: "",
    metadata: {},
    tenant_id: "tenant-ritz-founder",
    ...overrides,
  };
}

function makeEntity(overrides: Partial<TrackedEntity> = {}): TrackedEntity {
  return {
    id: "e-default",
    account_id: "ritz-builders",
    entity_type: "competitor",
    name: "Default Entity",
    domain: "default.example",
    url: null,
    location_scope: null,
    service_scope: null,
    is_owned: false,
    is_active: true,
    metadata: {},
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

const OWNED = makeEntity({
  id: "own-ritzbuilders-com",
  entity_type: "brand",
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  is_owned: true,
});
const SUPPLE = makeEntity({
  id: "comp-supplehomesinc-com",
  name: "Supple Homes",
  domain: "supplehomesinc.com",
});
const DEMATTEI = makeEntity({
  id: "comp-demattei-com",
  name: "De Mattei Construction",
  domain: "demattei.com",
});

describe("entityToScopeId", () => {
  it("strips the entity-type prefix and common TLD suffix", () => {
    expect(entityToScopeId(OWNED)).toBe("ritzbuilders");
    expect(entityToScopeId(DEMATTEI)).toBe("demattei");
    expect(entityToScopeId(makeEntity({ id: "dir-angi-com" }))).toBe("angi");
  });

  it("leaves non-TLD tail intact", () => {
    expect(
      entityToScopeId(makeEntity({ id: "comp-greenberg-construction" })),
    ).toBe("greenberg-construction");
    expect(
      entityToScopeId(makeEntity({ id: "comp-feldman-construction" })),
    ).toBe("feldman-construction");
  });

  it("falls back to raw id when no prefix/TLD pattern matches", () => {
    expect(entityToScopeId(makeEntity({ id: "rogue-id-pattern" }))).toBe(
      "rogue-id-pattern",
    );
  });
});

describe("buildDailySnapshotsFromObservations", () => {
  it("emits one row per active entity with correct counts", () => {
    const observations: PromptAnswerObservation[] = [
      makeObs({
        id: "o1",
        mentions: ["Ritz Builders", "Supple Homes"],
        citation_domains: ["ritzbuilders.com", "supplehomesinc.com"],
      }),
      makeObs({
        id: "o2",
        mentions: ["Ritz Builders"],
        citation_domains: ["ritzbuilders.com"],
      }),
      makeObs({
        id: "o3",
        mentions: ["Supple Homes"],
        citation_domains: [],
      }),
    ];

    const rows = buildDailySnapshotsFromObservations({
      tenantId: "tenant-ritz-founder",
      platform: "Perplexity",
      observations,
      trackedEntities: [OWNED, SUPPLE],
      date: "2026-04-22",
      observationRunId: "pollrun-xyz",
    });

    expect(rows).toHaveLength(2);

    const ritz = rows.find((r) => r.scope_id === "ritzbuilders")!;
    expect(ritz.id).toBe("derived-2026-04-22-ritzbuilders-perplexity");
    expect(ritz.date).toBe("2026-04-22");
    expect(ritz.scope_type).toBe("entity");
    expect(ritz.platform).toBe("Perplexity");
    expect(ritz.source_type).toBe("derived");
    expect(ritz.mention_count).toBe(2);
    expect(ritz.citation_count).toBe(2);
    expect(ritz.total_possible).toBe(3);
    expect(ritz.visibility_score).toBeNull();
    expect(ritz.share_of_voice).toBeNull();
    expect(ritz.avg_position).toBeNull();
    expect(ritz.tenant_id).toBe("tenant-ritz-founder");
    expect(ritz.metadata).toMatchObject({
      source_system: "beacon_native",
      derived_from_run_id: "pollrun-xyz",
      entity_id: "own-ritzbuilders-com",
      entity_type: "brand",
      is_owned: true,
    });

    const supple = rows.find((r) => r.scope_id === "supplehomesinc")!;
    expect(supple.mention_count).toBe(2);
    expect(supple.citation_count).toBe(1);
    expect(supple.total_possible).toBe(3);
    expect(supple.metadata).toMatchObject({
      is_owned: false,
      entity_type: "competitor",
    });
  });

  it("skips inactive entities", () => {
    const INACTIVE = makeEntity({
      id: "comp-inactive-com",
      name: "Gone Inc",
      is_active: false,
    });
    const rows = buildDailySnapshotsFromObservations({
      tenantId: "t",
      platform: "Perplexity",
      observations: [],
      trackedEntities: [OWNED, INACTIVE],
      date: "2026-04-22",
      observationRunId: "r",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].scope_id).toBe("ritzbuilders");
  });

  it("zero observations → zero counts but entities still get rows (total_possible = 0)", () => {
    const rows = buildDailySnapshotsFromObservations({
      tenantId: "t",
      platform: "Perplexity",
      observations: [],
      trackedEntities: [OWNED, SUPPLE],
      date: "2026-04-22",
      observationRunId: "r",
    });

    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.mention_count).toBe(0);
      expect(r.citation_count).toBe(0);
      expect(r.total_possible).toBe(0);
    }
  });

  it("entity with no domain: citation_count stays 0", () => {
    const NO_DOMAIN = makeEntity({
      id: "comp-nodomain",
      name: "No Domain Co",
      domain: null,
    });
    const obs = makeObs({
      mentions: ["No Domain Co"],
      citation_domains: ["random.example"],
    });

    const rows = buildDailySnapshotsFromObservations({
      tenantId: "t",
      platform: "Perplexity",
      observations: [obs],
      trackedEntities: [NO_DOMAIN],
      date: "2026-04-22",
      observationRunId: "r",
    });

    expect(rows[0].mention_count).toBe(1);
    expect(rows[0].citation_count).toBe(0);
  });

  it("citation domain match is case-insensitive", () => {
    const obs = makeObs({
      mentions: [],
      citation_domains: ["RitzBuilders.com", "RITZBUILDERS.COM"],
    });

    const rows = buildDailySnapshotsFromObservations({
      tenantId: "t",
      platform: "Perplexity",
      observations: [obs],
      trackedEntities: [OWNED],
      date: "2026-04-22",
      observationRunId: "r",
    });

    expect(rows[0].citation_count).toBe(1);
  });

  it("deterministic IDs — same inputs produce the same id (idempotent upserts)", () => {
    const args = {
      tenantId: "t",
      platform: "Perplexity",
      observations: [] as PromptAnswerObservation[],
      trackedEntities: [OWNED, SUPPLE, DEMATTEI],
      date: "2026-04-22",
      observationRunId: "r",
    };
    const first = buildDailySnapshotsFromObservations(args);
    const second = buildDailySnapshotsFromObservations(args);
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  });

  it("platform label propagates + is slugified correctly in id", () => {
    const gaio = buildDailySnapshotsFromObservations({
      tenantId: "t",
      platform: "Google AI Overviews",
      observations: [],
      trackedEntities: [OWNED],
      date: "2026-04-22",
      observationRunId: "r",
    });
    expect(gaio[0].platform).toBe("Google AI Overviews");
    expect(gaio[0].id).toBe("derived-2026-04-22-ritzbuilders-google-ai-overviews");
  });
});
