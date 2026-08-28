/** CANONICAL PROPOSAL PERSISTENCE (V1 Truth Convergence Phase 5): one current row per hypothesis (account, case, page, action family), a re-draft supersedes with a pointer and a version, an identical draft writes nothing, a dismissed change is not resurrected under the same evidence, history stays readable and is never revived, and a write that lands nothing is a failure. Fixtures only: the fake Postgres below enforces the primary key and the partial unique index. */
import { describe, it, expect, beforeEach, vi } from "vitest";
type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  // `missing` = the TABLE is not in the schema cache; `rpcMissing` = the table is there and the supersession FUNCTION is not. They are separate flags because they are separate deploy accidents, and one flag could only ever test the first: the table read failed before the function was ever called. `raceForeign` is a concurrent insert of the SUCCESSOR id under another account, landing after the guard read: the upsert's tenant WHERE then matches nothing, so nothing lands and the whole handover must unwind rather than report saved. `race` is a write by SOMEBODY ELSE, fired once at the next read: the interleaving a confirmation lives inside, where the row moves between the reading that validated it and the write that lands it.
  const state = { rows: [] as Row[], legacy: [] as Row[], missing: false, rpcMissing: false, breakWrite: false, rpcCalls: 0, raceForeign: "", race: null as null | (() => void) };
  const client: Record<string, unknown> = {
    // The atomic handover: guard, step-aside, and landing commit together or not at all, exactly like the supersede_change_proposal function in production.
    rpc(name: string, args: { p_tenant_id: string; p_predecessor_id: string; p_row: Row }) { state.rpcCalls += 1;
      const run = (): { data: string | null; error: { message: string; code?: string } | null } => {
        if (name !== "supersede_change_proposal") return { data: null, error: { message: `unknown function ${name}` } };
        if (state.rpcMissing) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.supersede_change_proposal" } };
        // The tenant guard the SQL now opens with: a successor id living under another account fails whole.
        if (state.rows.some((r) => r.id === (args.p_row as Row).id && r.tenant_id !== args.p_tenant_id)) return { data: "failed", error: null };
        const pred = state.rows.find((r) => r.tenant_id === args.p_tenant_id && r.id === args.p_predecessor_id);
        if (!pred) return { data: "failed", error: null };
        if (pred.terminal_disposition != null || !["ready", "needs_review"].includes(String(pred.status))) return { data: "blocked", error: null };
        if (state.breakWrite) return { data: "failed", error: null }; // the transaction rolls back: neither write lands
        const row = args.p_row;
        const clash = state.rows.some((r) => r.id !== row.id && r.id !== pred.id && r.terminal_disposition == null
          && ["tenant_id", "case_id", "page_key", "action_family", "mutation_key"].every((c) => r[c] === row[c]));
        if (clash) return { data: "failed", error: null };
        if (state.raceForeign) state.rows.push({ id: row.id, tenant_id: state.raceForeign, status: "ready", created_at: "2026-07-01T00:00:00.000Z" });
        // THE INSERT'S OWN LANDING IS THE PROOF, exactly as the SQL now reads it: zero rows back means the successor never landed, so it raises and BOTH writes unwind with the predecessor still in place.
        const at = state.rows.findIndex((r) => r.id === row.id);
        if (at >= 0 && state.rows[at]!.tenant_id !== args.p_tenant_id) return { data: "failed", error: null };
        Object.assign(pred, { terminal_disposition: "superseded", superseded_by: row.id, updated_at: row.updated_at });
        if (at >= 0) state.rows[at] = { ...state.rows[at], ...row }; else state.rows.push({ created_at: "2026-07-01T00:00:00.000Z", ...row });
        return { data: "saved", error: null };};
      return Promise.resolve(run());
    }, };
  return { state, client }; });
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => db.client }));
/** What the store SAID, so a distinct failure can be pinned as distinct rather than as one more "failed". */
const said = vi.hoisted(() => ({ errors: [] as string[] }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: (msg: string) => { said.errors.push(msg); } } }));
import { dismissChangeProposal, loadChangeProposal, loadChangeProposals, answerReviewedProposal, saveChangeProposal,
  transitionProposalToImplemented } from "@/domains/decision/proposal-store";
import { confirmedVersion } from "@/domains/decision/completeness";
import { reconcileImplementedWithoutShipment } from "@/domains/decision/implemented-repair";
import { deserializeChangeProposal, serializeChangeProposal, type ChangeBundle, type ChangeProposal } from "@/domains/decision/contracts";
import { supabaseFake } from "../helpers/supabase-fake";
// The row budget and the sort order are part of what the queue read is asked to prove, so the fake honours order + limit; `clash` is the partial unique index: one current row per (tenant, case, page, family).
Object.assign(db.client, supabaseFake({
  rows: (t) => (t === "change_proposals" ? db.state.rows : db.state.legacy),
  error: (t) => (t === "change_proposals" && db.state.missing ? { code: "PGRST205", message: "table not found in schema cache" } : null),
  landsNothing: () => db.state.breakWrite, insertDefaults: () => ({ created_at: "2026-07-01T00:00:00.000Z" }),
  onSelect: () => { const r = db.state.race; db.state.race = null; r?.(); },
  clash: (row, rows) => (rows.some((r) => r.id !== row.id && r.terminal_disposition == null
    && ["tenant_id", "case_id", "page_key", "action_family"].every((c) => r[c] === row[c]))
    ? { message: "duplicate key value violates unique constraint ux_change_proposals_current" } : null),}));
