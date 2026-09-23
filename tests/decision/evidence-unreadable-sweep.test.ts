import { describe, it, expect, vi, beforeEach } from "vitest";
type RpcAnswer = { data?: unknown; error?: { message: string; code?: string } | null };
const env = vi.hoisted(() => ({ rpc: {} as Record<string, RpcAnswer[]>, calls: [] as Array<{ name: string; args: unknown }>, snapshot: null as unknown, schemaBody: undefined as unknown,
  wrote: [] as string[], saved: new Map<string, ChangeProposal>(), store: new Map<string, unknown>(), withdrawn: [] as string[],
  aiWindow: [] as unknown[] | "fail", dispositions: new Map<string, Record<string, unknown>>(), upserts: 0 }));
const proposalReads = vi.hoisted(() => ({ current: true, terminal: true }));
vi.mock("@/lib/persistence/supabase", () => {
  const chain = (answer: RpcAnswer): unknown => new Proxy({} as Record<string, unknown>, { get: (_t, prop) => prop === "then"
    ? (res: (v: RpcAnswer) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null }).then(res, rej)
    : () => chain(answer) });
  const next = (name: string): RpcAnswer => { const queue = env.rpc[name]; if (!queue || queue.length === 0) return { data: [] }; return queue.length === 1 ? queue[0]! : queue.shift()!;};
  const upsertDispositions = (tenant: string, raw: unknown[]): number => { let landed = 0;
    for (const r of raw as Array<Record<string, unknown>>) {
      if (!r.caseKey || !r.reason) continue;
      const k = `${tenant}|${String(r.caseKey)}`, held = env.dispositions.get(k);
      if (held && String(r.decidedAt) < String(held.decided_at)) continue; // the stale-writer guard
      env.dispositions.set(k, { tenant_id: tenant, case_key: r.caseKey, state: r.state, query: r.query, page_url: r.pageUrl ?? null, stage: r.stage ?? null,
        proposal_id: r.proposalId ?? null, reason: r.reason, days: r.days ?? 0, engines: r.engines ?? 0, parents: r.parents ?? 0, executions: r.executions ?? 0,
        decided_at: r.decidedAt, diagnosis: r.diagnosis ?? held?.diagnosis ?? null }); // an unruled pass strips no banked reading
      landed += 1;}
    return landed;};
  return { isSupabaseConfigured: () => true, getSupabaseAdmin: () => ({
      rpc: (name: string, args: unknown) => { env.calls.push({ name, args });
        if (name === "upsert_ai_case_dispositions") { env.upserts += 1; const a = args as { p_tenant_id: string; p_rows: unknown[] };
          return chain({ data: upsertDispositions(a.p_tenant_id, a.p_rows) as unknown as unknown[] });}
        return chain(next(name));},
      from: (table: string) => table === "ai_case_dispositions" ? chain({ data: [...env.dispositions.values()] as unknown as unknown[] }) : chain({ data: [] }),}), }; });
vi.mock("@/domains/evidence/ai-visibility/ai-observations", async (orig) => { const actual = (await orig()) as typeof import("@/domains/evidence/ai-visibility/ai-observations");
  return { ...actual, readAiObservations: async () => { if (env.aiWindow === "fail") throw new Error("canceling statement due to statement timeout"); return env.aiWindow; } }; });
vi.mock("@/domains/decision/coverage-pass", async (orig) => { const actual = (await orig()) as typeof import("@/domains/decision/coverage-pass");
  return { ...actual, readCoverage: async () => null, recordCoverageNeeds: async () => undefined }; });
vi.mock("@/domains/evidence/ai-visibility/answer-journeys", async (orig) => { const actual = (await orig()) as typeof import("@/domains/evidence/ai-visibility/answer-journeys");
  return { ...actual, readAnswerJourneysBatch: async (_t: string, _s: string, selected: { promptId: string }[]) => ({ rows: new Map(selected.map((one) => [one.promptId, []])), failed: new Set() }) }; });
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => ({ id: "tenant-fx", domain: "fixture.example", growth_goal: null }), basisTag: () => "basis_fx",}));
vi.mock("@/domains/evidence/snapshot-loader", async (orig) => { const actual = (await orig()) as typeof import("@/domains/evidence/snapshot-loader");
  return { ...actual, loadEvidenceSnapshot: async (t: string, o: never) => env.snapshot ?? actual.loadEvidenceSnapshot(t, o) }; });
vi.mock("@/domains/evidence/pages/owned-context", async (orig) => { const actual = (await orig()) as typeof import("@/domains/evidence/pages/owned-context");
  return { ...actual, loadOwnedPageBodies: async (...args: Parameters<typeof actual.loadOwnedPageBodies>) => env.schemaBody === undefined ? actual.loadOwnedPageBodies(...args) : new Map(env.schemaBody ? [["fixture.example/a", env.schemaBody]] : []) }; });
