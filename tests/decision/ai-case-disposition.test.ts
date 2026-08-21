/** ONE CONCLUSION PER SEARCH, WRITTEN DOWN DURABLY, READ BY EVERY SURFACE (terminal closure, 2026-08-19;
 *  made durable 2026-08-21).
 *
 *  Two defects these pin. First: the resolver is pure and both sides could call it, which was necessary and
 *  not sufficient. Decision holds the landing evidence (which pages exist, which have been read, whether any
 *  of their jobs fit); Visibility holds none of it. Re-deriving from evidence alone, the screen called a
 *  search Decision had already refused for want of a page "actionable" and put an Open Changes button under
 *  it. Second: the first persistence was a whole-account json blob behind a process cache, and on a hosted
 *  instance a read error came back as an empty file, a failed write was swallowed while the pass reported
 *  itself durably filed, and two cold instances merged by overwriting each other. The record is a TABLE now
 *  (one row per tenant and case, one SQL writer with a stale-writer guard), and the fake below implements the
 *  writer's documented semantics from migrations/2026-08-21_ai_case_dispositions.sql byte for byte: insert,
 *  else update only where the incoming decided_at is not older, count only the rows that actually landed. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispositionOf, type AiCaseDisposition } from "@/domains/decision/ai-case-store";

const filed = (over: Partial<AiCaseDisposition> = {}): AiCaseDisposition => ({
  caseKey: "fanout:haft|seen|set", state: "no_page", query: "haft seen set delivery",
  reason: "ran on 4 separate days, and no page of this account is for it yet, so no edit can win it. It is on the list of pages to build.",
  days: 4, engines: 2, parents: 2, executions: 9, decidedAt: "2026-08-19T00:00:00.000Z", ...over });
/** The file as a surface receives it: read, and holding these rows. */
const read = (rows: AiCaseDisposition[]) => ({ state: "read" as const, rows });
const EVIDENCE = { caseKey: "fanout:haft|seen|set", state: "actionable" as const,
  reason: "ran on 4 separate days, and no assistant reports reading a page of this account for it." };

describe("what a surface shows for one search is decided in one place", () => {
  it("shows the refusal Decision reached, and never an action under it", () => {
    // The evidence alone says actionable. The pass that held the pages says no page here is for it.
    const d = dispositionOf(EVIDENCE, read([filed()]));
    expect(d.state).toBe("no_page");
    expect(d.href).toBeNull(); // the button that appeared under a refused case
    expect(d.line).toContain("pages to build");
  });
  it("shows a page held for want of a reading as held, not as work", () => {
    const d = dispositionOf(EVIDENCE, read([filed({ state: "held", pageUrl: "https://own.example/haft-seen",
      reason: "ran on 4 separate days, and the page it would land on has not been read yet, so the next work is that reading rather than a change." })]));
    expect([d.state, d.href]).toEqual(["held", null]);
  });
  it("shows a search a tracked question already asks as covered, deliberately, with no action under it", () => {
    // Declining to open a case is a decision. Held only in a log counter, the account's strongest search
    // read as "not judged yet" on the screen, which is the exact defect the covered vocabulary closes.
    const d = dispositionOf(EVIDENCE, read([filed({ state: "covered",
      reason: "ran on 4 separate days. A question this account already tracks asks this search, so its standing is judged there rather than as a case of its own." })]));
    expect([d.state, d.href]).toEqual(["covered", null]);
    expect(d.line).toContain("already tracks");
  });
  it("offers the action only where the filed verdict actually named a page", () => {
    expect(dispositionOf(EVIDENCE, read([filed({ state: "actionable", pageUrl: "https://own.example/haft-seen" })])).href).toBe("/changes");
    expect(dispositionOf(EVIDENCE, read([filed({ state: "actionable" })])).href).toBeNull(); // actionable with nowhere to land is not an offer
  });
  it("lets the change on file outrank every verdict, because a card is the strongest truth about a search", () => {
    const d = dispositionOf(EVIDENCE, read([filed()]), { id: "t::/haft-seen::existing_edit::ai_answer_gap", pagePath: "/haft-seen" });
    expect([d.state, d.href]).toEqual(["change", "/changes/t%3A%3A%2Fhaft-seen%3A%3Aexisting_edit%3A%3Aai_answer_gap"]);
    const r = dispositionOf(EVIDENCE, read([filed()]), { id: "x", researchOnly: true, pagePath: "/haft-seen", missing: "the source is not banked yet" });
    expect([r.state, r.line.includes("the source is not banked yet")]).toEqual(["research", true]);
  });
  it("says a search nobody has judged yet is unjudged, and offers nothing", () => {
    const d = dispositionOf(EVIDENCE, read([]));
    expect(d.state).toBe("actionable");
    expect(d.href).toBeNull();
    expect(d.line).toContain("has not judged this one yet");
  });
  it("keeps a verdict about a different search out of this one", () => {
    expect(dispositionOf(EVIDENCE, read([filed({ caseKey: "fanout:something|else" })])).state).toBe("actionable");
  });
});

