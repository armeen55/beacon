import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  openAIStructuredResponse, effectiveTimeoutMs, isReasoningModel, estimateCost, strictJsonSchemaFor, llmFailureOf,
  type StructuredCallArgs, type CostBreakerImpl,
} from "@/domains/decision/llm/gateway";
import { createHash } from "node:crypto"; import { PROOF_SPEND, runWithoutSpending } from "@/lib/spend-scope"; import { PROMPT_REGISTRY } from "@/domains/decision/llm/prompt-registry"; import * as persistence from "@/lib/persistence/supabase";
import { decideCreditBreaker } from "@/lib/cost/credit-breaker";
import { SCHEMA_BY_KIND } from "@/domains/decision/llm/schemas";
const SCHEMA = z.object({ title: z.string(), note: z.string().optional(), score: z.number().nullable() }); // note = optional-not-nullable (provider null must be stripped); score = genuinely nullable (null kept).
function completedEnvelope(structuredText: string, over: Record<string, unknown> = {}) {
  return {
    id: "resp_abc123", model: "gpt-5-mini", status: "completed", created_at: 1_753_000_000,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: structuredText }] }],
    output_text: structuredText, usage: { input_tokens: 1200, output_tokens: 300 }, ...over,};}
type FetchCapture = { calls: number; url: string | null; body: any; requestIds: string[] };
function fakeFetch(envelope: unknown, opts: { ok?: boolean; status?: number; throwErr?: Error; notJson?: boolean; retryAfter?: string } = {}): { impl: typeof fetch; capture: FetchCapture } {
  const capture: FetchCapture = { calls: 0, url: null, body: null, requestIds: [] };
  const impl = (async (url: string, init: RequestInit) => {
    capture.calls += 1; capture.url = url; capture.body = init?.body ? JSON.parse(init.body as string) : null;
    capture.requestIds.push(String((init.headers as Record<string, string>)["Idempotency-Key"] ?? ""));
    if (opts.throwErr) throw opts.throwErr;
    return { ok: opts.ok ?? true, status: opts.status ?? 200, headers: { get: (k: string) => (k.toLowerCase() === "retry-after" ? opts.retryAfter ?? null : null) },
      json: async () => { if (opts.notJson) throw new Error("not json"); return envelope; } } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, capture };}
function baseArgs(over: Partial<StructuredCallArgs> = {}): StructuredCallArgs {
  return {
    promptId: "draft.body_edit", promptVersion: 2, action: "gateway-test", apiKey: "sk-test", model: "gpt-5-mini",
    instructions: "You are a strict JSON generator.", input: "Make a title.", schemaName: "test_schema", zodSchema: SCHEMA,
    maxOutputTokens: 512, timeoutMs: 30_000, tenantId: "tenant-fixture", spend: { platform: "adjudicator-openai", purpose: "bulk", logicalKey: "gateway-test", estimatedUsd: 0.02, monthlyCapUsd: 250 }, reservationImpl: lifecycle().impl, ...over,};}
const allowBreaker: CostBreakerImpl = { check: async () => ({ tripped: false }) };
const lifecycle = () => { let state: "reserved" | "transmitted" | "ambiguous" = "reserved"; const seen: string[] = []; return { seen, impl: { reserve: async () => (seen.push("reserve"), { outcome: state === "reserved" ? "reserved" as const : "resumed" as const, attemptId: "a1", attemptOrdinal: 1, state, reportingDay: "2026-09-19", estimatedUsd: 0.02, actualUsd: null, providerTaskId: null }), claimTransmission: async () => (seen.push("claim"), state === "reserved" ? (state = "transmitted", "claimed" as const) : "already_started" as const), markAmbiguous: async () => (seen.push("ambiguous"), state = "ambiguous", true), release: async (_id: string, proven?: boolean) => (seen.push(`release:${proven === true}`), true), reconcile: async () => (seen.push("reconcile"), true) } }; };
const storedResult = (json: unknown, accountedUsd: number, accountingBasis: "usage_estimate" | "reservation_estimate" = "usage_estimate") => ({ outcome: "replayed" as const, attemptId: "a1", attemptOrdinal: 1,
  state: "reconciled" as const, reportingDay: "2026-09-19", estimatedUsd: .02, accountedUsd, providerTaskId: "resp_abc123", accountingBasis, resultPayload: json });
function assertFullyStrict(n: Record<string, unknown>, at: string): void {
  if (Array.isArray(n.anyOf)) return void (n.anyOf as Record<string, unknown>[]).forEach((v, i) => assertFullyStrict(v, `${at}|${i}`));
  if (n.type === "array" && n.items && typeof n.items === "object") return assertFullyStrict(n.items as Record<string, unknown>, `${at}[]`);
  if (n.type !== "object") return;
  const keys = Object.keys((n.properties ?? {}) as Record<string, unknown>);
  expect([n.additionalProperties, new Set(n.required as string[])], `${at}: strict and fully required`).toEqual([false, new Set(keys)]);
  for (const k of keys) assertFullyStrict((n.properties as Record<string, Record<string, unknown>>)[k]!, `${at}.${k}`);}
describe("openAIStructuredResponse — fails closed before any fetch", () => {
  it("converts EVERY drafter schema in the registry, with no unsupported construct and nothing left loose", () => {
    for (const kind of Object.keys(SCHEMA_BY_KIND) as Array<keyof typeof SCHEMA_BY_KIND>) {
      const out = strictJsonSchemaFor(SCHEMA_BY_KIND[kind], kind); expect("unsupported" in out, `${kind}: ${(out as { unsupported?: string }).unsupported}`).toBe(false);
      if (!("unsupported" in out)) assertFullyStrict(out.schema as Record<string, unknown>, kind);}});
  it.each([ // Every pre-network refusal spends nothing, calls nobody, and SAYS WHY. One promise, so one test.
    ["a tripped global cost breaker", { costBreakerImpl: { check: async () => ({ tripped: true, reason: "ceiling reached" }) } }, "blocked_budget", "ceiling reached"],
    ["a schema the provider cannot take", { zodSchema: z.object({ a: z.any() }) }, "invalid_response", "unsupported_schema"],
    ["no account to charge", { tenantId: "  " }, "invalid_response", "missing_tenant"],
  ] as const)("%s blocks with no fetch, no spend, and a named reason", async (_name, over, kind, reason) => {
    const { impl, capture } = fakeFetch(completedEnvelope("{}")); const res = await openAIStructuredResponse(baseArgs({ ...(over as Partial<StructuredCallArgs>), fetchImpl: impl }));
    expect([res.kind, capture.calls]).toEqual([kind, 0]);
    if (res.kind === "blocked_budget") expect(res.reason).toBe(reason);
    if (res.kind === "invalid_response") { expect(res.reason).toContain(reason); expect(res.provenance).toBeUndefined(); } // no provenance, no cost
  }); });
describe("openAIStructuredResponse — request body", () => {
  it("sends EXACT Responses fields and omits Chat-Completions fields", async () => {
    const { impl, capture } = fakeFetch(completedEnvelope(JSON.stringify({ title: "T", note: null, score: 1 }))); await openAIStructuredResponse(baseArgs({ fetchImpl: impl }));
    expect(capture.url).toBe("https://api.openai.com/v1/responses"); const body = capture.body;
    expect([body.instructions, body.input, body.max_output_tokens]).toEqual(["You are a strict JSON generator.", "Make a title.", 512]);
    expect([body.text.format.type, body.text.format.name, body.text.format.strict]).toEqual(["json_schema", "test_schema", true]);
    expect(body.text.format.schema.additionalProperties).toBe(false); // reasoning model gets reasoning.effort default
    expect(body.reasoning).toEqual({ effort: "low" });
    for (const k of ["messages", "max_completion_tokens", "reasoning_effort", "response_format"]) expect(body[k]).toBeUndefined(); }); }); // Chat-Completions fields MUST be absent.
describe("openAIStructuredResponse — envelope outcomes", () => {
  it("parses a completed valid response to ok with provenance and normalized nulls", async () => {
    const { impl } = fakeFetch(completedEnvelope(JSON.stringify({ title: "Hello", note: null, score: null }))), life = lifecycle(); const res = await openAIStructuredResponse(baseArgs({ fetchImpl: impl, reservationImpl: life.impl }));
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    const value = res.value as Record<string, unknown>;
    expect([value.title, "note" in value, value.score, SCHEMA.safeParse(value).success]).toEqual(["Hello", false, null, true]); // optional-not-nullable null stripped, nullable kept
    const p = res.provenance; // provenance carries the account
    expect([p.tenantId, p.responseId, p.servedModel, p.requestedModel, p.status]).toEqual(["tenant-fixture", "resp_abc123", "gpt-5-mini", "gpt-5-mini", "completed"]);
    expect([p.inputTokens, p.outputTokens, p.costUsd, p.retryCount, life.seen]).toEqual([1200, 300, estimateCost("gpt-5-mini", 1200, 300), 0, ["reserve", "claim", "reconcile"]]); });
  it("replays a transactionally stored provider result without touching the wire", async () => {
    const json = completedEnvelope(JSON.stringify({ title: "Recovered", score: null })), life = lifecycle(), wire = fakeFetch(json);
    const reservationImpl = { ...life.impl, reserve: async () => storedResult(json, .001) };
    const out = await openAIStructuredResponse(baseArgs({ fetchImpl: wire.impl, reservationImpl }));
    expect([out.kind, out.httpAttempts, wire.capture.calls, out.kind === "ok" && (out.value as { title: string }).title,
      out.kind === "ok" && out.provenance.costBasis, out.kind === "ok" && out.provenance.costUsd,
      out.kind === "ok" && out.provenance.accountedCostUsd]).toEqual(["ok", 0, 0, "Recovered", "usage_estimate", 0, 0.001]);
    const args = baseArgs({ promptId: "draft.editor_judgement", promptVersion: PROMPT_REGISTRY["draft.editor_judgement"], spend: { ...baseArgs().spend, proposalWorkKey: "review::tenant-fixture::copy::material" }, fetchImpl: wire.impl }); delete args.reservationImpl;
    const converted = strictJsonSchemaFor(args.zodSchema, args.schemaName); if ("unsupported" in converted) throw Error("Fixture schema invalid");
    const body = { model: args.model, instructions: args.instructions, input: args.input, max_output_tokens: args.maxOutputTokens, text: { format: { type: "json_schema", name: converted.name, schema: converted.schema, strict: true } }, reasoning: { effort: "low" } }, original = { tenant_id: args.tenantId, platform: args.spend.platform, purpose: args.spend.purpose, logical_key: args.spend.logicalKey, proposal_work_key: args.spend.proposalWorkKey, request_fingerprint: createHash("sha256").update(`https://api.openai.com/v1/responses\n${JSON.stringify(body)}`).digest("hex"), state: "reconciled", result_payload: json, accounted_usd: .001, accounting_basis: "usage_estimate" };
    let held = { ...original }, error = false; const queries: Array<[string, unknown]> = [], admin = vi.spyOn(persistence, "getSupabaseAdmin").mockImplementation(() => ({ from: (table: string) => {
      expect(table).toBe("spend_reservations"); const filters: Array<(r: typeof held) => boolean> = [], q = { select: () => q, eq: (k: string, v: unknown) => (queries.push([k, v]), filters.push(r => r[k as keyof typeof held] === v), q), is: (k: string, v: unknown) => q.eq(k, v), in: (k: string, vs: unknown[]) => (filters.push(r => vs.includes(r[k as keyof typeof held])), q), order: () => q, limit: () => q, maybeSingle: async () => ({ data: filters.every(f => f(held)) ? held : null, error: error ? { message: "Unavailable" } : null }) }; return q; } }) as never);
    try { const recovered = await runWithoutSpending(() => openAIStructuredResponse(args)); expect([recovered.kind, recovered.httpAttempts, recovered.kind === "ok" && recovered.value, wire.capture.calls]).toEqual(["ok", 0, { title: "Recovered", score: null }, 0]);
      const liveCache = await PROOF_SPEND.run(args.tenantId, 1, .05, () => openAIStructuredResponse({ ...args, costBreakerImpl: { check: async () => { throw Error("Paid gate reached"); } } })); expect([liveCache.kind, liveCache.httpAttempts, wire.capture.calls]).toEqual(["ok", 0, 0]);
      expect(queries).toEqual(expect.arrayContaining([["tenant_id", args.tenantId], ["logical_key", args.spend.logicalKey], ["proposal_work_key", args.spend.proposalWorkKey], ["request_fingerprint", original.request_fingerprint], ["state", "reconciled"]]));
      for (const over of [{ tenant_id: "foreign" }, { proposal_work_key: "other-role" }, { request_fingerprint: "changed-material" }, { state: "ambiguous" }, { result_payload: null }]) { held = { ...original, ...over } as typeof held; const miss = await runWithoutSpending(() => openAIStructuredResponse(args)); expect([miss.kind, miss.httpAttempts, wire.capture.calls]).toEqual(["blocked_budget", 0, 0]); }
      held = { ...original }; error = true; expect((await runWithoutSpending(() => openAIStructuredResponse(args))).kind).toBe("blocked_budget"); error = false; expect((await runWithoutSpending(() => openAIStructuredResponse({ ...args, promptVersion: args.promptVersion - 1 }))).kind).toBe("blocked_budget");
    } finally { admin.mockRestore(); }
  });
  it.each([{ input_tokens: 1200 }, { input_tokens: -1, output_tokens: 300 }, { input_tokens: 1200.5, output_tokens: 300 },
    { input_tokens: 1200, output_tokens: -1 }, { input_tokens: 1200, output_tokens: 2.5 }])
  ("keeps fresh and stored output with partial or malformed usage, accounting at the reservation estimate: %j", async (usage) => {
    const json = completedEnvelope(JSON.stringify({ title: "Partial", score: null }), { usage }), life = lifecycle(), wire = fakeFetch(json);
    const fresh = await openAIStructuredResponse(baseArgs({ fetchImpl: wire.impl, reservationImpl: life.impl }));
    const stored = await openAIStructuredResponse(baseArgs({ fetchImpl: wire.impl, reservationImpl: { ...lifecycle().impl, reserve: async () => storedResult(json, .02, "reservation_estimate") } }));
    expect([fresh.kind, fresh.httpAttempts, fresh.kind === "ok" && fresh.provenance.costBasis, life.seen,
      stored.kind, stored.httpAttempts, stored.kind === "ok" && stored.provenance.costBasis, stored.kind === "ok" && stored.provenance.accountedCostUsd, wire.capture.calls])
      .toEqual(["ok", 1, "reservation_estimate", ["reserve", "claim", "reconcile"], "ok", 0, "reservation_estimate", .02, 1]);
  });
  it("returns refusal (no value) when the message carries a refusal part", async () => {
    const env = completedEnvelope("ignored");
    env.output = [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "I can't." }] }] as any;
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: fakeFetch(env).impl })); expect([res.kind, res.kind === "refusal" && res.provenance.responseId]).toEqual(["refusal", "resp_abc123"]); });
  it("returns incomplete (no value) when status is incomplete", async () => {
    const env = completedEnvelope("partial", { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }); const res = await openAIStructuredResponse(baseArgs({ fetchImpl: fakeFetch(env).impl }));
    expect([res.kind, res.kind === "incomplete" && res.reason]).toEqual(["incomplete", "max_output_tokens"]); });
  it.each([ // Every answer that is NOT a usable value, named exactly, and never substring-hunted out of prose.
    ["a failed status", completedEnvelope("x", { status: "failed", output: [] }), {}, "invalid_response", "failed_status"],
    ["a completed answer with no structured output", completedEnvelope("x", { output: [], output_text: "" }), {}, "invalid_response", "no_structured_output"],
    ["prose where JSON was owed", completedEnvelope("this is prose, not json"), {}, "invalid_response", "structured output was not valid JSON"],
    ["a non-2xx answer", completedEnvelope("{}"), { ok: false, status: 429 }, "http_error", 429],
    ["a fetch that threw", completedEnvelope("{}"), { throwErr: new Error("The operation was aborted") }, "error", "aborted"],
  ] as const)("%s is named, never guessed at", async (_name, env, opts, kind, detail) => {
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: fakeFetch(env, opts).impl })); expect(res.kind).toBe(kind);
    if (res.kind === "http_error") expect(res.status).toBe(detail);
    else if (res.kind === "error") expect(res.reason).toContain(detail);
    else if (res.kind === "invalid_response") {
      expect(res.reason).toBe(detail);
      if (detail === "failed_status") expect([res.provenance?.tenantId, res.provenance?.costUsd]).toEqual(["tenant-fixture", estimateCost("gpt-5-mini", 1200, 300)]);}}); // A POST-network invalid supplied usage, so its cost is real spend and must not be discarded.
  it("calls a timeout a timeout by name only, never by wording, because my own deadline brings back no body and no usage receipt", async () => {
    const sig = AbortSignal.timeout(1); await new Promise((r) => setTimeout(r, 5)); // ONE IDENTITY: the NAME on AbortSignal.timeout's reason. Sniffing "abort" out of a message made every dead socket a deadline.
    const life = lifecycle(), wire = fakeFetch(completedEnvelope("{}"), { throwErr: new Error("socket lost") }), uncertain = await openAIStructuredResponse(baseArgs({ fetchImpl: wire.impl, reservationImpl: life.impl })), replay = await openAIStructuredResponse(baseArgs({ fetchImpl: wire.impl, reservationImpl: life.impl })); const err = async (e: Error) => openAIStructuredResponse(baseArgs({ fetchImpl: fakeFetch(completedEnvelope("{}"), { throwErr: e }).impl }));
    expect([await err(sig.reason as Error), await err(new Error("socket hang up: request aborted"))].map((r) => [r.kind === "error" && r.timedOut, llmFailureOf(r)])).toEqual([[true, "client_timeout"], [false, "transient"]]); expect([uncertain.kind, replay.kind, replay.kind === "blocked_budget" && replay.reason, wire.capture.calls, wire.capture.requestIds, life.seen]).toEqual(["error", "blocked_budget", "this paid operation already started and remains unresolved", 1, ["a1"], ["reserve", "claim", "ambiguous", "reserve"]]);});
  it("floors reasoning-model timeouts to 90s and leaves others alone", () => {
    expect([isReasoningModel("gpt-5-mini"), isReasoningModel("gpt-4o-mini")]).toEqual([true, false]);
    expect([effectiveTimeoutMs("gpt-5-mini", 1_000), effectiveTimeoutMs("gpt-5-mini", 120_000), effectiveTimeoutMs("gpt-4o-mini", 1_000)]).toEqual([90_000, 120_000, 1_000]); });});