vi.mock("@/domains/decision/proposal-store", async (orig) => { const actual = (await orig()) as typeof import("@/domains/decision/proposal-store");
  return { ...actual, loadChangeProposals: async () => { if (!proposalReads.current) throw new Error("current queue unavailable"); return new Map(env.store as Map<string, ChangeProposal>); },
    terminalWorkKeys: async () => { if (!proposalReads.terminal) throw new Error("terminal history unavailable"); return new Set<string>(); }, withdrawnProposalIds: async () => new Set<string>(),
    terminalProposalHistory: async () => { if (!proposalReads.terminal) throw new Error("terminal history unavailable"); return { fingerprints: new Set<string>(), legacyMutationKeys: new Set<string>() }; },
    withdrawChangeProposal: async (p: ChangeProposal) => { env.withdrawn.push(p.id); return "retired" as const; },
    publishCustomerRelease: async () => { env.wrote.push("publishCustomerRelease"); return true; },
    saveChangeProposal: async (p: ChangeProposal) => { env.wrote.push(`saveChangeProposal:${p.id}`); env.saved.set(p.id, p); if (env.schemaBody !== undefined) { env.store.set(p.id, p); return "saved" as const; } return "unchanged" as const; } }; });
vi.mock("@/domains/decision/ai-case-store", async (orig) => { const a = await orig() as { recordAiCaseDispositions: (...x: never[]) => Promise<unknown> }; // RECORDING, NEVER REPLACING: these two write elsewhere and the rest of this file depends on what they really do.
  return { ...a, recordAiCaseDispositions: async (...x: never[]) => { env.wrote.push("recordAiCaseDispositions"); return a.recordAiCaseDispositions(...x); } }; });
vi.mock("@/domains/decision/coverage-pass", async (orig) => { const a = await orig() as { recordCoverageNeeds: (...x: never[]) => Promise<unknown> };
  return { ...a, recordCoverageNeeds: async (...x: never[]) => { env.wrote.push("recordCoverageNeeds"); return a.recordCoverageNeeds(...x); } }; });
import { loadGscPageSignalsForTenant, readGscPageSignalsForTenant } from "@/domains/evidence/readers/gsc-page-signals";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import { buildEvidenceSnapshot, type EvidenceSnapshotInput } from "@/domains/evidence/snapshot";
import { emptyResearchEvidence } from "@/domains/evidence/funnel/research-evidence";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals";
import type { ChangeProposal } from "@/domains/decision/contracts";
const TENANT = "tenant-fx";
const TIMEOUT = { message: "canceling statement due to statement timeout", code: "57014" };
const fullPage = () => Array.from({ length: 1_000 }, (_v, i) => ({ page: `https://fixture.example/p${String(i).padStart(4, "0")}`, clicks: 5, impressions: 100, pos_weighted: 800, top_queries: [],}));
function snapshotWith(status: "failed" | "fresh" | "empty"): unknown {
  const gscPayload = status === "fresh" ? [{ url: "https://fixture.example/a", clicks90d: 40, impressions90d: 900, ctr90d: 0.04, position90d: 12, topQueries: [] }] : [];
  const empty = { status: "empty" as const, lastSyncedAt: null, payload: [] };
  return buildEvidenceSnapshot({ scope: { tenantId: TENANT, site: "fixture.example", builtAt: "2026-08-12T00:00:00.000Z" },
    gsc: { status, lastSyncedAt: null, payload: gscPayload }, ga4: empty, wix: empty, clarity: empty, dataforseo: empty,
    research: { status: "empty", lastSyncedAt: null, payload: emptyResearchEvidence() }, aiAnswersUnread: false } satisfies EvidenceSnapshotInput); }
const openCard = (suffix: string): ChangeProposal => ({
  id: `${TENANT}::/shiraz::existing_edit::${suffix}`, tenantId: TENANT, kind: "existing_edit", pagePath: "/shiraz", pageUrl: "https://fixture.example/shiraz", pageLabel: "Shiraz",
  primaryQuery: "things to do in shiraz", opportunityType: "Answer the question", changeFamily: suffix, status: "needs_review", researchOnly: true,
  evidence: { query: "things to do in shiraz", hints: [], evidenceRefCount: 1 }, recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "A short answer block." },
  whyItMatters: "The page never answers the question it ranks for.", estimatedEffortMinutes: 10, riskLevel: "low", confidence: "medium", limitations: [], impactScore: 20, upsidePerMonth: 5, publish: "manual", createdAt: "2026-08-10T00:00:00.000Z" });
