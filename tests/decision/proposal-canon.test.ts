/** CANONICAL PROPOSAL PERSISTENCE (V1 Truth Convergence Phase 5): one current row per hypothesis
 *  (account, case, page, action family), a re-draft supersedes with a pointer and a version, an
 *  identical draft writes nothing, a dismissed change is not resurrected under the same evidence,
 *  history stays readable and is never revived, and a write that lands nothing is a failure.
 *  Fixtures only: the fake Postgres below enforces the primary key and the partial unique index. */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  // `missing` = the TABLE is not in the schema cache; `rpcMissing` = the table is there and the
  // supersession FUNCTION is not. They are separate flags because they are separate deploy accidents, and
  // one flag could only ever test the first: the table read failed before the function was ever called.
  const state = { rows: [] as Row[], legacy: [] as Row[], missing: false, rpcMissing: false, breakWrite: false, rpcCalls: 0 };
  const CANON = "change_proposals";
  const client = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const sets: Array<[string, readonly unknown[]]> = [];
      let op: "select" | "update" | "upsert" = "select";
      let patch: Row = {}, sent: Row[] = [];
      // The row budget and the sort order are part of what the queue read is being asked to prove,
      // so the fake honours order + limit instead of returning everything it holds.
      let sortBy: [string, boolean] | null = null, max = Number.MAX_SAFE_INTEGER;
      const rows = () => (table === CANON ? state.rows : state.legacy);
      const hit = (r: Row) => filters.every(([c, v]) => (r[c] ?? null) === v) && sets.every(([c, vs]) => vs.includes(r[c]));
      const run = () => {
        if (table === CANON && state.missing) return { data: null, error: { code: "PGRST205", message: "table not found in schema cache" } };
        if (op === "select") {
          const found = rows().filter(hit).map((r) => ({ ...r }));
          if (sortBy) { const [col, asc] = sortBy; found.sort((a, b) => (asc ? 1 : -1) * String(a[col] ?? "").localeCompare(String(b[col] ?? ""))); }
          return { data: found.slice(0, max), error: null };
        }
        if (op === "update") { const affected = rows().filter(hit); for (const r of affected) Object.assign(r, patch); return { data: affected.map((r) => ({ id: r.id })), error: null }; }
        if (state.breakWrite) return { data: [], error: null }; // accepted, landed nothing
        for (const row of sent) {
          // The partial unique index: one current row per (tenant, case, page, family).
          const clash = state.rows.some((r) => r.id !== row.id && r.terminal_disposition == null
            && ["tenant_id", "case_id", "page_key", "action_family"].every((c) => r[c] === row[c]));
          if (clash) return { data: null, error: { message: "duplicate key value violates unique constraint ux_change_proposals_current" } };
          const at = state.rows.findIndex((r) => r.id === row.id);
          if (at >= 0) state.rows[at] = { ...state.rows[at], ...row }; else state.rows.push({ created_at: "2026-07-01T00:00:00.000Z", ...row });
        }
        return { data: sent.map((r) => ({ id: r.id })), error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        order: (c: string, o?: { ascending?: boolean }) => { sortBy = [c, o?.ascending !== false]; return q; },
        limit: (n: number) => { max = n; return q; },
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
        is: (c: string, v: unknown) => { filters.push([c, v]); return q; },
        in: (c: string, vs: readonly unknown[]) => { sets.push([c, vs]); return q; },
        update: (p: Row) => { op = "update"; patch = p; return q; },
        upsert: (r: Row[]) => { op = "upsert"; sent = r; return q; },
        then: (resolve: (v: unknown) => void) => resolve(run()),
      };
      return q;
    },
    // The atomic handover: guard, step-aside, and landing commit together or not at
    // all, exactly like the supersede_change_proposal function in production.
    rpc(name: string, args: { p_tenant_id: string; p_predecessor_id: string; p_row: Row }) {
      state.rpcCalls += 1;
      const run = (): { data: string | null; error: { message: string; code?: string } | null } => {
        if (name !== "supersede_change_proposal") return { data: null, error: { message: `unknown function ${name}` } };
        if (state.rpcMissing) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.supersede_change_proposal" } };
        // The tenant guard the SQL now opens with: a successor id living under another account fails whole.
        if (state.rows.some((r) => r.id === (args.p_row as Row).id && r.tenant_id !== args.p_tenant_id)) return { data: "failed", error: null };
        const pred = state.rows.find((r) => r.tenant_id === args.p_tenant_id && r.id === args.p_predecessor_id);
        if (!pred) return { data: "failed", error: null };
        if (pred.terminal_disposition != null || !["proposed", "needs_review"].includes(String(pred.status))) return { data: "blocked", error: null };
        if (state.breakWrite) return { data: "failed", error: null }; // the transaction rolls back: neither write lands
        const row = args.p_row;
        const clash = state.rows.some((r) => r.id !== row.id && r.id !== pred.id && r.terminal_disposition == null
          && ["tenant_id", "case_id", "page_key", "action_family"].every((c) => r[c] === row[c]));
        if (clash) return { data: "failed", error: null };
        Object.assign(pred, { terminal_disposition: "superseded", superseded_by: row.id, updated_at: row.updated_at });
        const at = state.rows.findIndex((r) => r.id === row.id);
        if (at >= 0) state.rows[at] = { ...state.rows[at], ...row }; else state.rows.push({ created_at: "2026-07-01T00:00:00.000Z", ...row });
        return { data: "saved", error: null };
      };
      return Promise.resolve(run());
    },
  };
  return { state, client };
});
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => db.client }));
/** What the store SAID, so a distinct failure can be pinned as distinct rather than as one more "failed". */
const said = vi.hoisted(() => ({ errors: [] as string[] }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {},
  error: (msg: string) => { said.errors.push(msg); } } }));

