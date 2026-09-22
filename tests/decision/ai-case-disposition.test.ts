import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispositionOf, type AiCaseDisposition } from "@/domains/decision/ai-case-store";
const filed = (over: Partial<AiCaseDisposition> = {}): AiCaseDisposition => ({
  caseKey: "fanout:haft|seen|set", state: "no_page", query: "haft seen set delivery",
  reason: "ran on 4 separate days, and no page of this account is for it yet, so no edit can win it. It is on the list of pages to build.",
  days: 4, engines: 2, parents: 2, executions: 9, decidedAt: "2026-08-19T00:00:00.000Z", ...over });
const read = (rows: AiCaseDisposition[]) => ({ state: "read" as const, rows });
const EVIDENCE = { caseKey: "fanout:haft|seen|set", state: "actionable" as const, reason: "ran on 4 separate days, and no assistant reports reading a page of this account for it." };
describe("what a surface shows for one search is decided in one place", () => {
  it.each([
    ["refused", [filed()], "no_page", "pages to build"],
    ["unread page", [filed({ state: "held", pageUrl: "https://own.example/haft-seen", reason: "The page has not been read yet." })], "held", "has not been read"],
    ["covered", [filed({ state: "covered", reason: "A question this account already tracks covers this search." })], "covered", "already tracks"],
    ["unjudged", [], "actionable", "has not judged this one yet"],
    ["unrelated verdict", [filed({ caseKey: "fanout:something|else" })], "actionable", "has not judged this one yet"],
  ] as const)("offers no action for %s", (_name, rows, state, line) => {
    const d = dispositionOf(EVIDENCE, read([...rows]));
    expect([d.state, d.href]).toEqual([state, null]);
    expect(d.line).toContain(line);
  });
  it("offers the action only where the filed verdict actually named a page", () => {
    expect(dispositionOf(EVIDENCE, read([filed({ state: "actionable", pageUrl: "https://own.example/haft-seen" })])).href).toBe("/changes");
    expect(dispositionOf(EVIDENCE, read([filed({ state: "actionable" })])).href).toBeNull(); // actionable with nowhere to land is not an offer
  });
  it("lets the change on file outrank every verdict, because a card is the strongest truth about a search", () => {
    const d = dispositionOf(EVIDENCE, read([filed()]), { id: "t::/haft-seen::existing_edit::ai_answer_gap", pagePath: "/haft-seen" });
    expect([d.state, d.href]).toEqual(["change", "/changes/t%3A%3A%2Fhaft-seen%3A%3Aexisting_edit%3A%3Aai_answer_gap"]);
    const r = dispositionOf(EVIDENCE, read([filed()]), { id: "x", researchOnly: true, pagePath: "/haft-seen", missing: "the source is not banked yet" });
    expect([r.state, r.line.includes("the source is not banked yet")]).toEqual(["research", true]);});
});
const db = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  rpcCalls: 0,
  failReads: false, failWrites: false,}));
vi.mock("@/lib/persistence/supabase", () => {
  const key = (t: unknown, c: unknown) => `${String(t)}|${String(c)}`;
  const upsert = (tenant: string, raw: unknown[]): number => {
    let landed = 0;
    for (const r of raw as Array<Record<string, unknown>>) {
      if (!r.caseKey || !r.reason) continue; // the SQL drops rows with no identity or no reason
      const k = key(tenant, r.caseKey), held = db.rows.get(k);
      if (held && String(r.decidedAt) < String(held.decided_at)) continue; // the stale-writer guard
      db.rows.set(k, { tenant_id: tenant, case_key: r.caseKey, state: r.state, query: r.query,
        page_url: r.pageUrl ?? null, stage: r.stage ?? null, proposal_id: r.proposalId ?? null,
        reason: r.reason, days: r.days ?? 0, engines: r.engines ?? 0, parents: r.parents ?? 0,
        executions: r.executions ?? 0, decided_at: r.decidedAt, diagnosis: r.diagnosis ?? null });
      landed += 1;}
    return landed;};
  const answered = (data: unknown, error: { message: string } | null = null): unknown =>
    new Proxy({}, { get: (_t, p) => p === "then"
      ? (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data, error }).then(res, rej)
      : () => answered(data, error) });
  return { getSupabaseAdmin: () => ({
    rpc: (name: string, args: { p_tenant_id: string; p_rows: unknown[] }) => {
      db.rpcCalls += 1;
      if (db.failWrites) return Promise.resolve({ data: null, error: { message: "connection reset" } });
      if (name !== "upsert_ai_case_dispositions") return Promise.resolve({ data: null, error: { message: `no function ${name}` } });
      return Promise.resolve({ data: upsert(args.p_tenant_id, args.p_rows), error: null });},
    from: (table: string) => db.failReads || table !== "ai_case_dispositions"
      ? answered(null, { message: "statement timeout" })
      : answered([...db.rows.values()]),
  }) };});
