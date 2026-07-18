import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/domains/recommendations/load-queue", () => ({
  buildRecQueueCacheTag: (tenantId: string) => `queue:${tenantId}`,
}));
vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/obs/error-ledger", () => ({
  recordAppError: vi.fn(),
  errorFieldsFrom: () => ({}),
}));
vi.mock("@/lib/connectors/indexnow/ping-on-verify", () => ({ scheduleIndexNowPing: vi.fn() }));
vi.mock("@/domains/product/recommendation-response-store", () => ({
  recordResponse: vi.fn(),
  persistResponses: vi.fn(),
  ensureRecommendationResponsesSeeded: vi.fn(),
  deleteResponseByRecId: vi.fn(),
  getRecommendationResponses: vi.fn(async () => []),
}));
const updateHypothesis = vi.fn(async (..._args: unknown[]) => ({ success: true }));
vi.mock("@/domains/changelog/actions", () => ({
  createChangelogEntry: vi.fn(),
  updateChangelogHypothesis: (id: unknown, hypothesis: unknown, source?: unknown) =>
    updateHypothesis(id, hypothesis, source),
}));
vi.mock("@/lib/actions", () => ({
  now: () => "2026-07-17T22:00:00.000Z",
}));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-a" }));

let changelog: Array<Record<string, unknown>> = [];
const writeStore = vi.fn(async (_name: string, rows: Array<Record<string, unknown>>) => {
  changelog = rows;
});
vi.mock("@/lib/persistence/json-store", () => ({
  writeStore: (name: string, rows: Array<Record<string, unknown>>) => writeStore(name, rows),
}));
vi.mock("@/lib/seed-data.server", () => ({ getChangelogEntries: async () => changelog }));
const syncChangelogEntries = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/persistence/dual-write", () => ({
  syncChangelogEntries: (rows: unknown, tenantId: unknown) =>
    syncChangelogEntries(rows, tenantId),
}));

const typedEdit = {
  id: "edit-a",
  tenant_id: "tenant-a",
  rec_id: "rec-a",
  action_type: "edit_title",
  target_url: "https://example.com/page",
  target_element_key: "field:title",
  display_label: "Page title",
  current_text: "Old title",
  proposed_text: "Better title",
  why: "Real search demand",
  evidence: [],
  expected_impact: null,
  difficulty: "low",
  confidence: "high",
  measurement_plan: null,
  risks: [],
  source: "deterministic",
  provider_name: null,
  evidence_hash: null,
  model: null,
  cost_usd: null,
  created_at: "2026-07-17T21:00:00.000Z",
  updated_at: "2026-07-17T21:00:00.000Z",
  implementation_status: "recommended",
};
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: () => ({
      getRecommendedEdits: async () => [typedEdit],
      getTrackedPrompts: async () => [],
    }),
  }),
}));
const markAccepted = vi.fn(async (..._args: unknown[]) => ({ flipped: 1, skipped: 0 }));
vi.mock("@/domains/recommendations/recommended-edits-persistence", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    markRecommendedEditsAccepted: (args: unknown) => markAccepted(args),
  };
});
vi.mock("@/lib/auth/can-publish", () => ({ canPublishForCurrentTenant: async () => true }));

import { acceptRecommendation } from "@/app/(shell)/recommendations/actions";

const payload = {
  stableKey: "rec-a",
  type: "strengthen_page_copy" as const,
  title: "Improve this page",
  description: "Improve the title",
  clusterLabel: "topic",
  clusterKind: "topic" as const,
  resolution: {
    action: "strengthen_existing_page" as const,
    motive: "improve_close_prompt" as const,
    targetUrl: "https://example.com/page",
    reasoning: "The page already ranks.",
  },
};

describe("acceptRecommendation per-edit fanout idempotency", () => {
  beforeEach(() => {
    changelog = [];
    vi.clearAllMocks();
  });

  it("reuses the same deterministic row on a retry/double-submit", async () => {
    const first = await acceptRecommendation(payload);
    const second = await acceptRecommendation(payload);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.changeIds).toEqual(second.changeIds);
    expect(first.changeIds?.[0]).toMatch(/^cl-[0-9a-f]{24}$/);
    expect(changelog).toHaveLength(1);
    expect(changelog[0]).toMatchObject({
      id: first.changeIds?.[0],
      tenant_id: "tenant-a",
      source_rec_id: "rec-a",
      action_type: "edit_title",
      target_element_key: "field:title",
    });
    expect(writeStore).toHaveBeenCalledTimes(1);
    expect(syncChangelogEntries).toHaveBeenCalledTimes(1);
  });
});