beforeEach(() => { env.rpc = {}; env.calls = []; env.snapshot = null; env.schemaBody = undefined; env.store = new Map(); env.withdrawn = []; env.aiWindow = []; env.dispositions = new Map(); env.upserts = 0; proposalReads.current = true; proposalReads.terminal = true; });
describe("a search read that did not answer", () => {
  it.each(["current", "terminal"] as const)("spends zero when the %s proposal ledger cannot be read", async (which) => {
    env.snapshot = snapshotWith("fresh"); proposalReads[which] = false; const complete = vi.fn(async () => { throw new Error("no provider is allowed"); }); const out = await produceProposalsForTenant(TENANT, { complete, maxDrafts: 20 }); expect([out.outcome, out.paid.funded.length, out.paid.attemptUnitsSpent, complete.mock.calls.length, env.wrote.length]).toEqual(["evidence_unreadable", 0, 0, 0, 0]);
  });
  it("keeps a legacy schema-only card held even after the visible answer is read, because schema and page copy must ship together", async () => {
    const markup = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: { "@type": "Question", name: "When do seals rest?", acceptedAnswer: { "@type": "Answer", text: "Seals rest at low tide." } } });
    const p = { ...openCard("schema"), pagePath: "/a", pageUrl: "https://fixture.example/a", researchOnly: false, status: "ready" as const, whyItMatters: "Marking them up is how those answers become eligible to be shown directly and quoted as a source.", operatorSteps: ["Paste the copy below onto the page as a new answer paragraph."], recommendedChange: { kind: "existing_edit" as const, field: "schema" as const, before: null, after: markup } };
    const complete = vi.fn(async () => { throw new Error("no provider is allowed"); });
    env.snapshot = snapshotWith("fresh"); env.schemaBody = null; env.store = new Map([[p.id, p]]);
    const waiting = await produceProposalsForTenant(TENANT, { maxDrafts: 0, complete });
    const owed = env.store.get(p.id) as ChangeProposal;
    expect([owed.status, owed.obligation?.kind, waiting.paid.evidenceOwed?.find((need) => need.proposalId === p.id)?.reasonCode]).toEqual(["needs_review", "evidence", "schema_visible_pair_unconfirmed"]);
    env.schemaBody = { url: p.pageUrl, version: "current", contentHash: "current-hash", fetchedAt: "2026-09-13T00:00:00Z", title: "Seals", h1: "Seals", metaDescription: null, headings: [], passages: ["Seals rest at high tide."], vocabulary: "Seals rest at high tide.", faqs: [{ question: "When do seals rest?", answer: "Seals rest at high tide.", source: "html_details", answerComplete: true }] };
    await produceProposalsForTenant(TENANT, { maxDrafts: 0, complete });
    const landed = env.store.get(p.id) as ChangeProposal;
    expect([landed.status, landed.obligation?.kind, landed.obligation?.kind === "evidence" && landed.obligation.need.reasonCode,
      (landed.recommendedChange as { after: string }).after, complete.mock.calls.length])
      .toEqual(["needs_review", "evidence", "schema_visible_pair_unconfirmed", markup, 0]);
    expect(landed.operatorSteps?.some((step) => step.includes("updated too"))).toBe(true);
    const stable = JSON.stringify(landed); await produceProposalsForTenant(TENANT, { maxDrafts: 0, complete });
    expect([JSON.stringify(env.store.get(p.id)), complete.mock.calls.length]).toEqual([stable, 0]);
  });
  it("throws instead of handing back an account with no search data, and marks a read cut short after some rows INCOMPLETE while keeping what landed", async () => {
    env.rpc = { gsc_page_signals_v1: [{ error: TIMEOUT }] };
    await expect(loadGscPageSignalsForTenant(TENANT, new Date("2026-08-12T09:00:00Z"))).rejects.toThrow(/statement timeout/);
    env.rpc = { gsc_page_signals_v1: [{ data: fullPage() }, { error: TIMEOUT }], gsc_page_totals_v1: [{ data: [] }] };
    const read = await readGscPageSignalsForTenant(TENANT, new Date("2026-08-12T09:00:00Z")); expect([read.incomplete, read.signals.size]).toEqual([true, 1_000]); });
  it("asks the database ONE question per account per reporting day, however the caller spells now", async () => {
    env.rpc = { gsc_page_signals_v1: [{ data: [] }], gsc_page_totals_v1: [{ data: [] }] };
    await loadGscPageSignalsForTenant(TENANT, new Date("2026-08-12T09:00:00Z")); await loadGscPageSignalsForTenant(TENANT, new Date("2026-08-12T09:14:37.412Z"));
    const asked = env.calls.filter((c) => c.name === "gsc_page_signals_v1").map((c) => JSON.stringify(c.args));
    expect(new Set(asked).size).toBe(1); // one memo slot, not one per caller's clock
  });
  it("travels to the snapshot as a FAILED source, never as an empty one", async () => {
    env.rpc = { gsc_page_signals_v1: [{ data: fullPage() }, { error: TIMEOUT }], gsc_page_totals_v1: [{ data: [] }] };
    const snapshot = await loadEvidenceSnapshot(TENANT, { now: new Date("2026-08-12T09:00:00Z") }); expect(snapshot.sources.find((s) => s.source === "gsc")?.status).toBe("failed"); }); });