describe("openAIStructuredResponse: what a failed call says, and what it stops", () => {
  const credit = (stop: "clear" | "held" | "probe_due" = "clear") => { const seen: string[] = []; return { seen, impl: { peek: async () => stop, claimProbe: async () => (seen.push("claim"), true), trip: async () => { seen.push("trip"); }, clear: async () => { seen.push("clear"); } } }; };
  const body = (over: Record<string, unknown>) => ({ error: { message: "You are rate limited. Email sales@example.com and quote org-9 to raise it.", ...over } });
  const call = (over: Partial<StructuredCallArgs>) => openAIStructuredResponse(baseArgs(over));
  it("returns quota and rate refusals to the day while holding a server failure for reconciliation", async () => {
    for (const [status, code, receipt] of [[429, "rate_limit_exceeded", "release:true"], [500, "server_error", "ambiguous"]] as const) {
      const life = lifecycle(); await call({ reservationImpl: life.impl, fetchImpl: fakeFetch(body({ code }), { ok: false, status }).impl });
      expect(life.seen).toEqual(["reserve", "claim", receipt]); }
  });
  it("never uses a later refusal to erase an earlier ambiguous transmission", async () => {
    const life = lifecycle();
    await call({ reservationImpl: life.impl, fetchImpl: fakeFetch({}, { throwErr: new Error("socket lost") }).impl });
    const retryWire = fakeFetch(body({ code: "rate_limit_exceeded" }), { ok: false, status: 429 });
    const retry = await call({ reservationImpl: life.impl, fetchImpl: retryWire.impl });
    expect([retry.kind, retry.httpAttempts, retryWire.capture.calls, life.seen]).toEqual(["blocked_budget", 0, 0, ["reserve", "claim", "ambiguous", "reserve"]]);
    for (const interruption of ["concurrent transmission", "deadline"] as const) { const held = lifecycle(), untouched = fakeFetch(completedEnvelope("{}")), at = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(at); let state = "reserved", proven: boolean | undefined;
      try { const raced = await PROOF_SPEND.run("tenant-fixture", 24, 1, () => call({ fetchImpl: untouched.impl, reservationImpl: { ...held.impl, release: async (_id, knownZero) => { proven = knownZero; if (knownZero || state === "reserved") state = "released"; return state === "released"; } } }), { maxExternalCalls: 0, maxExternalUsd: 0, stopBy: at + 1, guard: async () => { if (interruption === "deadline") { clock.mockReturnValue(at + 2); return true; } state = "transmitted"; return false; } });
      expect([raced.kind, raced.httpAttempts, untouched.capture.calls, held.seen, proven, state]).toEqual(["blocked_budget", 0, 0, ["reserve"], false, interruption === "deadline" ? "released" : "transmitted"]);
      } finally { clock.mockRestore(); } }
  });
  it("names the provider's own code, carries Retry-After, lets no free text out of the door, and holds an empty balance before the network", async () => {
    const c = credit(); // the WHOLE result, twice over: no message, no address, no org id, and a body naming no code claims none
    expect(await call({ creditBreakerImpl: c.impl, fetchImpl: fakeFetch(body({ type: "rate_limit_error", code: "rate_limit_exceeded" }), { ok: false, status: 429, retryAfter: "2" }).impl }))
      .toEqual({ httpAttempts: 1, kind: "http_error", status: 429, code: "rate_limit_exceeded", retryAfterMs: 2_000 }); // ONE request left the process, and the receipt says so
    expect(await call({ creditBreakerImpl: c.impl, fetchImpl: fakeFetch({ nothing: true }, { ok: false, status: 500 }).impl })).toEqual({ httpAttempts: 1, kind: "http_error", status: 500 });
    expect(c.seen).toEqual([]); // an ordinary throttle is not an empty account
    const dead = await call({ creditBreakerImpl: c.impl, fetchImpl: fakeFetch(body({ type: "insufficient_quota", code: "project_spend_limit_exceeded" }), { ok: false, status: 429 }).impl });
    expect([dead, c.seen]).toEqual([{ httpAttempts: 1, kind: "http_error", status: 429, code: "project_spend_limit_exceeded" }, ["trip"]]);
    const stopped = credit("held"), held = fakeFetch(completedEnvelope("{}")), refused = await call({ creditBreakerImpl: stopped.impl, fetchImpl: held.impl });
    expect([refused.kind, held.capture.calls, stopped.seen, refused.kind === "blocked_credit" && refused.reason.includes("account access is unavailable")]).toEqual(["blocked_credit", 0, [], true]); // every caller inherits the stop, and a HELD account claims no probe and reaches no network
    const back = credit(), through = fakeFetch(completedEnvelope(JSON.stringify({ title: "T", score: null }))).impl; expect([(await call({ creditBreakerImpl: back.impl, fetchImpl: through })).kind, back.seen]).toEqual(["ok", ["clear"]]); });
  it("reports zero requests for every refusal decided before the network, and one once the request is on the wire", async () => {
    const never = fakeFetch(completedEnvelope("{}"));
    const held = await call({ creditBreakerImpl: credit("held").impl, fetchImpl: never.impl });
    const noTenant = await call({ creditBreakerImpl: credit().impl, fetchImpl: never.impl, tenantId: "" });
    const life = lifecycle(), probeLost = await call({ creditBreakerImpl: { ...credit("probe_due").impl, claimProbe: async () => false }, fetchImpl: never.impl, reservationImpl: life.impl });
    expect([held.httpAttempts, noTenant.httpAttempts, probeLost.httpAttempts, never.capture.calls]).toEqual([0, 0, 0, 0]);
    expect([held.kind, noTenant.kind, probeLost.kind, life.seen]).toEqual(["blocked_credit", "invalid_response", "blocked_credit", ["reserve", "claim", "release:true"]]); // the final spend gate is claimed first, then released with proof when the provider probe cannot be recorded
    const wire = fakeFetch(completedEnvelope(JSON.stringify({ title: "T", score: null })));
    const through = await call({ creditBreakerImpl: credit().impl, fetchImpl: wire.impl });
    expect([through.httpAttempts, wire.capture.calls]).toEqual([1, 1]); // counted once, by the only line that can know
  });
  it("holds the stop until a probe is due, then allows exactly one", () => {
    const t = { trippedAt: "2026-08-04T12:00:00.000Z", probeAt: null }, at = (iso: string) => new Date(iso); // one probe, fifteen minutes after the stop, and the stamp restarts the wait
    expect([decideCreditBreaker(null, at("2026-08-04T12:00:00.000Z")), decideCreditBreaker(t, at("2026-08-04T12:14:00.000Z")), decideCreditBreaker(t, at("2026-08-04T12:15:00.000Z")), decideCreditBreaker({ ...t, probeAt: "2026-08-04T12:15:00.000Z" }, at("2026-08-04T12:20:00.000Z"))])
      .toEqual([{ active: false, probe: false }, { active: true, probe: false }, { active: false, probe: true }, { active: true, probe: false }]); });});
