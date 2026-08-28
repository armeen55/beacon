/** THE NIGHT THE SEARCH READ TIMED OUT. One statement timeout on the 90-day page-signal aggregate was served to every surface as an account with no search data at all: every page then judged clean, every $0 producer emitted nothing, and the sweep behind them read that silence as "the generator no longer stands behind these cards" and withdrew the operator's open queue mid-edit. Withdrawal is permanent in practice, so the cards were gone. Each test below pins one link of that chain. Fixture level: no live replay. */
import { describe, it, expect, vi, beforeEach } from "vitest";
type RpcAnswer = { data?: unknown; error?: { message: string; code?: string } | null };
const env = vi.hoisted(() => ({
  /** Queued answers per RPC name; the last one repeats. */
  rpc: {} as Record<string, RpcAnswer[]>,
  calls: [] as Array<{ name: string; args: unknown }>,
  snapshot: null as unknown,
  /** EVERY DURABLE WRITE THE PRODUCE PATH CAN MAKE, named as it happens, so a dry run can be asked to have made none. */
  wrote: [] as string[],
  /** THE LAST ROW THE STORE WAS HANDED FOR EACH ID: what persistence actually keeps. */
  saved: new Map<string, ChangeProposal>(),
  store: new Map<string, unknown>(),
  withdrawn: [] as string[],
  /** The 28-day AI window as the producer's read sees it: rows, or the read failing outright. */
  aiWindow: [] as unknown[] | "fail",
  /** The durable disposition table, shared across simulated cold instances. */
  dispositions: new Map<string, Record<string, unknown>>(),
  upserts: 0,}));
/** A Supabase admin whose every builder method chains; the disposition writer implements its migration's documented semantics, so the durability tests exercise the contract. */
vi.mock("@/lib/persistence/supabase", () => {
  const chain = (answer: RpcAnswer): unknown =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (prop === "then") return (res: (v: RpcAnswer) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null }).then(res, rej);
        return () => chain(answer);
      }, });
  const next = (name: string): RpcAnswer => {
    const queue = env.rpc[name];
    if (!queue || queue.length === 0) return { data: [] };
    return queue.length === 1 ? queue[0]! : queue.shift()!;};
  const upsertDispositions = (tenant: string, raw: unknown[]): number => {
    let landed = 0;
    for (const r of raw as Array<Record<string, unknown>>) {
      if (!r.caseKey || !r.reason) continue;
      const k = `${tenant}|${String(r.caseKey)}`, held = env.dispositions.get(k);
      if (held && String(r.decidedAt) < String(held.decided_at)) continue; // the stale-writer guard
      env.dispositions.set(k, { tenant_id: tenant, case_key: r.caseKey, state: r.state, query: r.query,
        page_url: r.pageUrl ?? null, stage: r.stage ?? null, proposal_id: r.proposalId ?? null, reason: r.reason,
        days: r.days ?? 0, engines: r.engines ?? 0, parents: r.parents ?? 0, executions: r.executions ?? 0,
        decided_at: r.decidedAt, diagnosis: r.diagnosis ?? held?.diagnosis ?? null }); // the migration's coalesce: an unruled pass strips no banked reading
      landed += 1;}
    return landed;};
  return {
    isSupabaseConfigured: () => true,
    getSupabaseAdmin: () => ({
      rpc: (name: string, args: unknown) => {
        env.calls.push({ name, args });
        if (name === "upsert_ai_case_dispositions") {
          env.upserts += 1;
          const a = args as { p_tenant_id: string; p_rows: unknown[] };
          return chain({ data: upsertDispositions(a.p_tenant_id, a.p_rows) as unknown as unknown[] });}
        return chain(next(name));},
      from: (table: string) => table === "ai_case_dispositions"
        ? chain({ data: [...env.dispositions.values()] as unknown as unknown[] })
        : chain({ data: [] }),}),
  }; });
/** The producer's own window read, failable on demand. */
vi.mock("@/domains/evidence/ai-visibility/ai-observations", async (orig) => {
  const actual = (await orig()) as typeof import("@/domains/evidence/ai-visibility/ai-observations");
  return { ...actual, readAiObservations: async () => {
    if (env.aiWindow === "fail") throw new Error("canceling statement due to statement timeout");
    return env.aiWindow;
  } }; });
vi.mock("@/domains/decision/coverage-pass", async (orig) => {
  const actual = (await orig()) as typeof import("@/domains/decision/coverage-pass");
  return { ...actual, readCoverage: async () => null, recordCoverageNeeds: async () => undefined }; });