describe("the sweep only retires what a producer that FINISHED rewrote", () => {
  it("changes nothing at all when the search source failed, and nothing when it is merely EMPTY either: unread is not rewritten", async () => {
    env.snapshot = snapshotWith("failed");
    env.store = new Map([["a", openCard("answer_block")], ["t", openCard("title")]].map(([, p]) => [(p as ChangeProposal).id, p]));
    expect([(await produceProposalsForTenant(TENANT)).outcome, env.withdrawn]).toEqual(["evidence_unreadable", []]);
    env.snapshot = snapshotWith("empty"); env.store = new Map([[openCard("title").id, openCard("title")]]);
    await produceProposalsForTenant(TENANT); expect(env.withdrawn, "an account that genuinely holds nothing still loses no open card").toEqual([]); });
  it("withdraws a stale card in its own family once the producer that owns it finished, and never an AI card on a pass whose AI read failed", async () => {
    env.snapshot = snapshotWith("fresh");
    env.aiWindow = "fail"; // the 28-day AI read is down on this pass
    const stale = openCard("title"), theirs = openCard("ai_answer_gap");
    env.store = new Map([[stale.id, stale], [theirs.id, theirs]]);
    await produceProposalsForTenant(TENANT);
    expect(env.withdrawn).toEqual([stale.id]); }); // The AI family enters the sweep ONLY through a finished extras pass whose verdicts were durably filed (pinned below), so a failed AI read leaves the AI card standing while finished families still sweep.
  it("stamps each owed reading with its own row's ranked position, so the biggest need is buyable first whatever order the store listed it in", async () => {
    env.snapshot = snapshotWith("fresh");
    const owing = (slug: string, impact: number): ChangeProposal => ({ ...openCard("meta"), id: `${TENANT}::/${slug}::existing_edit::meta`, pagePath: `/${slug}`, pageUrl: `https://fixture.example/${slug}`, researchOnly: false, changeFamily: "meta", impactScore: impact, impactAttribution: { page: `https://fixture.example/${slug}`, query: "things to do in shiraz", members: ["things to do in shiraz"], clicks28d: impact, impressions90d: 10000, sourceDay: new Date().toISOString().slice(0, 10) }, winnersOnFile: "none", obligation: { kind: "terminal", reason: "no substantive gap named" }, // the reading a row owes because nobody has read this search's winners, which is the live evidence debt the ladder still mints now that the shape hold is an advisory
      recommendedChange: { kind: "existing_edit", field: "meta", before: "The old description.", after: `A finished description for ${slug} that says what only this page answers.` } });
    const small = owing("aaa-worth-little", 2), big = owing("zzz-worth-most", 900); // the store lists the small one first; the ranker, never the walk, decides which reading is bought first
    env.store = new Map([[small.id, small], [big.id, big]]);
    const owed = (await produceProposalsForTenant(TENANT)).paid.evidenceOwed ?? [];
    const at = (slug: string) => owed.find((o) => o.key.includes(slug))!;
    expect([owed.length >= 2, at("zzz-worth-most").kind, at("aaa-worth-little").kind], "both rows owe the same typed reading and both are on the list").toEqual([true, "serp", "serp"]);
    expect([at("zzz-worth-most").rank! >= 1, at("zzz-worth-most").rank! < at("aaa-worth-little").rank!], "and the one worth 900 clicks is stamped above the one worth 2, whatever order the ids came back in").toEqual([true, true]); });
  it.each(["tenant-one", "tenant-two"])("names on every owed reading the row the money is for and the rung it unlocks, and the store keeps both through a write [%s]", async (tenant) => {
    env.snapshot = snapshotWith("fresh");
    const written: ChangeProposal = { ...openCard("meta"), id: `${tenant}::/zzz-written::existing_edit::meta`, tenantId: tenant, pagePath: "/zzz-written", pageUrl: "https://fixture.example/zzz-written", researchOnly: false, changeFamily: "meta", winnersOnFile: "none", obligation: { kind: "terminal", reason: "no substantive gap named" },
      recommendedChange: { kind: "existing_edit", field: "meta", before: "The old description.", after: "A finished description for this page that says what only this page answers." } };
    const faulted: ChangeProposal = { ...written, id: `${tenant}::/aaa-faulted::existing_edit::meta`, pagePath: "/aaa-faulted", pageUrl: "https://fixture.example/aaa-faulted", faults: ["it repeats the search instead of naming what the page answers"] };
    env.store = new Map([[written.id, written], [faulted.id, faulted]]);
    const owed = (await produceProposalsForTenant(tenant)).paid.evidenceOwed ?? [];
    const at = (slug: string) => owed.find((o) => o.key.includes(slug));
    expect([at("zzz-written")?.unlocks?.proposalId, at("zzz-written")?.unlocks?.step], "a row whose words no gate has faulted owes a reading of those words once the reading it is blocked on lands").toEqual([written.id, "review"]);
    expect([at("aaa-faulted")?.unlocks?.proposalId, at("aaa-faulted")?.unlocks?.step], "and a row whose words a gate has already faulted owes the corrective draft instead").toEqual([faulted.id, "redraft"]);
    const { serializeChangeProposal, deserializeChangeProposal } = await import("@/domains/decision/contracts");
    const carried: ChangeProposal = { ...written, obligation: { kind: "evidence", need: { kind: "factual_source", query: "things to do in shiraz", reasonCode: "acquire_factual_source", proposalId: written.id, unlocks: { proposalId: written.id, step: "draft" } } } as ChangeProposal["obligation"] };
    const back = deserializeChangeProposal(serializeChangeProposal(carried));
    const need = (back?.obligation as { need?: { proposalId?: string; unlocks?: { proposalId: string; step: string } } } | undefined)?.need;
    expect([need?.proposalId, need?.unlocks], "and the store keeps both through a write: a zod object strips what it does not declare, and this one declares them").toEqual([written.id, { proposalId: written.id, step: "draft" }]); });
  it("writes nothing at all when it is told not to persist", async () => {
    env.snapshot = snapshotWith("fresh"); env.aiWindow = "fail"; const stale = openCard("title"), theirs = openCard("ai_answer_gap"); env.store = new Map([[stale.id, stale], [theirs.id, theirs]]); env.wrote = []; env.withdrawn = [];
    await produceProposalsForTenant(TENANT, { persist: false }); expect({ wrote: env.wrote, withdrawn: env.withdrawn }).toEqual({ wrote: [], withdrawn: [] }); }); // The pass directly above this one, identical but for the flag, withdraws `stale`. This one must do nothing at all.
  it("hands back exactly the payload persistence would keep", async () => {
    const shape = (p: ChangeProposal) => ({ id: p.id, rc: p.recommendedChange, steps: p.operatorSteps, claims: p.claims, support: (p.supportFacts ?? []).map((f) => f.id),
      workKey: p.workKey, status: p.status, pieces: (p.bundle?.components ?? []).map((c) => [c.kind, c.page, c.where, c.after]) });
    env.snapshot = snapshotWith("fresh"); env.aiWindow = "fail";
    const stale = openCard("title"); env.store = new Map([[stale.id, stale]]);
    const dry = await produceProposalsForTenant(TENANT, { persist: false });
    env.store = new Map([[stale.id, stale]]); env.saved = new Map();
    const wet = await produceProposalsForTenant(TENANT);
    expect(dry.proposals.length).toBe(wet.proposals.length);
    expect(dry.proposals.map(shape)).toEqual(dry.proposals.map((p) => shape(env.saved.get(p.id) ?? p))); }); });