/** END TO END, ONE RECORD: what the producer concluded is what BOTH surfaces show, for each of the states a
 *  material search can reach. The screens do not re-derive it and cannot disagree with it. */
describe("a decided search reaches both surfaces as the same verdict", () => {
  const evidenceFor = (key: string) => ({ caseKey: `fanout:${key}`, state: "actionable" as const,
    reason: "ran on 4 separate days, and no assistant reports reading a page of this account for it." });
  /** What Visibility renders. */
  const onVisibility = (file: Parameters<typeof dispositionOf>[1], key: string) => dispositionOf(evidenceFor(key), file);
  /** What Changes renders: the same rows, matched on the same canonical identity the card carries. */
  const onChanges = (file: Parameters<typeof dispositionOf>[1], key: string): string | null =>
    file.state !== "read" ? null : file.rows.find((d) => d.caseKey === `fanout:${key}`)?.reason ?? null;

  it("shows a refusal as a refusal on both, with no action offered anywhere", () => {
    const file = { state: "read" as const, rows: [filed({ caseKey: "fanout:a", state: "no_page" })] };
    const v = onVisibility(file, "a");
    expect([v.state, v.href]).toEqual(["no_page", null]);
    expect(onChanges(file, "a")).toBe(v.line); // the identical sentence, from the identical row
  });
  it("shows a page held for a reading as held on both", () => {
    const file = { state: "read" as const, rows: [filed({ caseKey: "fanout:b", state: "held", pageUrl: "https://own.example/p",
      reason: "ran on 3 separate days, and the page it would land on has not been read yet, so the next work is that reading rather than a change." })] };
    const v = onVisibility(file, "b");
    expect([v.state, v.href]).toEqual(["held", null]);
    expect(onChanges(file, "b")).toBe(v.line);
  });
  it("shows actionable work as actionable on both, and only where a page was named", () => {
    const file = { state: "read" as const, rows: [filed({ caseKey: "fanout:c", state: "actionable", pageUrl: "https://own.example/p" })] };
    const v = onVisibility(file, "c");
    expect([v.state, v.href]).toEqual(["actionable", "/changes"]);
    expect(onChanges(file, "c")).toBe(v.line);
  });
  it("says the verdict could not be read, on both, rather than inventing a cheerier one", () => {
    const file = { state: "unavailable" as const };
    const v = onVisibility(file, "a");
    expect(v.state).toBe("unavailable");
    expect(v.line).toContain("could not be read");
    expect(v.href).toBeNull();
    expect(onChanges(file, "a")).toBeNull(); // Changes claims nothing either
  });
});

/** THE TABLE ITSELF, exercised through the store against a fake database that implements the SQL writer's
 *  documented semantics exactly (migrations/2026-08-21_ai_case_dispositions.sql): one row per (tenant, case),
 *  insert-else-update WHERE the incoming decided_at is not older, landed = rows the guard let through. */
