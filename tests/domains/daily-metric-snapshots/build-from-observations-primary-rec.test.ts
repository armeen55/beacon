/**
 * Section 6 C2 (2026-05-15) — native snapshot builder per-scope
 * `primary_recommendation_count` truth table.
 *
 * Pins the locked per-scope contract on
 * `src/domains/daily-metric-snapshots/build-from-observations.ts`:
 *   • Owned-brand entity row:      populated
 *   • Competitor entity row:       null
 *   • Topic row:                   null (H8 lock)
 *   • Platform aggregate row:      populated
 *   • Per-prompt row (NEW in C2):  populated
 *   • No account-scope rows emitted (account is derived at read time
 *     from platform rows per the C1.1 column comment correction).
 *
 * Companion architecture invariant
 * `tests/architecture/snapshot-builder-topic-null-primary-rec.test.ts`
 * pins the topic-null contract at source-text level for BOTH builders;
 * this file pins the runtime behavior of the native builder.
 */

import { describe, expect, it } from "vitest";

import { buildDailySnapshotsFromObservations } from "@/domains/daily-metric-snapshots/build-from-observations";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────

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
    tenant_id: "tenant-fixture",
    metadata: {},
    primary_recommendation: null,
    ...over,
  };
}

function entity(over: Partial<TrackedEntity> = {}): TrackedEntity {
  return {
    id: "own-ritzbuilders-com",
    account_id: "tenant-fixture",
    tenant_id: "tenant-fixture",
    entity_type: "brand",
    name: "Ritz Builders",
    domain: "ritzbuilders.com",
    url: null,
    location_scope: null,
    service_scope: null,
    is_owned: true,
    is_active: true,
    metadata: {},
    created_at: "2026-05-15T00:00:00Z",
    updated_at: "2026-05-15T00:00:00Z",
    ...over,
  };
}

function build(over?: {
  observations?: PromptAnswerObservation[];
  trackedEntities?: TrackedEntity[];
  platform?: string;
  date?: string;
}): DailyMetricSnapshot[] {
  return buildDailySnapshotsFromObservations({
    tenantId: "tenant-fixture",
    platform: over?.platform ?? "Perplexity",
    observations: over?.observations ?? [],
    trackedEntities: over?.trackedEntities ?? [entity()],
    date: over?.date ?? "2026-05-15",
    observationRunId: "run-fixture",
  });
}

const OWNED = entity({ id: "own-ritzbuilders-com", is_owned: true });
const COMP = entity({
  id: "comp-demattei-com",
  name: "DeMattei",
  domain: "demattei.com",
  entity_type: "competitor",
  is_owned: false,
});

// ─────────────────────────────────────────────────────────────────────
// Per-scope population
// ─────────────────────────────────────────────────────────────────────

describe("Section 6 C2 — owned-brand entity row", () => {
  it("primary_recommendation_count = count of true observations", () => {
    const rows = build({
      trackedEntities: [OWNED],
      observations: [
        obs({ prompt_id: "p1", primary_recommendation: true }),
        obs({ prompt_id: "p2", primary_recommendation: true }),
        obs({ prompt_id: "p3", primary_recommendation: false }),
      ],
    });
    const ownedRow = rows.find(
      (r) => r.scope_type === "entity" && r.scope_id === "ritzbuilders",
    );
    expect(ownedRow).toBeDefined();
    expect(ownedRow!.primary_recommendation_count).toBe(2);
  });

  it("null and false observations do NOT count", () => {
    const rows = build({
      trackedEntities: [OWNED],
      observations: [
        obs({ prompt_id: "p1", primary_recommendation: null }),
        obs({ prompt_id: "p2", primary_recommendation: false }),
        obs({ prompt_id: "p3" }), // primary_recommendation not set
      ],
    });
    const ownedRow = rows.find(
      (r) => r.scope_type === "entity" && r.scope_id === "ritzbuilders",
    );
    expect(ownedRow!.primary_recommendation_count).toBe(0);
  });
});