import { dismissChangeProposal, loadChangeProposal, loadChangeProposals, saveChangeProposal } from "@/domains/decision/proposal-store";
import { serializeChangeProposal, type ChangeBundle, type ChangeProposal } from "@/domains/decision/contracts";

const T = "acct-a", PAGE = "/nowruz-guide";
const bundle = (kind: ChangeBundle["components"][number]["kind"], after = "Nowruz Traditions and the Haft-Seen Table"): ChangeBundle => ({
  objective: "Say what the searcher asked for in the line Google shows.", metric: "clicks on this page for this search",
  scope: { queries: ["nowruz traditions"], prompts: [] },
  components: [{ kind, label: "Page title", before: "Nowruz", after, evidenceKeys: ["k1"], risk: "safe" }],
  receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "1,200 impressions and 9 clicks for nowruz traditions.", observedAt: "2026-07-25T00:00:00.000Z" }], missing: [], freshestObservedAt: "2026-07-25T00:00:00.000Z" },
  alternatives: [], risks: [], confidenceReasons: [], measurementPlan: "I will read clicks for this search after 14 days.",
});
const proposal = (over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: `${T}::${PAGE}::existing_edit::title`, tenantId: T, kind: "existing_edit", pagePath: PAGE,
  pageUrl: `https://www.fixture-outdoors.example${PAGE}`, pageLabel: "Nowruz guide", primaryQuery: "nowruz traditions",
  opportunityType: "Capture clicks", changeFamily: "title", status: "proposed",
  recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table" },
  whyItMatters: "The line Google shows misses the words people search for.", estimatedEffortMinutes: 1,
  riskLevel: "low", confidence: "medium", limitations: [], evidence: { query: "nowruz traditions", hints: [], evidenceRefCount: 1 },
  impactScore: 300, upsidePerMonth: null, basis: "basis_today::d6", publish: "manual", createdAt: "2026-07-30T00:00:00.000Z", ...over,
});
/** The deep form of the same hypothesis: a different id, the same page, the same family. */
const deep = (over: Partial<ChangeProposal> = {}) => proposal({ id: `${T}::${PAGE}::existing_edit::bundle`, bundle: bundle("title"), ...over });
const current = () => db.state.rows.filter((r) => r.terminal_disposition == null);
const seedLegacy = (p: ChangeProposal) => db.state.legacy.push({ tenant_id: p.tenantId, rec_id: p.id, kind: "change_proposal", content: serializeChangeProposal(p), created_at: p.createdAt });

beforeEach(() => { db.state.rows = []; db.state.legacy = []; db.state.missing = false; db.state.rpcMissing = false; db.state.breakWrite = false; db.state.rpcCalls = 0; });

