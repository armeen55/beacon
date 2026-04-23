import { describe, it, expect } from "vitest";

import { buildPromptDecisionMatrix } from "@/domains/prompts/decision-matrix";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

const TODAY = new Date("2026-04-24T12:00:00Z");

function mkPrompt(
  id: string,
  overrides: Partial<TrackedPrompt> = {},
): TrackedPrompt {
  return {
    id,
    account_id: "ritz",
    text: `prompt text ${id}`,
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

function mkEntity(overrides: Partial<TrackedEntity> & { id: string; name: string }): TrackedEntity {
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

const RITZ: TrackedEntity = mkEntity({
  id: "ent-ritz",
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  entity_type: "brand",
  is_owned: true,
});
const CRC: TrackedEntity = mkEntity({
  id: "ent-crc",
  name: "CRC Builders",
  domain: "crcbuilders.com",
});
const HOMESTEAD: TrackedEntity = mkEntity({
  id: "ent-hm",
  name: "Homestead",
  domain: "homestead.com",
});
const ENTITIES = [RITZ, CRC, HOMESTEAD];

function absentObs(pid: string, idx: number, platform: string = "perplexity"): PromptAnswerObservation {
  return {
    id: `${pid}-${platform}-${idx}`,
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
    observed_at: `2026-04-23T${String(10 + idx).padStart(2, "0")}:00:00Z`,
    platform,
    topic: "default-topic",
    metadata: {},
    tenant_id: "t",
    primary_recommendation: false,
    citation_rank: null,
    competitor_co_mentions: ["CRC Builders", "Homestead"],
  };
}

function winningObs(pid: string, idx: number): PromptAnswerObservation {
  return {
    ...absentObs(pid, idx),
    primary_recommendation: true,
    tracked_brand_mentioned: true,
    tracked_brand_cited: true,
    citation_rank: 1,
    competitor_co_mentions: [],
  };
}

describe("buildPromptDecisionMatrix — group summaries + clusters", () => {
  it("classifies across many prompts and returns ordered group summaries", () => {
    // 3 winning, 3 outranked (absent + 2 dominant competitors), 3 early.
    const prompts: TrackedPrompt[] = [
      mkPrompt("w1"),
      mkPrompt("w2"),
      mkPrompt("w3"),
      mkPrompt("o1"),
      mkPrompt("o2"),
      mkPrompt("o3"),
      mkPrompt("e1"),
      mkPrompt("e2"),
      mkPrompt("e3"),
    ];
    const observations: PromptAnswerObservation[] = [];
    // Winners: 3 primary each.
    for (const pid of ["w1", "w2", "w3"]) {
      for (let i = 0; i < 3; i++) observations.push(winningObs(pid, i));
    }
    // Outranked: 3 absent-with-competitors each.
    for (const pid of ["o1", "o2", "o3"]) {
      for (let i = 0; i < 3; i++) observations.push(absentObs(pid, i));
    }
    // Early prompts have no observations.

    const out = buildPromptDecisionMatrix({
      prompts,
      observations,
      activeEntities: ENTITIES,
      now: TODAY,
    });
    expect(out.prompts).toHaveLength(9);
    const counts = Object.fromEntries(
      out.groupSummaries.map((g) => [g.category, g.count]),
    );
    expect(counts.winning).toBe(3);
    expect(counts.outranked).toBe(3);
    expect(counts.early).toBe(3);
    // Order: outranked, absent, close, winning, early
    expect(out.groupSummaries.map((g) => g.category)).toEqual([
      "outranked",
      "absent",
      "close",
      "winning",
      "early",
    ]);
  });

  it("detects a geo cluster when ≥3 weak prompts share location_scope", () => {
    const prompts: TrackedPrompt[] = [
      mkPrompt("p1", { location_scope: "Palo Alto" }),
      mkPrompt("p2", { location_scope: "Palo Alto" }),
      mkPrompt("p3", { location_scope: "Palo Alto" }),
      mkPrompt("p4", { location_scope: "Menlo Park" }),
    ];
    // All 4 are outranked (absent + dominant competitors).
    const observations = prompts.flatMap((p) =>
      Array.from({ length: 3 }, (_, i) => absentObs(p.id, i)),
    );
    const out = buildPromptDecisionMatrix({
      prompts,
      observations,
      activeEntities: ENTITIES,
      now: TODAY,
    });
    // One geo cluster should be detected (Palo Alto × 3 prompts).
    const palo = out.clusters.find((c) => c.type === "geo" && c.label === "Palo Alto");
    expect(palo).toBeDefined();
    expect(palo!.promptIds).toHaveLength(3);
    expect(palo!.categories).toContain("outranked");
    // Menlo Park shouldn't cluster (only 1 prompt).
    expect(out.clusters.find((c) => c.label === "Menlo Park")).toBeUndefined();
    // Cluster note propagates into the group summary.
    const outrankedGroup = out.groupSummaries.find((g) => g.category === "outranked")!;
    expect(outrankedGroup.clusterNote).toMatch(/3 cluster to Palo Alto/);
  });

  it("detects a topic cluster when ≥3 weak prompts share topic_id", () => {
    const prompts: TrackedPrompt[] = [
      mkPrompt("t1", { topic_id: "luxury-home-builder" }),
      mkPrompt("t2", { topic_id: "luxury-home-builder" }),
      mkPrompt("t3", { topic_id: "luxury-home-builder" }),
      mkPrompt("t4", { topic_id: "design-build" }),
    ];
    const observations = prompts.flatMap((p) =>
      Array.from({ length: 3 }, (_, i) => absentObs(p.id, i)),
    );
    const out = buildPromptDecisionMatrix({
      prompts,
      observations,
      activeEntities: ENTITIES,
      now: TODAY,
    });
    const lux = out.clusters.find(
      (c) => c.type === "topic" && c.label === "luxury-home-builder",
    );
    expect(lux).toBeDefined();
    expect(lux!.promptIds).toHaveLength(3);
    const outrankedGroup = out.groupSummaries.find((g) => g.category === "outranked")!;
    expect(outrankedGroup.clusterNote).toMatch(/3 cluster to luxury-home-builder/);
  });

  it("attaches cluster tags onto individual PromptOpportunity objects", () => {
    const prompts: TrackedPrompt[] = Array.from({ length: 3 }, (_, i) =>
      mkPrompt(`p${i}`, { location_scope: "Palo Alto" }),
    );
    const observations = prompts.flatMap((p) =>
      Array.from({ length: 3 }, (_, i) => absentObs(p.id, i)),
    );
    const out = buildPromptDecisionMatrix({
      prompts,
      observations,
      activeEntities: ENTITIES,
      now: TODAY,
    });
    for (const op of out.prompts) {
      expect(op.tags).toContain("geo_cluster:Palo Alto");
    }
  });

  it("Winning and Early groups carry empty clusterNote (clusters only for weaknesses)", () => {
    const prompts: TrackedPrompt[] = Array.from({ length: 3 }, (_, i) =>
      mkPrompt(`w${i}`, { location_scope: "Palo Alto" }),
    );
    const observations = prompts.flatMap((p) =>
      Array.from({ length: 3 }, (_, i) => winningObs(p.id, i)),
    );
    const out = buildPromptDecisionMatrix({
      prompts,
      observations,
      activeEntities: ENTITIES,
      now: TODAY,
    });
    const winningGroup = out.groupSummaries.find((g) => g.category === "winning")!;
    expect(winningGroup.count).toBe(3);
    expect(winningGroup.clusterNote).toBe("");
    // No clusters detected because Winning doesn't participate in weakness clustering.
    expect(out.clusters).toHaveLength(0);
  });

  it("excludes inactive prompts from the matrix", () => {
    const prompts = [
      mkPrompt("active-1"),
      mkPrompt("inactive-1", { is_active: false }),
    ];
    const observations = [
      ...Array.from({ length: 3 }, (_, i) => winningObs("active-1", i)),
      ...Array.from({ length: 3 }, (_, i) => winningObs("inactive-1", i)),
    ];
    const out = buildPromptDecisionMatrix({
      prompts,
      observations,
      activeEntities: ENTITIES,
      now: TODAY,
    });
    expect(out.prompts).toHaveLength(1);
    expect(out.prompts[0].prompt_id).toBe("active-1");
  });

  it("returns lookbackFrom reflecting the 7d default window", () => {
    const out = buildPromptDecisionMatrix({
      prompts: [],
      observations: [],
      activeEntities: ENTITIES,
      now: TODAY,
    });
    expect(out.date).toBe("2026-04-24");
    expect(out.lookbackFrom).toBe("2026-04-17");
  });

  it("respects custom clusterMinPrompts threshold", () => {
    const prompts: TrackedPrompt[] = [
      mkPrompt("p1", { location_scope: "Palo Alto" }),
      mkPrompt("p2", { location_scope: "Palo Alto" }),
    ];
    const observations = prompts.flatMap((p) =>
      Array.from({ length: 3 }, (_, i) => absentObs(p.id, i)),
    );
    // With clusterMinPrompts=2, a 2-prompt Palo Alto cluster counts.
    const out = buildPromptDecisionMatrix({
      prompts,
      observations,
      activeEntities: ENTITIES,
      now: TODAY,
      clusterMinPrompts: 2,
    });
    const palo = out.clusters.find((c) => c.label === "Palo Alto");
    expect(palo).toBeDefined();
    expect(palo!.promptIds).toHaveLength(2);
  });
});