const T = "acct-a", PAGE = "/nowruz-guide";
const bundle = (kind: ChangeBundle["components"][number]["kind"], after = "Nowruz Traditions and the Haft-Seen Table"): ChangeBundle => ({
  objective: "Say what the searcher asked for in the line Google shows.", metric: "clicks on this page for this search",
  scope: { queries: ["nowruz traditions"], prompts: [] },
  components: [{ kind, label: "Page title", before: "Nowruz", after, evidenceKeys: ["k1"], risk: "safe" }],
  receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "1,200 impressions and 9 clicks for nowruz traditions.", observedAt: "2026-07-25T00:00:00.000Z" }], missing: [], freshestObservedAt: "2026-07-25T00:00:00.000Z" },
  alternatives: [], risks: [], confidenceReasons: [], measurementPlan: "I will read clicks for this search after 14 days.",});
const proposal = (over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: `${T}::${PAGE}::existing_edit::title`, tenantId: T, kind: "existing_edit", pagePath: PAGE,
  pageUrl: `https://www.fixture-outdoors.example${PAGE}`, pageLabel: "Nowruz guide", primaryQuery: "nowruz traditions",
  opportunityType: "Capture clicks", changeFamily: "title", status: "ready",
  recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table" },
  whyItMatters: "The line Google shows misses the words people search for.", estimatedEffortMinutes: 1,
  riskLevel: "low", confidence: "medium", limitations: [], evidence: { query: "nowruz traditions", hints: [], evidenceRefCount: 1 },
  impactScore: 300, upsidePerMonth: null, basis: "basis_today::d6", publish: "manual", createdAt: "2026-07-30T00:00:00.000Z", ...over,});
/** The deep form of the same hypothesis: a different id, the same page, the same family. */
const deep = (over: Partial<ChangeProposal> = {}) => proposal({ id: `${T}::${PAGE}::existing_edit::title-family`, bundle: bundle("title"), ...over });
const current = () => db.state.rows.filter((r) => r.terminal_disposition == null);
const seedLegacy = (p: ChangeProposal) => db.state.legacy.push({ tenant_id: p.tenantId, rec_id: p.id, kind: "change_proposal", content: serializeChangeProposal(p), created_at: p.createdAt });
beforeEach(() => { db.state.rows = []; db.state.legacy = []; db.state.missing = false; db.state.rpcMissing = false; db.state.breakWrite = false; db.state.rpcCalls = 0; db.state.raceForeign = ""; db.state.race = null; });
/** POST-CONTRACT HISTORY (packet acceptance 22). The contract migration moved every row onto the three lifecycle words and the bridge decoder is deleted with it: the same reads answer identically without one, and no historical proposal disappears. */
const PROMOTE = { kind: "promote" as const, at: "2026-08-15T00:00:00.000Z" };
describe("rows written after the lifecycle contract", () => {
  const row = (id: string, word: string): Row => ({
    tenant_id: T, id, proposal_version: 1, status: word, terminal_disposition: null, superseded_by: null,
    basis: "basis_today::d6", case_id: "", page_key: id, action_family: "title-family",
    payload: JSON.parse(JSON.stringify({ v: 1, proposal: { ...proposal({ id, pagePath: id }), status: word } })),
    updated_at: "2026-07-30T00:00:00.000Z" });
  it("22: the contract reads migrated history, and no historical proposal disappears", async () => {
    db.state.rows.push(row("/a", "ready"), row("/b", "implemented_pending_verification"));
    seedLegacy(proposal({ id: "/legacy-only", pagePath: "/legacy-only" }));
    const queue = await loadChangeProposals(T); expect([[...queue.keys()].sort(), queue.get("/b")!.status]).toEqual([["/a", "/b", "/legacy-only"], "implemented_pending_verification"]); }); });
