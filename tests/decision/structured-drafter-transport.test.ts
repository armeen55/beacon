/** structured-drafter strict-gateway transport: the seam returns parsed VALUES (no prose recovery), a refusal fails closed with no artifact, retry is bounded and paid
 *  for, and a cache hit costs $0. */
import { describe, it, expect, vi } from "vitest";
// Budget is not this file's subject (see llm-budget-isolation.test.ts): keep the transport hermetic with an always-allowed, no-op budget seam.
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({
  checkBudget: async () => ({ allowed: true, remaining: 10 }),
  recordSpend: async () => {},
}));
import { callStructuredLLM, draftInternalLinkStructured, type CompleteFn } from "@/domains/decision/llm/structured-drafter";
import type { CacheImpl, LlmCallCacheEntry } from "@/domains/decision/llm/call-cache";
// A schema-valid AtomicEditDraft value (the simplest kind, no source-verify / word-count / superlative machinery in the way of the transport assertions).
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
  it("tells every prompt whose draft is grounding-checked what grounding means, so no attempt is spent learning it", async () => {
    let seen = ""; const capture: CompleteFn = async (r) => { seen = r.system; return { error: "refusal", retryable: false }; };
    await draftInternalLinkStructured({ query: "haft seen", topic: "the table", sourcePage: "https://own.com/a", targetPage: "https://own.com/b", tenantId: "t" }, { complete: capture });
    expect([seen.includes('"evidenceRefs"'), seen.includes("at least one ref must NOT be ga4 or clarity")]).toEqual([true, true]); }); // the validator rejects the other answer
  it("drafts a VALUE, retries a recoverable answer once and no more, and never pays twice for one answer", async () => {
    const one = seam([{ value: VALID_ATOMIC_EDIT }]); // a parsed value, no text parsing, on one call
    const first = await callStructuredLLM({ ...REQ, complete: one.complete });
    expect(first.status === "drafted" && [(first.value as { after: string }).after.includes("Nowruz Traditions"), one.calls()]).toEqual([true, 1]);
    const boom = await callStructuredLLM({ ...REQ, complete: seam([{ error: "network boom", retryable: true }]).complete });
    expect(boom.status === "validation_failed" && boom.costUsd > 0).toBe(true); // 2-attempt ceiling, spend per attempt
    const again = seam([{ value: {} }, { value: VALID_ATOMIC_EDIT }]); // a rejection CAN recover
    const out = await callStructuredLLM({ ...REQ, complete: again.complete });
    expect(out.status === "drafted" && [out.retried, again.calls()]).toEqual([true, 2]);
    const refused = await callStructuredLLM({ ...REQ, complete: seam([{ error: "refusal", retryable: false, costUsd: 0.0123 }]).complete });
    expect(refused.status === "validation_failed" && refused.costUsd).toBe(0.0123); // no retry on a refusal, its real cost
    const now = new Date("2026-07-23T00:00:00Z").toISOString();
    const entry = { key: "ignored-key-is-derived", tenantId: "tenant-fixture", kind: "atomic_edit", promptId: "draft.atomic_edit",
      promptVersion: 1, value: VALID_ATOMIC_EDIT, primaryText: VALID_ATOMIC_EDIT.after, createdAt: now, lastUsedAt: now } as LlmCallCacheEntry;
    const cacheImpl: CacheImpl = { read: async () => entry, write: async () => {}, recentTexts: async () => [] };
    const hit = seam([{ error: "should-never-run", retryable: false }]);
    const cached = await callStructuredLLM({ ...REQ, complete: hit.complete, cacheImpl }); // served before any call
    expect(cached.status === "drafted" && [cached.cached, cached.costUsd, hit.calls()]).toEqual([true, 0, 0]);
    const blocked = seam([{ error: "blocked_budget", retryable: false }]);
    const stopped = await callStructuredLLM({ ...REQ, complete: blocked.complete }); // a budget block fired no call
    expect(stopped.status === "validation_failed" && [stopped.costUsd, blocked.calls()]).toEqual([0, 1]); }); });
