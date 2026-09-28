import { beforeEach, describe, expect, it, vi } from "vitest";
import spend, { runWithProposalWorkKey } from "@/lib/cost/spend-reservations";
import { ledgerDay } from "@/lib/cost/budget-ledger-supabase";
import { reportingDay } from "@/lib/reporting-day";
import { openAIStructuredResponse } from "@/domains/decision/llm/gateway"; import { z } from "zod";
const db = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]>, fail: false, taskRefusalAt: "" as "" | "reserve" | "claim", spent: 0 }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    db.calls.push([name, args]);
    if (db.fail) return { data: null, error: { message: "down" } };
    if (db.taskRefusalAt && db.taskRefusalAt === (name === "reserve_spend" ? "reserve" : name === "claim_spend_transmission" ? "claim" : "")
      && !(name === "claim_spend_transmission" && db.calls.some(([operation, input]) => operation === "reserve_spend"
        && input.p_platform === "other" && input.p_purpose === "atomic_proof_admission" && input.p_estimated_usd === 0)))
      return { data: null, error: { code: "P0001", message: "task_spend_cap_refused" } };
    if (name === "reserve_spend") return { error: null, data: [{ outcome: String(args.p_logical_key).startsWith("gateway:") ? "reserved" : "resumed", attempt_id: "a1",
      attempt_ordinal: 1, reservation_state: String(args.p_logical_key).startsWith("gateway:") ? "reserved" : "ambiguous", reporting_day: "2026-09-19",
      estimated_usd: 0.2, actual_usd: null, provider_task_id: null }] };
    if (name === "claim_spend_transmission") return { error: null, data: "claimed" };
    return { error: null, data: true };
  },
  from: () => { const q = { select: () => q, eq: () => q, then: (done: (v: unknown) => unknown) => done({ data: [{ spent_usd: db.spent }], error: null }) }; return q; },
}), isSupabaseConfigured: () => true }));
const account = vi.hoisted(() => ({ budget: 1 }));
vi.mock("@/domains/account", () => ({ getTenant: async () => ({ daily_budget_usd: account.budget }) }));
beforeEach(() => { db.calls = []; db.fail = false; db.taskRefusalAt = ""; vi.spyOn(console, "warn").mockImplementation(() => {}); });
describe("the tenant-wide spend door", () => {
  it("binds both proposal-scoped provider reservations to the same async work identity and leaves account research unbound", async () => {
    await runWithProposalWorkKey("proposal-work", async () => {
      await spend.reserve({ tenantId: "t1", platform: "dataforseo-serp", purpose: "owed serp", logicalKey: "serp:owed", estimatedUsd: 0.2 });
      await spend.reserve({ tenantId: "t1", platform: "adjudicator-openai", purpose: "owed review", logicalKey: "review:owed", estimatedUsd: 0.2 });
    });
    await spend.reserve({ tenantId: "t1", platform: "dataforseo-serp", purpose: "account research", logicalKey: "serp:account", estimatedUsd: 0.2 });
    expect(db.calls.filter(([name]) => name === "reserve_spend").map(([, args]) => args.p_proposal_work_key)).toEqual(["proposal-work", "proposal-work", null]);
  });
  it("resumes the database-owned unresolved attempt instead of minting an ordinal in the caller", async () => {
    const receipt = await spend.reserve({ tenantId: "t1", platform: "dataforseo-serp", purpose: "reading",
      logicalKey: "serp:q", estimatedUsd: 0.2, monthlyCapUsd: 250 });
    expect([receipt.outcome, receipt.attemptId, receipt.attemptOrdinal, receipt.state]).toEqual(["resumed", "a1", 1, "ambiguous"]);
    expect(db.calls[0]).toEqual(["reserve_spend", expect.objectContaining({ p_tenant_id: "t1", p_logical_key: "serp:q",
      p_estimated_usd: 0.2, p_monthly_cap_usd: 250, p_cohort_member: false })]);
  });
  it("fails closed on invalid input or an unreadable reservation RPC", async () => {
    await expect(spend.reserve({ tenantId: "", platform: "openai", purpose: "walk", logicalKey: "x", estimatedUsd: 1 })).rejects.toThrow("Invalid");
    expect(db.calls).toEqual([]); db.fail = true;
    await expect(spend.reserve({ tenantId: "t", platform: "openai", purpose: "walk", logicalKey: "x", estimatedUsd: 1 })).rejects.toThrow("down");
  });
  it("reports a task ceiling before purchase and releases a held attempt if it closes before transmission", async () => {
    db.taskRefusalAt = "reserve";
    const refused = await spend.reserve({ tenantId: "t1", platform: "openai", purpose: "walk", logicalKey: "x", estimatedUsd: 0.2 });
    expect([refused.outcome, refused.attemptId, db.calls.map(([name]) => name)]).toEqual(["refused_task", null, ["reserve_spend"]]);
    db.calls = []; db.taskRefusalAt = "claim";
    expect(await spend.claimTransmission("a1")).toBe("cap_refused");
    expect(db.calls.map(([name]) => name)).toEqual(["claim_spend_transmission", "release_spend"]);
    db.calls = [];
    await spend.reserve({ tenantId: "t1", platform: "other", purpose: "atomic_proof_admission", logicalKey: "proof-admission", estimatedUsd: 0 });
    expect(await spend.claimTransmission("a1")).toBe("claimed");
    expect(db.calls.map(([name]) => name)).toEqual(["reserve_spend", "claim_spend_transmission"]);
  });
});
describe("the canonical OpenAI spend lifecycle", () => {
const args = { promptId: "draft.body_edit" as const, promptVersion: 2, action: "test", apiKey: "x", model: "gpt-5-mini", instructions: "Return JSON", input: "one", schemaName: "one", zodSchema: z.object({ one: z.string() }), maxOutputTokens: 10, timeoutMs: 1, tenantId: "t1", spend: { platform: "adjudicator-openai" as const, purpose: "bulk" as const, logicalKey: "gateway:one", estimatedUsd: 0.2, monthlyCapUsd: 250 }, reservationImpl: spend };
  it("reserves before the wire, reconciles a receipt once, and holds an uncertain transmission", async () => {
    const envelope = { id: "resp-1", model: "gpt-5-mini", status: "completed", created_at: 1, output_text: '{"one":"yes"}', output: [{ type: "message", content: [{ type: "output_text", text: '{"one":"yes"}' }] }], usage: { input_tokens: 2, output_tokens: 2 } };
    const ok = await openAIStructuredResponse({ ...args, fetchImpl: (async () => ({ ok: true, status: 200, json: async () => envelope })) as unknown as typeof fetch }); expect(ok.kind).toBe("ok");
    expect(db.calls.map(([name]) => name)).toEqual(["reserve_spend", "claim_spend_transmission", "reconcile_spend"]); db.calls = [];
    const uncertain = await openAIStructuredResponse({ ...args, fetchImpl: (async () => { throw new Error("socket lost"); }) as typeof fetch }); expect(uncertain.kind).toBe("error");
    expect(db.calls.map(([name]) => name)).toEqual(["reserve_spend", "claim_spend_transmission", "mark_spend_ambiguous"]);
    expect(ledgerDay(new Date("2026-08-18T06:59:00Z"))).toBe(reportingDay(new Date("2026-08-18T06:59:00Z")));
  });
});