describe("canonical proposal persistence", () => {
  it("keeps ONE current row per hypothesis: a re-draft supersedes its predecessor, points at it, and carries the next version", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved");
    expect(await saveChangeProposal(deep())).toBe("saved"); // the deep form of the same page and the same family
    expect([db.state.rows.length, current().map((r) => [r.id, r.proposal_version, r.action_family])]).toEqual([2, [[`${T}::${PAGE}::existing_edit::title-family`, 2, "title-family"]]]);
    const retired = db.state.rows.find((r) => r.id === `${T}::${PAGE}::existing_edit::title`)!; expect([retired.terminal_disposition, retired.superseded_by]).toEqual(["superseded", `${T}::${PAGE}::existing_edit::title-family`]);
    // History is not served as current work, by id or in the queue.
    expect(await loadChangeProposal(T, retired.id as string)).toBeNull(); expect([...(await loadChangeProposals(T)).keys()]).toEqual([`${T}::${PAGE}::existing_edit::title-family`]); });
  it("bumps the version in place when the same id says something new, and writes NOTHING when it says the same thing", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved");
    expect(await saveChangeProposal(proposal())).toBe("unchanged"); // same material content, same timestamp, no write
    expect(await saveChangeProposal({ ...proposal(), createdAt: "2026-07-31T09:00:00.000Z" })).toBe("unchanged"); // a moved clock is not new thinking
    expect([db.state.rows.length, db.state.rows[0]!.proposal_version]).toEqual([1, 1]); expect(await saveChangeProposal(proposal({ status: "needs_review" }))).toBe("saved");
    expect(db.state.rows).toHaveLength(1); // still one row: the same id is the same hypothesis
    expect([db.state.rows[0]!.proposal_version, db.state.rows[0]!.status, db.state.rows[0]!.terminal_disposition]).toEqual([2, "needs_review", null]);
    // The same id whose components moved to another family MOVES: it is still one change, not two.
    expect(await saveChangeProposal(proposal({ bundle: bundle("section_rewrite") }))).toBe("saved"); expect([db.state.rows.length, db.state.rows[0]!.action_family, db.state.rows[0]!.proposal_version]).toEqual([1, "section-family", 3]); });
  it("lands the reasoning on the stored row exactly once: the cause is material, and a re-save carrying the same one writes nothing", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved"); // filed before the ladder ever named a cause
    const reasoned = proposal({ diagnosisCause: "ctr_snippet", causeFinding: { cause: "ctr_snippet", action: "title", evidenceKeys: ["gsc"],
      competingExplanations: [{ cause: "cannibalization", reason: "only one page of yours comes up for that search" }],
      falsifier: "If Google starts displaying this page with the wording the pages beating it share, this is not the explanation.",
      explanation: "The line Google shows misses the words people search for.", notConsidered: [] } });
    expect(await saveChangeProposal(reasoned)).toBe("saved"); // ONE update, so the operator can actually open the investigation
    expect([db.state.rows.length, db.state.rows[0]!.proposal_version, (db.state.rows[0]!.decision_receipt as { cause: string }).cause]).toEqual([1, 2, "ctr_snippet"]);
    expect(await saveChangeProposal(reasoned)).toBe("unchanged"); // and once only: every pass after it re-derives the same reasoning
    expect(db.state.rows[0]!.proposal_version).toBe(2); });
  it("holds two current rows when one page carries two different action families", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved"); // title-family
    const body = deep({ id: `${T}::${PAGE}::existing_edit::section-family`, bundle: bundle("section_rewrite") }); // the id the producer mints for it: the family is IN the id, so two families coexist
    expect(await saveChangeProposal(body)).toBe("saved"); // section-family: a different hypothesis about the same page
    expect([current().map((r) => r.action_family).sort(), current().every((r) => r.proposal_version === 1), (await loadChangeProposals(T)).size]).toEqual([["section-family", "title-family"], true, 2]);});
  it("does not resurrect a dismissed change under the same evidence, and lets a new basis try again", async () => {
    await saveChangeProposal(proposal());
    Object.assign(db.state.rows[0]!, { terminal_disposition: "dismissed" }); // the operator put it away
    expect(await saveChangeProposal(proposal({ confidence: "high" }))).toBe("refused"); expect([db.state.rows[0]!.terminal_disposition, (await loadChangeProposals(T)).size]).toEqual(["dismissed", 0]);
    // A different basis is a genuinely different reading of the account, so the change may be made again.
    expect(await saveChangeProposal(proposal({ basis: "basis_tomorrow::d6" }))).toBe("saved"); expect([db.state.rows[0]!.terminal_disposition, db.state.rows[0]!.proposal_version]).toEqual([null, 2]); });
  it("the operator's own put-this-aside writes the dismissal, and refuses to retire a change already being measured", async () => {
    await saveChangeProposal(proposal());
    expect(await dismissChangeProposal(T, proposal().id)).toBe(true); // it stops being the current answer immediately
    expect([db.state.rows[0]!.terminal_disposition, (await loadChangeProposals(T)).size]).toEqual(["dismissed", 0]);
    expect(await dismissChangeProposal(T, proposal().id)).toBe(false); // already put away, nothing to write
    // A change the operator marked implemented is under measurement, so it is not theirs to put away.
    Object.assign(db.state.rows[0]!, { terminal_disposition: null, status: "implemented_pending_verification" });
    expect([await dismissChangeProposal(T, proposal().id), db.state.rows[0]!.terminal_disposition, await dismissChangeProposal(T, "an-id-nobody-holds")]).toEqual([false, null, false]);});
  it("refuses a crafted successor id that lives under another account, and nothing moves", async () => {
    // Account B holds a row whose id a malicious caller hands to account A's handover as the successor.
    expect(await saveChangeProposal(proposal())).toBe("saved");
    db.state.rows.push({ id: "acct-b::/other::existing_edit::title", tenant_id: "acct-b", case_id: "", page_key: "/other",
      action_family: "title-family", proposal_version: 1, basis: "b1", status: "ready", terminal_disposition: null,
      superseded_by: null, payload: JSON.parse(serializeChangeProposal(proposal({ id: "acct-b::/other::existing_edit::title", tenantId: "acct-b", pagePath: "/other" }))), created_at: "2026-07-01T00:00:00.000Z" });
    const crafted = proposal({ id: "acct-b::/other::existing_edit::title", basis: "b2",
      bundle: bundle("title", "A Different Title Entirely") });
    expect(await saveChangeProposal(crafted)).toBe("failed"); const b = db.state.rows.find((r) => r.tenant_id === "acct-b")!;
    expect([b.status, b.terminal_disposition, b.proposal_version]).toEqual(["ready", null, 1]); // untouched
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
    expect((await loadChangeProposals(T)).size).toBe(2); expect(await saveChangeProposal(proposal({ status: "implemented_pending_verification" }))).toBe("failed"); });
  it("proves the handover row belongs to this account BEFORE it writes, and names a missing supersession function for what it is", async () => {
    // NOTHING UNSCOPED EVER REACHES THE HANDOVER. The store refuses a save with no account before it reads anything, and the row handed to the function is asserted against the caller's own account on the way in (the same check every other write in this product passes through, which going straight to .rpc() had given up), so a row that cannot prove its scope is never written by it.
    db.state.rows.push({ id: "held", tenant_id: "", site: "fixture-outdoors.example", case_id: "", page_key: PAGE,
      action_family: "title-family", status: "ready", terminal_disposition: null, proposal_version: 1,
      payload: JSON.parse(serializeChangeProposal(proposal({ id: "held" }))) as unknown });
    expect(await saveChangeProposal(proposal({ tenantId: "" }))).toBe("failed"); expect(db.state.rpcCalls).toBe(0);
    expect(db.state.rows[0]!.terminal_disposition).toBeNull(); // nothing moved
    // THE FUNCTION IS NOT THERE. A deploy that ran ahead of its migration is not a blocked handover, and it used to read exactly like one. The table is fine here; only the routine is missing.
    db.state.rows = [];
    expect(await saveChangeProposal(proposal())).toBe("saved");
    db.state.rpcMissing = true;
    said.errors = [];
    expect(await saveChangeProposal(deep())).toBe("failed");
    expect(said.errors.join(" ")).toContain("the supersession function is not installed"); // named, not one more silent "failed"
    expect(db.state.rows).toHaveLength(1);                                   // the successor never landed
    expect(db.state.rows[0]!.terminal_disposition).toBeNull();               // and the predecessor is still current
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([proposal().id]); });
  it("never retires a change the operator already acted on: a newer draft for that hypothesis is refused and the applied row keeps its place", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved");
    expect(await transitionProposalToImplemented(T, proposal().id, "shp_seed")).toBe(true); // done is reachable only through the transaction
    expect(await saveChangeProposal(deep())).toBe("blocked"); // the same page, the same family, a fresh idea
    expect(db.state.rows).toHaveLength(1);
    expect([db.state.rows[0]!.status, db.state.rows[0]!.terminal_disposition, db.state.rows[0]!.superseded_by])
      .toEqual(["implemented_pending_verification", null, null]); // the change being measured is still the current answer
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([proposal().id]); // the queue is exactly what it was
    // A draft I withdrew myself is history under this basis WHILE ITS EVIDENCE HOLDS STILL, so the same idea off the same readings is refused, not filed.
    Object.assign(db.state.rows[0]!, { status: "needs_review", terminal_disposition: "withdrawn", basis: "basis_today::d6",
      payload: JSON.parse(JSON.stringify({ v: 1, proposal: deep() })) });
    expect(await saveChangeProposal(deep())).toBe("refused");
    // AND IT STOPS BEING HISTORY THE MOMENT THE EVIDENCE MOVES. The basis fingerprints the ACCOUNT, so on basis alone this stayed shut for a whole generation while the readings under it changed completely, and the redraft those readings had earned was refused forever.
    const moved = deep(); moved.bundle!.receipt.items[0]!.observedAt = "2026-08-04T00:00:00.000Z"; expect(await saveChangeProposal(moved)).toBe("saved");
    // A REORDERED RECEIPT IS THE SAME EVIDENCE. Hashing the items in producer order would have let a shuffle alone lift a refusal the operator meant to stand.
    Object.assign(db.state.rows[0]!, { status: "needs_review", terminal_disposition: "withdrawn", payload: JSON.parse(JSON.stringify({ v: 1, proposal: moved })) });
    const two = (b: typeof moved) => { const i = b.bundle!.receipt.items[0]!; b.bundle!.receipt.items = [i, { ...i, key: "k2", fact: "Two rivals now answer it with a table." }]; return b; };
    const twoWay = two(deep()); twoWay.bundle!.receipt.items[0]!.observedAt = "2026-08-04T00:00:00.000Z";
    Object.assign(db.state.rows[0]!, { payload: JSON.parse(JSON.stringify({ v: 1, proposal: twoWay })) });
    const shuffled = two(deep()); shuffled.bundle!.receipt.items[0]!.observedAt = "2026-08-04T00:00:00.000Z"; shuffled.bundle!.receipt.items.reverse(); expect(await saveChangeProposal(shuffled)).toBe("refused"); });
  /** AN ATOMIC CHANGE CARRIES NO RECEIPT, so hashing the receipt hashed the empty list for every one of them: they matched each other unconditionally and stayed shut forever on an unchanged basis. What such a change stands on is the frozen evidence summary and the exact edit it argues for. */
  it("reopens an atomic change whose own evidence moved, and keeps the refusal while it has not", async () => {
    await saveChangeProposal(proposal());
    Object.assign(db.state.rows[0]!, { terminal_disposition: "withdrawn" });
    expect(await saveChangeProposal(proposal({ confidence: "high" }))).toBe("refused"); // same evidence, same edit: still history
    expect(await saveChangeProposal(proposal({ evidence: { query: "nowruz traditions", hints: ["the results page now shows a table"], evidenceRefCount: 4 } }))).toBe("saved"); });
  it("asks EVERY dismissal, not whichever row came back first: a redraft under a basis this hypothesis was dismissed under is refused", async () => {
    await saveChangeProposal(proposal({ basis: "basis_a" }));
    Object.assign(db.state.rows[0]!, { terminal_disposition: "dismissed" }); // put away under basis_a
    expect(await saveChangeProposal(deep({ basis: "basis_b" }))).toBe("saved"); // a new reading, so it may try again
    Object.assign(db.state.rows[1]!, { terminal_disposition: "dismissed" }); // put away under basis_b too
    // The dismissal that decides is the one under THIS basis, wherever it sits in an unordered read.
    expect(await saveChangeProposal(deep({ basis: "basis_b" }))).toBe("refused"); expect(await saveChangeProposal(deep({ basis: "basis_c" }))).toBe("saved"); });
  it("repairs a handover whose successor never landed: the predecessor reads as current again until a real successor exists", async () => {
    await saveChangeProposal(proposal());
    // The crash the in-process rollback cannot cover: the predecessor stepped aside, the insert never landed.
    Object.assign(db.state.rows[0]!, { terminal_disposition: "superseded", superseded_by: deep().id });
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([proposal().id]); // the hypothesis is not stranded
    await saveChangeProposal(deep()); // the successor lands for real
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([deep().id]); }); // and the repair stops applying
  it("reads the queue, not the archive: hundreds of retired versions never crowd out the current work, and none of them comes back through the old store", async () => {
    const canonRow = (id: string, over: Row = {}): Row => ({ id, tenant_id: T, site: "", case_id: "", page_key: id, action_family: "title-family",
      proposal_version: 1, basis: "basis_today::d6", status: "ready", terminal_disposition: null, superseded_by: null,
      payload: JSON.parse(serializeChangeProposal(proposal({ id }))), updated_at: "2026-07-31T09:00:00.000Z", ...over });
    const live = [0, 1, 2, 3, 4].map((i) => `${T}::/live-${i}::existing_edit::title`);
    for (const id of live) db.state.rows.push(canonRow(id, { updated_at: "2026-07-30T09:00:00.000Z" })); // the oldest-touched rows of all
    for (let i = 0; i < 600; i += 1) { const id = `${T}::/old-${i}::existing_edit::title`;
      db.state.rows.push(canonRow(id, { terminal_disposition: "superseded", superseded_by: live[i % 5]! })); }
    seedLegacy(proposal({ id: `${T}::/old-7::existing_edit::title` })); // the old store still holds a copy of a retired row
    expect([...(await loadChangeProposals(T)).keys()].sort()).toEqual([...live].sort()); }); // five current rows, and not one resurrection
  // A HANDOVER THAT DID NOT LAND IS A FAILURE, whether the write simply landed no row or a successor id raced in under another account after the guard read. Either way the predecessor keeps its place and its queue.
  it.each([["a write that landed no row", () => { db.state.breakWrite = true; }],
    ["a successor id racing in under another account", () => { db.state.raceForeign = "acct-b"; }],
  ] as const)("%s is a FAILURE, and the predecessor keeps its place", async (_name, arrange) => {
    await saveChangeProposal(proposal());
    arrange();
    expect(await saveChangeProposal(deep())).toBe("failed");
    expect(current().filter((r) => r.tenant_id === T).map((r) => [r.id, r.terminal_disposition, r.superseded_by]))
      .toEqual([[proposal().id, null, null]]);
    expect((await loadChangeProposals(T)).size).toBe(1); // one proposal, still current, still this account's
  });
  // PIN: the schema keeps every word a check reads later. A renamed link is verified on anchorAfter and a forward on redirectTo; a schema that strips either sends the check out wordless and it grades nothing.
  it("anchorAfter and redirectTo survive the persistence round trip", () => {
    const b = bundle("anchor_text");
    b.components[0] = { ...b.components[0]!, anchorAfter: "Read the Haft-Seen guide", redirectTo: "https://own.com/haft-seen" };
    const back = deserializeChangeProposal(serializeChangeProposal(deep({ bundle: b })));
    expect(back?.bundle?.components.map((c) => [c.anchorAfter, c.redirectTo]))
      .toEqual([["Read the Haft-Seen guide", "https://own.com/haft-seen"]]); }); });
