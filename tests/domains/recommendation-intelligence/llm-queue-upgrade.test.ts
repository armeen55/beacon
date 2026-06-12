/**
 * LLM flip-on slice (2026-06-12) — the production caller for the
 * structured-output LLM upgrade path. Pins the safety contract:
 * deterministic/unconfigured envs NEVER reach the queue loader or the
 * provider (zero spend, zero I/O beyond the env read).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const _loadCalls: unknown[] = [];
vi.mock("@/domains/recommendations/load-queue", () => ({
  loadLiveRecommendationQueue: async (args: unknown) => {
    _loadCalls.push(args);
    return { matrix: null, queue: [], errors: ["test"] };
  },
  buildPacketForRec: () => {
    throw new Error("not reached in these tests");
  },
}));
vi.mock("@/domains/recommendations/recommended-edits-persistence", () => ({
  runProviderAndPersist: async () => {
    throw new Error("not reached in these tests");
  },
}));
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: () => ({ getPageElementInventory: async () => [] }),
  }),
}));

import { upgradeQueueDraftsWithLlm } from "@/domains/recommendation-intelligence/llm-queue-upgrade";

const ORIGINAL_PROVIDER = process.env.BEACON_LLM_PROVIDER;
const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  _loadCalls.length = 0;
  delete process.env.BEACON_LLM_PROVIDER;
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  if (ORIGINAL_PROVIDER === undefined) delete process.env.BEACON_LLM_PROVIDER;
  else process.env.BEACON_LLM_PROVIDER = ORIGINAL_PROVIDER;
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
});

describe("upgradeQueueDraftsWithLlm — flip-on gates", () => {
  it("no-ops on the deterministic default (env unset) without touching the queue", async () => {
    const r = await upgradeQueueDraftsWithLlm({ tenantId: "tenant-a" });
    expect(r).toEqual({ ran: false, reason: "provider_deterministic" });
    expect(_loadCalls).toHaveLength(0);
  });

  it("no-ops fail-soft when openai is set WITHOUT a key (over-quota posture)", async () => {
    process.env.BEACON_LLM_PROVIDER = "openai";
    const r = await upgradeQueueDraftsWithLlm({ tenantId: "tenant-a" });
    expect(r.ran).toBe(false);
    if (!r.ran) expect(r.reason).toContain("provider_unconfigured");
    expect(_loadCalls).toHaveLength(0);
  });

  it("with openai + key, reaches the queue loader and reports matrix_unavailable honestly", async () => {
    process.env.BEACON_LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    const r = await upgradeQueueDraftsWithLlm({ tenantId: "tenant-a" });
    expect(r).toEqual({ ran: false, reason: "matrix_unavailable" });
    expect(_loadCalls).toHaveLength(1);
  });
});
