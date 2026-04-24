import { describe, it, expect } from "vitest";

import { generateRecommendations } from "@/domains/recommendations/generate";
import { buildPromptDecisionMatrix } from "@/domains/prompts/decision-matrix";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

const NOW = new Date("2026-04-24T12:00:00Z");

function mkPrompt(overrides: Partial<TrackedPrompt> & { id: string }): TrackedPrompt {
  return {
    account_id: "ritz",
    text: `prompt ${overrides.id}`,
    topic_id: "default-topic",
    location_scope: null,
    service_scope: null,
    intent_type: "recommendation",
    platforms: ["perplexity", "chatgpt"],
    tags: [],
    is_active: true,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

function mkEntity(
  overrides: Partial<TrackedEntity> & { id: string; name: string },
): TrackedEntity {
  return {
    account_id: "ritz",
    entity_type: "competitor",
    domain: null,
    url: null,
    aliases: [],
    location_scope: null,
    service_scope: null,
    is_owned: false,
    is_active: true,
    metadata: {},
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

const RITZ = mkEntity({
  id: "e-r",
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  entity_type: "brand",
  is_owned: true,
});
const CRC = mkEntity({ id: "e-c", name: "CRC Builders" });
const HOMESTEAD = mkEntity({ id: "e-h", name: "Homestead" });
const ENTITIES = [RITZ, CRC, HOMESTEAD];

function absentObs(pid: string, i: number, platform = "perplexity"): PromptAnswerObservation {
  return {
    id: `${pid}-${platform}-${i}`,
    prompt_id: pid,
    run_id: "r",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    observed_at: `2026-04-23T${String(10 + i).padStart(2, "0")}:00:00Z`,
    platform,
    topic: "",
    metadata: {},
    tenant_id: "t",
    primary_recommendation: false,
    citation_rank: null,
    competitor_co_mentions: ["CRC Builders", "Homestead"],
  };
}

function closeObs(pid: string, i: number): PromptAnswerObservation {
  return {
    ...absentObs(pid, i),
    tracked_brand_mentioned: true,
    tracked_brand_cited: true,
    citation_rank: 3,
    descriptor_window: ["luxury", "custom", "modern"],
    competitor_co_mentions: [],
  };
}

function winningObs(pid: string, i: number): PromptAnswerObservation {
  return {
    ...absentObs(pid, i),
    primary_recommendation: true,
    tracked_brand_mentioned: true,
    tracked_brand_cited: true,
    citation_rank: 1,
    descriptor_window: ["modern", "trusted"],
    competitor_co_mentions: [],
  };
}

function runMatrix(
  prompts: TrackedPrompt[],
  observations: PromptAnswerObservation[],
) {
  return buildPromptDecisionMatrix({
    prompts,
    observations,
    activeEntities: ENTITIES,
    now: NOW,
  });
}

describe("generateRecommendations — action-type coverage", () => {
  it("emits one Create for each weakness cluster; does not double-emit for clustered prompts", () => {
    // Unique topic_ids per prompt → no topic cluster forms, only the
    // Palo Alto geo cluster (3 prompts). The lone Menlo Park prompt
    // (unique topic too) stays out of all clusters → becomes a single-
    // prompt target_competitors rec.
    const prompts = [
      mkPrompt({ id: "p1", location_scope: "Palo Alto", topic_id: "topic-1", text: "Palo Alto luxury builder?" }),
      mkPrompt({ id: "p2", location_scope: "Palo Alto", topic_id: "topic-2", text: "Best Palo Alto custom home builder?" }),
      mkPrompt({ id: "p3", location_scope: "Palo Alto", topic_id: "topic-3", text: "Palo Alto architect-designed homes?" }),
      mkPrompt({ id: "p4", location_scope: "Menlo Park", topic_id: "topic-4", text: "Menlo Park builder?" }),
    ];
    // All 4 are outranked (absent + dominant competitors)
    const observations = prompts.flatMap((p) =>
      Array.from({ length: 3 }, (_, i) => absentObs(p.id, i)),
    );
    const matrix = runMatrix(prompts, observations);
    const recs = generateRecommendations({
      matrix,
      activeEntities: ENTITIES,
      trackedPrompts: prompts,
    });

    // Expect ONE cluster rec (Palo Alto × 3 prompts) + ONE target_competitors
    // for the lone Menlo Park outranked prompt.
    const clusterRecs = recs.filter((r) => r.type === "create_cluster_page");
    expect(clusterRecs).toHaveLength(1);
    expect(clusterRecs[0].clusterLabel).toBe("Palo Alto");
    expect(clusterRecs[0].clusterKind).toBe("geo");
    expect(clusterRecs[0].affectedPromptIds.sort()).toEqual(["p1", "p2", "p3"]);
    expect(clusterRecs[0].title).toBe("Create a Palo Alto page");

    const targetRecs = recs.filter((r) => r.type === "target_competitors");
    expect(targetRecs).toHaveLength(1);
    expect(targetRecs[0].affectedPromptIds).toEqual(["p4"]);

    // No double-emission: clustered prompts do NOT get single-prompt recs.
    const allSinglePromptRecs = recs.filter(
      (r) =>
        r.affectedPromptIds.length === 1 &&
        ["p1", "p2", "p3"].includes(r.affectedPromptIds[0]),
    );
    expect(allSinglePromptRecs).toHaveLength(0);
  });

  it("emits target_competitors for a single Outranked prompt NOT in a cluster", () => {
    const prompts = [
      mkPrompt({ id: "p-solo-outranked", text: "Bay Area full-home renovation?" }),
    ];
    const observations = Array.from({ length: 4 }, (_, i) =>
      absentObs("p-solo-outranked", i),
    );
    const matrix = runMatrix(prompts, observations);
    const recs = generateRecommendations({
      matrix,
      activeEntities: ENTITIES,
      trackedPrompts: prompts,
    });
    expect(recs).toHaveLength(1);
    expect(recs[0].type).toBe("target_competitors");
    expect(recs[0].severity).toBe("high");
    expect(recs[0].evidence.dominantCompetitors).toContain("CRC Builders");
    expect(recs[0].evidence.dominantCompetitors).toContain("Homestead");
    expect(recs[0].stableKey).toBe(
      "target_competitors:prompt:p-solo-outranked",
    );
  });

  it("emits strengthen_page_copy for a Close-category prompt and carries descriptors", () => {
    const prompts = [mkPrompt({ id: "p-close", text: "Luxury Bay Area builder?" })];
    const observations = Array.from({ length: 3 }, (_, i) => closeObs("p-close", i));
    const matrix = runMatrix(prompts, observations);
    const recs = generateRecommendations({
      matrix,
      activeEntities: ENTITIES,
      trackedPrompts: prompts,
    });
    expect(recs).toHaveLength(1);
    expect(recs[0].type).toBe("strengthen_page_copy");
    expect(recs[0].severity).toBe("medium");
    expect(recs[0].effort).toBe("low");
    expect(recs[0].evidence.descriptorsNearBrand.length).toBeGreaterThan(0);
    expect(recs[0].stableKey).toBe("strengthen_page_copy:prompt:p-close");
  });

  it("emits create_single for an Absent prompt NOT in a cluster AND with no dominant competitors", () => {
    const prompts = [mkPrompt({ id: "p-lone-absent", text: "Obscure one-off prompt?" })];
    const observations = Array.from({ length: 3 }, (_, i) => ({
      ...absentObs("p-lone-absent", i),
      competitor_co_mentions: [], // no competitors → just Absent, not Outranked
    }));
    const matrix = runMatrix(prompts, observations);
    const recs = generateRecommendations({
      matrix,
      activeEntities: ENTITIES,
      trackedPrompts: prompts,
    });
    expect(recs).toHaveLength(1);
    expect(recs[0].type).toBe("create_single");
    expect(recs[0].stableKey).toBe("create_single:prompt:p-lone-absent");
  });

  it("does NOT emit Watch recs in v1 (matrix.clusters is weakness-only)", () => {
    const prompts = [
      mkPrompt({ id: "w1", location_scope: "Atherton" }),
      mkPrompt({ id: "w2", location_scope: "Atherton" }),
      mkPrompt({ id: "w3", location_scope: "Atherton" }),
    ];
    const observations = prompts.flatMap((p) =>
      Array.from({ length: 3 }, (_, i) => winningObs(p.id, i)),
    );
    const matrix = runMatrix(prompts, observations);
    const recs = generateRecommendations({
      matrix,
      activeEntities: ENTITIES,
      trackedPrompts: prompts,
    });
    const watchRecs = recs.filter((r) => r.type === "watch_winning_cluster");
    expect(watchRecs).toHaveLength(0);
  });

  it("generates a clean stable key per cluster that does NOT change as observation counts shift", () => {
    const prompts = [
      mkPrompt({ id: "p1", location_scope: "Cupertino", topic_id: "topic-1" }),
      mkPrompt({ id: "p2", location_scope: "Cupertino", topic_id: "topic-2" }),
      mkPrompt({ id: "p3", location_scope: "Cupertino", topic_id: "topic-3" }),
    ];
    const obsV1 = prompts.flatMap((p) =>
      Array.from({ length: 3 }, (_, i) => absentObs(p.id, i)),
    );
    const obsV2 = prompts.flatMap((p) =>
      // Add more observations per prompt — cluster + category should stay
      // the same, so the rec's stableKey should not change.
      Array.from({ length: 5 }, (_, i) => absentObs(p.id, i)),
    );
    const m1 = runMatrix(prompts, obsV1);
    const m2 = runMatrix(prompts, obsV2);
    const r1 = generateRecommendations({
      matrix: m1,
      activeEntities: ENTITIES,
      trackedPrompts: prompts,
    });
    const r2 = generateRecommendations({
      matrix: m2,
      activeEntities: ENTITIES,
      trackedPrompts: prompts,
    });
    const k1 = r1.find((r) => r.type === "create_cluster_page")?.stableKey;
    const k2 = r2.find((r) => r.type === "create_cluster_page")?.stableKey;
    expect(k1).toBeDefined();
    expect(k1).toBe(k2);
  });

  it("cluster-level severity = worst category present (Outranked > Absent)", () => {
    // Two clusters: one all-absent, one mixed absent+outranked.
    const absentCluster = [
      mkPrompt({ id: "a1", location_scope: "Los Altos", topic_id: "topic-a1" }),
      mkPrompt({ id: "a2", location_scope: "Los Altos", topic_id: "topic-a2" }),
      mkPrompt({ id: "a3", location_scope: "Los Altos", topic_id: "topic-a3" }),
    ];
    const outrankedCluster = [
      mkPrompt({ id: "o1", location_scope: "Menlo Park", topic_id: "topic-o1" }),
      mkPrompt({ id: "o2", location_scope: "Menlo Park", topic_id: "topic-o2" }),
      mkPrompt({ id: "o3", location_scope: "Menlo Park", topic_id: "topic-o3" }),
    ];
    const prompts = [...absentCluster, ...outrankedCluster];
    const observations = [
      ...absentCluster.flatMap((p) =>
        Array.from({ length: 3 }, (_, i) => ({
          ...absentObs(p.id, i),
          competitor_co_mentions: [], // 0 competitors → classifies as absent only
        })),
      ),
      ...outrankedCluster.flatMap((p) =>
        Array.from({ length: 3 }, (_, i) => absentObs(p.id, i)),
      ),
    ];
    const matrix = runMatrix(prompts, observations);
    const recs = generateRecommendations({
      matrix,
      activeEntities: ENTITIES,
      trackedPrompts: prompts,
    });
    const losAltos = recs.find((r) => r.clusterLabel === "Los Altos");
    const menloPark = recs.find((r) => r.clusterLabel === "Menlo Park");
    expect(losAltos?.severity).toBe("medium"); // all absent
    expect(menloPark?.severity).toBe("high"); // has outranked
  });

  it("titles carry the real prompt text when trackedPrompts is supplied", () => {
    const prompts = [
      mkPrompt({
        id: "p-solo",
        text: "What's the best builder for a teardown and rebuild project in Atherton?",
      }),
    ];
    const observations = Array.from({ length: 3 }, (_, i) => absentObs("p-solo", i));
    const matrix = runMatrix(prompts, observations);
    const recs = generateRecommendations({
      matrix,
      activeEntities: ENTITIES,
      trackedPrompts: prompts,
    });
    expect(recs[0].title).toContain("What's the best builder");
  });

  it("dedupes overlapping cluster recs by preferring geo when prompt sets are identical", () => {
    // 3 prompts, all Palo Alto geo + all "Palo Alto Construction" topic
    // → identical prompt sets in both clusters. Expect 1 cluster rec (geo).
    const prompts = [
      mkPrompt({ id: "p1", location_scope: "Palo Alto", topic_id: "Palo Alto Construction" }),
      mkPrompt({ id: "p2", location_scope: "Palo Alto", topic_id: "Palo Alto Construction" }),
      mkPrompt({ id: "p3", location_scope: "Palo Alto", topic_id: "Palo Alto Construction" }),
    ];
    const observations = prompts.flatMap((p) =>
      Array.from({ length: 3 }, (_, i) => absentObs(p.id, i)),
    );
    const matrix = runMatrix(prompts, observations);
    const recs = generateRecommendations({
      matrix,
      activeEntities: ENTITIES,
      trackedPrompts: prompts,
    });
    const clusterRecs = recs.filter((r) => r.type === "create_cluster_page");
    expect(clusterRecs).toHaveLength(1);
    expect(clusterRecs[0].clusterKind).toBe("geo");
    expect(clusterRecs[0].clusterLabel).toBe("Palo Alto");
  });

  it("description for cluster recs mentions category breakdown", () => {
    const prompts = [
      mkPrompt({ id: "p1", location_scope: "Cupertino", topic_id: "t-1" }),
      mkPrompt({ id: "p2", location_scope: "Cupertino", topic_id: "t-2" }),
      mkPrompt({ id: "p3", location_scope: "Cupertino", topic_id: "t-3" }),
    ];
    const observations = prompts.flatMap((p) =>
      Array.from({ length: 3 }, (_, i) => absentObs(p.id, i)),
    );
    const matrix = runMatrix(prompts, observations);
    const recs = generateRecommendations({
      matrix,
      activeEntities: ENTITIES,
      trackedPrompts: prompts,
    });
    expect(recs[0].description).toMatch(/3 outranked/);
  });

  it("evidence.observationCount aggregates across all affected prompts", () => {
    const prompts = [
      mkPrompt({ id: "p1", location_scope: "Palo Alto", topic_id: "t-1" }),
      mkPrompt({ id: "p2", location_scope: "Palo Alto", topic_id: "t-2" }),
      mkPrompt({ id: "p3", location_scope: "Palo Alto", topic_id: "t-3" }),
    ];
    const observations = prompts.flatMap((p) =>
      Array.from({ length: 5 }, (_, i) => absentObs(p.id, i)),
    );
    const matrix = runMatrix(prompts, observations);
    const recs = generateRecommendations({
      matrix,
      activeEntities: ENTITIES,
      trackedPrompts: prompts,
    });
    const cluster = recs.find((r) => r.type === "create_cluster_page")!;
    expect(cluster.evidence.observationCount).toBe(15); // 3 prompts × 5 obs each
    expect(cluster.evidence.promptCount).toBe(3);
  });

  it("evidence.primaryCompetitors reflects who is primary-majority across affected prompts", () => {
    // 3 Menlo Park prompts, all outranked. Each is absent-with-competitors.
    // In every answer, CRC is the first listed competitor → CRC holds the
    // primary slot on every prompt. The cluster rec should call that out.
    const prompts = [
      mkPrompt({ id: "mp1", location_scope: "Menlo Park", topic_id: "t-1" }),
      mkPrompt({ id: "mp2", location_scope: "Menlo Park", topic_id: "t-2" }),
      mkPrompt({ id: "mp3", location_scope: "Menlo Park", topic_id: "t-3" }),
    ];
    // Use ≥3 obs per prompt so each registers as Outranked. Each obs lists
    // CRC Builders first, making it the primary-position entity.
    const observations = prompts.flatMap((p) =>
      Array.from({ length: 3 }, (_, i) => absentObs(p.id, i)),
    );
    const matrix = runMatrix(prompts, observations);
    const recs = generateRecommendations({
      matrix,
      activeEntities: ENTITIES,
      trackedPrompts: prompts,
    });
    const cluster = recs.find((r) => r.type === "create_cluster_page");
    expect(cluster).toBeDefined();
    // CRC is first-listed in every co-mention array → primary-majority on
    // every prompt → appears as a RecommendationPrimaryCompetitor.
    expect(cluster!.evidence.primaryCompetitors).toEqual([
      { name: "CRC Builders", promptsWherePrimary: 3, totalAffectedPrompts: 3 },
    ]);
    expect(cluster!.evidence.brandPrimaryPromptCount).toBe(0);
    expect(cluster!.evidence.fragmentedPromptCount).toBe(0);
  });
});