beforeEach(() => { db.rows.clear(); db.rpcCalls = 0; db.failReads = false; db.failWrites = false; });
it.each([
  ["forward", ["fanout:zebra", "fanout:apple", "fanout:mango"]],
  ["reverse", ["fanout:mango", "fanout:apple", "fanout:zebra"]],
])("orders tied account verdicts independently of %s arrival", async (_name, keys) => {
  const { recordAiCaseDispositions, readAiCaseDispositions } = await import("@/domains/decision/ai-case-store");
  await recordAiCaseDispositions("t", (keys as string[]).map((caseKey) => filed({ caseKey, state: "monitoring", days: 18, engines: 1, executions: 18 })));
  const back = await readAiCaseDispositions("t");
  expect(back.state === "read" ? back.rows.map((r) => r.caseKey) : null).toEqual(["fanout:apple", "fanout:mango", "fanout:zebra"]);
});

describe("the filed verdicts are durable, and two cold instances merge instead of overwriting", () => {
  const coldInstance = async () => { vi.resetModules(); return import("@/domains/decision/ai-case-store"); };
  it("merges by row across two cold instances: the pass that reached fewer cases erases nothing", async () => {
    const a = await coldInstance();
    expect(await a.recordAiCaseDispositions("t", [filed({ caseKey: "fanout:a", state: "no_page" }), filed({ caseKey: "fanout:b", state: "already_credited" })])).toEqual({ filed: true, landed: 2 });
    const b = await coldInstance();
    expect(await b.recordAiCaseDispositions("t", [filed({ caseKey: "fanout:a", state: "actionable", pageUrl: "https://own.example/p", decidedAt: "2026-08-20T00:00:00.000Z" })])).toEqual({ filed: true, landed: 1 });
    const back = await b.readAiCaseDispositions("t");
    expect(back.state === "read" ? back.rows.map((d) => [d.caseKey, d.state]).sort() : []).toEqual(
      [["fanout:a", "actionable"], ["fanout:b", "already_credited"]]);});
  it("reports superseded when even ONE row lost, because the family claim is all rows or nothing", async () => {
    const s = await coldInstance(); await s.recordAiCaseDispositions("t", [filed({ caseKey: "fanout:a", state: "actionable", decidedAt: "2026-08-20T00:00:00.000Z" })]);
    expect(await s.recordAiCaseDispositions("t", [filed({ caseKey: "fanout:a", state: "monitoring", decidedAt: "2026-08-18T00:00:00.000Z" })])).toEqual({ filed: false, reason: "superseded", landed: 0 });
    const unchanged = await s.readAiCaseDispositions("t"); expect(unchanged.state === "read" ? unchanged.rows[0]?.state : null).toBe("actionable");
    const out = await s.recordAiCaseDispositions("t", [
      filed({ caseKey: "fanout:a", state: "monitoring", decidedAt: "2026-08-18T00:00:00.000Z" }), // loses
      filed({ caseKey: "fanout:b", state: "no_page", decidedAt: "2026-08-21T00:00:00.000Z" }),    // lands
    ]);
    expect(out).toEqual({ filed: false, reason: "superseded", landed: 1 });
    const back = await s.readAiCaseDispositions("t"); // the landed row IS durable; only the sweep license is lost
    expect(back.state === "read" ? back.rows.map((d) => [d.caseKey, d.state]).sort() : []).toEqual(
      [["fanout:a", "actionable"], ["fanout:b", "no_page"]]);});
  it("carries a read failure out as unavailable, never as an account with no verdicts", async () => {
    const s = await coldInstance(); await s.recordAiCaseDispositions("t", [filed()]);
    db.failReads = true;
    expect(await s.readAiCaseDispositions("t")).toEqual({ state: "unavailable" });});
  it("reports a write failure as filed:false, so the pass cannot claim durability it did not get", async () => {
    const s = await coldInstance();
    db.failWrites = true;
    expect(await s.recordAiCaseDispositions("t", [filed()])).toEqual({ filed: false, reason: "unwritable" });});
  it("files an empty set without touching the database at all", async () => {
    const s = await coldInstance(); expect(await s.recordAiCaseDispositions("t", [])).toEqual({ filed: true, landed: 0 });
    expect(db.rpcCalls).toBe(0); // deciding nothing is not a write
  });});