vi.mock("@/domains/evidence/ai-visibility/answer-journeys", async (orig) => {
  const actual = (await orig()) as typeof import("@/domains/evidence/ai-visibility/answer-journeys");
  return { ...actual, readAnswerJourneys: async () => [] }; });
vi.mock("@/domains/account", () => ({
  loadBusinessProfile: async () => null,
  getTenant: async () => ({ id: "tenant-fx", domain: "fixture.example", growth_goal: null }),
  basisTag: () => "basis_fx",}));
/** The real loader unless a test pins a snapshot: part of this file exercises it, part feeds the producer. */
vi.mock("@/domains/evidence/snapshot-loader", async (orig) => {
  const actual = (await orig()) as typeof import("@/domains/evidence/snapshot-loader");
  return { ...actual, loadEvidenceSnapshot: async (t: string, o: never) =>
    env.snapshot ?? actual.loadEvidenceSnapshot(t, o) }; });
vi.mock("@/domains/decision/proposal-store", async (orig) => {
  const actual = (await orig()) as typeof import("@/domains/decision/proposal-store");
  return { ...actual,
    loadChangeProposals: async () => new Map(env.store as Map<string, ChangeProposal>),
    withdrawnProposalIds: async () => new Set<string>(),
    withdrawChangeProposal: async (p: ChangeProposal) => { env.withdrawn.push(p.id); return true; },
    publishCustomerRelease: async () => { env.wrote.push("publishCustomerRelease"); return true; },
    saveChangeProposal: async (p: ChangeProposal) => { env.wrote.push(`saveChangeProposal:${p.id}`); env.saved.set(p.id, p); return "unchanged" as const; } }; });
