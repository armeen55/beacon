/**
 * Slice 4.5.E.α₁b₂-B (2026-05-21) — render tests for the LLM-Draft
 * Preview section + 8-state result banner on the operator-only
 * `/diagnostics/recommendation-triggers` page.
 *
 * Coverage (~17 cases):
 *   • Section renders when weak-H2 diagnostic rows exist
 *   • Empty state when no weak-H2 diagnostic rows
 *   • Non-weak-H2 diagnostic rows are excluded
 *   • Env flag OFF → buttons disabled + disabled caption
 *   • Env flag ON → buttons enabled
 *   • One form per row, no bulk button
 *   • Hidden input name=candidate_dedupe_key carries row dedupe_key
 *   • drafted banner: proposed_text + cost_usd + bundle_size + footer
 *   • drafted truncated banner shows truncation notice
 *   • abstained banner
 *   • validation_failed banner
 *   • blocked_budget banner
 *   • blocked_env banner exact copy
 *   • candidate_not_found banner
 *   • invalid_candidate banner
 *   • error banner
 *   • Unknown `llm_draft_result` value renders no banner
 *   • Page render never invokes gateway mock (sanity carry-over)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import type { PageSnapshot } from "@/domains/pages/types";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";

let _isOperator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _isOperator,
}));

let _liveWriteEnabled = false;
vi.mock("@/lib/promotion-live-write", () => ({
  isPromotionLiveWriteEnabled: () => _liveWriteEnabled,
}));

let _llmDraftGatewayEnabled = false;
vi.mock("@/lib/llm-draft-gateway-flag", () => ({
  isLlmDraftGatewayEnabled: () => _llmDraftGatewayEnabled,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

const _notFoundSpy = vi.fn();
vi.mock("next/navigation", () => ({
  notFound: () => {
    _notFoundSpy();
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-test"),
}));

let _candidatesBucket: RecommendationCandidateRow[] = [];
let _diagnosticBucket: RecommendationCandidateRow[] = [];
vi.mock(
  "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant",
  () => ({
    loadTriggerCandidatesForTenant: async () => ({
      status: "ok" as const,
      candidates: _candidatesBucket,
      diagnostic_only: _diagnosticBucket,
      meta: {
        tenant_id: "tenant-test",
        snapshot_count: 1,
        predicates_run: 16,
        candidate_count: _candidatesBucket.length,
        diagnostic_only_count: _diagnosticBucket.length,
      },
    }),
  }),
);

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (_tenantId: string) => ({
      getPageSnapshots: async () => [] as PageSnapshot[],
      getRecommendedEdits: async () => [],
    }),
  }),
}));

vi.mock("@/domains/product/recommendation-response-store", () => ({
  getRecommendationResponses: async () => [],
}));

vi.mock("@/lib/business-config", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/business-config")>(
      "@/lib/business-config",
    );
  return {
    ...actual,
    getBusinessConfig: () => ({
      name: "Test",
      domain: "test.com",
      industry: "home-builder",
      phone: "",
      address: "",
      yelpBusinessId: "",
      houzzProfileUrl: "",
      angiProfileUrl: "",
      bbbProfileUrl: "",
      industryDirectoryProfileUrl: "",
      locations: ["Palo Alto"],
      services: ["custom home"],
      primaryCompetitors: [],
      keyPages: [],
      locationTerms: [],
      serviceTerms: [],
      directoryDomains: [],
      scanSettings: {
        preferredHour: 0,
        timezone: "UTC",
        scope: "priority" as const,
        enabled: true,
      },
    }),
  };
});

// Sanity carry-over: gateway mock MUST NEVER be invoked from page
// render. Spy fires only if the page render path mistakenly calls
// the gateway directly.
const _gatewaySpy = vi.fn();
vi.mock(
  "@/domains/recommendation-intelligence/llm-draft-gateway",
  () => ({
    draftProposedTextForCandidate: async () => {
      _gatewaySpy();
      throw new Error("page render must not invoke the gateway");
    },
  }),
);

vi.mock(
  "@/domains/recommendation-intelligence/promotion-writer",
  () => ({
    promoteEligibleCandidates: async () => {
      throw new Error("not used in page render tests");
    },
  }),
);
vi.mock(
  "@/domains/recommendation-intelligence/build-thin-packet",
  () => ({
    buildThinPacketForCandidate: () => {
      throw new Error("not used in page render tests");
    },
  }),
);
vi.mock("@/domains/recommendations/brand-assertions", () => ({
  getBrandAssertions: () => [],
}));

vi.mock("@/domains/indexability/batch-load-indexability", () => ({
  loadIndexabilityBatchForTenant: async () =>
    new Map() as Map<string, never>,
}));

import RecommendationTriggersDiagnosticPage from "@/app/(shell)/diagnostics/recommendation-triggers/page";

function weakH2Candidate(
  overrides: Partial<RecommendationCandidateRow> = {},
): RecommendationCandidateRow {
  return {
    tenant_id: "tenant-test",
    trigger_signal: "weak_h2",
    action_type: "rewrite_h2",
    generator_kind: "llm_assisted",
    target_url: "https://test.example/services/kitchen",
    topic_cluster_label: "H2 heading",
    evidence: [],
    confidence: "low",
    impact_estimate: "medium",
    customer_copy: "x",
    operator_evidence: 'h2[0]="Why Choose Us"',
    dedupe_key: "weakh2deadbeefweakh2deadbeefweak",
    cooldown_key: "cooldownkeycooldownkeycooldownkk",
    created_from_signal_at: "2026-05-21T11:00:00.000Z",
    safety_flags: [],
    ...overrides,
  };
}

function nonWeakH2DiagnosticCandidate(): RecommendationCandidateRow {
  return weakH2Candidate({
    trigger_signal: "noindex_on_indexable_page",
    action_type: "fix_noindex",
    generator_kind: "human_task",
    dedupe_key: "noindexdiagnosticnoindexdiagnos1",
  });
}

async function render(
  searchParams?: Record<string, string>,
): Promise<string> {
  const node = (await RecommendationTriggersDiagnosticPage({
    searchParams: Promise.resolve(searchParams ?? {}),
  })) as ReactElement;
  return renderToStaticMarkup(node);
}

beforeEach(() => {
  _isOperator = true;
  _liveWriteEnabled = false;
  _llmDraftGatewayEnabled = false;
  _candidatesBucket = [];
  _diagnosticBucket = [];
  _gatewaySpy.mockClear();
  _notFoundSpy.mockClear();
});

describe("LLM-Draft Preview section render", () => {
  it("renders section when weak-H2 diagnostic rows exist", async () => {
    _diagnosticBucket = [weakH2Candidate()];
    const html = await render();
    expect(html).toContain('data-diagnostic-section="llm-draft-preview"');
    expect(html).toContain("LLM-Draft Preview");
    expect(html).toContain('data-llm-draft-row-trigger-signal="weak_h2"');
  });

  it("calm empty state when no weak-H2 diagnostic rows", async () => {
    _diagnosticBucket = [];
    const html = await render();
    expect(html).toContain('data-diagnostic-section="llm-draft-preview-empty"');
    expect(html).toContain(
      "No weak-H2 diagnostic candidates available for LLM draft preview.",
    );
  });

  it("excludes non-weak-H2 rows from the section", async () => {
    _diagnosticBucket = [
      weakH2Candidate(),
      nonWeakH2DiagnosticCandidate(),
    ];
    const html = await render();
    expect(html).toMatch(
      /data-diagnostic-section="llm-draft-preview"[^>]*data-row-count="1"/,
    );
    expect(html).not.toContain(
      'data-llm-draft-row-dedupe-key="noindexdiagnosticnoindexdiagnos1"',
    );
  });

  it("env OFF → button disabled + disabled caption rendered", async () => {
    _diagnosticBucket = [weakH2Candidate()];
    _llmDraftGatewayEnabled = false;
    const html = await render();
    expect(html).toContain('data-llm-draft-enabled="false"');
    expect(html).toContain('data-llm-draft-button="disabled"');
    expect(html).toContain("LLM drafting DISABLED.");
    expect(html).toContain(
      "Set BEACON_LLM_DRAFT_GATEWAY_ENABLED=true to enable.",
    );
  });

  it("env ON → button enabled", async () => {
    _diagnosticBucket = [weakH2Candidate()];
    _llmDraftGatewayEnabled = true;
    const html = await render();
    expect(html).toContain('data-llm-draft-enabled="true"');
    expect(html).toContain('data-llm-draft-button="enabled"');
  });

  it("one form per row, no bulk button", async () => {
    _diagnosticBucket = [
      weakH2Candidate({ dedupe_key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      weakH2Candidate({ dedupe_key: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    ];
    _llmDraftGatewayEnabled = true;
    const html = await render();
    const formMatches = html.match(/data-llm-draft-form/g) ?? [];
    expect(formMatches.length).toBe(2);
  });

  it("hidden input candidate_dedupe_key carries row dedupe_key", async () => {
    _diagnosticBucket = [
      weakH2Candidate({ dedupe_key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      weakH2Candidate({ dedupe_key: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    ];
    _llmDraftGatewayEnabled = true;
    const html = await render();
    expect(html).toContain(
      'name="candidate_dedupe_key" value="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
    );
    expect(html).toContain(
      'name="candidate_dedupe_key" value="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"',
    );
  });
});

describe("LLM-Draft result banner render", () => {
  it("drafted banner: proposed_text + cost_usd + bundle_size + render-only footer", async () => {
    _diagnosticBucket = [weakH2Candidate()];
    const html = await render({
      llm_draft_result: "drafted",
      candidate_dedupe_key: "weakh2deadbeefweakh2deadbeefweak",
      cost_usd: "0.012300",
      bundle_size: "1",
      proposed_text: "Crafted H2",
    });
    expect(html).toContain('data-llm-draft-result="drafted"');
    expect(html).toContain('data-result-field="proposed_text"');
    expect(html).toContain("Crafted H2");
    expect(html).toContain("0.012300");
    expect(html).toContain('data-result-field="bundle_size"');
    expect(html).toContain("Render-only · not persisted.");
    expect(html).not.toContain("Preview truncated to 500 characters.");
  });

  it("drafted truncated banner renders truncation notice", async () => {
    _diagnosticBucket = [weakH2Candidate()];
    const html = await render({
      llm_draft_result: "drafted",
      candidate_dedupe_key: "weakh2deadbeefweakh2deadbeefweak",
      cost_usd: "0.050000",
      bundle_size: "1",
      proposed_text: "a".repeat(500),
      proposed_text_truncated: "true",
    });
    expect(html).toContain("Preview truncated to 500 characters.");
    expect(html).toContain('data-result-field="proposed_text_truncated"');
  });

  it("abstained banner renders", async () => {
    const html = await render({
      llm_draft_result: "abstained",
      abstention_reason: "empty_bundle",
      cost_usd: "0.000000",
    });
    expect(html).toContain('data-llm-draft-result="abstained"');
    expect(html).toContain("empty_bundle");
    expect(html).toContain("0.000000");
  });

  it("validation_failed banner renders", async () => {
    const html = await render({
      llm_draft_result: "validation_failed",
      validation_errors: "targetElement: not found",
      cost_usd: "0.070000",
    });
    expect(html).toContain('data-llm-draft-result="validation_failed"');
    expect(html).toContain("targetElement: not found");
    expect(html).toContain("0.070000");
  });

  it("blocked_budget banner renders", async () => {
    const html = await render({
      llm_draft_result: "blocked_budget",
      reason: "monthly cap reached",
    });
    expect(html).toContain('data-llm-draft-result="blocked_budget"');
    expect(html).toContain("monthly cap reached");
  });

  it("blocked_env banner renders exact operator-readable copy", async () => {
    const html = await render({ llm_draft_result: "blocked_env" });
    expect(html).toContain('data-llm-draft-result="blocked_env"');
    expect(html).toContain(
      "LLM drafting blocked: BEACON_LLM_DRAFT_GATEWAY_ENABLED is not",
    );
  });

  it("candidate_not_found banner renders", async () => {
    const html = await render({ llm_draft_result: "candidate_not_found" });
    expect(html).toContain('data-llm-draft-result="candidate_not_found"');
    expect(html).toContain("Candidate not found");
  });

  it("invalid_candidate banner renders reason", async () => {
    const html = await render({
      llm_draft_result: "invalid_candidate",
      reason: "wrong_trigger",
    });
    expect(html).toContain('data-llm-draft-result="invalid_candidate"');
    expect(html).toContain("wrong_trigger");
  });

  it("error banner renders msg", async () => {
    const html = await render({
      llm_draft_result: "error",
      msg: "builder:precondition_failed",
    });
    expect(html).toContain('data-llm-draft-result="error"');
    expect(html).toContain("builder:precondition_failed");
  });

  it("unknown llm_draft_result renders NO banner", async () => {
    const html = await render({ llm_draft_result: "garbage_value" });
    expect(html).not.toContain('data-diagnostic-section="llm-draft-result"');
  });

  it("page render never invokes the gateway", async () => {
    _diagnosticBucket = [weakH2Candidate()];
    _llmDraftGatewayEnabled = true;
    await render();
    expect(_gatewaySpy).not.toHaveBeenCalled();
  });
});