describe("a due probe is spent on the provider call itself, never on a guard in front of it", () => {
  const T = "tenant-fixture", ROW = { creditBreaker: null as unknown };
  const realBreaker = async () => { vi.resetModules();
    vi.doMock("@/lib/persistence/supabase", () => ({ isSupabaseConfigured: () => true, getSupabaseAdmin: () => ({
      rpc: async (name: string, args: { p_state: unknown }) => name === "set_credit_breaker_state"
        ? (ROW.creditBreaker = args.p_state, { data: true, error: null })
        : ({ data: null, error: { message: `unexpected RPC ${name}` } }),
      from: () => ({
        select: (fields: string) => ({ eq: () => ({ eq: async () => ({ data: fields === "tenant_id" ? [{ tenant_id: T }] : [{ metadata: ROW }], error: null }) }) }),
      }) }) }));
    process.env.VITEST = "false"; // the module short-circuits every ledger read under vitest, and this one test wants the durable path it protects
    return await import("@/domains/decision/llm/gateway"); };
  it("survives every guard unspent, is claimed by the one request that leaves the process, and makes no call at all while held", async () => {
    try {
      ROW.creditBreaker = { trippedAt: new Date(Date.parse("2026-08-04T12:00:00.000Z")).toISOString(), probeAt: null };
      const g = await realBreaker(), probe = () => (ROW.creditBreaker as { probeAt: string | null }).probeAt;
      expect([await g.creditBreakerHeld(T), await g.creditBreakerHeld("another-tenant-sharing-the-provider"), probe()]).toEqual([false, false, null]); const wire = fakeFetch(completedEnvelope(JSON.stringify({ title: "T", score: null }))); // A DUE PROBE READS AS NOT HELD to every tenant sharing the provider account, however many guards ask, and none of them stamps it.
      expect((await g.openAIStructuredResponse(baseArgs({ fetchImpl: wire.impl, costBreakerImpl: allowBreaker }))).kind).toBe("ok");
      expect([wire.capture.calls, ROW.creditBreaker]).toEqual([1, null]); // ONE real request received the probe, and the provider's answer cleared the stop outright
      ROW.creditBreaker = { trippedAt: new Date().toISOString(), probeAt: null }; // and inside the cooldown: zero network calls, whoever asks
      const cold = fakeFetch(completedEnvelope("{}"));
      expect([await g.creditBreakerHeld(T), (await g.openAIStructuredResponse(baseArgs({ fetchImpl: cold.impl, costBreakerImpl: allowBreaker }))).kind, cold.capture.calls]).toEqual([true, "blocked_credit", 0]);
    } finally { process.env.VITEST = "true"; vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules(); }});});