// RECORDING, NEVER REPLACING: these two write elsewhere and the rest of this file depends on what they really do.
vi.mock("@/domains/decision/ai-case-store", async (orig) => { const a = await orig() as { recordAiCaseDispositions: (...x: never[]) => Promise<unknown> };
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
/** One full PostgREST page, so the reader asks for a second one and meets the error on it. */
const fullPage = () => Array.from({ length: 1_000 }, (_v, i) => ({
  page: `https://fixture.example/p${String(i).padStart(4, "0")}`,
  clicks: 5, impressions: 100, pos_weighted: 800, top_queries: [],}));
/** A snapshot whose GSC leg says exactly what the test needs it to say. */
function snapshotWith(status: "failed" | "fresh" | "empty"): unknown {
  const gscPayload = status === "fresh"
    ? [{ url: "https://fixture.example/a", clicks90d: 40, impressions90d: 900, ctr90d: 0.04, position90d: 12, topQueries: [] }]
    : [];
  const input: EvidenceSnapshotInput = {
    scope: { tenantId: TENANT, site: "fixture.example", builtAt: "2026-08-12T00:00:00.000Z" },
    gsc: { status, lastSyncedAt: null, payload: gscPayload },
    ga4: { status: "empty", lastSyncedAt: null, payload: [] },
    wix: { status: "empty", lastSyncedAt: null, payload: [] },
    clarity: { status: "empty", lastSyncedAt: null, payload: [] },
    dataforseo: { status: "empty", lastSyncedAt: null, payload: [] },
    research: { status: "empty", lastSyncedAt: null, payload: emptyResearchEvidence() },
    aiAnswersUnread: false,};
  return buildEvidenceSnapshot(input);}
/** One untouched card the operator can still act on, in a family the sweep rewrites. */
const openCard = (suffix: string): ChangeProposal => ({
  id: `${TENANT}::/shiraz::existing_edit::${suffix}`, tenantId: TENANT, kind: "existing_edit",
  pagePath: "/shiraz", pageUrl: "https://fixture.example/shiraz", pageLabel: "Shiraz",
  primaryQuery: "things to do in shiraz", opportunityType: "Answer the question", changeFamily: suffix,
  status: "needs_review", evidence: { query: "things to do in shiraz", hints: [], evidenceRefCount: 1 },
  recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "A short answer block." },
  whyItMatters: "The page never answers the question it ranks for.", estimatedEffortMinutes: 10,
  riskLevel: "low", confidence: "medium", limitations: [], impactScore: 20, upsidePerMonth: 5,
  publish: "manual", createdAt: "2026-08-10T00:00:00.000Z", });
beforeEach(() => {
  env.rpc = {}; env.calls = []; env.snapshot = null; env.store = new Map(); env.withdrawn = [];
  env.aiWindow = []; env.dispositions = new Map(); env.upserts = 0; });
describe("a search read that did not answer", () => {
  it("throws instead of handing back an account with no search data", async () => {
    env.rpc = { gsc_page_signals_v1: [{ error: TIMEOUT }] };
    await expect(loadGscPageSignalsForTenant(TENANT, new Date("2026-08-12T09:00:00Z"))).rejects.toThrow(/statement timeout/); });
  it("marks a read cut short after some rows INCOMPLETE, keeping what landed", async () => {
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
  it("changes nothing at all when the search source failed, so open cards survive", async () => {
    env.snapshot = snapshotWith("failed");
    env.store = new Map([["a", openCard("answer_block")], ["t", openCard("title")]].map(([, p]) => [(p as ChangeProposal).id, p]));
    const out = await produceProposalsForTenant(TENANT); expect(out.outcome).toBe("evidence_unreadable");
    expect(env.withdrawn).toEqual([]); });
  it("withdraws nothing when the search source is merely EMPTY: unread is not rewritten", async () => {
    env.snapshot = snapshotWith("empty");
    env.store = new Map([[openCard("title").id, openCard("title")]]);
    await produceProposalsForTenant(TENANT); expect(env.withdrawn).toEqual([]); });
  it("withdraws a stale card in its own family once the producer that owns it finished, and never an AI card on a pass whose AI read failed", async () => {
    env.snapshot = snapshotWith("fresh");
    env.aiWindow = "fail"; // the 28-day AI read is down on this pass
    const stale = openCard("title"), theirs = openCard("ai_answer_gap");
    env.store = new Map([[stale.id, stale], [theirs.id, theirs]]);
    await produceProposalsForTenant(TENANT);
    // The AI family enters the sweep ONLY through a finished extras pass whose verdicts were durably filed (pinned below), so a failed AI read leaves the AI card standing while finished families still sweep.
    expect(env.withdrawn).toEqual([stale.id]); });
  /** A DRY RUN WRITES NOTHING, AND IT IS THE PRODUCER THAT SAYS SO, not a reading of the code. A no-persist run was reported alongside 13 changed rows and nobody could tell whether the guard leaked or the harness had never run dry; the same pass answers both ways here, so the next such report is settled by running this. `withdrawn` is listed separately because it is the same act by another name. */
  it("writes nothing at all when it is told not to persist", async () => {
    env.snapshot = snapshotWith("fresh"); env.aiWindow = "fail";
    const stale = openCard("title"), theirs = openCard("ai_answer_gap");
    env.store = new Map([[stale.id, stale], [theirs.id, theirs]]);
    env.wrote = []; env.withdrawn = [];
    await produceProposalsForTenant(TENANT, { persist: false });
    // The pass directly above this one, identical but for the flag, withdraws `stale`. This one must do nothing at all.
    expect({ wrote: env.wrote, withdrawn: env.withdrawn }).toEqual({ wrote: [], withdrawn: [] }); });
  /** AND WHAT A DRY RUN HANDS BACK IS WHAT PERSISTENCE WOULD KEEP. The guard used to sit at the TOP of persistIfChanged, so a dry run returned the row BEFORE nine transforms (identity stamp, banked-copy preservation, soft downgrade, ranking inheritance) and the copy an operator inspected was not the copy that later landed. Inspecting one object and storing another is the whole defect. */
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
/** A PASS THAT DID NOT BUY MUST NOT TAKE BACK WHAT A PAID PASS BANKED (operator, 2026-08-19). Pausing research now rebuilds the customer surface from stored evidence alone, which is right: a paused account still owes its customer a current list. What it may never do is read its own empty hands as the generator withdrawing its work. "Did not run" is not "rejected its previous work". */
describe("a zero-spend regeneration is non-destructive", () => {
  it("leaves the operator's open cards exactly where they were, and still publishes", async () => {
    env.snapshot = snapshotWith("fresh");
    const drafted = openCard("title"), theirs = openCard("ai_answer_gap");
    env.store = new Map([[drafted.id, drafted], [theirs.id, theirs]]);
    const out = await produceProposalsForTenant(TENANT, { zeroSpend: true });
    expect(out.outcome).not.toBe("persistence_failed"); // a pass that bought nothing is not a failed pass
    // The paid drafter never ran, so the family it owns is not one anybody rewrote in full this pass.
    expect(env.withdrawn).not.toContain(theirs.id);});
  it("mints both paid pools empty, so no page reading and no drafting attempt is available to spend", async () => {
    env.snapshot = snapshotWith("fresh");
    env.store = new Map();
    const out = await produceProposalsForTenant(TENANT, { zeroSpend: true, maxDrafts: 5 });
    // maxDrafts is the caller's ask and the pause outranks it: nothing here was drafted for money.
    expect(out.proposals.every((p) => p.researchOnly === true || p.status !== "ready")).toBe(true);});});
/** THE REAL COUNTEREXAMPLE, through the REAL AI producer, twice, as two cold instances sharing one durable table: the blind instance files nothing and holds its families; the seeing one files durably; and what it filed is what BOTH surfaces render, from the same row. */
describe("a failed 28-day AI read files nothing, and only a seeing pass reopens the sweep", () => {
  const wixPage = (path: string, title: string, outline: string[]) => ({
    url: `https://fixture.example${path}`, title, metaDescription: "Plan the visit with what locals actually do.",
    h1: title, h2: [], outline, schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 900,
    internalLinks: [], fetchedAt: "2026-08-10T00:00:00.000Z" });
  const storedAnswer = (promptId: string, promptText: string, citations: Array<{ url: string; domain: string; title: string }> | null) => ({
    promptId, promptVersion: 1, promptText, engine: "chatgpt", observationMode: "consumer_search" as const,
    modelRequested: null, modelServed: null, answerHash: "h", webSearchReported: true, fanOutQueries: null,
    citations, retrievedResults: null, brandMentions: null, analysis: null,
    observationId: `obs_${promptId}`, reportingDay: "2026-08-19", observedAt: "2026-08-19T00:00:00.000Z",
    citationsObserved: citations != null });
  const aiSnapshot = () => {
    const src = <T,>(payload: T) => ({ status: "fresh" as const, lastSyncedAt: null, payload });
    return buildEvidenceSnapshot({
      scope: { tenantId: TENANT, site: "fixture.example", builtAt: "2026-08-20T00:00:00.000Z" },
      gsc: src([]), ga4: src([]), clarity: src([]), dataforseo: src([]),
      wix: src([wixPage("/shiraz", "Things to do in Shiraz", ["Things to do in Shiraz", "Day trips from Shiraz"]),
        wixPage("/rugs", "Persian rug buying guide", ["Knot density", "Dyes and wool"]),
        wixPage("/food", "Persian food classics", ["Kabob", "Stews"]),
        wixPage("/music", "Persian music instruments", ["Tar", "Setar"])]),
      research: src({ ...emptyResearchEvidence(), aiObservations: [
        storedAnswer("pA", "things to do in shiraz", [{ url: "https://rival.example/shiraz", domain: "rival.example", title: "Shiraz guide" }]),
        storedAnswer("pB", "best time to visit shiraz", null),
        storedAnswer("pC", "shiraz day trips", [{ url: "https://rival.example/trips", domain: "rival.example", title: "Shiraz day trips" }])] }), aiAnswersUnread: false });};
  const coldExtras = async () => { vi.resetModules(); return import("@/domains/decision/producers/extra"); };
  const runExtras = async (snapshot: unknown) => (await coldExtras()).extraQueueCards({
    tenantId: TENANT, snapshot: snapshot as never, now: new Date("2026-08-20T09:00:00Z"), reads: { left: 0 } });
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
    // BOTH SURFACES print the same sentence from the same row, read back through the store.
    const { readAiCaseDispositions, dispositionOf } = await import("@/domains/decision/ai-case-store"); const file = await readAiCaseDispositions(TENANT);
    expect(file.state).toBe("read"); const onVisibility = dispositionOf({ caseKey: "prompt:pB", state: "actionable", reason: "the evidence-only view" }, file);
    const onChanges = file.state === "read" ? file.rows.find((d) => d.caseKey === "prompt:pB")?.reason ?? null : null; expect(onVisibility.state).toBe("unreported");
    expect(onVisibility.href).toBeNull(); expect(onChanges).toBe(onVisibility.line);});
  it("judges and files the AI cases on a QUIET day, through the whole produce pass", async () => {
    env.snapshot = aiSnapshot();
    env.aiWindow = [];
    const out = await produceProposalsForTenant(TENANT, { zeroSpend: true }); expect(out.outcome).not.toBe("persistence_failed");
    expect(env.upserts).toBeGreaterThan(0); // the quiet pass filed
    expect(env.dispositions.get(`${TENANT}|prompt:pB`)?.state).toBe("unreported"); });
  /** REAL RENDERED CARDS, INSPECTED FIELD BY FIELD (operator, 2026-08-28). A banned-word check over an empty set
   *  passes vacuously, so this asserts the cards EXIST first, then reads every customer-visible field of a tracked
   *  card and a fan-out card: an undiagnosed case may say what happened and what is being checked, and may not
   *  tell the operator to touch the website. */
  it("renders undiagnosed tracked and fan-out cards that prescribe nothing", async () => {
    env.aiWindow = []; vi.resetModules();
    vi.doMock("@/domains/decision/producers/page-job", async (orig) => { const real = await orig() as Record<string, unknown>;
      return { ...real, pageUnderstanding: async () => ({ of: async () => ({ job: { subjects: ["shiraz"], answers: [] }, reason: "read" }),
        corpus: new Map(), hold: () => {}, held: [] }), sectionFit: () => "fits" }; });
    const m = await import("@/domains/decision/producers/extra");
    const run = await m.extraQueueCards({ tenantId: TENANT, snapshot: aiSnapshot() as never, now: new Date("2026-08-20T09:00:00Z"), reads: { left: 0 } });
    const aeo = run.cards.filter((c) => c.id.endsWith("::ai_answer_gap"));
    expect(aeo.length, "the cards must exist or this test proves nothing").toBeGreaterThan(0);
    for (const c of aeo) {
      const fields = [c.opportunityType, c.whyItMatters, c.recommendedChange.kind === "existing_edit" ? c.recommendedChange.after : "",
        ...(c.evidence.hints ?? []), ...(c.operatorSteps ?? []), c.causeFinding?.explanation ?? "", c.research?.next ?? "",
        ...(c.causeFinding?.competingExplanations ?? []).map((x) => x.reason)].join(" ").toLowerCase();
      for (const banned of ["make it reachable", "align the title", "link to ", "add an answer block", "add a section", "opening to win",
        "lift whole", "liftable", "has to be one the assistants reach", "make the page they reach"]) {
        expect(fields, `an undiagnosed card may not say "${banned}"`).not.toContain(banned); }
      expect(c.treatment ?? null, "and it names no treatment").toBeNull();
      expect((c.operatorSteps ?? []).join(" "), "its only step is that nothing is owed yet").toContain("Nothing to do yet"); }
    expect(run.aeoSpend, "an unfunded pass bought nothing").toMatchObject({ funded: 0, attempted: 0 });
    vi.doUnmock("@/domains/decision/producers/page-job"); });
  /** AN UNFUNDED PASS BUYS NO READING, NAMES NO TREATMENT AND HIRES NOBODY. This fixture's page has never been read, so every case lands held: what it proves is that the pass spends nothing and claims nothing when it cannot diagnose. The rendered-copy promise is proved where cards exist, on the live replay. */
  it("an unfunded pass funds nothing, attempts nothing, and names no treatment", async () => {
    env.aiWindow = [];
    const run = await runExtras(aiSnapshot()); // reads {left: 0} and no aeoDiagnoses: an empty purse and an unread page
    expect(run.aeoSpend, "an unfunded pass funds and attempts nothing").toMatchObject({ funded: 0, attempted: 0, cached: 0 });
    expect([run.cards.filter((c) => c.treatment === "technical_reachability" || c.treatment === "consolidate_or_differentiate"), run.families.includes("ai_answer_gap")], "no treatment from a stage fact alone, and the family still answers for its own record").toEqual([[], true]); });
  it("a banked diagnosis survives a pass that did not rule, exactly as the migration's coalesce writes it", async () => {
    const { recordAiCaseDispositions, readAiCaseDispositions } = await import("@/domains/decision/ai-case-store");
    const dx = { kind: "already_answered", treatment: null, explanation: "e", ownedIds: ["own-1"], evidenceIds: [], packet: "pk", contentHash: "h", completeness: "complete", observationIds: ["o1"], version: 1, decidedAt: "2026-08-20T08:00:00.000Z" } as never;
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
    // A search a tracked question already asks files as covered, never as silence. (A fan-out echoing its OWN prompt never becomes a row: the projection drops the echo at the door.)
    const windowRow = (id: string, promptId: string, promptText: string, fanOuts: string[] | null) => ({
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