const db = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  rpcCalls: 0,
  failReads: false, failWrites: false,
}));
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
        executions: r.executions ?? 0, decided_at: r.decidedAt });
      landed += 1;
    }
    return landed;
  };
  /** A builder chain whose every method chains and whose await resolves the answer. */
  const answered = (data: unknown, error: { message: string } | null = null): unknown =>
    new Proxy({}, { get: (_t, p) => p === "then"
      ? (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data, error }).then(res, rej)
      : () => answered(data, error) });
  return { getSupabaseAdmin: () => ({
    rpc: (name: string, args: { p_tenant_id: string; p_rows: unknown[] }) => {
      db.rpcCalls += 1;
      if (db.failWrites) return Promise.resolve({ data: null, error: { message: "connection reset" } });
      if (name !== "upsert_ai_case_dispositions") return Promise.resolve({ data: null, error: { message: `no function ${name}` } });
      return Promise.resolve({ data: upsert(args.p_tenant_id, args.p_rows), error: null });
    },
    from: (table: string) => db.failReads || table !== "ai_case_dispositions"
      ? answered(null, { message: "statement timeout" })
      : answered([...db.rows.values()]),
  }) };
});

describe("the filed verdicts are durable, and two cold instances merge instead of overwriting", () => {
  beforeEach(() => { db.rows.clear(); db.rpcCalls = 0; db.failReads = false; db.failWrites = false; });
  /** One COLD instance: a fresh copy of the module, sharing nothing in-process with the last one. */
  const coldInstance = async () => { vi.resetModules(); return import("@/domains/decision/ai-case-store"); };

  it("merges by row across two cold instances: the pass that reached fewer cases erases nothing", async () => {
    const a = await coldInstance();
    expect(await a.recordAiCaseDispositions("t", [filed({ caseKey: "fanout:a", state: "no_page" }),
      filed({ caseKey: "fanout:b", state: "already_credited" })])).toEqual({ filed: true, landed: 2 });
    // A second lambda, cold, reaches only one of them later and says something different about it.
    const b = await coldInstance();
    expect(await b.recordAiCaseDispositions("t", [filed({ caseKey: "fanout:a", state: "actionable",
      pageUrl: "https://own.example/p", decidedAt: "2026-08-20T00:00:00.000Z" })])).toEqual({ filed: true, landed: 1 });
    const back = await b.readAiCaseDispositions("t");
    expect(back.state === "read" ? back.rows.map((d) => [d.caseKey, d.state]).sort() : []).toEqual(
      [["fanout:a", "actionable"], ["fanout:b", "already_credited"]]);
  });
  it("refuses a stale writer: an older pass that woke up late cannot overwrite the newer verdict", async () => {
    const s = await coldInstance();
    await s.recordAiCaseDispositions("t", [filed({ caseKey: "fanout:a", state: "actionable", decidedAt: "2026-08-20T00:00:00.000Z" })]);
    // The late lambda decided BEFORE that, and lands nothing: not a failure, and not its success either.
    expect(await s.recordAiCaseDispositions("t", [filed({ caseKey: "fanout:a", state: "monitoring", decidedAt: "2026-08-18T00:00:00.000Z" })]))
      .toEqual({ filed: true, landed: 0 });
    const back = await s.readAiCaseDispositions("t");
    expect(back.state === "read" ? back.rows[0]?.state : null).toBe("actionable");
  });
  it("carries a read failure out as unavailable, never as an account with no verdicts", async () => {
    const s = await coldInstance();
    await s.recordAiCaseDispositions("t", [filed()]);
    db.failReads = true;
    expect(await s.readAiCaseDispositions("t")).toEqual({ state: "unavailable" });
  });
  it("reports a write failure as filed:false, so the pass cannot claim durability it did not get", async () => {
    const s = await coldInstance();
    db.failWrites = true;
    expect(await s.recordAiCaseDispositions("t", [filed()])).toEqual({ filed: false, reason: "unwritable" });
  });
  it("files an empty set without touching the database at all", async () => {
    const s = await coldInstance();
    expect(await s.recordAiCaseDispositions("t", [])).toEqual({ filed: true, landed: 0 });
    expect(db.rpcCalls).toBe(0); // deciding nothing is not a write
  });
});