/** THE ONE DOOR TO "DONE", AND THE TRIPWIRE UNDER IT. A change reads done only because a Shipment was written for it first, so the flip demands that record's id and a row marked done that no record points at is a state this product cannot legitimately produce: it is never left silently done, and no record is ever invented for it. */
describe("done is only ever reached with a record behind it", () => {
  const DONE_ID = `${T}::${PAGE}::existing_edit::title`, SENTENCE = "A change marked done on August 12 lost its record; mark it done again when you confirm it is live.";
  const seed = (over: Partial<ChangeProposal> = {}) => { const p = proposal(over);
    db.state.rows.push({ tenant_id: T, id: DONE_ID, proposal_version: 1, status: p.status, terminal_disposition: null, superseded_by: null, basis: p.basis ?? null,
      case_id: "", page_key: PAGE, action_family: "title-family", queue_lane: "rel::ready", queue_rank: 3,
      payload: JSON.parse(serializeChangeProposal(p)) as unknown, updated_at: "2026-08-12T04:50:00.000Z" });
    return db.state.rows[0]!; };
  const done = (over: Partial<ChangeProposal> = {}) => seed({ status: "implemented_pending_verification", ...over });
  const storedNow = (row: Record<string, unknown>) => deserializeChangeProposal(JSON.stringify(row.payload));
  it("refuses the flip with no record named, and lands it with one", async () => {
    const row = seed();
    expect([await transitionProposalToImplemented(T, DONE_ID, "  "), row.status]).toEqual([false, "ready"]); // nothing moved, so the change is still theirs to do
    expect([await transitionProposalToImplemented(T, DONE_ID, "rec-1"), db.state.rows[0]!.status]).toEqual([true, "implemented_pending_verification"]); });
  it("sends a change marked done with no record back to the queue carrying the one sentence that says so", async () => {
    const row = done(); expect(await reconcileImplementedWithoutShipment(T, new Set<string>())).toEqual([SENTENCE]);
    expect([row.status, row.queue_lane, row.queue_rank]).toEqual(["needs_review", null, null]); // back in the queue, and it earns its position again
    expect([storedNow(row)?.status, storedNow(row)?.limitations[0]]).toEqual(["needs_review", SENTENCE]); });
  // A FINISHED READING RETIRES THE ROW IT MEASURED. Eight rows sat "pending verification" forever after their readings settled: counted as in-flight, holding their pages against fresh work, waiting on nothing. The verdict stays on the ledger; this closes the queue's side, with the receipt on the row.
  it("retires a done row whose reading settled, keeps its stage, and says what the reading said", async () => {
    const row = done(); expect(await reconcileImplementedWithoutShipment(T, new Set([DONE_ID]), 50, new Map([[DONE_ID, "won"]]))).toEqual([]);
    expect([row.status, row.terminal_disposition, row.withdrawn_reason])
      .toEqual(["implemented_pending_verification", "settled", "The reading finished and the result is on Results: this change won."]); });
  it("leaves a change the ledger really is measuring untouched, never stacks the sentence, and reverts nothing on a read that failed", async () => {
    const row = done(); expect(await reconcileImplementedWithoutShipment(T, new Set([DONE_ID]))).toEqual([]);
    expect([row.status, row.queue_rank]).toEqual(["implemented_pending_verification", 3]);
    db.state.missing = true; // a read that failed is not proof of anything
    expect([await reconcileImplementedWithoutShipment(T, new Set<string>()), row.status]).toEqual([[], "implemented_pending_verification"]);
    db.state.missing = false; db.state.rows = [];
    const stale = done({ limitations: ["A change marked done on August 1 lost its record; mark it done again when you confirm it is live."] }); await reconcileImplementedWithoutShipment(T, new Set<string>());
    expect(storedNow(stale)?.limitations).toHaveLength(1); });});
