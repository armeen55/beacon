/**
 * Section 6 C6a — runtime tests for the server loader.
 *
 * Covers:
 *   • live_at=null short-circuits with NO getRepository call.
 *   • Affected prompt IDs derived from `recommendedEdit.evidence` and
 *     deduped before reaching Mode B.
 *   • repo.getPromptAnswerObservations called with
 *     since = toUtcDateString(live_at).
 *   • repo.getDailyMetricSnapshots called with
 *     since = toUtcDateString(live_at - 14 days UTC).
 *   • Copy renderer null → { available: false, lines: null }.
 *   • Copy renderer non-null lines → { available: true, lines }.
 *
 * `next/cache.unstable_cache` is mocked to a passthrough so the loader
 * body runs synchronously and we can spy on the inner fetch
 * dependencies.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

type RepoCall = {
  method: "getPromptAnswerObservations" | "getDailyMetricSnapshots";
  options?: { since?: string };
};
let _repoCalls: RepoCall[] = [];
let _forTenantCalls: string[] = [];
let _getRepositoryCalls = 0;
let _observationsToReturn: unknown[] = [];
let _snapshotsToReturn: unknown[] = [];

vi.mock("@/lib/persistence/repositories", () => {
  return {
    getRepository: () => {
      _getRepositoryCalls += 1;
      return {
        forTenant: (tenantId: string) => {
          _forTenantCalls.push(tenantId);
          return {
            getPromptAnswerObservations: async (options?: { since?: string }) => {
              _repoCalls.push({ method: "getPromptAnswerObservations", options });
              return _observationsToReturn;
            },
            getDailyMetricSnapshots: async (options?: { since?: string }) => {
              _repoCalls.push({ method: "getDailyMetricSnapshots", options });
              return _snapshotsToReturn;
            },
          };
        },
      };
    },
  };
});

import { loadChangePrimaryEvidence } from "@/domains/citation-lifecycle/load-change-primary-evidence";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

function recommendedEdit(
  over: Partial<RecommendedEditRow> = {},
): RecommendedEditRow {
  return {
    id: "edit-1",
    tenant_id: "tenant-test",
    rec_id: "rec-1",
    action_type: "edit_title" as RecommendedEditRow["action_type"],
    target_url: "https://ritzbuilders.com/services/foo",
    target_element_key: null,
    display_label: null,
    current_text: null,
    proposed_text: null,
    why: "",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "high",
    measurement_plan: null,
    risks: [],
    source: "provider" as RecommendedEditRow["source"],
    provider_name: "openai",
    evidence_hash: null,
    model: "gpt-test",
    cost_usd: 0,
    created_at: "2026-04-15T00:00:00Z",
    updated_at: "2026-04-15T00:00:00Z",
    implementation_status: "verified_live",
    live_at: "2026-04-15T14:30:00Z",
    live_match_kind: "exact",
    live_match_confidence: "high",
    ...over,
  };
}

beforeEach(() => {
  _repoCalls = [];
  _forTenantCalls = [];
  _getRepositoryCalls = 0;
  _observationsToReturn = [];
  _snapshotsToReturn = [];
});

describe("Section 6 C6a — loadChangePrimaryEvidence", () => {
  it("live_at null short-circuits with NO getRepository call", async () => {
    const r = await loadChangePrimaryEvidence({
      tenantId: "tenant-test",
      recommendedEdit: recommendedEdit({ live_at: null }),
      brandName: "Ritz Builders",
      lifecycleStage: null,
      now: "2026-05-15T12:00:00Z",
    });
    expect(_getRepositoryCalls).toBe(0);
    expect(_forTenantCalls).toHaveLength(0);
    expect(_repoCalls).toHaveLength(0);
    expect(r.available).toBe(false);
    expect(r.lines).toBeNull();
    expect(r.raw.modeA.status).toBe("silent");
    expect(r.raw.modeB.per_platform.chatgpt.status).toBe("silent");
    expect(r.raw.modeB.per_platform.perplexity.status).toBe("silent");
  });

  it("calls repo.getPromptAnswerObservations with since = toUtcDateString(live_at)", async () => {
    await loadChangePrimaryEvidence({
      tenantId: "tenant-test",
      recommendedEdit: recommendedEdit({ live_at: "2026-04-15T14:30:00Z" }),
      brandName: "Ritz Builders",
      lifecycleStage: null,
      now: "2026-05-15T12:00:00Z",
    });
    const obsCall = _repoCalls.find(
      (c) => c.method === "getPromptAnswerObservations",
    );
    expect(obsCall).toBeDefined();
    expect(obsCall!.options?.since).toBe("2026-04-15");
  });

  it("calls repo.getDailyMetricSnapshots with since = toUtcDateString(live_at - 14d UTC)", async () => {
    await loadChangePrimaryEvidence({
      tenantId: "tenant-test",
      recommendedEdit: recommendedEdit({ live_at: "2026-04-15T14:30:00Z" }),
      brandName: "Ritz Builders",
      lifecycleStage: null,
      now: "2026-05-15T12:00:00Z",
    });
    const snapCall = _repoCalls.find(
      (c) => c.method === "getDailyMetricSnapshots",
    );
    expect(snapCall).toBeDefined();
    expect(snapCall!.options?.since).toBe("2026-04-01");
  });

  it("binds the repo to forTenant(tenantId)", async () => {
    await loadChangePrimaryEvidence({
      tenantId: "tenant-ritz-founder",
      recommendedEdit: recommendedEdit(),
      brandName: "Ritz Builders",
      lifecycleStage: null,
      now: "2026-05-15T12:00:00Z",
    });
    expect(_forTenantCalls).toContain("tenant-ritz-founder");
  });

  it("derives + dedupes affectedPromptIds from evidence before Mode B", async () => {
    // Two pre + two post snapshot rows for prompt p-1, total_possible=10 each
    _snapshotsToReturn = [
      {
        id: "s1",
        date: "2026-04-01",
        scope_type: "prompt",
        scope_id: "p-1",
        platform: "ChatGPT",
        source_type: "derived",
        visibility_score: null,
        mention_count: 0,
        citation_count: 0,
        share_of_voice: null,
        avg_position: null,
        total_possible: 10,
        metadata: {},
        tenant_id: "tenant-test",
        primary_recommendation_count: 4,
      },
      {
        id: "s2",
        date: "2026-04-15",
        scope_type: "prompt",
        scope_id: "p-1",
        platform: "ChatGPT",
        source_type: "derived",
        visibility_score: null,
        mention_count: 0,
        citation_count: 0,
        share_of_voice: null,
        avg_position: null,
        total_possible: 10,
        metadata: {},
        tenant_id: "tenant-test",
        primary_recommendation_count: 7,
      },
    ];
    const r = await loadChangePrimaryEvidence({
      tenantId: "tenant-test",
      recommendedEdit: recommendedEdit({
        // Duplicate prompt evidence refs — must dedup to one effective ID.
        evidence: [
          { type: "prompt", promptId: "p-1" },
          { type: "prompt", promptId: "p-1" },
          { type: "owned_page", url: "https://ritzbuilders.com/" },
        ],
        live_at: "2026-04-15T14:30:00Z",
      }),
      brandName: "Ritz Builders",
      lifecycleStage: null,
      now: "2026-05-15T12:00:00Z",
    });
    // If dedup failed, snapshots would be double-counted (pre 80, post 140).
    // With dedup, pre_total = 10 (single row for p-1 on 2026-04-01),
    // post_total = 10 (single row on 2026-04-15).
    expect(r.raw.modeB.per_platform.chatgpt.pre_total).toBe(10);
    expect(r.raw.modeB.per_platform.chatgpt.post_total).toBe(10);
  });

  it("copy renderer returns null → loader returns { available: false, lines: null }", async () => {
    // No observations + empty affectedPromptIds → both modes silent
    // → copy renderer returns null → available false.
    _observationsToReturn = [];
    _snapshotsToReturn = [];
    const r = await loadChangePrimaryEvidence({
      tenantId: "tenant-test",
      recommendedEdit: recommendedEdit({
        // No prompt evidence refs → affectedPromptIds empty → Mode B
        // hard-silences both platforms. No observations → Mode A silent.
        evidence: [{ type: "owned_page", url: "https://ritzbuilders.com/" }],
      }),
      brandName: "Ritz Builders",
      lifecycleStage: null,
      now: "2026-05-15T12:00:00Z",
    });
    expect(r.available).toBe(false);
    expect(r.lines).toBeNull();
  });

  it("copy renderer non-null → loader returns { available: true, lines }", async () => {
    const TARGET = "https://ritzbuilders.com/services/foo";
    // Build 8 cited-here observations post-live with primary=true on 5 of them.
    _observationsToReturn = Array.from({ length: 8 }).map((_, i) => ({
      id: "obs-" + i,
      prompt_id: "p-1",
      run_id: "r-1",
      answer_hash: null,
      position: null,
      tracked_brand_mentioned: true,
      tracked_brand_cited: true,
      citation_count: 1,
      owned_citation_count: 1,
      citation_domains: ["ritzbuilders.com"],
      citation_categories: {},
      mentions: [],
      observed_at: `2026-04-${String(20 + (i % 10)).padStart(2, "0")}T10:00:00Z`,
      platform: "ChatGPT",
      topic: "",
      metadata: {},
      tenant_id: "tenant-test",
      citation_urls: [TARGET],
      primary_recommendation: i < 5,
    }));
    const r = await loadChangePrimaryEvidence({
      tenantId: "tenant-test",
      recommendedEdit: recommendedEdit({
        target_url: TARGET,
        evidence: [{ type: "prompt", promptId: "p-1" }],
      }),
      brandName: "Ritz Builders",
      lifecycleStage: null,
      now: "2026-05-15T12:00:00Z",
    });
    expect(r.available).toBe(true);
    expect(r.lines).not.toBeNull();
    expect(r.lines!.length).toBeGreaterThan(0);
    expect(r.lines![0]).toContain("In 5 of 8 answers that cited this page");
  });
});