describe("Section 6 C2 — competitor entity row", () => {
  it("primary_recommendation_count = null even when observations have true values", () => {
    const rows = build({
      trackedEntities: [OWNED, COMP],
      observations: [
        obs({ prompt_id: "p1", primary_recommendation: true }),
        obs({ prompt_id: "p2", primary_recommendation: true }),
      ],
    });
    const compRow = rows.find(
      (r) => r.scope_type === "entity" && r.scope_id === "demattei",
    );
    expect(compRow).toBeDefined();
    expect(compRow!.primary_recommendation_count).toBeNull();
  });
});

describe("Section 6 C2 — topic row (H8 lock)", () => {
  it("primary_recommendation_count = null regardless of input", () => {
    const rows = build({
      trackedEntities: [OWNED],
      observations: [
        obs({ prompt_id: "p1", topic: "remodel", primary_recommendation: true }),
        obs({ prompt_id: "p2", topic: "remodel", primary_recommendation: true }),
      ],
    });
    const topicRows = rows.filter((r) => r.scope_type === "topic");
    expect(topicRows.length).toBeGreaterThan(0);
    for (const r of topicRows) {
      expect(r.primary_recommendation_count).toBeNull();
    }
  });
});

describe("Section 6 C2 — platform aggregate row", () => {
  it("primary_recommendation_count = run-wide count", () => {
    const rows = build({
      trackedEntities: [OWNED],
      observations: [
        obs({ prompt_id: "p1", primary_recommendation: true }),
        obs({ prompt_id: "p2", primary_recommendation: false }),
        obs({ prompt_id: "p3", primary_recommendation: true }),
        obs({ prompt_id: "p4", primary_recommendation: null }),
      ],
    });
    const platformRow = rows.find((r) => r.scope_type === "platform");
    expect(platformRow).toBeDefined();
    expect(platformRow!.primary_recommendation_count).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Per-prompt rows (NEW in C2)
// ─────────────────────────────────────────────────────────────────────

describe("Section 6 C2 — per-prompt rows", () => {
  it("emits one row per distinct prompt_id", () => {
    const rows = build({
      trackedEntities: [OWNED],
      observations: [
        obs({ prompt_id: "prompt-alpha", primary_recommendation: true }),
        obs({ prompt_id: "prompt-beta", primary_recommendation: false }),
        obs({ prompt_id: "prompt-gamma", primary_recommendation: true }),
      ],
    });
    const promptRows = rows.filter((r) => r.scope_type === "prompt");
    expect(promptRows.map((r) => r.scope_id).sort()).toEqual([
      "prompt-alpha",
      "prompt-beta",
      "prompt-gamma",
    ]);
  });

  it("scope_id is the prompt_id VERBATIM (not slugified)", () => {
    // Use a prompt_id with characters that slugifyForId would mangle.
    // UPPERCASE and slashes go through slugifyForId; scope_id must
    // preserve the raw value.
    const rows = build({
      trackedEntities: [OWNED],
      observations: [
        obs({
          prompt_id: "ABC/Mixed Prompt 1",
          primary_recommendation: true,
        }),
      ],
    });
    const promptRow = rows.find((r) => r.scope_type === "prompt");
    expect(promptRow!.scope_id).toBe("ABC/Mixed Prompt 1");
  });

  it("id slugifies the prompt_id but scope_id stays verbatim", () => {
    const rows = build({
      trackedEntities: [OWNED],
      observations: [
        obs({
          prompt_id: "ABC/Mixed Prompt 1",
          primary_recommendation: true,
        }),
      ],
    });
    const promptRow = rows.find((r) => r.scope_type === "prompt");
    // ID is derived-{date}-prompt-{slug}-{platformSlug}; slug
    // lowercases + replaces non-alphanumeric runs with single hyphens.
    expect(promptRow!.id).toBe(
      "derived-2026-05-15-prompt-abc-mixed-prompt-1-perplexity",
    );
    // scope_id stays verbatim.
    expect(promptRow!.scope_id).toBe("ABC/Mixed Prompt 1");
  });

  it("primary_recommendation_count is the per-prompt count", () => {
    const rows = build({
      trackedEntities: [OWNED],
      observations: [
        // prompt-x: 2 of 3 primary
        obs({ id: "o1", prompt_id: "prompt-x", primary_recommendation: true }),
        obs({ id: "o2", prompt_id: "prompt-x", primary_recommendation: true }),
        obs({ id: "o3", prompt_id: "prompt-x", primary_recommendation: false }),
        // prompt-y: 0 of 2 primary
        obs({ id: "o4", prompt_id: "prompt-y", primary_recommendation: null }),
        obs({ id: "o5", prompt_id: "prompt-y", primary_recommendation: false }),
      ],
    });
    const px = rows.find(
      (r) => r.scope_type === "prompt" && r.scope_id === "prompt-x",
    );
    const py = rows.find(
      (r) => r.scope_type === "prompt" && r.scope_id === "prompt-y",
    );
    expect(px!.primary_recommendation_count).toBe(2);
    expect(py!.primary_recommendation_count).toBe(0);
  });

  it("mention_count / citation_count / total_possible / visibility_score / share_of_voice populated per-prompt", () => {
    const rows = build({
      trackedEntities: [OWNED],
      observations: [
        obs({
          id: "o1",
          prompt_id: "px",
          tracked_brand_mentioned: true,
          owned_citation_count: 1,
          citation_count: 2,
        }),
        obs({
          id: "o2",
          prompt_id: "px",
          tracked_brand_mentioned: false,
          owned_citation_count: 0,
          citation_count: 1,
        }),
      ],
    });
    const px = rows.find(
      (r) => r.scope_type === "prompt" && r.scope_id === "px",
    );
    expect(px!.mention_count).toBe(1);
    expect(px!.citation_count).toBe(1);
    expect(px!.total_possible).toBe(2);
    expect(px!.visibility_score).toBe(50);
    expect(px!.share_of_voice).toBeCloseTo(33.33, 1);
  });

  it("Phase 2A extension fields are explicitly null on prompt rows", () => {
    const rows = build({
      trackedEntities: [OWNED],
      observations: [obs({ prompt_id: "px", primary_recommendation: true })],
    });
    const px = rows.find((r) => r.scope_type === "prompt");
    expect(px!.cited_or_mentioned_count).toBeNull();
    expect(px!.position_weighted_citation_count).toBeNull();
    expect(px!.mentioned_obs_count).toBeNull();
  });

  it("metadata carries prompt_id + scope_semantics", () => {
    const rows = build({
      trackedEntities: [OWNED],
      observations: [obs({ prompt_id: "px", primary_recommendation: true })],
    });
    const px = rows.find((r) => r.scope_type === "prompt");
    expect(px!.metadata).toMatchObject({
      source_system: "beacon_native",
      derived_from_run_id: "run-fixture",
      scope_semantics: "per_prompt_owned_brand_rollup",
      prompt_id: "px",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// No account-scope rows emitted (C1.1 contract)
// ─────────────────────────────────────────────────────────────────────

describe("Section 6 C2 — no account-scope rows emitted by the native builder", () => {
  it("does NOT emit any scope_type='account' row", () => {
    const rows = build({
      trackedEntities: [OWNED, COMP],
      observations: [
        obs({ prompt_id: "p1", primary_recommendation: true }),
        obs({ prompt_id: "p2", primary_recommendation: true }),
      ],
    });
    const accountRows = rows.filter((r) => r.scope_type === "account");
    expect(accountRows).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Empty observations preserve existing behavior
// ─────────────────────────────────────────────────────────────────────

describe("Section 6 C2 — empty observations", () => {
  it("emits owned-entity row with primary_recommendation_count = 0", () => {
    const rows = build({ trackedEntities: [OWNED], observations: [] });
    const ownedRow = rows.find(
      (r) => r.scope_type === "entity" && r.scope_id === "ritzbuilders",
    );
    expect(ownedRow).toBeDefined();
    expect(ownedRow!.primary_recommendation_count).toBe(0);
  });

  it("emits NO platform / topic / prompt / account rows when observations are empty", () => {
    const rows = build({ trackedEntities: [OWNED], observations: [] });
    expect(rows.some((r) => r.scope_type === "platform")).toBe(false);
    expect(rows.some((r) => r.scope_type === "topic")).toBe(false);
    expect(rows.some((r) => r.scope_type === "prompt")).toBe(false);
    expect(rows.some((r) => r.scope_type === "account")).toBe(false);
  });
});