/** STEP TWO OF THE TWO-STEP HOLD IS A COMPARE-AND-SET, NEVER A READ AND A SAVE. The confirmation used to read the row, check the version on the screen against it, and then hand the promoted copy to the ordinary save path, whose own read happens afterwards: a rewrite landing in between was overwritten by the version the operator had been looking at, and that version became ready. Here is that exact interleaving, both ways round. */
describe("the operator's yes lands on the exact version they read, or on nothing at all", () => {
  const mover = () => deep({ status: "needs_review", riskLevel: "high",
    evidence: { query: "nowruz traditions", hints: ["Visitors already call this the Haft-Seen Table guide."], evidenceRefCount: 1 },
    bundle: { ...bundle("consolidation"), risks: ["The old address stops answering."], components: [{ kind: "consolidation", label: "Merge the two pages", before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table", evidenceKeys: ["k1"], risk: "dangerous", redirectTo: "https://www.fixture-outdoors.example/nowruz",
      where: "This page's own address", objective: "Stop two pages from splitting one search.", mechanism: "One page answers the search once instead of two competing for it.", measurementPlan: "Clicks on the surviving page are read again after 14 days." }] } });
  const REWRITE = "A rewrite nobody has read yet";
  const rewriting = (p: ChangeProposal) => () => { const at = db.state.rows.findIndex((r) => r.id === p.id);
    db.state.rows[at] = { ...db.state.rows[at]!, proposal_version: 9, payload: JSON.parse(serializeChangeProposal({ ...p, recommendedChange: { ...p.recommendedChange, after: REWRITE } } as ChangeProposal)) as Row }; };
  const landed = (p: ChangeProposal) => { const r = db.state.rows.find((x) => x.id === p.id)!;
    return [r.status, r.proposal_version, (deserializeChangeProposal(JSON.stringify(r.payload))!.recommendedChange as { after: string }).after]; };
  it("refuses a confirmation whose row was rewritten between the read that validated it and the write that lands it", async () => {
    const held = mover();
    // THE DEFECT, kept as the reason this exists: read, check, unconditional write, and the rewrite that landed underneath is gone.
    expect(await saveChangeProposal(held)).toBe("saved");
    db.state.race = rewriting(held);
    await saveChangeProposal({ ...held, status: "ready", confirmedVersion: confirmedVersion(held) }); expect(landed(held)).toEqual(["ready", 2, "Nowruz Traditions and the Haft-Seen Table"]);
    // THE SAME INTERLEAVING through the one door a confirmation walks now: nothing is written, the rewrite stands, and the change stays behind the hold.
    db.state.rows = [];
    expect(await saveChangeProposal(held)).toBe("saved");
    db.state.race = rewriting(held);
    const raced = await answerReviewedProposal(T, held.id, confirmedVersion(held), held.basis ?? null, PROMOTE); expect([raced.status, ...landed(held)]).toEqual(["stale", "needs_review", 9, REWRITE]);
    // AND THE UNRACED PRESS DOES LAND, once, on the version it named: the yes is written onto the row and the row is at the next version.
    const ok = await answerReviewedProposal(T, held.id, confirmedVersion(held), held.basis ?? null, PROMOTE);
    expect([ok.status, ...landed(held)]).toEqual(["stale", "needs_review", 9, REWRITE]); // the row is a rewrite now, so the version they read is not this one
    db.state.rows = [];
    expect(await saveChangeProposal(held)).toBe("saved"); const yes = await answerReviewedProposal(T, held.id, confirmedVersion(held), held.basis ?? null, PROMOTE);
    const stored = deserializeChangeProposal(JSON.stringify(db.state.rows.find((r) => r.id === held.id)!.payload))!;
    expect([yes.status, ...landed(held), stored.confirmedVersion === confirmedVersion(held)]).toEqual(["promoted", "ready", 2, "Nowruz Traditions and the Haft-Seen Table", true]);
    // A version nobody is looking at, a row already promoted out of review, and a bar that has moved are all stale, and none of them writes anything.
    const after = landed(held);
    expect([(await answerReviewedProposal(T, held.id, "a version nobody is looking at", held.basis ?? null, PROMOTE)).status,
      (await answerReviewedProposal(T, held.id, confirmedVersion(held), held.basis ?? null, PROMOTE)).status,
      (await answerReviewedProposal(T, held.id, confirmedVersion(held), "basis_moved::d9", PROMOTE)).status, ...landed(held)]).toEqual(["stale", "stale", "stale", ...after]); });});
