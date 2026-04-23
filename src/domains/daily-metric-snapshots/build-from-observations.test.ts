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
        citation_count: 2,
      }),
      makeObs({
        id: "o2",
        mentions: ["Ritz Builders"],
        citation_domains: ["ritzbuilders.com"],
        citation_count: 1,
      }),
      makeObs({
        id: "o3",
        mentions: ["Supple Homes"],
        citation_domains: [],
        citation_count: 0,
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

    const entityRows = rows.filter((r) => r.scope_type === "entity");
    expect(entityRows).toHaveLength(2);

    const ritz = entityRows.find((r) => r.scope_id === "ritzbuilders")!;
    expect(ritz.id).toBe("derived-2026-04-22-ritzbuilders-perplexity");
    expect(ritz.date).toBe("2026-04-22");
    expect(ritz.scope_type).toBe("entity");
    expect(ritz.platform).toBe("Perplexity");
    expect(ritz.source_type).toBe("derived");
    expect(ritz.mention_count).toBe(2);
    expect(ritz.citation_count).toBe(2);
    expect(ritz.total_possible).toBe(3);
    // visibility_score = mention_rate × 100 = 2/3 × 100 = 66.67 (2 decimals)
    expect(ritz.visibility_score).toBeCloseTo(66.67, 2);
    // total citations in run = 2 + 1 + 0 = 3; ritz's citation_count = 2
    // share_of_voice = 2/3 × 100 = 66.67
    expect(ritz.share_of_voice).toBeCloseTo(66.67, 2);
    expect(ritz.avg_position).toBeNull();
    expect(ritz.tenant_id).toBe("tenant-ritz-founder");
    expect(ritz.metadata).toMatchObject({
      source_system: "beacon_native",
      derived_from_run_id: "pollrun-xyz",
      entity_id: "own-ritzbuilders-com",
      entity_type: "brand",
      is_owned: true,
    });

    const supple = entityRows.find((r) => r.scope_id === "supplehomesinc")!;
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

    const entityRow = rows.find((r) => r.scope_type === "entity")!;
    expect(entityRow.mention_count).toBe(1);
    expect(entityRow.citation_count).toBe(0);
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

    const entityRow = rows.find((r) => r.scope_type === "entity")!;
    expect(entityRow.citation_count).toBe(1);
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
    const entityRow = gaio.find((r) => r.scope_type === "entity")!;
    expect(entityRow.platform).toBe("Google AI Overviews");
    expect(entityRow.id).toBe(
      "derived-2026-04-22-ritzbuilders-google-ai-overviews",
    );
  });

  // ── v0 formula (Phase 3 Step 1): visibility_score + share_of_voice ──

  it("Ritz-like case: 53 mentions / 100 prompts → visibility_score = 53.0", () => {
    // Simulate the Apr 22 Perplexity run shape at 1/10 scale: 10 observations,
    // 5 of which contain "Ritz Builders" in mentions, ritzbuilders.com cited
    // in 6. Total citations across the run = 10 observations × 3 citations
    // each = 30 → SOV for ritz = 6/30 × 100 = 20.0.
    const obs: PromptAnswerObservation[] = Array.from({ length: 10 }, (_, i) =>
      makeObs({
        id: `o-${i}`,
        mentions: i < 5 ? ["Ritz Builders"] : [],
        citation_domains:
          i < 6
            ? ["ritzbuilders.com", "houzz.com", "yelp.com"]
            : ["houzz.com", "yelp.com", "other.com"],
        citation_count: 3,
      }),
    );

    const rows = buildDailySnapshotsFromObservations({
      tenantId: "t",
      platform: "Perplexity",
      observations: obs,
      trackedEntities: [OWNED],
      date: "2026-04-22",
      observationRunId: "r",
    });

    const ritz = rows.find(
      (r) => r.scope_type === "entity" && r.scope_id === "ritzbuilders",
    )!;
    expect(ritz.mention_count).toBe(5);
    expect(ritz.citation_count).toBe(6);
    expect(ritz.total_possible).toBe(10);
    expect(ritz.visibility_score).toBeCloseTo(50.0, 2); // 5/10 × 100
    expect(ritz.share_of_voice).toBeCloseTo(20.0, 2); // 6/30 × 100
  });

  it("null-safe: total_possible=0 → visibility_score null; total_citations=0 → share_of_voice null", () => {
    // Observations exist but all have 0 citations (e.g., Perplexity answer
    // with no sources — rare but possible). mention_count path stays valid;
    // citation-based SOV must be null, not 0 or NaN.
    const obsNoCitations: PromptAnswerObservation[] = [
      makeObs({ id: "o1", mentions: ["Ritz Builders"], citation_count: 0 }),
      makeObs({ id: "o2", mentions: [], citation_count: 0 }),
    ];
    const r1 = buildDailySnapshotsFromObservations({
      tenantId: "t",
      platform: "Perplexity",
      observations: obsNoCitations,
      trackedEntities: [OWNED],
      date: "2026-04-22",
      observationRunId: "r",
    });
    const r1Entity = r1.find((r) => r.scope_type === "entity")!;
    expect(r1Entity.visibility_score).toBeCloseTo(50.0, 2); // 1/2 × 100
    expect(r1Entity.share_of_voice).toBeNull();

    // Zero observations: both scores null (no denominator).
    const r2 = buildDailySnapshotsFromObservations({
      tenantId: "t",
      platform: "Perplexity",
      observations: [],
      trackedEntities: [OWNED],
      date: "2026-04-22",
      observationRunId: "r",
    });
    const r2Entity = r2.find((r) => r.scope_type === "entity")!;
    expect(r2Entity.visibility_score).toBeNull();
    expect(r2Entity.share_of_voice).toBeNull();
  });

  it("share_of_voice denominator is total citations across the run, not tracked-only", () => {
    // 2 observations, each with 5 citations. Ritz cited in 1 of the 2
    // (1 slot). SOV = 1/(5+5) × 100 = 10.0. Even though only 1 of the 10
    // citation slots was Ritz's owned domain, the remaining 9 slots include
    // untracked domains — denominator must still be 10.
    const obs: PromptAnswerObservation[] = [
      makeObs({
        id: "o1",
        citation_domains: [
          "ritzbuilders.com",
          "a.com",
          "b.com",
          "c.com",
          "d.com",
        ],
        citation_count: 5,
      }),
      makeObs({
        id: "o2",
        citation_domains: ["e.com", "f.com", "g.com", "h.com", "i.com"],
        citation_count: 5,
      }),
    ];
    const rows = buildDailySnapshotsFromObservations({
      tenantId: "t",
      platform: "Perplexity",
      observations: obs,
      trackedEntities: [OWNED],
      date: "2026-04-22",
      observationRunId: "r",
    });
    const entityRow = rows.find((r) => r.scope_type === "entity")!;
    expect(entityRow.citation_count).toBe(1);
    expect(entityRow.share_of_voice).toBeCloseTo(10.0, 2);
  });

  // ── Scope expansion (Phase 3 Step 2): topic + platform rows ──────────

  it("emits one topic row per distinct topic, with OWNED-BRAND metrics (not competitive)", () => {
    // Two topics: "builders" (3 obs) and "renovations" (2 obs).
    // Owned-brand rollup per topic: we use tracked_brand_mentioned and
    // owned_citation_count — NOT per-competitor sums.
    const obs: PromptAnswerObservation[] = [
      makeObs({
        id: "o1",
        topic: "builders",
        tracked_brand_mentioned: true,
        owned_citation_count: 1,
        citation_count: 3,
      }),
      makeObs({
        id: "o2",
        topic: "builders",
        tracked_brand_mentioned: true,
        owned_citation_count: 1,
        citation_count: 3,
      }),
      makeObs({
        id: "o3",
        topic: "builders",
        tracked_brand_mentioned: false,
        owned_citation_count: 0,
        citation_count: 2,
      }),
      makeObs({
        id: "o4",
        topic: "renovations",
        tracked_brand_mentioned: true,
        owned_citation_count: 2,
        citation_count: 5,
      }),
      makeObs({
        id: "o5",
        topic: "renovations",
        tracked_brand_mentioned: false,
        owned_citation_count: 0,
        citation_count: 4,
      }),
    ];

    const rows = buildDailySnapshotsFromObservations({
      tenantId: "t",
      platform: "Perplexity",
      observations: obs,
      trackedEntities: [OWNED],
      date: "2026-04-22",
      observationRunId: "r",
    });

    const topicRows = rows.filter((r) => r.scope_type === "topic");
    expect(topicRows).toHaveLength(2);

    const builders = topicRows.find((r) => r.scope_id === "builders")!;
    expect(builders.id).toBe(
      "derived-2026-04-22-topic-builders-perplexity",
    );
    expect(builders.total_possible).toBe(3);
    expect(builders.mention_count).toBe(2); // owned brand mentioned in 2/3
    expect(builders.citation_count).toBe(2); // owned citation sum = 1+1+0
    // visibility_score = 2/3 * 100 = 66.67
    expect(builders.visibility_score).toBeCloseTo(66.67, 2);
    // total citations in builders topic = 3+3+2 = 8; SOV = 2/8 * 100 = 25.0
    expect(builders.share_of_voice).toBeCloseTo(25.0, 2);
    expect(builders.avg_position).toBeNull();
    expect(builders.metadata).toMatchObject({
      scope_semantics: "owned_brand_rollup",
      derived_from_run_id: "r",
    });

    const renovations = topicRows.find((r) => r.scope_id === "renovations")!;
    expect(renovations.total_possible).toBe(2);
    expect(renovations.mention_count).toBe(1);
    expect(renovations.citation_count).toBe(2);
    expect(renovations.visibility_score).toBeCloseTo(50.0, 2);
    // total citations in renovations = 5+4 = 9; SOV = 2/9 * 100 = 22.22
    expect(renovations.share_of_voice).toBeCloseTo(22.22, 2);
  });

  it("empty topic string groups observations under scope_id='unknown'", () => {
    const obs: PromptAnswerObservation[] = [
      makeObs({
        id: "o1",
        topic: "",
        tracked_brand_mentioned: true,
        owned_citation_count: 1,
        citation_count: 2,
      }),
    ];
    const rows = buildDailySnapshotsFromObservations({
      tenantId: "t",
      platform: "Perplexity",
      observations: obs,
      trackedEntities: [OWNED],
      date: "2026-04-22",
      observationRunId: "r",
    });

    const topicRow = rows.find((r) => r.scope_type === "topic")!;
    expect(topicRow.scope_id).toBe("unknown");
    expect(topicRow.id).toBe("derived-2026-04-22-topic-unknown-perplexity");
    expect(topicRow.mention_count).toBe(1);
  });

  it("emits exactly one platform aggregate row with run-wide OWNED-BRAND metrics", () => {
    // 5 obs, 3 with owned brand mentioned, owned_citation_count totals to 4,
    // citation_count totals to 20.
    const obs: PromptAnswerObservation[] = [
      makeObs({
        id: "o1",
        topic: "t1",
        tracked_brand_mentioned: true,
        owned_citation_count: 1,
        citation_count: 4,
      }),
      makeObs({
        id: "o2",
        topic: "t1",
        tracked_brand_mentioned: true,
        owned_citation_count: 2,
        citation_count: 4,
      }),
      makeObs({
        id: "o3",
        topic: "t2",
        tracked_brand_mentioned: true,
        owned_citation_count: 1,
        citation_count: 4,
      }),
      makeObs({
        id: "o4",
        topic: "t2",
        tracked_brand_mentioned: false,
        owned_citation_count: 0,
        citation_count: 4,
      }),
      makeObs({
        id: "o5",
        topic: "t3",
        tracked_brand_mentioned: false,
        owned_citation_count: 0,
        citation_count: 4,
      }),
    ];

    const rows = buildDailySnapshotsFromObservations({
      tenantId: "t",
      platform: "Perplexity",
      observations: obs,
      trackedEntities: [OWNED],
      date: "2026-04-22",
      observationRunId: "r",
    });

    const platformRows = rows.filter((r) => r.scope_type === "platform");
    expect(platformRows).toHaveLength(1);

    const p = platformRows[0];
    expect(p.id).toBe("derived-2026-04-22-platform-perplexity");
    expect(p.scope_id).toBe("Perplexity");
    expect(p.platform).toBe("Perplexity");
    expect(p.total_possible).toBe(5);
    expect(p.mention_count).toBe(3); // owned-brand mentions
    expect(p.citation_count).toBe(4); // owned_citation_count sum
    expect(p.visibility_score).toBeCloseTo(60.0, 2); // 3/5 * 100
    // total citations = 20; SOV = 4/20 * 100 = 20.0
    expect(p.share_of_voice).toBeCloseTo(20.0, 2);
    expect(p.avg_position).toBeNull();
    expect(p.metadata).toMatchObject({
      scope_semantics: "owned_brand_rollup",
    });
  });

  it("no topic or platform rows when there are zero observations", () => {
    const rows = buildDailySnapshotsFromObservations({
      tenantId: "t",
      platform: "Perplexity",
      observations: [],
      trackedEntities: [OWNED, SUPPLE],
      date: "2026-04-22",
      observationRunId: "r",
    });

    expect(rows.filter((r) => r.scope_type === "topic")).toHaveLength(0);
    expect(rows.filter((r) => r.scope_type === "platform")).toHaveLength(0);
    // Entity rows still emitted regardless of observations
    expect(rows.filter((r) => r.scope_type === "entity")).toHaveLength(2);
  });
});