describe("a persisted diagnosis is decoded, never trusted", () => {
  const CONTRACT = 5;
  const ok = { kind: "scattered_answer", treatment: "rewrite_existing_section", explanation: "e", ownedIds: ["own-1", "own-2"], evidenceIds: [], packet: "pk", contentHash: "h", completeness: "complete", observationIds: ["o1"], version: CONTRACT, decidedAt: "2026-08-28T00:00:00.000Z" };
  it("keeps a whole record and fails closed on every broken one", async () => {
    const { decodeDiagnosis, freshDiagnosis, DIAGNOSIS_CONTRACT } = await import("@/domains/decision/ai-case-store");
    expect(decodeDiagnosis(ok)).toMatchObject({ kind: "scattered_answer", packet: "pk" });
    expect(decodeDiagnosis({ ...ok, sourceUrls: ["https://source.example/article"] })).toMatchObject({ sourceUrls: ["https://source.example/article"] });
    for (const sourceUrls of [["javascript:alert(1)"], ["/relative"], ["https://user:pass@source.example"], [5]]) expect(decodeDiagnosis({ ...ok, sourceUrls })).toBeNull();
    for (const [what, bad] of [["not an object", "nope"], ["null", null], ["an array", [ok]], ["an unknown kind", { ...ok, kind: "vibes" }], ["an unknown treatment", { ...ok, treatment: "rewrite_everything" }], ["a missing packet", { ...ok, packet: "" }], ["an older contract", { ...ok, version: 0 }], ["duplicate ids", { ...ok, ownedIds: ["own-1", "own-1"] }], ["a non-string id", { ...ok, evidenceIds: [7] }], ["no explanation", { ...ok, explanation: "  " }], ["a half-written row", { kind: "already_answered" }],
      ["unknown carrying a rewrite", { ...ok, kind: "unknown" }], ["already answered carrying an add", { ...ok, kind: "already_answered", treatment: "add_answer_section" }], // THE PAIR IS THE CHECK: a verdict that authorized nothing may not arrive carrying work, whatever enum each half belongs to.
      ["scatter carrying an add", { ...ok, treatment: "add_answer_section" }], ["a rewrite kind carrying null", { ...ok, treatment: null }]] as const) expect(decodeDiagnosis(bad), what).toBeNull();
    expect(decodeDiagnosis({ ...ok, kind: "extraction_or_structure_gap" }), "structure keeps its rewrite").toMatchObject({ treatment: "rewrite_existing_section" });
    expect([DIAGNOSIS_CONTRACT > 1, decodeDiagnosis({ ...ok, version: DIAGNOSIS_CONTRACT - 1 })], "the contract moved with its rules, and the previous version fails closed").toEqual([true, null]);
    expect(decodeDiagnosis({ ...ok, kind: "missing_information", treatment: "add_answer_section" }), "missing information decodes; the gate is what holds it acquisition-first").toMatchObject({ kind: "missing_information" });
    expect([freshDiagnosis(decodeDiagnosis(ok) ?? undefined, "pk"), freshDiagnosis(decodeDiagnosis(ok) ?? undefined, "OTHER")], "the exact packet is current; any other is stale").toEqual([true, false]); }); });

it("round-trips the exact owned passage proof through the durable case row", async () => {
  const s = await import("@/domains/decision/ai-case-store"), diagnosis = { kind: "scattered_answer", treatment: "rewrite_existing_section", explanation: "The answer is split across two passages.", ownedIds: ["own-2", "own-4"], evidenceIds: ["source-1"], sourceUrls: ["https://source.example/article"], packet: "packet-bound-to-every-input", contentHash: "page-revision-7", completeness: "complete", observationIds: ["obs-1"], version: s.DIAGNOSIS_CONTRACT, decidedAt: "2026-09-18T00:00:00.000Z" } as const;
  await s.recordAiCaseDispositions("t", [filed({ caseKey: "prompt:proof", state: "actionable", diagnosis })]);
  const back = await s.readAiCaseDispositions("t");
  expect(back.state === "read" ? back.rows[0]?.diagnosis : null).toEqual(diagnosis);
});