/** APPROVAL REFUSES ON THE FACT, NEVER ON THE SENTENCE DESCRIBING IT. A row whose lever does not treat its own diagnosed cause is refused by `unsettledCause` run directly on the promoted row, even when the stored limitation is worded to clear every phrase the display classifier (HARD_LIMITATION) looks for. */
describe("a badly classified row cannot be waved through", () => {
  it("refuses promotion on the unsettled cause even though the stored limitation reads as benign", async () => {
    const held = deep({ status: "needs_review", diagnosisCause: "weak_opening",
      recommendedChange: { kind: "existing_edit", field: "meta", before: "Nowruz", after: "Everything you need to know about Nowruz traditions this year." },
      limitations: ["Written from the account's current search data."], bundle: undefined });
    await saveChangeProposal(held);
    expect(await answerReviewedProposal(T, held.id, confirmedVersion(held), held.basis ?? null, PROMOTE))
      .toEqual({ status: "refused", refusal: "This change works on something other than how this page opens, which is what this page's own evidence names, so it is held for review rather than handed over as ready to paste." });
    expect(current().find((r) => r.id === held.id)!.status).toBe("needs_review"); }); });
/** PROMOTION FAILS CLOSED WHEN VALIDATION CANNOT RUN: absence of provenance is a refusal at THIS door even where the producer pass legitimately skipped it. */
describe("promotion fails closed when it cannot check its own work", () => {
  it("refuses atomic copy that carries no claim and no support fact", async () => {
    const bare = proposal({ status: "needs_review", diagnosisCause: "ctr_snippet" }); await saveChangeProposal(bare);
    expect(await answerReviewedProposal(T, bare.id, confirmedVersion(bare), bare.basis ?? null, PROMOTE))
      .toEqual({ status: "refused", refusal: "this copy carries no record of what it stands on, so it is held rather than promoted" }); });
  it("refuses a bundle component whose page this door does not hold", async () => {
    const untethered = deep({ status: "needs_review", bundle: { ...bundle("title"),
      components: [{ kind: "title", label: "Page title", before: "Nowruz", after: "Nowruz Traditions", evidenceKeys: ["k1"], risk: "safe", page: PAGE }] } });
    await saveChangeProposal(untethered); const res = await answerReviewedProposal(T, untethered.id, confirmedVersion(untethered), untethered.basis ?? null, PROMOTE);
    expect(res.status).toBe("refused"); expect(res.refusal).toContain("the words this change lands on are not in hand"); }); });