describe("a zero-spend regeneration is non-destructive", () => {
  it("leaves the operator's open cards exactly where they were, and still publishes", async () => {
    env.snapshot = snapshotWith("fresh");
    const drafted = openCard("title"), theirs = openCard("ai_answer_gap");
    env.store = new Map([[drafted.id, drafted], [theirs.id, theirs]]);
    const out = await produceProposalsForTenant(TENANT, { zeroSpend: true });
    expect(out.outcome).not.toBe("persistence_failed"); // a pass that bought nothing is not a failed pass
    expect(env.withdrawn).not.toContain(theirs.id);}); // The paid drafter never ran, so the family it owns is not one anybody rewrote in full this pass.
  it("mints both paid pools empty, so no page reading and no drafting attempt is available to spend", async () => {
    env.snapshot = snapshotWith("fresh");
    env.store = new Map();
    const out = await produceProposalsForTenant(TENANT, { zeroSpend: true, maxDrafts: 5 });
    expect(out.proposals.every((p) => p.researchOnly === true || p.status !== "ready")).toBe(true);});}); // maxDrafts is the caller's ask and the pause outranks it: nothing here was drafted for money.
describe("a failed 28-day AI read files nothing, and only a seeing pass reopens the sweep", () => {
  const wixPage = (path: string, title: string, outline: string[]) => ({
    url: `https://fixture.example${path}`, title, metaDescription: "Plan the visit with what locals actually do.", h1: title, h2: [], outline,
    schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 900, internalLinks: [], fetchedAt: "2026-08-10T00:00:00.000Z" });
  const storedAnswer = (promptId: string, promptText: string, citations: Array<{ url: string; domain: string; title: string }> | null) => ({
    promptId, promptVersion: 1, promptText, engine: "chatgpt", observationMode: "consumer_search" as const,
    modelRequested: null, modelServed: null, answerHash: "h", webSearchReported: true, fanOutQueries: null, citations, retrievedResults: null,
    brandMentions: null, analysis: null, observationId: `obs_${promptId}`, reportingDay: "2026-08-19", observedAt: "2026-08-19T00:00:00.000Z", citationsObserved: citations != null });
  const aiSnapshot = () => {
    const src = <T,>(payload: T) => ({ status: "fresh" as const, lastSyncedAt: null, payload });
    return buildEvidenceSnapshot({
      scope: { tenantId: TENANT, site: "fixture.example", builtAt: "2026-08-20T00:00:00.000Z" },
      gsc: src([]), ga4: src([]), clarity: src([]), dataforseo: src([]),
      wix: src([wixPage("/shiraz", "Things to do in Shiraz", ["Things to do in Shiraz", "Day trips from Shiraz"]), wixPage("/rugs", "Persian rug buying guide", ["Knot density", "Dyes and wool"]),
        wixPage("/food", "Persian food classics", ["Kabob", "Stews"]), wixPage("/music", "Persian music instruments", ["Tar", "Setar"])]),
      research: src({ ...emptyResearchEvidence(), aiObservations: [
        storedAnswer("pA", "things to do in shiraz", [{ url: "https://rival.example/shiraz", domain: "rival.example", title: "Shiraz guide" }]),
        storedAnswer("pB", "best time to visit shiraz", null),
        storedAnswer("pC", "shiraz day trips", [{ url: "https://rival.example/trips", domain: "rival.example", title: "Shiraz day trips" }])] }), aiAnswersUnread: false });};
  const coldExtras = async () => { vi.resetModules(); return import("@/domains/decision/producers/extra"); };
  const runExtras = async (snapshot: unknown) => (await coldExtras()).extraQueueCards({ tenantId: TENANT, snapshot: snapshot as never, now: new Date("2026-08-20T09:00:00Z"), reads: { left: 0 } });
  it("routes a complete seven-word page to source proof while partial or stale capture still owes a read", async () => {
    const src = <T,>(payload: T) => ({ status: "fresh" as const, lastSyncedAt: null, payload }), page = { ...wixPage("/a", "Joojeh Kabob", ["Joojeh Kabob", "Ingredients", "Method"]), h2: ["Ingredients", "Method"], wordCount: 7, metaDescription: null }, snapshot = buildEvidenceSnapshot({ scope: { tenantId: TENANT, site: "fixture.example", builtAt: "2026-08-20T00:00:00.000Z" }, gsc: src([{ url: page.url, clicks90d: 5, impressions90d: 500, ctr90d: .01, position90d: 12, topQueries: [{ query: "joojeh kabob recipe", impressions: 300, clicks: 3, position: 12 }] }]), wix: src([page]), ga4: src([]), clarity: src([]), dataforseo: src([]), research: src(emptyResearchEvidence()), aiAnswersUnread: false });
    const body = { url: page.url, title: page.title, h1: page.h1, metaDescription: null, headings: page.outline, passages: ["Joojeh Kabob", "Ingredients", "Method"], answerPassages: [], vocabulary: "Joojeh Kabob Ingredients Method", openingSample: null, cardTexts: [], faqs: [], entityNames: [], internalLinks: [], fetchedAt: "2026-08-20T00:00:00.000Z", contentHash: "thin-complete", version: "current", completeness: "complete", sourceCapture: { version: 1, complete: true, mainHtml: "<main><h1>Joojeh Kabob</h1><h2>Ingredients</h2><h2>Method</h2></main>", jsonLd: [] } }; env.schemaBody = body;
    const whole = await runExtras(snapshot); expect(whole.cards.some((p) => p.id.endsWith("::thin_page"))).toBe(false); expect(whole.cards.find((p) => p.id.includes("missing_answer"))?.obligation).toEqual({ kind: "evidence", need: expect.objectContaining({ kind: "serp", reasonCode: "thin_page_answer_unconfirmed" }) }); const { demandOf } = await import("@/domains/decision/drafted-copy"), { substantiveGapOf } = await import("@/domains/decision/diagnosis"), demand = demandOf(snapshot.ownedPages[0]!, body as never, [], null, TENANT, snapshot); expect(substantiveGapOf({}, { ...demand, facts: [{ id: "fact-1", fact: "Joojeh Kabob is Iranian food." }] })?.owed?.kind).toBe("evidence"); expect(substantiveGapOf({}, { ...demand, facts: [{ id: "fact-1", fact: "A Joojeh Kabob recipe uses chicken and saffron." }] })?.owed).toBeUndefined();
    for (const changed of [{ ...body, completeness: "partial" }, { ...body, fetchedAt: "2026-07-01T00:00:00Z" }]) { env.schemaBody = changed; const read = await runExtras(snapshot); expect(read.cards.find((p) => p.id.endsWith("::thin_page"))?.obligation).toEqual({ kind: "evidence", need: expect.objectContaining({ kind: "page_source" }) }); expect(read.cards.some((p) => p.id.includes("missing_answer") && p.obligation?.kind === "draft")).toBe(false); }
  });
  it("holds the AI families out of the sweep and files no verdict when the window read fails, while its finished families still answer", async () => {
    env.aiWindow = "fail";
    const run = await runExtras(aiSnapshot()); expect(run.families).not.toContain("ai_answer_gap");
    expect(run.families).not.toContain("engine_followup");
    expect(run.families).toContain("missing_description"); // the pass genuinely ran its $0 work
    expect([env.upserts, env.dispositions.size]).toEqual([0, 0]); // a blind pass writes no verdict
  });
  it("files durably on a seeing pass, stands its families back up, and both surfaces render the filed row", async () => {
    env.aiWindow = "fail"; // cold instance one goes blind and files nothing; instance two sees the window
    await runExtras(aiSnapshot());
    env.aiWindow = [];
    const run = await runExtras(aiSnapshot()); expect(run.families).toEqual(expect.arrayContaining(["ai_answer_gap", "engine_followup"]));
    expect(env.upserts).toBeGreaterThan(0); const unreported = env.dispositions.get(`${TENANT}|prompt:pB`);
    expect(unreported?.state).toBe("unreported");
    const { readAiCaseDispositions, dispositionOf } = await import("@/domains/decision/ai-case-store"); const file = await readAiCaseDispositions(TENANT); // BOTH SURFACES print the same sentence from the same row, read back through the store.
    expect(file.state).toBe("read"); const onVisibility = dispositionOf({ caseKey: "prompt:pB", state: "actionable", reason: "the evidence-only view" }, file);
    const onChanges = file.state === "read" ? file.rows.find((d) => d.caseKey === "prompt:pB")?.reason ?? null : null; expect(onVisibility.state).toBe("unreported");
    expect(onVisibility.href).toBeNull(); expect(onChanges).toBe(onVisibility.line);});
  it("judges and files the AI cases on a QUIET day, through the whole produce pass", async () => {
    env.snapshot = aiSnapshot();
    env.aiWindow = [];
    const out = await produceProposalsForTenant(TENANT, { zeroSpend: true }); expect(out.outcome).not.toBe("persistence_failed");
    expect(env.upserts).toBeGreaterThan(0); // the quiet pass filed
    expect(env.dispositions.get(`${TENANT}|prompt:pB`)?.state).toBe("unreported"); });
  /** An undiagnosed observation belongs in Visibility's filed explanation, not in Changes. */
  it("keeps undiagnosed tracked and fan-out observations out of the actionable Changes queue", async () => {
    env.aiWindow = []; vi.resetModules();
    vi.doMock("@/domains/decision/producers/page-job", async (orig) => { const real = await orig() as Record<string, unknown>;
      return { ...real, pageUnderstanding: async () => ({ of: async () => ({ job: { subjects: ["shiraz"], answers: [] }, reason: "read" }),
        corpus: new Map(), hold: () => {}, held: [] }), sectionFit: () => "fits" }; });
    const m = await import("@/domains/decision/producers/extra");
    const run = await m.extraQueueCards({ tenantId: TENANT, snapshot: aiSnapshot() as never, now: new Date("2026-08-20T09:00:00Z"), reads: { left: 0 } });
    const aeo = run.cards.filter((c) => c.id.endsWith("::ai_answer_gap"));
    expect(aeo).toEqual([]);
    expect(run.families).toEqual(expect.arrayContaining(["ai_answer_gap", "engine_followup"]));
    expect(run.aeoSpend, "an unfunded pass bought nothing").toMatchObject({ funded: 0, attempted: 0 });
    vi.doUnmock("@/domains/decision/producers/page-job"); });
  it("an unfunded pass funds nothing, attempts nothing, and names no treatment", async () => {
    env.aiWindow = [];
    const run = await runExtras(aiSnapshot()); // reads {left: 0} and no aeoDiagnoses: an empty purse and an unread page
    expect(run.aeoSpend, "an unfunded pass funds and attempts nothing").toMatchObject({ funded: 0, attempted: 0, givenBack: 0 });
    expect([run.cards.filter((c) => c.treatment === "technical_reachability" || c.treatment === "consolidate_or_differentiate"), run.families.includes("ai_answer_gap")], "no treatment from a stage fact alone, and the family still answers for its own record").toEqual([[], true]); });
  it("a banked diagnosis survives a pass that did not rule, exactly as the migration's coalesce writes it", async () => {
    const { DIAGNOSIS_CONTRACT, recordAiCaseDispositions, readAiCaseDispositions } = await import("@/domains/decision/ai-case-store");
    const dx = { kind: "already_answered", treatment: null, explanation: "e", ownedIds: ["own-1"], evidenceIds: [], packet: "pk", contentHash: "h", completeness: "complete", observationIds: ["o1"], version: DIAGNOSIS_CONTRACT, decidedAt: "2026-08-20T08:00:00.000Z" } as never;
    const row = { caseKey: "prompt:pDx", state: "monitoring" as const, query: "q", reason: "r", days: 1, engines: 1, parents: 1, executions: 1 };
    await recordAiCaseDispositions(TENANT, [{ ...row, decidedAt: "2026-08-20T08:00:00.000Z", diagnosis: dx }]);
    await recordAiCaseDispositions(TENANT, [{ ...row, decidedAt: "2026-08-20T09:00:00.000Z" }]); // newer, unruled
    const file = await readAiCaseDispositions(TENANT);
    const kept = file.state === "read" ? file.rows.find((d) => d.caseKey === "prompt:pDx") : null;
    expect([kept?.decidedAt?.slice(11, 13), kept?.diagnosis?.kind], "the newer pass lands and the reading survives it").toEqual(["09", "already_answered"]); });
  it("denies a stale concurrent pass the sweep: its rows lose, it claims no family, the newer verdicts stand", async () => {
    env.aiWindow = [];
    await runExtras(aiSnapshot()); // the NEWER pass files (decidedAt = 2026-08-20T09:00Z)
    const standing = new Map(env.dispositions); const m = await coldExtras();
    const stale = await m.extraQueueCards({ tenantId: TENANT, snapshot: aiSnapshot() as never, now: new Date("2026-08-19T09:00:00Z"), reads: { left: 0 } });
    expect(stale.families).not.toContain("ai_answer_gap"); // no license to sweep
    expect(stale.families).not.toContain("engine_followup");
    expect([...env.dispositions.entries()]).toEqual([...standing.entries()]); // the newer verdicts stand untouched
  });
  it("files a search a tracked question already asks as covered, a decision with the covering thing named, never silence", async () => {
    const windowRow = (id: string, promptId: string, promptText: string, fanOuts: string[] | null) => ({ // A search a tracked question already asks files as covered, never as silence. (A fan-out echoing its OWN prompt never becomes a row: the projection drops the echo at the door.)
      id, prompt_id: promptId, prompt_version: 1, prompt_text: promptText, cache_key: null, engine: "chatgpt",
      model_requested: null, model_served: null, observation_mode: "consumer_search", reporting_day: "2026-08-19",
      completed_at: "2026-08-19T00:00:00.000Z", answer_hash: "h", analysis: null, analysis_hash: null, site: "fixture.example",
      journey: { cited_sources: [{ url: "https://rival.example/shiraz", domain: "rival.example", title: "Shiraz guide" }],
        fan_outs: fanOuts, retrieved_results: null, brand_mentions: null, web_search_reported: true } });
    env.aiWindow = [windowRow("row1", "pA", "things to do in shiraz", ["best time to visit shiraz"]),
      windowRow("row2", "pB", "best time to visit shiraz", null)];
    await runExtras(aiSnapshot()); const { canonicalQueryKey } = await import("@/domains/evidence/relevance-gate");
    const filedRow = env.dispositions.get(`${TENANT}|fanout:${canonicalQueryKey("best time to visit shiraz")}`); expect(filedRow?.state).toBe("covered");
    expect(String(filedRow?.reason)).toContain("already tracks");});});
