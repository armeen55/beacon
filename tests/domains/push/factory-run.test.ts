/**
 * 2026-06-10 — factory-run orchestration (P0 wall 4).
 * Pins: plan validation, deterministic row ids (idempotent re-runs),
 * the daily budget gate (fail-open on unknown spend), persistence +
 * spend recording, and sync-warning surfacing.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

let _tenant: Record<string, unknown> | null = { id: "tenant-iranopedia", daily_budget_usd: 5 };
vi.mock("@/domains/tenants/store", () => ({
  getTenant: async () => _tenant,
}));

import {
  parseClusterPlan,
  draftsToRows,
  runClusterFactoryForTenant,
} from "@/domains/push/factory-run";
import type { ClusterFactoryResult, ClusterPlan } from "@/domains/push/cluster-factory";

const PLAN: ClusterPlan = {
  name: "Persian Food",
  dataCollectionId: "Foods",
  slugField: "slug",
  urlPrefix: "/persian-food",
  siteBaseUrl: "https://www.iranopedia.com",
  fields: [{ field: "title", instruction: "Dish name" }],
  items: [{ slug: "ghormeh-sabzi", title: "Ghormeh Sabzi", brief: "herb stew" }],
  contentRules: [],
  flaggedTerms: [],
};

function draft(over: Partial<Extract<ClusterFactoryResult, { ok: true }>["drafts"][number]> = {}) {
  return {
    action_type: "create_page" as const,
    target_url: "https://www.iranopedia.com/persian-food/ghormeh-sabzi",
    target_element_key: "create:Foods",
    display_label: "Persian Food: Ghormeh Sabzi (new page)",
    current_text: null,
    proposed_text: '{"slug":"ghormeh-sabzi","title":"Ghormeh Sabzi"}',
    why: "cluster",
    difficulty: "low" as const,
    confidence: "medium" as const,
    risks: [],
    expected_impact: null,
    measurement_plan: "poll",
    model: "gpt-5-mini",
    cost_usd: 0.001,
    ...over,
  };
}

describe("parseClusterPlan", () => {
  it("accepts a valid plan and normalizes optional arrays", () => {
    const r = parseClusterPlan(JSON.stringify({ ...PLAN, contentRules: undefined, flaggedTerms: undefined }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.contentRules).toEqual([]);
      expect(r.plan.flaggedTerms).toEqual([]);
    }
  });

  it("rejects garbage, missing fields, and malformed items", () => {
    expect(parseClusterPlan("not json").ok).toBe(false);
    expect(parseClusterPlan("[]").ok).toBe(false);
    expect(parseClusterPlan(JSON.stringify({ ...PLAN, dataCollectionId: "" })).ok).toBe(false);
    expect(parseClusterPlan(JSON.stringify({ ...PLAN, fields: [] })).ok).toBe(false);
    expect(parseClusterPlan(JSON.stringify({ ...PLAN, items: [{ slug: "x" }] })).ok).toBe(false);
  });
});

describe("draftsToRows", () => {
  it("builds deterministic ids — same tenant + url → same row id", () => {
    const now = new Date("2026-06-10T00:00:00Z");
    const a = draftsToRows([draft()], "tenant-iranopedia", now);
    const b = draftsToRows([draft()], "tenant-iranopedia", now);
    expect(a[0]!.id).toBe(b[0]!.id);
    expect(a[0]!.id).toContain("__create_page__create:Foods");
    expect(a[0]!.implementation_status).toBe("recommended");
    expect(a[0]!.provider_name).toBe("cluster-factory");
  });

  it("different tenants never share row ids", () => {
    const now = new Date("2026-06-10T00:00:00Z");
    const a = draftsToRows([draft()], "tenant-a", now);
    const b = draftsToRows([draft()], "tenant-b", now);
    expect(a[0]!.id).not.toBe(b[0]!.id);
  });
});

describe("runClusterFactoryForTenant", () => {
  function deps(over: Record<string, unknown> = {}) {
    const persisted: unknown[] = [];
    const spends: unknown[] = [];
    return {
      captured: { persisted, spends },
      deps: {
        generate: async () =>
          ({ ok: true, drafts: [draft()], totalCostUsd: 0.001, flagged: 0, rejected: 1, rejectedReasons: ["X: banned"] }) as ClusterFactoryResult,
        getSpentTodayUsd: async () => 0,
        persistLocal: async (rows: unknown[]) => {
          persisted.push(...rows);
        },
        syncRows: async () => {},
        recordSpend: async (input: unknown) => {
          spends.push(input);
        },
        now: new Date("2026-06-10T00:00:00Z"),
        ...over,
      },
    };
  }

  it("REFUSES when today's spend ≥ the tenant's daily budget", async () => {
    const d = deps({ getSpentTodayUsd: async () => 5 });
    const r = await runClusterFactoryForTenant("tenant-iranopedia", PLAN, d.deps as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("budget_exhausted");
    expect(d.captured.persisted).toHaveLength(0);
  });

  it("fails OPEN on unknown spend (null) — generation proceeds", async () => {
    const d = deps({ getSpentTodayUsd: async () => null });
    const r = await runClusterFactoryForTenant("tenant-iranopedia", PLAN, d.deps as never);
    expect(r.ok).toBe(true);
  });

  it("persists rows + records the spend + surfaces factory counts", async () => {
    const d = deps();
    const r = await runClusterFactoryForTenant("tenant-iranopedia", PLAN, d.deps as never);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.persisted).toBe(1);
      expect(r.rejected).toBe(1);
      expect(r.rejectedReasons[0]).toContain("banned");
    }
    expect(d.captured.persisted).toHaveLength(1);
    expect(d.captured.spends).toHaveLength(1);
    expect((d.captured.spends[0] as { platform: string }).platform).toBe("openai");
  });

  it("propagates factory refusals (llm_disabled) without persisting", async () => {
    const d = deps({
      generate: async () => ({ ok: false, reason: "llm_disabled", detail: "off" }) as ClusterFactoryResult,
    });
    const r = await runClusterFactoryForTenant("tenant-iranopedia", PLAN, d.deps as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("llm_disabled");
    expect(d.captured.persisted).toHaveLength(0);
  });

  it("surfaces a sync warning when Supabase mirroring fails (local write landed)", async () => {
    const d = deps({
      syncRows: async () => {
        throw new Error("supabase down");
      },
    });
    const r = await runClusterFactoryForTenant("tenant-iranopedia", PLAN, d.deps as never);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.syncWarning).toContain("supabase down");
  });
});

describe("per-tenant content rules injection (#35/#67, 2026-06-11)", () => {
  it("plan without rules inherits the tenant's configured rules + bans", async () => {
    vi.doMock("@/lib/business-config", () => ({
      getBusinessConfig: () => ({
        contentRules: ["Call the language Persian, never Farsi."],
        flaggedTerms: ["Farsi"],
      }),
      // Supabase hydrate returns null here → factory falls back to the sync
      // getBusinessConfig above (this test asserts the sync-config injection).
      hydrateBusinessConfigFromSupabase: async () => null,
    }));
    vi.resetModules();
    const mod = await import("@/domains/push/factory-run");
    let captured: import("@/domains/push/cluster-factory").ClusterPlan | null = null;
    await mod.runClusterFactoryForTenant(
      "tenant-iranopedia",
      { ...PLAN, contentRules: [], flaggedTerms: [] },
      {
        generate: async (p: import("@/domains/push/cluster-factory").ClusterPlan) => {
          captured = p;
          return { ok: true, drafts: [], totalCostUsd: 0, flagged: 0, rejected: 0, rejectedReasons: [] };
        },
        getSpentTodayUsd: async () => 0,
        persistLocal: async () => {},
        syncRows: async () => {},
        recordSpend: async () => {},
      } as never,
    );
    expect(captured!.contentRules).toEqual(["Call the language Persian, never Farsi."]);
    expect(captured!.flaggedTerms).toEqual(["Farsi"]);
    vi.doUnmock("@/lib/business-config");
  });

  it("plan-level rules override; tenant bans still MERGE in", async () => {
    vi.doMock("@/lib/business-config", () => ({
      getBusinessConfig: () => ({
        contentRules: ["tenant rule"],
        flaggedTerms: ["Farsi"],
      }),
      hydrateBusinessConfigFromSupabase: async () => null,
    }));
    vi.resetModules();
    const mod = await import("@/domains/push/factory-run");
    let captured: import("@/domains/push/cluster-factory").ClusterPlan | null = null;
    await mod.runClusterFactoryForTenant(
      "tenant-iranopedia",
      { ...PLAN, contentRules: ["plan rule"], flaggedTerms: ["PlanBan"] },
      {
        generate: async (p: import("@/domains/push/cluster-factory").ClusterPlan) => {
          captured = p;
          return { ok: true, drafts: [], totalCostUsd: 0, flagged: 0, rejected: 0, rejectedReasons: [] };
        },
        getSpentTodayUsd: async () => 0,
        persistLocal: async () => {},
        syncRows: async () => {},
        recordSpend: async () => {},
      } as never,
    );
    expect(captured!.contentRules).toEqual(["plan rule"]);
    expect([...captured!.flaggedTerms].sort()).toEqual(["Farsi", "PlanBan"]);
    vi.doUnmock("@/lib/business-config");
  });
});