/** THE CANON'S OWN QUALITY STATUS GATES PROMOTION, NOT JUST ITS VERDICT: `needs_review` also covers real work still short of paste-ready (a claim with no source, a fresh number nobody confirmed), and that hold may not be waved through just because it is not the harsher `rejected`. */
describe("promotion asks the canon's own quality status, not just its verdict", () => {
  const held = (after: string) => deep({ status: "needs_review", bundle: bundle("section"), recommendedChange: { kind: "existing_edit", field: "meta", before: "Nowruz", after } });
  it.each([["a specific fact with no cited source (missing_source)", "The official record of Nowruz traditions spans centuries."], ["a fresh count nobody confirmed yet (useful_but_needs_review)", "Nowruz customs span 150+ regional variations."]] as const)("refuses promotion on %s even though the verdict is only needs_review", async (_label, after) => { const row = held(after); await saveChangeProposal(row); expect((await answerReviewedProposal(T, row.id, confirmedVersion(row), row.basis ?? null, PROMOTE)).status).toBe("refused"); });
  it("still promotes the sound row: needs_review only because a human look is owed, and the quality itself is ready", async () => { const row = held("Nowruz Traditions"); await saveChangeProposal(row); expect((await answerReviewedProposal(T, row.id, confirmedVersion(row), row.basis ?? null, PROMOTE)).status).toBe("promoted"); }); });
/** A SPLIT IS SETTLED BY THE PIECES, NOT BY THE FIELD THE FIRST ONE HAPPENS TO USE. A differentiation bundle is filed under its first component's field, so the two-page Iran flag bundle arrived as `title-family`, missed the ownership exception, and a FINISHED ready row was served from the research lane where nobody can act on it: the store said 3 ready and the customer queue showed 2. */
describe("a bundle that touches both competing pages treats the split", () => {
  it("is not withheld for using a title field on each page", async () => {
    const { withholdReason } = await import("@/domains/decision/authorization");
    const row = (pages: string[]) => ({ changeFamily: "title-family", causeFinding: { cause: "cannibalization" }, recommendedChange: { kind: "existing_edit", field: "title", before: null, after: "x" }, bundle: { components: pages.map((page) => ({ kind: "title", page, after: "x", evidenceKeys: [], label: "t", before: null, risk: "safe" })) } });
    expect([withholdReason(row(["/iran-flags/iran-islamic-republic-flag-history", "/iran-flags"]) as never, "cannibalization"), (withholdReason(row(["/iran-flags"]) as never, "cannibalization") ?? "").includes("does not treat it")]).toEqual([null, true]); }); }); // and one page is still one page
