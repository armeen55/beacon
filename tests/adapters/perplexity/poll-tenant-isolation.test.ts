/**
 * Regression — 2026-06-10 cross-tenant poll leak (Invariant 5).
 *
 * History: the adapter read prompts/entities via the UNSCOPED base
 * repository (`getRepository().getTrackedPrompts()`), which returns
 * EVERY tenant's rows. Invisible while production had one tenant; the
 * moment Iranopedia became tenant #2, its first poll consumed Ritz's
 * 100 prompts and stamped the answers `tenant-iranopedia` (150/150 in
 * run pollrun-1781124607531-jgxwle).
 *
 * Pin: the default read path goes through `forTenant(tenantId)` —
 * the base unscoped getters are NEVER called by the adapter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const _baseGetPrompts = vi.fn(async () => {
  throw new Error("UNSCOPED base.getTrackedPrompts must never be called by the poll adapter");
});
const _baseGetEntities = vi.fn(async () => {
  throw new Error("UNSCOPED base.getTrackedEntities must never be called by the poll adapter");
});
const _forTenant = vi.fn((tenantId: string) => ({
  getTrackedPrompts: async () => [
    {
      id: `p-${tenantId}`,
      account_id: "x",
      tenant_id: tenantId,
      text: "only this tenant's prompt",
      topic_id: null,
      location_scope: null,
      service_scope: null,
      intent_type: null,
      platforms: ["perplexity"],
      tags: [],
      is_active: true,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    },
  ],
  getTrackedEntities: async () => [],
}));

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    getTrackedPrompts: _baseGetPrompts,
    getTrackedEntities: _baseGetEntities,
    forTenant: (tid: string) => _forTenant(tid),
  }),
}));

import { pollPerplexityForTenant } from "@/adapters/perplexity/poll";
import type { QueryClient } from "@/lib/querying/types";

beforeEach(() => {
  _forTenant.mockClear();
  _baseGetPrompts.mockClear();
  _baseGetEntities.mockClear();
});

describe("poll adapter — tenant-scoped reads (Invariant 5)", () => {
  it("reads prompts/entities via forTenant(tenantId); never the unscoped base", async () => {
    const seen: string[] = [];
    const client: QueryClient = {
      query: async (prompt: string) => {
        seen.push(prompt);
        return {
          answerText: "an answer",
          citations: [],
          usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        } as unknown as Awaited<ReturnType<QueryClient["query"]>>;
      },
    } as unknown as QueryClient;

    // dryRun-ish: inject client; persistence seams default — but with one
    // prompt and a mock client the adapter exercises the read path fully
    // before any write matters. Force=true bypasses gates that need DB.
    const result = await pollPerplexityForTenant("tenant-isolation-test", {
      client,
      // keep the run from touching real persistence
      persist: false as never,
    } as never).catch(() => null);

    // The load-bearing assertions: scoped read happened, unscoped never did.
    expect(_forTenant).toHaveBeenCalledWith("tenant-isolation-test");
    expect(_baseGetPrompts).not.toHaveBeenCalled();
    expect(_baseGetEntities).not.toHaveBeenCalled();
    // And the only prompt polled is the tenant's own.
    expect(seen.length).toBeLessThanOrEqual(1);
    if (seen.length === 1) expect(seen[0]).toContain("only this tenant's prompt");
    void result;
  });
});
