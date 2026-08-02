/**
 * structured-drafter strict-gateway transport behavior: the complete seam
 * returns parsed VALUES (no prose recovery); refusal/incomplete fail closed
 * with no artifact; bounded retry with per-attempt spend; cache hits cost $0.
 */
import { describe, it, expect, vi } from "vitest";
// Budget is not this file's subject (see llm-budget-isolation.test.ts): keep the
// transport hermetic with an always-allowed, no-op budget seam.
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({
  checkBudget: async () => ({ allowed: true, remaining: 10 }),
  recordSpend: async () => {},
}));
import { callStructuredLLM, type CompleteFn } from "@/domains/decision/llm/structured-drafter";
import type { CacheImpl, LlmCallCacheEntry } from "@/domains/decision/llm/call-cache";
// A schema-valid AtomicEditDraft value (the simplest kind — no source-verify /
// word-count / superlative machinery in the way of the transport assertions).
const VALID_ATOMIC_EDIT = {
  field: "title", before: "Nowruz", after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen",
  rationale: "The current title is one word and misses the customs searchers ask about.",
  evidenceRefs: [{ source: "gsc", detail: "strong impressions for nowruz traditions with a low click rate" }],
  confidence: "high", risks: ["keep the title concise"], operatorSteps: ["Replace the page title field with the new value"],
  proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" },
};
const REQ = {
  kind: "atomic_edit" as const, tenantId: "tenant-fixture",
  system: "You improve one on-page field. Return the field, before, after, rationale, evidenceRefs, confidence, risks, operatorSteps, proofPlan.",
  user: "Page: Nowruz. Field to edit: title. Current title: Nowruz.",
  grounded: "nowruz traditions persian new year customs haft-seen",
};
/** A `complete` double that replays a queue and counts how many times it ran. */
function seam(responses: Array<{ value: unknown } | { error: string; retryable: boolean; costUsd?: number }>): { complete: CompleteFn; calls: () => number } {
  let i = 0, calls = 0;
  const complete: CompleteFn = async () => { calls += 1; return responses[Math.min(i++, responses.length - 1)]!; };
  return { complete, calls: () => calls };
}
describe("structured-drafter strict transport", () => {
  it("refuses a draft argued from analytics alone, and takes the same draft once it also cites a search", async () => {
    const refs = (r: unknown[]) => ({ value: { ...VALID_ATOMIC_EDIT, evidenceRefs: r } });
    const clarity = [{ source: "clarity", detail: "people stop scrolling about halfway down the page" }];
    const bad = await callStructuredLLM({ ...REQ, complete: seam([refs(clarity), refs(clarity)]).complete }); // both attempts, still nothing about a search
    expect([bad.status, bad.status === "validation_failed" && bad.reason.startsWith("evidenceRefs: analytics alone")]).toEqual(["validation_failed", true]);
    const good = await callStructuredLLM({ ...REQ, complete: seam([refs([...clarity, { source: "gsc", detail: "strong impressions with a low click rate" }])]).complete });
    expect(good.status).toBe("drafted"); }); // ga4 and clarity are welcome BESIDE evidence of the search, never instead of it
  it("drafts a schema-valid VALUE (no text parsing)", async () => {
    const { complete, calls } = seam([{ value: VALID_ATOMIC_EDIT }]);
    const out = await callStructuredLLM({ ...REQ, complete });
    expect(out.status).toBe("drafted"); if (out.status !== "drafted") return;
    expect([(out.value as { after: string }).after.includes("Nowruz Traditions"), calls()]).toEqual([true, 1]); });
  it("a retryable transport error retries within the ceiling, recording spend per attempt", async () => {
    const { complete, calls } = seam([{ error: "network boom", retryable: true }]);
    const out = await callStructuredLLM({ ...REQ, complete });
    expect(out.status).toBe("validation_failed"); if (out.status !== "validation_failed") return;
    expect(calls()).toBe(2); expect(out.costUsd).toBeGreaterThan(0); // bounded 2-attempt ceiling, spend recorded per attempt
  });
  it("a schema-invalid value then a valid one drafts on the retry", async () => { // the ONLY pin that a rejection can RECOVER
    const { complete, calls } = seam([{ value: {} }, { value: VALID_ATOMIC_EDIT }]);
    const out = await callStructuredLLM({ ...REQ, complete });
    expect(out.status).toBe("drafted"); if (out.status !== "drafted") return;
    expect([out.retried, calls()]).toEqual([true, 2]); });
  it("a budget block from the gateway fails closed with no spend", async () => {
    const { complete, calls } = seam([{ error: "blocked_budget", retryable: false }]);
    const out = await callStructuredLLM({ ...REQ, complete });
    expect(out.status).toBe("validation_failed");
    if (out.status !== "validation_failed") return;
    expect(out.costUsd).toBe(0); // a budget block fired no call → no spend
    expect(calls()).toBe(1);
  });
  it("a cache hit costs $0 and never calls complete", async () => {
    const now = new Date("2026-07-23T00:00:00Z");
    const entry: LlmCallCacheEntry = {
      key: "ignored-key-is-derived", tenantId: "tenant-fixture", kind: "atomic_edit",
      promptId: "draft.atomic_edit", promptVersion: 1, value: VALID_ATOMIC_EDIT,
      primaryText: VALID_ATOMIC_EDIT.after, createdAt: now.toISOString(), lastUsedAt: now.toISOString(),
    };
    const cacheImpl: CacheImpl = { read: async () => entry, write: async () => {}, recentTexts: async () => [] };
    const { complete, calls } = seam([{ error: "should-never-run", retryable: false }]);
    const out = await callStructuredLLM({ ...REQ, complete, cacheImpl });
    expect(out.status).toBe("drafted");
    if (out.status !== "drafted") return;
    expect(out.cached).toBe(true);
    expect(out.costUsd).toBe(0);
    expect(calls()).toBe(0); // the hit is served before any call
  });
  it("a refusal's REAL usage cost lands in spend, not just the input estimate", async () => {
    const { complete, calls } = seam([{ error: "refusal", retryable: false, costUsd: 0.0123 }]);
    const out = await callStructuredLLM({ ...REQ, complete });
    expect(out.status).toBe("validation_failed");
    if (out.status !== "validation_failed") return;
    expect(calls()).toBe(1); // no retry on refusal
    expect(out.costUsd).toBeCloseTo(0.0123, 6); // gateway usage cost, not estimate
  });
});
