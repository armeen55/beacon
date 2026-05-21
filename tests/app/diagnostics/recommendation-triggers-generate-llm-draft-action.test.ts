/**
 * Slice 4.5.E.α₁b₂-A (2026-05-21) — server-action tests for
 * `generateLlmDraftAction`.
 *
 * Coverage (~22 cases):
 *   • Gate 1 (operator) fail → notFound()
 *   • Gate 2 (env flag) fail → blocked_env redirect; gateway NOT called
 *   • Gate 3 (currentTenantId) throws → error redirect (tenant_resolve_failed)
 *   • Gate 4 missing key → invalid_candidate missing_key
 *   • Gate 5a candidate not in either bucket → candidate_not_found
 *   • Gate 5b candidate in main candidates bucket only → invalid_candidate
 *     not_diagnostic_only
 *   • Gate 6 wrong trigger → invalid_candidate wrong_trigger
 *   • Gate 6 wrong action → invalid_candidate wrong_action
 *   • Gate 6 wrong generator_kind → invalid_candidate wrong_kind
 *   • Gate 6 wrong confidence → invalid_candidate wrong_confidence
 *   • Gate 6 invalid target → invalid_candidate invalid_target
 *   • Gate 7 snapshot missing → invalid_candidate snapshot_missing
 *   • Gate 10 builder throws → error redirect (builder:<truncated>);
 *     gateway NOT called
 *   • Gate 11 gateway drafted → drafted redirect with proposed_text /
 *     cost / bundle_size
 *   • Drafted proposed_text > 500 chars → proposed_text_truncated=true
 *   • Gateway abstained → abstained redirect
 *   • Gateway validation_failed → validation_failed redirect
 *   • Gateway blocked_budget → blocked_budget redirect
 *   • Gateway throws → error redirect (gateway:<truncated>)
 *   • revalidatePath called after gateway result (drafted path)
 *   • revalidatePath NOT called on early gate failures (env-off path)
 *   • NO real LLM call (entire openaiProvider chain is mocked)
 *
 * Mocking strategy: `vi.hoisted()` + `vi.mock()` at import boundary
 * for every external dependency. `redirect` + `notFound` throw typed
 * errors so the test can capture URL / 404 verdicts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import type { PageSnapshot } from "@/domains/pages/types";
import type { SpecificEditEvidencePacket } from "@/domains/recommendations/specific-edit-evidence";
import type { LlmDraftResult } from "@/domains/recommendation-intelligence/llm-draft-gateway";
import type { BusinessConfig } from "@/lib/business-config";

class TestRedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}
class TestNotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

const mockState = vi.hoisted(() => ({
  operatorMode: true as boolean,
  envEnabled: true as boolean,
  tenantId: "tenant-a" as string,
  tenantThrows: false as boolean,
  candidatesBucket: [] as unknown[],
  diagnosticBucket: [] as unknown[],
  snapshots: [] as unknown[],
  loaderThrows: false as boolean,
  builderThrows: false as boolean,
  builderThrowMessage: "builder boom" as string,
  gatewayThrows: false as boolean,
  gatewayThrowMessage: "gateway boom" as string,
  gatewayResult: undefined as undefined | unknown,
  revalidateSpy: undefined as undefined | Mock<(path: string) => void>,
  gatewaySpy: undefined as
    | undefined
    | Mock<(input: { packet: SpecificEditEvidencePacket }) => Promise<LlmDraftResult>>,
  builderSpy: undefined as undefined | Mock<(args: unknown) => unknown>,
  logWarnSpy: undefined as undefined | Mock<(...args: unknown[]) => void>,
}));
mockState.revalidateSpy = vi.fn();
mockState.gatewaySpy = vi.fn();
mockState.builderSpy = vi.fn();
mockState.logWarnSpy = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new TestRedirectError(url);
  },
  notFound: () => {
    throw new TestNotFoundError();
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    mockState.revalidateSpy!(path);
  },
}));

vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => mockState.operatorMode,
}));

vi.mock("@/lib/promotion-live-write", () => ({
  isPromotionLiveWriteEnabled: () => false,
}));

vi.mock("@/lib/llm-draft-gateway-flag", () => ({
  isLlmDraftGatewayEnabled: () => mockState.envEnabled,
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => {
    if (mockState.tenantThrows) throw new Error("no tenant");
    return mockState.tenantId;
  },
}));

vi.mock("@/lib/business-config", () => ({
  getBusinessConfig: () =>
    ({
      name: "Test Co",
      domain: "test.example",
    }) as unknown as BusinessConfig,
}));

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (_tenantId: string) => ({
      getPageSnapshots: async () => mockState.snapshots as PageSnapshot[],
    }),
  }),
}));

vi.mock(
  "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant",
  () => ({
    loadTriggerCandidatesForTenant: async () => {
      if (mockState.loaderThrows) throw new Error("loader boom");
      return {
        status: "ok" as const,
        candidates: mockState.candidatesBucket as RecommendationCandidateRow[],
        diagnostic_only:
          mockState.diagnosticBucket as RecommendationCandidateRow[],
        meta: {
          tenant_id: mockState.tenantId,
          snapshot_count: 0,
          predicates_run: 16,
          candidate_count: mockState.candidatesBucket.length,
          diagnostic_only_count: mockState.diagnosticBucket.length,
        },
      };
    },
  }),
);

vi.mock("@/domains/recommendations/brand-assertions", () => ({
  getBrandAssertions: (_tenantId: string) => [],
}));

vi.mock(
  "@/domains/recommendation-intelligence/build-thin-packet",
  () => ({
    buildThinPacketForCandidate: (args: unknown) => {
      mockState.builderSpy!(args);
      if (mockState.builderThrows) {
        throw new Error(mockState.builderThrowMessage);
      }
      return {
        schemaVersion: "specific-edit/v1",
        evidenceHash: "fakehash",
      } as unknown as SpecificEditEvidencePacket;
    },
  }),
);

vi.mock(
  "@/domains/recommendation-intelligence/llm-draft-gateway",
  () => ({
    draftProposedTextForCandidate: async (input: {
      packet: SpecificEditEvidencePacket;
    }) => {
      mockState.gatewaySpy!(input);
      if (mockState.gatewayThrows) {
        throw new Error(mockState.gatewayThrowMessage);
      }
      return mockState.gatewayResult as LlmDraftResult;
    },
  }),
);

vi.mock("@/lib/logger", () => ({
  log: {
    warn: (...args: unknown[]) => mockState.logWarnSpy!(...args),
    info: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

// Avoid pulling the writer module's runtime; gateway-action does not
// use it, but the actions.ts file imports the promotion writer too.
vi.mock(
  "@/domains/recommendation-intelligence/promotion-writer",
  () => ({
    promoteEligibleCandidates: async () => {
      throw new Error("not used in these tests");
    },
  }),
);

import { generateLlmDraftAction } from "@/app/(shell)/diagnostics/recommendation-triggers/actions";

function makeFormData(key: string | null): FormData {
  const fd = new FormData();
  if (key !== null) fd.set("candidate_dedupe_key", key);
  return fd;
}

function makeCandidate(
  overrides: Partial<RecommendationCandidateRow> = {},
): RecommendationCandidateRow {
  return {
    tenant_id: "tenant-a",
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
    dedupe_key: "abcdef0123456789abcdef0123456789",
    cooldown_key: "fedcba9876543210fedcba9876543210",
    created_from_signal_at: "2026-05-21T11:00:00.000Z",
    safety_flags: [],
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<PageSnapshot> = {},
): PageSnapshot {
  return {
    id: "s1",
    page_id: "p1",
    url: "https://test.example/services/kitchen",
    canonical_url: null,
    fetched_at: "2026-05-21T11:00:00.000Z",
    http_status: 200,
    title: "Kitchen",
    meta_description: null,
    h1: "Kitchen",
    h2_list: ["Why Choose Us"],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 0,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "h",
    headings_hash: "h",
    faq_hash: "h",
    schema_hash: "h",
    tenant_id: "tenant-a",
    ...overrides,
  };
}

async function captureRedirect(
  call: () => Promise<unknown>,
): Promise<string> {
  try {
    await call();
  } catch (e) {
    if (e instanceof TestRedirectError) return e.url;
    if (e instanceof TestNotFoundError) return "__NOT_FOUND__";
    throw e;
  }
  throw new Error("Expected redirect or notFound");
}

beforeEach(() => {
  mockState.operatorMode = true;
  mockState.envEnabled = true;
  mockState.tenantId = "tenant-a";
  mockState.tenantThrows = false;
  mockState.candidatesBucket = [];
  mockState.diagnosticBucket = [makeCandidate()];
  mockState.snapshots = [makeSnapshot()];
  mockState.loaderThrows = false;
  mockState.builderThrows = false;
  mockState.builderThrowMessage = "builder boom";
  mockState.gatewayThrows = false;
  mockState.gatewayThrowMessage = "gateway boom";
  mockState.gatewayResult = {
    status: "drafted",
    proposed_text: "Crafted H2",
    cost_usd: 0.042,
    bundle_size: 1,
  } satisfies LlmDraftResult;
  (mockState.revalidateSpy as Mock).mockClear();
  (mockState.gatewaySpy as Mock).mockClear();
  (mockState.builderSpy as Mock).mockClear();
  (mockState.logWarnSpy as Mock).mockClear();
});

describe("generateLlmDraftAction", () => {
  it("Gate 1: non-operator + non-test env → notFound()", async () => {
    mockState.operatorMode = false;
    vi.stubEnv("NODE_ENV", "production");
    try {
      const verdict = await captureRedirect(() =>
        generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
      );
      expect(verdict).toBe("__NOT_FOUND__");
      expect((mockState.gatewaySpy as Mock).mock.calls.length).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("Gate 2: env flag off → blocked_env redirect, gateway NOT called", async () => {
    mockState.envEnabled = false;
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("llm_draft_result=blocked_env");
    expect((mockState.gatewaySpy as Mock).mock.calls.length).toBe(0);
    expect((mockState.revalidateSpy as Mock).mock.calls.length).toBe(0);
  });

  it("Gate 3: currentTenantId throws → error redirect tenant_resolve_failed", async () => {
    mockState.tenantThrows = true;
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("llm_draft_result=error");
    expect(url).toContain("msg=tenant_resolve_failed");
  });

  it("Gate 4: missing candidate_dedupe_key → invalid_candidate missing_key", async () => {
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData(null)),
    );
    expect(url).toContain("llm_draft_result=invalid_candidate");
    expect(url).toContain("reason=missing_key");
  });

  it("Gate 5a: candidate not in either bucket → candidate_not_found", async () => {
    mockState.diagnosticBucket = [];
    mockState.candidatesBucket = [];
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("notfound00000000notfound00000000")),
    );
    expect(url).toContain("llm_draft_result=candidate_not_found");
  });

  it("Gate 5b: candidate in main candidates bucket only → invalid_candidate not_diagnostic_only", async () => {
    const cand = makeCandidate({ dedupe_key: "mainbucketkey000000000000000000" });
    mockState.candidatesBucket = [cand];
    mockState.diagnosticBucket = [];
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("mainbucketkey000000000000000000")),
    );
    expect(url).toContain("llm_draft_result=invalid_candidate");
    expect(url).toContain("reason=not_diagnostic_only");
  });

  it("Gate 6: wrong trigger_signal → invalid_candidate wrong_trigger", async () => {
    mockState.diagnosticBucket = [
      makeCandidate({ trigger_signal: "missing_h1" }),
    ];
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("llm_draft_result=invalid_candidate");
    expect(url).toContain("reason=wrong_trigger");
  });

  it("Gate 6: wrong action_type → invalid_candidate wrong_action", async () => {
    mockState.diagnosticBucket = [
      makeCandidate({ action_type: "edit_title" }),
    ];
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("reason=wrong_action");
  });

  it("Gate 6: wrong generator_kind → invalid_candidate wrong_kind", async () => {
    mockState.diagnosticBucket = [
      makeCandidate({ generator_kind: "deterministic" }),
    ];
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("reason=wrong_kind");
  });

  it("Gate 6: wrong confidence → invalid_candidate wrong_confidence", async () => {
    mockState.diagnosticBucket = [
      makeCandidate({ confidence: "high" }),
    ];
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("reason=wrong_confidence");
  });

  it("Gate 6: null / needs_new_page target → invalid_candidate invalid_target", async () => {
    mockState.diagnosticBucket = [
      makeCandidate({ target_url: "needs_new_page" }),
    ];
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("reason=invalid_target");
  });

  it("Gate 7: snapshot missing → invalid_candidate snapshot_missing", async () => {
    mockState.snapshots = [];
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("reason=snapshot_missing");
  });

  it("Gate 10: builder throws → error redirect builder:<msg>, gateway NOT called", async () => {
    mockState.builderThrows = true;
    mockState.builderThrowMessage = "boom-from-builder";
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("llm_draft_result=error");
    expect(url).toContain("msg=builder");
    expect((mockState.gatewaySpy as Mock).mock.calls.length).toBe(0);
  });

  it("Gate 11 drafted: redirect carries proposed_text + cost_usd + bundle_size", async () => {
    mockState.gatewayResult = {
      status: "drafted",
      proposed_text: "Short H2",
      cost_usd: 0.0123,
      bundle_size: 2,
    } satisfies LlmDraftResult;
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("llm_draft_result=drafted");
    expect(url).toContain("cost_usd=0.012300");
    expect(url).toContain("bundle_size=2");
    expect(url).toContain("proposed_text=Short+H2");
    expect(url).not.toContain("proposed_text_truncated=true");
    expect(url).toContain(
      "candidate_dedupe_key=abcdef0123456789abcdef0123456789",
    );
  });

  it("Drafted: proposed_text > 500 chars → proposed_text_truncated=true", async () => {
    const longText = "a".repeat(750);
    mockState.gatewayResult = {
      status: "drafted",
      proposed_text: longText,
      cost_usd: 0.05,
      bundle_size: 1,
    } satisfies LlmDraftResult;
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("proposed_text_truncated=true");
    const decoded = new URL(`http://x${url}`);
    const pt = decoded.searchParams.get("proposed_text") ?? "";
    expect(pt.length).toBe(500);
  });

  it("Gateway abstained → abstained redirect", async () => {
    mockState.gatewayResult = {
      status: "abstained",
      abstention_reason: "empty_bundle",
      cost_usd: 0.0,
    } satisfies LlmDraftResult;
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("llm_draft_result=abstained");
    expect(url).toContain("abstention_reason=empty_bundle");
  });

  it("Gateway validation_failed → validation_failed redirect", async () => {
    mockState.gatewayResult = {
      status: "validation_failed",
      validation_errors: ["targetElement: not found", "proposedText: empty"],
      cost_usd: 0.07,
    } satisfies LlmDraftResult;
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("llm_draft_result=validation_failed");
    expect(url).toContain("validation_errors=");
  });

  it("Gateway blocked_budget → blocked_budget redirect", async () => {
    mockState.gatewayResult = {
      status: "blocked_budget",
      reason: "monthly cap reached",
    } satisfies LlmDraftResult;
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("llm_draft_result=blocked_budget");
    expect(url).toContain("reason=monthly");
  });

  it("Gateway throws → error redirect gateway:<msg>", async () => {
    mockState.gatewayThrows = true;
    mockState.gatewayThrowMessage = "openai-network-failure";
    const url = await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect(url).toContain("llm_draft_result=error");
    expect(url).toContain("msg=gateway");
  });

  it("revalidatePath('/diagnostics/recommendation-triggers') called after successful gateway result", async () => {
    await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect((mockState.revalidateSpy as Mock).mock.calls.length).toBe(1);
    expect((mockState.revalidateSpy as Mock).mock.calls[0]?.[0]).toBe(
      "/diagnostics/recommendation-triggers",
    );
  });

  it("revalidatePath NOT called on env-off early gate failure", async () => {
    mockState.envEnabled = false;
    await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect((mockState.revalidateSpy as Mock).mock.calls.length).toBe(0);
  });

  it("NO real LLM call: gateway mock is the only invocation channel", async () => {
    await captureRedirect(() =>
      generateLlmDraftAction(makeFormData("abcdef0123456789abcdef0123456789")),
    );
    expect((mockState.gatewaySpy as Mock).mock.calls.length).toBe(1);
  });
});
