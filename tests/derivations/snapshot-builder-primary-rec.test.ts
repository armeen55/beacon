/**
 * Section 6 C2 (2026-05-15) — legacy Profound importer builder
 * per-scope `primary_recommendation_count` truth table.
 *
 * Pins the locked per-scope contract on
 * `src/derivations/snapshot-builder.ts`:
 *   • Entity row (owned-only, the only entity Profound emits): populated
 *   • Platform row:                                            populated
 *   • Topic row:                                               null (H8 lock)
 *   • No prompt rows emitted (legacy importer; canonical native
 *     builder is the source of truth for prompt-scope rows).
 *   • No account-scope rows emitted (C1.1 column comment correction
 *     pins account as not-materialized; derived at read time).
 *
 * Companion architecture invariant
 * `tests/architecture/snapshot-builder-topic-null-primary-rec.test.ts`
 * pins the topic-null contract at source-text level for BOTH builders;
 * this file pins the runtime behavior of the legacy Profound importer.
 */

import { describe, expect, it } from "vitest";

import { buildDerivedSnapshots } from "@/derivations/snapshot-builder";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

const OWNED_ENTITY_ID = "own-ritzbuilders-com";
const TENANT_ID = "tenant-fixture";

function obs(over: Partial<PromptAnswerObservation> = {}): PromptAnswerObservation {
  return {
    id: "obs-fixture-id",
    prompt_id: "prompt-a",
    run_id: "run-fixture",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    observed_at: "2026-05-15T11:35:00Z",
    platform: "Perplexity",
    topic: "general",
    tenant_id: TENANT_ID,
    metadata: {},
    primary_recommendation: null,
    ...over,
  };
}

describe("Section 6 C2 — Profound importer: entity row", () => {
  it("primary_recommendation_count = count of true observations", () => {
    const rows = buildDerivedSnapshots(
      [
        obs({ id: "o1", primary_recommendation: true }),
        obs({ id: "o2", primary_recommendation: true }),
        obs({ id: "o3", primary_recommendation: false }),
      ],
      OWNED_ENTITY_ID,
      TENANT_ID,
    );
    const entityRow = rows.find((r) => r.scope_type === "entity");
    expect(entityRow).toBeDefined();
    expect(entityRow!.primary_recommendation_count).toBe(2);
  });
});

describe("Section 6 C2 — Profound importer: platform row", () => {
  it("primary_recommendation_count = run-wide count", () => {
    const rows = buildDerivedSnapshots(
      [
        obs({ id: "o1", primary_recommendation: true }),
        obs({ id: "o2", primary_recommendation: false }),
        obs({ id: "o3", primary_recommendation: true }),
      ],
      OWNED_ENTITY_ID,
      TENANT_ID,
    );
    const platformRow = rows.find((r) => r.scope_type === "platform");
    expect(platformRow).toBeDefined();
    expect(platformRow!.primary_recommendation_count).toBe(2);
  });
});

describe("Section 6 C2 — Profound importer: topic row (H8 lock)", () => {
  it("primary_recommendation_count = null even when input has true values", () => {
    const rows = buildDerivedSnapshots(
      [
        obs({ id: "o1", topic: "remodel", primary_recommendation: true }),
        obs({ id: "o2", topic: "remodel", primary_recommendation: true }),
      ],
      OWNED_ENTITY_ID,
      TENANT_ID,
    );
    const topicRows = rows.filter((r) => r.scope_type === "topic");
    expect(topicRows.length).toBeGreaterThan(0);
    for (const r of topicRows) {
      expect(r.primary_recommendation_count).toBeNull();
    }
  });
});

describe("Section 6 C2 — Profound importer: true / false / null handling", () => {
  it("only true increments; false and null count as 0", () => {
    const rows = buildDerivedSnapshots(
      [
        obs({ id: "o1", primary_recommendation: true }),
        obs({ id: "o2", primary_recommendation: false }),
        obs({ id: "o3", primary_recommendation: null }),
        obs({ id: "o4" }), // primary_recommendation absent (undefined)
      ],
      OWNED_ENTITY_ID,
      TENANT_ID,
    );
    const entityRow = rows.find((r) => r.scope_type === "entity");
    expect(entityRow!.primary_recommendation_count).toBe(1);
    const platformRow = rows.find((r) => r.scope_type === "platform");
    expect(platformRow!.primary_recommendation_count).toBe(1);
  });
});

describe("Section 6 C2 — Profound importer: no prompt-scope rows", () => {
  it("does NOT emit any scope_type='prompt' row", () => {
    const rows = buildDerivedSnapshots(
      [
        obs({ id: "o1", prompt_id: "prompt-a", primary_recommendation: true }),
        obs({ id: "o2", prompt_id: "prompt-b", primary_recommendation: false }),
      ],
      OWNED_ENTITY_ID,
      TENANT_ID,
    );
    const promptRows = rows.filter((r) => r.scope_type === "prompt");
    expect(promptRows).toEqual([]);
  });
});

describe("Section 6 C2 — Profound importer: no account-scope rows", () => {
  it("does NOT emit any scope_type='account' row", () => {
    const rows = buildDerivedSnapshots(
      [
        obs({ id: "o1", primary_recommendation: true }),
        obs({ id: "o2", primary_recommendation: true }),
      ],
      OWNED_ENTITY_ID,
      TENANT_ID,
    );
    const accountRows = rows.filter((r) => r.scope_type === "account");
    expect(accountRows).toEqual([]);
  });
});

describe("Section 6 C2 — Profound importer: multi-date accumulation", () => {
  it("aggregates per (date, scope_type, scope_id, platform) without crossing dates", () => {
    const rows = buildDerivedSnapshots(
      [
        // 2026-05-14: 1 primary
        obs({
          id: "o1",
          observed_at: "2026-05-14T10:00:00Z",
          primary_recommendation: true,
        }),
        obs({
          id: "o2",
          observed_at: "2026-05-14T11:00:00Z",
          primary_recommendation: false,
        }),
        // 2026-05-15: 2 primary
        obs({
          id: "o3",
          observed_at: "2026-05-15T10:00:00Z",
          primary_recommendation: true,
        }),
        obs({
          id: "o4",
          observed_at: "2026-05-15T11:00:00Z",
          primary_recommendation: true,
        }),
      ],
      OWNED_ENTITY_ID,
      TENANT_ID,
    );
    const may14Entity = rows.find(
      (r) => r.scope_type === "entity" && r.date === "2026-05-14",
    );
    const may15Entity = rows.find(
      (r) => r.scope_type === "entity" && r.date === "2026-05-15",
    );
    expect(may14Entity!.primary_recommendation_count).toBe(1);
    expect(may15Entity!.primary_recommendation_count).toBe(2);
  });
});

describe("Section 6 C2 — Profound importer: empty observations", () => {
  it("returns an empty array (existing behavior preserved)", () => {
    const rows = buildDerivedSnapshots([], OWNED_ENTITY_ID, TENANT_ID);
    expect(rows).toEqual([]);
  });
});