describe("canonical proposal persistence", () => {
  it("keeps ONE current row per hypothesis: a re-draft supersedes its predecessor, points at it, and carries the next version", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved");
    expect(await saveChangeProposal(deep())).toBe("saved"); // the deep form of the same page and the same family
    expect(db.state.rows).toHaveLength(2);
    expect(current().map((r) => [r.id, r.proposal_version, r.action_family]))
      .toEqual([[`${T}::${PAGE}::existing_edit::bundle`, 2, "title-family"]]);
    const retired = db.state.rows.find((r) => r.id === `${T}::${PAGE}::existing_edit::title`)!;
    expect([retired.terminal_disposition, retired.superseded_by]).toEqual(["superseded", `${T}::${PAGE}::existing_edit::bundle`]);
    // History is not served as current work, by id or in the queue.
    expect(await loadChangeProposal(T, retired.id as string)).toBeNull();
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([`${T}::${PAGE}::existing_edit::bundle`]);
  });

  it("bumps the version in place when the same id says something new, and writes NOTHING when it says the same thing", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved");
    expect(await saveChangeProposal(proposal())).toBe("unchanged"); // same material content, same timestamp, no write
    expect(await saveChangeProposal({ ...proposal(), createdAt: "2026-07-31T09:00:00.000Z" })).toBe("unchanged"); // a moved clock is not new thinking
    expect(db.state.rows).toHaveLength(1);
    expect(db.state.rows[0]!.proposal_version).toBe(1);
    expect(await saveChangeProposal(proposal({ status: "needs_review" }))).toBe("saved");
    expect(db.state.rows).toHaveLength(1); // still one row: the same id is the same hypothesis
    expect([db.state.rows[0]!.proposal_version, db.state.rows[0]!.status, db.state.rows[0]!.terminal_disposition]).toEqual([2, "needs_review", null]);
    // The same id whose components moved to another family MOVES: it is still one change, not two.
    expect(await saveChangeProposal(proposal({ bundle: bundle("section_rewrite") }))).toBe("saved");
    expect(db.state.rows).toHaveLength(1);
    expect([db.state.rows[0]!.action_family, db.state.rows[0]!.proposal_version]).toEqual(["section-family", 3]);
  });

  it("lands the reasoning on the stored row exactly once: the cause is material, and a re-save carrying the same one writes nothing", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved"); // filed before the ladder ever named a cause
    const reasoned = proposal({ diagnosisCause: "ctr_snippet", causeFinding: { cause: "ctr_snippet", action: "title", evidenceKeys: ["gsc"],
      competingExplanations: [{ cause: "cannibalization", reason: "only one page of yours comes up for that search" }],
      falsifier: "If Google starts displaying this page with the wording the pages beating it share, this is not the explanation.",
      explanation: "The line Google shows misses the words people search for.", notConsidered: [] } });
    expect(await saveChangeProposal(reasoned)).toBe("saved"); // ONE update, so the operator can actually open the investigation
    expect(db.state.rows).toHaveLength(1);
    expect([db.state.rows[0]!.proposal_version, (db.state.rows[0]!.decision_receipt as { cause: string }).cause]).toEqual([2, "ctr_snippet"]);
    expect(await saveChangeProposal(reasoned)).toBe("unchanged"); // and once only: every pass after it re-derives the same reasoning
    expect(db.state.rows[0]!.proposal_version).toBe(2);
  });

  it("holds two current rows when one page carries two different action families", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved"); // title-family
    const body = deep({ id: `${T}::${PAGE}::existing_edit::bundle`, bundle: bundle("section_rewrite") });
    expect(await saveChangeProposal(body)).toBe("saved"); // section-family: a different hypothesis about the same page
    expect(current().map((r) => r.action_family).sort()).toEqual(["section-family", "title-family"]);
    expect(current().every((r) => r.proposal_version === 1)).toBe(true);
    expect((await loadChangeProposals(T)).size).toBe(2);
  });

  it("does not resurrect a dismissed change under the same evidence, and lets a new basis try again", async () => {
    await saveChangeProposal(proposal());
    Object.assign(db.state.rows[0]!, { terminal_disposition: "dismissed" }); // the operator put it away
    expect(await saveChangeProposal(proposal({ confidence: "high" }))).toBe("refused");
    expect(db.state.rows[0]!.terminal_disposition).toBe("dismissed");
    expect((await loadChangeProposals(T)).size).toBe(0);
    // A different basis is a genuinely different reading of the account, so the change may be made again.
    expect(await saveChangeProposal(proposal({ basis: "basis_tomorrow::d6" }))).toBe("saved");
    expect([db.state.rows[0]!.terminal_disposition, db.state.rows[0]!.proposal_version]).toEqual([null, 2]);
  });

  it("the operator's own put-this-aside writes the dismissal, and refuses to retire a change already being measured", async () => {
    await saveChangeProposal(proposal());
    expect(await dismissChangeProposal(T, proposal().id)).toBe(true);
    expect(db.state.rows[0]!.terminal_disposition).toBe("dismissed");
    expect((await loadChangeProposals(T)).size).toBe(0); // it stops being the current answer immediately
    expect(await dismissChangeProposal(T, proposal().id)).toBe(false); // already put away, nothing to write
    // A change the operator marked implemented is under measurement, so it is not theirs to put away.
    Object.assign(db.state.rows[0]!, { terminal_disposition: null, status: "applied" });
    expect(await dismissChangeProposal(T, proposal().id)).toBe(false);
    expect(db.state.rows[0]!.terminal_disposition).toBeNull();
    expect(await dismissChangeProposal(T, "an-id-nobody-holds")).toBe(false);
  });

  it("refuses a crafted successor id that lives under another account, and nothing moves", async () => {
    // Account B holds a row whose id a malicious caller hands to account A's handover as the successor.
    expect(await saveChangeProposal(proposal())).toBe("saved");
    db.state.rows.push({ id: "acct-b::/other::existing_edit::title", tenant_id: "acct-b", case_id: "", page_key: "/other",
      action_family: "title-family", proposal_version: 1, basis: "b1", status: "proposed", terminal_disposition: null,
      superseded_by: null, payload: JSON.parse(serializeChangeProposal(proposal({ id: "acct-b::/other::existing_edit::title", tenantId: "acct-b", pagePath: "/other" }))), created_at: "2026-07-01T00:00:00.000Z" });
    const crafted = proposal({ id: "acct-b::/other::existing_edit::title", basis: "b2",
      bundle: bundle("title", "A Different Title Entirely") });
    expect(await saveChangeProposal(crafted)).toBe("failed");
    const b = db.state.rows.find((r) => r.tenant_id === "acct-b")!;
    expect([b.status, b.terminal_disposition, b.proposal_version]).toEqual(["proposed", null, 1]); // untouched
    const a = db.state.rows.find((r) => r.tenant_id === T)!;
    expect(a.terminal_disposition).toBeNull(); // the predecessor keeps its place
  });

  it("reads pre-cutover rows as history, never revives one the canonical table retired, and never crosses accounts", async () => {
    const old = proposal({ id: `${T}::/older-page::existing_edit::title`, pagePath: "/older-page" });
    seedLegacy(old); seedLegacy(proposal()); seedLegacy(proposal({ tenantId: "acct-b", id: "acct-b::/theirs::existing_edit::title" }));
    expect([...(await loadChangeProposals(T)).keys()].sort()).toEqual([old.id, proposal().id].sort()); // both readable before anything is written
    await saveChangeProposal(proposal());
    await saveChangeProposal(deep()); // retires the title row the legacy store still holds a copy of
    expect([...(await loadChangeProposals(T)).keys()].sort()).toEqual([deep().id, old.id].sort());
    expect([...(await loadChangeProposals("acct-b")).keys()]).toEqual(["acct-b::/theirs::existing_edit::title"]); // each account sees its own work and nobody else's
    db.state.missing = true; // before the migration is applied: history still renders, nothing is invented
    expect((await loadChangeProposals(T)).size).toBe(2);
    expect(await saveChangeProposal(proposal({ status: "applied" }))).toBe("failed");
  });

  it("proves the handover row belongs to this account BEFORE it writes, and names a missing supersession function for what it is", async () => {
    // NOTHING UNSCOPED EVER REACHES THE HANDOVER. The store refuses a save with no account before it reads
    // anything, and the row handed to the function is asserted against the caller's own account on the way
    // in (the same check every other write in this product passes through, which going straight to .rpc()
    // had given up), so a row that cannot prove its scope is never written by it.
    db.state.rows.push({ id: "held", tenant_id: "", site: "fixture-outdoors.example", case_id: "", page_key: PAGE,
      action_family: "title-family", status: "proposed", terminal_disposition: null, proposal_version: 1,
      payload: JSON.parse(serializeChangeProposal(proposal({ id: "held" }))) as unknown });
    expect(await saveChangeProposal(proposal({ tenantId: "" }))).toBe("failed");
    expect(db.state.rpcCalls).toBe(0);
    expect(db.state.rows[0]!.terminal_disposition).toBeNull(); // nothing moved

    // THE FUNCTION IS NOT THERE. A deploy that ran ahead of its migration is not a blocked handover, and it
    // used to read exactly like one. The table is fine here; only the routine is missing.
    db.state.rows = [];
    expect(await saveChangeProposal(proposal())).toBe("saved");
    db.state.rpcMissing = true;
    said.errors = [];
    expect(await saveChangeProposal(deep())).toBe("failed");
    expect(said.errors.join(" ")).toContain("the supersession function is not installed"); // named, not one more silent "failed"
    expect(db.state.rows).toHaveLength(1);                                   // the successor never landed
    expect(db.state.rows[0]!.terminal_disposition).toBeNull();               // and the predecessor is still current
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([proposal().id]);
  });

  it("never retires a change the operator already acted on: a newer draft for that hypothesis is refused and the applied row keeps its place", async () => {
    expect(await saveChangeProposal(proposal({ status: "applied" }))).toBe("saved"); // the operator marked it implemented
    expect(await saveChangeProposal(deep())).toBe("blocked"); // the same page, the same family, a fresh idea
    expect(db.state.rows).toHaveLength(1);
    expect([db.state.rows[0]!.status, db.state.rows[0]!.terminal_disposition, db.state.rows[0]!.superseded_by])
      .toEqual(["applied", null, null]); // the change being measured is still the current answer
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([proposal().id]); // the queue is exactly what it was
    // A rejected row was already answered, so it is not shoved aside for a new draft either.
    Object.assign(db.state.rows[0]!, { status: "rejected" });
    expect(await saveChangeProposal(deep())).toBe("blocked"); });

  it("asks EVERY dismissal, not whichever row came back first: a redraft under a basis this hypothesis was dismissed under is refused", async () => {
    await saveChangeProposal(proposal({ basis: "basis_a" }));
    Object.assign(db.state.rows[0]!, { terminal_disposition: "dismissed" }); // put away under basis_a
    expect(await saveChangeProposal(deep({ basis: "basis_b" }))).toBe("saved"); // a new reading, so it may try again
    Object.assign(db.state.rows[1]!, { terminal_disposition: "dismissed" }); // put away under basis_b too
    // The dismissal that decides is the one under THIS basis, wherever it sits in an unordered read.
    expect(await saveChangeProposal(proposal({ basis: "basis_b" }))).toBe("refused");
    expect(await saveChangeProposal(proposal({ basis: "basis_c" }))).toBe("saved"); });

  it("repairs a handover whose successor never landed: the predecessor reads as current again until a real successor exists", async () => {
    await saveChangeProposal(proposal());
    // The crash the in-process rollback cannot cover: the predecessor stepped aside, the insert never landed.
    Object.assign(db.state.rows[0]!, { terminal_disposition: "superseded", superseded_by: deep().id });
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([proposal().id]); // the hypothesis is not stranded
    await saveChangeProposal(deep()); // the successor lands for real
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([deep().id]); }); // and the repair stops applying

  it("reads the queue, not the archive: hundreds of retired versions never crowd out the current work, and none of them comes back through the old store", async () => {
    const canonRow = (id: string, over: Row = {}): Row => ({ id, tenant_id: T, site: "", case_id: "", page_key: id, action_family: "title-family",
      proposal_version: 1, basis: "basis_today::d6", status: "proposed", terminal_disposition: null, superseded_by: null,
      payload: JSON.parse(serializeChangeProposal(proposal({ id }))), updated_at: "2026-07-31T09:00:00.000Z", ...over });
    const live = [0, 1, 2, 3, 4].map((i) => `${T}::/live-${i}::existing_edit::title`);
    for (const id of live) db.state.rows.push(canonRow(id, { updated_at: "2026-07-30T09:00:00.000Z" })); // the oldest-touched rows of all
    for (let i = 0; i < 600; i += 1) { const id = `${T}::/old-${i}::existing_edit::title`;
      db.state.rows.push(canonRow(id, { terminal_disposition: "superseded", superseded_by: live[i % 5]! })); }
    seedLegacy(proposal({ id: `${T}::/old-7::existing_edit::title` })); // the old store still holds a copy of a retired row
    expect([...(await loadChangeProposals(T)).keys()].sort()).toEqual([...live].sort()); }); // five current rows, and not one resurrection

  it("calls a write that landed no row a FAILURE and gives the predecessor its place back", async () => {
    await saveChangeProposal(proposal());
    db.state.breakWrite = true;
    expect(await saveChangeProposal(deep())).toBe("failed");
    expect(current().map((r) => [r.id, r.terminal_disposition, r.superseded_by])).toEqual([[proposal().id, null, null]]);
    expect(db.state.rows).toHaveLength(1);
    expect((await loadChangeProposals(T)).size).toBe(1); // the operator's queue is exactly what it was
  });
});
